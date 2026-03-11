import unittest
from unittest.mock import patch

import app


class FakeResponse:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code
        self.ok = 200 <= status_code < 300

    def json(self):
        return self._payload

    def raise_for_status(self):
        return None


class ApiKeyHeaderTests(unittest.TestCase):
    def test_get_api_request_headers_returns_api_key_header(self):
        with patch.object(app, "API_KEY", "test-key"):
            self.assertEqual(app.get_api_request_headers(), {"X-API-Key": "test-key"})

    def test_get_stop_id_sends_api_key_header(self):
        with patch.object(app, "API_KEY", "test-key"), patch.object(
            app.requests,
            "get",
            return_value=FakeResponse({"locations": [{"id": "123"}]}),
        ) as mock_get:
            stop_id = app.get_stop_id("Marktplatz")

        self.assertEqual(stop_id, "123")
        self.assertEqual(mock_get.call_args.kwargs["headers"], {"X-API-Key": "test-key"})

    def test_get_stop_name_by_id_sends_api_key_header(self):
        with patch.object(app, "API_KEY", "test-key"), patch.object(
            app.requests,
            "get",
            return_value=FakeResponse({"locations": [{"id": "123", "name": "Marktplatz"}]}),
        ) as mock_get:
            stop_name = app.get_stop_name_by_id("123")

        self.assertEqual(stop_name, "Marktplatz")
        self.assertEqual(mock_get.call_args.kwargs["headers"], {"X-API-Key": "test-key"})

    def test_get_stop_departures_sends_api_key_header(self):
        with patch.object(app, "API_KEY", "test-key"), patch.object(
            app.requests,
            "get",
            return_value=FakeResponse([]),
        ) as mock_get:
            app.get_stop_departures("123")

        self.assertEqual(mock_get.call_args.kwargs["headers"], {"X-API-Key": "test-key"})

    def test_get_stop_notifications_sends_api_key_header(self):
        with patch.object(app, "API_KEY", "test-key"), patch.object(
            app.requests,
            "get",
            return_value=FakeResponse([]),
        ) as mock_get:
            app.get_stop_notifications("123")

        self.assertEqual(mock_get.call_args.kwargs["headers"], {"X-API-Key": "test-key"})

    def test_search_route_sends_api_key_header(self):
        with patch.object(app, "API_KEY", "test-key"), patch.object(
            app.requests,
            "get",
            return_value=FakeResponse({"locations": [{"id": "123", "name": "Marktplatz"}]}),
        ) as mock_get, patch.object(app, "get_stop_departures", return_value=[]), patch.object(
            app, "get_stop_notifications", return_value=[]
        ):
            with app.app.test_client() as client:
                response = client.get("/search?stop=Marktplatz")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(mock_get.call_args.kwargs["headers"], {"X-API-Key": "test-key"})


if __name__ == "__main__":
    unittest.main()
