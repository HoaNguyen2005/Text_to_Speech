# Hướng Dẫn Cài Đặt Text-to-Speech Engine (Edge-TTS + OpenVoice)

Đây là Python Engine đảm nhiệm việc chuyển đổi văn bản thành giọng nói (TTS) và nhân bản âm sắc (Voice Cloning).

**Cập nhật Phase 4 (20/10/2026):** máy hiện tại đã chạy Engine CPU trong Compose,
kèm FFmpeg và model. Mở Docker Desktop rồi chạy `.\deploy\stack.ps1 up` từ repo root
để bật toàn stack; xem [PHASE4.md](../PHASE4.md). Không chạy thêm `python main.py`
khi container đang giữ cổng 8000. Các bước bên dưới dành cho chế độ terminal;
muốn dùng lại cần dừng service Engine Docker (và chuyển worker/backend theo hướng dẫn).

## Yêu Cầu Hệ Thống
- Python 3.9 hoặc 3.10
- Môi trường Windows / Linux / macOS
- Có Card Đồ Họa (GPU) hỗ trợ CUDA (NVIDIA) để tăng tốc xử lý (không bắt buộc nhưng rất khuyến khích).

## Bước 1: Khởi tạo môi trường ảo (Virtual Environment)
Mở terminal tại thư mục `engine` và chạy:
```bash
# Windows
python -m venv venv
.\venv\Scripts\activate

# macOS/Linux
python3 -m venv venv
source venv/bin/activate
```

## Bước 2: Cài đặt các thư viện Python
Cài đặt toàn bộ các thư viện cần thiết từ file `requirements.txt`:
```bash
pip install -r requirements.txt
```

## Bước 3: Cài đặt FFmpeg (Rất quan trọng)
Thư viện xử lý âm thanh `pydub` và `OpenVoice` yêu cầu phải có `FFmpeg` trong hệ thống.
- **Trên Windows:** Tải FFmpeg (.zip) tại [Gyan.dev](https://www.gyan.dev/ffmpeg/builds/), giải nén và chép 3 file `ffmpeg.exe`, `ffprobe.exe`, `ffplay.exe` vào thư mục `engine/venv/Scripts/`.
- **Trên macOS:** Chạy `brew install ffmpeg`
- **Trên Linux (Ubuntu):** Chạy `sudo apt update && sudo apt install ffmpeg`

## Bước 4: Chạy Máy Chủ API (Và Tự Động Tải Weights)
Sau khi cài đặt xong, hãy khởi động FastAPI Server:
```bash
python main.py
```
*Lưu ý: Trong lần khởi chạy đầu tiên, mã nguồn sẽ tự động kết nối với HuggingFace để tải trọng số mô hình OpenVoice V2 (~260MB) về thư mục `engine/checkpoints/converter/`. Quá trình này hoàn toàn tự động, hãy kiên nhẫn chờ đến khi Server báo chạy thành công.*

Server sẽ chạy mặc định tại: `http://localhost:8000`

## Luồng sách nói dài

Xem [../BOOK_AUDIO.md](../BOOK_AUDIO.md). Chạy `npm run books:init` trong Backend
trước khi bật Engine/worker để tạo khóa dùng chung. Engine nghe loopback mặc định;
`/book/part`, `/book/merge`, `/book/cleanup` chỉ dành cho worker có khóa nội bộ.
Các đoạn được normalize PCM 24 kHz mono, ghép MP3 bằng FFmpeg và đo bằng FFprobe.
Giọng tiêu chuẩn không yêu cầu OpenVoice khởi tạo thành công; clone cần weights.
Cả luồng bài giảng và sách nói dùng cùng khóa xử lý để tránh gọi OpenVoice đồng thời.

## VieNeu-TTS tùy chọn

Giữ nguyên pipeline Edge-TTS + OpenVoice. `/book/part` nhận provider `edge` (mặc định) hoặc `vieneu`. Nhánh VieNeu gọi service riêng qua VIENEU_URL, dùng preset hoặc clone trực tiếp, chuẩn hóa 24 kHz và giữ pause/SRT. Provider/model revision tham gia cache; không tự fallback sang model khác khi lỗi.

Service `vieneu` có SDK/venv riêng, CPU ONNX trên máy hiện tại. Dockerfile CPU tái sử dụng lớp hệ thống/FFmpeg của image Engine qua Compose additional_contexts, không dùng venv OpenVoice. GPU overlay dành cho PC NVIDIA khác; chưa áp lên Intel Arc. Xem VIENEU.md cho giới hạn style, vận hành và kiến trúc cloud dự kiến.

## Khoảng nghỉ chủ động và mốc phụ đề

`/book/part` nhận `pause_ms` 0–2000 ms, tạo khoảng lặng WAV thực; phần chỉ có nghỉ không gọi Edge-TTS/OpenVoice. Response/cache ghi cả `speech_duration_seconds` trước khi thêm nghỉ và `duration_seconds` sau khi thêm nghỉ. Backend dùng các mốc này để tạo SRT; câu bên trong mỗi đoạn được phân bổ ước lượng, chưa căn chính xác theo từng từ.

`/book/preview` hỗ trợ file ghép qua `merged: true`, cắt tối đa 30 giây. Cả bài giảng mới và sách nói dùng chung route nội bộ có khóa xác thực. Frontend không gọi trực tiếp các route này. Năm phong cách được Backend đổi thành rate/khoảng nghỉ định sẵn; cao độ giữ nguyên, không thêm Engine cảm xúc mới.

Sau cập nhật cần build/restart Engine cùng Backend/worker và Frontend; áp dụng migration `007-speech-subtitles` cho database ứng dụng sau backup. Xem BOOK_AUDIO.md.

## Lỗi Edge-TTS HTTP 403

Nếu log có `WSServerHandshakeError: 403`, dịch vụ tạo giọng gốc đã từ chối kết nối;
OpenVoice chưa tới bước clone. Cả giọng tiêu chuẩn và giọng cá nhân đều cần Edge-TTS.
Phiên 19/10/2026 đã nâng từ 7.2.8 lên **7.3.1** trong `engine/venv` và ghim phiên bản
trong requirements. Tác giả thư viện xác nhận sửa lỗi tương ứng từ 7.3.0:
[issue #490](https://github.com/rany2/edge-tts/issues/490), [bản phát hành 7.3.1](https://pypi.org/project/edge-tts/7.3.1/).

Trong thư mục `engine`, nếu cần cập nhật trên máy khác:

```powershell
.\venv\Scripts\python.exe -m pip install --upgrade edge-tts==7.3.1
.\venv\Scripts\python.exe -m edge_tts --version
```

Khởi động lại Engine và worker rồi bấm **Tiếp tục từ phần lỗi**. Checkpoint cũ được giữ.
Không tự đổi giọng khi dịch vụ lỗi trong luồng sách nói. Nếu bản mới vẫn bị 403, cần
đọc log/kết nối và trạng thái dịch vụ; không coi việc nâng phiên bản là bằng chứng
pipeline âm thanh đã chạy thành công. URL trong stderr Edge-TTS được che trước khi log.

## FileNotFoundError sau `after vad`

Nếu VAD đã đọc được giọng mẫu nhưng lỗi ngay khi ghi các đoạn, kiểm tra độ dài đường dẫn.
OpenVoice cũ lặp nguyên tên file nguồn trong thư mục embedding và tên đoạn; với job local
đã gặp đường dẫn **295 ký tự**. Phiên 19/10 đã đổi thư mục sang mã phiên bản + hash nội dung,
đoạn có tên ngắn `seg_0000.wav`; không thay file mẫu hoặc mapping R2/PostgreSQL.
Xem [giới hạn đường dẫn Windows](https://learn.microsoft.com/en-us/windows/win32/fileio/maximum-file-path-limitation).

Khởi động lại Engine rồi bấm **Tiếp tục từ phần lỗi**. Nếu lỗi còn xảy ra, dòng
`[BOOK PART ERROR] FileNotFoundError` giờ có `file` và `winerror` để xác định chính xác
file hoặc executable bị thiếu. Thư mục embedding cũ không bị xóa tự động trong lần sửa này.

## Theo dõi thời gian clone trên CPU

Engine ghi `[TTS TIMING]` cho Edge-TTS, lấy vector mẫu/nguồn và chuyển âm sắc.
Khởi động hiển thị thiết bị thực sự dùng và số luồng PyTorch. Giọng tiêu chuẩn bỏ
qua OpenVoice; chạy nhiều yêu cầu clone cùng lúc trên CPU không mặc nhiên nhanh hơn.

Có thể đặt biến môi trường `TTS_CPU_THREADS` (số nguyên từ 1 đến số luồng CPU) trước
khi chạy Engine để tinh chỉnh nếu cần. Bỏ trống giữ mặc định PyTorch; chưa chọn giá
trị tối ưu vì chưa benchmark trên máy. Biến này không bật GPU. Cần đo kết quả thực tế
trước khi thay cấu hình vận hành.

## Phase 4 — Image Engine CPU

Xem [mục 1b trong PHASE4.md](../PHASE4.md). Từ repo root, build bằng:

```powershell
docker build --pull --tag text2speech-engine:phase4.1 --file engine/Dockerfile engine
```

Image đã build thành công ngày 20/10/2026: Linux/amd64, user `tts`, khoảng 2,48 GiB.
Chưa chạy model hoặc tạo âm thanh trong container ở lượt này.

Image có Python 3.10, FFmpeg/FFprobe, PyTorch/TorchAudio CPU cùng phiên bản và thư
viện của API. File `requirements.container.txt` và `requirements.torch-cpu.txt`
dành riêng cho image; môi trường Windows tiếp tục dùng `requirements.txt`.

Image chọn `SILERO_VAD_BACKEND=package`, dùng model Silero kèm gói Python để không
hỏi xác nhận Torch Hub khi tách mẫu âm thanh. Nhánh VAD Windows giữ cách cũ khi
không có biến này. Các demo BaseSpeakerTTS/ASR/Gradio không nằm trong phạm vi image
API Edge-TTS + ToneColorConverter; import từ điển/ASR chỉ diễn ra ở nhánh demo.

Weights và cache được mount riêng khi ghép Compose: `OPENVOICE_CHECKPOINT_DIR`,
`HF_HOME`, `TORCH_HOME`, `NUMBA_CACHE_DIR`. Audio dùng `AUDIO_ROOT` (samples/generated)
và `BOOK_ARTIFACT_ROOT`; worker/Engine phải dùng chung vị trí tuyệt đối cho từng job.
Secret Engine chỉ cấp khi chạy, dùng cùng giá trị Backend/worker; không build vào image.
Lượt 1b chỉ chuẩn bị image, chưa chuyển Engine Windows đang dùng sang container.


## Tải trước Edge-TTS (23/10/2026)

Luồng tạo toàn bộ sách `review-v1` và bài giảng có nhịp đọc tải trước theo cửa sổ,
không gửi toàn bộ sách lên Edge cùng lúc:

```text
Edge-TTS: chuẩn bị tối đa 3 đoạn kế tiếp → cache nền riêng theo job/part
                                      ↓
OpenVoice/chuẩn hóa: lấy đoạn theo đúng thứ tự → lưu checkpoint → ghép MP3/SRT
```

- Backend/worker: `EDGE_TTS_PREFETCH_CONCURRENCY=3`, chấp nhận 1–3. Đặt `1`
  để bỏ prefetch và chạy tuần tự trong từng job. Engine:
  `EDGE_TTS_MAX_CONCURRENCY=3`, chấp nhận 1–3, giới hạn tổng network Edge
  của sách/bài giảng. Muốn giới hạn toàn hệ thống về một lượt, đặt cả hai bằng 1.
  Sửa env của đúng chế độ đang chạy rồi recreate container hoặc restart terminal.
- Worker khởi động phiên qua `/book/prefetch/open`, gọi `/book/prefetch` đồng thời,
  rồi `/book/part` lần lượt; `/book/prefetch/close` hủy tải nền khi kết thúc/lỗi/hủy.
  Các endpoint giữ khóa nội bộ BOOK_ENGINE_SECRET. Engine dùng `asyncio.to_thread`
  để chờ CLI mà không chặn ASGI; semaphore và instance riêng giới hạn đồng thời.
  Không cần phụ thuộc event loop Windows hỗ trợ async subprocess hay không.
- Network Edge nằm ngoài ENGINE_LOCK; OpenVoice và embedding vẫn khóa tuần tự.
  Nếu một đoạn sẵn sàng, clone ngay trong lúc Edge chuẩn bị đoạn sau, không đợi đủ
  cả nhóm. Mỗi part giữ giọng, nhịp, cao độ và khoảng nghỉ của payload đã duyệt.
- Cache `edge_<part_id>.mp3` + JSON đối chiếu chữ ký payload (bỏ URL ký tạm).
  Chỉ công bố khi file hoàn chỉnh/đo được thời lượng; dùng lại sau lỗi/restart.
  Xuất WAV thành công thì bỏ cache nền của đoạn. WAV/checkpoint/R2 và thứ tự SRT
  giữ nguyên. Prefetch lỗi tạm để `/book/part` thử lại theo cơ chế cũ; lỗi 403
  nhận diện không thử dồn hoặc chuyển giọng khác.
- Guard kiểm tra hủy/quyền/lease mỗi 2 giây. Đóng phiên hủy CLI tải trước, đợi
  writer kết thúc; cleanup không xóa khi writer còn ghi. OpenVoice đang inference
  được phép hoàn tất đoạn hiện tại; guard chặn bước tiếp theo/xuất bản khi hủy.
  Yêu cầu đã hủy vẫn ẩn và được dọn theo cơ chế hiện có.
- VieNeu đi nhánh riêng, không dùng prefetch Edge. Preview và workflow legacy
  giữ cách gọi tuần tự. Không đổi phần phân tích/viết/đối chiếu Gemini.
- Log `[EDGE PREFETCH] ready/cache_hit/window` và `[BOOK TIMING] stage=edge_prefetch`
  giúp phân biệt chờ mạng với clone. Các thời gian lời gọi có thể chồng lấp, không
  cộng thành tổng thời gian thực. Chưa benchmark đầu-cuối; tốc độ còn phụ thuộc
  Gemini, mạng, CPU/GPU OpenVoice và upload.


## Tốc độ đọc chung và bản duyệt (23/10/2026)

- Sidebar giữ nút 10/20/30 phút gọn và ô nhập 1–59 phút. Slider **Tốc độ đọc**
  0,75x–1,50x, bước 0,05x; 1,00x là tốc độ chuẩn. Đây là tốc độ khi tạo file,
  không phải playbackRate của trình phát. Áp dụng cho cả lời giới thiệu và tất cả
  các mục/đoạn. Tốc độ này ghi đè rate của preset, không thay pause/pitch.
- Backend xác thực `speech.rate_percent` nguyên -25..50; Engine nhận cùng giới hạn.
  Edge sinh audio theo rate trước bước OpenVoice. VieNeu tạo tiếng nói rồi đổi
  tốc độ bằng FFmpeg atempo. Ước lượng thời lượng, cache, preview và SRT dùng
  kế hoạch chứa rate mới. Không đổi giọng hoặc provider khi kéo slider.
- Yêu cầu sách mới lưu cấu hình trong checkpoint.initial_speech, đưa vào bản nháp.
  Bản cũ thiếu rate vẫn dùng preset/hash cũ nếu chưa lưu cấu hình mới. Không cần
  migration DB. Sau khi có bản duyệt, slider tại cột phải chỉnh bản nháp đang mở;
  thao tác nghe thử/tạo sẽ lưu lại cấu hình trước khi gửi yêu cầu.
- Đã bỏ nút chèn nghỉ tại con trỏ; parser vẫn đọc chỉ dẫn nghỉ trong bản cũ.
  Nghỉ theo phong cách, chuẩn hóa số/từ điển và SRT giữ nguyên trong tùy chọn đọc.
- Nút **Nghe thử tối đa 30 giây** và **Duyệt và tạo âm thanh** không còn phụ thuộc
  thao tác Xem cách đọc thủ công. UI tự lập kế hoạch không qua AI; khi nhấn nút,
  lưu đúng draft revision, tính hash từ bản đã lưu rồi gửi preview/audio. Lỗi
  xác thực được hiển thị bằng popup. Phiên bản xung đột/nội dung không hợp lệ/
  giới hạn 1 giờ/đối chiếu nguồn vẫn được kiểm tra như trước.
