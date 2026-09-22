"""Independent HOS compliance checker.

This module re-derives every clock from the finished event list rather than
reusing the engine's state, so it can catch engine bugs. The tests call it, and
the API returns its result as ``compliance`` so the frontend can show a badge.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Optional, Sequence

from .engine import EngineConfig, Event, Kind, Status

EPS_MILES = 1e-6


@dataclass
class Violation:
    rule: str
    cfr: str
    at: str
    message: str


@dataclass
class ValidationResult:
    ok: bool
    violations: list[Violation] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {"ok": self.ok, "violations": [asdict(v) for v in self.violations]}


def _check_contiguous(events: Sequence[Event], out: list[Violation]) -> None:
    for prev, cur in zip(events, events[1:]):
        if cur.start != prev.end:
            out.append(Violation("timeline", "§395.8", cur.start.isoformat(),
                                 f"gap/overlap between {prev.end.isoformat()} and {cur.start.isoformat()}"))
    for ev in events:
        if ev.end <= ev.start:
            out.append(Violation("timeline", "§395.8", ev.start.isoformat(), "non-positive duration event"))


def _check_duty_limits(events: Sequence[Event], cfg: EngineConfig, cycle_used_hours: float,
                       out: list[Violation]) -> None:
    """Check the 14-h window, 11-h driving, 8-h break and 70-h cycle for every driving event."""
    window_start = None
    drive_in_window = 0
    drive_since_break = 0
    nondrive = 0
    rest = cfg.reset_min  # the driver is assumed rested before the trip
    cycle = round(cycle_used_hours * 60)

    for ev in events:
        m = ev.minutes
        if ev.status in (Status.OFF, Status.SB):
            rest += m
            nondrive += m
            if rest >= cfg.reset_min:
                window_start, drive_in_window = None, 0
            if rest >= cfg.restart_min:
                cycle = 0
        else:
            rest = 0
            if window_start is None:
                window_start = ev.start
            cycle += m
        if ev.status is Status.ON:
            nondrive += m
        if ev.status is not Status.D and nondrive >= cfg.break_min:
            drive_since_break = 0
        if ev.status is not Status.D:
            continue

        nondrive = 0
        drive_in_window += m
        drive_since_break += m
        at = ev.start.isoformat()
        window_end_min = (ev.end - window_start).total_seconds() / 60
        if window_end_min > cfg.window_min:
            out.append(Violation("14-hour window", "§395.3(a)(2)", at,
                                 f"driving until hour {window_end_min / 60:.2f} of the duty window"))
        if drive_in_window > cfg.max_driving_min:
            out.append(Violation("11-hour driving", "§395.3(a)(3)", at,
                                 f"{drive_in_window / 60:.2f} h driving in one window"))
        if drive_since_break > cfg.break_after_driving_min:
            out.append(Violation("30-minute break", "§395.3(a)(3)(ii)", at,
                                 f"{drive_since_break / 60:.2f} h driving without a 30-min break"))
        if cycle > cfg.cycle_limit_min:
            out.append(Violation("70-hour/8-day", "§395.3(b)", at,
                                 f"driving with {cycle / 60:.2f} h on duty in the cycle"))


def _check_fuel(events: Sequence[Event], cfg: EngineConfig, out: list[Violation]) -> None:
    since_fuel = 0.0
    for ev in events:
        if ev.kind is Kind.FUEL:
            since_fuel = 0.0
        elif ev.status is Status.D:
            since_fuel += ev.miles_end - ev.miles_start
            if since_fuel > cfg.fuel_interval_miles + EPS_MILES:
                out.append(Violation("fuel interval", "assessment", ev.start.isoformat(),
                                     f"{since_fuel:.1f} mi since last fuel"))


def _check_daily_logs(daily_logs: Sequence[dict], out: list[Violation]) -> None:
    for log in daily_logs:
        minutes = sum(log["totals_minutes"].values())
        hours = round(sum(log["totals_hours"].values()), 2)
        if minutes != 24 * 60 or hours != 24.00:
            out.append(Violation("24-hour total", "§395.8", log["date"],
                                 f"day totals {hours:.2f} h ({minutes} min), expected 24.00"))


def validate_plan(events: Sequence[Event], cycle_used_hours: float,
                  daily_logs: Optional[Sequence[dict]] = None,
                  config: EngineConfig = EngineConfig()) -> ValidationResult:
    """Check a trip plan against HOS limits and return every violation found."""
    violations: list[Violation] = []
    _check_contiguous(events, violations)
    _check_duty_limits(events, config, cycle_used_hours, violations)
    _check_fuel(events, config, violations)
    if daily_logs is not None:
        _check_daily_logs(daily_logs, violations)
    return ValidationResult(ok=not violations, violations=violations)
