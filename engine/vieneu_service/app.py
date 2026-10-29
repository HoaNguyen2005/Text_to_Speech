"""Private VieNeu worker. Kept separate from OpenVoice's Python dependencies."""
import hmac
import os
import re
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException
from huggingface_hub import snapshot_download
from pydantic import BaseModel, Field

ROOT = Path(os.environ['BOOK_ARTIFACT_ROOT']).resolve()
SECRET = os.environ.get('BOOK_ENGINE_SECRET', '')
REVISION = '61b85e3d937fbbacb387714180e8182823512523'
IDENTITY = 'vieneu-3.8.3-v3turbo-' + REVISION
model = None
lock = threading.Lock()


@asynccontextmanager
async def lifespan(app):
    global model
    from vieneu import Vieneu
    device = os.getenv('VIENEU_DEVICE', 'cpu')
    if device not in ('cpu', 'cuda'):
        raise RuntimeError('VIENEU_DEVICE must be cpu or cuda')
    folder = snapshot_download('pnnbao-ump/VieNeu-TTS-v3-Turbo', revision=REVISION, max_workers=2,
        allow_patterns=['config.json', 'voices_v3_turbo.json', '*encoder.onnx', '*denois*.onnx',
                        'onnx_update/*' if device == 'cpu' else 'update/*'])
    model = Vieneu(mode='v3turbo', backbone_repo=folder, device=device,
        backend='onnx' if device == 'cpu' else 'pytorch',
        **({'onnx_dir': str(Path(folder) / 'onnx_update')} if device == 'cpu' else {}),
        threads=max(1, min(8, int(os.getenv('VIENEU_CPU_THREADS', '4')))), max_batch_size=4)
    print(f'[VIENEU] ready device={device} model={IDENTITY}', flush=True)
    yield
    model = None


app = FastAPI(title='Private VieNeu TTS', lifespan=lifespan)


class Synthesis(BaseModel):
    job_id: str = Field(pattern=r'^[a-f0-9]{24}$')
    part_id: str = Field(pattern=r'^[a-f0-9]{64}$')
    text: str = Field(min_length=1, max_length=1600)
    preset: str | None = Field(default=None, max_length=80)
    reference_path: str | None = None
    model_revision: str
    experimental_cues: bool = False


@app.get('/health/ready')
def health():
    if model is None or not SECRET:
        raise HTTPException(503, 'VieNeu đang nạp model.')
    return {'status': 'ok', 'model_revision': IDENTITY, 'device': os.getenv('VIENEU_DEVICE', 'cpu')}


@app.post('/synthesize')
def synthesize(request: Synthesis, x_book_engine_secret: str | None = Header(default=None)):
    if not SECRET or not x_book_engine_secret or not hmac.compare_digest(SECRET, x_book_engine_secret):
        raise HTTPException(403, 'Khóa nội bộ VieNeu không hợp lệ.')
    if request.model_revision != IDENTITY:
        raise HTTPException(409, 'Phiên bản VieNeu không khớp yêu cầu. Hãy kiểm tra cấu hình.')
    cues = re.findall(r'\[(?:cười|thở dài|hắng giọng)\]', request.text, re.I)
    if (cues and not request.experimental_cues) or len(cues)>20 or re.search(r'<\|emotion_|\[(?:laugh|sigh|throat|whisper|thì thầm|chuckle|clear throat|khóc)\]',request.text,re.I):
        raise HTTPException(400, 'Thẻ biểu cảm không hợp lệ hoặc chưa bật tùy chọn thử nghiệm.')
    directory = (ROOT / request.job_id).resolve()
    if directory.parent != ROOT:
        raise HTTPException(400, 'Mã công việc không hợp lệ.')
    kwargs = {}
    if request.reference_path:
        reference = Path(request.reference_path).resolve()
        if reference.parent != directory or not reference.name.startswith('ref_') or reference.suffix != '.wav' or not reference.is_file():
            raise HTTPException(400, 'File mẫu VieNeu không hợp lệ.')
        kwargs['ref_audio'] = str(reference)
    elif request.preset in ('Hải Đăng', 'Trúc Ly', 'Thiện Minh', 'Mai Anh'):
        kwargs['voice'] = request.preset
    else:
        raise HTTPException(400, 'Giọng VieNeu không hợp lệ.')
    with lock:
        directory.mkdir(parents=True, exist_ok=True)
        output = directory / f'{request.part_id}.vieneu.wav'
        temporary = directory / f'{request.part_id}.vieneu.tmp.wav'
        started = time.perf_counter()
        try:
            # Inline cues are supplied only by the opt-in editor; do not invent cues.
            audio = model.infer(text=request.text, apply_watermark=False, max_chars=256, batch_size=4, **kwargs)
            if audio is None or len(audio) == 0:
                raise ValueError('Empty synthesis')
            model.save(audio, str(temporary))
            temporary.replace(output)
            elapsed = time.perf_counter() - started
            print(f'[VIENEU TIMING] chars={len(request.text)} elapsed_seconds={elapsed:.2f}', flush=True)
            return {'output_path': str(output), 'elapsed_seconds': elapsed, 'model_revision': IDENTITY}
        except Exception as error:
            print(f'[VIENEU ERROR] {type(error).__name__}', flush=True)
            raise HTTPException(503, 'VieNeu chưa tạo được âm thanh. Xem log dịch vụ VieNeu rồi thử lại.')
        finally:
            temporary.unlink(missing_ok=True)
