import unittest

from frontend.app import app


class FrontendTests(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_home_contains_hidden_generated_timetable_target(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b'id="timetable"', response.data)
        self.assertIn(b'id="result-card" hidden', response.data)
        self.assertIn(b'id="result-report"', response.data)

    def test_timetable_one_maps_first_backend_alternative(self):
        response = self.client.get("/api/timetables/1")
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["alternative"], 1)
        self.assertEqual(payload["source"], "backend/generated/timetables.json")
        self.assertEqual(len(payload["timetables"]), 1)
        timetable = payload["timetables"][0]
        self.assertEqual(timetable["class_id"], "AI_DS_II_I")
        self.assertEqual(len(timetable["days"]), 6)
        self.assertTrue(all(len(day["periods"]) == 8 for day in timetable["days"]))


if __name__ == "__main__":
    unittest.main()
