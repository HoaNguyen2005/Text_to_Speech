"""Private, restart-safe audio artifacts for the local book worker."""
import hashlib
import asyncio
import hmac
import json
import os
from pathlib import Path
import re
import shutil
import wave
from typing import List, Literal, Optional
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

from fastapi import Header, HTTPException
from pydantic import BaseModel, Field
from core_tts.base_tts import EdgeTTSForbiddenError, EdgeTTSCancelled
from core_tts.edge_prefetch import EdgePrefetch, request_signature
from core_tts.audio_files import concatenate, duration, normalize, append_silence, preview_clip
from core_tts.model_lock import ModelLock
from core_tts.experimental_cues import validate as validate_cues
from runtime_paths import BACKEND_ROOT, BOOK_ARTIFACT_ROOT, SAMPLES

ENGINE_LOCK = ModelLock()
ROOT = BOOK_ARTIFACT_ROOT
secret_file = BACKEND_ROOT / '.env.books.local'
SECRET = os.getenv('BOOK_ENGINE_SECRET', '')
if not SECRET and secret_file.is_file():
    match = re.search(r'^BOOK_ENGINE_SECRET=([a-f0-9]{64})$', secret_file.read_text(), re.MULTILINE)
    SECRET = match.group(1) if match else ''


class PartRequest(BaseModel):
    job_id: str = Field(pattern=r'^[a-f0-9]{24}$')
    part_id: str = Field(pattern=r'^[a-f0-9]{64}$')
    text: str = Field(min_length=0, max_length=1600)
    mode: Literal['standard', 'clone']
    gender: Literal['male', 'female']
    style: Literal['story', 'news', 'normal']
    reference_audio_url: Optional[str] = None
    reference_file: Optional[str] = None
    reference_key: str = Field(min_length=1, max_length=500)
    rate_percent: Optional[int] = Field(default=None, ge=-25, le=50)
    pitch_hz: Optional[int] = Field(default=None, ge=-10, le=10)
    pause_ms: int = Field(default=0, ge=0, le=2000)
    provider: Literal['edge', 'vieneu'] = 'edge'
    preset: Optional[str] = Field(default=None, max_length=80)
    model_revision: Optional[str] = None
    interactive: bool = False
    experimental_cues: bool = False


class PrefetchSession(BaseModel):
    job_id: str = Field(pattern=r'^[a-f0-9]{24}$')
    session_id: str = Field(pattern=r'^[a-f0-9]{32}$')


class PrefetchRequest(PartRequest):
    session_id: str = Field(pattern=r'^[a-f0-9]{32}$')


class PreviewRequest(BaseModel):
    job_id: str = Field(pattern=r'^[a-f0-9]{24}$')
    part_id: str = Field(pattern=r'^[a-f0-9]{64}$')
    merged: bool = False


class MergeRequest(BaseModel):
    job_id: str = Field(pattern=r'^[a-f0-9]{24}$')
    part_ids: List[str] = Field(min_length=1, max_length=300)
    interactive: bool = False


class CleanupRequest(BaseModel):
    job_id: str = Field(pattern=r'^[a-f0-9]{24}$')


def authorize(value):
    if not SECRET:
        raise HTTPException(503, 'Chạy npm run books:init và khởi động lại Engine.')
    if not value or not hmac.compare_digest(value, SECRET):
        raise HTTPException(403, 'Endpoint chỉ dành cho worker nội bộ.')


def job_dir(job_id):
    directory = (ROOT / job_id).resolve()
    if directory.parent != ROOT.resolve():
        raise HTTPException(400, 'Mã công việc không hợp lệ.')
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def reference(request, directory):
    key = hashlib.sha256(request.reference_key.encode()).hexdigest()
    file = directory / f'ref_{key}.wav'
    if file.is_file():
        return str(file)
    temporary = file.with_suffix('.download')
    try:
        if request.reference_audio_url:
            if not request.reference_audio_url.startswith('https://'):
                raise RuntimeError('URL mẫu phải dùng HTTPS.')
            try:
                with urlopen(Request(request.reference_audio_url, headers={'User-Agent': 'TTS-Book-Worker'}), timeout=120) as response, temporary.open('wb') as output:
                    total = 0
                    while True:
                        chunk = response.read(1024 * 1024)
                        if not chunk:
                            break
                        total += len(chunk)
                        if total > 50 * 1024 * 1024:
                            raise HTTPException(503, detail={'code': 'VOICE_SAMPLE_TOO_LARGE', 'message': 'File giọng mẫu vượt 50 MB. Hãy tải lại mẫu ngắn hơn.', 'retryable': False})
                        output.write(chunk)
            except HTTPError as error:
                # Never expose the signed download URL or the upstream body.
                print(f'[VOICE REFERENCE ERROR] http_status={error.code} provider={request.provider}')
                if error.code == 404:
                    code, message = 'VOICE_SAMPLE_NOT_FOUND', 'Không tìm thấy file giọng mẫu trên R2. Hãy tải lại giọng mẫu hoặc liên hệ quản trị viên.'
                elif error.code in (401, 403):
                    code, message = 'VOICE_SAMPLE_ACCESS_DENIED', 'Không có quyền tải file giọng mẫu từ R2. Kiểm tra cấu hình R2 hoặc liên hệ quản trị viên.'
                else:
                    code, message = 'VOICE_SAMPLE_DOWNLOAD_FAILED', 'Không tải được file giọng mẫu từ R2. Kiểm tra kết nối rồi thử lại.'
                raise HTTPException(503, detail={'code': code, 'message': message, 'retryable': error.code == 429 or error.code >= 500}) from None
            except (URLError, TimeoutError):
                print(f'[VOICE REFERENCE ERROR] network provider={request.provider}')
                raise HTTPException(503, detail={'code': 'VOICE_SAMPLE_NETWORK', 'message': 'Không kết nối được kho giọng mẫu R2. Hãy thử lại sau.', 'retryable': True}) from None
        else:
            name = request.reference_file or ''
            if not re.fullmatch(r'[a-zA-Z0-9_.-]+', name):
                raise RuntimeError('Tên file mẫu không hợp lệ.')
            local = (SAMPLES / name).resolve()
            if local.parent != SAMPLES.resolve() or not local.is_file():
                raise HTTPException(503, detail={'code': 'VOICE_SAMPLE_NOT_FOUND', 'message': 'Không tìm thấy file giọng mẫu trên máy. Hãy tải lại giọng mẫu hoặc liên hệ quản trị viên.', 'retryable': False})
            shutil.copyfile(local, temporary)
        normalized = directory / f'ref_{key}.normalized.wav'
        normalize(temporary, normalized)
        normalized.replace(file)
        return str(file)
    finally:
        temporary.unlink(missing_ok=True)


def register_book_routes(app, get_pipeline):
    prefetch = EdgePrefetch()

    @app.post('/book/prefetch/open')
    def open_prefetch(request: PrefetchSession, x_book_engine_secret: Optional[str] = Header(default=None)):
        authorize(x_book_engine_secret)
        prefetch.open(request.job_id, request.session_id)
        return {'status': 'ok', 'concurrency': prefetch.limit}

    @app.post('/book/prefetch/close')
    def close_prefetch(request: PrefetchSession, x_book_engine_secret: Optional[str] = Header(default=None)):
        authorize(x_book_engine_secret)
        prefetch.close(request.job_id, request.session_id)
        return {'status': 'ok'}

    def prepare_base(request):
        # Exclude the transport/session field from restart-safe part signatures.
        part = PartRequest(**request.model_dump(exclude={'session_id'}))
        try:
            with prefetch.activity(part.job_id, request.session_id) as cancel, prefetch.part_lock(part.job_id, part.part_id, cancel):
                directory = job_dir(part.job_id)
                final = directory / f'{part.part_id}.wav'
                metadata = final.with_suffix('.json')
                if final.is_file() and metadata.is_file():
                    try:
                        if json.loads(metadata.read_text(encoding='utf-8')).get('signature') == request_signature(part):
                            return {'status': 'ready', 'part_id': part.part_id}
                    except (ValueError, OSError):
                        pass
                if part.provider == 'edge' and part.text.strip():
                    prefetch.prepare(part, directory, cancel)
            return {'status': 'ready', 'part_id': part.part_id}
        except EdgeTTSCancelled:
            raise HTTPException(409, detail={'code': 'EDGE_PREFETCH_CLOSED', 'message': 'Đã dừng tải trước âm thanh.', 'retryable': False})
        except EdgeTTSForbiddenError as error:
            raise HTTPException(503, detail={'code': 'EDGE_TTS_FORBIDDEN', 'message': str(error), 'retryable': False})
        except HTTPException:
            raise
        except Exception as error:
            print(f'[EDGE PREFETCH ERROR] {type(error).__name__}')
            raise HTTPException(503, detail={'code': 'EDGE_PREFETCH_FAILED', 'message': 'Chưa tạo được âm thanh nền Edge-TTS. Có thể tiếp tục từ phần đã lưu.', 'retryable': True})

    @app.post('/book/prefetch')
    async def prepare(request: PrefetchRequest, x_book_engine_secret: Optional[str] = Header(default=None)):
        authorize(x_book_engine_secret)
        # CLI waits happen on bounded threads; the ASGI loop remains available.
        return await asyncio.to_thread(prepare_base, request)

    @app.post('/book/part')
    def make_part(request: PartRequest, x_book_engine_secret: Optional[str] = Header(default=None)):
        authorize(x_book_engine_secret)
        if request.experimental_cues and request.provider != 'vieneu':
            raise HTTPException(400, 'Biểu cảm thử nghiệm chỉ dùng cho VieNeu.')
        try:
            request.text = validate_cues(request.text, request.experimental_cues)
        except ValueError as error:
            raise HTTPException(400, str(error)) from None
        with prefetch.activity(request.job_id) as cancel, prefetch.part_lock(request.job_id, request.part_id, cancel):
            directory = job_dir(request.job_id)
            output = directory / f'{request.part_id}.wav'
            metadata = output.with_suffix('.json')
            signature = request_signature(request)
            if output.is_file() and metadata.is_file():
                try:
                    info = json.loads(metadata.read_text())
                except (ValueError, OSError):
                    info = {}
                if info.get('signature') == signature:
                    seconds = duration(output)
                    return {'output_path': str(output), 'duration_seconds': seconds,
                            'speech_duration_seconds': info.get('speech_duration_seconds', max(0, seconds-request.pause_ms/1000))}
            temporary = directory / f'{request.part_id}.tmp.wav'
            base = None
            raw = directory / f'{request.part_id}.raw.wav'
            padded = directory / f'{request.part_id}.padded.wav'
            try:
                if request.provider == 'edge' and request.text.strip():
                    # Network I/O overlaps conversion of other parts, outside MODEL lock.
                    base = prefetch.prepare(request, directory, cancel)
                with ENGINE_LOCK.priority(request.interactive):
                    prefetch.check(cancel)
                    if not request.text.strip():
                        if not request.pause_ms:
                            raise HTTPException(400, 'Đoạn nghỉ không có thời lượng.')
                        with wave.open(str(temporary), 'wb') as silence:
                            silence.setnchannels(1)
                            silence.setsampwidth(2)
                            silence.setframerate(24000)
                            silence.writeframes(b'\x00\x00' * round(24000 * request.pause_ms / 1000))
                    elif request.provider == 'vieneu':
                        from core_tts.vieneu_client import synthesize
                        sample = reference(request, directory) if request.mode == 'clone' else None
                        synthesize(request, sample, temporary, SECRET)
                    elif request.mode == 'clone':
                        pipeline = get_pipeline()
                        if pipeline is None:
                            raise RuntimeError('OpenVoice chưa sẵn sàng. Kiểm tra weights hoặc chọn giọng tiêu chuẩn.')
                        sample = reference(request, directory)
                        pipeline.generate_lecture(request.text, sample, request.style, str(raw), gender=request.gender,
                                                  strict=True, source_embedding_path=str(directory / 'source.pt'),
                                                  rate_percent=request.rate_percent, pitch_hz=request.pitch_hz,
                                                  prepared_base_audio_path=str(base))
                        normalize(raw, temporary)
                    else:
                        normalize(base, temporary)
                    speech_seconds = duration(temporary) if request.text.strip() else 0
                    if request.pause_ms and request.text.strip():
                        append_silence(temporary, padded, request.pause_ms)
                        padded.replace(temporary)
                    seconds = duration(temporary)
                    temporary.replace(output)
                    metadata.write_text(json.dumps({'signature': signature, 'duration_seconds': seconds, 'speech_duration_seconds': speech_seconds}), encoding='utf-8')
                    prefetch.discard(directory, request.part_id)
                    return {'output_path': str(output), 'duration_seconds': seconds, 'speech_duration_seconds': speech_seconds}
            except HTTPException:
                raise
            except EdgeTTSCancelled:
                raise HTTPException(409, 'Đã dừng tạo âm thanh của yêu cầu.')
            except EdgeTTSForbiddenError as error:
                print('[BOOK PART ERROR] EDGE_TTS_FORBIDDEN (HTTP 403)')
                raise HTTPException(503, detail={'message': str(error), 'code': 'EDGE_TTS_FORBIDDEN', 'retryable': False})
            except FileNotFoundError as error:
                # Local paths only: upstream download URLs are never used as file paths.
                print(f'[BOOK PART ERROR] FileNotFoundError: file={error.filename!r}, winerror={getattr(error, "winerror", None)}')
                raise HTTPException(503, detail={
                    'message': 'Không đọc hoặc tạo được file âm thanh tạm. Kiểm tra đường dẫn và FFmpeg trong log Engine; khởi động lại Engine sau cập nhật rồi tiếp tục yêu cầu.',
                    'code': 'AUDIO_FILE_NOT_FOUND', 'retryable': False,
                })
            except Exception as error:
                # Do not include presigned URLs or arbitrary internal exception data in the response.
                print(f'[BOOK PART ERROR] {type(error).__name__}')
                message = 'Không tạo được đoạn âm thanh bằng VieNeu. Kiểm tra dịch vụ VieNeu, file giọng mẫu và FFmpeg.' if request.provider == 'vieneu' else 'Không tạo được đoạn âm thanh. Kiểm tra Edge-TTS/OpenVoice/FFmpeg và thử lại.'
                raise HTTPException(503, message)
            finally:
                temporary.unlink(missing_ok=True)
                raw.unlink(missing_ok=True)
                padded.unlink(missing_ok=True)

    @app.post('/book/preview')
    def preview(request: PreviewRequest, x_book_engine_secret: Optional[str] = Header(default=None)):
        authorize(x_book_engine_secret)
        with prefetch.activity(request.job_id), ENGINE_LOCK.priority(True):
            directory = job_dir(request.job_id)
            source = directory / (f'final_{request.part_id}.mp3' if request.merged else f'{request.part_id}.wav')
            if not source.is_file():
                raise HTTPException(409, 'Thiếu đoạn nghe thử. Hãy tạo lại.')
            output = directory / f'preview_{request.part_id}.mp3'
            temporary = directory / f'preview_{request.part_id}.tmp.mp3'
            try:
                if not output.is_file():
                    preview_clip(source, temporary)
                    temporary.replace(output)
                return {'output_path': str(output), 'duration_seconds': duration(output)}
            except Exception:
                raise HTTPException(503, 'Không tạo được đoạn nghe thử. Kiểm tra FFmpeg rồi thử lại.')
            finally:
                temporary.unlink(missing_ok=True)

    @app.post('/book/merge')
    def merge(request: MergeRequest, x_book_engine_secret: Optional[str] = Header(default=None)):
        authorize(x_book_engine_secret)
        if any(not re.fullmatch(r'[a-f0-9]{64}', part) for part in request.part_ids):
            raise HTTPException(400, 'Mã đoạn không hợp lệ.')
        with prefetch.activity(request.job_id), ENGINE_LOCK.priority(request.interactive):
            directory = job_dir(request.job_id)
            files = [directory / f'{part}.wav' for part in request.part_ids]
            if any(not file.is_file() for file in files):
                raise HTTPException(409, 'Thiếu đoạn âm thanh; worker cần tạo lại đoạn bị mất.')
            digest = hashlib.sha256('|'.join(request.part_ids).encode()).hexdigest()
            output = directory / f'final_{digest}.mp3'
            temporary = directory / f'final_{digest}.tmp.mp3'
            try:
                if not output.is_file():
                    concatenate(files, temporary, mp3=True)
                    duration(temporary)
                    temporary.replace(output)
                return {'output_path': str(output), 'duration_seconds': duration(output)}
            except Exception:
                raise HTTPException(503, 'Không ghép được âm thanh. Kiểm tra FFmpeg và dung lượng đĩa.')
            finally:
                temporary.unlink(missing_ok=True)

    @app.post('/book/cleanup')
    def cleanup(request: CleanupRequest, x_book_engine_secret: Optional[str] = Header(default=None)):
        authorize(x_book_engine_secret)
        with prefetch.cleanup(request.job_id), ENGINE_LOCK:
            directory = (ROOT / request.job_id).resolve()
            if directory.parent != ROOT.resolve():
                raise HTTPException(400, 'Mã công việc không hợp lệ.')
            if directory.is_dir():
                shutil.rmtree(directory)
        return {'status': 'ok'}
