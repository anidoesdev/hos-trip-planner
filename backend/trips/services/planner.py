"""Orchestration: geocode -> route -> HOS simulation -> labels -> daily logs -> response dict."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Optional
from zoneinfo import ZoneInfo

from django.conf import settings

from hos.daily_logs import build_daily_logs
from hos.engine import EngineConfig, Event, Leg, default_start, simulate_trip
from hos.report import build_stops, build_summary
from hos.validator import validate_plan

from .geocoding import GeoPoint, geocode
from .polyline import simplify
from .reverse_geocode import label_points
from .routing import RouteResult, get_route

FIELDS = ("current_location", "pickup_location", "dropoff_location")


def home_terminal_now() -> datetime:
    """Current wall-clock time at the home terminal, naive (§395.8 time base)."""
    return datetime.now(ZoneInfo(settings.HOME_TERMINAL_TZ)).replace(tzinfo=None)


def to_home_terminal(dt: datetime) -> datetime:
    """Convert an aware datetime to naive home-terminal time. A naive datetime is taken as already local."""
    if dt.tzinfo is None:
        return dt
    return dt.astimezone(ZoneInfo(settings.HOME_TERMINAL_TZ)).replace(tzinfo=None)


def geocode_all(texts: dict[str, str]) -> dict[str, GeoPoint]:
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = {f: pool.submit(geocode, texts[f], f) for f in FIELDS}
        return {f: fut.result() for f, fut in futures.items()}


def _label_events(events: list[Event]) -> None:
    """Fill in "City, ST" for every event that has coordinates but no label yet."""
    todo = [e for e in events if not e.location_label and e.lat is not None]
    labels = label_points([(e.lat, e.lng) for e in todo])
    for ev, label in zip(todo, labels):
        ev.location_label = label or f"near {ev.lat:.3f}, {ev.lng:.3f}"
    for ev in events:
        if ev.lat is not None:
            ev.lat, ev.lng = round(ev.lat, 5), round(ev.lng, 5)


def _attach_daily_compliance(daily_logs: list[dict], compliance: dict) -> None:
    """Assign each validator violation to the log day it happened on, for a per-sheet badge."""
    for log in daily_logs:
        mine = [v for v in compliance["violations"] if v["at"].startswith(log["date"])]
        log["compliance"] = {"ok": not mine, "violations": mine}


def _route_payload(route: RouteResult, points: dict[str, GeoPoint]) -> dict:
    names = [points[f].label for f in FIELDS]
    legs = []
    for i, leg in enumerate(route.legs):
        hours = leg.duration_min / 60
        legs.append({
            "from": names[i],
            "to": names[i + 1],
            "miles": round(leg.miles, 1),
            "duration_hours": round(hours, 2),
            "avg_mph": round(leg.miles / hours, 1) if hours else None,
            "geometry": [[round(a, 5), round(b, 5)]
                         for a, b in simplify(route.coords[route.leg_breaks[i]:route.leg_breaks[i + 1] + 1])],
        })
    return {
        "provider": route.provider,
        "geometry": [[round(a, 5), round(b, 5)] for a, b in simplify(route.coords)],
        "legs": legs,
        "total_miles": round(route.total_miles, 1),
        "total_duration_hours": round(sum(leg.duration_min for leg in route.legs) / 60, 2),
    }


def plan_trip(current_location: str, pickup_location: str, dropoff_location: str,
              current_cycle_used: float, start_datetime: Optional[datetime] = None,
              config: EngineConfig = EngineConfig()) -> dict:
    """Plan a trip end to end and return the API response body."""
    points = geocode_all({"current_location": current_location, "pickup_location": pickup_location,
                          "dropoff_location": dropoff_location})
    ordered = [points[f] for f in FIELDS]
    route = get_route(ordered)
    start = to_home_terminal(start_datetime) if start_datetime else default_start(home_terminal_now())

    legs = [Leg(r.miles, r.duration_min, ordered[i].label, ordered[i + 1].label) for i, r in enumerate(route.legs)]
    sim = simulate_trip(legs, current_cycle_used, start, config, locate=route.line().point_at)
    _label_events(sim.events)
    daily_logs = build_daily_logs(sim.events, current_cycle_used, config)
    compliance = validate_plan(sim.events, current_cycle_used, daily_logs, config)
    _attach_daily_compliance(daily_logs, compliance.to_dict())

    return {
        "input": {
            "current_location": points["current_location"].to_dict(),
            "pickup_location": points["pickup_location"].to_dict(),
            "dropoff_location": points["dropoff_location"].to_dict(),
            "current_cycle_used": current_cycle_used,
            "start_datetime": sim.start.isoformat(),
            "home_terminal_timezone": settings.HOME_TERMINAL_TZ,
        },
        "route": _route_payload(route, points),
        "events": [e.to_dict() for e in sim.events],
        "stops": build_stops(sim.events),
        "daily_logs": daily_logs,
        "summary": build_summary(sim, len(daily_logs)),
        "compliance": compliance.to_dict(),
    }
