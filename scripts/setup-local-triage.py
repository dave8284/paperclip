"""Prepare the pinned, isolated Laya runtime for Apple Silicon macOS / Python 3.12.

Usage: python3.12 scripts/setup-local-triage.py /absolute/private/laya-directory [--offline]
Downloads public pinned artifacts only during explicit setup. Installs no service
and does not change the server environment or enable local triage.
--offline requires all wheels under downloads/ and the pinned model files in place.
"""
import argparse
import hashlib
import json
import os
import platform
from pathlib import Path
import subprocess
import sys
import urllib.request
import venv


def verify(target, artifact):
    if not target.is_file() or target.stat().st_size != artifact["size"]:
        return False
    with target.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest() == artifact["sha256"]


def ensure_artifact(target, artifact, offline):
    if target.exists():
        if verify(target, artifact):
            return
        raise RuntimeError(f"Checksum mismatch: {target.name}. Inspect it before replacing.")
    if offline:
        raise RuntimeError(f"Missing offline artifact: {target.name}")
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_name(target.name + ".part")
    with urllib.request.urlopen(artifact["url"], timeout=60) as source, partial.open("wb") as output:
        copied = 0
        while chunk := source.read(1024 * 1024):
            copied += len(chunk)
            if copied > artifact["size"]:
                raise RuntimeError(f"Download exceeds pinned size: {target.name}")
            output.write(chunk)
    if not verify(partial, artifact):
        raise RuntimeError(f"Download checksum mismatch: {target.name}")
    partial.replace(target)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path)
    parser.add_argument("--offline", action="store_true")
    args = parser.parse_args()
    if sys.version_info[:2] != (3, 12) or platform.system() != "Darwin" or platform.machine() != "arm64" or int(platform.mac_ver()[0].split(".")[0]) < 14:
        parser.error("This pinned wheel set requires Python 3.12 on Apple Silicon macOS 14 or newer.")
    root = args.root.expanduser().resolve()
    manifest = json.loads(Path(__file__).with_name("local-triage-models.json").read_text())
    identity = manifest["identity"]
    model_dir = root / "models" / f"convaiinnovations-laya-{identity['revision']}"
    wheels = root / "downloads"
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    for artifact in manifest["packages"]:
        ensure_artifact(wheels / artifact["filename"], artifact, args.offline)
    for artifact in manifest["models"]:
        ensure_artifact(model_dir / artifact["path"], artifact, args.offline)
    python = root / "venv/bin/python"
    if not python.exists():
        venv.create(root / "venv", with_pip=True)
    # Refuse an existing environment that sees another environment's packages.
    config = (root / "venv/pyvenv.cfg").read_text().lower()
    if "include-system-site-packages = false" not in config:
        raise RuntimeError("The Laya environment must exclude system site packages.")
    subprocess.run([str(python), "-I", "-c", "import sys; from pathlib import Path; assert sys.prefix != sys.base_prefix; assert Path(sys.prefix).resolve() == Path(sys.argv[1]).resolve(); assert sys.version_info[:2] == (3, 12)", str(root / "venv")], check=True)
    requirements = root / "packages.lock"
    requirements.write_text("".join(f"{item['package']}=={item['version']} --hash=sha256:{item['sha256']}\n" for item in manifest["packages"]))
    # A caller's PIP_TARGET/PREFIX/USER or pip.conf must not redirect installation
    # into the voice environment, user site, or another prefix.
    env = {key: value for key, value in os.environ.items() if not key.startswith("PIP_") and key not in {"PYTHONPATH", "PYTHONHOME"}}
    env.update(PIP_CONFIG_FILE=os.devnull, PIP_NO_INDEX="1", PIP_NO_CACHE_DIR="1", PIP_DISABLE_PIP_VERSION_CHECK="1", HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1", USE_TF="0")
    subprocess.run([str(python), "-I", "-m", "pip", "install", "--no-index", "--find-links", str(wheels), "--require-hashes", "-r", str(requirements)], env=env, check=True)
    subprocess.run([str(python), "-I", "-m", "pip", "check"], env=env, check=True)
    subprocess.run([str(python), "-I", "-c", "import laya, torch, transformers; assert laya.__version__ == '0.4.22'; print('Pinned Laya imports verified.')"], env=env, check=True)
    (model_dir / "agentos-model.json").write_text(json.dumps(identity, indent=2) + "\n")
    print(json.dumps({"status": "prepared", "inferenceVerified": False, "serverEnvironmentChanged": False, "python": str(python), "modelDir": str(model_dir), **identity}, indent=2))


if __name__ == "__main__":
    main()
