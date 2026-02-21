import argparse
import json
import mimetypes
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

BACKEND_PORT = 43117
FRONTEND_PORT = 43118
ROOT = Path(__file__).resolve().parents[1]


def is_port_open(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", port)) == 0


def wait_http(url: str, timeout: float = 20) -> bool:
    end = time.time() + timeout
    while time.time() < end:
        try:
            with urllib.request.urlopen(url, timeout=2) as resp:
                return resp.status < 500
        except Exception:
            time.sleep(0.4)
    return False


def json_request(method: str, url: str, payload: dict | None = None):
    body = None
    headers = {}
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url=url, data=body, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def multipart_request(url: str, options: dict, file_path: Path):
    boundary = f"----codex-{int(time.time() * 1000)}"
    file_bytes = file_path.read_bytes()
    mime = mimetypes.guess_type(file_path.name)[0] or "application/pdf"

    parts = []
    parts.append(f"--{boundary}\r\n".encode())
    parts.append(b'Content-Disposition: form-data; name="options_json"\r\n\r\n')
    parts.append(json.dumps(options, ensure_ascii=False).encode("utf-8"))
    parts.append(b"\r\n")

    parts.append(f"--{boundary}\r\n".encode())
    parts.append(
        f'Content-Disposition: form-data; name="file"; filename="{file_path.name}"\r\n'.encode()
    )
    parts.append(f"Content-Type: {mime}\r\n\r\n".encode())
    parts.append(file_bytes)
    parts.append(b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())

    body = b"".join(parts)
    req = urllib.request.Request(
        url=url,
        data=body,
        method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return resp.read().decode("utf-8")


def multipart_request_multi_files(url: str, options: dict, file_paths: list[Path]):
    boundary = f"----codex-{int(time.time() * 1000)}"
    parts = []
    parts.append(f"--{boundary}\r\n".encode())
    parts.append(b'Content-Disposition: form-data; name="options_json"\r\n\r\n')
    parts.append(json.dumps(options, ensure_ascii=False).encode("utf-8"))
    parts.append(b"\r\n")

    for file_path in file_paths:
        file_bytes = file_path.read_bytes()
        mime = mimetypes.guess_type(file_path.name)[0] or "application/pdf"
        parts.append(f"--{boundary}\r\n".encode())
        parts.append(
            f'Content-Disposition: form-data; name="files"; filename="{file_path.name}"\r\n'.encode()
        )
        parts.append(f"Content-Type: {mime}\r\n\r\n".encode())
        parts.append(file_bytes)
        parts.append(b"\r\n")

    parts.append(f"--{boundary}--\r\n".encode())
    body = b"".join(parts)
    req = urllib.request.Request(
        url=url,
        data=body,
        method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    with urllib.request.urlopen(req, timeout=180) as resp:
        return resp.read().decode("utf-8")


def stream_multipart_request(url: str, options: dict, file_path: Path):
    boundary = f"----codex-{int(time.time() * 1000)}"
    file_bytes = file_path.read_bytes()

    parts = []
    parts.append(f"--{boundary}\r\n".encode())
    parts.append(b'Content-Disposition: form-data; name="options_json"\r\n\r\n')
    parts.append(json.dumps(options, ensure_ascii=False).encode("utf-8"))
    parts.append(b"\r\n")

    parts.append(f"--{boundary}\r\n".encode())
    parts.append(
        f'Content-Disposition: form-data; name="file"; filename="{file_path.name}"\r\n'.encode()
    )
    parts.append(b"Content-Type: application/pdf\r\n\r\n")
    parts.append(file_bytes)
    parts.append(b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    body = b"".join(parts)

    req = urllib.request.Request(
        url=url,
        data=body,
        method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )

    saw_final = False
    with urllib.request.urlopen(req, timeout=180) as resp:
        while True:
            line = resp.readline()
            if not line:
                break
            line = line.decode("utf-8", errors="ignore").strip()
            if not line.startswith("data:"):
                continue
            payload = line[5:].strip()
            if not payload:
                continue
            evt = json.loads(payload)
            if evt.get("event") == "final_done":
                saw_final = True
                break
    return saw_final


def main() -> int:
    parser = argparse.ArgumentParser(description="Run backend/frontend health checks")
    parser.add_argument("--live-openrouter", action="store_true", help="run live OpenRouter checks")
    parser.add_argument("--model", default="google/gemini-2.5-flash", help="OpenRouter model id")
    args = parser.parse_args()

    checks = []

    if is_port_open(BACKEND_PORT):
        print(f"[FAIL] backend port {BACKEND_PORT} is already in use")
        return 1
    if is_port_open(FRONTEND_PORT):
        print(f"[FAIL] frontend port {FRONTEND_PORT} is already in use")
        return 1

    backend = subprocess.Popen([sys.executable, "run_server.py"], cwd=ROOT)
    frontend = subprocess.Popen([sys.executable, "run_frontend.py"], cwd=ROOT)

    try:
        if not wait_http(f"http://127.0.0.1:{BACKEND_PORT}/health"):
            print("[FAIL] backend did not become healthy")
            return 1
        checks.append("backend health")

        if not wait_http(f"http://127.0.0.1:{FRONTEND_PORT}/"):
            print("[FAIL] frontend did not become healthy")
            return 1
        checks.append("frontend index")

        health = json_request("GET", f"http://127.0.0.1:{BACKEND_PORT}/health")
        assert health.get("ok") is True
        sync_status = json_request("GET", f"http://127.0.0.1:{BACKEND_PORT}/v1/catalog/sync/status")
        assert "targets" in sync_status
        checks.append("catalog sync status")

        created = json_request(
            "POST",
            f"http://127.0.0.1:{BACKEND_PORT}/v1/providers",
            {
                "name": "health-check-provider",
                "api_key": "sk-health-check-12345678",
                "base_url": "https://api.openai.com/v1",
                "model": "gpt-4o-mini",
                "is_default": True,
            },
        )
        provider_id = created["id"]
        checks.append("provider create")

        listing = json_request("GET", f"http://127.0.0.1:{BACKEND_PORT}/v1/providers")
        assert any(p["id"] == provider_id for p in listing)
        checks.append("provider list")

        updated = json_request(
            "PUT",
            f"http://127.0.0.1:{BACKEND_PORT}/v1/providers/{provider_id}",
            {"name": "health-check-provider-updated"},
        )
        assert updated["name"] == "health-check-provider-updated"
        checks.append("provider update")

        pdf = next((ROOT / "papers").glob("*.pdf"), None)
        if pdf is None:
            print("[FAIL] no PDF found in papers/")
            return 1

        non_stream = multipart_request(
            f"http://127.0.0.1:{BACKEND_PORT}/v1/papers/analyze",
            {
                "mock_mode": True,
                "stream_mode": "sequential",
                "angles": ["主题", "方法", "创新"],
            },
            pdf,
        )
        parsed = json.loads(non_stream)
        assert parsed.get("final_report")
        checks.append("paper analyze non-stream")

        batch = multipart_request_multi_files(
            f"http://127.0.0.1:{BACKEND_PORT}/v1/papers/analyze/batch",
            {
                "mock_mode": True,
                "stream_mode": "parallel",
                "parallel_limit": 2,
                "angles": ["主题", "方法"],
            },
            [pdf, pdf],
        )
        batch_parsed = json.loads(batch)
        assert batch_parsed.get("total") == 2
        assert batch_parsed.get("succeeded") == 2
        checks.append("paper analyze batch")

        ok = stream_multipart_request(
            f"http://127.0.0.1:{BACKEND_PORT}/v1/papers/analyze/stream",
            {
                "mock_mode": True,
                "stream_mode": "parallel",
                "parallel_limit": 2,
                "angles": ["主题", "方法", "创新"],
            },
            pdf,
        )
        assert ok is True
        checks.append("paper analyze stream (mock parallel)")

        ok2 = stream_multipart_request(
            f"http://127.0.0.1:{BACKEND_PORT}/v1/papers/analyze/stream",
            {
                "mock_mode": True,
                "stream_mode": "sequential",
                "angles": ["主题", "方法"],
            },
            pdf,
        )
        assert ok2 is True
        checks.append("paper analyze stream (mock sequential)")

        if args.live_openrouter:
            env_key = os.environ.get("OPENROUTER_API_KEY")
            if not env_key:
                env_file = ROOT / ".env"
                for line in env_file.read_text(encoding="utf-8").splitlines():
                    if line.startswith("OPENROUTER_API_KEY="):
                        env_key = line.split("=", 1)[1].strip().strip("\"' ")
                        break
            if not env_key:
                raise RuntimeError("OPENROUTER_API_KEY 未找到，无法执行 live-openrouter 检查")

            live = json_request(
                "POST",
                f"http://127.0.0.1:{BACKEND_PORT}/v1/providers",
                {
                    "name": "health-check-openrouter-live",
                    "api_key": env_key,
                    "base_url": "https://openrouter.ai/api/v1",
                    "model": args.model,
                    "is_default": False,
                },
            )
            live_id = live["id"]
            checks.append("provider create (openrouter)")

            _ = json_request(
                "POST",
                f"http://127.0.0.1:{BACKEND_PORT}/v1/models/validate/provider/{live_id}",
            )
            checks.append("openrouter validate")

            live_non_stream = multipart_request(
                f"http://127.0.0.1:{BACKEND_PORT}/v1/papers/analyze",
                {
                    "provider_id": live_id,
                    "paper_title": "Live Health Check",
                    "angles": ["主题与研究问题", "核心创新点"],
                    "stream_mode": "sequential",
                },
                pdf,
            )
            live_parsed = json.loads(live_non_stream)
            assert live_parsed.get("final_report")
            checks.append("openrouter analyze non-stream")

            live_stream = stream_multipart_request(
                f"http://127.0.0.1:{BACKEND_PORT}/v1/papers/analyze/stream",
                {
                    "provider_id": live_id,
                    "paper_title": "Live Health Check Stream",
                    "angles": ["主题与研究问题", "方法论与实验设计"],
                    "stream_mode": "parallel",
                    "parallel_limit": 2,
                },
                pdf,
            )
            assert live_stream is True
            checks.append("openrouter analyze stream")

            _ = json_request("DELETE", f"http://127.0.0.1:{BACKEND_PORT}/v1/providers/{live_id}")
            checks.append("provider delete (openrouter)")

        _ = json_request("DELETE", f"http://127.0.0.1:{BACKEND_PORT}/v1/providers/{provider_id}")
        checks.append("provider delete")

        print("[PASS] health checks completed:")
        for item in checks:
            print(f"  - {item}")
        print(f"[INFO] backend: http://127.0.0.1:{BACKEND_PORT}")
        print(f"[INFO] frontend: http://127.0.0.1:{FRONTEND_PORT}")
        return 0
    except urllib.error.HTTPError as exc:
        print(f"[FAIL] http error: {exc.code} {exc.reason}")
        try:
            print(exc.read().decode("utf-8", errors="ignore"))
        except Exception:
            pass
        return 1
    except Exception as exc:
        print(f"[FAIL] {exc}")
        return 1
    finally:
        for proc in (backend, frontend):
            if proc.poll() is None:
                proc.terminate()
        for proc in (backend, frontend):
            try:
                proc.wait(timeout=5)
            except Exception:
                proc.kill()


if __name__ == "__main__":
    raise SystemExit(main())
