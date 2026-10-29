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
import os
import glob
import time
import tempfile
import uuid
from urllib.request import urlopen, Request
from urllib.parse import urlparse, unquote
from tts_pipeline import LectureTTSPipeline
from book_audio import register_book_routes, ENGINE_LOCK, SECRET
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
    return {'status': 'ok', 'standard': True, 'clone': True}

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
                lecture_text=request.text,
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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=os.getenv('ENGINE_HOST', '127.0.0.1'), port=8000)
