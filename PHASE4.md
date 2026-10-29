# Phase 4 — Đóng gói Docker và triển khai web

Thực hiện lần lượt, mỗi lượt hoàn thành một mục nhỏ. Ý đầu tiên là đóng gói và chạy
được trên máy hiện tại; chia thành 1a–1c để dễ theo dõi. Các bước production thực hiện sau.

## Tiến độ

| Mục | Công việc | Trạng thái |
| --- | --- | --- |
| 1a | Image Backend/worker và cấu hình kết nối giữa container | **Hoàn thành build ngày 20/10/2026** |
| 1b | Image Engine CPU: Python, FFmpeg, OpenVoice và thư mục weights/cache | **Hoàn thành build ngày 20/10/2026** |
| 1c | Frontend và Compose local: ghép các image với PostgreSQL/Keycloak hiện có, volume âm thanh dùng chung, thứ tự khởi động | **Đã bật stack local, 7 service healthy ngày 20/10/2026** |
| 2 | Chốt nơi deploy/domain, tài nguyên CPU/GPU, vị trí PostgreSQL và phương án sao lưu/phục hồi | Chưa thực hiện |
| 3 | Cấu hình production: HTTPS, Keycloak hostname/client, SMTP thật, secrets và mạng nội bộ | Chưa thực hiện |
| 4 | Deploy và hướng dẫn vận hành: khởi động lại, cập nhật, log, backup; kiểm thử khi được yêu cầu | Chưa thực hiện |

## Mục 1a — Backend và worker

### Đã chuẩn bị

- `backend/Dockerfile`: dùng Node.js 24 trên Debian slim, cài dependency bằng
  `npm ci --omit=dev` từ lockfile. Chạy bằng user `node`. Cùng image dùng được cho
  API (`node server.js`) và worker (`node workers/book.worker.js`). Hai tiến trình
  sẽ là hai service riêng trong Compose, để API không bị chặn khi xử lý sách.
- `backend/.dockerignore` và các lệnh `COPY` giới hạn source đưa vào image.
  Không đóng gói `.env`, dữ liệu PostgreSQL, audio, checkpoint hoặc `node_modules`
  của Windows. Công cụ migration MongoDB/điều khiển Docker trên máy host không nằm
  trong image. Có công cụ áp dụng schema PostgreSQL và xem trạng thái.
- `ENGINE_URL`: địa chỉ Engine dùng chung cho bài giảng và sách nói. Khi bỏ trống,
  tiếp tục dùng `BOOK_ENGINE_URL`, rồi mặc định `http://127.0.0.1:8000` như trước.
- `KEYCLOAK_URL`: URL public mà trình duyệt dùng, đồng thời xác định issuer JWT.
  `KEYCLOAK_INTERNAL_URL`: URL Backend/worker gọi token, Admin API và JWKS qua
  mạng nội bộ. Bỏ trống dùng lại URL public. Kiểm tra issuer, audience và chữ ký
  JWT vẫn được giữ nguyên.
- `BOOK_ARTIFACT_ROOT`: tùy chọn thư mục đoạn âm thanh, mặc định vẫn là
  `backend/data/book-audio`. Bước 1b–1c sẽ mount cùng đường dẫn tuyệt đối trong
  Engine và worker để file Engine trả về được worker đọc trực tiếp.
- `deploy/backend.env.example`: mẫu cấu hình cho Compose sắp tới, không chứa secret
  thật. File điền giá trị `deploy/backend.env` được Git bỏ qua.

### Build image

Đã build thành công `text2speech-backend:phase4.1` trên máy hiện tại. Metadata:
Linux/amd64, user `node`, workdir `/app/backend`, khoảng **408 MiB**; image ID
`sha256:830579bcdeaf218fd0c59d2ef4b39c90cc0ab8c3cd0a70b999bf18a0c253b18c`.
Build context chỉ khoảng 235 KB. Chưa khởi chạy container ứng dụng.

Tại thư mục gốc dự án, sau khi Docker Desktop báo Engine running:

```powershell
docker build --pull --tag text2speech-backend:phase4.1 --file backend/Dockerfile backend
```

Đây là build image, chưa bật container ứng dụng. Lượt này không chuyển Backend/worker
đang dùng sang container, không chạy migration dữ liệu, không tự nhận hoặc retry job.
Container chạy cùng Engine và các volume sẽ được thiết lập ở bước 1c; hiện tiếp tục
khởi động ứng dụng theo README nếu cần sử dụng web.

### Cấu hình ở bước Compose sắp tới

| Thành phần | Trên Windows hiện tại | Trong mạng Compose dự kiến |
| --- | --- | --- |
| PostgreSQL ứng dụng | `127.0.0.1:5433/tts_app` | `postgres:5432/tts_app` |
| Issuer Keycloak public | `http://localhost:8080/realms/tts-local` | Giữ URL public để đối chiếu token |
| Backend gọi Keycloak | URL public như trước | `http://keycloak:8080` |
| Backend/worker gọi Engine | `http://127.0.0.1:8000` | `http://engine:8000` |
| Audio tạm sách nói | `backend/data/book-audio` | `/app/backend/data/book-audio` trên cùng volume |
| Mẫu và audio bài giảng | `backend/public/audio` | `/app/backend/public/audio` trên cùng volume |

File env mẫu có hostname container, không thay thế các file `.env.*.local` dùng
cho terminal Windows. Các secret Keycloak, PostgreSQL, Gemini, R2 và Engine được
cấp khi chạy container; không đưa vào Dockerfile hoặc build arguments. Không đặt
`PG_ALLOW_EMPTY_DATABASE=true` để bỏ qua việc phục hồi database đã có dữ liệu.

### Phạm vi xác nhận

Build thành công chỉ xác nhận image và dependency cài được. Luồng đăng nhập,
quản trị, upload, Gemini, TTS, retry và chia sẻ file cần được kiểm chứng khi ghép
stack local. Chưa thêm/chạy test tự động hoặc gọi Gemini/TTS ở mục này.

## Mục 1b — Engine CPU

### Đã chuẩn bị

- `engine/Dockerfile` nhiều stage: Python 3.10 trên Debian Bookworm, FFmpeg/FFprobe,
  libsndfile và thư viện CPU. Dependency được cài trong venv Linux riêng. Chạy user
  `tts` với UID/GID 1000, khớp UID/GID Backend để chia sẻ volume ở mục 1c.
- `requirements.torch-cpu.txt` ghim **torch/torchaudio 2.10.0+cpu** cùng phiên bản.
  Bước cài các thư viện khác dùng lại constraints để không kéo PyTorch CUDA thay thế.
  `requirements.container.txt` ghim dependency trực tiếp; danh sách toàn bộ phiên bản
  được giải quyết khi build nằm trong image tại `/opt/engine-installed.txt`.
  Hugging Face Hub của image ghim 0.34.4 để tương thích ràng buộc Click của gTTS
  fallback; venv Windows giữ phiên bản đang dùng. Khi nâng dependency cần giải quyết
  lại nhóm này cùng nhau.
- API đang dùng VAD để tách âm thanh mẫu, không dùng ASR/Gradio demo. Image cài
  **silero-vad 6.2.3** có model kèm wheel; chọn `SILERO_VAD_BACKEND=package` nên không
  gọi Torch Hub hoặc hỏi xác nhận tin cậy GitHub. Các import ASR và từ điển của
  BaseSpeakerTTS được chuyển vào nhánh sử dụng tương ứng. Image API dùng Edge-TTS
  và ToneColorConverter; không cài các bộ BaseSpeakerTTS/ASR/Gradio demo.
- Khi chạy Windows, `requirements.txt` và nhánh VAD cũ vẫn được giữ. Không cài lại
  package hoặc sửa venv Windows trong lượt này.
- `runtime_paths.py` dùng chung cấu hình đường dẫn cho bài giảng và sách nói.
  `BOOK_ARTIFACT_ROOT` cần giống worker; `AUDIO_ROOT` chứa `samples/` và `generated/`.
  Khi không đặt env, các đường dẫn mặc định vẫn theo bố cục repository hiện tại.
- `OPENVOICE_CHECKPOINT_DIR` chứa `config.json` và `checkpoint.pth`. Image chỉ có
  source, không đóng gói weights/audio/checkpoint người dùng hay file `.env`.
  Docker ghim revision OpenVoice V2 `ea66dc9353e660b1dbbe0bebebd4c2d8b105483c`
  để tải model còn thiếu khi khởi động. Hai file model có sẵn thì dùng lại.
  WavMark tiếp tục được dùng; model của nó được tải qua Hugging Face cache khi cần.
- Mẫu env cho bước Compose: `deploy/engine.env.example`; `BOOK_ENGINE_SECRET` phải
  bằng giá trị Backend/worker. Không đưa secret vào build arguments hoặc image.

### Build image Engine

Đã build thành công `text2speech-engine:phase4.1`. Metadata: Linux/amd64, user `tts`
(UID/GID 1000), workdir `/app/engine`, **2.666.761.326 bytes (~2,48 GiB)**. Image ID:
`sha256:4803793c40102e93e812a6eeee8243d83d15781288728cd70b0a3f08f68187d9`.
Python AST và diff whitespace đạt. Chưa khởi chạy container hoặc tạo âm thanh.

Từ thư mục gốc:

```powershell
docker build --pull --tag text2speech-engine:phase4.1 --file engine/Dockerfile engine
```

Build không tải weights OpenVoice/WavMark hoặc gọi dịch vụ TTS. `.dockerignore`
giới hạn context vào source và dependency declarations, loại venv, weights, file
âm thanh, processed/cache và env của máy host. Image CPU không tự tăng tốc bằng GPU.

### Các thư mục sẽ mount ở mục 1c

| Đường dẫn trong container | Vai trò |
| --- | --- |
| `/app/backend/data/book-audio` | Cùng đường dẫn và dữ liệu với worker; chứa từng phần và embedding của job |
| `/app/backend/public/audio` | Cùng mẫu giọng/audio bài giảng với Backend |
| `/app/engine/checkpoints/converter` | Weights OpenVoice; có thể dùng hai file đang có trên máy |
| `/home/tts/.cache` | Cache Hugging Face (gồm WavMark), Torch và Numba; giữ qua restart |
| `/app/engine/processed` | Các đoạn tạm khi clone bài giảng |

Thư mục mount cần quyền ghi cho UID/GID 1000 khi Engine tải model/cache hoặc tạo file.
Container nghe `0.0.0.0:8000` **bên trong Docker**; `EXPOSE` không tự mở cổng Windows.
Mục này chưa bật Engine container hoặc chuyển ứng dụng đang dùng sang Docker, nên
không tạo thêm tiến trình tranh cổng 8000. Ghép mạng, volume, secret và thứ tự chạy
thực hiện ở mục 1c.

### Phạm vi xác nhận của mục 1b

Cú pháp Python được rà bằng AST. Build chỉ xác nhận dependency có thể cài và image
được tạo; chưa nạp model trong container, chưa tạo/nghe âm thanh hoặc benchmark.
Khả năng chạy thực tế của nhánh VAD đóng gói, model, quyền volume và kết nối giữa
các container cần được xác nhận ở môi trường ghép stack khi có yêu cầu kiểm thử.

## Mục 1c — Frontend và Compose local

### Đã thực hiện

- `frontend/Dockerfile`: build Vue bằng Node 24 từ lockfile, chỉ đưa `dist` vào
  Nginx; chạy user `nginx`, nghe cổng 8080 trong container. Cấu hình SPA giữ các
  đường dẫn `/book`, `/history`, `/admin` khi tải lại trang. Env build chỉ có URL,
  realm và client ID public, không có secret. Source/lockfile thay đổi cần build lại.
- `deploy/compose.app.yaml` mở rộng `keycloak/compose.yaml` với cùng project
  **tts-keycloak-local**. Các đường dẫn tương đối tính từ thư mục `keycloak` của
  file gốc theo quy tắc [Compose merge](https://docs.docker.com/compose/how-tos/multiple-compose-files/merge/).
  Không đổi tên/xóa volume PostgreSQL hoặc tạo realm/database thay thế. Container
  PostgreSQL/Keycloak/Mailpit hiện có được tái sử dụng. Mongo migration cũ vẫn giữ,
  không thuộc dependency runtime của ứng dụng.
- Backend và worker dùng cùng image; worker là service riêng, không publish cổng.
  Backend chờ PostgreSQL/Keycloak healthy, Frontend chờ Backend; worker chờ Backend
  và Engine healthy. Tất cả dùng `restart: unless-stopped`, `init: true` cho ứng dụng.
- `/api/health` kiểm tra kết nối database; Engine `/health/ready` kiểm tra pipeline
  đã nạp, FFmpeg/FFprobe, secret nội bộ và quyền truy cập thư mục dùng chung.
  Worker health đọc đúng ID của tiến trình trong `/tmp`, đối chiếu lease còn hạn
  trong PostgreSQL; worker khác đang chiếm lease không khiến container này báo healthy.
  Health không gọi Gemini/Edge-TTS hoặc tạo âm thanh, và không bảo đảm các API bên
  ngoài luôn khả dụng. Docker không tự restart chỉ vì healthcheck chuyển unhealthy;
  cần xem log khi tình trạng này kéo dài.
- `backend/scripts/init_docker_local.js` lấy các giá trị cần thiết từ bốn env private
  của Backend, giữ credentials và chỉ đổi địa chỉ PostgreSQL local sang `postgres:5432`.
  Tạo `deploy/backend.env`, `deploy/engine.env` đã bị Git bỏ qua, cùng khóa Engine.
  Không chép `MONGODB_URI` hoặc env vào image. `env_file: format: raw` giữ nguyên ký
  tự đặc biệt trong secret; yêu cầu Docker Compose **2.30.0 trở lên**.
  Công cụ mặc định từ chối ghi đè; `--refresh` là thao tác đồng bộ rõ ràng khi đổi cấu hình.
  Nó không tạo database, nhập dữ liệu hoặc quay vòng mật khẩu.

### Khởi động và vận hành trên máy hiện tại

Từ repo root, sau khi mở Docker Desktop và đợi Engine running:

```powershell
.\deploy\stack.ps1 up
.\deploy\stack.ps1 status
```

`up` chạy nền và chờ tối đa 600 giây để service healthy. Không build lại mỗi lần bật máy.
Nếu trước đó đã dùng `stop`, lệnh `up` bật lại. Nếu chỉ reboot và chưa stop, restart
policy thường bật lại container khi Docker Engine lên; vẫn có thể dùng `up` để bảo đảm.
Không cần mở các terminal Node/Vite/Python/worker riêng trong chế độ này.

| Địa chỉ Windows | Dịch vụ |
| --- | --- |
| http://localhost:5173 | Website Vue do Nginx phục vụ |
| http://localhost:3000/api/health | Backend và trạng thái kết nối PostgreSQL |
| http://localhost:8000/health/ready | Engine và model readiness |
| http://localhost:8080/admin/ | Keycloak Admin Console |
| http://localhost:8025 | Mailpit nhận email local |
| 127.0.0.1:5433 | PostgreSQL (database ứng dụng `tts_app`, database xác thực `keycloak`) |

Các cổng publish chỉ bind `127.0.0.1`; đây vẫn là môi trường local. Keycloak vẫn
`start-dev`, Mailpit dùng thư thử; chưa có HTTPS/domain hoặc cấu hình production.
Browser dùng URL public localhost; Backend gọi `keycloak:8080`, `engine:8000`,
`postgres:5432` trên mạng Compose. Issuer JWT public giữ nguyên localhost:8080.

```powershell
# Log gần nhất (bỏ -Service để xem toàn stack)
.\deploy\stack.ps1 logs -Service worker
.\deploy\stack.ps1 logs -Service engine

# Sau sửa source/dependency: build rồi cập nhật container
.\deploy\stack.ps1 build
.\deploy\stack.ps1 up

# Tắt stack, giữ database/audio/model/cache
.\deploy\stack.ps1 stop
```

Worker/Engine được phép dừng mềm tối đa 25 phút để hạn chế cắt ngang lời gọi xử lý.
Nếu đang làm sách, nên chờ hoàn tất hoặc hủy từ web trước khi tắt. Worker tự nhận job
queued sau khi sẵn sàng; job failed chỉ tiếp tục khi người dùng bấm thử lại.

**Lần đầu dựng Compose từ các cấu hình local đã có:**

```powershell
.\deploy\stack.ps1 prepare
.\deploy\stack.ps1 build
.\deploy\stack.ps1 up
```

Cần Node và dependency Backend trên host để chạy `prepare`; Docker Desktop/Compose,
`keycloak/.env`, bốn file `backend/.env`, `.env.postgres.local`, `.env.keycloak.local`,
`.env.books.local` và database đã hoàn tất chuyển đổi là điều kiện đầu vào. Máy hiện
tại đã chuẩn bị xong. Clone repo sang máy khác không tự mang theo secret, volume,
model hoặc dữ liệu; cần thiết lập/phục hồi theo tài liệu liên quan trước.

Khi đổi Gemini/R2/service secret trong env Windows:

```powershell
node backend/scripts/init_docker_local.js --refresh
.\deploy\stack.ps1 up
```

Nếu muốn đổi URL public/realm/client cho môi trường khác, cần cập nhật đồng bộ
Compose, Frontend build args, Keycloak client và CORS; script prepare này chỉ dành
cho stack local hiện tại. Không dùng nó như công cụ cấu hình production.

### Dữ liệu và quay về chạy terminal

| Dữ liệu | Nơi giữ |
| --- | --- |
| Hai database và mật khẩu Keycloak | Volume PostgreSQL cũ `tts-keycloak-local_keycloak-postgres-data` |
| Đoạn sách nói/embedding/checkpoint file | Bind `backend/data/book-audio` sang `/app/backend/data/book-audio` ở Engine và worker |
| Mẫu và audio bài giảng/local history | Bind `backend/public/audio` sang `/app/backend/public/audio` ở Backend, worker, Engine |
| OpenVoice config/checkpoint | Bind `engine/checkpoints/converter` (dùng lại hai file có sẵn) |
| Hugging Face/Torch/Numba cache | Volume `tts-keycloak-local_engine-cache` |
| Đoạn clone tạm | Volume `tts-keycloak-local_engine-processed` |
| Audio đã lưu R2 | Bucket/key hiện có, không chuyển hoặc xóa khi đóng gói |

Không dùng `down -v`, không xóa thư mục bind để sửa lỗi khởi động. Backup database
không bao gồm audio local hoặc R2; cần giữ các thư mục/bucket tương ứng. Công cụ
backup cũ vẫn dùng được vì project PostgreSQL không đổi:

```powershell
node backend/scripts/backup_app_postgres.js
.\keycloak\backup.ps1
```

Đã tạo backup trước khi bật ứng dụng:
`keycloak/backups/app-postgres-1792475405319.dump` và
`keycloak/backups/keycloak-20261020-125006-29d670b4.dump`.

Muốn chạy lại bằng terminal để phát triển, dừng bốn service ứng dụng trước, giữ hạ tầng:

```powershell
.\deploy\stack.ps1 stop -Service worker
.\deploy\stack.ps1 stop -Service frontend
.\deploy\stack.ps1 stop -Service backend
.\deploy\stack.ps1 stop -Service engine
```

Sau đó chạy theo README bằng env Windows cũ. Khi quay về Docker, dừng đúng các tiến
trình terminal của dự án trước, rồi `up`; không đồng thời chạy hai Engine ở cổng 8000
hoặc hai worker tranh lease. Không cần chuyển/nhập database lại.

### Kết quả và giới hạn

Ngày 20/10/2026 build thành công ba image và bật đủ bảy service ứng dụng/hạ tầng
`healthy`. Backend kết nối `tts_app`; Engine nạp model CPU với 16 threads,
checkpoint không thiếu/thừa keys; worker giữ lease riêng. Đọc số liệu trước/sau:
3 user (3 liên kết Keycloak, 1 admin), 4 voice, 9 job, 3 lịch sử; không có queued/processing.
Không thêm/chạy bộ test, không gọi Gemini/TTS hoặc tự retry sách. Chưa kiểm thử
đăng nhập/đăng ký/upload/clone/VAD và nghe âm thanh trong Docker; trạng thái healthy
không thay thế việc xác nhận toàn luồng này. Build Frontend còn cảnh báo kích thước
chunk PDF lớn, build vẫn thành công.

Hoàn thành mục đóng gói/chạy local **1a–1c** và dừng trước mục 2 (chọn nơi deploy,
tài nguyên, domain và phương án sao lưu/phục hồi).

### Tham khảo

- [Docker: hướng dẫn đóng gói Node.js](https://docs.docker.com/guides/nodejs/).
- [Node.js Docker image: chạy với user riêng](https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md).
- [Keycloak: hostname public và kết nối nội bộ](https://www.keycloak.org/server/hostname).
- [PyTorch/TorchAudio: chọn cùng phiên bản và CPU wheels](https://docs.pytorch.org/get-started/previous-versions/).
- [Silero VAD: cách dùng gói Python](https://github.com/snakers4/silero-vad).
- [Revision OpenVoice V2 được dùng cho image](https://huggingface.co/myshell-ai/OpenVoiceV2/tree/ea66dc9353e660b1dbbe0bebebd4c2d8b105483c/converter).
