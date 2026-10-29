FROM python:3.10-slim-bookworm AS system
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources \
    && rm -f /etc/apt/apt.conf.d/docker-clean \
    && apt-get -o Acquire::Retries=3 update \
    && apt-get -o Acquire::Retries=3 install -y --no-install-recommends ca-certificates ffmpeg libsndfile1 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

FROM system AS dependencies
RUN python -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH
COPY requirements.torch-cpu.txt /tmp/requirements/
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install pip==25.3 setuptools==80.9.0 wheel==0.45.1 \
    && pip install --index-url https://download.pytorch.org/whl/cpu -r /tmp/requirements/requirements.torch-cpu.txt
COPY requirements.container.txt /tmp/requirements/
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --prefer-binary -c /tmp/requirements/requirements.torch-cpu.txt -r /tmp/requirements/requirements.container.txt \
    && pip freeze > /opt/engine-installed.txt

FROM system AS runtime
ENV PATH=/opt/venv/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUTF8=1 \
    ENGINE_HOST=0.0.0.0 \
    SILERO_VAD_BACKEND=package \
    HF_HOME=/home/tts/.cache/huggingface \
    TORCH_HOME=/home/tts/.cache/torch \
    NUMBA_CACHE_DIR=/home/tts/.cache/numba \
    XDG_CACHE_HOME=/home/tts/.cache \
    OPENVOICE_CHECKPOINT_DIR=/app/engine/checkpoints/converter \
    OPENVOICE_MODEL_REVISION=ea66dc9353e660b1dbbe0bebebd4c2d8b105483c \
    BOOK_ARTIFACT_ROOT=/app/backend/data/book-audio \
    AUDIO_ROOT=/app/backend/public/audio

# Match the Backend image UID/GID for the upcoming shared volumes.
RUN groupadd --gid 1000 tts \
    && useradd --uid 1000 --gid 1000 --create-home tts \
    && mkdir -p /app/engine/checkpoints/converter /app/engine/processed \
        /app/backend/data/book-audio /app/backend/public/audio/samples \
        /app/backend/public/audio/generated /home/tts/.cache \
    && chown -R tts:tts /app /home/tts
COPY --from=dependencies /opt/venv /opt/venv
COPY --from=dependencies /opt/engine-installed.txt /opt/engine-installed.txt
WORKDIR /app/engine
COPY --chown=tts:tts main.py tts_pipeline.py book_audio.py runtime_paths.py ./
COPY --chown=tts:tts core_tts/ ./core_tts/
COPY --chown=tts:tts openvoice/ ./openvoice/
USER tts
EXPOSE 8000
CMD ["python", "-u", "main.py"]
