from rest_framework import serializers

from .models import Meeting


class MeetingSerializer(serializers.ModelSerializer):
    class Meta:
        model = Meeting
        fields = [
            'id',
            'title',
            'meeting_code',
            'host_name',
            'guest_name',
            'meeting_link',
            'scheduled_at',
            'status',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'meeting_link', 'created_at', 'updated_at']

    def validate_meeting_code(self, value):
        if not value:
            return value
        return value.strip()

    def create(self, validated_data):
        meeting = Meeting(**validated_data)
        meeting.save()
        return meeting
