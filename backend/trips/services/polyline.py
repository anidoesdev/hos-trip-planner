"""Pure geometry helpers: route distance along a polyline, point at a given mile, and simplification.

No Django imports. Coordinates are ``(lat, lng)`` tuples.
"""

from __future__ import annotations

import bisect
import math
from typing import Sequence

LatLng = tuple[float, float]
EARTH_RADIUS_MI = 3958.7613


def haversine_miles(a: LatLng, b: LatLng) -> float:
    lat1, lng1 = map(math.radians, a)
    lat2, lng2 = map(math.radians, b)
    h = (math.sin((lat2 - lat1) / 2) ** 2
         + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2)
    return 2 * EARTH_RADIUS_MI * math.asin(min(1.0, math.sqrt(h)))


class RouteLine:
    """A route polyline whose cumulative distance matches the router's reported miles for each leg.

    Great-circle length along the vertices is usually a little shorter than the
    router's road distance. Each leg's vertex distances are scaled so
    ``point_at(mile)`` agrees with the mileage the HOS engine uses.
    """

    def __init__(self, coords: Sequence[LatLng], leg_breaks: Sequence[int], leg_miles: Sequence[float]):
        """``leg_breaks`` holds the vertex index where each leg starts, plus the last index."""
        if len(coords) < 2:
            coords = list(coords) * 2 if coords else [(0.0, 0.0), (0.0, 0.0)]
        self.coords = list(coords)
        raw = [0.0]
        for a, b in zip(self.coords, self.coords[1:]):
            raw.append(raw[-1] + haversine_miles(a, b))
        self.cum = raw[:]
        offset = 0.0
        for i, miles in enumerate(leg_miles):
            lo, hi = leg_breaks[i], leg_breaks[i + 1]
            span = raw[hi] - raw[lo]
            scale = miles / span if span > 0 else 0.0
            for j in range(lo, hi + 1):
                self.cum[j] = offset + (raw[j] - raw[lo]) * scale if span > 0 else offset
            offset += miles
        self.total_miles = offset

    def point_at(self, mile: float) -> LatLng:
        """Return the linearly interpolated (lat, lng) at ``mile`` along the route (clamped to the ends)."""
        if mile <= 0:
            return self.coords[0]
        if mile >= self.cum[-1]:
            return self.coords[-1]
        i = bisect.bisect_right(self.cum, mile)
        m0, m1 = self.cum[i - 1], self.cum[i]
        f = (mile - m0) / (m1 - m0) if m1 > m0 else 0.0
        (la0, ln0), (la1, ln1) = self.coords[i - 1], self.coords[i]
        return (la0 + (la1 - la0) * f, ln0 + (ln1 - ln0) * f)


def nearest_index(coords: Sequence[LatLng], target: LatLng) -> int:
    """Return the index of the vertex closest to ``target``."""
    return min(range(len(coords)), key=lambda i: (coords[i][0] - target[0]) ** 2
               + ((coords[i][1] - target[1]) * math.cos(math.radians(target[0]))) ** 2)


def simplify(coords: Sequence[LatLng], tolerance: float = 0.0008) -> list[LatLng]:
    """Iterative Ramer-Douglas-Peucker in degrees (~90 m at the default), which keeps responses small."""
    n = len(coords)
    if n < 3:
        return list(coords)
    keep = [False] * n
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        lo, hi = stack.pop()
        (ay, ax), (by, bx) = coords[lo], coords[hi]
        dx, dy = bx - ax, by - ay
        norm = math.hypot(dx, dy)
        best, best_i = -1.0, -1
        for i in range(lo + 1, hi):
            py, px = coords[i]
            if norm == 0:
                d = math.hypot(px - ax, py - ay)
            else:
                d = abs(dy * px - dx * py + bx * ay - by * ax) / norm
            if d > best:
                best, best_i = d, i
        if best > tolerance and best_i > 0:
            keep[best_i] = True
            stack.append((lo, best_i))
            stack.append((best_i, hi))
    return [c for c, k in zip(coords, keep) if k]
