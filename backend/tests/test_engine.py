"""Scenario tests for the HOS engine (fake routes, no network)."""

from datetime import datetime, timedelta

import pytest

from hos.daily_logs import build_daily_logs, round_hours_to_total
from hos.engine import EngineConfig, Event, Kind, Leg, Status, default_start, simulate_trip
from hos.report import build_stops, build_summary
from hos.validator import validate_plan

from .helpers import START, fake_legs


def run(total_miles, cycle=0.0, start=START, config=EngineConfig(), **kw):
    sim = simulate_trip(fake_legs(total_miles, **kw), cycle, start, config)
    logs = build_daily_logs(sim.events, cycle, config)
    result = validate_plan(sim.events, cycle, logs, config)
    assert result.ok, result.violations
    return sim, logs


def kinds(sim):
    return [e.kind for e in sim.events]


def driving_hours_before_first(sim, kind):
    total = 0
    for e in sim.events:
        if e.kind is kind:
            return total / 60
        if e.status is Status.D:
            total += e.minutes
    return None


# ---- required scenarios ---------------------------------------------------------

def test_short_trip_200mi_has_no_reset_and_24h_days():
    sim, logs = run(200, cycle=0)
    assert Kind.RESET not in kinds(sim)
    assert Kind.RESTART not in kinds(sim)
    assert len(logs) == 1
    for log in logs:
        assert sum(log["totals_minutes"].values()) == 1440
        assert round(sum(log["totals_hours"].values()), 2) == 24.00
    assert logs[0]["total_miles_driving_today"] == pytest.approx(200, abs=0.1)


def test_600mi_break_before_8h_and_reset_at_11h_or_14h():
    # 20 mi to pickup, then 580 mi at 50 mph -> 12 h driving, so a 10-h reset is needed.
    sim, logs = run(600, cycle=0, pickup_miles=20, mph=50)
    ev = sim.events

    brk = next(e for e in ev if e.kind is Kind.BREAK)
    assert brk.minutes == 30
    # 8 h of driving since the last 30-min non-driving gap (the 1-h pickup) at most.
    assert driving_hours_before_first(sim, Kind.BREAK) <= 8.0 + 20 / 50

    reset = next(e for e in ev if e.kind is Kind.RESET)
    assert reset.status is Status.SB and reset.minutes == 600
    window_start = next(e.start for e in ev if e.status in (Status.ON, Status.D))
    drive_before_reset = sum(e.minutes for e in ev if e.status is Status.D and e.end <= reset.start) / 60
    assert drive_before_reset == pytest.approx(11.0)  # the 11-h limit binds first here
    assert reset.start - window_start <= timedelta(hours=14)
    assert len(logs) == 2


def test_14h_window_binds_before_11h_driving():
    # A 3-hour pickup uses up the window, so the 14-h limit binds before 11 h of driving.
    cfg = EngineConfig(pickup_min=180)
    sim, _ = run(700, cycle=0, config=cfg, pickup_miles=100, mph=50)
    ev = sim.events
    reset = next(e for e in ev if e.kind is Kind.RESET)
    window_start = next(e.start for e in ev if e.status in (Status.ON, Status.D))
    drive_before = sum(e.minutes for e in ev if e.status is Status.D and e.end <= reset.start) / 60
    last_drive = max(e.end for e in ev if e.status is Status.D and e.end <= reset.start)
    assert drive_before < 11
    assert last_drive == window_start + timedelta(hours=14)


def test_2500mi_fuel_stops_and_multiple_days():
    sim, logs = run(2500, cycle=0)
    fuel = [e for e in sim.events if e.kind is Kind.FUEL]
    assert len(fuel) >= 2
    assert all(f.status is Status.ON and f.minutes == 30 for f in fuel)
    since = 0.0
    for e in sim.events:
        if e.kind is Kind.FUEL:
            since = 0.0
        elif e.status is Status.D:
            since += e.miles_end - e.miles_start
            assert since <= 1000 + 1e-6
    assert len(logs) >= 3
    assert sum(l["total_miles_driving_today"] for l in logs) == pytest.approx(2500, abs=0.5)


def test_1000mi_cycle_65_triggers_34h_restart():
    sim, logs = run(1000, cycle=65)
    restarts = [e for e in sim.events if e.kind is Kind.RESTART]
    assert len(restarts) == 1
    assert restarts[0].status is Status.OFF and restarts[0].minutes == 34 * 60
    # Only 5 h of cycle were left, so driving before the restart must be <= 5 h minus on-duty work.
    on_before = sum(e.minutes for e in sim.events
                    if e.status in (Status.D, Status.ON) and e.end <= restarts[0].start)
    assert on_before <= 5 * 60
    assert any(l["recap"]["restart_taken"] for l in logs)


# ---- extra behaviour --------------------------------------------------------------

def test_pickup_hour_satisfies_30min_break():
    # 7 h to pickup, then 7 h more: the 1-h pickup resets the 8-h clock, so no separate break.
    sim, _ = run(14 * 50, cycle=0, pickup_miles=7 * 50, mph=50)
    first_reset = next((e for e in sim.events if e.kind is Kind.RESET), None)
    breaks_before_reset = [e for e in sim.events if e.kind is Kind.BREAK
                           and (first_reset is None or e.start < first_reset.start)]
    assert breaks_before_reset == []


def test_fuel_combined_with_break_when_tank_mostly_used():
    cfg = EngineConfig(fuel_interval_miles=500)  # a tank is >75% used at the 8-h mark (440 mi)
    sim, _ = run(900, config=cfg, pickup_miles=0, mph=55)
    first_stop = next(e for e in sim.events if e.kind in (Kind.BREAK, Kind.FUEL))
    assert first_stop.kind is Kind.FUEL


def test_fuel_topped_off_at_pickup_when_tank_mostly_used():
    # 900 mi to pickup: fuel at the pickup instead of stopping again 100 mi later.
    sim, _ = run(1500, pickup_miles=900, mph=60)
    pickup_i = next(i for i, e in enumerate(sim.events) if e.kind is Kind.PICKUP)
    assert sim.events[pickup_i - 1].kind is Kind.FUEL
    assert sim.events[pickup_i - 1].miles_start == pytest.approx(900)


def test_no_opportunistic_fuel_when_disabled():
    cfg = EngineConfig(opportunistic_fuel=False)
    sim, _ = run(1500, config=cfg, pickup_miles=900, mph=60)
    fuel = [e for e in sim.events if e.kind is Kind.FUEL]
    assert [round(f.miles_start) for f in fuel] == [1000]


def test_cycle_exhausted_at_start_restarts_before_driving():
    sim, _ = run(300, cycle=70)
    first_drive = next(e for e in sim.events if e.status is Status.D)
    restart = next(e for e in sim.events if e.kind is Kind.RESTART)
    assert restart.end <= first_drive.start


def test_current_equals_pickup_zero_length_leg():
    sim, logs = run(300, pickup_miles=0)
    pickup = next(e for e in sim.events if e.kind is Kind.PICKUP)
    assert pickup.miles_start == 0
    assert pickup.location_label == "Pickup, IL"


def test_late_start_crosses_midnight_and_pads_both_ends():
    sim, logs = run(400, start=datetime(2026, 9, 22, 22, 0))
    assert sim.events[0].start == datetime(2026, 9, 22, 0, 0)
    assert sim.events[0].status is Status.OFF
    assert sim.events[-1].end.time() == datetime.min.time()
    assert len(logs) == 2
    assert all(sum(l["totals_minutes"].values()) == 1440 for l in logs)


def test_inspections_toggle():
    on = simulate_trip(fake_legs(200), 0, START, EngineConfig(inspections=True))
    off = simulate_trip(fake_legs(200), 0, START, EngineConfig(inspections=False))
    assert Kind.PRE_TRIP in kinds(on) and Kind.POST_TRIP in kinds(on)
    assert Kind.PRE_TRIP not in kinds(off) and Kind.POST_TRIP not in kinds(off)


def test_default_start_is_next_0600():
    assert default_start(datetime(2026, 9, 22, 5, 0)) == datetime(2026, 9, 22, 6, 0)
    assert default_start(datetime(2026, 9, 22, 6, 0)) == datetime(2026, 9, 22, 6, 0)
    assert default_start(datetime(2026, 9, 22, 6, 1)) == datetime(2026, 9, 23, 6, 0)


def test_daily_log_remarks_recap_and_locations():
    sim, logs = run(600, cycle=20, pickup_miles=20, mph=50)
    day1 = logs[0]
    assert day1["from_location"] == "Origin, IL"
    assert logs[-1]["to_location"] == "Destination, CA"
    notes = [r["note"] for r in day1["remarks"]]
    assert notes[:3] == ["Off duty", "Pre-trip inspection", "Driving"]
    assert "Pickup" in notes
    recap = day1["recap"]
    assert recap["on_duty_today"] == pytest.approx(
        (day1["totals_minutes"]["D"] + day1["totals_minutes"]["ON"]) / 60, abs=0.01)
    assert recap["cycle_total_hours"] == pytest.approx(20 + recap["on_duty_today"], abs=0.01)
    assert recap["hours_available_tomorrow"] == pytest.approx(70 - recap["cycle_total_hours"], abs=0.01)


def test_stops_and_summary():
    sim, logs = run(2500, cycle=10)
    stops = build_stops(sim.events)
    assert all(s["status"] != "D" and s["kind"] != "off_duty" for s in stops)
    summary = build_summary(sim, len(logs))
    assert summary["total_miles"] == pytest.approx(2500, abs=0.1)
    assert summary["fuel_stops"] == sum(1 for s in stops if s["kind"] == "fuel")
    assert summary["number_of_days"] == len(logs)
    last_drive_to_pickup = max(e.end for e in sim.events if e.status is Status.D and e.miles_end <= 50)
    assert summary["pickup_arrival"] == last_drive_to_pickup.isoformat()


def test_round_hours_to_total_uses_largest_remainder():
    out = round_hours_to_total({"OFF": 20, "SB": 20, "D": 20, "ON": 1380})
    assert round(sum(out.values()), 2) == 24.00


def test_input_validation():
    with pytest.raises(ValueError):
        simulate_trip(fake_legs(100), 71, START)
    with pytest.raises(ValueError):
        simulate_trip(fake_legs(100)[:1], 0, START)


# ---- the validator must actually catch violations -------------------------------------

def _ev(start_h, end_h, status, kind=Kind.DRIVE, m0=0.0, m1=0.0):
    t = datetime(2026, 9, 22)
    return Event(t + timedelta(hours=start_h), t + timedelta(hours=end_h), status, kind, m0, m1)


def test_validator_flags_11h_14h_8h_cycle_and_fuel():
    bad = [
        _ev(0, 6, Status.OFF, Kind.OFF_DUTY),
        _ev(6, 7, Status.ON, Kind.PICKUP),
        _ev(7, 16, Status.D, m0=0, m1=540),  # 9 h without a break -> 8-h rule
        _ev(16, 16.5, Status.OFF, Kind.BREAK),
        _ev(16.5, 21, Status.D, m0=540, m1=1100),  # 13.5 h driving; past hour 14; >1000 mi without fuel
        _ev(21, 24, Status.OFF, Kind.OFF_DUTY),
    ]
    rules = {v.rule for v in validate_plan(bad, 60).violations}
    assert {"11-hour driving", "14-hour window", "30-minute break", "70-hour/8-day", "fuel interval"} <= rules


def test_validator_flags_gaps_and_bad_day_totals():
    events = [_ev(0, 6, Status.OFF, Kind.OFF_DUTY), _ev(7, 24, Status.OFF, Kind.OFF_DUTY)]
    logs = [{"date": "2026-09-22", "totals_minutes": {"OFF": 1380}, "totals_hours": {"OFF": 23.0}}]
    rules = {v.rule for v in validate_plan(events, 0, logs).violations}
    assert {"timeline", "24-hour total"} <= rules
