import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import requests


def load_config(path: Path):
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_config(path: Path, config):
    with path.open("w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)


def auth_headers(token: str):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def bootstrap_bridge(config_path: Path, config: dict):
    if config.get("bridgeId") and config.get("bridgeToken"):
      return config

    user_token = config.get("userAccessToken")
    if not user_token:
        raise RuntimeError("userAccessToken is required for first-time bridge registration.")

    payload = {
        "name": config.get("bridgeName", "VGO Local Bridge"),
        "platform": config.get("platform", sys.platform),
        "machineLabel": config.get("machineLabel", os.environ.get("COMPUTERNAME", "Local Machine")),
        "workingDirectory": config.get("workingDirectory", "E:\\"),
    }

    base = config["serverBaseUrl"].rstrip("/")
    response = requests.post(
        f"{base}/api/v1/chat/local-bridge/bridges",
        headers=auth_headers(user_token),
        json=payload,
        timeout=30,
    )
    response.raise_for_status()
    data = response.json()["data"]
    config["bridgeId"] = data["bridge"]["id"]
    config["bridgeToken"] = data["token"]
    save_config(config_path, config)
    return config


def heartbeat(config: dict, status: str):
    base = config["serverBaseUrl"].rstrip("/")
    payload = {
        "bridgeId": config["bridgeId"],
        "token": config["bridgeToken"],
        "status": status,
    }
    response = requests.post(
        f"{base}/api/v1/chat/local-bridge/agent/heartbeat",
        json=payload,
        timeout=30,
    )
    response.raise_for_status()


def fetch_next_job(config: dict):
    base = config["serverBaseUrl"].rstrip("/")
    response = requests.get(
        f"{base}/api/v1/chat/local-bridge/agent/jobs/next",
        params={"bridgeId": config["bridgeId"], "token": config["bridgeToken"]},
        timeout=30,
    )
    response.raise_for_status()
    return response.json()["data"]


def mark_job(config: dict, job_id: str, action: str, payload: dict):
    base = config["serverBaseUrl"].rstrip("/")
    body = {"bridgeId": config["bridgeId"], "token": config["bridgeToken"], **payload}
    response = requests.post(
        f"{base}/api/v1/chat/local-bridge/agent/jobs/{job_id}/{action}",
        json=body,
        timeout=30,
    )
    response.raise_for_status()


def build_command(config: dict, job: dict):
    executor = config["executor"]
    command = [executor["command"]]
    command.extend(executor.get("args", []))
    command.extend(["--plain", "--stdin", "--auto_run", "--safe_mode", "auto"])
    return command


def run_job(config: dict, job: dict):
    instruction = job["instruction"].strip()
    working_directory = job.get("workingDirectory") or config.get("workingDirectory") or "E:\\"
    prompt = (
        f"You are executing a VGO AGENT approved local task.\n"
        f"Working directory: {working_directory}\n"
        f"Task:\n{instruction}\n"
        "Return a concise summary when finished."
    )

    env = os.environ.copy()
    for key, value in config.get("env", {}).items():
        env[str(key)] = str(value)

    result = subprocess.run(
        build_command(config, job),
        input=prompt,
        text=True,
        capture_output=True,
        cwd=working_directory,
        timeout=int(config.get("jobTimeoutSeconds", 1800)),
        env=env,
    )
    return result


def main():
    parser = argparse.ArgumentParser(description="VGO AGENT local bridge")
    parser.add_argument("--config", default="vgo-local-bridge.json", help="Path to bridge config JSON")
    args = parser.parse_args()

    config_path = Path(args.config).resolve()
    config = load_config(config_path)
    config = bootstrap_bridge(config_path, config)

    poll_interval = int(config.get("polling", {}).get("intervalSeconds", 10))

    print(f"[bridge] online as {config['bridgeId']}")
    while True:
        try:
            heartbeat(config, "idle")
            job = fetch_next_job(config)
            if not job:
                time.sleep(poll_interval)
                continue

            print(f"[bridge] starting job {job['id']}: {job['title']}")
            mark_job(config, job["id"], "start", {})
            heartbeat(config, "busy")

            result = run_job(config, job)
            stdout = (result.stdout or "")[:12000]
            stderr = (result.stderr or "")[:12000]

            if result.returncode == 0:
                mark_job(
                    config,
                    job["id"],
                    "complete",
                    {
                        "resultSummary": "Local execution completed successfully.",
                        "stdout": stdout,
                        "stderr": stderr,
                        "artifacts": [],
                    },
                )
                print(f"[bridge] completed job {job['id']}")
            else:
                mark_job(
                    config,
                    job["id"],
                    "fail",
                    {
                        "resultSummary": f"Local execution failed with exit code {result.returncode}.",
                        "stdout": stdout,
                        "stderr": stderr,
                    },
                )
                print(f"[bridge] failed job {job['id']}")
        except Exception as exc:
            print(f"[bridge] error: {exc}")
            try:
                heartbeat(config, "error")
            except Exception:
                pass
            time.sleep(max(poll_interval, 15))


if __name__ == "__main__":
    main()
