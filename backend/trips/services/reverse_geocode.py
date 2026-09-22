"""Reverse geocoding of duty-status-change points to "City, ST" (guide p.17 Remarks).

* Providers: ORS (if keyed), then Photon nearest place, then Nominatim (zoom 13, which can fall back to the county).
* Dedupe: points within ``DEDUPE_MILES`` of an already-queued point share its label.
* Cache: in-process LRU keyed by coordinates rounded to 0.01 degrees (about 1 km).
* Concurrency: a small thread pool. Nominatim calls also go through a shared
  1 req/s limiter and send a User-Agent, per the Nominatim usage policy.
* Budget: points not resolved within ``REVERSE_GEOCODE_BUDGET_SECONDS`` get ``None``.
"""

from __future__ import annotations

import logging
import threading
import time
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor, wait
from typing import Optional, Sequence

from django.conf import settings

from .errors import TripPlanningError
from .geocoding import _nominatim_city, city_state, state_abbr
from .http import NOMINATIM_LIMITER, ORS_LIMITER, PHOTON_LIMITER, request_json
from .polyline import LatLng, haversine_miles

log = logging.getLogger(__name__)

ORS_REVERSE_URL = "https://api.openrouteservice.org/geocode/reverse"
NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse"
PHOTON_REVERSE_URL = "https://photon.komoot.io/reverse"
DEDUPE_MILES = 3.0
MAX_WORKERS = 4
CACHE_SIZE = 5000
PLACE_TYPES = {"city", "town", "village", "hamlet"}
PLACE_RADIUS_KM = 40
NEAR_MILES = 3.0
KM_TO_MILES = 0.621371

_cache: "OrderedDict[tuple[float, float], Optional[str]]" = OrderedDict()
_cache_lock = threading.Lock()


def _key(lat: float, lng: float) -> tuple[float, float]:
    return (round(lat, 2), round(lng, 2))


def _cache_get(key: tuple[float, float]) -> tuple[bool, Optional[str]]:
    with _cache_lock:
        if key in _cache:
            _cache.move_to_end(key)
            return True, _cache[key]
    return False, None


def _cache_put(key: tuple[float, float], label: Optional[str]) -> None:
    with _cache_lock:
        _cache[key] = label
        _cache.move_to_end(key)
        while len(_cache) > CACHE_SIZE:
            _cache.popitem(last=False)


def _ors_reverse(lat: float, lng: float) -> Optional[str]:
    data = request_json("GET", ORS_REVERSE_URL, service="OpenRouteService reverse", limiter=ORS_LIMITER,
                        # No "county" layer: its polygon contains the point (distance 0) and would
                        # beat the nearest town, which the Remarks section asks for (guide p.17).
                        params={"api_key": settings.ORS_API_KEY, "point.lat": lat, "point.lon": lng,
                                "size": 1, "layers": "locality,localadmin",
                                "boundary.circle.radius": PLACE_RADIUS_KM})
    feats = data.get("features") or []
    if not feats:
        return None
    p = feats[0].get("properties", {})
    label = city_state(p.get("locality") or p.get("localadmin") or p.get("name"),
                       p.get("region_a") or state_abbr(p.get("region")))
    if not label:
        return None
    far = (p.get("distance") or 0) * KM_TO_MILES > NEAR_MILES  # Pelias reports distance in km
    return f"near {label}" if far else label


def _nominatim_reverse(lat: float, lng: float) -> Optional[str]:
    data = request_json("GET", NOMINATIM_REVERSE_URL, service="Nominatim reverse", limiter=NOMINATIM_LIMITER,
                        params={"lat": lat, "lon": lng, "format": "jsonv2", "zoom": 13, "addressdetails": 1})
    addr = data.get("address") or {}
    if not addr:
        return None
    return city_state(_nominatim_city(addr), state_abbr(addr.get("state"), addr.get("ISO3166-2-lvl4"))) or None


def _photon_reverse(lat: float, lng: float) -> Optional[str]:
    """Nearest populated place. Photon sorts by distance, so rural points on an interstate
    still get a town (guide p.17: "name of the nearest city, town, or village")."""
    data = request_json("GET", PHOTON_REVERSE_URL, service="Photon reverse", limiter=PHOTON_LIMITER,
                        params={"lat": lat, "lon": lng, "limit": 8, "lang": "en",
                                "osm_tag": "place", "radius": PLACE_RADIUS_KM})
    for f in data.get("features") or []:
        p = f.get("properties", {})
        if p.get("osm_value") not in PLACE_TYPES or not p.get("name"):
            continue
        plng, plat = f["geometry"]["coordinates"]
        label = city_state(p["name"], state_abbr(p.get("state")))
        far = haversine_miles((lat, lng), (plat, plng)) > NEAR_MILES
        return f"near {label}" if far else label
    return None


def reverse_label(lat: float, lng: float) -> Optional[str]:
    """Return a "City, ST" label for one point, trying each provider in turn. Returns None if all fail."""
    key = _key(lat, lng)
    hit, label = _cache_get(key)
    if hit:
        return label
    providers = ([_ors_reverse] if settings.ORS_API_KEY else []) + [_photon_reverse, _nominatim_reverse]
    for provider in providers:
        try:
            label = provider(lat, lng)
        except TripPlanningError as exc:
            log.warning("reverse geocode %s failed: %s", provider.__name__, exc)
            continue
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            log.warning("reverse geocode %s returned unexpected data: %s", provider.__name__, exc)
            continue
        if label:
            _cache_put(key, label)
            return label
    return None


def label_points(points: Sequence[LatLng], budget_seconds: Optional[float] = None) -> list[Optional[str]]:
    """Reverse-geocode many points at once, with dedupe, caching, limited concurrency and a time budget."""
    budget = settings.REVERSE_GEOCODE_BUDGET_SECONDS if budget_seconds is None else budget_seconds
    reps: list[LatLng] = []  # one representative point per cluster
    owner: list[int] = []  # index into reps for every input point
    for p in points:
        for i, r in enumerate(reps):
            if haversine_miles(p, r) <= DEDUPE_MILES:
                owner.append(i)
                break
        else:
            reps.append(p)
            owner.append(len(reps) - 1)

    results: list[Optional[str]] = [None] * len(reps)
    if reps:
        deadline = time.monotonic() + budget
        pool = ThreadPoolExecutor(max_workers=MAX_WORKERS)
        futures = {pool.submit(reverse_label, lat, lng): i for i, (lat, lng) in enumerate(reps)}
        done, _pending = wait(futures, timeout=max(0.0, deadline - time.monotonic()))
        for fut in done:
            try:
                results[futures[fut]] = fut.result()
            except Exception as exc:  # noqa: BLE001 - a failed label must not fail the whole plan
                log.warning("reverse geocode worker failed: %s", exc)
        pool.shutdown(wait=False, cancel_futures=True)
    return [results[o] for o in owner]
