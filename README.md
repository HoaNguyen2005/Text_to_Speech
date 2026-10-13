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
   - Xác thực access token Keycloak bằng JWKS, phân quyền `user`/`admin`; **MongoDB** giữ hồ sơ, giọng mẫu và lịch sử.
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

### Cấu trúc giao diện frontend

Các trang Vue được tổ chức theo vai trò:

```text
frontend/src/
├── views/
│   ├── user/
│   │   ├── LectureCreator.vue   # Tạo bài giảng
│   │   ├── BookSummarizer.vue   # Sách nói AI
│   │   └── HistoryView.vue      # Lịch sử cá nhân
│   ├── admin/
│   │   └── AdminPanel.vue       # Tài khoản và giọng mẫu
│   └── NotFound.vue            # Trang chung
├── layouts/AppShell.vue        # Khung điều hướng theo vai trò
├── components/
│   ├── Auth.vue                # Trang chào đăng nhập chung
│   └── UiIcon.vue              # Biểu tượng SVG dùng chung
└── assets/workspace.css        # Màu sắc, bố cục và thành phần giao diện
```

Đường dẫn ứng dụng giữ nguyên: `/`, `/book`, `/history`, `/admin`.
Router tải trang theo nhu cầu và giữ guard quyền quản trị.

Ngoài stack Keycloak local, chạy Frontend và Backend trên các terminal riêng.
Khi tạo âm thanh, chạy thêm AI Engine.

### Bước 0: Cấu hình biến môi trường
- `backend/`: copy `backend/.env.example` thành `backend/.env` và điền `MONGODB_URI`,
  `GEMINI_API_KEY`.
- Dùng Cloudflare R2: điền thêm `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`,
  `R2_SECRET_ACCESS_KEY` trong `backend/.env`. Nếu để trống, audio tiếp tục được lưu
  trên đĩa local. Khi đủ cấu hình R2, audio mới được đưa lên bucket tự động.
- `frontend/`: copy `frontend/.env.example` thành `frontend/.env` (đổi `VITE_API_URL`
  nếu backend chạy cổng khác 3000).
- Trước khi chạy backend, cấu hình stack/service account theo mục Keycloak bên dưới.
  Hướng dẫn chuyển đổi dữ liệu: [keycloak/PHASE3.md](keycloak/PHASE3.md).

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
*Backend đọc cấu hình riêng `backend/.env.keycloak.local`, do công cụ Phase 3 tạo.*

### Bước 3: Khởi chạy Frontend (Vue.js)
```bash
cd frontend
npm install
npm run dev
```

### Keycloak + PostgreSQL local

Trang đăng nhập/đăng ký dùng **theme Text2Speech**, đồng bộ màu sắc với website và mặc định
tiếng Việt. Hướng dẫn áp dụng, tùy chỉnh và deploy: [keycloak/THEME.md](keycloak/THEME.md).

Keycloak quản lý tài khoản và lưu dữ liệu xác thực trong **PostgreSQL local**.
Stack gồm Keycloak, PostgreSQL, Mailpit (hộp thư local) và MongoDB riêng cho bản sao
migration. Hướng dẫn migration và backup đầy đủ nằm trong [keycloak/README.md](keycloak/README.md).

**Trạng thái ngày 13/10/2026:** Phase 3 đã tích hợp Keycloak vào frontend/backend;
3 tài khoản nguồn được liên kết trên MongoDB ứng dụng, giữ nguyên `_id` và quyền sở hữu
dữ liệu. Mật khẩu được quản lý ở PostgreSQL qua Keycloak; hash bcrypt và JWT auth cũ đã dọn
sau backup. Chi tiết: [keycloak/PHASE3.md](keycloak/PHASE3.md).

#### A. Phần mềm và cấu hình cần có

- **Docker Desktop** đang chạy, dùng **Linux containers**, có Docker Compose.
  Trong cửa sổ Docker Desktop, góc dưới hiển thị `Engine running` khi Engine đã chạy.
- **Node.js và npm**; frontend hỗ trợ `^22.18.0 || >=24.12.0`.
- Các cổng local còn trống: **8080** (Keycloak), **8025** (Mailpit), **27018** (MongoDB migration).
  PostgreSQL được dùng trong mạng Docker, chưa mở cổng ra Windows.
- Chỉ khi sao chép tài khoản nguồn: cần `MONGODB_URI` hợp lệ trong `backend/.env`
  và quyền kết nối MongoDB nguồn. MongoDB Atlas cần cho phép IP máy trong Network Access.

Kiểm tra phần mềm trong PowerShell:

```powershell
docker version
docker compose version
node --version
npm --version
```

`docker version` cần hiển thị cả phần `Client` và `Server`.

#### B. Cài đặt và khởi chạy lần đầu

Chạy từ thư mục gốc của repository. Trên máy hiện tại:

```powershell
cd D:\Tai_lieu_Dai_hoc\NienLuan\Text_to_Speech

# Cài thư viện cho các công cụ Keycloak
cd backend
npm ci
cd ..

# Tạo cấu hình local với mật khẩu ngẫu nhiên; giữ file đã tồn tại
node backend/scripts/init_keycloak_local.js

# Bật stack và chờ các dịch vụ sẵn sàng
docker compose --env-file keycloak/.env -f keycloak/compose.yaml --profile migration up -d --wait

# Khai báo các thuộc tính liên kết tài khoản, chỉ administrator được sửa
node backend/scripts/configure_keycloak_phase3.js
```

Script init và configure Phase 3 tạo các file cấu hình được Git bỏ qua:

| File | Biến chính và mục đích |
|---|---|
| `keycloak/.env` | `KEYCLOAK_VERSION`, `MAILPIT_VERSION`: phiên bản image; `KEYCLOAK_DB_PASSWORD`: mật khẩu PostgreSQL; `KEYCLOAK_ADMIN_USERNAME`, `KEYCLOAK_ADMIN_PASSWORD`: tài khoản quản trị Keycloak |
| `backend/.env.migration.local` | `KEYCLOAK_URL=http://localhost:8080`, `KEYCLOAK_REALM=tts-local`, `KEYCLOAK_MIGRATION_MONGODB_URI=mongodb://127.0.0.1:27018/tts_phase2_local`; client/redirect của thư đặt mật khẩu |
| `backend/.env.keycloak.local` | URL/realm/audience, `KEYCLOAK_SERVICE_CLIENT_ID` và secret của service account backend; script Phase 3 tạo và Git bỏ qua |

Không chép mật khẩu thật vào README hoặc commit các file cấu hình này. Realm `tts-local`
được import khi chưa tồn tại; client SPA là `tts-frontend` (PKCE S256), client API là
`tts-backend`. SMTP của realm dùng `mailpit:1025`; thư được giữ trên máy.

#### C. Đăng nhập đúng tài khoản

| Mục đích | Địa chỉ | Realm | Tài khoản / mật khẩu |
|---|---|---|---|
| Quản trị Keycloak | [Admin Console](http://localhost:8080/admin/) | `master` | Username mặc định `local-admin`; mật khẩu là `KEYCLOAK_ADMIN_PASSWORD` trong `keycloak/.env` |
| Tài khoản ứng dụng trên Keycloak | [Trang tài khoản](http://localhost:8080/realms/tts-local/account/) | `tts-local` | Email đã migrate và mật khẩu mới đặt qua Mailpit |
| Đăng nhập ứng dụng TTS | [Frontend](http://localhost:5173) | `tts-local` | Bấm Đăng nhập; dùng email/username và mật khẩu Keycloak; cần chạy frontend/backend |

Tài khoản có role `admin` trong ứng dụng không phải tài khoản quản trị realm `master`.
Sau khi vào Admin Console bằng `local-admin`, chọn realm `tts-local` và mục **Users**
để xem các tài khoản đã nhập.

**Đặt mật khẩu cho tài khoản đã migrate:**

1. Mở [Mailpit](http://localhost:8025), chọn thư gửi đến email của mình.
2. Mở link trong thư và đặt mật khẩu Keycloak.
3. Đăng nhập ở trang tài khoản `tts-local` trong bảng trên.

Migration không sao chép hash bcrypt từ MongoDB, nên mật khẩu cũ không tự dùng được
trên Keycloak. Ứng dụng hiện chỉ dùng mật khẩu Keycloak; hash mật khẩu MongoDB cũ đã dọn sau backup. Link đặt
mật khẩu có thời hạn **12 giờ**. Nếu hết hạn, từ repo root chạy:

```powershell
node backend/scripts/prepare_keycloak_account_links.js --execute
```

Lệnh này chỉ gửi thư mới cho tài khoản active đã liên kết nhưng **chưa có mật khẩu**.
Tài khoản đã có mật khẩu dùng **Forgot Password?** trên trang đăng nhập để yêu cầu reset.
Sau khi đặt mật khẩu, quay về frontend và đăng nhập nếu chưa có phiên SSO.

#### D. Bật lại sau khi khởi động máy

1. Mở Docker Desktop và chờ `Engine running`. Có thể thu nhỏ cửa sổ để Docker chạy nền.
2. Mở PowerShell và chạy:

   ```powershell
   cd D:\Tai_lieu_Dai_hoc\NienLuan\Text_to_Speech
   docker compose --env-file keycloak/.env -f keycloak/compose.yaml --profile migration up -d --wait
   ```

3. Mở Admin Console hoặc Mailpit theo các địa chỉ ở trên.

Để Docker tự bật khi đăng nhập Windows: **Settings → General → Start Docker Desktop
when you sign in to your computer**. [Tài liệu Docker Desktop](https://docs.docker.com/desktop/settings-and-maintenance/settings/#general).

Các service dùng `restart: unless-stopped`, nên tự chạy lại cùng Docker nếu trước đó
chưa bị chủ động dừng. Nếu đã Stop hoặc chạy `docker compose down`, bật lại bằng lệnh
`up -d --wait` ở trên. Không cần chạy lại init, configure hoặc migration mỗi lần mở máy.

#### E. Kiểm tra và dừng stack

```powershell
# Xem trạng thái; các dịch vụ cần ở trạng thái running/healthy
docker compose --env-file keycloak/.env -f keycloak/compose.yaml --profile migration ps

# Xem log khi Keycloak chưa sẵn sàng
docker compose --env-file keycloak/.env -f keycloak/compose.yaml logs --tail 100 keycloak

# Dừng stack, giữ dữ liệu trong volume
docker compose --env-file keycloak/.env -f keycloak/compose.yaml --profile migration down
```

PostgreSQL, MongoDB migration và Mailpit lưu dữ liệu trong volume. **Không dùng
`down -v` nếu cần giữ tài khoản và dữ liệu.** Sao lưu PostgreSQL bằng
`./keycloak/backup.ps1`; hướng dẫn khôi phục nằm trong `keycloak/README.md`.

**Khi gặp `Invalid username or password`:** kiểm tra realm trong URL. `/realms/master/`
dùng tài khoản quản trị Keycloak; `/realms/tts-local/` dùng tài khoản ứng dụng đã đặt
mật khẩu mới. Nếu đã đổi mật khẩu administrator trong Keycloak, cập nhật credentials
trong `keycloak/.env` để các công cụ local dùng đúng mật khẩu; sửa file `.env` đơn thuần
không tự đổi mật khẩu tài khoản đã tồn tại trong database.

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
