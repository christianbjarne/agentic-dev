# Fabric notebook source

# METADATA ********************

# META {
# META   "kernel_info": {
# META     "name": "synapse_pyspark"
# META   },
# META   "dependencies": {}
# META }

# MARKDOWN ********************

# # Project Osmos task bridge
# 
# Started by the Agent Command Center app (Fabric Apps / Rayfin) through the Fabric Jobs API.
# The job runs as the signed-in user who submitted it, so the Project Osmos task is created as that user.
# Project Osmos does not accept the Rayfin function token, but it does accept the Fabric token a
# notebook gets from `notebookutils`.
# 
# The notebook creates the task, then reports its status to `result_path`, a JSON file in the app's
# lakehouse that the app reads, until the task finishes or `monitor_minutes` runs out.

# PARAMETERS CELL ********************

mode = "create"
task_id = ""
workspace_id = ""
lakehouse_id = ""
display_name = ""
instruction_b64 = ""
result_path = ""
monitor_minutes = 20

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

import base64
import json
import re
import time
import uuid
from datetime import datetime, timezone
from urllib.parse import urlparse

import requests

FABRIC_API = "https://api.fabric.microsoft.com"
TRUSTED_SUFFIXES = (".fabric.microsoft.com", ".analysis.windows.net", ".pbidedicated.windows.net")
SKILL_HEADER = {"x-ms-fabric-skill": "project-osmos"}
STATUS_BY_CODE = {0: "Created", 1: "Running", 2: "Cancelling", 3: "Cancelled", 4: "Completed", 5: "Failed"}
RUNNING = {"Created", "Running", "Cancelling"}
GUID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
MAX_INSTRUCTION = 9500
POLL_SECONDS = 30


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def validate_inputs():
    for name, value in (("task_id", task_id), ("workspace_id", workspace_id), ("lakehouse_id", lakehouse_id)):
        if not GUID.match(value or ""):
            raise ValueError(f"{name} must be a GUID")
    if mode not in ("create", "status"):
        raise ValueError("mode must be 'create' or 'status'")
    if not (result_path or "").startswith("abfss://") or not result_path.endswith(".json"):
        raise ValueError("result_path must be an abfss:// path to a .json file")


def write_result(state):
    payload = {
        "taskId": task_id,
        "workspaceId": workspace_id,
        "lakehouseId": lakehouse_id,
        "updatedAt": now_iso(),
        **state,
    }
    notebookutils.fs.put(result_path, json.dumps(payload), True)


def https_base(value):
    parsed = urlparse(value if "://" in value else f"https://{value}")
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or not host.endswith(TRUSTED_SUFFIXES):
        raise RuntimeError("Fabric returned an untrusted routed host.")
    return f"https://{parsed.netloc}"


def call(method, url, authorization, body=None):
    headers = {"Authorization": authorization, "Content-Type": "application/json", **SKILL_HEADER}
    response = requests.request(method, url, headers=headers, json=body, timeout=60)
    try:
        data = response.json() if response.content else None
    except ValueError:
        data = response.text[:500]
    return response.status_code, response.headers, data


def failure(label, status, data):
    detail = ""
    if isinstance(data, dict):
        detail = str((data.get("error") or {}).get("message") or data.get("message") or "")[:300]
    elif data:
        detail = str(data)[:300]
    return f"{label} failed: HTTP {status}" + (f" - {detail}" if detail else "")


def osmos_route():
    token = notebookutils.credentials.getToken("pbi")
    bearer = f"Bearer {token}"
    status, headers, workspace = call("GET", f"{FABRIC_API}/v1/workspaces/{workspace_id}", bearer)
    if status != 200:
        raise RuntimeError(failure("Osmos workspace lookup", status, workspace))
    capacity_id = (workspace or {}).get("capacityId")
    if not capacity_id:
        raise RuntimeError("The Osmos workspace has no Fabric capacity.")
    status, _, lakehouse = call("GET", f"{FABRIC_API}/v1/workspaces/{workspace_id}/lakehouses/{lakehouse_id}", bearer)
    if status != 200:
        raise RuntimeError(failure("Osmos lakehouse lookup", status, lakehouse))
    bases = [FABRIC_API]
    home = headers.get("home-cluster-uri")
    if home and https_base(home) != FABRIC_API:
        bases.append(https_base(home))
    payload = {
        "capacityObjectId": capacity_id,
        "workloadType": "SparkCore",
        "workspaceObjectId": workspace_id,
        "artifactObjectIds": [lakehouse_id],
    }
    token_data = None
    for index, base in enumerate(bases):
        status, _, data = call("POST", f"{base}/metadata/v201606/generatemwctoken", bearer, payload)
        if 200 <= status < 300:
            token_data = data or {}
            break
        if "Tenant not authorized for cluster" not in str(data) or index + 1 >= len(bases):
            raise RuntimeError(failure("Project Osmos routing token", status, data))
    mwc = token_data.get("Token") or token_data.get("token")
    host = token_data.get("TargetUriHost") or token_data.get("mwcTokenTargetUriHost")
    if not mwc or not host:
        raise RuntimeError("Fabric did not return a Project Osmos routing token.")
    tasks_base = (
        f"{https_base(host)}/webapi/capacities/{capacity_id}/workloads/SparkCore/SparkCoreService/direct/v1/"
        f"workspaces/{workspace_id}/artifacts/{lakehouse_id}/aichat"
    )
    return tasks_base, f"mwctoken {mwc}"


def normalize_status(value):
    if value is None or value == "":
        return "Created"
    if isinstance(value, int) or (isinstance(value, str) and value.isdigit()):
        return STATUS_BY_CODE.get(int(value), f"Status {value}")
    return str(value)[:32]


def create_task():
    instruction = base64.b64decode(instruction_b64).decode("utf-8").strip()
    if not instruction:
        raise ValueError("The Osmos handoff has no instruction.")
    if len(instruction) > MAX_INSTRUCTION:
        raise ValueError("The composed instruction is too long for Project Osmos.")
    tasks_base, authorization = osmos_route()
    message = {
        "id": str(uuid.uuid4()),
        "role": "User",
        "content": instruction,
        "timestamp": now_iso(),
        "metadata": {"author_name": "rayfin-command-center", "author_source": "nb_osmos_task_bridge"},
    }
    steps = (
        ("PUT", f"/{task_id}", {"displayName": display_name[:200] or "Command center task", "instruction": instruction}),
        ("POST", f"/{task_id}/messages", {"messages": [message]}),
        ("POST", f"/{task_id}/run", None),
    )
    for method, path, body in steps:
        status, _, data = call(method, f"{tasks_base}{path}", authorization, body)
        if not 200 <= status < 300:
            raise RuntimeError(failure(f"Project Osmos {method} {path.rsplit('/', 1)[-1]}", status, data))


def read_status():
    tasks_base, authorization = osmos_route()
    status, _, data = call("GET", f"{tasks_base}/{task_id}", authorization)
    if status != 200:
        raise RuntimeError(failure("Project Osmos task read", status, data))
    task = data or {}
    error = str((task.get("runDetails") or {}).get("errorMessage") or "")[:500]
    return normalize_status(task.get("status")), error

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

validate_inputs()
try:
    if mode == "create":
        write_result({"ok": True, "status": "Submitting", "running": True})
        create_task()
        write_result({"ok": True, "status": "Running", "running": True})
    deadline = time.time() + max(0, int(monitor_minutes)) * 60
    while True:
        current, error = read_status()
        running = current in RUNNING
        write_result({"ok": True, "status": current, "running": running, "message": error or None})
        if not running or time.time() >= deadline:
            break
        time.sleep(POLL_SECONDS)
    if running:
        write_result({
            "ok": True,
            "status": current,
            "running": True,
            "message": "Monitoring stopped; open the task in Fabric for live progress.",
        })
except Exception as error:
    write_result({"ok": False, "status": "Failed", "running": False, "message": str(error)[:1000]})
    raise

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }
