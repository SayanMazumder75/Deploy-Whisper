"""
FastAPI wrapper around faster-whisper for speech-to-text transcription.

Designed to be deployed as a standalone web service (e.g. on Render) and
called server-to-server from the Node/Express backend.

Environment variables:
  PORT            - Port to listen on (Render injects this).
  WHISPER_MODEL   - Model size: tiny | base | small | medium | large-v3.
                    Defaults to "small". On low-RAM hosts use "base" or "tiny".
  WHISPER_DEVICE  - "cpu" (default) or "cuda".
  WHISPER_COMPUTE - "int8" (default for CPU), "float16" for GPU, etc.
  CORS_ORIGINS    - Comma-separated allowed origins, or "*" (default).
"""

import os
import shutil
import sys
import traceback
import uuid

from faster_whisper import WhisperModel
from fastapi import FastAPI, UploadFile, File
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware


def log(msg: str) -> None:
    """Print and flush so Render's log buffer surfaces lines immediately."""
    print(msg, flush=True)


MODEL_SIZE = os.getenv("WHISPER_MODEL", "small")
DEVICE = os.getenv("WHISPER_DEVICE", "cpu")
COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE", "int8")

log(f"[whisper_service] loading model={MODEL_SIZE} device={DEVICE} compute={COMPUTE_TYPE}")
model = WhisperModel(MODEL_SIZE, device=DEVICE, compute_type=COMPUTE_TYPE)
log("[whisper_service] model loaded")

app = FastAPI()

cors_origins_env = os.getenv("CORS_ORIGINS", "*")
allow_origins = ["*"] if cors_origins_env.strip() == "*" else [
    o.strip() for o in cors_origins_env.split(",") if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {
        "service": "whisper",
        "model": MODEL_SIZE,
        "device": DEVICE,
        "compute_type": COMPUTE_TYPE,
    }


@app.get("/healthz")
def healthz():
    return {"status": "ok", "model": MODEL_SIZE}


@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...)):
    temp_path = f"temp_{uuid.uuid4()}.wav"

    with open(temp_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    size_bytes = os.path.getsize(temp_path)
    log(
        f"[transcribe] received file name={file.filename} "
        f"content_type={file.content_type} size={size_bytes / 1024 / 1024:.2f}MB"
    )

    try:
        log("[transcribe] running model.transcribe(beam_size=1, language='en')...")
        segments, info = model.transcribe(temp_path, beam_size=1, language="en")

        # `segments` is a generator; materialise it so we can count + log.
        seg_list = list(segments)
        text = " ".join(segment.text for segment in seg_list)

        log(
            f"[transcribe] done — segments={len(seg_list)} "
            f"text.length={len(text)} language={info.language} "
            f"duration={getattr(info, 'duration', 'n/a')}s"
        )
        if len(text) == 0:
            log(
                "[transcribe] WARNING: 0 segments returned. "
                "Either the input has no detectable speech, or audio decoding failed. "
                "The Node side will skip saving a Transcript document, leading to a 404 "
                "on /api/transcripts/:id and 'Step 1 FAILED' on summary generation."
            )

        return JSONResponse({"text": text, "language": info.language})

    except Exception as e:
        log(f"[transcribe] EXCEPTION: {type(e).__name__}: {e}")
        log(traceback.format_exc())
        return JSONResponse({"text": "", "language": "unknown"})

    finally:
        try:
            os.remove(temp_path)
        except OSError:
            pass
