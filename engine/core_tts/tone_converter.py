import os
import torch
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
        
        # Đường dẫn tới thư mục weights của OpenVoice v2
        # Giả định weights đã được tải về ở d:/Tai_lieu_dai_hoc/NienLuan/Text_to_Speach/engine/checkpoints/converter
        self.ckpt_converter = os.path.join(
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
        if not os.path.exists(os.path.join(self.ckpt_converter, 'checkpoint.pth')):
            print("  [OPENVOICE INIT] Chưa tìm thấy trọng số OpenVoice Converter. Đang tải từ HuggingFace...")
            os.makedirs(self.ckpt_converter, exist_ok=True)
            
            from huggingface_hub import hf_hub_download
            import shutil
            
            print("  -> Đang tải config.json")
            config_path = hf_hub_download(repo_id="myshell-ai/OpenVoiceV2", filename="converter/config.json")
            shutil.copy(config_path, os.path.join(self.ckpt_converter, 'config.json'))
            
            print("  -> Đang tải checkpoint.pth")
            ckpt_path = hf_hub_download(repo_id="myshell-ai/OpenVoiceV2", filename="converter/checkpoint.pth")
            shutil.copy(ckpt_path, os.path.join(self.ckpt_converter, 'checkpoint.pth'))
            
            print("  -> Hoàn tất tải trọng số!")

    def convert(self, base_audio_path: str, reference_audio_path: str, output_path: str):
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
        
        print("    -> [OPENVOICE] Đang phân tích âm sắc giọng mẫu...")
        # Trích xuất đặc trưng âm sắc (tone color) của file tham chiếu (có cache)
        if reference_audio_path in self._se_cache:
            target_se = self._se_cache[reference_audio_path]
            print(f"    -> [OPENVOICE] Dùng cache âm sắc có sẵn cho: {os.path.basename(reference_audio_path)}")
        else:
            target_se, audio_name = se_extractor.get_se(reference_audio_path, self.tone_color_converter, vad=True)
            self._se_cache[reference_audio_path] = target_se
        
        print(f"    -> [OPENVOICE] Đang tính toán Vector của âm thanh gốc...")
        try:
            source_se, _ = se_extractor.get_se(base_audio_path, self.tone_color_converter, vad=True)
        except Exception as e:
            print(f"    -> [OPENVOICE WARNING] {e}. Bỏ qua tách VAD và trích xuất trực tiếp...")
            source_se = self.tone_color_converter.extract_se([base_audio_path], se_save_path=None)
            
        print(f"    -> [OPENVOICE] Đang thực hiện Clone giọng nói...")
        self.tone_color_converter.convert(
            audio_src_path=base_audio_path, 
            src_se=source_se, 
            tgt_se=target_se, 
            output_path=output_path,
            message="@MyShell"
        )
        print(f"    -> [OPENVOICE SUCCESS] Đã lưu file clone: {output_path}")
        return output_path
