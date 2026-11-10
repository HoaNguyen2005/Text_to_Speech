# Thiết lập trạm GPU RTX 4060

Máy bàn chạy Engine, VieNeu-TTS và OmniVoice với CUDA qua Docker hoặc trực tiếp trên Windows. Cloudflare Tunnel đưa API Engine ra ngoài qua HTTPS. Engine đăng ký URL với Backend để hệ thống ưu tiên GPU và có thể chọn CPU dự phòng khi GPU không sẵn sàng.

## Chuẩn bị

Từ thư mục gốc của repo, kiểm tra mã nguồn và driver NVIDIA. Nếu dùng Docker, mở Docker Desktop ở chế độ Linux containers trên WSL2 và kiểm tra Docker:

```powershell
git status --short
nvidia-smi
docker info --format "{{.ServerVersion}}"
```

Dùng bản mã mới nhất đã được đồng bộ cho máy bàn. Chuẩn bị model OpenVoice và các thư mục dữ liệu theo [engine/README.md](engine/README.md).

## Cấu hình khóa dùng chung

`BOOK_ENGINE_SECRET` của GPU phải khớp với khóa đang cấu hình cho Backend và Engine CPU dự phòng. Lấy khóa qua kênh riêng, lưu trong `deploy/engine.gpu.env` và giữ file ngoài Git.

Nếu chưa có file env, tạo mẫu bằng lệnh sau rồi điền giá trị đúng vào dòng `BOOK_ENGINE_SECRET` bằng trình soạn thảo:

```powershell
.\deploy\gpu-node.ps1 -Action prepare
```

Nếu trước đây khóa từng xuất hiện trong tài liệu hoặc log chia sẻ, hãy thay khóa đồng bộ trên Backend, worker và cả hai Engine, sau đó khởi động lại các dịch vụ nhận biến mới.

## Build và chạy

```powershell
.\deploy\gpu-node.ps1 -Action all
```

Khi Docker sẵn sàng, lệnh build image CUDA và khởi động cụm dịch vụ. Khi Docker không khả dụng, script chạy trực tiếp trên Windows.

### Chạy trực tiếp trên Windows

- Chuẩn bị Node.js, Python, FFmpeg và môi trường `engine/venv` đã cài phụ thuộc của Engine cùng PyTorch hỗ trợ CUDA. Script dùng môi trường này để chuẩn bị môi trường VieNeu và tải `cloudflared` nếu cần.
- Lệnh `-Action all` dùng lại môi trường CUDA trong `%USERPROFILE%\OmniVoice-trial` nếu đã chạy OmniVoice thử. Script bổ sung FastAPI và Uvicorn, rồi mở OmniVoice ở `127.0.0.1:8002` để Engine gọi nội bộ.
- Khi cập nhật từ bản Engine cũ, chạy `.\deploy\gpu-node.ps1 -Action stop` trước, rồi chạy `-Action all` để nạp cấu hình OmniVoice và mã Worker mới.
- Để chạy worker trên máy bàn, cấu hình `DATABASE_URL` cho cùng PostgreSQL mà Backend đang dùng. Có thể đặt trong `.env.local` ở gốc dự án hoặc trong `deploy/engine.gpu.env`. Cấu hình thêm các khóa dịch vụ của worker như Gemini và R2 theo [BOOK_AUDIO.md](BOOK_AUDIO.md).
- Worker gọi Engine qua `127.0.0.1:8000` và dùng thư mục âm thanh chung `backend/data/book-audio`. Xem log worker bằng `.\deploy\gpu-node.ps1 -Action logs -Service worker` trong chế độ này.

## Kiểm tra

1. Chạy `Invoke-RestMethod http://127.0.0.1:8000/health/ready`. Kết quả mong đợi là `status: ok`, thiết bị CUDA, tên card RTX 4060 và `omnivoice: true`.
2. Xem log tunnel và kiểm tra đường dẫn `/health/ready` từ URL HTTPS được in ra.
3. Xem log đăng ký để xác nhận Backend đã nhận node GPU. Nếu đã có tunnel mà đăng ký lỗi, chạy lại `register` sau khi kiểm tra khóa và địa chỉ Backend.

| Việc cần làm | Lệnh |
| --- | --- |
| Xem trạng thái | `.\deploy\gpu-node.ps1 -Action status` |
| Xem log Engine | `.\deploy\gpu-node.ps1 -Action logs -Service engine` |
| Xem log OmniVoice | `.\deploy\gpu-node.ps1 -Action logs -Service omnivoice` |
| Xem URL tunnel | `.\deploy\gpu-node.ps1 -Action logs -Service tunnel` |
| Đăng ký lại với Backend | `.\deploy\gpu-node.ps1 -Action register` |
| Dừng trạm GPU | `.\deploy\gpu-node.ps1 -Action stop` |

URL tunnel có thể đổi sau khi khởi động lại. Nếu cần kiểm tra Backend khác, truyền `-BackendUrl` cho lệnh đăng ký thủ công. Cấu hình tự đăng ký trong container nằm ở `REMOTE_BACKEND_URLS` trong `deploy/compose.gpu-node.yaml`.
