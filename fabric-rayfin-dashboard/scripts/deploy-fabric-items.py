#!/usr/bin/env python3
"""Deploy the Fabric items that support the Rayfin app.

Creates `lh_command_center`, the lakehouse that holds Project Osmos bridge status files, if it is
missing. Then creates or updates the `nb_osmos_task_bridge` notebook from
fabric/nb_osmos_task_bridge.Notebook/notebook-content.py.

Uses your Azure CLI sign-in (`az login`). Tokens are never printed.

Usage:  python scripts/deploy-fabric-items.py --workspace-id <guid>
"""
from __future__ import annotations

import argparse
import base64
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

FABRIC_API = "https://api.fabric.microsoft.com/v1"
LAKEHOUSE = "lh_command_center"
NOTEBOOK = "nb_osmos_task_bridge"
ROOT = Path(__file__).resolve().parent.parent
NOTEBOOK_SOURCE = ROOT / "fabric" / f"{NOTEBOOK}.Notebook" / "notebook-content.py"


def token() -> str:
    return subprocess.check_output(
        "az account get-access-token --resource https://api.fabric.microsoft.com --query accessToken -o tsv",
        shell=True,
        text=True,
    ).strip()


def call(method: str, url: str, body: dict | None = None) -> tuple[int, dict, dict | None]:
    request = urllib.request.Request(
        url,
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": f"Bearer {token()}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request) as response:
            raw = response.read()
            return response.status, dict(response.headers), json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        raw = error.read()
        try:
            payload = json.loads(raw) if raw else None
        except ValueError:
            payload = {"message": raw[:300].decode(errors="replace")}
        return error.code, dict(error.headers), payload


def wait(status: int, headers: dict, payload: dict | None, label: str) -> dict | None:
    if status not in (200, 201, 202):
        sys.exit(f"{label} failed: HTTP {status} {json.dumps(payload)[:400]}")
    location = headers.get("Location") or headers.get("location")
    if status != 202 or not location:
        return payload
    for _ in range(60):
        time.sleep(int(headers.get("Retry-After") or 3))
        status, headers, payload = call("GET", location)
        state = (payload or {}).get("status")
        if state == "Succeeded":
            result_status, _, result = call("GET", f"{location}/result")
            return result if result_status == 200 else payload
        if state in ("Failed", "Cancelled"):
            sys.exit(f"{label} failed: {json.dumps(payload)[:400]}")
    sys.exit(f"{label} timed out")


def find(workspace: str, item_type: str, name: str) -> dict | None:
    status, _, payload = call("GET", f"{FABRIC_API}/workspaces/{workspace}/items?type={item_type}")
    if status != 200:
        sys.exit(f"Listing {item_type} items failed: HTTP {status}")
    return next((item for item in (payload or {}).get("value", []) if item.get("displayName") == name), None)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace-id", required=True)
    workspace = parser.parse_args().workspace_id

    lakehouse = find(workspace, "Lakehouse", LAKEHOUSE)
    if not lakehouse:
        lakehouse = wait(
            *call("POST", f"{FABRIC_API}/workspaces/{workspace}/lakehouses", {
                "displayName": LAKEHOUSE,
                "description": "Agent Command Center app state (Project Osmos bridge status files).",
            }),
            "Create lakehouse",
        )
    print(f"lakehouse {LAKEHOUSE}: {lakehouse['id']}")

    definition = {
        "format": "fabricGitSource",
        "parts": [{
            "path": "notebook-content.py",
            "payload": base64.b64encode(NOTEBOOK_SOURCE.read_bytes()).decode(),
            "payloadType": "InlineBase64",
        }],
    }
    notebook = find(workspace, "Notebook", NOTEBOOK)
    if notebook:
        wait(
            *call("POST", f"{FABRIC_API}/workspaces/{workspace}/notebooks/{notebook['id']}/updateDefinition",
                  {"definition": definition}),
            "Update notebook",
        )
    else:
        notebook = wait(
            *call("POST", f"{FABRIC_API}/workspaces/{workspace}/notebooks", {
                "displayName": NOTEBOOK,
                "description": "Creates Project Osmos tasks as the signed-in user for the Agent Command Center app.",
                "definition": definition,
            }),
            "Create notebook",
        )
        notebook = notebook if notebook and notebook.get("id") else find(workspace, "Notebook", NOTEBOOK)
    print(f"notebook {NOTEBOOK}: {notebook['id']}")


if __name__ == "__main__":
    main()
