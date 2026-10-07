import io
import json
import pathlib
import sys
import unittest
from types import SimpleNamespace

sys.path.insert(0, str(pathlib.Path(__file__).parent))
sys.modules.setdefault("vey", SimpleNamespace(decide=lambda **_kwargs: None))
import sidecar


class SidecarRequestTests(unittest.TestCase):
    def post(self, body):
        class HandlerStub:
            path = "/decide"
            headers = {"Content-Length": str(len(json.dumps(body).encode()))}
            rfile = io.BytesIO(json.dumps(body).encode())
            wfile = io.BytesIO()
            status = None

            def send_response(self, status):
                self.status = status

            def send_header(self, *_args):
                pass

            def end_headers(self):
                pass

        handler = HandlerStub()
        sidecar.Handler.do_POST(handler)
        return handler.status, json.loads(handler.wfile.getvalue())

    def test_non_dictionary_state_returns_bad_request(self):
        status, body = self.post({"version": 1, "candidates": {"support_question": "answer"}, "state": ["invalid"]})
        self.assertEqual(status, 400)
        self.assertEqual(body["error"], "bad state")

    def test_invalid_candidate_shape_returns_bad_request(self):
        status, body = self.post({"version": 1, "candidates": ["support_question"], "state": {"message": "hi"}})
        self.assertEqual(status, 400)
        self.assertEqual(body["error"], "no candidates")

    def test_oversized_declared_body_is_rejected_without_reading(self):
        handler = SimpleNamespace(headers={"Content-Length": str(256 * 1024 + 1)}, rfile=None)
        self.assertIsNone(sidecar._read_json(handler))


if __name__ == "__main__":
    unittest.main()
