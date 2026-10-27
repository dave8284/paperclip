"""Private JSON-lines speech worker. No HTTP listener; parent owns lifecycle."""
import base64, contextlib, io, json, os, sys
from pathlib import Path
root = Path(os.environ["AGENTOS_VOICE_HOME"])
speech = None
prepared = False

def handle(message):
    global speech, prepared
    import numpy as np
    import soundfile as sf
    if message["op"] == "prepare":
        if not prepared:
            import mlx_whisper
            from kokoro_onnx import Kokoro
            # Prime local model loading/compilation with synthetic silence only.
            # No microphone access or network model download is involved.
            mlx_whisper.transcribe(np.zeros(16000, dtype=np.float32), path_or_hf_repo=str(root / "whisper"), language="en", condition_on_previous_text=False, temperature=0.0, verbose=False)
            if speech is None: speech = Kokoro(str(root / "kokoro-v1.0.onnx"), str(root / "voices-v1.0.bin"))
            prepared = True
        return {"ready": True}
    if message["op"] == "speak":
        if speech is None:
            from kokoro_onnx import Kokoro
            speech = Kokoro(str(root / "kokoro-v1.0.onnx"), str(root / "voices-v1.0.bin"))
        samples, rate = speech.create(message["text"], voice="af_heart", speed=1.0, lang="en-us")
        stream = io.BytesIO()
        sf.write(stream, samples, rate, format="WAV", subtype="PCM_16")
        return {"audio": base64.b64encode(stream.getvalue()).decode(), "sampleRate": rate}
    if message["op"] == "transcribe":
        import mlx_whisper
        from scipy.signal import resample_poly
        from math import gcd
        audio, rate = sf.read(io.BytesIO(base64.b64decode(message["audio"])), dtype="float32")
        if audio.ndim > 1: audio = audio.mean(axis=1)
        if len(audio) > rate * 65: raise ValueError("Audio turn is too long")
        if rate != 16000:
            divisor = gcd(rate, 16000)
            audio = resample_poly(audio, 16000 // divisor, rate // divisor).astype(np.float32)
        if not len(audio) or float(np.sqrt(np.mean(audio ** 2))) < 0.002: return {"text": ""}
        result = mlx_whisper.transcribe(audio, path_or_hf_repo=str(root / "whisper"), language="en", condition_on_previous_text=False, temperature=0.0, verbose=False)
        return {"text": result["text"].strip()}
    raise ValueError("Unsupported voice operation")

for line in sys.stdin:
    request = json.loads(line)
    try:
        # Libraries may emit progress. Never mix it with the protocol.
        with contextlib.redirect_stdout(sys.stderr):
            result = handle(request)
        print(json.dumps({"id": request["id"], "result": result}), flush=True)
    except Exception as error:
        # Do not include transcripts or audio in logs/errors.
        print(json.dumps({"id": request["id"], "error": type(error).__name__}), flush=True)
