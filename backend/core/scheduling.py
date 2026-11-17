"""Schedule Frequency Calculator (AVTR_SPEC §7).

Pure date math: given a PromptSchedule's frequency/date-range/timezone,
compute every calendar date it fires on. No DB access, no side effects
-- reused by both the usage estimator (core/billing.py) and the Celery
dispatch task (core/tasks.py) so "when is this due" is calculated
exactly one way.
"""

from dataclasses import dataclass
from datetime import date, timedelta
from zoneinfo import ZoneInfo

ONCE = "once"
DAILY = "daily"
WEEKLY = "weekly"
MONTHLY = "monthly"
CUSTOM = "custom"


@dataclass(frozen=True)
class ScheduleDates:
    execution_dates: list[date]
    execution_count: int
    first_execution: date | None
    last_execution: date | None


def _days_in_month(year, month):
    next_month_first = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    return (next_month_first - timedelta(days=1)).day


def _add_months(d, months):
    """Calendar-correct month stepping -- Jan 31 + 1 month lands on Feb
    28/29 (clamped to the target month's real length), not an invalid
    Feb 31 or a rollover into March."""
    month_index = d.month - 1 + months
    year = d.year + month_index // 12
    month = month_index % 12 + 1
    day = min(d.day, _days_in_month(year, month))
    return date(year, month, day)


def calculate_schedule_dates(*, frequency, start_date, end_date, timezone="UTC", custom_interval_days=None):
    """Every date the schedule fires on, start_date..end_date inclusive.
    `timezone` is validated (a bad IANA name fails loudly here rather
    than silently at execution time) -- the calculation itself works in
    calendar dates already anchored to that timezone by the caller
    (PromptSchedule.start_date/end_date are dates, not instants)."""
    ZoneInfo(timezone)  # raises ZoneInfoNotFoundError for a bad name

    if end_date < start_date:
        return ScheduleDates(execution_dates=[], execution_count=0, first_execution=None, last_execution=None)

    dates: list[date] = []
    if frequency == ONCE:
        dates = [start_date]
    elif frequency == DAILY:
        d = start_date
        while d <= end_date:
            dates.append(d)
            d += timedelta(days=1)
    elif frequency == WEEKLY:
        d = start_date
        while d <= end_date:
            dates.append(d)
            d += timedelta(days=7)
    elif frequency == MONTHLY:
        # Always steps from start_date's own day-of-month (via the month
        # offset `n`), not from the previous iteration's date -- clamping
        # Jan 31 -> Feb 28 must not permanently drag every later month
        # down to the 28th too. Each month is clamped independently: Mar
        # 31 stays the 31st even though Feb landed on the 28th.
        n = 0
        d = _add_months(start_date, n)
        while d <= end_date:
            dates.append(d)
            n += 1
            d = _add_months(start_date, n)
    elif frequency == CUSTOM:
        step = custom_interval_days if custom_interval_days and custom_interval_days >= 1 else 1
        d = start_date
        while d <= end_date:
            dates.append(d)
            d += timedelta(days=step)
    else:
        raise ValueError(f"Unknown frequency: {frequency!r}")

    return ScheduleDates(
        execution_dates=dates,
        execution_count=len(dates),
        first_execution=dates[0] if dates else None,
        last_execution=dates[-1] if dates else None,
    )
