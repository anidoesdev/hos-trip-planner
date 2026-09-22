"""Split an event timeline into Driver's Daily Log sheets (one per calendar day).

Follows guide pp.15-17 (§395.8): a 24-hour grid starting at midnight, total hours
for each duty status that sum to 24, total miles driven today, and remarks giving
the "City, ST" of every change of duty status. The recap uses the 70-hour/8-day
columns of the blank log: on duty today (lines 3 + 4), the running cycle total
(A), and hours available tomorrow (B = 70 - A).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Optional, Sequence

from .engine import EngineConfig, Event, Kind, Status

STATUSES = (Status.OFF, Status.SB, Status.D, Status.ON)
DAY_MIN = 24 * 60


@dataclass
class _Piece:
    """The part of one event that falls within a single calendar day."""

    event_index: int
    start: datetime
    end: datetime
    miles_start: float
    miles_end: float

    @property
    def minutes(self) -> int:
        return int((self.end - self.start).total_seconds() // 60)


def _split_at_midnights(events: Sequence[Event]) -> dict[date, list[_Piece]]:
    """Cut every event at midnight and interpolate driving miles linearly in time."""
    days: dict[date, list[_Piece]] = {}
    for i, ev in enumerate(events):
        cursor = ev.start
        total = (ev.end - ev.start).total_seconds()
        while cursor < ev.end:
            midnight = datetime.combine(cursor.date() + timedelta(days=1), time(0, 0))
            piece_end = min(ev.end, midnight)
            f0 = (cursor - ev.start).total_seconds() / total
            f1 = (piece_end - ev.start).total_seconds() / total
            span = ev.miles_end - ev.miles_start
            days.setdefault(cursor.date(), []).append(
                _Piece(i, cursor, piece_end, ev.miles_start + span * f0, ev.miles_start + span * f1))
            cursor = piece_end
    return days


def round_hours_to_total(minutes_by_status: dict[str, int], total_hours: float = 24.0) -> dict[str, float]:
    """Round each status to 0.01 h so the rounded values still add up to exactly ``total_hours``.

    Uses largest-remainder rounding, so values like 20 min (0.333 h) x 3 cannot
    leave the sheet at 23.99 or 24.01.
    """
    target = round(total_hours * 100)
    exact = {k: v * 100 / 60 for k, v in minutes_by_status.items()}
    floored = {k: int(v) for k, v in exact.items()}
    shortfall = target - sum(floored.values())
    order = sorted(exact, key=lambda k: exact[k] - floored[k], reverse=True)
    for k in order[:max(0, shortfall)]:
        floored[k] += 1
    return {k: v / 100 for k, v in floored.items()}


def _location_at_day_start(events: Sequence[Event], piece: _Piece) -> Optional[str]:
    return events[piece.event_index].location_label


def _location_at_day_end(events: Sequence[Event], piece: _Piece) -> Optional[str]:
    """If the day ends while driving, return where that drive ends (the next event's location)."""
    ev = events[piece.event_index]
    if ev.status is Status.D and piece.event_index + 1 < len(events):
        return events[piece.event_index + 1].location_label
    return ev.location_label


def build_daily_logs(events: Sequence[Event], cycle_used_hours: float,
                     config: EngineConfig = EngineConfig()) -> list[dict]:
    """Build one log-sheet dict for each calendar day covered by ``events``.

    ``events`` must be contiguous and start and end at midnight (``simulate_trip`` does this).
    """
    days = _split_at_midnights(events)
    cycle_min = round(cycle_used_hours * 60)
    rest_streak = 0
    restart_taken = False
    logs: list[dict] = []

    for day_no, day in enumerate(sorted(days), start=1):
        pieces = days[day]
        midnight = datetime.combine(day, time(0, 0))
        minutes = {s.value: 0 for s in STATUSES}
        segments: list[dict] = []
        remarks: list[dict] = []
        miles_today = 0.0

        for p in pieces:
            ev = events[p.event_index]
            minutes[ev.status.value] += p.minutes
            if ev.status is Status.D:
                miles_today += p.miles_end - p.miles_start
            start_min = int((p.start - midnight).total_seconds() // 60)
            segments.append({
                "status": ev.status.value,
                "kind": ev.kind.value,
                "note": ev.note,
                "start_minute": start_min,
                "end_minute": start_min + p.minutes,
                "start": p.start.isoformat(),
                "end": p.end.isoformat(),
                "location_label": ev.location_label,
            })
            # A remark goes at every real change of duty status (guide p.17), not at midnight splits.
            if p.start == ev.start:
                remarks.append({
                    "time": p.start.strftime("%H:%M"),
                    "minute": start_min,
                    "status": ev.status.value,
                    "location": ev.location_label,
                    "note": ev.note,
                })
            # Running 70/8 total: on-duty time adds; 34 consecutive h off/SB zeroes it (§395.3(c)).
            if ev.status in (Status.D, Status.ON):
                cycle_min += p.minutes
                rest_streak = 0
            else:
                rest_streak += p.minutes
                if rest_streak >= config.restart_min and cycle_min:
                    cycle_min = 0
                    restart_taken = True

        total_minutes = sum(minutes.values())
        on_duty_today = (minutes[Status.D.value] + minutes[Status.ON.value]) / 60
        cycle_hours = cycle_min / 60
        limit_hours = config.cycle_limit_min / 60
        logs.append({
            "day_number": day_no,
            "date": day.isoformat(),
            "from_location": _location_at_day_start(events, pieces[0]),
            "to_location": _location_at_day_end(events, pieces[-1]),
            "total_miles_driving_today": round(miles_today, 1),
            "segments": segments,
            "totals_minutes": minutes,
            "totals_hours": round_hours_to_total(minutes, total_minutes / 60),
            "total_hours": round(total_minutes / 60, 2),
            "remarks": remarks,
            "recap": {
                "on_duty_today": round(on_duty_today, 2),  # lines 3 + 4
                "cycle_total_hours": round(cycle_hours, 2),  # A: 70/8 running total incl. today
                "hours_available_tomorrow": round(max(0.0, limit_hours - cycle_hours), 2),  # B
                "restart_taken": restart_taken,
                "cycle_used_prior": cycle_used_hours,
            },
        })
    return logs
