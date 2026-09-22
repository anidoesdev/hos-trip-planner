"""Router fallback and retry behaviour, with the providers stubbed out (no network)."""

import pytest

from trips.services import routing
from trips.services.errors import RouteNotFound, UpstreamUnavailable
from trips.services.geocoding import GeoPoint
from trips.services.routing import RouteLeg, RouteResult

POINTS = [GeoPoint(41.9, -87.6, "Chicago, IL"), GeoPoint(32.8, -96.8, "Dallas, TX"), GeoPoint(34.1, -118.2, "Los Angeles, CA")]
OK = RouteResult("stub", [(0.0, 0.0), (1.0, 1.0)], [0, 1, 1], [RouteLeg(10, 10), RouteLeg(0, 0)])


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch, settings):
    monkeypatch.setattr(routing.time, "sleep", lambda s: None)
    settings.ORS_API_KEY = "test-key"


def flaky(failures, error):
    calls = {"n": 0}

    def provider(points):
        calls["n"] += 1
        if calls["n"] <= failures:
            raise error
        return OK

    return provider, calls


def test_transient_failure_is_retried_once(monkeypatch):
    osrm, calls = flaky(1, UpstreamUnavailable("OSRM is unreachable: ConnectionError", transient=True))
    monkeypatch.setattr(routing, "_ors_route", flaky(99, UpstreamUnavailable("HTTP 403"))[0])
    monkeypatch.setattr(routing, "_osrm_route", osrm)
    assert routing.get_route(POINTS) is OK
    assert calls["n"] == 2


def test_permanent_failure_is_not_retried(monkeypatch):
    ors, ors_calls = flaky(99, UpstreamUnavailable("OpenRouteService directions returned HTTP 403"))
    monkeypatch.setattr(routing, "_ors_route", ors)
    monkeypatch.setattr(routing, "_osrm_route", flaky(0, None)[0])
    assert routing.get_route(POINTS) is OK
    assert ors_calls["n"] == 1  # a rejected key is not worth a second try


def test_no_route_is_not_retried(monkeypatch):
    osrm, calls = flaky(99, RouteNotFound("no drivable route"))
    monkeypatch.setattr(routing, "_ors_route", flaky(99, UpstreamUnavailable("HTTP 403"))[0])
    monkeypatch.setattr(routing, "_osrm_route", osrm)
    with pytest.raises(RouteNotFound):
        routing.get_route(POINTS)
    assert calls["n"] == 1


def test_gives_up_after_one_retry(monkeypatch):
    osrm, calls = flaky(99, UpstreamUnavailable("OSRM is unreachable: ConnectionError", transient=True))
    monkeypatch.setattr(routing, "_ors_route", flaky(99, UpstreamUnavailable("HTTP 403"))[0])
    monkeypatch.setattr(routing, "_osrm_route", osrm)
    with pytest.raises(UpstreamUnavailable):
        routing.get_route(POINTS)
    assert calls["n"] == 2
