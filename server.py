from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import os
import socket
import tempfile

ROOT = Path(__file__).resolve().parent
POSITIONS_FILE = ROOT / "assets" / "datas" / "positions.json"
HOST = "::"
PORT = 8000


class PortfolioServer(ThreadingHTTPServer):
    address_family = socket.AF_INET6


class PortfolioHandler(SimpleHTTPRequestHandler):
    def do_POST(self):
        normalized_path = self.path.split("?", 1)[0]
        if normalized_path not in {"/positions.json", "/assets/datas/positions.json"}:
            self.send_error(404, "Endpoint not found")
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            data = json.loads(self.rfile.read(content_length))
            if not isinstance(data, dict):
                raise ValueError("The positions payload must be an object")
            serialized = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
            with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=ROOT, delete=False) as temporary:
                temporary.write(serialized)
                temporary_path = Path(temporary.name)
            os.replace(temporary_path, POSITIONS_FILE)
        except (ValueError, OSError, json.JSONDecodeError) as error:
            temporary_path = locals().get("temporary_path")
            if temporary_path:
                temporary_path.unlink(missing_ok=True)
            self.send_error(400, str(error))
            return

        response = b'{"saved": true}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(response)))
        self.end_headers()
        self.wfile.write(response)


if __name__ == "__main__":
    server = PortfolioServer((HOST, PORT), PortfolioHandler)
    print(f"Portfolio disponible sur http://localhost:{PORT}/")
    server.serve_forever()
