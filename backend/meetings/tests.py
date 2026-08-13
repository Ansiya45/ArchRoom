from django.test import TestCase
from rest_framework.test import APIClient


class MeetingApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_create_meeting_returns_201_and_generates_code(self):
        response = self.client.post(
            '/api/meetings/',
            {
                'title': 'Weekly Product Sync',
                'host_name': 'Maya',
                'scheduled_at': '2026-08-15T18:00:00Z',
            },
            format='json',
        )

        self.assertEqual(response.status_code, 201)
        self.assertIn('meeting_code', response.data)
        self.assertTrue(response.data['meeting_code'].startswith('arch-'))
        self.assertEqual(response.data['title'], 'Weekly Product Sync')

    def test_list_meetings_returns_created_records(self):
        self.client.post(
            '/api/meetings/',
            {'title': 'Design Review', 'host_name': 'Aiden'},
            format='json',
        )

        response = self.client.get('/api/meetings/')

        self.assertEqual(response.status_code, 200)
        self.assertGreaterEqual(len(response.data), 1)

    def test_join_meeting_by_code_returns_meeting_details(self):
        self.client.post(
            '/api/meetings/',
            {'title': 'Engineering Standup', 'meeting_code': 'arch-TEST123', 'host_name': 'Nina'},
            format='json',
        )

        response = self.client.post(
            '/api/meetings/join/',
            {'meeting_code': 'arch-TEST123', 'guest_name': 'Sam'},
            format='json',
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['meeting_code'], 'arch-TEST123')
        self.assertEqual(response.data['guest_name'], 'Sam')
