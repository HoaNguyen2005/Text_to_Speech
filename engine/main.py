import sys
import codecs
if sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.detach())

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import os
import glob
import time
from tts_pipeline import LectureTTSPipeline

# URL public của Backend Gateway để trả về link audio cho client
PUBLIC_BACKEND_URL = os.getenv("PUBLIC_BACKEND_URL", "http://localhost:3000")

app = FastAPI(title="Text-to-Speech Engine API")

# Khởi tạo mô hình ở phạm vi global để giữ trên RAM
try:
    pipeline = LectureTTSPipeline()
except Exception as e:
    print(f"Warning: Không thể khởi tạo Pipeline. Vui lòng kiểm tra lại môi trường và weights: {e}")
    pipeline = None

class GenerateRequest(BaseModel):
    text: str
    teacher_id: str
    style_id: str

@app.post("/generate")
def generate_audio(request: GenerateRequest):
    if pipeline is None:
        raise HTTPException(status_code=500, detail="AI Pipeline chưa được khởi tạo thành công.")
    
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    
    # Map teacher_id to reference audio (chấp nhận mọi định dạng: .wav, .m4a, .mp3...)
    sample_pattern = os.path.join(base_dir, "backend", "public", "audio", "samples", f"{request.teacher_id}.*")
    matches = [f for f in glob.glob(sample_pattern) if not f.endswith(".json")]
    if not matches:
        raise HTTPException(status_code=400, detail=f"Không tìm thấy file mẫu cho giọng: {request.teacher_id}")
    reference_audio = matches[0]
        
    # Map style_id to style audio (Giả sử dùng chính giọng mẫu làm style nếu chưa có)
    style_audio = reference_audio 
    
    # Tạo output path
    output_filename = f"output_{int(time.time())}.wav"
    output_dir = os.path.join(base_dir, "backend", "public", "audio", "generated")
    os.makedirs(output_dir, exist_ok=True)
    output_path = os.path.join(output_dir, output_filename)
    
    try:
        pipeline.generate_lecture(
            lecture_text=request.text,
            reference_audio_path=reference_audio,
            style_id=request.style_id,
            output_path=output_path
        )
        return {
            "status": "success", 
            "audio_url": f"{PUBLIC_BACKEND_URL}/public/audio/generated/{output_filename}"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi tạo âm thanh: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
