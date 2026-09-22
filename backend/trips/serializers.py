from datetime import datetime

from django.utils.dateparse import parse_datetime
from rest_framework import serializers


class HomeTerminalDateTimeField(serializers.Field):
    """ISO 8601 datetime. A naive value is taken as home-terminal wall-clock time (§395.8 time base)
    and left naive. An aware value is converted to home-terminal time later by the planner.
    DRF's DateTimeField would read a naive value as UTC under USE_TZ, which is wrong here."""

    default_error_messages = {"invalid": "Enter an ISO 8601 datetime, e.g. 2026-09-22T06:00:00."}

    def to_internal_value(self, data) -> datetime:
        if isinstance(data, datetime):
            return data
        try:
            parsed = parse_datetime(str(data).strip())
        except ValueError:
            parsed = None
        if parsed is None:
            self.fail("invalid")
        return parsed

    def to_representation(self, value: datetime) -> str:
        return value.isoformat()


class TripPlanRequestSerializer(serializers.Serializer):
    current_location = serializers.CharField(max_length=200, trim_whitespace=True, allow_blank=False)
    pickup_location = serializers.CharField(max_length=200, trim_whitespace=True, allow_blank=False)
    dropoff_location = serializers.CharField(max_length=200, trim_whitespace=True, allow_blank=False)
    current_cycle_used = serializers.FloatField(min_value=0, max_value=70)
    start_datetime = HomeTerminalDateTimeField(required=False, allow_null=True)
