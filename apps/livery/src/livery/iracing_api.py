"""Minimal iRacing Data API client — enough to learn the car roster.

Only stdlib, because this is a personal tool and a login that needs `pip install`
is a login that breaks in six months. The Data API hands back a signed link to
an S3 object rather than the data itself, so every call is two requests.

Auth is the legacy email/password scheme: the password is masked as
base64(sha256(password + email.lower())) before it leaves the machine. Accounts
with 2FA enabled cannot use it — iRacing's OAuth2 flow is the alternative, and
for a one-machine tool the simpler path is to sync the roster once.
"""

from __future__ import annotations

import base64
import getpass
import hashlib
import http.cookiejar
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

BASE = "https://members-ng.iracing.com"
USER_AGENT = "prodrive-livery/0.1 (personal livery pipeline)"


class IracingApiError(RuntimeError):
    pass


def mask_password(password: str, email: str) -> str:
    digest = hashlib.sha256((password + email.strip().lower()).encode("utf-8")).digest()
    return base64.b64encode(digest).decode("ascii")


class DataApi:
    def __init__(self, email: str | None = None, password: str | None = None):
        self.email = email or os.environ.get("IRACING_EMAIL") or ""
        self._password = password or os.environ.get("IRACING_PASSWORD") or ""
        self._jar = http.cookiejar.CookieJar()
        self._opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self._jar))
        self._authed = False

    def _request(self, url: str, payload: dict[str, Any] | None = None) -> Any:
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        req = urllib.request.Request(
            url,
            data=data,
            headers={"User-Agent": USER_AGENT, "Content-Type": "application/json"},
            method="POST" if data else "GET",
        )
        try:
            with self._opener.open(req, timeout=30) as response:
                body = response.read()
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")[:400]
            if exc.code == 401:
                raise IracingApiError(
                    "iRacing rejected the login. Legacy auth does not work on accounts with "
                    "2FA enabled, and the email must match the account exactly."
                ) from exc
            if exc.code == 429:
                raise IracingApiError("iRacing rate-limited the request — wait a minute and retry.") from exc
            raise IracingApiError(f"{url} → HTTP {exc.code}: {detail}") from exc
        except urllib.error.URLError as exc:
            raise IracingApiError(f"cannot reach {url}: {exc.reason}") from exc
        if not body:
            return None
        return json.loads(body.decode("utf-8"))

    def login(self) -> None:
        if self._authed:
            return
        if not self.email:
            self.email = input("iRacing email: ").strip()
        if not self._password:
            self._password = getpass.getpass("iRacing password (not stored): ")
        result = self._request(
            f"{BASE}/auth",
            {"email": self.email, "password": mask_password(self._password, self.email)},
        )
        if isinstance(result, dict) and result.get("authcode") in (0, "0"):
            raise IracingApiError(
                f"login failed: {result.get('message', 'no message')}. "
                f"{'Verification required — log in on the website first.' if result.get('verificationRequired') else ''}"
            )
        self._authed = True

    def get(self, path: str, **params: Any) -> Any:
        """Call a Data API endpoint and follow its signed link to the payload."""
        self.login()
        url = f"{BASE}{path}"
        if params:
            url += "?" + urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
        envelope = self._request(url)
        if isinstance(envelope, dict) and "link" in envelope:
            with urllib.request.urlopen(
                urllib.request.Request(envelope["link"], headers={"User-Agent": USER_AGENT}),
                timeout=60,
            ) as response:
                return json.loads(response.read().decode("utf-8"))
        return envelope

    def cars(self) -> list[dict[str, Any]]:
        """Every car on the service, including ``car_dirpath`` — the paint folder name."""
        data = self.get("/data/car/get")
        if isinstance(data, dict) and "cars" in data:
            return data["cars"]
        return data or []

    def car_assets(self) -> dict[str, Any]:
        """Per-car assets keyed by car id. Includes the template link on cars that have one."""
        return self.get("/data/car/assets") or {}
