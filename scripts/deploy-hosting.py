#!/usr/bin/env python3
"""
Deploy the built SPA to Firebase Hosting through the Hosting REST API.

This exists because the Firebase CLI needs an interactive login. The Cloud SDK
session that is already authorised can deploy the same release, using the
project's quota for the API call. The flow is the one the CLI performs:

  1. create a version with the rewrites and headers from firebase.json
  2. declare every file by SHA-256 so Hosting knows what changed
  3. upload only the files it asks for
  4. point the live channel at the new version

Usage:
    python3 scripts/deploy-hosting.py [--project medivault-gcp-23875]
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

API = "https://firebasehosting.googleapis.com/v1beta1"
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def gz(data: bytes) -> bytes:
    """Deterministic gzip: mtime=0, or two compressions of the same file differ."""
    return gzip.compress(data, 9, mtime=0)


def access_token() -> str:
    out = subprocess.run(["gcloud", "auth", "print-access-token"], capture_output=True, text=True)
    if out.returncode != 0:
        sys.exit(f"gcloud auth failed: {out.stderr.strip()}")
    return out.stdout.strip()


class Client:
    def __init__(self, project: str):
        self.project = project
        self.token = access_token()
        # The Hosting API rejects credentials that carry no quota project.
        self.headers = {
            "Authorization": f"Bearer {self.token}",
            "x-goog-user-project": project,
            "Content-Type": "application/json",
        }

    def call(self, method: str, url: str, body=None, raw: bytes | None = None):
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        req = urllib.request.Request(url, data=data, method=method, headers=self.headers)
        try:
            with urllib.request.urlopen(req) as resp:
                payload = resp.read()
                return json.loads(payload) if payload else {}
        except urllib.error.HTTPError as exc:
            sys.exit(f"{method} {url} -> {exc.code}\n{exc.read().decode()[:800]}")

    @property
    def site_base(self) -> str:
        return f"{API}/projects/{self.project}/sites/{self.project}"


def hosting_config() -> dict:
    """Translate firebase.json's hosting block into the API's version config."""
    with open(os.path.join(REPO, "firebase.json")) as fh:
        hosting = json.load(fh)["hosting"]

    config: dict = {}
    rewrites = [
        {"glob": r["source"], "path": r["destination"]}
        for r in hosting.get("rewrites", [])
        if "source" in r and "destination" in r
    ]
    if rewrites:
        config["rewrites"] = rewrites

    headers = []
    for rule in hosting.get("headers", []):
        headers.append({
            "glob": rule["source"],
            "headers": {h["key"]: h["value"] for h in rule["headers"]},
        })
    if headers:
        config["headers"] = headers
    return config


def collect(public_dir: str) -> dict[str, str]:
    """Map relative path -> sha256 of the gzipped body, which is what is uploaded.

    Hosting refuses anything else: the payload has to be gzipped, and the hash is
    checked against the bytes that arrive.
    """
    files: dict[str, str] = {}
    for root, _dirs, names in os.walk(public_dir):
        for name in names:
            if name.startswith("."):
                continue
            full = os.path.join(root, name)
            rel = "/" + os.path.relpath(full, public_dir).replace(os.sep, "/")
            with open(full, "rb") as fh:
                files[rel] = hashlib.sha256(gz(fh.read())).hexdigest()
    return files


def by_hash(files: dict[str, str]) -> dict[str, str]:
    return {digest: path for path, digest in files.items()}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", default="medivault-gcp-23875")
    ap.add_argument("--public", default="dist")
    args = ap.parse_args()

    public_dir = os.path.join(REPO, args.public)
    if not os.path.isdir(public_dir):
        sys.exit(f"{public_dir} is missing; run `npm run build` first")

    client = Client(args.project)
    files = collect(public_dir)
    print(f"collect {len(files)} files from {args.public}")

    version = client.call("POST", f"{client.site_base}/versions", {"config": hosting_config()})
    version_name = version["name"]
    version_id = version_name.rsplit("/", 1)[-1]
    print(f"create  version {version_id}")

    populated = client.call(
        "POST", f"{API}/{version_name}:populateFiles", {"files": files}
    )
    upload_url = populated["uploadUrl"]
    lookup = by_hash(files)
    required = populated.get("uploadRequiredHashes", [])
    print(f"upload  {len(required)} of {len(files)} files changed")

    for digest in required:
        rel = lookup[digest]
        with open(os.path.join(public_dir, rel.lstrip("/")), "rb") as fh:
            body = gz(fh.read())
        # Hosting requires the payload gzipped; the hash is of the raw file.
        client.call("POST", f"{upload_url}/{digest}", raw=body)

    client.call(
        "PATCH",
        f"{API}/{version_name}?updateMask=status",
        {"status": "FINALIZED"},
    )
    print("finalise version")

    # The channel is chosen by query parameter; the Release resource has no
    # version field of its own.
    client.call(
        "POST",
        f"{client.site_base}/releases?versionName=sites/{args.project}/versions/{version_id}",
        {},
    )
    print(f"release live at https://{args.project}.web.app")


if __name__ == "__main__":
    main()
