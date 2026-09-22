"""API tests with every external geo call mocked out."""

import pytest
from rest_framework.test import APIClient

from trips.services import planner
from trips.services.errors import LocationNotFound, UpstreamTimeout
from trips.services.geocoding import GeoPoint
from trips.services.routing import RouteLeg, RouteResult

POINTS = {
    "current_location": GeoPoint(41.8781, -87.6298, "Chicago, IL"),
    "pickup_location": GeoPoint(32.7767, -96.7970, "Dallas, TX"),
    "dropoff_location": GeoPoint(34.0522, -118.2437, "Los Angeles, CA"),
}
BODY = {"current_location": "Chicago, IL", "pickup_location": "Dallas, TX",
        "dropoff_location": "Los Angeles, CA", "current_cycle_used": 20}


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture
def fake_geo(monkeypatch):
    coords = [(41.8781, -87.6298), (37.0, -92.0), (32.7767, -96.7970), (33.5, -107.0), (34.0522, -118.2437)]
    route = RouteResult("fake", coords, [0, 2, 4], [RouteLeg(925.0, 840.0), RouteLeg(1435.0, 1290.0)])
    monkeypatch.setattr(planner, "geocode_all", lambda texts: POINTS)
    monkeypatch.setattr(planner, "get_route", lambda pts: route)
    monkeypatch.setattr(planner, "label_points", lambda pts: [f"Town{i}, ST" for i, _ in enumerate(pts)])


def test_health(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200 and resp.json() == {"status": "ok"}


def test_plan_success_shape(client, fake_geo):
    resp = client.post("/api/trip/plan", {**BODY, "start_datetime": "2026-09-22T06:00:00"}, format="json")
    assert resp.status_code == 200, resp.content
    data = resp.json()
    assert set(data) >= {"route", "events", "stops", "daily_logs", "summary", "compliance"}
    assert data["route"]["total_miles"] == 2360.0
    assert len(data["route"]["legs"]) == 2
    assert data["compliance"]["ok"] is True
    assert data["summary"]["fuel_stops"] >= 2
    assert all(e["location_label"] for e in data["events"])
    assert all(round(sum(d["totals_hours"].values()), 2) == 24.0 for d in data["daily_logs"])
    assert all(d["compliance"] == {"ok": True, "violations": []} for d in data["daily_logs"])
    assert data["events"][1]["start"] == "2026-09-22T06:00:00"


def test_plan_aware_datetime_converted_to_home_terminal(client, fake_geo, settings):
    settings.HOME_TERMINAL_TZ = "America/Chicago"
    resp = client.post("/api/trip/plan", {**BODY, "start_datetime": "2026-09-22T12:00:00Z"}, format="json")
    assert resp.status_code == 200
    assert resp.json()["input"]["start_datetime"] == "2026-09-22T07:00:00"


def test_plan_default_start_is_0600(client, fake_geo):
    resp = client.post("/api/trip/plan", BODY, format="json")
    assert resp.status_code == 200
    assert resp.json()["input"]["start_datetime"].endswith("T06:00:00")


@pytest.mark.parametrize("patch,field", [
    ({"current_cycle_used": 70.5}, "current_cycle_used"),
    ({"current_cycle_used": -1}, "current_cycle_used"),
    ({"pickup_location": "  "}, "pickup_location"),
    ({"dropoff_location": None}, "dropoff_location"),
    ({"start_datetime": "not-a-date"}, "start_datetime"),
])
def test_plan_validation_errors(client, patch, field):
    resp = client.post("/api/trip/plan", {**BODY, **patch}, format="json")
    assert resp.status_code == 400
    body = resp.json()
    assert body["error"] == "validation_error"
    assert field in body["fields"]


def test_missing_field(client):
    body = dict(BODY)
    body.pop("current_location")
    resp = client.post("/api/trip/plan", body, format="json")
    assert resp.status_code == 400 and "current_location" in resp.json()["fields"]


def test_location_not_found_is_422(client, monkeypatch):
    def boom(texts):
        raise LocationNotFound("location not found: 'Atlantis'", "pickup_location")

    monkeypatch.setattr(planner, "geocode_all", boom)
    resp = client.post("/api/trip/plan", BODY, format="json")
    assert resp.status_code == 422
    assert resp.json() == {"error": "location_not_found", "message": "location not found: 'Atlantis'",
                           "field": "pickup_location"}


def test_upstream_timeout_is_504(client, monkeypatch):
    def slow(texts):
        raise UpstreamTimeout("Nominatim did not respond in time")

    monkeypatch.setattr(planner, "geocode_all", slow)
    resp = client.post("/api/trip/plan", BODY, format="json")
    assert resp.status_code == 504 and resp.json()["error"] == "upstream_timeout"


def test_cors_header_for_configured_origin(client, settings):
    resp = client.get("/api/health", HTTP_ORIGIN="http://localhost:5173")
    assert resp["Access-Control-Allow-Origin"] == "http://localhost:5173"
