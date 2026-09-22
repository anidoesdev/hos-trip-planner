"""Property tests: every generated plan must satisfy every HOS invariant.

The validator in ``hos.validator`` re-derives the clocks independently. On top of
that, these tests re-check each invariant directly so a validator bug cannot
hide an engine bug.
"""

import itertools
from datetime import datetime, timedelta

import pytest

from hos.daily_logs import build_daily_logs
from hos.engine import EngineConfig, Kind, Status, simulate_trip
from hos.validator import validate_plan

from .helpers import fake_legs

MILES = [30, 200, 600, 1100, 2500, 3300]
CYCLES = [0, 20, 45, 65, 69.75, 70]
START_HOURS = [0, 6, 13, 22.5]
SPEEDS = [45, 62]
PICKUPS = [0, 180]

CASES = list(itertools.product(MILES, CYCLES, START_HOURS, SPEEDS, PICKUPS))


def _check_invariants(events, cycle_used, logs, cfg):
    window_start = None
    drive_in_window = 0
    drive_since_gap = 0
    gap = 0
    rest = cfg.reset_min
    cycle = cycle_used * 60
    since_fuel = 0.0

    for ev in events:
        m = ev.minutes
        assert m > 0
        if ev.status in (Status.OFF, Status.SB):
            rest += m
            if rest >= cfg.reset_min:
                window_start, drive_in_window = None, 0
            if rest >= cfg.restart_min:
                cycle = 0
        else:
            rest = 0
            window_start = window_start or ev.start
            cycle += m
        if ev.kind is Kind.FUEL:
            since_fuel = 0.0
        if ev.status is Status.D:
            gap = 0
            drive_in_window += m
            drive_since_gap += m
            since_fuel += ev.miles_end - ev.miles_start
            assert ev.end - window_start <= timedelta(hours=14), "driving after hour 14"
            assert drive_in_window <= 11 * 60, "more than 11 h driving in a window"
            assert drive_since_gap <= 8 * 60, "8 h driving without a 30-min gap"
            assert cycle <= 70 * 60 + 1e-9, "driving over the 70-h cycle"
            assert since_fuel <= cfg.fuel_interval_miles + 1e-6, "over 1,000 mi without fuel"
        else:
            gap += m
            if gap >= 30:
                drive_since_gap = 0

    for log in logs:
        assert sum(log["totals_minutes"].values()) == 1440
        assert round(sum(log["totals_hours"].values()), 2) == 24.00
        assert log["segments"][0]["start_minute"] == 0
        assert log["segments"][-1]["end_minute"] == 1440
        for a, b in zip(log["segments"], log["segments"][1:]):
            assert a["end_minute"] == b["start_minute"]


@pytest.mark.parametrize("miles,cycle,start_h,mph,pickup", CASES)
def test_plan_satisfies_all_hos_invariants(miles, cycle, start_h, mph, pickup):
    cfg = EngineConfig()
    start = datetime(2026, 9, 22) + timedelta(hours=start_h)
    sim = simulate_trip(fake_legs(miles, pickup_miles=pickup, mph=mph), cycle, start, cfg)
    logs = build_daily_logs(sim.events, cycle, cfg)

    result = validate_plan(sim.events, cycle, logs, cfg)
    assert result.ok, result.violations
    _check_invariants(sim.events, cycle, logs, cfg)

    # Contiguous from the first midnight to the last midnight.
    assert sim.events[0].start.time() == datetime.min.time()
    assert sim.events[-1].end.time() == datetime.min.time()
    for a, b in zip(sim.events, sim.events[1:]):
        assert a.end == b.start
    # Every mile is driven and every required stop is present.
    assert sim.total_miles == pytest.approx(miles, abs=1e-6)
    assert sum(1 for e in sim.events if e.kind is Kind.PICKUP) == 1
    assert sum(1 for e in sim.events if e.kind is Kind.DROPOFF) == 1
    assert sum(l["total_miles_driving_today"] for l in logs) == pytest.approx(miles, abs=0.5)
