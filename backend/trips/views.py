import logging

from rest_framework import status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView, exception_handler

from .serializers import TripPlanRequestSerializer
from .services.errors import TripPlanningError
from .services.planner import plan_trip

log = logging.getLogger(__name__)


def api_exception_handler(exc, context):
    """Return JSON for every error: typed planning errors, DRF errors and unexpected crashes."""
    if isinstance(exc, TripPlanningError):
        return Response(exc.to_dict(), status=exc.status_code)
    response = exception_handler(exc, context)
    if response is not None:
        if response.status_code == 400:
            response.data = {"error": "validation_error", "message": "Invalid input.", "fields": response.data}
        elif isinstance(response.data, dict) and "detail" in response.data:
            response.data = {"error": getattr(exc, "default_code", "error"), "message": str(response.data["detail"])}
        return response
    log.exception("unhandled error in %s", context.get("view"))
    return Response({"error": "internal_error", "message": "Unexpected server error."},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class HealthView(APIView):
    throttle_classes: list = []

    def get(self, request: Request) -> Response:
        return Response({"status": "ok"})


class TripPlanView(APIView):
    def post(self, request: Request) -> Response:
        serializer = TripPlanRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        result = plan_trip(
            current_location=data["current_location"],
            pickup_location=data["pickup_location"],
            dropoff_location=data["dropoff_location"],
            current_cycle_used=data["current_cycle_used"],
            start_datetime=data.get("start_datetime"),
        )
        return Response(result)
