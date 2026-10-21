"""Small, dependency-free development server for the static WebXR test."""

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import ssl
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent
PUBLIC_FILES = {"/index.html", "/static/styles.css", "/static/app.js"}


class StaticHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        path = unquote(urlsplit(self.path).path)
        if path == "/":
            self.path = "/index.html"
        elif path not in PUBLIC_FILES:
            self.send_error(404, "Not found")
            return None
        return super().send_head()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()


def create_server(host, port, cert=None, key=None):
    if bool(cert) != bool(key):
        raise ValueError("Provide both --cert and --key for HTTPS.")
    context = None
    if cert:
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        context.load_cert_chain(cert, key)
    server = ThreadingHTTPServer(
        (host, port), partial(StaticHandler, directory=str(ROOT))
    )
    if context:
        server.socket = context.wrap_socket(server.socket, server_side=True)
    return server


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1", help="Use 0.0.0.0 to allow LAN access.")
    parser.add_argument("--port", default=8000, type=int)
    parser.add_argument("--cert", help="PEM certificate, including intermediates if needed.")
    parser.add_argument("--key", help="PEM private key. Never commit this file.")
    args = parser.parse_args()
    try:
        server = create_server(args.host, args.port, args.cert, args.key)
    except (ValueError, OSError, ssl.SSLError) as error:
        parser.exit(1, f"Cannot start server: {error}\n")
    scheme = "https" if args.cert else "http"
    display_host = "localhost" if args.host in ("127.0.0.1", "0.0.0.0") else args.host
    print(f"Desktop: {scheme}://{display_host}:{server.server_port}", flush=True)
    if args.host == "0.0.0.0":
        print(f"LAN: {scheme}://<this-computer-LAN-IP>:{server.server_port}", flush=True)
    print("Serving only the static app assets. Ctrl+C to stop.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
