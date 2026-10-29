import os
import re
import uuid
import tempfile
import subprocess
import time
from core_tts.audio_files import concatenate

# Độ dài tối đa mỗi đoạn gửi cho Edge-TTS (ký tự) — văn bản dài được chia nhỏ
MAX_CHUNK_LENGTH = 1500


class EdgeTTSForbiddenError(RuntimeError):
    """The upstream voice service refused its WebSocket connection."""


class EdgeTTSCancelled(RuntimeError):
    """A speculative base-audio request was cancelled before publication."""


class EdgeTTSModel:
    def __init__(self, voice="vi-VN-HoaiMyNeural"):
        """
        Khởi tạo mô hình Edge TTS (Base TTS tiếng Việt chuẩn)
        Giọng mặc định: vi-VN-HoaiMyNeural (Nữ)
        Giọng nam có thể dùng: vi-VN-NamMinhNeural
        """
        self.default_voice = voice
        self._last_edge_error = None
        self.tmp_dir = os.path.join(tempfile.gettempdir(), "edge_tts_cache")
        os.makedirs(self.tmp_dir, exist_ok=True)
        print(f"  [EDGE-TTS INIT] Khởi tạo Base TTS (Giọng mặc định: {self.default_voice})")

    # ---------- Tiền xử lý ----------

    @staticmethod
    def _sanitize(text: str) -> str:
        """Dọn văn bản để tránh lỗi NoAudioReceived / ngắt nhịp của Edge-TTS."""
        text = text.replace('...', '.').replace('..', '.')
        # Biến gạch nối thành dấu phẩy để ngắt nhịp tự nhiên thay vì khựng lại
        text = text.replace('-', ', ').replace('—', ', ')
        # Xóa các loại dấu ngoặc và ngoặc kép — Edge-TTS rất dễ crash hoặc ngừng với ký tự này
        for ch in ['"', '“', '”', '«', '»', '(', ')', '[', ']']:
            text = text.replace(ch, '')
        return re.sub(r'\s+', ' ', text).strip()

    @staticmethod
    def _split_chunks(text: str, max_length: int = MAX_CHUNK_LENGTH):
        """
        Chia văn bản dài thành các đoạn nhỏ tại ranh giới câu để Edge-TTS xử lý ổn định.
        """
        if len(text) <= max_length:
            return [text]

        # Cắt tại dấu kết thúc câu (., !, ?) gần giới hạn nhất
        sentences = re.split(r'(?<=[.!?])\s+', text)
        chunks, current = [], ""
        for sentence in sentences:
            if len(sentence) > max_length:
                if current:
                    chunks.append(current.strip())
                    current = ''
                while len(sentence) > max_length:
                    cut = sentence.rfind(' ', 0, max_length)
                    if cut <= 0:
                        cut = max_length
                    chunks.append(sentence[:cut].strip())
                    sentence = sentence[cut:].strip()
            if len(current) + len(sentence) + 1 > max_length and current:
                chunks.append(current.strip())
                current = sentence
            else:
                current = f"{current} {sentence}".strip()

        # Câu đơn lẻ dài quá giới hạn → cắt cứng theo dấu phẩy/khoảng trắng
        while len(current) > max_length:
            cut = current.rfind(',', 0, max_length)
            if cut < max_length // 2:
                cut = current.rfind(' ', 0, max_length)
            if cut <= 0:
                cut = max_length
            chunks.append(current[:cut].strip())
            current = current[cut:].strip()
        if current:
            chunks.append(current.strip())
        return [c for c in chunks if c]

    # ---------- Sinh audio ----------

    def _run_edge_tts(self, text: str, voice: str, output_path: str, rate: str = None, pitch: str = None, cancel_event=None) -> bool:
        """Gọi Edge-TTS qua CLI (tránh xung đột asyncio với FastAPI). Trả về True nếu thành công."""
        import sys
        self._last_edge_error = None
        cmd = [
            sys.executable, "-m", "edge_tts",
            "--text", text,
            "--voice", voice,
            "--write-media", output_path
        ]
        if rate:
            cmd.append(f"--rate={rate}")
        if pitch:
            cmd.append(f"--pitch={pitch}")

        if cancel_event is not None and cancel_event.is_set():
            raise EdgeTTSCancelled()
        # communicate() drains both pipes; polling also works on Windows without
        # depending on Uvicorn's event-loop/subprocess implementation.
        with subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              text=True, encoding='utf-8', errors='replace') as process:
            deadline = time.monotonic() + 180
            try:
                while True:
                    if cancel_event is not None and cancel_event.is_set():
                        raise EdgeTTSCancelled()
                    if time.monotonic() >= deadline:
                        return False
                    try:
                        _, stderr = process.communicate(timeout=0.5)
                        break
                    except subprocess.TimeoutExpired:
                        continue
            finally:
                if process.poll() is None:
                    process.kill()
                    process.communicate()
        if process.returncode == 0 and os.path.exists(output_path):
            return True
        if re.search(r'WSServerHandshakeError:\s*403\b', stderr):
            self._last_edge_error = 'forbidden'
        safe_error = re.sub(r'''(?:https?|wss?)://[^\s'"<>]+''', '[URL]', stderr.strip())
        print(f"    -> [EDGE-TTS ERROR] {safe_error}")
        return False

    def _run_gtts(self, text: str, output_path: str) -> bool:
        """Fallback Google TTS khi Edge-TTS bị chặn."""
        try:
            from gtts import gTTS
            gTTS(text, lang='vi').save(output_path)
            print("    -> [DEBUG - ENGINE] Đã sử dụng: gTTS (Google TTS)")
            return True
        except Exception as e:
            print(f"    -> [GTTS ERROR] {e}")
            return False

    def synthesize(self, text: str, voice: str = None, style_id: str = None, strict: bool = False, rate_percent=None, pitch_hz=None, cancel_event=None) -> str:
        """
        Tạo audio từ văn bản (tự chia chunk nếu văn bản dài).
        Trả về đường dẫn tới file âm thanh tạm thời (.mp3).
        """
        if not voice:
            voice = self.default_voice

        clean_text = self._sanitize(text)
        chunks = self._split_chunks(clean_text)
        if len(chunks) > 1:
            print(f"    -> [EDGE-TTS] Văn bản dài ({len(clean_text)} ký tự) → chia thành {len(chunks)} đoạn")

        # Phong cách đọc điều khiển bằng tham số rate của Edge-TTS (thay vì FFmpeg atempo)
        rate = None
        if style_id == "news":
            rate = "+12%"   # Bản tin: đọc nhanh hơn, dứt khoát
        elif style_id in ("story", "novel"):
            rate = "-8%"    # Đọc truyện: chậm rãi, sâu lắng
        if rate_percent is not None:
            if not isinstance(rate_percent, int) or not -25 <= rate_percent <= 50:
                raise ValueError('Nhịp đọc vượt giới hạn.')
            rate = f'{rate_percent:+d}%'
        pitch = None
        if pitch_hz is not None:
            if not isinstance(pitch_hz, int) or not -10 <= pitch_hz <= 10:
                raise ValueError('Cao độ vượt giới hạn.')
            pitch = f'{pitch_hz:+d}Hz'

        part_files = []
        for i, chunk in enumerate(chunks):
            part_file = os.path.join(self.tmp_dir, f"base_{uuid.uuid4().hex}.mp3")

            # Thử lần 1: Edge-TTS kèm rate; lần 2: Edge-TTS thường; lần 3: gTTS
            try:
                success = self._run_edge_tts(chunk, voice, part_file, rate=rate, pitch=pitch, cancel_event=cancel_event)
            except EdgeTTSCancelled:
                for p in part_files + [part_file]:
                    if os.path.exists(p):
                        os.remove(p)
                raise
            if not success:
                if strict:
                    # A long book must retain the selected voice/rate across every part.
                    try:
                        retry = self._last_edge_error != 'forbidden' and self._run_edge_tts(chunk, voice, part_file, rate=rate, pitch=pitch, cancel_event=cancel_event)
                    except EdgeTTSCancelled:
                        for p in part_files + [part_file]:
                            if os.path.exists(p):
                                os.remove(p)
                        raise
                    if not retry:
                        for p in part_files + [part_file]:
                            if os.path.exists(p):
                                os.remove(p)
                        if self._last_edge_error == 'forbidden':
                            raise EdgeTTSForbiddenError('Edge-TTS từ chối kết nối (HTTP 403). Cập nhật edge-tts trong môi trường ảo Engine, khởi động lại Engine rồi thử lại. Nếu đã cập nhật, kiểm tra trạng thái dịch vụ và kết nối mạng.')
                        raise RuntimeError('Edge-TTS chưa phản hồi. Thử lại phần âm thanh đang làm.')
                    part_files.append(part_file)
                    continue
                print(f"    -> [FALLBACK] Đoạn {i + 1}: thử lại Edge-TTS không kèm tham số style...")
                if not self._run_edge_tts(chunk, voice, part_file):
                    print(f"    -> [FALLBACK] Đoạn {i + 1}: chuyển sang gTTS...")
                    if not self._run_gtts(chunk, part_file):
                        # Dọn các phần đã tạo rồi mới báo lỗi
                        for p in part_files:
                            os.remove(p)
                        raise Exception("Lỗi tạo âm thanh: edge-tts và gTTS đều thất bại")

            part_files.append(part_file)

        # Gộp các phần mp3 (cùng codec/giọng → nối nhị phân là đủ, OpenVoice sẽ encode lại sau)
        tmp_file = part_files[0]
        if len(part_files) > 1:
            tmp_file = os.path.join(self.tmp_dir, f"merged_{uuid.uuid4().hex}.wav")
            try:
                concatenate(part_files, tmp_file)
            finally:
                for p in part_files:
                    os.remove(p)
            print(f"    -> [EDGE-TTS] Đã gộp {len(part_files)} đoạn âm thanh")

        print(f"    -> [DEBUG - ENGINE] Đã sử dụng: Edge-TTS (Microsoft Neural)")
        return tmp_file
