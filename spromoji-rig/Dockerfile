FROM python:3.11-slim
WORKDIR /app
RUN pip install --no-cache-dir segment_anything open_clip_torch opencv-python uvicorn fastapi
COPY main.py ./
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
