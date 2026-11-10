"""Internal OmniVoice service with an isolated PyTorch environment."""
import hmac
import os
import re
import threading
from contextlib import asynccontextmanager
from functools import lru_cache
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

ROOT = Path(os.environ['BOOK_ARTIFACT_ROOT']).resolve()
SECRET = os.environ.get('BOOK_ENGINE_SECRET', '')
DEVICE = os.environ.get('OMNIVOICE_DEVICE', 'cpu')
REVISION = 'c5fdb5ccb189668d56333f77ba2629f4cd7535f4'
IDENTITY = f'omnivoice-0.2.1-{REVISION}'
OLD_CUES = re.compile(r'\[(?:laughter|sigh|confirmation-en|question-(?:en|ah|oh|ei|yi)|surprise-(?:ah|oh|wa|yo)|dissatisfaction-hnn)\]', re.I)
lock = threading.Lock()


@asynccontextmanager
async def lifespan(app):
    import torch

    if DEVICE not in ('cpu', 'cuda') or (DEVICE == 'cuda' and not torch.cuda.is_available()):
        raise RuntimeError('OmniVoice requires OMNIVOICE_DEVICE=cpu or a working CUDA device.')
    if not SECRET or not ROOT.is_dir() or not os.access(ROOT, os.R_OK | os.W_OK):
        raise RuntimeError('OmniVoice requires BOOK_ENGINE_SECRET and a writable artifact directory.')
    yield


app = FastAPI(title='Private OmniVoice TTS', lifespan=lifespan)


class Synthesis(BaseModel):
    job_id: str = Field(pattern=r'^[a-f0-9]{24}$')
    part_id: str = Field(pattern=r'^[a-f0-9]{64}$')
    # Older engines may still expand tags before sending the text.
    text: str = Field(min_length=1, max_length=1680)
    reference_name: str = Field(pattern=r'^ref_[a-f0-9]{64}_omnivoice\.wav$')
    model_revision: str
    rate_percent: int = Field(default=0, ge=-25, le=50)


@lru_cache(maxsize=1)
def load_model():
    import torch
    from huggingface_hub import snapshot_download
    from omnivoice import OmniVoice

    model_path = snapshot_download('k2-fsa/OmniVoice', revision=REVISION, max_workers=2)
    return OmniVoice.from_pretrained(
        model_path, device_map=DEVICE,
        dtype=torch.float16 if DEVICE == 'cuda' else torch.float32,
        asr_model_name='openai/whisper-base', asr_device='cpu',
    )


@lru_cache(maxsize=16)
def voice_prompt(reference, modified_ns):
    return load_model().create_voice_clone_prompt(ref_audio=str(reference))


@app.get('/health/ready')
def health():
    return {'status': 'ok', 'device': DEVICE, 'model_revision': IDENTITY}


@app.post('/synthesize')
def synthesize(request: Synthesis, x_book_engine_secret: str | None = Header(default=None)):
    if not SECRET or not x_book_engine_secret or not hmac.compare_digest(SECRET, x_book_engine_secret):
        raise HTTPException(403, 'Khóa nội bộ OmniVoice không hợp lệ.')
    if request.model_revision != IDENTITY:
        raise HTTPException(409, 'Phiên bản OmniVoice không khớp.')
    text = OLD_CUES.sub(' ', request.text).strip()
    if not text:
        raise HTTPException(400, 'Nội dung đọc trống.')
    directory = (ROOT / request.job_id).resolve()
    reference = directory / request.reference_name
    if (directory.parent != ROOT or reference.resolve() != reference
            or not reference.is_file() or reference.stat().st_size > 400_000):
        raise HTTPException(400, 'File mẫu OmniVoice không hợp lệ.')

    with lock:
        import numpy as np
        import soundfile as sf

        output = directory / f'{request.part_id}.omnivoice.wav'
        temporary = directory / f'{request.part_id}.omnivoice.tmp.wav'
        if output.resolve() != output or temporary.resolve() != temporary:
            raise HTTPException(400, 'Đường dẫn OmniVoice không hợp lệ.')
        try:
            model = load_model()
            prompt = voice_prompt(reference, reference.stat().st_mtime_ns)
            audio = model.generate(text=text, language='vi', voice_clone_prompt=prompt,
                                   speed=1 + request.rate_percent / 100)[0]
            if not audio.size or not np.isfinite(audio).all() or not np.any(audio):
                raise ValueError('Invalid generated audio')
            sf.write(temporary, audio, model.sampling_rate, subtype='PCM_16')
            temporary.replace(output)
            return {'model_revision': IDENTITY}
        except Exception as error:
            print(f'[OMNIVOICE ERROR] {type(error).__name__}', flush=True)
            raise HTTPException(503, 'OmniVoice chưa tạo được âm thanh. Xem log dịch vụ rồi thử lại.') from None
        finally:
            temporary.unlink(missing_ok=True)
