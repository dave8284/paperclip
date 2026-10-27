"""One-time, opt-in local speech setup for Apple Silicon; Python 3.12.

Usage: python3.12 scripts/setup-friday-voice.py /absolute/private/voice-directory
No services are registered. Models download only during this explicit setup.
"""
import hashlib
import json
import platform
from pathlib import Path
import subprocess
import sys
import urllib.request
import venv

if sys.version_info[:2] != (3, 12) or platform.system() != "Darwin" or platform.machine() != "arm64":
    raise SystemExit("This MLX speech setup requires Apple Silicon macOS and Python 3.12.")
if len(sys.argv) != 2:
    raise SystemExit(__doc__)
root = Path(sys.argv[1]).expanduser().resolve()
root.mkdir(parents=True, exist_ok=True, mode=0o700)
if not (root / "venv/bin/python").exists():
    venv.create(root / "venv", with_pip=True)
subprocess.run([str(root / "venv/bin/python"), "-m", "pip", "install", "mlx-whisper==0.4.3", "kokoro-onnx==0.6.1", "soundfile==0.13.1"], check=True)
manifest = json.loads(Path(__file__).with_name("friday-voice-models.json").read_text())
for item in manifest["models"]:
    target = root / item["path"]
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        with target.open("rb") as source:
            if hashlib.file_digest(source, "sha256").hexdigest() == item["sha256"]:
                continue
        raise SystemExit(f"Checksum mismatch in {target}; inspect it before replacing.")
    partial = target.with_suffix(target.suffix + ".part")
    urllib.request.urlretrieve(item["url"], partial)
    with partial.open("rb") as source:
        if hashlib.file_digest(source, "sha256").hexdigest() != item["sha256"]:
            partial.unlink()
            raise SystemExit(f"Download checksum mismatch: {item['path']}")
    partial.replace(target)
print(f"Ready. Set AGENTOS_VOICE_HOME={root} in the server's private environment, then restart.")
