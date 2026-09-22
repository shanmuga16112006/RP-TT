from __future__ import annotations

import argparse
import json
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from .errors import InputError
from .input import parse_dataset
from .scheduler import generate_timetables


_OVERRIDES_DIR = Path(__file__).parents[1] / "overrides"


class Handler(BaseHTTPRequestHandler):
    server_version = "TimetableAPI/0.1"

    def do_GET(self) -> None:
        if self.path == "/health":
            self._send(HTTPStatus.OK, {"status": "ok"})
        else:
            self._send(HTTPStatus.NOT_FOUND, {"error": "not_found"})

    def do_POST(self) -> None:
        if self.path not in {"/validate", "/generate"}:
            self._send(HTTPStatus.NOT_FOUND, {"error": "not_found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length > 10_000_000:
                raise InputError("request body exceeds 10 MB")
            body = json.loads(self.rfile.read(length) or b"{}")
            dataset = parse_dataset(body, _OVERRIDES_DIR)
            response: dict[str, Any] = {"valid": True}
            if self.path == "/generate":
                options = body.get("generation_options", {})
                if not isinstance(options, dict):
                    raise InputError("generation_options must be an object")
                variant_count = options.get("variant_count", 1)
                if not isinstance(variant_count, int) or isinstance(variant_count, bool) or not 1 <= variant_count <= 10:
                    raise InputError("generation_options.variant_count must be an integer from 1 to 10")
                response = generate_timetables(dataset, variant_count=variant_count)
            self._send(HTTPStatus.OK, response)
        except (InputError, json.JSONDecodeError) as exc:
            self._send(HTTPStatus.BAD_REQUEST, {"error": "invalid_input", "message": str(exc)})
        except Exception:
            self._send(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "internal_error"})

    def log_message(self, format: str, *args: object) -> None:
        print(f"{self.address_string()} - {format % args}")

    def _send(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
        encoded = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the timetable generator API")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"Timetable API listening on http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
