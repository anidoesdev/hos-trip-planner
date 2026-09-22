"""Typed errors the API turns into clear JSON responses."""

from __future__ import annotations

from typing import Optional


class TripPlanningError(Exception):
    status_code = 500
    code = "trip_planning_error"

    def __init__(self, message: str, field: Optional[str] = None, transient: bool = False) -> None:
        super().__init__(message)
        self.message = message
        self.field = field
        # True for failures that may clear up on a retry (dropped connection, timeout, 5xx)
        self.transient = transient

    def to_dict(self) -> dict:
        body = {"error": self.code, "message": self.message}
        if self.field:
            body["field"] = self.field
        return body


class LocationNotFound(TripPlanningError):
    status_code = 422
    code = "location_not_found"


class RouteNotFound(TripPlanningError):
    status_code = 422
    code = "route_not_found"


class UpstreamUnavailable(TripPlanningError):
    status_code = 502
    code = "upstream_unavailable"


class UpstreamTimeout(TripPlanningError):
    status_code = 504
    code = "upstream_timeout"
