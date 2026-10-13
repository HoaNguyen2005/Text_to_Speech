import os
import time
import torch

from core_tts.base_tts import EdgeTTSModel
from core_tts.tone_converter import OpenVoiceConverter

class LectureTTSPipeline:
    def __init__(self):
        print("\n" + "="*80)
        print("[SYSTEM INIT] KHỞI TẠO PIPELINE TỔNG HỢP GIỌNG NÓI (EDGE-TTS + OPENVOICE)")
        print("="*80)
        
        self.base_dir = os.path.dirname(os.path.abspath(__file__))

        # Thiết lập thiết bị xử lý
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        print(f"[INFO] Thiết bị tính toán được chọn: {self.device.upper()}")

        # Nạp mô hình 
        self._load_models()

    def _load_models(self):
        """Hàm nội bộ để load các trọng số lên RAM"""
        try:
            print(f"[LOADER] Đang nạp Edge-TTS và OpenVoice...")
            self.base_tts = EdgeTTSModel()
            self.tone_converter = OpenVoiceConverter(self.device)
            
            if self.device == "cuda":
                print(f"[MEMORY] VRAM đang chiếm dụng sau khi nạp Model: {torch.cuda.memory_allocated() / 1024**2:.2f} MB")
            print("[SUCCESS] Toàn bộ Model đã sẵn sàng!\n")
            
        except Exception as e:
            print(f"[CRITICAL ERROR] Lỗi nạp trọng số! {str(e)}")
            raise e

    def generate_lecture(self, lecture_text: str, reference_audio_path: str, style_id: str, output_path: str):
        """
        Hàm chính (Public Method) để API gọi vào.
        """
        start_time = time.time()
        print("\n" + "="*80)
        print(f"[PIPELINE START] BẮT ĐẦU XỬ LÝ BÀI GIẢNG BẰNG EDGE-TTS + OPENVOICE")
        
        print(f"[INFO] Chiều dài văn bản: {len(lecture_text)} ký tự.")
        
        # BƯỚC 1: Sinh giọng nói Tiếng Việt chuẩn bằng Edge-TTS
        # Tùy chọn giọng Nam/Nữ dựa vào tên file tham chiếu (giả định)
        voice = "vi-VN-NamMinhNeural" if "male" in reference_audio_path.lower() else "vi-VN-HoaiMyNeural"
        
        base_audio_path = self.base_tts.synthesize(lecture_text, voice=voice, style_id=style_id)
        print(f"  -> [PHASE 1] Hoàn thành sinh âm thanh cơ sở: {base_audio_path}")
        
        # BƯỚC 2: Chuyển đổi âm sắc bằng OpenVoice
        print(f"\n[PHASE 2] Bắt đầu chuyển đổi âm sắc...")
        self.tone_converter.convert(
            base_audio_path=base_audio_path,
            reference_audio_path=reference_audio_path,
            output_path=output_path
        )
        
        # Dọn dẹp file tạm của Edge TTS
        try:
            if os.path.exists(base_audio_path):
                os.remove(base_audio_path)
        except Exception as e:
            print(f"[WARNING] Không thể xóa file tạm {base_audio_path}: {e}")
        
        # Dọn dẹp RAM GPU
        if self.device == "cuda":
            torch.cuda.empty_cache()
            
        total_time = time.time() - start_time
        print(f"[PIPELINE END] THÀNH CÔNG! File lưu tại: {output_path} (Thời gian: {total_time:.2f}s)")
        print("="*80 + "\n")
        
        return output_path

# ==========================================
# KHU VỰC TEST ĐỘC LẬP
# ==========================================
if __name__ == "__main__":
    pipeline = LectureTTSPipeline()
    
    sample_text = "Chào mừng các em đến với môn học Kiến trúc Phần mềm. Hôm nay, chúng ta sẽ tìm hiểu về Design Pattern."
    sample_ref = "data/reference_audios/thay_giao_01.wav" 
    style_id = "story"
    out_file = "data/output_audios/bai_giang_demo.wav"
    
    pipeline.generate_lecture(sample_text, sample_ref, style_id, out_file)
