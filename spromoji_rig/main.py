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

import numpy as np
from PIL import Image

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import JSONResponse

API_KEY = "change-me"  # override via environment variable in production

app = FastAPI()

# Mapping of avatar hash to polygon rigs
_RIG_CACHE: Dict[str, list] = {}

# directory to store generated rigs
CACHE_DIR = Path(os.environ.get("SPROMOJI_RIG_CACHE", Path.home() / ".spromoji_rig"))
CACHE_DIR.mkdir(parents=True, exist_ok=True)


def _load_fixtures() -> None:
    """Load rig JSON fixtures bundled with the repository."""
    fixtures_dir = Path(__file__).parent / "fixtures" / "rigs"
    for path in fixtures_dir.glob("*.json"):
        with open(path, "r", encoding="utf-8") as fh:
            _RIG_CACHE[path.stem] = json.load(fh)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def detect_cartoon_features(img: Image) -> Optional[dict]:
    """Heuristic cartoon eye/mouth detection.

    This mirrors the browser implementation from static/autoRegions.js.
    It looks for dark/light eye clusters and a mouth gradient line.  The
    returned dictionary contains leftEye, rightEye and mouth rectangles or
    ``None`` when confidence is too low.
    """
    img = img.convert("RGB")
    w, h = img.size
    arr = np.asarray(img, dtype=np.float32) / 255.0

    r = arr[:, :, 0]
    g = arr[:, :, 1]
    b = arr[:, :, 2]
    maxc = np.maximum.reduce([r, g, b])
    minc = np.minimum.reduce([r, g, b])
    v = maxc
    s = np.where(maxc == 0, 0, (maxc - minc) / maxc)

    gray = 0.299 * r + 0.587 * g + 0.114 * b

    # Simple gradient approximation like the JS code
    grad_x = np.abs(np.diff(gray, axis=1, append=gray[:, -1:]))
    grad_y = np.abs(np.diff(gray, axis=0, append=gray[-1:, :]))
    grad = grad_x + grad_y

    dark_mask = (~((s < 0.25) & (v > 0.85))) & (gray < 0.4)
    light_mask = (s < 0.25) & (v > 0.85)

    dark_pts = np.column_stack(np.nonzero(dark_mask))
    light_pts = np.column_stack(np.nonzero(light_mask))

    eye_pts = []
    if dark_pts.shape[0] >= 20 and light_pts.shape[0] >= 20:
        eye_pts = np.concatenate([dark_pts, light_pts])
    elif dark_pts.shape[0] >= 20:
        eye_pts = dark_pts
    elif light_pts.shape[0] >= 20:
        eye_pts = light_pts
    if len(eye_pts) < 20:
        return None

    pts = eye_pts.astype(np.float32)
    # initialise two centroids spaced across the image
    centroids = np.array([
        pts[int(len(pts) * 0.25)],
        pts[int(len(pts) * 0.75)],
    ], dtype=np.float32)

    for _ in range(5):
        dists = []
        for c in centroids:
            dx = pts[:, 1] - c[1]
            dy = (pts[:, 0] - c[0]) * 0.5
            dists.append(dx * dx + dy * dy)
        dists = np.stack(dists, axis=1)
        labels = dists.argmin(axis=1)
        for i in range(2):
            sel = pts[labels == i]
            if len(sel):
                centroids[i] = sel.mean(axis=0)

    clusters = []
    for i in range(2):
        sel = pts[labels == i]
        if not len(sel):
            return None
        min_y, min_x = sel.min(axis=0)
        max_y, max_x = sel.max(axis=0)
        clusters.append({
            "cx": float(centroids[i][1]),
            "cy": float(centroids[i][0]),
            "w": float(max_x - min_x),
            "h": float(max_y - min_y),
        })

    clusters.sort(key=lambda c: c["cx"])
    sep = clusters[1]["cx"] - clusters[0]["cx"]
    confidence = min(1.0, sep / (w * 0.5))
    if confidence < 0.6:
        return None

    pad = 5

    def ellipse_from_cluster(c):
        rx = max(c["w"], 10) / 2 + pad
        ry = max(c["h"], 10) / 2 + pad
        cx = c["cx"]
        cy = c["cy"]
        return {
            "x": cx - rx,
            "y": cy - ry,
            "w": rx * 2,
            "h": ry * 2,
            "cx": cx,
            "cy": cy,
            "rx": rx,
            "ry": ry,
        }

    left = ellipse_from_cluster(clusters[0])
    right = ellipse_from_cluster(clusters[1])

    mid_y = (clusters[0]["cy"] + clusters[1]["cy"]) / 2
    grad_rows = grad[int(mid_y) :, :].sum(axis=1)
    if len(grad_rows) == 0:
        return None
    best_y_offset = int(grad_rows.argmax())
    best_y = int(mid_y) + best_y_offset

    row = grad[best_y]
    threshold = row.max() * 0.3
    cols = np.nonzero(row > threshold)[0]
    if len(cols) == 0:
        left_edge = int(w * 0.3)
        right_edge = int(w * 0.7)
    else:
        left_edge = cols.min()
        right_edge = cols.max()
    mh = int(h * 0.2)
    mouth_x = max(left_edge - 10, 0)
    mouth_y = max(best_y - mh // 2, mid_y)
    mouth_w = min(right_edge - left_edge + 20, w)
    mouth_h = min(mh, h - mouth_y)
    mouth = {
        "x": float(mouth_x),
        "y": float(mouth_y),
        "w": float(mouth_w),
        "h": float(mouth_h),
        "cx": float(mouth_x + mouth_w / 2),
        "cy": float(mouth_y + mouth_h / 2),
        "rx": float(mouth_w / 2),
        "ry": float(mouth_h / 2),
    }

    return {"leftEye": left, "rightEye": right, "mouth": mouth}


_load_fixtures()


@app.post("/rig")
async def rig_endpoint(
    file: UploadFile = File(None),
    image_b64: Optional[str] = Form(None),
    x_api_key: Optional[str] = Header(None),
):
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
        return JSONResponse({"rig": rig, "hash": avatar_hash})

    rig = _RIG_CACHE.get(avatar_hash)
    if rig is None:
        img = Image.open(io.BytesIO(data))
        features = detect_cartoon_features(img)
        if features:
            w, h = img.size
            def box_to_poly(box):
                x, y, w_, h_ = box["x"], box["y"], box["w"], box["h"]
                return [
                    [x / w, y / h],
                    [(x + w_) / w, y / h],
                    [(x + w_) / w, (y + h_) / h],
                    [x / w, (y + h_) / h],
                ]

            rig = [
                {"type": "eyeL", "poly": box_to_poly(features["leftEye"])},
                {"type": "eyeR", "poly": box_to_poly(features["rightEye"])},
                {"type": "mouth", "poly": box_to_poly(features["mouth"])},
            ]
        else:
            rig = [
                {"type": "eyeL", "poly": [[0.3, 0.35], [0.4, 0.35], [0.4, 0.45], [0.3, 0.45]]},
                {"type": "eyeR", "poly": [[0.6, 0.35], [0.7, 0.35], [0.7, 0.45], [0.6, 0.45]]},
                {"type": "mouth", "poly": [[0.4, 0.65], [0.6, 0.65], [0.6, 0.75], [0.4, 0.75]]},
            ]

    cache_file.write_text(json.dumps(rig))
    return JSONResponse({"rig": rig, "hash": avatar_hash})
