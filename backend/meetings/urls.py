from django.urls import path

from .views import MeetingListCreateView, join_meeting

urlpatterns = [
    path('meetings/', MeetingListCreateView.as_view(), name='meeting-list-create'),
    path('meetings/join/', join_meeting, name='meeting-join'),
]
