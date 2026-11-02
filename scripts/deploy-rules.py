#!/usr/bin/env python3
"""
Deploy firestore.rules through the Firebase Rules REST API.

The Firebase CLI needs an interactive login, so this uses the Cloud SDK session
that is already authorised. It creates a new ruleset from the local file and
points the `cloud.firestore` release at it, which is what `firebase deploy
--only firestore:rules` does under the hood.

Usage:
    python3 scripts/deploy-rules.py [--project medivault-gcp-23875]
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

API = "https://firebaserules.googleapis.com/v1"
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def access_token() -> str:
    out = subprocess.run(["gcloud", "auth", "print-access-token"], capture_output=True, text=True)
    if out.returncode != 0:
        sys.exit(f"gcloud auth failed: {out.stderr.strip()}")
    return out.stdout.strip()


def call(token: str, project: str, method: str, url: str, body: dict | None = None) -> dict:
    headers = {
        "Authorization": f"Bearer {token}",
        "x-goog-user-project": project,
        "Content-Type": "application/json",
    }
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req) as resp:
            payload = resp.read()
            return json.loads(payload) if payload else {}
    except urllib.error.HTTPError as exc:
        sys.exit(f"{method} {url} -> {exc.code}\n{exc.read().decode()[:1200]}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", default="medivault-gcp-23875")
    args = ap.parse_args()

    path = os.path.join(REPO, "firestore.rules")
    with open(path) as fh:
        content = fh.read()

    token = access_token()
    base = f"{API}/projects/{args.project}"

    ruleset = call(
        token,
        args.project,
        "POST",
        f"{base}/rulesets",
        {"source": {"files": [{"name": "firestore.rules", "content": content}]}},
    )
    print(f"create  ruleset {ruleset['name'].rsplit('/', 1)[-1]}")

    call(
        token,
        args.project,
        "PATCH",
        f"{base}/releases/cloud.firestore",
        {
            "release": {
                "name": f"projects/{args.project}/releases/cloud.firestore",
                "rulesetName": ruleset["name"],
            },
            "updateMask": "rulesetName",
        },
    )
    print("release firestore rules live")


if __name__ == "__main__":
    main()
