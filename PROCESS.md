# PROCESS — Nhật Ký Tiến Độ Dự Án

> **Cách dùng file này:** Đọc từ đầu đến cuối để nắm toàn bộ bối cảnh và tiến độ hiện tại.
> Mỗi lần làm việc mới trên dự án, cập nhật thêm mục [4. Nhật ký làm việc](#4-nhật-ký-làm-việc)
> và [5. Việc tiếp theo](#5-việc-tiếp-theo--todo).
>
> **Cập nhật lần cuối:** 13/10/2026

---

## 1. Tổng Quan Dự Án

**Tên:** Hệ Thống Sinh Bài Giảng Tự Động (Voice Cloning TTS) — Dự án Niên luận.

**Mục tiêu:** Chuyển văn bản thành bài giảng / sách nói dạng âm thanh tiếng Việt,
kèm nhân bản âm sắc (voice cloning) từ file ghi âm mẫu, có tài khoản người dùng
và trang quản trị.

**Kiến trúc Microservices — 3 thành phần:**

```
Frontend (Vue 3 + Vite, cổng 5173)
      │  axios + access token Keycloak (bộ nhớ)
      ▼
Backend Gateway (Node.js + Express 5, cổng 3000)
      │                        │
      ▼                        ▼
MongoDB (Mongoose)        Google Gemini (tóm tắt sách)
      │
      ▼
AI Engine (Python + FastAPI, cổng 8000)
      │
      ▼
Edge-TTS (giọng Việt chuẩn) → OpenVoice V2 (clone âm sắc, hỗ trợ CUDA)
```

**Cấu trúc thư mục chính:**

| Thư mục | Vai trò |
|---|---|
| `frontend/` | SPA Vue 3 + Vue Router, đọc file .docx/.pdf client-side (mammoth + pdfjs) |
| `backend/` | Express gateway: auth, quản lý giọng mẫu, proxy sang Engine, tích hợp Gemini |
| `keycloak/` | Keycloak + PostgreSQL + Mailpit local; realm, theme Text2Speech, công cụ/tài liệu Phase 2–3 và backup |
| `engine/` | FastAPI: pipeline TTS 2 bước; thư viện OpenVoice vendored tại `engine/openvoice/` |
| Cloudflare R2 (`samples/`, `generated/`) | Âm thanh dùng chung khi R2 được cấu hình; MongoDB giữ object key để Backend tạo URL truy cập mới |
| `backend/public/audio/` | Fallback local cho phát triển khi chưa cấu hình R2; audio sinh tạm được Backend chuyển lên R2 khi bật cloud |

**Cấu trúc frontend hiện tại:**

```text
frontend/src/
├── views/
│   ├── user/
│   │   ├── LectureCreator.vue   # / — tạo bài giảng
│   │   ├── BookSummarizer.vue   # /book — sách nói AI
│   │   └── HistoryView.vue      # /history — lịch sử cá nhân
│   ├── admin/
│   │   └── AdminPanel.vue       # /admin — tài khoản và giọng đọc
│   └── NotFound.vue            # Trang 404 dùng chung
├── layouts/AppShell.vue        # Điều hướng và khung nội dung theo vai trò
├── components/
│   ├── Auth.vue                # Trang chào đăng nhập dùng chung
│   └── UiIcon.vue              # Biểu tượng SVG dùng chung
├── assets/workspace.css        # CSS giao diện hiện tại, thay common.css
└── router/index.js             # Lazy import trang và guard quyền quản trị
```

**Tính năng hiện có:**

1. **Tạo Bài Giảng** (`/`): nhập văn bản hoặc upload .txt/.docx/.pdf → chọn giọng + phong cách
   (news/story/normal) → sinh audio, nghe ngay trên trang. User có thể tự thêm giọng mẫu riêng.
2. **Sách Nói AI** (`/book`): upload sách → Gemini tóm tắt + phân tích thể loại + tự chọn
   giọng/phong cách phù hợp → tự sinh audio từ bản tóm tắt.
3. **Lịch Sử** (`/history`): 100 bản ghi sinh audio gần nhất của user, có tìm kiếm nội dung/giọng/phong cách.
4. **Quản Trị** (`/admin`, chỉ admin): tổng quan dữ liệu, tìm kiếm/lọc tài khoản, đổi role/status và quản lý giọng mẫu trong hai mục Tài khoản/Giọng đọc.
5. **Đăng nhập/Đăng ký** bắt buộc trước khi dùng app: Auth hiển thị khi chưa có session; biểu mẫu đăng nhập/đăng ký/đặt lại mật khẩu dùng theme Text2Speech tại Keycloak.

---

## 2. Trạng Thái Hiện Tại (13/10/2026)

- **Git:** nhánh `main`, remote `origin` là `HoaNguyen2005/Text_to_Speech`. Phiên 13/10 chốt mốc Phase 2–3 và giao diện trước khi triển khai sách nói 10/20/30 phút; xem `git log` để lấy mã commit của mốc này. Commit trước mốc là `8bcf244` (hiện/ẩn mật khẩu), trước đó là `ea6f282` (R2).
- **Luồng end-to-end đã hoạt động ở các phiên trước:** đăng nhập → tạo bài giảng → clone giọng → nghe kết quả → lịch sử. Sau lần làm mới giao diện chưa chạy lại pipeline AI/Gemini.
- **Luồng Sách Nói AI** đã tích hợp Gemini (có retry + fallback model).
- **Engine** tự tải weights OpenVoice V2 (~260MB) từ HuggingFace lần chạy đầu;
  FFmpeg phải nằm trong `engine/venv/Scripts/`.
- `.env` được gitignore. Không ghi giá trị secret vào tài liệu. Phiên hoàn thiện Phase 2 đã đọc 3 tài khoản từ MongoDB Atlas và sao chép metadata sang MongoDB migration local; không sửa database ứng dụng. Không kiểm tra lại dữ liệu R2 trong phiên này.
- **Phase 3 đã hoàn thành local:** frontend/backend dùng Keycloak realm `tts-local`; đã liên kết 3 tài khoản (1 admin) trên MongoDB ứng dụng, giữ `_id`. Đã dọn 3 hash bcrypt và JWT_SECRET cũ sau backup. Tại lần đối chiếu hoàn thiện Phase 3 có 1 tài khoản đã đặt mật khẩu, 2 tài khoản thiếu được gửi link mới vào Mailpit; số tài khoản đã đặt mật khẩu chưa được thống kê lại sau đó. Backend/frontend dùng cổng 3000/5173; Engine cần chạy thêm khi tạo audio.
- **Theme Text2Speech đã áp dụng:** giao diện xác thực của `tts-local` đồng bộ nền sáng/khung trắng/nút đen với website, mặc định tiếng Việt và có lựa chọn English. Hướng dẫn tại `keycloak/THEME.md`.
- **Giao diện người dùng/quản trị đã làm mới:** điều hướng chung tại `layouts/AppShell.vue`; các trang nằm trong `views/user/` và `views/admin/`. CSS chung hiện tại là `assets/workspace.css`.
- **Kết quả xác minh giao diện gần nhất:** frontend build thành công; trang quản trị hiển thị dữ liệu thật (3 tài khoản, 1 admin, 3 giọng đang dùng). Đã xem trước cả ba trang người dùng từ template Vue với dữ liệu minh họa. 11 nhóm test auth là kết quả phiên hoàn thiện Phase 3, chưa chạy lại sau thay đổi giao diện. Còn cảnh báo chunk PDF khoảng 820 KB.

### Lộ trình triển khai

| Phase | Trạng thái | Ghi chú |
|---|---|---|
| 1. Tách lưu trữ ra R2 | **Hoàn thành** | 3/3 giọng mẫu tham chiếu key R2; 17 audio kết quả local đã upload. MongoDB lưu object key, API trả presigned URL mới để lịch sử không bị hết hạn. 7 bản ghi lịch sử thiếu audio đã được xóa theo yêu cầu. |
| 2. Dựng Keycloak | **Hoàn thành local** | Stack healthy, realm/client/roles/PKCE; đã nhập 3 tài khoản, có volume và backup. |
| 3. Cắt auth cũ | **Hoàn thành local** | Vue keycloak-js + PKCE, Express jose/JWKS + kiểm tra role/status/SSO session; mapping nguồn và AdminPanel đồng bộ. 11 nhóm test API và kiểm tra UI đã đạt; bỏ auth cũ/create_admin.js. |
| 4. Dockerize + deploy | Chưa bắt đầu | Backend/Engine, VPS, Vercel, HTTPS và domain. |
| 5. Dọn dẹp | Đã làm một phần | Đã bỏ module Lecture/service rỗng, dùng CSS chung và tách trang Vue theo user/admin; còn việc truyền gender tường minh sang Engine. |

**Phần giao diện bổ sung đã hoàn thành:** theme Keycloak Text2Speech, trang chào đăng nhập,
ba trang người dùng và trang quản trị. Cấu trúc source/README đã cập nhật và nằm trong mốc lưu trước tính năng sách nói dài.

---

## 3. Lịch Sử Commit (điểm mốc chính)

| Commit | Nội dung |
|---|---|
| `e5ba64d` | Initial commit |
| `ba413a5` | Remove node_modules |
| `560bb34` | Tối ưu cấu trúc, dọn model cũ, thêm .gitignore |
| `ccb3132` | Update README.md |
| `d5a4d70` | Thêm backend/.env.example |
| `6a7f21d` | Tích hợp Gemini cho Sách Nói AI + cập nhật OpenVoice Tone Converter |
| `ea6f282` | Tách lưu trữ audio sang Cloudflare R2 |
| `8bcf244` | **(mới nhất)** Thêm nút hiện/ẩn mật khẩu trong Auth.vue |

Mốc Phase 2–3/giao diện ngày 13/10 dùng commit message
`feat: complete local Keycloak auth and redesign application UI`; tra mã hash bằng `git log`
vì PROCESS nằm trong chính commit đó.

---

## 4. Nhật Ký Làm Việc

### Phiên 02/10/2026 — Rà soát toàn dự án (audit)

**Đã làm:** Xem toàn bộ mã nguồn 3 thành phần, ghi nhận kiến trúc và phát hiện các vấn đề sau
(chưa sửa — xem mục 5):

1. **[Bảo mật — nghiêm trọng] API quản lý user chưa có middleware xác thực hoặc phân quyền:**
   `GET /api/auth/users`, `PUT /api/auth/users/:id/status`, `PUT /api/auth/users/:id/role`
   (`backend/app/routes/auth.route.js`) không gắn middleware nào. Bất kỳ caller nào cũng có thể
   gọi trực tiếp các API này, gồm xem/cập nhật tài khoản và tự đổi role; router guard frontend
   không bảo vệ backend.
2. **[Bảo mật] Voice update/delete thiếu kiểm tra ownership:**
   `PUT/DELETE /api/voices/:id` chỉ yêu cầu đăng nhập (`verifyToken`), không kiểm tra
   user là chủ sở hữu giọng hay admin → user thường có thể ẩn/sửa giọng global của admin.
3. **[Legacy] Module Lecture (slides) không còn dùng:** toàn bộ 5 file
   `backend/app/services/*.js` rỗng (0 dòng); model `Lecture` + route `/api/lectures` +
   controller `lecture.controller.js` không được frontend gọi đến.
4. **[Bảo mật phụ] `backend/create_admin.js` hardcode email + password admin dạng plaintext**
   trong mã nguồn (đã commit).
5. **[Nhất quán] README mô tả cho phép khách dùng không đăng nhập, nhưng `App.vue`
   bắt buộc đăng nhập** (`v-if="!session"` hiển thị Auth). Backend vốn hỗ trợ khách qua
   `optionalAuth`. Cần quyết định: sửa README hay mở lại chế độ khách.
6. **[Mong manh] Engine chọn giọng gốc Edge-TTS theo quy ước tên file chứa "male"**
   (`tts_pipeline.py` dòng ~50) — giọng có tên không chứa "male"/"female" sẽ mặc định là nữ.
7. **[Trùng lặp] CSS bị copy lặp giữa `App.vue` và `LectureCreator.vue`** (~370 dòng giống nhau),
   mỗi lần đổi theme phải sửa 2 nơi.

**Kết luận phiên:** Đã nắm chắc toàn bộ codebase; chưa thay đổi code nào ngoài việc tạo file PROCESS.md này.

### Phiên 03/10/2026 — Hoàn thiện Phase 1 (R2)

**Đã làm:**
- Thêm `@aws-sdk/client-s3` và presigner; tạo storage service chọn R2 khi đủ credentials, nếu không thì dùng đĩa local.
- Upload giọng mẫu từ Multer memory lên R2; giới hạn 50 MB, lọc định dạng audio và kiểm tra mã giọng để không tạo đường dẫn tùy ý.
- Backend gửi `reference_audio_url` có chữ ký cho Engine; Engine tải mẫu tạm về và vẫn dùng file local khi không có URL.
- Audio kết quả có tên duy nhất, được upload lên R2; response trả URL truy cập. MongoDB giữ object key, lịch sử tạo presigned URL mới ở mỗi lần tải để link không hết hạn.
- Bổ sung seed R2-aware và script migrate audio cũ; migration giữ file local để hỗ trợ dev.

**Kết quả migration thật:** đã upload 4 file mẫu và 17 file audio kết quả có trên đĩa lên bucket `tts-audio-storage`; cập nhật 3/3 bản ghi Voice sang key R2. Trong 7 bản ghi lịch sử, không có file nguồn tương ứng trong `backend/public/audio/generated/` và các object cùng tên cũng không tồn tại trên R2. Theo yêu cầu, đã xóa đúng 7 bản ghi đó; hiện MongoDB còn 0 bản ghi lịch sử cũ. File local và các object đã upload được giữ nguyên.

### Phiên 10/10/2026 — Đối chiếu PROCESS với repository

**Đã kiểm tra:** đối chiếu trạng thái Git, các route/controller auth và voice, pipeline Engine, README và cấu trúc thư mục.

- Xác nhận commit R2 (`ea6f282`) và nút hiện/ẩn mật khẩu (`8bcf244`) đã được tạo; các mục này không còn là thay đổi chưa commit.
- README hiện hướng dẫn đăng ký/đăng nhập, phù hợp với frontend bắt buộc đăng nhập; đã bỏ TODO cần quyết định giữa guest mode và sửa README.
- Trong `backend/app/services/`, có 5 file rỗng (`auth.service.js`, `lecture.service.js`, `media.service.js`, `slide.service.js`, `user.service.js`) và `storage.service.js` đang được sử dụng, không rỗng.
- Tại thời điểm rà soát, các lỗi phân quyền admin ở API quản lý user và ownership ở API sửa/xóa voice vẫn tồn tại; đã khắc phục trong mục nhật ký kế tiếp.
- Engine vẫn chọn Edge-TTS theo chuỗi `male` trong đường dẫn file, chưa nhận gender tường minh.
- Working tree có yêu cầu xóa `engine/data/reference_audios/giong_doc_tieu_thuyet.wav` và thay đổi ví dụ chạy trong `engine/tts_pipeline.py` sang `style_id = "story"`. Chưa chạy Engine để xác minh ví dụ.
- Lượt rà soát không kết nối/xác minh MongoDB hoặc R2; số liệu migration ở phiên 03/10 là ghi nhận từ phiên đó.

### Phiên 10/10/2026 — Khắc phục phân quyền API

**Đã sửa:**
- Bảo vệ `GET /api/auth/users` và hai API cập nhật trạng thái/role bằng `verifyToken` và `adminOnly`.
- Với `PUT/DELETE /api/voices/:id`, chỉ admin hoặc chủ sở hữu giọng được thao tác. User thường chỉ có thể cập nhật `name`, `gender`, `is_active`; không thể ghi đè `user_id`, `is_global` hoặc `file_path` qua endpoint cập nhật.
- Giữ hành vi AdminPanel đang dùng để ẩn giọng bằng `is_active: false`.

**Kiểm tra:** chưa chạy test hoặc khởi động ứng dụng. Cần xác minh các đường đi admin/user/guest và kiểm tra dữ liệu trong môi trường chạy trước khi triển khai.

### Phiên 10/10/2026 — Chuẩn bị Phase 2 (Keycloak)

**Đã chuẩn bị:**
- Tạo `keycloak/compose.yaml` cho PostgreSQL 17, Keycloak 26.8.0 và Mailpit; cổng Keycloak/Mailpit chỉ bind vào loopback.
- Tạo realm `tts-local`, roles `user`/`admin`, client SPA public với PKCE S256, và client API bearer-only. Access token có audience cho API và claim `mongoUserId` để giữ liên kết dữ liệu.
- Bổ sung trường tùy chọn `keycloakId` vào User MongoDB; giữ nguyên `_id` đang được Voice và GeneratedLecture tham chiếu.
- Tạo `backend/scripts/migrate_users_to_keycloak.js`. Mặc định chỉ đọc và thống kê; chế độ ghi yêu cầu `--execute --send-reset-email`, ánh xạ role/status, lưu ID Keycloak về MongoDB và gửi action đặt mật khẩu qua Mailpit.
- Hash hiện tại là bcrypt; không chép hash sang Keycloak. Khi chạy migration, tài khoản active cần đặt mật khẩu mới qua email; tài khoản inactive/banned được tạo ở trạng thái disabled.

**Chưa làm/chưa xác minh:** Docker CLI không khả dụng trong môi trường này nên chưa khởi động services hoặc kiểm tra import realm. Chưa kết nối MongoDB, chạy dry-run hay ghi tài khoản. Cần đọc `keycloak/README.md`, chuẩn bị `keycloak/.env` và xác minh backup trước khi thực thi migration.

---

### Phiên 10/10/2026 — Hoàn thiện Phase 2 local

**Đã triển khai:**
- Docker Desktop/Engine đã hoạt động. Chạy Keycloak 26.8.0, PostgreSQL 17, Mailpit 1.31.4 và MongoDB 8.0 cho bản sao migration trên port 27018; mọi cổng public chỉ bind loopback.
- Tạo secrets ngẫu nhiên trong `keycloak/.env` và cấu hình migration riêng ở `backend/.env.migration.local`; xác nhận Git bỏ qua hai file và thư mục backup.
- Cấu hình hồ sơ Keycloak: `mongoUserId`, `legacyStatus`, `migrationResetEmailSent`, `fullName`, `gender` do administrator quản lý; bỏ yêu cầu nhập lastName riêng. Policy thuộc tính không khai báo là null (disabled) theo API phiên bản hiện tại.
- Đọc **3 tài khoản nguồn từ MongoDB Atlas**, gồm **1 admin**, cả 3 active. Chỉ sao chép metadata và giữ `_id` vào `tts_phase2_local`; không chép password hash và không ghi MongoDB nguồn. Snapshot metadata đã lưu trong thư mục backup.
- Import đủ 3 tài khoản vào realm `tts-local`; lưu `keycloakId` trên bản sao local và `mongoUserId` trên Keycloak. Gửi link UPDATE_PASSWORD qua Mailpit local, không gửi email ra bên ngoài.
- Migration kiểm tra trùng email/username/ID trước khi ghi, bảo vệ mapping và hỗ trợ chạy lại. Đã sửa lỗi PUT profile cập nhật marker làm mất email/họ tên bằng cách giữ đầy đủ representation khi ghi marker; đã phục hồi dữ liệu local và xác nhận chạy lại thành công.
- Mailpit dùng SQLite trên volume; sau khi bật persistence đã tạo lại 3 thư với link mới. Chạy lại migration thông thường: **created = 0, reused = 3, emailsSent = 0**.
- Thêm công cụ init/configure/copy/migrate/check, script `keycloak/backup.ps1` và hướng dẫn vận hành bằng tiếng Việt.

**Kết quả vận hành đã đối chiếu:**
- Cả 4 services healthy. Discovery/JWKS trả hợp lệ; client public dùng Authorization Code, PKCE S256 và từ chối yêu cầu thiếu code challenge; client backend bearer-only, cấu hình audience/claim đúng.
- Đối chiếu cả 3 tài khoản: ID/email/họ tên/role/status và mapping đúng; bản sao local không chứa password hash. Thuộc tính mapping không cho user tự sửa. Mailpit có thư action cho cả 3 tài khoản active.
- Restart PostgreSQL, Keycloak, MongoDB migration và Mailpit; kiểm tra lại vẫn đạt, giữ đủ tài khoản/mapping/email.
- Backup PostgreSQL sau migration: `keycloak/backups/keycloak-20261010-205417-6871ef08.dump`; `pg_restore --list` đọc được archive. Chưa diễn tập restore ghi đè database.

**Phạm vi còn lại:** chưa đặt mật khẩu thay người dùng và chưa kiểm thử đăng nhập tương tác/token của tài khoản trên frontend. Bước nối frontend/backend và cập nhật mapping trên MongoDB ứng dụng thuộc Phase 3. Không đổi hạ tầng cloud; cấu hình deploy/HTTPS thuộc Phase 4. Dữ liệu Keycloak nằm trong PostgreSQL local; MongoDB ứng dụng và R2 giữ cấu hình hiện tại.

---

### Phiên 10/10/2026 — Bổ sung hướng dẫn sử dụng Keycloak

- Bổ sung README chính: phần mềm/cổng cần có, cài lần đầu, file cấu hình, địa chỉ và tài khoản đăng nhập, đặt mật khẩu qua Mailpit, bật lại sau khi khởi động máy, kiểm tra/log/dừng và backup.
- Làm rõ realm `master` dùng administrator Keycloak; realm `tts-local` dùng tài khoản ứng dụng đã đặt mật khẩu mới. Mật khẩu MongoDB cũ không được sao chép sang Keycloak; frontend vẫn dùng auth cũ đến Phase 3.
- Đồng bộ hướng dẫn đăng nhập và khởi động lại trong `keycloak/README.md`. Chỉ cập nhật tài liệu; không thay đổi services, tài khoản hoặc credentials.

---

### Phiên 13/10/2026 — Hoàn thiện Phase 3 local

**Dữ liệu và backup:**
- Full snapshot MongoDB trước chuyển đổi: `keycloak/backups/app-mongodb-1791863236443.json`, gồm documents/indexes của users (3), voices (3), generatedlectures (0), lectures (0); BSON ObjectId/Date được giữ bằng EJSON. Snapshot có dữ liệu nhạy cảm, được Git bỏ qua.
- Backup PostgreSQL trước thay đổi: `keycloak/backups/keycloak-20261013-104420-09cb81ae.dump`.
- Backup PostgreSQL sau hoàn thiện: `keycloak/backups/keycloak-20261013-145816-add31e92.dump`; archive đã đọc được bằng pg_restore --list.
- Liên kết đủ 3 tài khoản Keycloak với MongoDB ứng dụng qua keycloakId, giữ nguyên `_id`; preflight kiểm tra email, mongoUserId, role/status và backup trước ghi.
- Dọn 3 hash password cũ sau khi đối chiếu backup/mapping; lưu `keycloak/backups/backend-env-before-phase3-1791870318698.env` và bỏ JWT_SECRET cũ. Không đổi URI MongoDB, cấu hình R2 hoặc mật khẩu Keycloak đã có.
- Đối chiếu byte nội dung BSON của voices và generatedlectures với snapshot: không thay đổi. Full snapshot đã phục hồi thành công vào DB local rỗng `tts_phase3_restore_checks` với documents/indexes, rồi dọn DB thử.

**Backend:**
- Thay bcrypt/JWT tự phát bằng jose 6.2.12, JWKS của tts-local, RS256, issuer/audience/type/expiry validation. Token cũ/sai bị từ chối.
- Service account `tts-admin-service` chỉ thuộc realm ứng dụng, dùng client credentials; secret nằm trong `backend/.env.keycloak.local`, không đưa ra frontend/Git. Không dùng credentials master khi backend chạy.
- Mỗi request xác nhận enabled/role và phiên SSO còn sống; logout/revoke khiến token đã phát hành cũng bị chặn. Kiểm tra trạng thái MongoDB và phiên bản đồng bộ trước khi cấp quyền.
- GET `/api/auth/me`; đăng ký mới provision hồ sơ theo sub, ghi mongoUserId bằng service account. Không ghép tài khoản cũ theo email; không lưu mật khẩu MongoDB.
- AdminPanel cập nhật Keycloak + MongoDB với authSyncPending/authSyncVersion, kiểm tra kết quả và revoke sessions; lỗi giữ tài khoản bị chặn và cho phép retry. Lease 5 phút cho phép phục hồi khi tiến trình bị ngắt. Không tự khóa/hạ quyền administrator đang thao tác.
- Tạo bài giảng/tóm tắt yêu cầu xác thực; từ chối dùng giọng riêng của người khác trước khi gọi Engine. GET voices không có token chỉ trả global; token không hợp lệ không được coi là khách.
- Xóa create_admin.js, gỡ bcrypt/jsonwebtoken, bỏ API login/register cũ và password khỏi User schema.

**Frontend:**
- keycloak-js 26.2.4: Authorization Code + PKCE S256, callback xử lý trước router. Token chỉ ở bộ nhớ; xóa token/user cũ khỏi localStorage.
- Phiên dùng chung, refresh trước API, router dựa trên hồ sơ backend. Auth UI chuyển login/register sang Keycloak; logout kết thúc SSO; xử lý lỗi/khóa/pending và retry.
- Gender cho đăng ký dùng profile Keycloak có options kiểm tra; các thuộc tính mapping vẫn chỉ administrator sửa.

**Kiểm tra:**
- 11 nhóm integration đã đạt với tài khoản/client tạm và MongoDB `tts_phase3_checks`: code+PKCE, missing/legacy/tampered tokens, admin, ownership/lịch sử, role promotion/demotion, inactive/banned/self-lockout, lỗi đồng bộ + retry, đăng ký/provision, chống ghép email trùng, token expired/wrong audience/realm, refresh/logout (bao gồm chặn access token cũ sau logout).
- Browser: login user trả đúng ứng dụng, reload giữ SSO, lịch sử đúng user, admin vào /admin, logout về màn hình đăng nhập. Ảnh UI: `keycloak/backups/phase3-login-ui.png`.
- Dọn toàn bộ fixtures/client tạm; đối chiếu nguồn còn 3 user, 1 admin, 0 password hashes, 3 voices, 0 history; 0 tài khoản Keycloak thử còn lại.
- Frontend build thành công; còn cảnh báo chunk lớn từ các thư viện frontend hiện có. Chưa chạy lại pipeline tạo audio/Gemini thật trong phiên này.
- Kiểm tra bundle frontend không chứa secret service account backend; các env/backup thật đều được Git bỏ qua. Backend thật: health 200, GET me không token trả 401.
- Kết nối Atlas từng gặp TLS error tạm thời khi kiểm tra cuối; retry thành công, backend đã kết nối. Không giảm kiểm tra TLS hoặc sửa URI.
- Phát hiện 2 tài khoản active chưa có password credential và gửi 2 link 12 giờ mới vào Mailpit; tài khoản đã đặt mật khẩu được giữ nguyên. Người dùng tự đặt mật khẩu qua thư.
- Cập nhật README, keycloak/README.md và tài liệu runtime/check/backup/cutover tại `keycloak/PHASE3.md`. Backend/frontend thật đã khởi động ở 3000/5173.

---

### Phiên 13/10/2026 — Theme Text2Speech cho Keycloak

- Tạo `keycloak/themes/text2speech/login/`, kế thừa `keycloak.v2` của phiên bản 26.8.0; thêm CSS, favicon sóng âm, footer và nhãn tiếng Việt/English. Dùng biểu mẫu gốc cho login/register/reset/update password và thông báo.
- Đồng bộ nền `#f7f7f8`, khung trắng bo góc, chữ/nút `#111827`, font hệ thống và bố cục co giãn. Sửa padding mặc định PatternFly khiến khung bị hẹp khi xem trước.
- Compose mount theme chỉ đọc; local tắt cache theme để có thể sửa CSS/nội dung rồi tải lại trang. Đã recreate container Keycloak và áp dụng theme vào realm hiện có bằng `configure_keycloak_theme.js`.
- Script chỉ sửa tên hiển thị, login theme, ngôn ngữ và phần trình bày hồ sơ: tên đầy đủ theo locale, giới tính dạng select với nhãn Nam/Nữ/Khác, giữ validators/permissions và giá trị lưu. Tích hợp vào công cụ provision Phase 3 và realm import cho lần dựng mới.
- Lưu cấu hình theme trước đổi trong `keycloak/backups/theme-settings-before-*.json`. Xem trực tiếp trang đăng nhập, đăng ký và quên mật khẩu bằng trình duyệt; lưu ảnh `text2speech-login.png`, `text2speech-register.png`, `text2speech-reset-password.png` trong thư mục backups. Không chạy bộ test auth hoặc gửi biểu mẫu tạo tài khoản/đổi mật khẩu trong phiên theme.
- Bổ sung `keycloak/THEME.md`, liên kết hướng dẫn từ README chính và keycloak/README.md. Khi deploy cần bật lại cache theme và đưa thư mục theme vào image hoặc mount máy chủ.

---

### Phiên 13/10/2026 — Thiết kế lại trang chào đăng nhập

- Thiết kế lại `frontend/src/components/Auth.vue`: header/logo sóng âm, tiêu đề giới thiệu, minh họa waveform bằng CSS/SVG, ba tính năng và khung đăng nhập riêng. Dùng nền sáng, nút đen và điểm nhấn tím nhẹ.
- Bố cục hai cột trên màn hình rộng; màn hình nhỏ xếp phần giới thiệu → khung đăng nhập → minh họa/tính năng. Có trạng thái loading/error/retry/logout, focus bàn phím và giảm chuyển động theo thiết lập hệ thống.
- Thay favicon frontend bằng biểu tượng Text2Speech. Các nút tiếp tục dùng handler Keycloak hiện có.
- Frontend build thành công; còn cảnh báo chunk router/PDF lớn đã có trước. Đã xem trực tiếp trang local và lưu ảnh `keycloak/backups/text2speech-welcome.png`; không chạy bộ test auth trong phiên giao diện này.

---

### Phiên 13/10/2026 — Làm mới giao diện người dùng và quản trị

- Chuyển LectureCreator, BookSummarizer, HistoryView vào `frontend/src/views/user/`; AdminPanel vào `frontend/src/views/admin/`. Auth và NotFound là giao diện chung. Cập nhật router/import, giữ URL và guard phân quyền.
- Thêm `layouts/AppShell.vue` cho logo, điều hướng theo vai trò, hồ sơ và khung nội dung. Dùng chung SVG từ `components/UiIcon.vue`, màu sắc/thành phần tại `assets/workspace.css` thay CSS common cũ.
- Tạo bài giảng: editor riêng, đếm từ/ký tự, tên tài liệu, phần chọn giọng/phong cách, kết quả audio và biểu mẫu giọng cá nhân có loading/error/success.
- Sách nói: khung tải tài liệu, hướng dẫn ba bước, nội dung có thể chỉnh trước xử lý và phân khu audio/bản tóm tắt. Giữ giới hạn đọc 50 trang PDF đã có.
- Lịch sử: tìm kiếm trên các bản ghi đã tải, metadata giọng/phong cách/ngày, audio và trạng thái thư viện trống/lỗi/thử lại.
- Quản trị: số liệu từ dữ liệu API, tìm kiếm/lọc vai trò, hai mục tài khoản/giọng đọc, biểu mẫu thêm giọng chung và thông báo tại trang. Selector không đổi nhãn quyền/trạng thái trước khi API lưu thành công; khóa thao tác trên chính administrator và trong lúc request. Tài khoản chờ đồng bộ cần chọn lại quyền/trạng thái mong muốn.
- Router tải lazy các trang; build tách thư viện PDF khỏi trang quản trị. Cảnh báo chunk PDF lớn vẫn còn, không chặn build.
- Xem quản trị với phiên admin/dữ liệu thật. Dựng bản xem trước từ template Vue cho cả ba trang người dùng với dữ liệu minh họa, không gọi API hay đổi phiên đăng nhập. Lưu ảnh vào `keycloak/backups/text2speech-admin-users.png`, `text2speech-user-lecture.png`, `text2speech-user-book.png`, `text2speech-user-history.png`.
- Không chạy bộ test auth, không đổi quyền/trạng thái tài khoản, upload giọng hoặc chạy Gemini/Engine trong phiên giao diện này. Cập nhật README với cấu trúc thư mục mới.

---

### Phiên 13/10/2026 — Tổng hợp tiến độ sau khi hoàn thiện giao diện

- Đối chiếu cấu trúc file/router/import hiện tại, trạng thái Git và các ảnh giao diện đã lưu.
- Bổ sung sơ đồ thư mục frontend, cập nhật tính năng/trạng thái tổng quan và các thay đổi chưa commit.
- Ghi rõ phạm vi xác minh: build và xem giao diện đã hoàn tất; kiểm thử auth thuộc phiên Phase 3 trước đó, pipeline AI chưa chạy lại sau thiết kế mới.
- Ghi nhận số tài khoản thiếu mật khẩu là số liệu tại lần kiểm tra Phase 3; cần đối chiếu lại nếu người dùng đã tự đặt mật khẩu.
- Server/tab xem trước người dùng đã dừng/đóng và các script dựng giao diện tạm đã dọn; ảnh được giữ trong thư mục backup bị Git bỏ qua.
- Phiên này chỉ cập nhật PROCESS, không sửa mã nguồn hay thực hiện thao tác trên dữ liệu.

---

### Phiên 13/10/2026 — Lưu mốc GitHub trước sách nói dài

- Theo yêu cầu, chốt toàn bộ thay đổi hiện có: Phase 2–3 Keycloak local, liên kết/dọn auth cũ, theme Text2Speech, giao diện user/admin, tách thư mục Vue, dọn legacy và tài liệu.
- Fetch origin và đối chiếu trước commit: local main và origin/main cùng mốc, không lệch lịch sử.
- Rà soát các file chuẩn bị commit, cấu hình riêng/backup được Git bỏ qua; để trống GEMINI_API_KEY trong file mẫu. Không đưa database, backup, thư Mailpit hoặc secret runtime vào Git.
- Mốc dùng message `feat: complete local Keycloak auth and redesign application UI`, push thường lên origin/main.
- Chưa triển khai lựa chọn 10/20/30 phút. Hướng đã đề xuất: tóm tắt theo phần/dàn ý, ngân sách nội dung theo tốc độ đọc đo thực tế, công việc nền lưu tiến độ MongoDB, TTS và clone từng đoạn rồi ghép.

---

## 5. Việc Tiếp Theo / TODO

**Phase 2 local:**
- [x] Khởi động Docker Desktop, chạy stack healthy và đối chiếu realm/client/roles/PKCE cùng email reset trong Mailpit.
- [x] Dry-run; lưu snapshot metadata nguồn, sao chép sang database migration local và nhập 3 tài khoản thật vào Keycloak.
- [x] Đối chiếu role/status/mapping `_id` MongoDB ↔ Keycloak; chạy lại không tạo user/thư trùng.
- [x] Xác nhận dữ liệu qua restart và tạo backup PostgreSQL.

**Các lỗi bảo mật auth cũ đã khắc phục:**
- [x] Bắt buộc xác thực token và quyền admin cho 3 route quản lý user (`auth.route.js`).
- [x] Kiểm tra ownership trong `PUT/DELETE /api/voices/:id` (chỉ chủ sở hữu hoặc admin).

**Phase 3:**
- [x] Nối frontend PKCE và backend JWT/JWKS + issuer/audience/roles/status/SSO session.
- [x] Kiểm tra token thật, admin/user/disabled, giọng/lịch sử/ownership và các trường hợp lỗi đồng bộ.
- [x] Full backup MongoDB, kiểm tra phục hồi local và cập nhật mapping trên nguồn.
- [x] Bỏ auth cũ/create_admin.js/bcrypt/jsonwebtoken; dọn password/JWT_SECRET sau backup.
- [x] Tạo và áp dụng theme Text2Speech cho giao diện xác thực Keycloak local; bổ sung hướng dẫn tùy chỉnh/deploy.
- [x] Thiết kế lại trang chào đăng nhập frontend, đồng bộ nhận diện Text2Speech và hỗ trợ màn hình nhỏ.
- [x] Làm mới giao diện người dùng/quản trị, tách thư mục user/admin và cập nhật router/tài liệu.
- [ ] Đối chiếu lại tài khoản chưa có mật khẩu Keycloak; người dùng tự đặt qua Mailpit nếu còn thiếu, dùng prepare_keycloak_account_links.js nếu link hết hạn.

**Sau khi làm mới giao diện:**
- [x] Build frontend; xem trang quản trị với dữ liệu thật và bản xem trước ba trang người dùng.
- [ ] Rà soát tương tác bằng phiên user thật: tải TXT/DOCX/PDF, thêm giọng riêng, tạo âm thanh/sách nói và nghe lại lịch sử.
- [ ] Chạy lại kiểm thử auth/phân quyền và thao tác quản trị trong môi trường kiểm tra sau thay đổi frontend.
- [ ] Cân nhắc tối ưu chunk PDF lớn trước deploy.

**Phase 4:**
- [ ] Chốt môi trường deploy, container Backend/Engine, HTTPS/domain, Keycloak/PostgreSQL production và SMTP thật.
- [ ] Thử phục hồi PostgreSQL và chuyển database giữ đúng ID đã liên kết; sao lưu riêng ngoài máy phát triển.

**Mở rộng sách nói 10/20/30 phút — đã đề xuất, chưa triển khai:**
- [ ] Thêm lựa chọn thời lượng và đo tốc độ đọc để tính ngân sách kịch bản.
- [ ] Phân tích sách theo phần, lập dàn ý chung và viết kịch bản có giới hạn token.
- [ ] Công việc nền có chủ sở hữu, tiến độ, điểm lưu và retry phần lỗi.
- [ ] Tạo TTS/clone theo đoạn, ghép bằng FFmpeg và đo thời lượng kết quả.
- [ ] Rà soát giới hạn payload, phạm vi đọc PDF và tài nguyên Engine cho nội dung dài.

**Phase 5 / ưu tiên trung:**
- [x] Working tree đã xóa 5 file service rỗng, module Lecture và bỏ mount route trong backend (chưa chạy lại toàn bộ ứng dụng trong phiên Phase 2).
- [ ] Truyền gender của giọng mẫu sang Engine một cách tường minh (thay vì đoán từ tên file).

**Ưu tiên thấp (chỉnh tề):**
- [x] Đã tách CSS chung; phiên làm mới giao diện thay `common.css` bằng `frontend/src/assets/workspace.css`.
- [ ] Cân nhắc kiểm tra sâu nội dung/tỷ lệ audio upload; hiện đã giới hạn dung lượng 50 MB và lọc phần mở rộng, nhưng chưa xác minh nội dung thực của file.

---

## 6. Ghi Chú Vận Hành (cần nhớ khi chạy dự án)

- Mở **Docker Desktop** và bảo đảm stack Keycloak local chạy trước; sau đó chạy **Backend (3000) → Frontend (5173)**. Khi tạo âm thanh cần chạy thêm **Engine (8000)**.
  Hướng dẫn chi tiết trong `README.md`, `keycloak/PHASE3.md` và `engine/README.md`.
- Admin ứng dụng được quản lý qua Keycloak/AdminPanel; create_admin.js đã bỏ. Seed giọng mẫu: `node seed_voices.js`
  (lưu ý: seed xóa sạch giọng cũ rồi mới thêm 3 giọng mặc định).
- Engine lần đầu chạy phải tải weights (~260MB); cần FFmpeg trong `engine/venv/Scripts/`.
- Keycloak local: xem `keycloak/README.md`. Từ repo root chạy `docker compose --env-file keycloak/.env -f keycloak/compose.yaml --profile migration up -d --wait`; Admin Console `http://localhost:8080/admin/`, Mailpit `http://localhost:8025`. Secrets nằm trong `keycloak/.env`. Không dùng `down -v` nếu cần giữ dữ liệu.
- Runtime Phase 3: xem `keycloak/PHASE3.md`; backend đọc service account từ `backend/.env.keycloak.local`. Mở frontend http://localhost:5173 để đăng nhập realm tts-local bằng mật khẩu Keycloak.
- Theme xác thực: xem `keycloak/THEME.md`; source nằm trong `keycloak/themes/text2speech/login/`. Áp dụng vào realm local đã có bằng `node backend/scripts/configure_keycloak_theme.js`.
- Khi sửa frontend, dùng đúng đường dẫn `views/user/` và `views/admin/`; khung điều hướng nằm ở `layouts/AppShell.vue`, CSS chung ở `assets/workspace.css`. Các script xem trước tạm không thuộc luồng vận hành ứng dụng.
- Giọng đọc gốc Edge-TTS hiện được chọn trong Engine theo đường dẫn mẫu có chứa `male`: `vi-VN-NamMinhNeural`; trường hợp còn lại dùng `vi-VN-HoaiMyNeural`. TODO là thay cách suy đoán này bằng gender truyền tường minh.
- Phong cách đọc = tốc độ Edge-TTS: `news` = +12%, `story` = −8%, `normal` = mặc định.
- Bật R2 bằng cách điền `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` trong `backend/.env`; để trống các khóa thì dùng local.
