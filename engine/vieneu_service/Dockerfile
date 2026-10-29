# Reuse the cached OS/FFmpeg layer. Python dependencies stay isolated.
# Compose supplies the Engine image as engine_os and builds it first if needed.
# Optional local reuse of this same SDK image avoids downloading dependencies
# again for an app.py-only update. A clean build still uses engine_os by default.
ARG VIENEU_BASE_IMAGE=engine_os
FROM ${VIENEU_BASE_IMAGE}
USER root
ENV PATH=/opt/vieneu-venv/bin:/usr/local/bin:/usr/bin:/bin \
    PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 HF_HOME=/home/tts/.cache/huggingface
RUN /usr/local/bin/python -m venv /opt/vieneu-venv
COPY requirements.txt /tmp/vieneu-requirements.txt
RUN --mount=type=cache,target=/root/.cache/pip \
    PIP_CACHE_DIR=/root/.cache/pip pip install --disable-pip-version-check -r /tmp/vieneu-requirements.txt
WORKDIR /app/vieneu
COPY --chown=tts:tts app.py ./
USER tts
EXPOSE 8001
CMD ["uvicorn","app:app","--host","0.0.0.0","--port","8001"]
