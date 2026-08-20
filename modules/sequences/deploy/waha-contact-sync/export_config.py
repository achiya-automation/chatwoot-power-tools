#!/usr/bin/env python3
"""Emit the root-only Chatwoot sync config without logging secret values."""

import json
import urllib.request
from pathlib import Path

WAHA_LOCAL = "http://127.0.0.1:3000"
WAHA_PUBLIC = "https://waha-gows.achiya-automation.com"
USER_AGENT = "Achiya-WAHA-Chatwoot-Contact-Sync-Installer/1.0"


def env_value(path, key):
    for line in Path(path).read_text().splitlines():
        if line.startswith(key + "="):
            return line.split("=", 1)[1].strip().strip('"')
    raise RuntimeError(f"missing {key}")


def request_json(path, admin_key, method="GET", payload=None):
    body = None if payload is None else json.dumps(payload).encode()
    request = urllib.request.Request(
        WAHA_LOCAL + path,
        data=body,
        method=method,
        headers={
            "X-Api-Key": admin_key,
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def is_read_only(key, session):
    actions = key.get("actions") or {}
    return (
        key.get("isActive") is True
        and key.get("isAdmin") is False
        and key.get("session") == session
        and actions.get("read") is True
        and not any(actions.get(name) for name in ("send", "control", "setting", "app", "delete"))
    )


def main():
    admin_key = env_value("/opt/waha/.env", "WAHA_API_KEY_PLAIN")
    sessions = request_json("/api/sessions?all=true&expand=apps", admin_key)
    keys = request_json("/api/keys", admin_key)
    targets = []

    for session in sessions:
        if session.get("status") != "WORKING":
            continue
        apps = [
            app
            for app in (session.get("apps") or [])
            if app.get("app") == "chatwoot" and app.get("enabled", True)
        ]
        for app in apps:
            session_name = session["name"]
            selected = next((key for key in keys if is_read_only(key, session_name)), None)
            if selected is None:
                selected = request_json(
                    "/api/keys",
                    admin_key,
                    method="POST",
                    payload={
                        "isAdmin": False,
                        "session": session_name,
                        "isActive": True,
                        "actions": {
                            "read": True,
                            "send": False,
                            "control": False,
                            "setting": False,
                            "app": False,
                            "delete": False,
                        },
                    },
                )
                keys.append(selected)
            config = app.get("config") or {}
            targets.append(
                {
                    "session": session_name,
                    "account_id": int(config["accountId"]),
                    "inbox_id": int(config["inboxId"]),
                    "key_id": selected["id"],
                    "key": selected["key"],
                }
            )

    if not targets:
        raise RuntimeError("no enabled Chatwoot apps found")
    print(json.dumps({"waha_base_url": WAHA_PUBLIC, "targets": targets}, ensure_ascii=False))


if __name__ == "__main__":
    main()
