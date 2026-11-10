FROM python:3.10-slim-bookworm

ARG TORCH_BUILD=cpu
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 \
    HF_HOME=/home/tts/.cache/huggingface \
    BOOK_ARTIFACT_ROOT=/app/backend/data/book-audio

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates ffmpeg libgomp1 libsndfile1 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 1000 tts \
    && useradd --uid 1000 --gid 1000 --create-home tts \
    && mkdir -p "$BOOK_ARTIFACT_ROOT" "$HF_HOME" \
    && chown -R tts:tts /app /home/tts

RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --upgrade pip \
    && pip install --index-url "https://download.pytorch.org/whl/${TORCH_BUILD}" \
        "torch==2.8.0+${TORCH_BUILD}" "torchaudio==2.8.0+${TORCH_BUILD}" \
    && pip install omnivoice==0.2.1 fastapi uvicorn \
        "torch==2.8.0+${TORCH_BUILD}" "torchaudio==2.8.0+${TORCH_BUILD}" \
    && pip check

WORKDIR /app/omnivoice
COPY --chown=tts:tts app.py ./
USER tts
EXPOSE 8002
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8002"]
