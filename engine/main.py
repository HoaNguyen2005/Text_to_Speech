import sys
import codecs
import os
# Configure before importing pydub/OpenVoice so their subprocesses also find FFmpeg.
os.environ['PATH'] = os.path.dirname(sys.executable) + os.pathsep + os.environ.get('PATH', '')
if sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.detach())

from typing import Optional
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import glob
import json
import re
import threading
import time
import tempfile
import uuid
import torch
from urllib.request import urlopen, Request
from urllib.parse import urlparse, unquote
from tts_pipeline import LectureTTSPipeline
from book_audio import register_book_routes, ENGINE_LOCK, SECRET
from core_tts.experimental_cues import strip_cues
from runtime_paths import SAMPLES, GENERATED
from runtime_paths import BOOK_ARTIFACT_ROOT
import shutil

# URL public của Backend Gateway để trả về link audio cho client (chế độ local)
PUBLIC_BACKEND_URL = os.getenv("PUBLIC_BACKEND_URL", "http://localhost:3000")

# Thư mục tạm chứa file giọng mẫu tải về từ R2
DOWNLOAD_DIR = os.path.join(tempfile.gettempdir(), "tts_reference_downloads")

app = FastAPI(title="Text-to-Speech Engine API")

# Khởi tạo mô hình ở phạm vi global để giữ trên RAM
try:
    pipeline = LectureTTSPipeline()
except Exception as e:
    print(f"Warning: Không thể khởi tạo Pipeline. Vui lòng kiểm tra lại môi trường và weights: {e}")
    pipeline = None


@app.get('/health/ready')
def readiness():
    # HTTP can start after a model loading failure; report that separately.
    ready = pipeline is not None and bool(shutil.which('ffmpeg')) and bool(shutil.which('ffprobe'))
    ready = ready and bool(SECRET)
    for directory in (BOOK_ARTIFACT_ROOT, SAMPLES, GENERATED):
        ready = ready and directory.is_dir() and os.access(directory, os.R_OK | os.W_OK)
    if not ready:
        raise HTTPException(status_code=503, detail='Engine/model hoặc thư mục dùng chung chưa sẵn sàng.')
    device = getattr(getattr(pipeline, 'converter', None), 'device', 'cuda:0' if torch.cuda.is_available() else 'cpu')
    gpu_name = torch.cuda.get_device_name(0) if torch.cuda.is_available() else None
    omni_ready = False
    omni_url = os.environ.get('OMNIVOICE_URL', '').rstrip('/')
    if omni_url:
        try:
            with urlopen(f'{omni_url}/health/ready', timeout=1) as response:
                omni_health = json.load(response)
            omni_ready = isinstance(omni_health, dict) and omni_health.get('status') == 'ok'
        except (OSError, ValueError):
            pass
    return {'status': 'ok', 'standard': True, 'clone': True, 'device': str(device), 'gpu_name': gpu_name,
            'omnivoice': omni_ready}

class GenerateRequest(BaseModel):
    text: str
    teacher_id: str
    style_id: str
    # Presigned URL của file giọng mẫu trên R2 (Backend sinh). Nếu bỏ trống,
    # Engine fallback về đọc đĩa như cũ — tương thích chế độ dev không có R2.
    reference_audio_url: Optional[str] = None
    gender: Optional[str] = None
    reference_file: Optional[str] = None


def _download_reference_audio(url: str) -> str:
    """Tải file giọng mẫu từ URL (presigned R2) về thư mục tạm, giữ nguyên đuôi mở rộng."""
    parsed = urlparse(url)
    ext = os.path.splitext(unquote(parsed.path))[1] or ".wav"
    os.makedirs(DOWNLOAD_DIR, exist_ok=True)
    dest = os.path.join(DOWNLOAD_DIR, f"ref_{uuid.uuid4().hex}{ext}")

    req = Request(url, headers={"User-Agent": "TTS-Engine/1.0"})
    with urlopen(req, timeout=120) as resp, open(dest, "wb") as f:
        f.write(resp.read())
    return dest


def _find_local_reference(teacher_id: str, reference_file=None) -> str:
    """Fallback cũ: tìm file mẫu trên đĩa theo teacher_id (mọi định dạng)."""
    if not teacher_id or not all(char.isalnum() or char in "_-" for char in teacher_id):
        raise HTTPException(status_code=400, detail="Mã giọng không hợp lệ")
    sample_pattern = str(SAMPLES / f"{teacher_id}.*")
    matches = [f for f in glob.glob(sample_pattern) if not f.endswith(".json")]
    if reference_file:
        matches = [f for f in matches if os.path.basename(f) == reference_file]
    if not matches:
        raise HTTPException(status_code=400, detail=f"Không tìm thấy file mẫu cho giọng: {teacher_id}")
    return matches[0]


@app.post("/generate")
def generate_audio(request: GenerateRequest):
    if pipeline is None:
        raise HTTPException(status_code=500, detail="AI Pipeline chưa được khởi tạo thành công.")

    # Nguồn giọng mẫu: ưu tiên URL từ R2, fallback đĩa local cho môi trường dev
    downloaded_file = None
    if request.reference_audio_url:
        print('[ENGINE] Tải giọng mẫu từ R2.')
        try:
            reference_audio = _download_reference_audio(request.reference_audio_url)
            downloaded_file = reference_audio
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Không tải được file giọng mẫu từ R2: {str(e)}")
    else:
        reference_audio = _find_local_reference(request.teacher_id, request.reference_file)

    # Map style_id to style audio (Giả sử dùng chính giọng mẫu làm style nếu chưa có)
    style_audio = reference_audio

    # Tạo output path
    output_filename = f"output_{uuid.uuid4().hex}.wav"
    output_dir = str(GENERATED)
    os.makedirs(output_dir, exist_ok=True)
    output_path = os.path.join(output_dir, output_filename)

    try:
        with ENGINE_LOCK:
            pipeline.generate_lecture(
                lecture_text=strip_cues(request.text),
                reference_audio_path=reference_audio,
                style_id=request.style_id,
                output_path=output_path,
                gender=request.gender
            )
        return {
            "status": "success",
            # Backend (nếu bật R2) sẽ đọc file tại output_path để upload lên R2 rồi xóa
            "output_path": output_path,
            # URL local dựng sẵn — chỉ còn dùng ở chế độ dev không có R2
            "audio_url": f"{PUBLIC_BACKEND_URL}/public/audio/generated/{output_filename}"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi tạo âm thanh: {str(e)}")
    finally:
        # Dọn file giọng mẫu đã tải về từ R2
        if downloaded_file and os.path.exists(downloaded_file):
            try:
                os.remove(downloaded_file)
            except OSError:
                pass

register_book_routes(app, lambda: pipeline)


def _discover_tunnel_url() -> Optional[str]:
    metrics_url = os.getenv('TUNNEL_METRICS_URL', '').strip()
    if metrics_url:
        try:
            with urlopen(Request(metrics_url, headers={'User-Agent': 'TTS-Engine-AutoRegister/1.0'}), timeout=5) as resp:
                text = resp.read().decode('utf-8', errors='ignore')
                matches = re.findall(r'https://[a-z0-9-]+\.trycloudflare\.com', text)
                if matches:
                    return matches[-1]
        except Exception:
            pass
    log_file = os.getenv('TUNNEL_LOG_FILE', '').strip()
    if log_file and os.path.isfile(log_file):
        try:
            with open(log_file, 'r', encoding='utf-8', errors='ignore') as f:
                matches = re.findall(r'https://[a-z0-9-]+\.trycloudflare\.com', f.read())
                if matches:
                    return matches[-1]
        except Exception:
            pass
    return None


def _auto_register_loop():
    role = os.getenv('ENGINE_NODE_ROLE', '').strip().lower()
    if role not in ('gpu', 'cpu'):
        role = 'gpu' if torch.cuda.is_available() else 'cpu'
    backends = [u.strip().rstrip('/') for u in os.getenv('REMOTE_BACKEND_URLS', 'https://text2speech-backend.onrender.com').split(',') if u.strip()]
    if not SECRET or not backends:
        return
    last_url = None
    last_sent = 0.0
    while True:
        try:
            tunnel_url = _discover_tunnel_url()
            now = time.time()
            if tunnel_url and (tunnel_url != last_url or now - last_sent >= 120):
                payload = json.dumps({
                    'role': role,
                    'engine_url': tunnel_url,
                    'label': f'docker-{role}-{os.getenv("HOSTNAME", "node")}',
                }).encode('utf-8')
                ok_any = False
                for base in backends:
                    try:
                        req = Request(
                            f'{base}/api/speech/engine-register',
                            data=payload,
                            headers={
                                'Content-Type': 'application/json',
                                'X-Book-Engine-Secret': SECRET,
                                'User-Agent': 'TTS-Engine-AutoRegister/1.0',
                            },
                            method='POST',
                        )
                        with urlopen(req, timeout=15) as resp:
                            if 200 <= resp.status < 300:
                                ok_any = True
                                if tunnel_url != last_url:
                                    print(f'[AUTO-REGISTER] Đã tự động đăng ký node {role.upper()} ({tunnel_url}) -> {base}')
                    except Exception as err:
                        if tunnel_url != last_url:
                            print(f'[AUTO-REGISTER] Chờ kết nối tới {base}: {err}')
                if ok_any:
                    last_url = tunnel_url
                    last_sent = now
        except Exception:
            pass
        time.sleep(10)


@app.on_event('startup')
def _start_auto_register():
    if os.getenv('TUNNEL_METRICS_URL') or os.getenv('TUNNEL_LOG_FILE'):
        threading.Thread(target=_auto_register_loop, daemon=True, name='tunnel-auto-register').start()


@app.on_event('shutdown')
def _unregister_on_shutdown():
    role = os.getenv('ENGINE_NODE_ROLE', '').strip().lower()
    if role == 'gpu' and SECRET:
        backends = [u.strip().rstrip('/') for u in os.getenv('REMOTE_BACKEND_URLS', 'https://text2speech-backend.onrender.com').split(',') if u.strip()]
        for base in backends:
            try:
                req = Request(
                    f'{base}/api/speech/engine-register/gpu',
                    headers={'X-Book-Engine-Secret': SECRET, 'User-Agent': 'TTS-Engine-AutoRegister/1.0'},
                    method='DELETE',
                )
                with urlopen(req, timeout=5):
                    pass
            except Exception:
                pass


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=os.getenv('ENGINE_HOST', '127.0.0.1'), port=8000)
