import http.server
import socketserver
from pathlib import Path

FRONTEND_PORT = 43118
WEB_DIR = Path("web")


if __name__ == "__main__":
    handler = http.server.SimpleHTTPRequestHandler
    with socketserver.TCPServer(("", FRONTEND_PORT), handler) as httpd:
        print(f"Frontend server running at http://127.0.0.1:{FRONTEND_PORT}")
        print(f"Serving directory: {WEB_DIR.resolve()}")
        # Force serving from web directory.
        import os

        os.chdir(WEB_DIR)
        httpd.serve_forever()
