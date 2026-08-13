import random
import string

from django.db import models
from django.utils import timezone


class Meeting(models.Model):
    STATUS_CHOICES = [
        ('scheduled', 'Scheduled'),
        ('live', 'Live'),
        ('ended', 'Ended'),
    ]

    title = models.CharField(max_length=200, default='Quick ArchRoom Meeting')
    meeting_code = models.CharField(max_length=50, unique=True, blank=True)
    host_name = models.CharField(max_length=120, default='Host')
    guest_name = models.CharField(max_length=120, blank=True, null=True)
    meeting_link = models.URLField(max_length=500, blank=True, default='')
    scheduled_at = models.DateTimeField(blank=True, null=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='scheduled')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.title} ({self.meeting_code})'

    @staticmethod
    def generate_code():
        prefix = 'arch-'
        suffix = ''.join(random.choice(string.ascii_uppercase + string.digits) for _ in range(8))
        return f'{prefix}{suffix}'

    def save(self, *args, **kwargs):
        if not self.meeting_code:
            self.meeting_code = self.generate_code()
        if not self.meeting_link and self.meeting_code:
            self.meeting_link = f'https://archroom.app/meet/{self.meeting_code}'
        if self.status == 'scheduled' and self.scheduled_at and self.scheduled_at <= timezone.now():
            self.status = 'live'
        super().save(*args, **kwargs)
