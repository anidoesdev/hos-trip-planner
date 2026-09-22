"""Forward geocoding and "City, ST" formatting.

Provider order: OpenRouteService (if ``ORS_API_KEY`` is set), then Nominatim, then Photon.
Results are cached in memory for the life of the process.
"""

from __future__ import annotations

import logging
import re
import threading
from dataclasses import dataclass
from typing import Callable, Optional

from django.conf import settings

from .errors import LocationNotFound, TripPlanningError
from .http import NOMINATIM_LIMITER, ORS_LIMITER, PHOTON_LIMITER, request_json

log = logging.getLogger(__name__)

STATE_ABBR = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR", "california": "CA",
    "colorado": "CO", "connecticut": "CT", "delaware": "DE", "district of columbia": "DC",
    "florida": "FL", "georgia": "GA", "hawaii": "HI", "idaho": "ID", "illinois": "IL",
    "indiana": "IN", "iowa": "IA", "kansas": "KS", "kentucky": "KY", "louisiana": "LA",
    "maine": "ME", "maryland": "MD", "massachusetts": "MA", "michigan": "MI", "minnesota": "MN",
    "mississippi": "MS", "missouri": "MO", "montana": "MT", "nebraska": "NE", "nevada": "NV",
    "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
    "north carolina": "NC", "north dakota": "ND", "ohio": "OH", "oklahoma": "OK", "oregon": "OR",
    "pennsylvania": "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
    "tennessee": "TN", "texas": "TX", "utah": "UT", "vermont": "VT", "virginia": "VA",
    "washington": "WA", "west virginia": "WV", "wisconsin": "WI", "wyoming": "WY",
    "puerto rico": "PR", "alberta": "AB", "british columbia": "BC", "manitoba": "MB",
    "new brunswick": "NB", "newfoundland and labrador": "NL", "nova scotia": "NS",
    "ontario": "ON", "prince edward island": "PE", "quebec": "QC", "québec": "QC",
    "saskatchewan": "SK",
}

ORS_GEOCODE_URL = "https://api.openrouteservice.org/geocode/search"
NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search"
PHOTON_SEARCH_URL = "https://photon.komoot.io/api/"
_COORD_RE = re.compile(r"^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$")


@dataclass(frozen=True)
class GeoPoint:
    lat: float
    lng: float
    label: str

    def to_dict(self) -> dict:
        return {"lat": self.lat, "lng": self.lng, "label": self.label}


def state_abbr(state: Optional[str], iso_code: Optional[str] = None) -> Optional[str]:
    """Return a 2-letter state/province code from an ISO 3166-2 code ("US-IL") or a full name."""
    if iso_code and "-" in iso_code:
        return iso_code.split("-", 1)[1].upper()
    if not state:
        return None
    if len(state) == 2 and state.isalpha():
        return state.upper()
    return STATE_ABBR.get(state.strip().lower(), state)


def city_state(city: Optional[str], state: Optional[str], fallback: str = "") -> str:
    parts = [p for p in (city, state) if p]
    return ", ".join(parts) if parts else fallback


def _nominatim_city(address: dict) -> Optional[str]:
    for key in ("city", "town", "village", "hamlet", "municipality", "suburb", "county"):
        if address.get(key):
            return address[key]
    return None


# ---- providers -------------------------------------------------------------

def _ors_geocode(text: str) -> Optional[GeoPoint]:
    data = request_json("GET", ORS_GEOCODE_URL, service="OpenRouteService geocoder", limiter=ORS_LIMITER,
                        params={"api_key": settings.ORS_API_KEY, "text": text, "size": 1,
                                "boundary.country": settings.GEOCODE_COUNTRY_CODES.upper()})
    feats = data.get("features") or []
    if not feats:
        return None
    f = feats[0]
    lng, lat = f["geometry"]["coordinates"]
    p = f.get("properties", {})
    label = city_state(p.get("locality") or p.get("name"), p.get("region_a") or state_abbr(p.get("region")),
                       p.get("label", text))
    return GeoPoint(lat, lng, label)


def _nominatim_geocode(text: str) -> Optional[GeoPoint]:
    data = request_json("GET", NOMINATIM_SEARCH_URL, service="Nominatim", limiter=NOMINATIM_LIMITER,
                        params={"q": text, "format": "jsonv2", "limit": 1, "addressdetails": 1,
                                "countrycodes": settings.GEOCODE_COUNTRY_CODES})
    if not data:
        return None
    r = data[0]
    addr = r.get("address", {})
    label = city_state(_nominatim_city(addr) or r.get("name"),
                       state_abbr(addr.get("state"), addr.get("ISO3166-2-lvl4")), r.get("display_name", text))
    return GeoPoint(float(r["lat"]), float(r["lon"]), label)


def _photon_geocode(text: str) -> Optional[GeoPoint]:
    data = request_json("GET", PHOTON_SEARCH_URL, service="Photon", limiter=PHOTON_LIMITER,
                        params={"q": text, "limit": 5, "lang": "en"})
    allowed = {c.strip().upper() for c in settings.GEOCODE_COUNTRY_CODES.split(",") if c.strip()}
    for f in data.get("features") or []:
        p = f.get("properties", {})
        if allowed and (p.get("countrycode") or "").upper() not in allowed:
            continue
        lng, lat = f["geometry"]["coordinates"]
        label = city_state(p.get("city") or p.get("name"), state_abbr(p.get("state")), text)
        return GeoPoint(lat, lng, label)
    return None


def _providers() -> list[tuple[str, Callable[[str], Optional[GeoPoint]]]]:
    providers: list[tuple[str, Callable[[str], Optional[GeoPoint]]]] = []
    if settings.ORS_API_KEY:
        providers.append(("ors", _ors_geocode))
    providers += [("nominatim", _nominatim_geocode), ("photon", _photon_geocode)]
    return providers


_cache: dict[str, GeoPoint] = {}
_cache_lock = threading.Lock()


def geocode(text: str, field: Optional[str] = None) -> GeoPoint:
    """Turn free text (or a "lat, lng" string) into a point with a "City, ST" label.

    Raises ``LocationNotFound`` if no provider finds a match, or ``UpstreamUnavailable``
    / ``UpstreamTimeout`` if every provider fails.
    """
    key = " ".join(text.lower().split())
    with _cache_lock:
        if key in _cache:
            return _cache[key]
    m = _COORD_RE.match(text)
    if m:
        from .reverse_geocode import reverse_label  # local import avoids a cycle

        lat, lng = float(m.group(1)), float(m.group(2))
        if not (-90 <= lat <= 90 and -180 <= lng <= 180):
            raise LocationNotFound(f"coordinates out of range: {text}", field)
        point = GeoPoint(lat, lng, reverse_label(lat, lng) or text.strip())
    else:
        point = _geocode_with_fallback(text, field)
    with _cache_lock:
        _cache[key] = point
    return point


def _geocode_with_fallback(text: str, field: Optional[str]) -> GeoPoint:
    last_error: Optional[TripPlanningError] = None
    answered = False
    for name, provider in _providers():
        try:
            point = provider(text)
            answered = True
            if point is not None:
                return point
        except TripPlanningError as exc:
            log.warning("geocoder %s failed for %r: %s", name, text, exc)
            last_error = exc
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            log.warning("geocoder %s returned unexpected data for %r: %s", name, text, exc)
    if answered or last_error is None:
        raise LocationNotFound(f"location not found: {text!r}", field)
    raise last_error
