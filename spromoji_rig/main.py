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
    # Return proportional regions based on common avatar layouts
    return {
        "leftEye": {"x": w*0.25, "y": h*0.35, "w": w*0.15, "h": h*0.12, "cx": w*0.325, "cy": h*0.41, "rx": w*0.075, "ry": h*0.06},
        "rightEye": {"x": w*0.6, "y": h*0.35, "w": w*0.15, "h": h*0.12, "cx": w*0.675, "cy": h*0.41, "rx": w*0.075, "ry": h*0.06},
        "mouth": {"x": w*0.35, "y": h*0.65, "w": w*0.3, "h": h*0.15, "cx": w*0.5, "cy": h*0.725, "rx": w*0.15, "ry": h*0.075}
    }


def get_image_dimensions(data: bytes) -> tuple:
    """Get image dimensions from image data without PIL."""
    try:
        # Try to read basic image format headers
        if data[:4] == b'\x89PNG':
            # PNG format
            if len(data) > 24:
                width = int.from_bytes(data[16:20], byteorder='big')
                height = int.from_bytes(data[20:24], byteorder='big')
                return width, height
        elif data[:2] == b'\xff\xd8':
            # JPEG format - basic dimension extraction
            pos = 2
            while pos < len(data) - 8:
                if data[pos] == 0xff and data[pos + 1] == 0xc0:
                    height = int.from_bytes(data[pos + 5:pos + 7], byteorder='big')
                    width = int.from_bytes(data[pos + 7:pos + 9], byteorder='big')
                    return width, height
                pos += 1
        elif data[:6] == b'GIF87a' or data[:6] == b'GIF89a':
            # GIF format
            if len(data) > 10:
                width = int.from_bytes(data[6:8], byteorder='little')
                height = int.from_bytes(data[8:10], byteorder='little')
                return width, height
        elif data[:4] == b'RIFF' and data[8:12] == b'WEBP':
            # WebP format
            if len(data) > 30:
                if data[12:16] == b'VP8 ':
                    # VP8 format
                    width = int.from_bytes(data[26:28], byteorder='little') & 0x3fff
                    height = int.from_bytes(data[28:30], byteorder='little') & 0x3fff
                    return width, height
                elif data[12:16] == b'VP8L':
                    # VP8L format
                    bits = int.from_bytes(data[21:25], byteorder='little')
                    width = (bits & 0x3fff) + 1
                    height = ((bits >> 14) & 0x3fff) + 1
                    return width, height
    except Exception:
        pass
    
    # Default fallback dimensions
    return 512, 512


def analyze_image_content(data: bytes) -> dict:
    """Basic image content analysis without PIL."""
    try:
        # Simple histogram analysis for basic feature detection
        if len(data) < 1000:
            return {}
        
        # Sample pixels throughout the image data
        sample_size = min(10000, len(data) // 4)
        sample_step = len(data) // sample_size
        
        dark_pixels = 0
        light_pixels = 0
        color_pixels = 0
        
        for i in range(0, len(data), sample_step):
            if i + 2 < len(data):
                # Approximate RGB values (this is very rough)
                r = data[i] if i < len(data) else 128
                g = data[i + 1] if i + 1 < len(data) else 128
                b = data[i + 2] if i + 2 < len(data) else 128
                
                # Simple grayscale conversion
                gray = (r * 0.299 + g * 0.587 + b * 0.114) / 255
                
                if gray < 0.3:
                    dark_pixels += 1
                elif gray > 0.7:
                    light_pixels += 1
                
                # Simple color detection
                if abs(r - g) > 30 or abs(g - b) > 30 or abs(r - b) > 30:
                    color_pixels += 1
        
        total_samples = sample_size
        return {
            "dark_ratio": dark_pixels / total_samples if total_samples > 0 else 0,
            "light_ratio": light_pixels / total_samples if total_samples > 0 else 0,
            "color_ratio": color_pixels / total_samples if total_samples > 0 else 0
        }
    except Exception:
        return {}


def detect_cartoon_features(data: bytes) -> Optional[dict]:
    """Enhanced cartoon feature detection without PIL dependency."""
    try:
        # Get image dimensions
        w, h = get_image_dimensions(data)
        
        # Analyze image content
        content_info = analyze_image_content(data)
        
        # Use content analysis to adjust default regions
        base_regions = detect_cartoon_features_fallback(w, h)
        
        # Adjust regions based on content analysis
        if content_info.get("dark_ratio", 0) > 0.3:
            # High contrast image, might need smaller eye regions
            for eye in ["leftEye", "rightEye"]:
                base_regions[eye]["w"] *= 0.8
                base_regions[eye]["h"] *= 0.8
                base_regions[eye]["rx"] *= 0.8
                base_regions[eye]["ry"] *= 0.8
        
        if content_info.get("color_ratio", 0) > 0.5:
            # Colorful image, might need larger mouth region
            base_regions["mouth"]["w"] *= 1.2
            base_regions["mouth"]["h"] *= 1.1
            base_regions["mouth"]["rx"] *= 1.2
            base_regions["mouth"]["ry"] *= 1.1
        
        # Ensure regions stay within image bounds
        for region in base_regions.values():
            region["x"] = max(0, min(region["x"], w - region["w"]))
            region["y"] = max(0, min(region["y"], h - region["h"]))
            region["w"] = max(20, min(region["w"], w - region["x"]))
            region["h"] = max(20, min(region["h"], h - region["y"]))
            region["cx"] = region["x"] + region["w"] / 2
            region["cy"] = region["y"] + region["h"] / 2
            region["rx"] = region["w"] / 2
            region["ry"] = region["h"] / 2
        
        return base_regions
        
    except Exception as e:
        # Final fallback
        return detect_cartoon_features_fallback(512, 512)


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
    if not features or not isinstance(features, dict):
        return None
    
    # Get actual image dimensions
    w, h = get_image_dimensions(data)
    
    # Ensure all required keys exist
    if not all(key in features for key in ["leftEye", "rightEye", "mouth"]):
        return None
    
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
        # Use enhanced feature detection
        features = detect_cartoon_features(data)
        rig = None
        if features and isinstance(features, dict):
            # Get actual image dimensions
            w, h = get_image_dimensions(data)
            
            # Ensure all required keys exist
            if all(key in features for key in ["leftEye", "rightEye", "mouth"]):
                rig = [
                    {"type": "eyeL", "poly": box_to_poly(features["leftEye"], w, h)},
                    {"type": "eyeR", "poly": box_to_poly(features["rightEye"], w, h)},
                    {"type": "mouth", "poly": box_to_poly(features["mouth"], w, h)},
                ]
        
        if not rig:
            rig = sam_clip_fallback(data)
        
        if not rig:
            # Final fallback with better proportions
            rig = [
                {"type": "eyeL", "poly": [[0.25, 0.35], [0.4, 0.35], [0.4, 0.47], [0.25, 0.47]]},
                {"type": "eyeR", "poly": [[0.6, 0.35], [0.75, 0.35], [0.75, 0.47], [0.6, 0.47]]},
                {"type": "mouth", "poly": [[0.35, 0.65], [0.65, 0.65], [0.65, 0.8], [0.35, 0.8]]},
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
