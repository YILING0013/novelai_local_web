"""Private WebView service and an independently switchable LAN listener for Windows."""
from __future__ import annotations

import hmac
import json
import os
import secrets
import socket
import sys
import threading
from pathlib import Path

from flask import jsonify, request
from waitress import create_server, wasyncore
from werkzeug.wrappers import Response

from app import ApiError, create_app, discover_lan_ipv4_addresses, load_local_config

DESKTOP_PORT = 47861
WEB_PORT = 5000


class Listener:
    """Own the sockets and close active keep-alive channels on the I/O thread."""

    def __init__(self, application, hosts, port):
        sockets = []
        channels = {}
        try:
            for host in hosts:
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                sockets.append(sock)
                if os.name == "nt":
                    sock.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
                else:
                    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                sock.bind((host, port))
            self.server = create_server(application, sockets=sockets, map=channels, threads=4)
        except BaseException:
            for sock in sockets:
                sock.close()
            raise
        self.channels = channels
        self.stopping = threading.Event()
        self.thread = threading.Thread(target=self._serve, daemon=True)
        self.thread.start()

    def _serve(self):
        try:
            while not self.stopping.is_set():
                wasyncore.loop(timeout=0.1, count=1, map=self.channels)
        finally:
            wasyncore.close_all(self.channels)
            self.server.task_dispatcher.shutdown(timeout=0)

    def close(self):
        self.stopping.set()
        self.thread.join()


class DesktopService:
    def __init__(self, profile, frontend, private_port=DESKTOP_PORT, web_port=WEB_PORT):
        self.profile = Path(profile)
        self.private_port = private_port
        config = load_local_config(self.profile / "config.local.json")
        self.web_port = config.pop("port", web_port)
        if type(self.web_port) is not int or not 1 <= self.web_port <= 65535 or self.web_port == private_port:
            raise ValueError("Invalid Web access port.")
        config.pop("allow_lan", None)
        for key in ("data_dir", "inference_models_dir"):
            if config.get(key):
                config[key] = str((self.profile / config[key]).resolve())
        self.key = secrets.token_urlsafe(32)
        self.lock = threading.RLock()
        self.web = None
        self.urls = []
        self.error = None
        self.preference = self.profile / "web-access.json"
        self.app = create_app({
            "PORT": private_port,
            "DATA_DIR": str(self.profile / "data"),
            **{k.upper(): v for k, v in config.items()},
            "FRONTEND_OUT_DIR": str(frontend),
            "REFERENCE_ASSETS_DIR": str(frontend),
        })
        self.app.add_url_rule("/api/desktop/web-access", "desktop_web_access",
                              self._web_settings, methods=["GET", "PUT"])
        self.private = Listener(self._private_request, ["127.0.0.1"], private_port)
        if self.preference.exists():
            try:
                if json.loads(self.preference.read_text(encoding="utf-8")) is True:
                    self._start_web()
            except (OSError, ValueError):
                self.error = "WEB_START_FAILED"

    def _private_request(self, env, start_response):
        host = f"127.0.0.1:{self.private_port}"
        supplied = env.pop("HTTP_X_NAI_DESKTOP", "")
        if (env.get("HTTP_HOST") != host or not supplied.isascii()
                or not hmac.compare_digest(supplied, self.key)):
            return Response("Desktop window required.", status=403)(env, start_response)
        env["novelai.desktop"] = True
        env["novelai.network"] = {
            "PORT": self.private_port, "ALLOW_LAN": False, "ALLOWED_HOSTS": {"127.0.0.1"},
            "LAN_IPV4_ADDRESSES": (), "ALLOWED_ORIGINS": {f"http://{host}"},
        }
        return self.app(env, start_response)

    def _start_web(self):
        addresses = discover_lan_ipv4_addresses()
        hosts = ["127.0.0.1", *addresses]
        policy = {
            "PORT": self.web_port, "ALLOW_LAN": True, "ALLOWED_HOSTS": {*hosts, "localhost"},
            "LAN_IPV4_ADDRESSES": addresses,
            "ALLOWED_ORIGINS": {f"http://{h}:{self.web_port}" for h in ("127.0.0.1", "localhost")},
        }
        allowed_authorities = {f"{host}:{self.web_port}" for host in policy["ALLOWED_HOSTS"]}

        def public_app(env, start_response):
            if env.get("HTTP_HOST") not in allowed_authorities:
                return Response("Invalid host.", status=400)(env, start_response)
            env["novelai.network"] = policy
            return self.app(env, start_response)

        self.web = Listener(public_app, hosts, self.web_port)
        self.urls = [f"http://{host}:{self.web_port}/login" for host in hosts]

    def _stop_web(self):
        if self.web:
            self.web.close()
            self.web = None
        self.urls = []

    def _write_preference(self, enabled):
        temp = self.preference.with_suffix(".tmp")
        temp.write_text(json.dumps(enabled), encoding="utf-8")
        temp.replace(self.preference)

    def _web_settings(self):
        if not request.environ.get("novelai.desktop"):
            raise ApiError("Desktop window required.", 403, "DESKTOP_REQUIRED")
        with self.lock:
            if request.method == "PUT":
                payload = request.get_json(silent=True)
                if not isinstance(payload, dict) or type(payload.get("enabled")) is not bool:
                    raise ApiError("Expected a boolean web access setting.")
                enabled = payload["enabled"]
                try:
                    if enabled and not self.web:
                        self._start_web()
                        try:
                            self._write_preference(True)
                        except OSError:
                            self._stop_web()
                            raise
                    elif not enabled:
                        self._write_preference(False)
                        self._stop_web()
                    self.error = None
                except (OSError, ValueError):
                    raise ApiError("Could not change Web access.", 409, "WEB_CHANGE_FAILED") from None
            return jsonify(enabled=bool(self.web), urls=self.urls, port=self.web_port, error=self.error)

    def close(self):
        self.private.close()
        with self.lock:
            self._stop_web()


def main():
    profile = Path(os.environ["LOCALAPPDATA"]) / "NovelAI Local"
    # Legacy source-mode environment overrides do not control installed app exposure.
    os.environ.pop("NOVELAI_LOCAL_ALLOW_LAN", None)
    frontend = Path(__file__).resolve().parent.parent / "next_nai_web" / "out"
    service = DesktopService(profile, frontend)
    try:
        # Inherited anonymous pipes are private to the launcher. EOF also covers a crashed parent.
        print(service.key, flush=True)
        sys.stdin.buffer.read()
    finally:
        service.close()


if __name__ == "__main__":
    main()
