# Hệ Thống Sinh Bài Giảng Tự Động (Voice Cloning TTS)

Dự án niên luận: hệ thống chuyển văn bản thành bài giảng dạng âm thanh bằng công nghệ
TTS tiếng Việt và nhân bản âm sắc (Voice Cloning), với tài khoản người dùng và trang
quản trị dành cho admin.

Hệ thống được thiết kế theo mô hình Microservices với 3 thành phần chính:

## Kiến Trúc Hệ Thống

1. **Frontend (Vue.js 3 + Vite):**
   - Giao diện người dùng: tạo bài giảng từ văn bản hoặc file (.txt/.docx/.pdf), chọn
     giọng đọc mẫu và phong cách đọc, nghe kết quả ngay trên trình duyệt.
   - Trang **Sách Nói AI**: upload sách, Gemini tóm tắt và tự chọn giọng nam/nữ phù hợp.
   - Trang **Quản Trị** (chỉ admin): quản lý người dùng (role, trạng thái) và giọng đọc mẫu.
   - Thư mục: `frontend/` — Cổng mặc định: `5173`

2. **Backend Gateway (Node.js + Express):**
   - Cầu nối giữa Frontend và AI Engine, đồng thời host tĩnh các file âm thanh kết quả.
   - Xác thực JWT, phân quyền `user`/`admin`, lưu trữ dữ liệu trên **MongoDB** (Mongoose).
   - Tích hợp Google Gemini cho tính năng tóm tắt sách.
   - Thư mục: `backend/` — Cổng mặc định: `3000` (cấu hình qua biến `PORT`)

3. **AI Engine (Python + FastAPI):**
   - Sinh giọng nói tiếng Việt bằng **Edge-TTS** (fallback gTTS) và nhân bản âm sắc
     bằng **OpenVoice V2** (ToneColorConverter), hỗ trợ GPU CUDA.
   - Thư mục: `engine/` — Cổng mặc định: `8000`

```
Frontend (5173) ──► Backend Gateway (3000) ──► AI Engine (8000)
                        │                          │
                        ▼                          ▼
                    MongoDB                 Edge-TTS + OpenVoice V2
                                            └─ Gemini (gọi từ Backend)
```

## Hướng Dẫn Cài Đặt & Khởi Chạy

Cần khởi chạy đồng thời cả 3 dịch vụ trên 3 terminal khác nhau.

### Bước 0: Cấu hình biến môi trường
- `backend/`: copy `backend/.env.example` thành `backend/.env` và điền `MONGODB_URI`,
  `JWT_SECRET`, `GEMINI_API_KEY`.
- Dùng Cloudflare R2: điền thêm `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`,
  `R2_SECRET_ACCESS_KEY` trong `backend/.env`. Nếu để trống, audio tiếp tục được lưu
  trên đĩa local. Sau khi cấu hình R2, chạy `node migrate_audio_to_r2.js` từ `backend/`
  để chuyển audio hiện có; script giữ nguyên các file local.
- `frontend/`: copy `frontend/.env.example` thành `frontend/.env` (đổi `VITE_API_URL`
  nếu backend chạy cổng khác 3000).

### Bước 1: Khởi chạy AI Engine (Python)
```bash
cd engine
# Lần đầu: xem hướng dẫn chi tiết trong engine/README.md (tạo venv, cài FFmpeg)
.\venv\Scripts\activate
python main.py
```
*Lần chạy đầu tiên, Engine tự tải trọng số OpenVoice V2 (~260MB) từ HuggingFace.*

### Bước 2: Khởi chạy Backend (Node.js)
```bash
cd backend
npm install
node server.js
```
*Tạo tài khoản admin đầu tiên: `node create_admin.js` (theo hướng dẫn trong file).*

### Bước 3: Khởi chạy Frontend (Vue.js)
```bash
cd frontend
npm install
npm run dev
```

## Cách Sử Dụng
1. Mở trình duyệt truy cập `http://localhost:5173` và đăng ký/đăng nhập.
2. Ở trang **Tạo Bài Giảng**: nhập kịch bản (hoặc upload file .txt/.docx/.pdf),
   chọn giọng đọc và phong cách, bấm tạo và nghe thử.
3. Ở trang **Sách Nói AI**: upload sách, hệ thống tóm tắt bằng Gemini và sinh audio
   với giọng được đề xuất tự động.
4. **Admin** truy cập `/admin` để quản lý người dùng và thêm/xóa giọng đọc mẫu.

## Thêm Giọng Đọc Mẫu
- **Qua giao diện (khuyến nghị):** Admin thêm tại trang `/admin`, hoặc người dùng
  tự thêm giọng mẫu riêng (chỉ mình họ nhìn thấy) ngay tại trang tạo bài giảng.
- Yêu cầu: file ghi âm mẫu (`.wav`/`.m4a`), tên mã giọng nên chứa `male` nếu là
  giọng nam để hệ thống chọn giọng gốc Edge-TTS phù hợp.

---
*Dự án Niên Luận được xây dựng với mục tiêu tối ưu hóa trải nghiệm học tập và số hóa bài giảng.*
