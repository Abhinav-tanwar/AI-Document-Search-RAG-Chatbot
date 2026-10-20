"""Start both local services. Ctrl+C shuts them down together."""

import os
import shutil
import signal
import subprocess
import sys
import time
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BUNDLED = Path.home() / ".cache/codex-runtimes/codex-primary-runtime/dependencies/node"


def main():
    python = ROOT / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    if not python.exists():
        sys.exit("First create .venv and install backend/requirements.txt; see README.md.")
    node = shutil.which("node") or str(BUNDLED / "bin/node")
    if not Path(node).exists():
        sys.exit("Install Node.js 22 or newer; see README.md.")
    vite = ROOT / "frontend/node_modules/vite/bin/vite.js"
    if not vite.exists():
        sys.exit("Install the frontend dependencies first; see README.md.")
    env = dict(os.environ)
    env["PATH"] = str(Path(node).parent) + os.pathsep + env.get("PATH", "")
    processes = []

    def stop(*_):
        for process in processes:
            if process.poll() is None:
                process.terminate()
        for process in processes:
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()

    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    try:
        processes.append(
            subprocess.Popen(
                [
                    str(python),
                    "-m",
                    "uvicorn",
                    "app.main:app",
                    "--host",
                    "127.0.0.1",
                    "--port",
                    "8010",
                ],
                cwd=ROOT / "backend",
                env=env,
            )
        )
        processes.append(
            subprocess.Popen(
                [node, str(vite), "--host", "127.0.0.1", "--port", "5180", "--strictPort"],
                cwd=ROOT / "frontend",
                env=env,
            )
        )
        for _ in range(60):
            if any(p.poll() is not None for p in processes):
                raise RuntimeError(
                    "A service exited. Check the messages above; ports 8010 and 5180 must be free."
                )
            try:
                with urllib.request.urlopen("http://127.0.0.1:8010/api/health", timeout=1):
                    pass
                with urllib.request.urlopen("http://127.0.0.1:5180", timeout=1):
                    pass
                break
            except OSError:
                time.sleep(0.5)
        else:
            raise RuntimeError("The app did not become ready in 30 seconds.")
        print("\nAI Document Search is ready at http://127.0.0.1:5180 — press Ctrl+C to stop.\n")
        if "--no-browser" not in sys.argv:
            webbrowser.open("http://127.0.0.1:5180")
        while all(p.poll() is None for p in processes):
            time.sleep(0.5)
    except KeyboardInterrupt:
        pass
    finally:
        stop()


if __name__ == "__main__":
    main()
