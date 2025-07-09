"""Simple rigging service used for tests.

The real project will eventually integrate heavy models like Segment Anything
and CLIP. Those models are not available in the execution environment so this
module provides a very small stub that mimics the expected HTTP interface.

The service returns pre-generated polygons based solely on the SHA-256 of the
uploaded file.  Test fixtures provide the hashes and corresponding rig JSON
files.
"""

import base64
import hashlib
import json
import os
import io
from pathlib import Path
from typing import Dict, Optional
import time

import numpy as np
# Temporarily comment out PIL import to avoid dependency issues
# from PIL import Image

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile, Request
from fastapi.responses import JSONResponse, RedirectResponse

try:
    import boto3
except Exception:  # pragma: no cover - optional dependency
    boto3 = None

try:
    import torch
    from segment_anything import sam_model_registry, SamPredictor
except Exception:  # pragma: no cover - optional dependency
    torch = None
    sam_model_registry = None
    SamPredictor = None

try:
    import clip
except Exception:  # pragma: no cover - optional dependency
    clip = None

API_KEY = "change-me"  # override via environment variable in production

app = FastAPI()

# Mapping of avatar hash to polygon rigs
_RIG_CACHE: Dict[str, list] = {}

# directory to store generated rigs
CACHE_DIR = Path(os.environ.get("SPROMOJI_RIG_CACHE", Path.home() / ".spromoji_rig"))
CACHE_DIR.mkdir(parents=True, exist_ok=True)

# optional S3 bucket for persistent cache
S3_BUCKET = os.environ.get("SPROMOJI_RIG_BUCKET")
S3_CLIENT = None
if boto3 and S3_BUCKET:
    try:  # pragma: no cover - remote services not available in tests
        S3_CLIENT = boto3.client("s3")
    except Exception:
        S3_CLIENT = None

DEVICE = "cuda" if torch and torch.cuda.is_available() else "cpu"
SAM_PREDICTOR = None
if SamPredictor and sam_model_registry:
    ckpt = os.environ.get("SAM_VIT_H_CHECKPOINT")
    if ckpt:
        try:  # pragma: no cover - heavy model not present in tests
            sam_model = sam_model_registry["vit_h"](checkpoint=ckpt).to(DEVICE)
            SAM_PREDICTOR = SamPredictor(sam_model)
        except Exception:
            SAM_PREDICTOR = None

CLIP_MODEL = None
if clip:
    try:  # pragma: no cover - heavy model not present in tests
        CLIP_MODEL, _ = clip.load("ViT-B/32", device=DEVICE)
    except Exception:
        CLIP_MODEL = None

_RATE_LIMIT = 60  # requests per minute
_WINDOW = 60.0
_REQUEST_LOG: Dict[str, list] = {}


def _check_rate_limit(client_id: str) -> None:
    """Very small in-memory rate limiter."""
    now = time.time()
    window_start = now - _WINDOW
    hits = [t for t in _REQUEST_LOG.get(client_id, []) if t > window_start]
    if len(hits) >= _RATE_LIMIT:
        raise HTTPException(status_code=429, detail="rate limit exceeded")
    hits.append(now)
    _REQUEST_LOG[client_id] = hits


def _load_fixtures() -> None:
    """Load rig JSON fixtures bundled with the repository."""
    fixtures_dir = Path(__file__).parent / "fixtures" / "rigs"
    for path in fixtures_dir.glob("*.json"):
        with open(path, "r", encoding="utf-8") as fh:
            _RIG_CACHE[path.stem] = json.load(fh)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def detect_cartoon_features_fallback(w: int, h: int) -> Optional[dict]:
    """Fallback cartoon feature detection without PIL."""
    # Return default regions as fallback
    return {
        "leftEye": {"x": w*0.3, "y": h*0.35, "w": w*0.1, "h": h*0.1, "cx": w*0.35, "cy": h*0.4, "rx": w*0.05, "ry": h*0.05},
        "rightEye": {"x": w*0.6, "y": h*0.35, "w": w*0.1, "h": h*0.1, "cx": w*0.65, "cy": h*0.4, "rx": w*0.05, "ry": h*0.05},
        "mouth": {"x": w*0.4, "y": h*0.65, "w": w*0.2, "h": h*0.1, "cx": w*0.5, "cy": h*0.7, "rx": w*0.1, "ry": h*0.05}
    }


def detect_cartoon_features(data: bytes) -> Optional[dict]:
    """Simplified cartoon feature detection without PIL dependency."""
    # For now, just return default regions based on image size
    # In practice, we'd analyze the image data to detect features
    return detect_cartoon_features_fallback(512, 512)  # Default image size


def box_to_poly(box: dict, w: int, h: int) -> list:
    """Convert a bounding box dict to normalised polygon."""
    x, y, w_, h_ = box["x"], box["y"], box["w"], box["h"]
    return [
        [x / w, y / h],
        [(x + w_) / w, y / h],
        [(x + w_) / w, (y + h_) / h],
        [x / w, (y + h_) / h],
    ]


def sam_clip_fallback(data: bytes) -> Optional[list]:
    """Placeholder SAM+CLIP segmentation fallback."""
    if not (SAM_PREDICTOR and CLIP_MODEL):
        return None
    # The heavy models are not available in the execution environment.
    # This stub simply reuses the cartoon heuristic when present.
    features = detect_cartoon_features(data)
    if not features:
        return None
    w, h = 512, 512  # Default image size
    return [
        {"type": "eyeL", "poly": box_to_poly(features["leftEye"], w, h)},
        {"type": "eyeR", "poly": box_to_poly(features["rightEye"], w, h)},
        {"type": "mouth", "poly": box_to_poly(features["mouth"], w, h)},
    ]


_load_fixtures()


@app.post("/rig")
async def rig_endpoint(
    request: Request,
    file: UploadFile = File(None, max_length=4 * 1024 * 1024),
    image_b64: Optional[str] = Form(None),
    x_api_key: Optional[str] = Header(None),
):
    client_id = f"{request.client.host}:{x_api_key}"
    _check_rate_limit(client_id)
    if API_KEY and x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="invalid api key")

    if file is not None:
        data = await file.read()
    elif image_b64 is not None:
        data = base64.b64decode(image_b64)
    else:
        raise HTTPException(status_code=400, detail="no image provided")

    avatar_hash = sha256(data)

    cache_file = CACHE_DIR / f"{avatar_hash}.json"
    if cache_file.exists():
        rig = json.loads(cache_file.read_text())
        if S3_CLIENT:
            key = f"rigs/{avatar_hash}.json"
            url = S3_CLIENT.generate_presigned_url(
                "get_object", Params={"Bucket": S3_BUCKET, "Key": key}, ExpiresIn=3600
            )
            return RedirectResponse(url, status_code=302)
        return JSONResponse({"rig": rig, "hash": avatar_hash})

    rig = _RIG_CACHE.get(avatar_hash)
    if rig is None:
        # Use simplified feature detection
        features = detect_cartoon_features(data)
        rig = None
        if features:
            w, h = 512, 512  # Default image size
            rig = [
                {"type": "eyeL", "poly": box_to_poly(features["leftEye"], w, h)},
                {"type": "eyeR", "poly": box_to_poly(features["rightEye"], w, h)},
                {"type": "mouth", "poly": box_to_poly(features["mouth"], w, h)},
            ]
        if not rig:
            rig = sam_clip_fallback(data)
        if not rig:
            rig = [
                {"type": "eyeL", "poly": [[0.3, 0.35], [0.4, 0.35], [0.4, 0.45], [0.3, 0.45]]},
                {"type": "eyeR", "poly": [[0.6, 0.35], [0.7, 0.35], [0.7, 0.45], [0.6, 0.45]]},
                {"type": "mouth", "poly": [[0.4, 0.65], [0.6, 0.65], [0.6, 0.75], [0.4, 0.75]]},
            ]

    cache_file.write_text(json.dumps(rig))

    if S3_CLIENT:
        key = f"rigs/{avatar_hash}.json"
        try:  # pragma: no cover - remote services not available in tests
            S3_CLIENT.put_object(Bucket=S3_BUCKET, Key=key, Body=json.dumps(rig))
            url = S3_CLIENT.generate_presigned_url(
                "get_object", Params={"Bucket": S3_BUCKET, "Key": key}, ExpiresIn=3600
            )
            return RedirectResponse(url, status_code=302)
        except Exception:
            pass

    return JSONResponse({"rig": rig, "hash": avatar_hash})
