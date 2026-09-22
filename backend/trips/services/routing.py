"""Driving directions: OpenRouteService ``driving-hgv`` (truck profile), with the public OSRM server as fallback."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Sequence

from django.conf import settings

from .errors import RouteNotFound, TripPlanningError
from .geocoding import GeoPoint
from .http import ORS_LIMITER, request_json
from .polyline import LatLng, RouteLine, nearest_index

log = logging.getLogger(__name__)

METERS_PER_MILE = 1609.344
ORS_DIRECTIONS_URL = "https://api.openrouteservice.org/v2/directions/driving-hgv/geojson"
OSRM_ROUTE_URL = "https://router.project-osrm.org/route/v1/driving/"


@dataclass
class RouteLeg:
    miles: float
    duration_min: float


@dataclass
class RouteResult:
    provider: str
    coords: list[LatLng]  # full polyline as (lat, lng)
    leg_breaks: list[int]  # vertex index where each leg starts, plus the last index
    legs: list[RouteLeg]

    @property
    def total_miles(self) -> float:
        return sum(leg.miles for leg in self.legs)

    def line(self) -> RouteLine:
        return RouteLine(self.coords, self.leg_breaks, [leg.miles for leg in self.legs])


def _ors_route(points: Sequence[GeoPoint]) -> RouteResult:
    data = request_json(
        "POST", ORS_DIRECTIONS_URL, service="OpenRouteService directions", limiter=ORS_LIMITER,
        headers={"Authorization": settings.ORS_API_KEY, "Content-Type": "application/json",
                 "Accept": "application/geo+json, application/json"},  # /geojson rejects a bare application/json (406)
        # ORS only returns per-leg "segments" when instructions are enabled.
        json={"coordinates": [[p.lng, p.lat] for p in points], "instructions": True},
    )
    feat = (data.get("features") or [None])[0]
    if not feat:
        raise RouteNotFound("no drivable route between these locations")
    coords = [(lat, lng) for lng, lat, *_ in feat["geometry"]["coordinates"]]
    props = feat["properties"]
    segments = props.get("segments") or []
    if len(segments) != len(points) - 1:
        raise RouteNotFound("routing service returned an incomplete route")
    legs = [RouteLeg(s.get("distance", 0) / METERS_PER_MILE, s.get("duration", 0) / 60) for s in segments]
    return RouteResult("openrouteservice:driving-hgv", coords, list(props["way_points"]), legs)


def _leg_breaks_by_nearest(coords: list[LatLng], waypoints: Sequence[LatLng]) -> list[int]:
    """Find each intermediate waypoint's vertex, searching forward so a route that doubles back maps correctly."""
    breaks = [0]
    for wp in waypoints[1:-1]:
        lo = breaks[-1]
        breaks.append(lo + nearest_index(coords[lo:], wp))
    breaks.append(len(coords) - 1)
    return breaks


def _osrm_route(points: Sequence[GeoPoint]) -> RouteResult:
    path = ";".join(f"{p.lng:.6f},{p.lat:.6f}" for p in points)
    data = request_json("GET", OSRM_ROUTE_URL + path, service="OSRM", allow_status=(400,),
                        params={"overview": "full", "geometries": "geojson", "steps": "false"})
    if data.get("code") != "Ok" or not data.get("routes"):
        raise RouteNotFound(f"no drivable route between these locations ({data.get('code', 'unknown')})")
    route = data["routes"][0]
    coords = [(lat, lng) for lng, lat in route["geometry"]["coordinates"]]
    legs = [RouteLeg(leg["distance"] / METERS_PER_MILE, leg["duration"] / 60) for leg in route["legs"]]
    snapped = [(w["location"][1], w["location"][0]) for w in data.get("waypoints", [])]
    if len(snapped) != len(points):
        snapped = [(p.lat, p.lng) for p in points]
    return RouteResult("osrm:driving", coords, _leg_breaks_by_nearest(coords, snapped), legs)


def get_route(points: Sequence[GeoPoint]) -> RouteResult:
    """Route through ``points`` in order and return the polyline plus per-leg miles and minutes.

    Raises ``RouteNotFound`` when no provider can connect the points, or
    ``UpstreamUnavailable`` / ``UpstreamTimeout`` when every provider fails.
    """
    providers = ([("ors", _ors_route)] if settings.ORS_API_KEY else []) + [("osrm", _osrm_route)]
    last_error: TripPlanningError | None = None
    for name, provider in providers:
        try:
            return provider(points)
        except TripPlanningError as exc:
            log.warning("router %s failed: %s", name, exc)
            last_error = exc
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            log.warning("router %s returned unexpected data: %s", name, exc)
            last_error = RouteNotFound("routing service returned an unexpected response")
    assert last_error is not None
    raise last_error
