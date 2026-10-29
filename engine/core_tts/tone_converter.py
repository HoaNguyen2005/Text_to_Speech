import os
import torch
import hashlib
import time
from openvoice import se_extractor
from openvoice.api import ToneColorConverter

class OpenVoiceConverter:
    def __init__(self, device: str = None):
        """
        Khởi tạo mô hình OpenVoice ToneColorConverter
        """
        if device is None:
            self.device = "cuda" if torch.cuda.is_available() else "cpu"
        else:
            self.device = device
            
        print(f"  [OPENVOICE INIT] Đang nạp mô hình ToneColorConverter lên {self.device.upper()}...")
        
        # A mounted directory can preserve weights independently of the image.
        self.ckpt_converter = os.environ.get('OPENVOICE_CHECKPOINT_DIR') or os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 
            "checkpoints", "converter"
        )
        
        # Nếu chưa có thư mục checkpoints/converter, ta tạo một hàm tải tự động
        self._ensure_weights()
        
        self.tone_color_converter = ToneColorConverter(os.path.join(self.ckpt_converter, 'config.json'), device=self.device)
        self.tone_color_converter.load_ckpt(os.path.join(self.ckpt_converter, 'checkpoint.pth'))

        # Cache vector âm sắc (SE) theo file giọng mẫu → không phải extract lại mỗi lần sinh
        self._se_cache = {}

        print(f"  [OPENVOICE INIT] Nạp mô hình thành công!")
        
    def _ensure_weights(self):
        """Tải weights của ToneColorConverter nếu chưa có"""
        if not all(os.path.isfile(os.path.join(self.ckpt_converter, name)) for name in ('checkpoint.pth', 'config.json')):
            print("  [OPENVOICE INIT] Chưa tìm thấy trọng số OpenVoice Converter. Đang tải từ HuggingFace...")
            os.makedirs(self.ckpt_converter, exist_ok=True)
            
            from huggingface_hub import hf_hub_download
            import shutil
            revision = os.environ.get('OPENVOICE_MODEL_REVISION') or 'main'
            
            print("  -> Đang tải config.json")
            config_path = hf_hub_download(repo_id="myshell-ai/OpenVoiceV2", filename="converter/config.json", revision=revision)
            shutil.copy(config_path, os.path.join(self.ckpt_converter, 'config.json'))
            
            print("  -> Đang tải checkpoint.pth")
            ckpt_path = hf_hub_download(repo_id="myshell-ai/OpenVoiceV2", filename="converter/checkpoint.pth", revision=revision)
            shutil.copy(ckpt_path, os.path.join(self.ckpt_converter, 'checkpoint.pth'))
            
            print("  -> Hoàn tất tải trọng số!")

    def convert(self, base_audio_path: str, reference_audio_path: str, output_path: str, source_embedding_path=None):
        """
        Chuyển đổi âm sắc từ reference_audio_path (mẫu) vào base_audio_path (gốc), lưu ra output_path
        """
        import sys
        import os
        scripts_dir = os.path.dirname(sys.executable)
        
        # Thêm venv/Scripts vào PATH để whisper và pydub tự động tìm thấy ffmpeg.exe, ffprobe.exe
        if scripts_dir not in os.environ.get("PATH", ""):
            os.environ["PATH"] = scripts_dir + os.pathsep + os.environ.get("PATH", "")

        from openvoice import se_extractor
        extraction_dir = os.path.join(os.path.dirname(source_embedding_path), 'embeddings') if source_embedding_path else 'processed'
        
        print("    -> [OPENVOICE] Đang phân tích âm sắc giọng mẫu...")
        target_start = time.perf_counter()
        # Trích xuất đặc trưng âm sắc (tone color) của file tham chiếu (có cache)
        with open(reference_audio_path, 'rb') as reference:
            reference_key = hashlib.sha256(reference.read()).hexdigest()
        if reference_key in self._se_cache:
            target_se = self._se_cache[reference_key]
            print(f"    -> [OPENVOICE] Dùng cache âm sắc có sẵn cho: {os.path.basename(reference_audio_path)}")
        else:
            target_se, audio_name = se_extractor.get_se(reference_audio_path, self.tone_color_converter, target_dir=extraction_dir, vad=True)
            if len(self._se_cache) >= 16:
                self._se_cache.pop(next(iter(self._se_cache)))
            self._se_cache[reference_key] = target_se
        
        print(f"[TTS TIMING] target_embedding_seconds={time.perf_counter() - target_start:.2f}")
        source_start = time.perf_counter()
        print(f"    -> [OPENVOICE] Đang lấy vector âm thanh gốc (dùng cache nếu có)...")
        source_se = None
        if source_embedding_path and os.path.isfile(source_embedding_path):
            try:
                source_se = torch.load(source_embedding_path, map_location=self.device, weights_only=True)
            except (OSError, RuntimeError, EOFError):
                os.remove(source_embedding_path)
        if source_se is None:
            try:
                source_se, _ = se_extractor.get_se(base_audio_path, self.tone_color_converter, target_dir=extraction_dir, vad=True)
            except Exception:
                source_se = self.tone_color_converter.extract_se([base_audio_path], se_save_path=None)
            if source_embedding_path:
                temporary_embedding = source_embedding_path + '.tmp'
                torch.save(source_se, temporary_embedding)
                os.replace(temporary_embedding, source_embedding_path)
            
        print(f"[TTS TIMING] source_embedding_seconds={time.perf_counter() - source_start:.2f}")
        print(f"    -> [OPENVOICE] Đang thực hiện Clone giọng nói...")
        conversion_start = time.perf_counter()
        self.tone_color_converter.convert(
            audio_src_path=base_audio_path, 
            src_se=source_se, 
            tgt_se=target_se, 
            output_path=output_path,
            message="@MyShell"
        )
        print(f"[TTS TIMING] conversion_seconds={time.perf_counter() - conversion_start:.2f}")
        print(f"    -> [OPENVOICE SUCCESS] Đã lưu file clone: {output_path}")
        return output_path
