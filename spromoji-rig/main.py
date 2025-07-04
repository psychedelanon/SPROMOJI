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
from pathlib import Path
from typing import Dict, Optional

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import JSONResponse

API_KEY = "change-me"  # override via environment variable in production

app = FastAPI()

# Mapping of avatar hash to polygon rigs
_RIG_CACHE: Dict[str, list] = {}


def _load_fixtures() -> None:
    """Load rig JSON fixtures bundled with the repository."""
    fixtures_dir = Path(__file__).parent / "fixtures" / "rigs"
    for path in fixtures_dir.glob("*.json"):
        with open(path, "r", encoding="utf-8") as fh:
            _RIG_CACHE[path.stem] = json.load(fh)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


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
    rig = _RIG_CACHE.get(avatar_hash)
    if rig is None:
        # Unknown avatar; return generic square polys
        rig = [
            {"type": "eyeL", "poly": [[0.3, 0.35], [0.4, 0.35], [0.4, 0.45], [0.3, 0.45]]},
            {"type": "eyeR", "poly": [[0.6, 0.35], [0.7, 0.35], [0.7, 0.45], [0.6, 0.45]]},
            {"type": "mouth", "poly": [[0.4, 0.65], [0.6, 0.65], [0.6, 0.75], [0.4, 0.75]]},
        ]

    return JSONResponse({"rig": rig, "hash": avatar_hash})
