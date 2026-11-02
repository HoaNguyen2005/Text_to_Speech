# Hướng Dẫn Tự Động Cho AI Agent Trên PC (Trạm GPU RTX 4060 & Cloudflare Tunnel)

> **Dành cho AI Agent trên PC:** Khi người dùng yêu cầu bạn thiết lập dự án trên máy tính bàn (PC có GPU NVIDIA RTX 4060), hãy đọc toàn bộ tài liệu này và **thực thi tuần tự các bước từ Bước 1 đến Bước 5** mà không cần hỏi lại các cấu hình đã có sẵn bên dưới.

---

## 1. Bối cảnh kiến trúc hệ thống hiện tại

Dự án **Text2Speech** đang chạy theo kiến trúc Hybrid Cloud:
- **Frontend (Vue 3 / Vite):** Đã deploy trên **Cloudflare Pages** tại `https://text2speech-at0.pages.dev`.
- **Backend API (Node.js / Express):** Đã deploy trên **Render.com** tại `https://text2speech-backend.onrender.com`.
- **Database (PostgreSQL 18):** Đã chạy trên **Neon Cloud** (`neondb`).
- **Object Storage:** Đã chạy trên **Cloudflare R2**.
- **Vai trò của PC này (Máy bàn RTX 4060):**
  1. Chạy **Engine TTS (Edge-TTS + OpenVoice V2)** và **VieNeu-TTS** bằng Docker với **CUDA 12.8 trên GPU NVIDIA RTX 4060**.
  2. Chạy container **Cloudflare Tunnel (`cloudflared`)** để mở đường dẫn HTTPS công khai (`https://xxxx.trycloudflare.com`) trỏ vào cổng `8000` của Engine.
  3. Xuất đường dẫn Tunnel để điền vào biến `ENGINE_URL` và `BOOK_ENGINE_URL` trên Render.com (hoặc trên Laptop).

---

## 2. Quy trình thực thi tự động cho AI Agent trên PC

### Bước 1: Kiểm tra Git, Docker Desktop và GPU NVIDIA
Chạy lệnh kiểm tra trạng thái Git, Docker daemon và GPU trong WSL2/Docker:

```powershell
git pull origin main
nvidia-smi
docker info --format "{{.ServerVersion}}"
```

- Nếu `docker info` báo lỗi chưa kết nối được daemon: hãy khởi chạy Docker Desktop (`Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"`) và chờ đến khi `docker info` trả về phiên bản thành công.
- Đảm bảo thư mục `backend/data/book-audio`, `backend/public/audio/samples`, `backend/public/audio/generated`, và `engine/checkpoints/converter` tồn tại:
  ```powershell
  New-Item -ItemType Directory -Force -Path "backend/data/book-audio", "backend/public/audio/samples", "backend/public/audio/generated", "engine/checkpoints/converter" | Out-Null
  ```

---

### Bước 2: Khởi tạo file môi trường GPU (`deploy/engine.gpu.env`)
Để đồng bộ khóa bảo mật với Backend trên Render.com (đã cài sẵn khóa `BOOK_ENGINE_SECRET`), hãy chạy lệnh `prepare` với đúng khóa sau:

```powershell
.\deploy\gpu-node.ps1 -Action prepare -Secret "fa6f5f632c22bd99916a8db84d50f720085bebefa945bfbb6e91e7ce509bc489"
```

*(Lệnh này sẽ tạo file `deploy/engine.gpu.env` bị Git bỏ qua, cấu hình `VIENEU_URL=http://vieneu:8001` và `OPENVOICE_WATERMARK=0`).*

---

### Bước 3: Build 2 Image GPU (CUDA 12.8) và Bật Container + Cloudflare Tunnel
Chạy lệnh tổng hợp `all` trong `deploy/gpu-node.ps1` (lần đầu build có thể mất 5–15 phút để tải base image `pytorch/pytorch:2.8.0-cuda12.8-cudnn-runtime` và cài đặt thư viện):

```powershell
.\deploy\gpu-node.ps1 -Action all -Secret "fa6f5f632c22bd99916a8db84d50f720085bebefa945bfbb6e91e7ce509bc489"
```

Nếu muốn chạy từng bước riêng để dễ theo dõi tiến trình:
```powershell
# 3.1. Build image Engine GPU và VieNeu GPU
.\deploy\gpu-node.ps1 -Action build

# 3.2. Khởi chạy container Engine + VieNeu trên GPU và đợi healthy
.\deploy\gpu-node.ps1 -Action up

# 3.3. Bật container Cloudflare Tunnel và lấy URL https://....trycloudflare.com
.\deploy\gpu-node.ps1 -Action tunnel
```

---

### Bước 4: Kiểm tra xác nhận GPU & Đường truyền Tunnel
Sau khi Bước 3 hoàn tất, AI Agent hãy chạy lệnh kiểm tra sau:

1. **Kiểm tra Engine local đã nhận GPU RTX 4060 chưa:**
   ```powershell
   Invoke-RestMethod -Uri "http://127.0.0.1:8000/health/ready"
   ```
   - Kết quả mong đợi: `status = "ok"`, `device = "cuda:0"`, `gpu_name = "NVIDIA GeForce RTX 4060..."`.

2. **Lấy URL Cloudflare Tunnel từ log và kiểm tra từ Internet:**
   ```powershell
   .\deploy\gpu-node.ps1 -Action logs -Service tunnel
   ```
   - Tìm dòng chứa `https://<ten-ngau-nhien>.trycloudflare.com`.
   - Gọi thử `Invoke-RestMethod -Uri "https://<ten-ngau-nhien>.trycloudflare.com/health/ready"` để chắc chắn trả về `status = "ok"`.

---

### Bước 5: Báo cáo kết quả cho Người dùng
Sau khi xác nhận thành công, AI Agent hãy in rõ 3 biến môi trường sau để người dùng dán vào mục **Environment** của service `text2speech_backend` trên **Render.com**:

```env
ENGINE_URL=https://<ten-ngau-nhien>.trycloudflare.com
BOOK_ENGINE_URL=https://<ten-ngau-nhien>.trycloudflare.com
BOOK_ENGINE_SECRET=fa6f5f632c22bd99916a8db84d50f720085bebefa945bfbb6e91e7ce509bc489
```

---

## 3. Các lệnh quản lý nhanh hằng ngày trên PC

| Thao tác | Lệnh PowerShell |
| :--- | :--- |
| Xem trạng thái các container GPU & Tunnel | `.\deploy\gpu-node.ps1 -Action status` |
| Bật lại trạm GPU + lấy link Tunnel mới sau khi bật máy | `.\deploy\gpu-node.ps1 -Action up` rồi `.\deploy\gpu-node.ps1 -Action tunnel` |
| Xem lại link Cloudflare Tunnel hiện tại | `.\deploy\gpu-node.ps1 -Action logs -Service tunnel` |
| Xem log xử lý âm thanh của Engine GPU | `.\deploy\gpu-node.ps1 -Action logs -Service engine` |
| Tắt trạm GPU khi không sử dụng | `.\deploy\gpu-node.ps1 -Action stop` |
