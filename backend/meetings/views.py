from django.utils import timezone
from rest_framework import generics, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .models import Meeting
from .serializers import MeetingSerializer


class MeetingListCreateView(generics.ListCreateAPIView):
    queryset = Meeting.objects.all()
    serializer_class = MeetingSerializer
    permission_classes = [AllowAny]


@api_view(['POST'])
@permission_classes([AllowAny])
def join_meeting(request):
    meeting_code = (request.data.get('meeting_code') or '').strip()
    guest_name = (request.data.get('guest_name') or 'Guest User').strip() or 'Guest User'

    if not meeting_code:
        return Response({'detail': 'meeting_code is required.'}, status=status.HTTP_400_BAD_REQUEST)

    meeting = Meeting.objects.filter(meeting_code__iexact=meeting_code).first()
    if not meeting:
        return Response({'detail': 'Meeting not found.'}, status=status.HTTP_404_NOT_FOUND)

    meeting.guest_name = guest_name
    if meeting.status == 'scheduled' and meeting.scheduled_at and meeting.scheduled_at <= timezone.now():
        meeting.status = 'live'
    meeting.save(update_fields=['guest_name', 'status', 'updated_at'])

    return Response(
        {
            'id': meeting.id,
            'title': meeting.title,
            'meeting_code': meeting.meeting_code,
            'host_name': meeting.host_name,
            'guest_name': guest_name,
            'status': meeting.status,
            'meeting_link': meeting.meeting_link,
            'scheduled_at': meeting.scheduled_at.isoformat() if meeting.scheduled_at else None,
        },
        status=status.HTTP_200_OK,
    )
