"""Loopback-only, read-only preview of product and mock display assets."""
import argparse
import json
import re
import socket
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit


MIME = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".webmanifest": "application/manifest+json",
    ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon",
    ".woff": "font/woff", ".woff2": "font/woff2",
}
PRODUCT_FILES = {"index.html", "concept.html", "app.js", "styles.css",
                 "sw.js", "marked.min.js", "manifest.webmanifest"}
BLOCKED = {"tools", "scripts", "tests", "docs", "node_modules", "personal-data",
           "auth", "credentials", "app-state", "app-state.json"}
IMAGES = {".svg", ".png", ".jpg", ".jpeg", ".webp", ".ico", ".woff", ".woff2"}


def allowed(route, parts):
    """Positive asset rules, also applied after resolving filesystem links."""
    if any(p.startswith(".") or p.lower() in BLOCKED for p in parts):
        return False
    suffix = Path(parts[-1]).suffix
    if route == "product":
        return ("/".join(parts) in PRODUCT_FILES
                or (parts[0] == "src" and suffix in {".js", ".css"})
                or (parts[0] == "assets" and suffix in IMAGES))
    return (len(parts) == 1 and parts[0] in {"preview.html", "preview.js", "preview.css"}
            or parts[0] in {"shared", "assets"} and suffix in IMAGES | {".js", ".css"})


class PreviewServer(ThreadingHTTPServer):
    allow_reuse_address = False

    def server_bind(self):
        # Windows SO_REUSEADDR can otherwise let two preview processes share a port.
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


class PreviewHandler(BaseHTTPRequestHandler):
    def __getattr__(self, name):
        # BaseHTTPRequestHandler uses do_METHOD lookup: all other verbs are 405.
        if name.startswith("do_"):
            return self.reject_write
        raise AttributeError(name)

    def reject_write(self):
        self.send_response(405)
        self.send_header("Allow", "GET, HEAD")
        self.send_header("Content-Length", "0")
        self.end_headers()
        self.close_connection = True

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def asset(self):
        raw = urlsplit(self.path)
        if raw.scheme or raw.netloc or not raw.path.startswith("/"):
            raise ValueError("not an origin path")
        decoded = unquote(raw.path, errors="strict")
        # Reject traversal before path normalization, including Windows ADS and aliases.
        if re.search(r"[\\:%\x00-\x1f\x7f]", decoded):
            raise ValueError("invalid path")
        route, *parts = decoded[1:].split("/")
        if route == "product" and parts == [""]:
            parts = ["index.html"]  # SW precaches './'; never expose directory listings.
        if route not in self.server.roots or not parts:
            raise ValueError("unknown route")
        if any(not p or p in {".", ".."} or p.endswith((".", " ")) for p in parts):
            raise ValueError("invalid segment")
        if not allowed(route, parts):
            raise ValueError("not a display asset")
        root = self.server.roots[route]
        candidate = root.joinpath(*parts)
        resolved = candidate.resolve(strict=True)
        relative = resolved.relative_to(root)
        # Reject links (including Windows junctions), even into another allowed subtree.
        if resolved != candidate or not allowed(route, relative.parts) or not resolved.is_file():
            raise ValueError("not a regular in-root asset")
        return resolved

    def serve_asset(self, head=False):
        try:
            asset = self.asset()
            with asset.open("rb") as source:
                body = source.read()
        except (OSError, ValueError, RuntimeError):
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", MIME[asset.suffix])
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if not head:
            self.wfile.write(body)

    def do_GET(self):
        self.serve_asset()

    def do_HEAD(self):
        self.serve_asset(head=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bind", choices=["127.0.0.1"], default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8850)
    parser.add_argument("--product-root", type=Path, required=True)
    parser.add_argument("--mock-root", type=Path, required=True)
    args = parser.parse_args()
    # A future mock version may not exist yet; its requests simply return 404.
    roots = {"product": args.product_root.resolve(), "mock": args.mock_root.resolve()}
    with PreviewServer((args.bind, args.port), PreviewHandler) as server:
        server.roots = roots
        print(json.dumps({"ready": True, "port": server.server_port}), flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
