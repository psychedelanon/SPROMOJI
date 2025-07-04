import hashlib
import base64
import io
from typing import Optional

from fastapi import FastAPI, UploadFile, File, Form, Header, HTTPException
from fastapi.responses import JSONResponse
from PIL import Image

API_KEY = "change-me"  # override via environment variable in production

app = FastAPI()

def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

@app.post("/rig")
async def rig_endpoint(
    file: UploadFile = File(None),
    image_b64: Optional[str] = Form(None),
    x_api_key: Optional[str] = Header(None)
):
    if API_KEY and x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="invalid api key")

    if file is not None:
        data = await file.read()
    elif image_b64 is not None:
        data = base64.b64decode(image_b64)
    else:
        raise HTTPException(status_code=400, detail="no image provided")

    # Placeholder rig detection
    Image.open(io.BytesIO(data)).convert("RGB")
    rig = [
        {"type": "eyeL", "poly": [[0.3, 0.35], [0.4, 0.35], [0.4, 0.45], [0.3, 0.45]]},
        {"type": "eyeR", "poly": [[0.6, 0.35], [0.7, 0.35], [0.7, 0.45], [0.6, 0.45]]},
        {"type": "mouth", "poly": [[0.4, 0.65], [0.6, 0.65], [0.6, 0.75], [0.4, 0.75]]}
    ]
    return JSONResponse({"rig": rig, "hash": sha256(data)})
