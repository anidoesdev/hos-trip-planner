"""Derived views of a simulation: map stops and the trip summary."""

from __future__ import annotations

from typing import Optional, Sequence

from .engine import Event, Kind, Status, TripSimulation


def build_stops(events: Sequence[Event]) -> list[dict]:
    """Return non-driving events with coordinates for the map, skipping the midnight Off Duty padding."""
    stops = []
    for ev in events:
        if ev.status is Status.D or ev.kind is Kind.OFF_DUTY:
            continue
        d = ev.to_dict()
        d["mile"] = d.pop("miles_start")
        d.pop("miles_end")
        stops.append(d)
    return stops


def _arrival_before(events: Sequence[Event], kind: Kind, fallback) -> Optional[str]:
    """When the truck reached the stop: the end of the last drive before the first ``kind`` event."""
    arrived = fallback
    for ev in events:
        if ev.kind is kind:
            return arrived.isoformat()
        if ev.status is Status.D:
            arrived = ev.end
    return None


def build_summary(sim: TripSimulation, n_days: int) -> dict:
    """Return trip totals and how many of each rest type were taken."""
    events = sim.events
    drive_min = sum(e.minutes for e in events if e.status is Status.D)
    on_min = sum(e.minutes for e in events if e.status is Status.ON)
    count = {k: sum(1 for e in events if e.kind is k) for k in Kind}
    return {
        "total_miles": round(sim.total_miles, 1),
        "pickup_mile": round(sim.pickup_mile, 1),
        "total_driving_hours": round(drive_min / 60, 2),
        "total_on_duty_not_driving_hours": round(on_min / 60, 2),
        "total_trip_duration_hours": round((sim.end_of_duty - sim.start).total_seconds() / 3600, 2),
        "trip_start": sim.start.isoformat(),
        "pickup_arrival": _arrival_before(events, Kind.PICKUP, sim.start),
        "dropoff_arrival": _arrival_before(events, Kind.DROPOFF, sim.start),
        "trip_end": sim.end_of_duty.isoformat(),
        "number_of_days": n_days,
        "breaks_30min": count[Kind.BREAK],
        "resets_10hr": count[Kind.RESET],
        "restarts_34hr": count[Kind.RESTART],
        "fuel_stops": count[Kind.FUEL],
        "cycle_used_start": sim.cycle_used_hours,
    }
