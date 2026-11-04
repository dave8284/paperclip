"""Pinned offline Laya worker. One active request, no HTTP listener or external fallback."""
import contextlib
import json
import hashlib
import os
from pathlib import Path
import sys

PIN = {"sdkVersion": "0.4.22", "model": "convaiinnovations/laya",
       "revision": "7b928d828b7b0e022f929d9bd2e44165aa270148", "checkpoint": "typed-decisions"}

FILES = {
    "model.safetensors": "4fa56de72383a9d3efa9cfa78955733c81b9fc8067a587ca4beb82c78107a24e",
    "encoder/config.json": "5268d24ad3b77c8151de5dcb0762ba4391619aad9ab0bda33e36fb083cfeae6d",
    "rl_agent_config.json": "ebf0cd524d92342a6be5e48e9fca3d7c2babfb5a56ccd79d2171ef5d8c7f7be8",
    "tokenizer/tokenizer.json": "6c8aaa9a542084f2457eab775d4eeb51f92a70c0fd9de28d5edb0ddec3c08d30",
    "tokenizer/tokenizer_config.json": "08d4cf3ac4dca381759441b85b91a6d40e688471dcd33d15d6649eb0a9a854d1",
}


def verify_checkpoint(directory):
    for name, expected in FILES.items():
        digest = hashlib.sha256()
        with (directory / name).open("rb") as file:
            for chunk in iter(lambda: file.read(1024 * 1024), b""):
                digest.update(chunk)
        if digest.hexdigest() != expected:
            raise ValueError("Local checkpoint content mismatch")


def respond(value):
    print(json.dumps(value, allow_nan=False, separators=(",", ":")), flush=True)


def predict(agent, request):
    if not isinstance(request, dict) or set(request) != {"state", "questions"}:
        return {"status": "abstained", "reason": "local_input_invalid"}
    questions = request["questions"]
    if not isinstance(questions, dict) or not 1 <= len(questions) <= 4 or any(
        not isinstance(q, dict) or q.get("type") != "choice" or not isinstance(q.get("criteria"), dict)
        or not 2 <= len(q["criteria"]) <= 10 for q in questions.values()
    ):
        return {"status": "abstained", "reason": "local_input_invalid"}
    with contextlib.redirect_stdout(sys.stderr):
        result = agent.predict(request["state"], questions)
    usage = result.get("usage", {})
    # The SDK reports actual tokenizer truncation and option collapse; character counts cannot prove fit.
    if usage.get("truncated") is not False or usage.get("state_tokens_dropped", 0) != 0:
        return {"status": "abstained", "reason": "local_context_truncated"}
    if usage.get("options"):
        return {"status": "abstained", "reason": "local_options_collapsed"}
    return {"status": "succeeded", "answers": result["answers"],
            "inputTokens": usage.get("input_tokens"), "outputTokens": usage.get("output_tokens")}


def main():
    os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1",
                      TOKENIZERS_PARALLELISM="false", USE_TF="0")
    directory = Path(sys.argv[1])
    if not directory.is_absolute() or json.loads((directory / "agentos-model.json").read_text()) != PIN:
        raise ValueError("Local checkpoint pin mismatch")
    verify_checkpoint(directory / PIN["checkpoint"])
    with contextlib.redirect_stdout(sys.stderr):
        import laya
        if laya.__version__ != PIN["sdkVersion"]:
            raise ValueError("Local SDK pin mismatch")
        # An absolute directory prevents aliases/router choices and offline flags forbid downloads.
        agent = laya.load(str(directory / PIN["checkpoint"]), device="cpu", backend="eager")
    respond({"type": "ready", **PIN})
    while True:
        line = sys.stdin.buffer.readline(33_002)
        if not line:
            break
        if len(line) > 33_000 or not line.endswith(b"\n"):
            raise ValueError("Oversized local input")
        row = json.loads(line)
        if not isinstance(row.get("id"), str) or len(row["id"]) > 80:
            raise ValueError("Invalid local request binding")
        try:
            response = predict(agent, row.get("request"))
        except Exception:
            response = {"status": "abstained", "reason": "local_inference_failed"}
        respond({"id": row["id"], **response})


if __name__ == "__main__":
    main()
