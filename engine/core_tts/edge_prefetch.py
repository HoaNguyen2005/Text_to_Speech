"""Bounded Edge I/O, independent of the serialized OpenVoice model.

The HTTP caller owns a short-lived session. Closing it cancels only speculative
downloads; final parts remain restart-safe artifacts. Cleanup waits for writers.
"""
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import threading
import time
import uuid

from fastapi import HTTPException
from core_tts.base_tts import EdgeTTSModel, EdgeTTSCancelled
from core_tts.audio_files import duration


def request_signature(request):
    return hashlib.sha256(json.dumps({k: v for k, v in request.model_dump().items()
        if k not in ('reference_audio_url', 'interactive') and (k != 'experimental_cues' or v)}, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


class EdgePrefetch:
    def __init__(self):
        try:
            limit = int(os.getenv('EDGE_TTS_MAX_CONCURRENCY', '3'))
        except ValueError:
            limit = 3
        self.limit = min(3, max(1, limit))
        self.slots = threading.BoundedSemaphore(self.limit)
        self.condition = threading.Condition()
        self.sessions = {}
        self.activities = {}
        self.cleaning = set()
        self.locks = {}

    def open(self, job_id, session_id):
        with self.condition:
            now = time.monotonic()
            for token, state in list(self.sessions.items()):
                if now - state['touched'] > 3600:
                    state['cancel'].set()
                    del self.sessions[token]
            if job_id in self.cleaning:
                raise HTTPException(409, 'Đang dọn âm thanh của yêu cầu.')
            existing = self.sessions.get(session_id)
            if existing:
                if existing['job_id'] != job_id:
                    raise HTTPException(409, 'Phiên tải trước không hợp lệ.')
                return
            # At most one worker session can prefetch for a job after lease takeover.
            for token, state in list(self.sessions.items()):
                if state['job_id'] == job_id:
                    state['cancel'].set()
                    del self.sessions[token]
            if len(self.sessions) >= 32:
                raise HTTPException(503, 'Engine đang có quá nhiều phiên tạo âm thanh.')
            self.sessions[session_id] = {'job_id': job_id, 'cancel': threading.Event(), 'touched': now}

    def close(self, job_id, session_id):
        with self.condition:
            state = self.sessions.get(session_id)
            if state and state['job_id'] == job_id:
                state['cancel'].set()
                del self.sessions[session_id]
            while any(job == job_id and token == session_id for job, token, _ in self.activities.values()):
                self.condition.wait(timeout=0.5)

    @contextmanager
    def activity(self, job_id, session_id=None):
        with self.condition:
            if job_id in self.cleaning:
                raise HTTPException(409, 'Đang dọn âm thanh của yêu cầu.')
            if session_id:
                state = self.sessions.get(session_id)
                if not state or state['job_id'] != job_id or state['cancel'].is_set():
                    raise HTTPException(409, 'Phiên tải trước đã đóng; yêu cầu có thể được tiếp tục.')
                state['touched'] = time.monotonic()
                cancel = state['cancel']
            else:
                cancel = threading.Event()
            key = object()
            self.activities[key] = (job_id, session_id, cancel)
        try:
            yield cancel
        finally:
            with self.condition:
                self.activities.pop(key, None)
                self.condition.notify_all()

    @contextmanager
    def part_lock(self, job_id, part_id, cancel):
        key = (job_id, part_id)
        with self.condition:
            state = self.locks.setdefault(key, [threading.Lock(), 0])
            state[1] += 1
        acquired = False
        try:
            while not acquired:
                self.check(cancel)
                acquired = state[0].acquire(timeout=0.25)
            self.check(cancel)
            yield
        finally:
            if acquired:
                state[0].release()
            with self.condition:
                state[1] -= 1
                if not state[1]:
                    self.locks.pop(key, None)

    @contextmanager
    def cleanup(self, job_id):
        with self.condition:
            while job_id in self.cleaning:
                self.condition.wait(timeout=0.5)
            self.cleaning.add(job_id)
            for token, state in list(self.sessions.items()):
                if state['job_id'] == job_id:
                    state['cancel'].set()
                    del self.sessions[token]
            for job, _, cancel in self.activities.values():
                if job == job_id:
                    cancel.set()
            while any(job == job_id for job, _, _ in self.activities.values()):
                self.condition.wait(timeout=0.5)
        try:
            yield
        finally:
            with self.condition:
                self.cleaning.remove(job_id)
                self.condition.notify_all()

    @staticmethod
    def check(cancel):
        if cancel.is_set():
            raise HTTPException(409, detail={'code': 'EDGE_PREFETCH_CLOSED',
                'message': 'Đã dừng tải trước âm thanh.', 'retryable': False})

    @staticmethod
    def discard(directory, part_id):
        for suffix in ('.mp3', '.json'):
            (directory / f'edge_{part_id}{suffix}').unlink(missing_ok=True)

    def prepare(self, request, directory, cancel):
        """Caller owns activity and part_lock; publish only complete audio."""
        self.check(cancel)
        output = directory / f'edge_{request.part_id}.mp3'
        metadata = output.with_suffix('.json')
        signature = request_signature(request)
        if output.is_file() and metadata.is_file():
            try:
                info = json.loads(metadata.read_text(encoding='utf-8'))
                if info.get('signature') == signature and duration(output) > 0:
                    print(f'[EDGE PREFETCH] cache_hit part={request.part_id[:12]}')
                    return output
            except (ValueError, OSError, RuntimeError):
                pass
        start = time.perf_counter()
        acquired = False
        base = None
        meta_tmp = directory / f'edge_{request.part_id}.{uuid.uuid4().hex}.tmp.json'
        try:
            while not acquired:
                self.check(cancel)
                acquired = self.slots.acquire(timeout=0.25)
            self.check(cancel)
            # A fresh instance keeps CLI error/retry state local to this request.
            model = EdgeTTSModel()
            voice = 'vi-VN-NamMinhNeural' if request.gender == 'male' else 'vi-VN-HoaiMyNeural'
            base = Path(model.synthesize(request.text, voice=voice, style_id=request.style,
                strict=True, rate_percent=request.rate_percent, pitch_hz=request.pitch_hz, cancel_event=cancel))
            if duration(base) <= 0:
                raise RuntimeError('Edge-TTS trả âm thanh rỗng.')
            self.check(cancel)
            meta_tmp.write_text(json.dumps({'signature': signature}), encoding='utf-8')
            # Same filesystem: temp cache and artifacts may be on different drives.
            import shutil
            staging = output.with_suffix('.tmp.mp3')
            try:
                shutil.copyfile(base, staging)
                self.check(cancel)
                staging.replace(output)
                meta_tmp.replace(metadata)
            finally:
                staging.unlink(missing_ok=True)
            print(f'[EDGE PREFETCH] ready part={request.part_id[:12]} seconds={time.perf_counter()-start:.2f}')
            return output
        finally:
            if acquired:
                self.slots.release()
            meta_tmp.unlink(missing_ok=True)
            if base:
                base.unlink(missing_ok=True)
