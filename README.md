# Text2Speech

Text2Speech chuyển văn bản thành bài giảng và sách nói tiếng Việt. Bạn có thể chọn giọng có sẵn hoặc tải giọng mẫu riêng, nghe thử, rồi tải kết quả hoặc mở lại từ lịch sử.

## Chạy trên máy hiện tại

Mở Docker Desktop, chờ Engine chạy rồi thực hiện từ thư mục gốc của repo:

```powershell
.\deploy\stack.ps1 up
```

Mở [Text2Speech](http://localhost:5173). Compose khởi động frontend, API, worker, Engine và các dịch vụ local đi kèm. Sau khi sửa mã, build lại image của dịch vụ đã sửa rồi chạy `up`.

| Việc cần làm | Lệnh từ thư mục gốc |
| --- | --- |
| Xem trạng thái | `.\deploy\stack.ps1 status` |
| Xem log Engine | `.\deploy\stack.ps1 logs -Service engine` |
| Build giao diện mới | `.\deploy\stack.ps1 build -Service frontend` |
| Dừng stack và giữ dữ liệu | `.\deploy\stack.ps1 stop` |

Lần đầu dựng máy mới, xem phần cấu hình Compose trong [PHASE4.md](PHASE4.md). Nếu dùng Neon, lấy cấu hình theo [NEON.md](NEON.md) rồi đồng bộ biến PostgreSQL bằng `npm run neon:docker-env`. Công cụ `stack.ps1 prepare` tạo cấu hình cho PostgreSQL local. Giữ các file env và backup trong phạm vi riêng tư.

## Dùng ứng dụng

1. **Tạo bài giảng:** nhập văn bản hoặc tải TXT, DOCX, PDF, chọn bộ tạo giọng và giọng đọc. Nghe thử trước khi tạo âm thanh nếu cần.
2. **Sách nói AI:** tải tài liệu hoặc dán nội dung, chọn thời lượng 1–59 phút và giọng đọc. Tạo bản tóm tắt, duyệt nội dung rồi tạo âm thanh. Xem từng bước trong [Quy trình tạo sách nói](QUY_TRINH_TAO_SACH_NOI.md).
3. **Giọng của bạn:** tải bản ghi riêng và quản lý giọng thuộc tài khoản của bạn. Admin quản lý giọng dùng chung ở `/admin`.
4. **Lịch sử:** mở lại kết quả, tải âm thanh và tải bản tóm tắt hoặc phụ đề khi có.
5. **Hồ sơ:** sửa tên và giới tính trong web. Quản lý email, mật khẩu và phiên đăng nhập qua Keycloak.

## Các thành phần

| Thư mục | Vai trò | Cổng local |
| --- | --- | --- |
| `frontend/` | Vue 3 và Vite. Trang người dùng ở `src/views/user/`, trang admin ở `src/views/admin/`. | 5173 |
| `backend/` | Express xác thực request, đọc/ghi PostgreSQL và điều phối Gemini, Engine, R2. Worker xử lý các yêu cầu sách nói. | 3000 |
| `engine/` | FastAPI tạo tiếng nói bằng Edge-TTS + OpenVoice hoặc chuyển yêu cầu sang dịch vụ VieNeu-TTS. | 8000 |
| `keycloak/` | Đăng nhập, đăng ký và quản lý quyền truy cập. PostgreSQL của Keycloak dùng database riêng. | 8080 |
| `deploy/` | Cấu hình Docker, trạm GPU và đăng ký Engine dự phòng. | — |

PostgreSQL ứng dụng lưu hồ sơ, giọng, yêu cầu và lịch sử. Các bản ghi trỏ tới tệp trong R2 hoặc thư mục audio local. Cấu hình triển khai trong repo dùng Neon cho dữ liệu ứng dụng, Pages cho frontend, Render cho API và các trạm Engine CPU/GPU. Xem cách thiết lập trạm GPU trong [PC_AGENT_SETUP.md](PC_AGENT_SETUP.md).

## Chạy từng dịch vụ để phát triển

Dừng container tương ứng trước khi dùng chung cổng. Chạy một worker cho mỗi môi trường dữ liệu.

- Cài Node dependencies bằng `npm ci --prefix backend` và `npm ci --prefix frontend`.
- Cấu hình realm và service account theo [keycloak/PHASE3.md](keycloak/PHASE3.md). Địa chỉ API và Keycloak của frontend nằm trong [frontend/.env.example](frontend/.env.example).
- Cấu hình database bằng [NEON.md](NEON.md) hoặc quy trình [PostgreSQL local](POSTGRES_MIGRATION.md). Khai báo Gemini và R2 theo [backend/.env.example](backend/.env.example).
- Tạo khóa Engine local bằng `npm --prefix backend run books:init`. Cài Python, FFmpeg và chạy Engine theo [engine/README.md](engine/README.md).
- Mở terminal riêng cho `npm start`, `npm run worker:books` và `npm run dev` tại thư mục gốc. Dùng `npm run build` để kiểm tra bản build frontend.

## Tài liệu theo công việc

| Mục tiêu | Tài liệu |
| --- | --- |
| Chạy Docker, cập nhật container, xem log | [PHASE4.md](PHASE4.md) |
| Thiết lập trạm GPU RTX 4060 và tunnel | [PC_AGENT_SETUP.md](PC_AGENT_SETUP.md) |
| Kết nối Neon, migration và backup | [NEON.md](NEON.md) |
| Đọc lịch sử chuyển từ MongoDB hoặc khôi phục môi trường local | [POSTGRES_MIGRATION.md](POSTGRES_MIGRATION.md) |
| Xử lý lỗi sách nói, Gemini, preview, audio và SRT | [BOOK_AUDIO.md](BOOK_AUDIO.md) |
| Hiểu luồng tóm tắt, đối chiếu, duyệt và tổng hợp audio | [QUY_TRINH_TAO_SACH_NOI.md](QUY_TRINH_TAO_SACH_NOI.md) |
| Cài và chẩn đoán Engine, FFmpeg, OpenVoice | [engine/README.md](engine/README.md) |
| Chọn và vận hành VieNeu-TTS | [VIENEU.md](VIENEU.md) |
| Cấu hình Keycloak, tra cứu chuyển đổi tài khoản | [keycloak/README.md](keycloak/README.md) · [keycloak/PHASE3.md](keycloak/PHASE3.md) |
| Chỉnh màu sắc, sáng/tối, ngôn ngữ trang xác thực | [keycloak/THEME.md](keycloak/THEME.md) |
| Xem lịch sử phát triển và kết quả kiểm tra từng mốc | [PROCESS.md](PROCESS.md) |
