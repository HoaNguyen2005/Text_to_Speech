# PROCESS — Nhật Ký Tiến Độ Dự Án

> **Cách dùng file này:** Đọc từ đầu đến cuối để nắm toàn bộ bối cảnh và tiến độ hiện tại.
> Mỗi lần làm việc mới trên dự án, cập nhật thêm mục [4. Nhật ký làm việc](#4-nhật-ký-làm-việc)
> và [5. Việc tiếp theo](#5-việc-tiếp-theo--todo).
>
> **Cập nhật lần cuối:** 25/10/2026

---

## 1. Tổng Quan Dự Án

**Tên:** Hệ Thống Sinh Bài Giảng Tự Động (Voice Cloning TTS) — Dự án Niên luận.

**Mục tiêu:** Chuyển văn bản thành bài giảng / sách nói dạng âm thanh tiếng Việt,
kèm nhân bản âm sắc (voice cloning) từ file ghi âm mẫu, có tài khoản người dùng
và trang quản trị.

**Kiến trúc Microservices — 3 thành phần:**

```
Frontend (Vue 3 + Vite, 5173) ── đăng nhập/đăng ký ──► Keycloak (8080)
      │ axios + access token (bộ nhớ)                       │
      ▼                                                    ▼
Backend Gateway (Express 5, 3000)                    PostgreSQL: keycloak
      ├── PostgreSQL: tts_app (hồ sơ, giọng, lịch sử, job/checkpoint)
      ├── Google Gemini (tóm tắt sách)
      ├── Cloudflare R2 (âm thanh)
      └── AI Engine (FastAPI, 8000)
                └── Edge-TTS → OpenVoice V2 (clone âm sắc, hỗ trợ CUDA)

PostgreSQL local: cùng service Docker, hai database riêng; Windows 127.0.0.1:5433.
Worker sách nói chạy riêng, đọc hàng đợi tts_app và gọi Gemini/Engine/R2.
```

**Cấu trúc thư mục chính:**

| Thư mục | Vai trò |
|---|---|
| `frontend/` | SPA Vue 3 + Vue Router, đọc file .docx/.pdf client-side (mammoth + pdfjs) |
| `backend/` | Express gateway, worker sách nói, repository/schema PostgreSQL và công cụ chuyển dữ liệu |
| `keycloak/` | Keycloak + PostgreSQL + Mailpit local; realm, theme Text2Speech, công cụ/tài liệu Phase 2–3 và backup |
| `engine/` | FastAPI: pipeline TTS 2 bước; thư viện OpenVoice vendored tại `engine/openvoice/` |
| Cloudflare R2 (`samples/`, `generated/`) | Âm thanh dùng chung khi R2 được cấu hình; PostgreSQL giữ object key để Backend tạo URL truy cập mới |
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
2. **Sách Nói AI** (`/book`): upload/dán sách → chọn nhanh 10/20/30 hoặc nhập 1–59 phút và giọng tiêu chuẩn/cá nhân
   → worker phân tích từng phần, lập dàn ý, đo tốc độ giọng, viết kịch bản, tạo/ghép audio.
   Có tiến độ, hủy, thử lại từ phần lỗi và mở lại yêu cầu sau tải lại trang.
3. **Lịch Sử** (`/history`): 100 bản ghi sinh audio gần nhất của user, có tìm kiếm nội dung/giọng/phong cách.
4. **Quản Trị** (`/admin`, chỉ admin): tổng quan dữ liệu, tìm kiếm/lọc tài khoản, đổi role/status và quản lý giọng mẫu trong hai mục Tài khoản/Giọng đọc.
5. **Đăng nhập/Đăng ký** bắt buộc trước khi dùng app: Auth hiển thị khi chưa có session; biểu mẫu đăng nhập/đăng ký/đặt lại mật khẩu dùng theme Text2Speech tại Keycloak.

---

## 2. Trạng Thái Hiện Tại (20/10/2026)

- **Git:** nhánh `main`, remote `origin` là `HoaNguyen2005/Text_to_Speech`. Mốc Phase 2–3 và giao diện đã push: `9f5791c` (`feat: complete local Keycloak auth and redesign application UI`). Thay đổi sách nói 10/20/30 phút và chuyển PostgreSQL đang ở working tree, chưa commit/push. Commit trước mốc là `8bcf244`, trước đó là `ea6f282` (R2).
- **Luồng end-to-end đã hoạt động ở các phiên trước:** đăng nhập → tạo bài giảng → clone giọng → nghe kết quả → lịch sử. Sau lần làm mới giao diện chưa chạy lại pipeline AI/Gemini.
- **Sách nói 10/20/30 phút đã triển khai mã:** hàng đợi PostgreSQL + worker riêng, tóm tắt nhiều tầng, JSON output có kiểm tra token/finish reason, kịch bản theo tốc độ đo thực tế, audio từng đoạn/FFmpeg. API tóm tắt ngắn cũ vẫn còn để tương thích. Hướng dẫn tại `BOOK_AUDIO.md`. Chưa tạo/nghe sách thật 10/20/30 phút trong phiên này.
- **Đã chuyển dữ liệu ứng dụng sang PostgreSQL local:** database `tts_app`, role riêng không có quyền superuser/tạo database; tách khỏi database `keycloak`. Đã nhập và đối chiếu nội dung 3 user (1 admin, đủ 3 mapping Keycloak), 3 voice, 1 worker lease; nguồn hiện có 0 lịch sử, 0 job, 0 cache. MongoDB nguồn được giữ nguyên; runtime không dùng Mongoose. Backend đã kết nối PostgreSQL, health `ok`; worker đang giữ lease hoạt động. Xem `POSTGRES_MIGRATION.md`.
- **Engine** tự tải weights OpenVoice V2 (~260MB) từ HuggingFace lần chạy đầu;
  FFmpeg phải nằm trong `engine/venv/Scripts/`.
- `.env` được gitignore. Không ghi giá trị secret vào tài liệu. Phiên hoàn thiện Phase 2 đã đọc 3 tài khoản từ MongoDB Atlas và sao chép metadata sang MongoDB migration local; không sửa database ứng dụng. Không kiểm tra lại dữ liệu R2 trong phiên này.
- **Phase 3 đã hoàn thành local:** frontend/backend dùng Keycloak realm `tts-local`; 3 tài khoản (1 admin) giữ `_id` và mapping sau chuyển sang PostgreSQL. Đã dọn 3 hash bcrypt và JWT_SECRET cũ sau backup. Tại lần đối chiếu hoàn thiện Phase 3 có 1 tài khoản đã đặt mật khẩu, 2 tài khoản thiếu được gửi link mới vào Mailpit; số tài khoản đã đặt mật khẩu chưa được thống kê lại sau đó. Backend/frontend dùng cổng 3000/5173; Engine cần chạy thêm khi tạo audio.
- **Theme Text2Speech đã áp dụng:** giao diện xác thực của `tts-local` đồng bộ nền sáng/khung trắng/nút đen với website, mặc định tiếng Việt và có lựa chọn English. Hướng dẫn tại `keycloak/THEME.md`.
- **Giao diện người dùng/quản trị đã làm mới:** điều hướng chung tại `layouts/AppShell.vue`; các trang nằm trong `views/user/` và `views/admin/`. CSS chung hiện tại là `assets/workspace.css`.
- **Kết quả xác minh giao diện gần nhất:** frontend build thành công; trang quản trị hiển thị dữ liệu thật (3 tài khoản, 1 admin, 3 giọng đang dùng). Đã xem trước cả ba trang người dùng từ template Vue với dữ liệu minh họa. 11 nhóm test auth là kết quả phiên hoàn thiện Phase 3, chưa chạy lại sau thay đổi giao diện. Còn cảnh báo chunk PDF khoảng 820 KB.
- **Phạm vi phiên chuyển PostgreSQL:** đã đối chiếu số lượng/digest từng bảng trong transaction, sao lưu nguồn và đích, khởi động Backend/worker. Không thêm/chạy bộ test; chưa chạy lại đăng nhập/đăng ký, thao tác admin hay pipeline Gemini/TTS trên PostgreSQL. Bộ test auth MongoDB cũ bị chặn khi có cấu hình PostgreSQL; cần chuyển sang database PostgreSQL cô lập khi có yêu cầu kiểm thử.
- **Sửa thêm giọng mẫu ngày 19/10:** mã `male` trong ảnh upload trùng giọng mặc định; PostgreSQL hiện vẫn có 3 giọng active/global. Backend chặn mã trùng trước upload và xử lý dọn file mới nếu lưu DB thất bại; frontend báo lỗi ngay trong form. Đã build frontend/rà cú pháp Node, chưa thực hiện upload thật sau sửa; cần khởi động lại Backend để áp dụng.
- **Cập nhật tiếp ngày 19/10:** đã sửa lỗi gọi `pdf.destroy()` sai API PDF.js 6; thêm ô nhập thời lượng 1–59 phút, vẫn giữ các nút 10/20/30. API, worker và PostgreSQL kiểm tra giới hạn; worker chặn file kết quả đạt 1 giờ. Migration 002 đã áp dụng sau backup. Trạng thái DB mới nhất: 3 user (1 admin), 4 voice, 2 job, 1 cache, 0 lịch sử, 0 reading profile, 2 lease; worker đang có heartbeat. Chưa chạy sách thật để kiểm chứng thời lượng tùy chọn, cần restart Backend/worker để áp dụng mã mới.
- **Chọn giọng thủ công:** đã thêm danh sách Nam Minh/Hoài My và các mẫu clone được phép dùng; bắt buộc người dùng chọn, Gemini chỉ xử lý dàn ý/kịch bản/nhịp đọc. Migration 003 đã áp dụng; 5/5 job hiện có giữ giọng từ checkpoint. Backend/worker đã khởi động lại với mã mới; chưa kiểm thử tạo job/audio hoặc auth mới sau thay đổi này.

### Lộ trình triển khai

| Phase | Trạng thái | Ghi chú |
|---|---|---|
| 1. Tách lưu trữ ra R2 | **Hoàn thành** | 3/3 giọng mẫu tham chiếu key R2; 17 audio kết quả local đã upload. Object key hiện lưu trong PostgreSQL, API trả presigned URL mới. 7 bản ghi lịch sử thiếu audio đã được xóa theo yêu cầu ở phiên R2. |
| 2. Dựng Keycloak | **Hoàn thành local** | Stack healthy, realm/client/roles/PKCE; đã nhập 3 tài khoản, có volume và backup. |
| 3. Cắt auth cũ | **Hoàn thành local** | Vue keycloak-js + PKCE, Express jose/JWKS + kiểm tra role/status/SSO session; mapping nguồn và AdminPanel đồng bộ. 11 nhóm test API và kiểm tra UI đã đạt; bỏ auth cũ/create_admin.js. |
| Bổ sung: chuyển database ứng dụng | **Đã chuyển local** | PostgreSQL `tts_app`; giữ ID/mapping/R2, nhập nguồn thật và backup. Chưa chạy lại bộ test auth và pipeline audio sau chuyển. |
| 4. Dockerize + deploy | **1a–1c hoàn thành local** | Đã build và bật Frontend/Backend/worker/Engine cùng PostgreSQL/Keycloak/Mailpit, 7 service healthy. Chưa kiểm thử toàn luồng trong Docker; tiếp theo chọn hạ tầng deploy ở mục 2. Xem PHASE4.md. |
| 5. Dọn dẹp | Đã làm một phần | Đã bỏ module Lecture/service rỗng, dùng CSS chung và tách trang Vue theo user/admin; Backend/worker truyền gender tường minh sang Engine. |

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
| `8bcf244` | Thêm nút hiện/ẩn mật khẩu trong Auth.vue |
| `9f5791c` | Hoàn thiện Keycloak local và thiết kế lại giao diện người dùng/quản trị |

Mốc Phase 2–3/giao diện ngày 13/10 là `9f5791c`;
sách nói dài và chuyển PostgreSQL chưa được commit/push ở phiên 17/10.

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

### Phiên 13/10/2026 — Triển khai sách nói khoảng 10/20/30 phút

- Trang user BookSummarizer có lựa chọn thời lượng, giọng tiêu chuẩn/cá nhân, nhập/dán/chỉnh nội dung, danh sách yêu cầu, tiến độ, hủy và retry. Đọc hết PDF trong giới hạn 1.000 trang/1 triệu ký tự, không còn tự cắt 50 trang. Đóng gói PDF worker cùng frontend.
- `POST/GET /api/book-jobs`, chi tiết/hủy/retry dùng Keycloak và ownership. Chặn yêu cầu không hợp lệ, giới hạn 3 job đang chờ/chạy mỗi chủ sở hữu, khóa admission theo user để hai tab không vượt giới hạn; mã yêu cầu chống gửi trùng. Payload Express tăng lên 8 MB, lỗi JSON/dung lượng trả thông báo JSON.
- Worker `backend/workers/book.worker.js` chạy riêng, lease MongoDB 90 giây/gia hạn 10 giây, chỉ một worker giữ hàng đợi. Lưu ghi chú, gộp nhiều tầng, dàn ý, kịch bản, âm thanh từng phần; tiếp tục khi restart/retry. Không lưu token người dùng; kiểm tra account/Keycloak và quyền giọng khi chạy.
- Gemini phân tích phần nguồn khoảng 6.000 ký tự, JSON schema và kiểm tra token/finish reason. Dàn ý gắn chỉ số nguồn, ngân sách từng mục, viết lại tối đa một lần khi lệch độ dài; lỗi tạm thời retry hữu hạn. Cache phân tích theo user/hash nguồn 7 ngày, cache tốc độ giọng 30 ngày.
- Engine `/book/*` chỉ nhận khóa nội bộ, kiểm tra ID và giới hạn đường dẫn. TTS/clone từng đoạn tối đa 1.200 ký tự, giữ cùng voice/style và vector âm sắc nguồn; cache giọng mẫu theo hash nội dung. Dùng lock chung với bài giảng để tránh OpenVoice chạy đồng thời. Bỏ nối MP3 nhị phân, ghép FFmpeg; normalize PCM 24 kHz mono, xuất MP3 128 kbps, đo thời lượng FFprobe.
- Backend/worker truyền gender từ metadata giọng, không đoán theo tên file trong luồng mới. Engine mặc định chỉ nghe loopback. Upload R2 bằng stream, lưu checkpoint đoạn, phục hồi đoạn từ R2 nếu mất local. Lịch sử unique `book_job_id`, có tiêu đề, mục tiêu và thời lượng thực tế. Dọn file tạm/đoạn R2 sau completed/cancelled; job lỗi giữ để retry.
- Tạo khóa local riêng bằng `npm run books:init`, file `.env.books.local` và `backend/data/` bị Git bỏ qua. Người dùng đã báo cấu hình Gemini; đọc lại chỉ xác nhận key không còn là mẫu, không hiển thị giá trị hoặc xác nhận hiệu lực với Google.
- Build frontend thành công, Node syntax và Python compilation thành công, kiểm tra whitespace Git và ignore file riêng. Cảnh báo chunk PDF ~820 KB vẫn còn; worker PDF là asset riêng ~1,27 MB. Không thêm/chạy bộ test, không gọi Gemini/TTS cho sách thật trong phiên triển khai này; cần xác minh chất lượng/nghe/thời lượng và các tình huống lỗi trong phiên kiểm thử được yêu cầu.
- Đã khởi động Frontend (5173), Backend (3000), worker và Engine (8000). Backend/worker lỗi DNS Atlas trong sandbox, chạy ngoài sandbox đã kết nối được. Engine trong sandbox nạp model nhưng chưa mở API; khởi động ngoài sandbox đã báo Uvicorn ready trên loopback. OpenVoice chạy bằng CPU, FFmpeg/FFprobe có sẵn. Đây là xác nhận khởi động dịch vụ, không phải kiểm thử pipeline sách thật.
- Thêm `BOOK_AUDIO.md`, cập nhật README/Engine README/env mẫu, lệnh `books:init` và `worker:books`. Sau tắt máy cần bật cả worker cùng Backend/Engine/Frontend.

---

### Phiên 13/10/2026 — Diễn đạt riêng và ghi nguồn cho sách nói

- Theo yêu cầu chỉ triển khai ý 2 (tóm tắt bằng cách diễn đạt riêng) và ý 4 (ghi nguồn). Prompt ở các bước phân tích/gộp ý/dàn ý/kịch bản và route tóm tắt ngắn dùng cùng hướng dẫn: tổng hợp luận điểm/chủ đề bằng cấu trúc riêng, tránh chép đoạn văn/lời thoại/thơ/ca từ, không tái hiện từng cảnh hoặc toàn bộ tình tiết chi tiết, không thêm nội dung để đủ phút. Khi thiếu ý, kịch bản phải báo thiếu nguồn.
- Thêm tên sách/tài liệu (bắt buộc ở form mới), tác giả và nguồn (tùy chọn, không suy đoán). Backend kiểm tra kiểu/độ dài, lưu `book_metadata` và `ai_assisted` vào job/kết quả/lịch sử. Component `BookAttribution.vue` dùng chung cho trang sách và lịch sử, hiển thị nhãn “Bản tóm tắt do AI hỗ trợ”; trường thiếu ghi “Chưa cung cấp”. Tìm kiếm lịch sử thêm tác giả/nguồn.
- Phần giới thiệu nguồn được Backend tạo từ metadata, nối vào kịch bản và đầu audio; trừ độ dài giới thiệu khỏi ngân sách kịch bản. Không đọc đường dẫn nguồn dài trong audio. Thay tài liệu trên form xóa thông tin của file trước để tránh gán nhầm nguồn.
- Sửa projection của API lịch sử vốn chỉ trả trường legacy, bổ sung tiêu đề, job ID, thời lượng, loại giọng, metadata và nhãn AI. Không sửa ngược các audio/lịch sử đã hoàn thành hoặc đoán tác giả của bản cũ.
- Tăng phiên bản pipeline thành `book-v2-paraphrase-attribution` để không dùng cache/kịch bản từ prompt cũ. Job đã có checkpoint v1 cần gửi yêu cầu mới; job chưa chạy áp dụng hướng dẫn mới.
- Build frontend và Node syntax thành công. Không thêm/chạy test, không gọi Gemini/TTS tạo sách trong phiên này; chất lượng diễn đạt và lời mở đầu audio cần đánh giá ở phiên kiểm thử được yêu cầu. Các biện pháp này không tự kiểm tra độ trùng, không xác minh quyền sử dụng và không chứng nhận kết quả hợp pháp.
- Cập nhật README và BOOK_AUDIO với hướng dẫn nhập nguồn, hành vi bản ghi cũ và phạm vi thay đổi.
- Đã khởi động lại Backend (3000) và worker với mã mới; cả hai đã kết nối MongoDB. Frontend đang chạy nhận thay đổi qua Vite; Engine dùng API từng đoạn hiện có, không cần thay đổi trong phiên này.

---

### Phiên 17/10/2026 — Chuyển ứng dụng từ MongoDB sang PostgreSQL

- Thêm driver `pg`, schema cột định kiểu/khóa ngoại/UNIQUE/CHECK và repository SQL cho hồ sơ, giọng, lịch sử, job, cache, tốc độ đọc và lease. Backend/worker/seed chuyển sang PostgreSQL; Mongoose chỉ còn trong công cụ nguồn/lịch sử.
- Giữ nguyên ID 24 ký tự, `keycloakId`, ownership và key R2. Thuộc tính/claim `mongoUserId` giữ tên legacy, nay trỏ tới ID PostgreSQL; không đổi mật khẩu hoặc database Keycloak.
- Mở PostgreSQL ra Windows tại `127.0.0.1:5433`; tạo database và role `tts_app` riêng, không superuser/không tạo database. Cấu hình nằm trong `backend/.env.postgres.local`, bị Git bỏ qua.
- Chuyển claim job sang transaction/row lock `FOR UPDATE SKIP LOCKED`; upsert lease có advisory lock. Worker dọn cache hết hạn mỗi phút thay TTL MongoDB. Backend/worker yêu cầu marker nhập dữ liệu trước khi khởi động.
- Atlas ban đầu từ chối TLS; sau khi người dùng mở Network Access, đã đọc lại trực tiếp nguồn. Tạo full EJSON backup mới, đọc lại xác nhận digest; nhập một transaction theo khóa ngoại, đối chiếu số lượng và digest từng bảng, đọc lại nguồn trước COMMIT. Không ghi/xóa MongoDB.
- Kết quả nguồn/đích: **3 users, 3 voices, 1 worker lease; 0 generatedlectures, 0 bookjobs, 0 bookcaches, 0 readingprofiles, 0 lectures**. Không có document ngoài mapping cần lưu legacy. Cả 3 user có `keycloakId`, 1 admin, 0 `authSyncPending`.
- Digest nguồn: `8986f11cb389dece5499f011920ac916f484a267df1316b3362fa6eccc1863da`. Marker `mongodb-cutover-v1` hoàn tất ngày 17/10/2026.
- Backup nguồn: `keycloak/backups/app-mongodb-before-postgres-1792242835363.json`; backup đích custom pg_dump: `keycloak/backups/app-postgres-1792242848210.dump`. Các file private bị Git bỏ qua. Chưa thực hiện phục hồi thử bản PostgreSQL này.
- Docker PostgreSQL/Keycloak/Mailpit đã khởi động. Backend cổng 3000 báo kết nối PostgreSQL, `/api/health` trả `ok`; worker sách nói khởi động và có lease hoạt động. Frontend/Engine chưa được khởi động hoặc xác minh lại trong phiên chuyển này.
- Node syntax và diff whitespace đã rà soát; không thêm/chạy test, không tạo tài khoản giả, không gọi Gemini/TTS. Các kết quả test Phase 3 trước đây là trên MongoDB. Khóa công cụ ghi MongoDB/bộ test auth cũ khi có cấu hình PostgreSQL để tránh thao tác nhầm.
- Thêm `npm run db:status` để đọc số lượng/mapping/lease mà không in email hoặc secret; cập nhật README, BOOK_AUDIO, PHASE3 và tài liệu mới `POSTGRES_MIGRATION.md`.

---

### Phiên 19/10/2026 — Sửa giọng upload lên R2 nhưng không hiện trên web

- Đọc PostgreSQL thật: có đúng `female`, `male`, `male_ThanhHoa`, đều active/global. File mới trong ảnh có prefix `male.<UUID>.mp3`, trùng `voice_id=male` đã có. Giao diện lấy bản ghi `voices`, không quét danh sách object R2.
- Phát hiện controller upload file trước khi INSERT; UNIQUE từ chối mã giọng trùng nhưng file đã upload bị bỏ lại. Không sửa bản ghi hiện có hoặc tự gán file mới vào giọng cũ.
- Kiểm tra/chuẩn hóa mã, tên, giới tính và định dạng trước upload; kiểm tra mã trùng bao gồm giọng đã ẩn, trả 409 rõ ràng. UNIQUE vẫn xử lý trường hợp hai request cùng mã.
- Khi lưu thất bại, tra lại `file_path` trước khi dọn file của chính request; nếu DB đã lưu hoặc không xác định được trạng thái thì giữ file. Hàm xóa mẫu R2 chỉ nhận key mới có UUID; không tác động các object cũ. Lỗi dọn được ghi log để xử lý sau.
- AdminPanel có lỗi ngay trong form, chặn mã đã thấy trước upload và xóa bộ lọc tìm kiếm sau khi thêm thành công. Form giọng riêng cũng chặn mã trùng đã tải và chuẩn hóa đầu vào.
- Frontend build thành công (còn cảnh báo chunk PDF lớn), Node syntax đạt. Không thêm/chạy test, không upload hoặc xóa object R2 thật. Cần restart Backend và thêm lại bằng mã mới, ví dụ `male_hn_2`.

---

### Phiên 19/10/2026 — Làm rõ lỗi đọc tài liệu sách nói

- Người dùng báo chọn được file nhưng nội dung không xuất hiện. Chưa có file nguồn, định dạng hoặc thông báo lỗi để kết luận nguyên nhân đọc file.
- Rà soát `BookSummarizer.vue`: file được đọc tại trình duyệt bằng File API/Mammoth/PDF.js; chỉ gửi văn bản tới Backend khi bấm tạo sách nói. Giới hạn hiện tại 30 MB, 1 triệu ký tự, PDF 1.000 trang; cần ít nhất 500 ký tự văn bản, PDF scan cần OCR bên ngoài.
- Phát hiện thông báo đọc file nằm dưới toàn bộ panel/textarea, dễ bị khuất. Tách lỗi/tiến độ đọc file và đưa ngay dưới nút chọn tài liệu; hiển thị tên file, số ký tự và vị trí nội dung sau khi đọc thành công. PDF có mật khẩu/hỏng có thông báo cụ thể; đọc lỗi giữ nội dung trước đó.
- Frontend build thành công; không thêm/chạy test hoặc đọc thử sách thật. Đang chờ người dùng cung cấp file/đuôi file và lỗi mới hiển thị để xử lý nguyên nhân cụ thể; chưa ghi nhận sự cố đã được khắc phục hoàn toàn.

---

### Phiên 19/10/2026 — Sửa lỗi `pdf.destroy is not a function`

- Người dùng cung cấp lỗi cụ thể khi chọn `Van_ban_mau.pdf`: `pdf.destroy is not a function`. Đối chiếu source/type của `pdfjs-dist` 6.3.289 đang cài: `destroy()` thuộc `PDFDocumentLoadingTask`, không thuộc `PDFDocumentProxy` nhận được từ `.promise`.
- Sửa BookSummarizer giữ `loadingTask`, chờ tài liệu và đọc trang trong `try`, gọi `loadingTask.destroy()` trong `finally` kể cả khi tải thất bại. Lỗi dọn tài nguyên chỉ ghi log, không làm mất nội dung đã trích xuất hoặc che lỗi đọc gốc.
- Đây là lỗi gọi API ở bước dọn tài nguyên; chưa có bằng chứng file người dùng bị hỏng hoặc cần OCR. Chưa nhận file PDF thật; không thêm/chạy test. Frontend đã build thành công sau sửa; người dùng tải lại web và chọn lại file để tiếp tục.

---

### Phiên 19/10/2026 — Thời lượng sách nói tùy chọn dưới 1 giờ

- Thêm ô số phút 1–59 cạnh ba mốc chọn nhanh 10/20/30, dùng chung `targetMinutes`. Kiểm tra số nguyên/phạm vi và chặn gửi khi trống/sai; tiêu đề/nút tạo phản ánh giá trị đã nhập.
- Backend xác thực kiểu số nguyên 1–59, worker kiểm tra lại; ngân sách kịch bản và tốc độ đọc sử dụng thời lượng tùy chọn. Dàn ý có ngân sách token theo số mục (tối đa 12.000), giới hạn ngữ cảnh dàn ý khi viết từng mục để hỗ trợ mục tiêu dài hơn 30 phút.
- Worker kiểm tra tổng thời lượng đoạn trước ghép và file ghép trước upload/lưu lịch sử. Nếu đạt 3.600 giây, báo tạo yêu cầu mới ngắn hơn; không cắt, tăng tốc hoặc xuất bản file vượt giới hạn. Với thời lượng ngắn, kiểm tra ngân sách sau trừ giới thiệu nguồn để không gửi ngân sách âm/quá nhỏ cho AI.
- Tạo migration `002-book-custom-duration.sql`, giữ nguyên digest/schema 001 và dữ liệu cũ. Driver hỗ trợ danh sách migration có digest, transaction/advisory lock, yêu cầu schema mới nhất khi khởi động.
- Đã tạo backup `keycloak/backups/app-postgres-1792384405394.dump`, áp dụng migration thành công và đọc trạng thái DB sau cập nhật: 3 user, 4 voice, 2 job, 1 cache, 0 lịch sử, 2 lease; 3 mapping Keycloak, 1 admin, 0 pending. Worker đang hoạt động; không ngắt tiến trình đang chạy của người dùng.
- Frontend build và cú pháp Node đạt. Không thêm/chạy test hoặc gọi Gemini/TTS tạo sách trong phiên này. Cần restart Backend/worker và tải lại frontend để áp dụng; chưa xác nhận chất lượng/thời lượng thực tế ở các mốc 1, 45 hoặc 59 phút. Cập nhật README, BOOK_AUDIO và POSTGRES_MIGRATION.

---

### Phiên 19/10/2026 — Khắc phục Edge-TTS từ chối kết nối HTTP 403

- Job `2b850e6aeb30c55afca951e9` (2 phút, clone) dừng ở calibration 28%; đã phân tích/dàn ý, chọn `male_podcast`, chưa có rate hoặc đoạn sách. File mẫu đã tải/chuẩn hóa thành WAV; FFmpeg/FFprobe và weights OpenVoice hiện có.
- Log người dùng cung cấp chỉ rõ `aiohttp.WSServerHandshakeError: 403` từ WebSocket Edge-TTS; lỗi xảy ra ở giọng gốc trước OpenVoice. Môi trường `engine/venv` dùng edge-tts 7.2.8. Đối chiếu issue chính thức #490: tác giả xác nhận sửa từ 7.3.0; PyPI có 7.3.1.
- Đã cài thành công **edge-tts 7.3.1** vào đúng venv; các dependency còn lại được giữ. Ghim phiên bản trong `engine/requirements.txt`. Không chỉnh tay giao thức hoặc bỏ kiểm tra TLS.
- Thêm phân loại lỗi 403 trong base TTS; Engine trả thông báo cụ thể và đánh dấu không retry tự động; worker đọc detail có cấu trúc nhưng vẫn tương thích detail chuỗi cũ. Che URL trong stderr Edge-TTS trước khi ghi log. Giữ checkpoint và cơ chế tiếp tục job cũ, không tự chuyển giọng trong sách nói.
- Không thêm/chạy test, không gọi tạo âm thanh hoặc Gemini để xác nhận pipeline sau nâng phiên bản. Cần restart Engine/worker rồi tiếp tục job; việc cài đặt thành công chưa xác nhận đầu ra âm thanh.
- Nguồn: https://github.com/rany2/edge-tts/issues/490 và https://pypi.org/project/edge-tts/7.3.1/. Cập nhật tài liệu Engine và chẩn đoán BOOK_AUDIO.

---

### Phiên 19/10/2026 — Rút ngắn đường dẫn đoạn OpenVoice trên Windows

- Log người dùng xác nhận Edge-TTS đã tạo giọng gốc sau nâng 7.3.1. Silero VAD đã tải, phát hiện đoạn nói và tổng thời lượng 23,26 giây; bước trích xuất giọng mẫu sau đó gặp `FileNotFoundError`.
- Kiểm tra cây thư mục job: thư mục `embeddings/.../wavs` đã tạo nhưng chưa có đoạn WAV. Mã OpenVoice lặp tên nguồn dài ở cả thư mục và filename; tính đường dẫn `..._seg0.wav` theo dữ liệu thật được **295 ký tự**, phù hợp lỗi giới hạn đường dẫn Windows. Log cũ chưa có filename/traceback đầy đủ nên chưa xác nhận bằng một lần clone thành công.
- Sửa `openvoice/se_extractor.py`: thư mục embedding dùng phiên bản + hash nội dung, tên đoạn `seg_0000.wav` cho cả VAD và Whisper. Giữ phân biệt theo nội dung/phiên bản, không thay file nguồn, key R2 hoặc checkpoint PostgreSQL. Không xóa thư mục cũ.
- Engine phân loại `FileNotFoundError`, ghi filename/winerror vào terminal, trả thông báo cụ thể và không retry tự động lỗi này; giữ checkpoint để tiếp tục sau restart Engine.
- Rà cú pháp Python; không thêm/chạy test hoặc tạo âm thanh trong phiên này. Cần người dùng restart Engine rồi tiếp tục job; nếu vẫn lỗi, dùng filename mới được ghi log để xử lý tiếp.

---

### Phiên 19/10/2026 — Áp dụng bản sửa vào Engine đang chạy

- Người dùng vẫn nhận `FileNotFoundError` với log định dạng cũ. Đối chiếu tiến trình thật: Engine PID 1660 khởi động 11:55:08, trong khi `book_audio.py` và `se_extractor.py` sửa lúc 12:57:45; tiến trình chưa nạp bản sửa.
- Checkpoint job 2 phút có 1 ghi chú/dàn ý và giọng `male_podcast`, nguồn 1.890 ký tự; dừng calibration 28%, chưa có rate/script/đoạn âm thanh. Log cho biết mẫu đo 536 ký tự. Dữ kiện hiện tại xác định lỗi ở Engine/OpenVoice; chưa có bằng chứng lỗi Gemini hoặc vượt giới hạn nguồn.
- Đã kiểm tra listener 8000 là Python `main.py`, dừng đúng tiến trình cũ và khởi động bằng `engine/venv/Scripts/python.exe -u main.py` tại thư mục Engine. Tiến trình mới PID 18424 nạp weights OpenVoice thành công, missing/unexpected keys rỗng, Uvicorn sẵn sàng tại 127.0.0.1:8000; phiên công cụ 82813 giữ Engine chạy.
- Không tự sửa trạng thái job, xóa checkpoint hoặc gọi tạo âm thanh. Người dùng bấm Tiếp tục từ phần lỗi để chạy lại trên Engine mới; chưa xác nhận đầu ra clone sau lần restart này.

---

### Phiên 19/10/2026 — Sửa kiểm tra ngân sách kịch bản quá cứng

- Job `686e9194a2058b0c9107465f` (Van_ban_mau_2, 2 phút) dừng ở viết kịch bản 30%; nguồn 12.778 ký tự/2.802 đơn vị khoảng trắng, tốc độ giọng đã đo 202,03 đơn vị/phút. Mục tiêu toàn bài 404 đơn vị, giới thiệu 43, chia 2 mục khoảng 181 mỗi mục. Job 5 phút tương tự cũng lỗi ở viết, chứng tỏ đã qua bước TTS mẫu/OpenVoice.
- Lỗi cũ xuất hiện khi Gemini trả JSON hoàn chỉnh nhưng cả hai bản đều ngoài ±20% mỗi mục; mã không lưu bản nháp hoặc độ dài thực tế trước khi báo lỗi. Không đủ dữ liệu kết luận hai bản đó dài hơn hay ngắn hơn vì đã bị bỏ trong mã cũ.
- Sửa prompt đưa khoảng min/max cụ thể, ví dụ cách đếm tiếng Việt, chỉnh trực tiếp bản nháp có số đếm thay vì viết lại độc lập. Tối đa 3 lượt mỗi lần xử lý mục; giữ bản gần mục tiêu nhất và metrics trong `checkpoint.scriptDrafts`, log số đếm thay vì nội dung nguồn/secret. Giữ nguyên các ghi chú nguồn khi chỉnh sửa.
- Worker phân bổ ngân sách còn lại dựa trên các mục đã viết; chấp nhận lệch từng mục trong giới hạn có kiểm soát và kiểm tra tổng kịch bản ±35% trước TTS. Nếu tổng lệch lớn, chỉnh mục cuối một lượt có giới hạn, giữ nháp khi chưa đạt và báo số giây ước tính. Các lỗi thiếu nguồn/JSON bị cắt/API vẫn dừng; không cắt câu hoặc bịa để đủ thời lượng. Cảnh báo lệch thực tế 15% và trần 3.600 giây được giữ.
- Đã khởi động lại đúng tiến trình `workers/book.worker.js`; phiên công cụ mới 72257 báo sẵn sàng. Dữ liệu job/checkpoint cũ được giữ; không tạo job thử hoặc chủ động gọi Gemini/TTS để kiểm thử. Cần tiếp tục job thật trên web để đánh giá kết quả sau thay đổi.
- Node syntax và diff whitespace đạt; không thêm/chạy bộ test. Cập nhật BOOK_AUDIO mô tả cơ chế sửa độ dài và chẩn đoán.

---

### Phiên 19/10/2026 — Cho người dùng chủ động chọn giọng sách nói

- Thêm dropdown giọng cụ thể theo loại tiêu chuẩn/clone, không mặc định tự chọn một giọng. Có tải lại danh sách, hiển thị giới tính/phạm vi, chặn gửi khi chưa chọn; giọng tham gia chữ ký request để đổi giọng tạo request ID mới. Hiển thị giọng sử dụng trên job.
- Thêm service kiểm tra giọng và endpoint `GET /api/book-jobs/voices`; Backend resolve `voice_id` thành snapshot từ dữ liệu tin cậy, kiểm tra active/ownership/global/admin trước lưu. API không nhận đường dẫn mẫu do client cung cấp.
- Migration `003-book-selected-voice.sql` thêm `selected_voice` JSONB và CHECK; sao chép giọng đã có từ checkpoint cho job cũ, không chọn giọng mới. Đã backup `keycloak/backups/app-postgres-1792399101037.dump`, áp dụng thành công; đọc lại schema đủ 001/002/003 và 5/5 job có snapshot.
- Worker dùng snapshot cố định, kiểm tra lại mẫu/quyền trong quá trình chạy; retry giữ giọng, muốn đổi cần job mới. Job cũ chưa từng có giọng dừng với hướng dẫn chọn ở job mới. Không tự thay giọng hoặc xóa job/đoạn cũ.
- Bỏ `voice_id` khỏi schema/prompt dàn ý Gemini và danh sách giọng đầu vào; Gemini chỉ chọn nhịp/style, thể loại, lý do nhịp đọc. API tóm tắt ngắn cũ cũng yêu cầu chọn giọng và dùng cùng resolver; bỏ fallback chọn mẫu đầu tiên.
- Frontend build, Node syntax và diff whitespace đạt. Không thêm/chạy test, không tạo job giả hoặc chủ động gọi Gemini/TTS. Các luồng quyền/selection cần kiểm thử thực tế khi có yêu cầu.
- Backend đã restart (phiên công cụ 54662) kết nối PostgreSQL tại 3000; worker mới (71473) báo sẵn sàng. Engine đang dùng bản sửa trước đó; không cần đổi Engine cho tính năng chọn giọng. Cập nhật README, BOOK_AUDIO, POSTGRES_MIGRATION.

---

### Phiên 19/10/2026 — Giảm lượt xử lý sách nói và kiểm tra dấu tiếng Việt

- Đọc dữ liệu job thật: bản 10 phút giọng clone hoàn thành, file dài khoảng 498 giây. Khoảng từ tạo đến cập nhật cuối là 28 phút 15 giây, chưa tách thời gian chờ/retry/dọn file. Log có 22 lần sinh/chỉnh cho 8 mục; không dùng số này làm benchmark sau sửa.
- Checkpoint và kết quả có các mục 3–6 gần như không dấu ngay trong văn bản lưu. Lỗi nằm ở nội dung AI, không phải font/trình duyệt. Prompt trước chưa bắt buộc dấu, chưa có bộ kiểm tra đầu ra.
- Bổ sung yêu cầu đầy đủ dấu; chuẩn hóa NFC và phát hiện đoạn dài thiếu dấu bằng cửa sổ văn bản/từ Việt. Gemini phục hồi dấu khi cần; đối chiếu chuỗi từ sau bỏ dấu để tránh thêm/bớt nội dung. Không khôi phục an toàn thì dừng trước TTS. Áp dụng cả script checkpoint khi retry; hash văn bản tránh dùng lại audio sai, bỏ chỉ mục đoạn dư khi kịch bản mới chia ít đoạn hơn. Bộ kiểm tra theo quy tắc vẫn cần người dùng rà soát.
- Phân tích tối đa 2 phần nguồn cùng lúc, lưu đúng thứ tự và giữ kết quả thành công khi phần khác lỗi. Có cấu hình hạ xuống 1 nếu quota thấp. Giảm tối đa 3 xuống 2 lượt sinh/chỉnh mỗi mục, khoảng chấp nhận mỗi mục ±25%, giữ đối chiếu toàn kịch bản và ràng buộc nguồn/thời lượng. Không đếm lại token cho cùng prompt khi retry mạng.
- Thêm log thời gian Gemini/worker/Edge-TTS/embedding/OpenVoice và `result.processing_times` cho job mới. Số đo là tổng thời gian lời gọi từng bước, có thể chồng lấp khi phân tích song song. Máy hiện PyTorch chạy CPU, 16 luồng, CUDA không khả dụng. Chưa thay mặc định luồng; có tùy chọn `TTS_CPU_THREADS` để tinh chỉnh có đo đạc sau này.
- Giao diện giải thích giọng tiêu chuẩn xuất nhanh vì bỏ qua clone, giọng mẫu trên CPU có thể xử lý lâu hơn thời lượng âm thanh. Giữ quyền chọn giọng; không tự đổi giọng hoặc ghi đè sách hoàn thành.
- Node/Python syntax và frontend build đạt; chưa chạy thử Gemini/TTS/benchmark sau thay đổi. Cần tạo sách mới và nghe/đối chiếu để xác nhận mức cải thiện cùng chất lượng dấu thực tế. Bản cũ không tự sửa văn bản riêng vì sẽ không khớp âm thanh cũ.
- Xác nhận trước khi reload: hàng đợi có 2 completed, 2 failed, 2 cancelled, không có queued/processing. Engine mới đã sẵn sàng tại 8000 (phiên 26987, CPU 16 luồng); worker mới sẵn sàng và kết nối PostgreSQL (94846). Backend giữ nguyên phiên đang chạy; không tự retry/tạo job hoặc gọi Gemini/TTS cho người dùng.

---

### Phiên 19/10/2026 — AI viết đầy đủ dấu trực tiếp theo yêu cầu người dùng

- Thay cơ chế phục hồi dấu ở phiên ngay trước: bỏ hàm `ensureVietnamese`, schema/API phục hồi riêng và đối chiếu chuỗi bỏ dấu.
- Prompt dùng chung ở bước phân tích, gộp, dàn ý và viết yêu cầu tiếng Việt đầy đủ dấu ở mọi câu/đoạn từ đầu đến cuối, kể cả nguồn/ghi chú/bản nháp không dấu; giữ tên riêng nước ngoài và tự rà soát trước khi trả JSON.
- Chỉ giữ bản nháp đạt kiểm tra dấu. Kết quả thiếu dấu bị loại; yêu cầu viết lại mục từ nguồn/dàn ý trong cùng ngân sách tối đa hai lượt viết, không thêm một lượt phục hồi riêng. Nếu vẫn không đạt thì dừng trước TTS. Checkpoint cũ thiếu dấu được viết lại mục tương ứng, hash mới không tái sử dụng audio khác văn bản. Giữ bộ phát hiện theo quy tắc và chuẩn hóa NFC.
- Node syntax đạt; chưa gọi Gemini/TTS hoặc chạy test cho thay đổi này. Trước khi nạp worker mới, đọc hàng đợi xác nhận không có queued/processing. Bản hoàn thành giữ nguyên, không tự tạo sách hoặc retry.
- Worker đã nạp mã mới và báo sẵn sàng (phiên 14750). Thay đổi áp dụng ở yêu cầu mới và job lỗi được người dùng chủ động tiếp tục.

---

### Phiên 19/10/2026 — Xử lý cache ghi chú thiếu dấu ở job tiếp theo

- Job `3bcb7122c028c5bce22d18a2` lỗi khi viết mục 2: log xác nhận hai phản hồi Gemini bị bộ kiểm tra dấu chặn, không phải lỗi kết nối API hay tạo âm thanh. Mục 1 đã có dấu và lưu 217 đơn vị. Các phản hồi bị chặn ở phiên cũ chưa được giữ nên chưa đối chiếu trực tiếp văn bản của hai lượt đó.
- Đọc dữ liệu thật phát hiện 3/74 ghi chú không dấu (chỉ số 19, 35, 68); brief mục 2 chứa đoạn không dấu. Bản sửa trước chỉ nhấn mạnh prompt và kiểm tra script, chưa kiểm tra ghi chú/cache trước khi dùng, nên nguồn AI trung gian lỗi vẫn được tái sử dụng.
- Thêm `systemInstruction` và mô tả trường JSON yêu cầu đầy đủ dấu. Bước note/reduce kiểm tra đầu ra ngay và tối đa hai lượt viết từ nguồn; không phục hồi dấu riêng. Khi tiếp tục/đọc cache, chỉ viết lại ghi chú thiếu dấu từ đúng đoạn sách gốc, giữ phần đạt, tính lại overview/compressions/brief phụ thuộc; giữ script đạt và rate đã đo. Tách namespace cache bằng `languageVersion`, kiểm tra cache cũ trước khi tái sử dụng. Không đổi phiên bản pipeline để tránh chặn retry job cũ.
- Log bổ sung số chữ có dấu, số từ, vị trí cửa sổ bị chặn. Lưu riêng bản script bị loại gần nhất/mục trong checkpoint ẩn, không dùng như bản nháp đạt hoặc đưa sang TTS. Bộ phát hiện vẫn theo quy tắc, không có cam kết tuyệt đối về chính tả.
- Node syntax đạt; chưa gọi Gemini/TTS hoặc tự retry job. Cần người dùng bấm tiếp tục sau khi worker nạp mã để kiểm tra đầu ra thực tế.
- Xác nhận hàng đợi rảnh rồi restart worker thành công (phiên 70360); worker báo sẵn sàng. Giữ nguyên trạng thái failed của job, không khởi động thêm Python.

---

### Phiên 20/10/2026 — Phase 4, mục 1a: image Backend/worker

- Theo yêu cầu thực hiện từng ý, chia ý đóng gói/chạy local thành 1a Backend/worker, 1b Engine CPU, 1c Frontend/Compose; hạ tầng cloud, HTTPS/Keycloak production/SMTP và deploy làm sau. Lộ trình chi tiết trong PHASE4.md.
- Thêm Dockerfile Node 24 Debian slim, cài dependency theo lockfile, chạy user `node`; cùng image cho API/worker. Chỉ COPY source runtime, schema và công cụ PostgreSQL cần thiết. `.dockerignore` loại env, dữ liệu, audio và dependency host khỏi build context. Không sao chép secret hay database vào image.
- Bỏ URL Engine hardcode trong luồng bài giảng; thêm cấu hình ENGINE_URL dùng chung với worker, giữ BOOK_ENGINE_URL làm fallback. BOOK_ARTIFACT_ROOT có thể cấu hình để mount volume cùng đường dẫn với Engine ở bước sau.
- Tách KEYCLOAK_INTERNAL_URL cho token/Admin API/JWKS khỏi KEYCLOAK_URL public; issuer/audience/chữ ký JWT vẫn được kiểm tra theo cấu hình public. Mặc định khi chạy Windows không đổi.
- Thêm mẫu deploy/backend.env.example, bỏ qua file deploy/*.env chứa giá trị thật; README liên kết PHASE4.md. Chưa tạo secrets production hoặc chọn nhà cung cấp cloud.
- Node syntax và diff whitespace đạt. Build `text2speech-backend:phase4.1` thành công bằng Docker Desktop; đọc metadata xác nhận Linux/amd64, user `node`, workdir `/app/backend`, 427.572.278 bytes (~408 MiB), image ID `830579bcdeaf218fd0c59d2ef4b39c90cc0ab8c3cd0a70b999bf18a0c253b18c`. Build context ~235 KB. Không thêm/chạy test hoặc gọi Gemini/TTS.
- Hoàn thành mục 1a và dừng ở đây theo yêu cầu thực hiện từng ý. Chưa bật container Backend/worker, chưa xác nhận auth/TTS/chia sẻ file khi chạy trong container; chưa chuyển dịch vụ ứng dụng, dữ liệu hoặc volume. Mục tiếp theo là 1b: image Engine CPU.

---

### Phiên 20/10/2026 — Phase 4, mục 1b: image Engine CPU

- Thêm Dockerfile Python 3.10 Debian slim nhiều stage, FFmpeg/FFprobe/libsndfile/libgomp; user tts UID/GID 1000 khớp Backend. Không sao chép venv Windows, weights, audio, cache hoặc secret vào image; build context chỉ ~152 KB.
- Tách dependency image API khỏi môi trường Windows: PyTorch/TorchAudio ghim 2.10.0+cpu cùng phiên bản, cài CPU index và giữ constraints khi giải quyết thư viện khác. Ghim dependency trực tiếp; ghi danh sách thực tế sau cài vào /opt/engine-installed.txt. Không thay package trong venv Windows.
- Container dùng gói silero-vad kèm model, tránh hỏi trust/download Torch Hub. Import ASR chuyển vào nhánh sử dụng; image chỉ phục vụ API VAD/clone, không đóng gói ASR/Gradio demo. Nhánh VAD Windows cũ giữ mặc định khi không đặt SILERO_VAD_BACKEND=package. Đây là nhánh mới, chưa chạy âm thanh thật để xác nhận.
- Thêm runtime_paths.py cho AUDIO_ROOT và BOOK_ARTIFACT_ROOT, giữ mặc định bố cục cũ. Cấu hình OPENVOICE_CHECKPOINT_DIR và revision model; kiểm tra cả config.json/checkpoint.pth trước tải. Docker dùng revision chính thức ea66dc9353e660b1dbbe0bebebd4c2d8b105483c; model còn thiếu tải khi khởi động, WavMark vẫn dùng cache Hugging Face.
- Thêm deploy/engine.env.example cho mục Compose tiếp theo. Dự kiến giữ weights/cache ở volume riêng và audio ở cùng đường dẫn tuyệt đối với Backend/worker. Secret cấp khi chạy; không build vào image.
- Python AST và diff whitespace đạt. Build image text2speech-engine:phase4.1 thành công; metadata Linux/amd64, user tts UID/GID 1000, workdir /app/engine, 2.666.761.326 bytes (~2,48 GiB), image ID 4803793c40102e93e812a6eeee8243d83d15781288728cd70b0a3f08f68187d9. Không chạy container/model/Gemini/TTS hoặc thêm/chạy test. Mục 1c ghép stack vẫn để lượt sau.
- Điều chỉnh dependency Hub trong image thành 0.34.4 để cùng cài được gTTS 2.5.4 (Click <8.2); Hub 2.2 trên host yêu cầu Click >=8.4.2. Build dùng HTTPS cho Debian, retry và cache APT/pip; đã dừng lần HTTP chậm và helper còn sót của chính lần build đó trước khi tiếp tục bản mới. Chưa cài hoặc sửa venv host.
- Chuyển import từ điển text_to_sequence vào BaseSpeakerTTS.get_text: API dùng Edge-TTS + ToneColorConverter nên image không cần bộ từ điển BaseSpeakerTTS/ASR/Gradio demo. Đã dừng lần build đang tải dictionary không dùng, tái dùng cache FFmpeg/PyTorch rồi build image cuối thành công. Torch/TorchAudio thực tế cài cùng bản 2.10.0+cpu, không thay bằng CUDA.
- Hoàn thành mục 1b và dừng theo yêu cầu từng bước. Source/cấu hình giữ cách chạy Windows mặc định; chưa dừng hoặc khởi động thêm server Python/các dịch vụ ứng dụng, không đổi database/R2/job. Chưa xác nhận nạp model, nhánh VAD đóng gói, quyền volume hay tạo âm thanh thật trong container.

---

### Phiên 20/10/2026 — Phase 4, mục 1c: Frontend và Compose local

- Thêm image Frontend nhiều stage: Node 24 build theo lockfile, Nginx chạy user riêng phục vụ dist tại cổng Windows 5173; cấu hình fallback cho router Vue và cache asset. Env build chỉ có URL/realm/client ID public, không đưa secret vào bundle hoặc context.
- Thêm overlay deploy/compose.app.yaml trên keycloak/compose.yaml, giữ project tts-keycloak-local, PostgreSQL/Keycloak/Mailpit và volume cũ. Thêm Backend, worker riêng, Engine CPU và Frontend; mạng nội bộ dùng postgres/keycloak/engine, issuer và URL trình duyệt giữ localhost. Chỉ publish loopback. Container Mongo migration cũ được giữ, runtime không phụ thuộc MongoDB.
- Bind thư mục book-audio và public/audio cùng đường dẫn Linux cho Engine/Backend/worker; dùng lại weights OpenVoice có sẵn, thêm volume cache và processed. Không di chuyển database/audio lên cloud, không xóa dữ liệu R2. Backend/worker user node và Engine user tts cùng UID/GID 1000.
- Tạo công cụ init_docker_local.js sinh hai env Docker từ cấu hình private Windows, chỉ đổi endpoint nội bộ, giữ credentials/Engine secret. Dùng format raw để giữ ký tự đặc biệt; mặc định không ghi đè, có --refresh khi chủ động đổi cấu hình. Env thật bị Git bỏ qua. Thêm deploy/stack.ps1 prepare/build/up/status/logs/stop; up thường ngày không cần build lại.
- Bổ sung health Backend đọc PostgreSQL; Engine xác nhận pipeline/model, FFmpeg/FFprobe, secret và thư mục; worker đối chiếu ID riêng với lease còn hạn. Compose chờ dependency healthy, restart unless-stopped; worker/Engine có thời gian dừng mềm 25 phút. Health không gọi Gemini/TTS và không thay thế kiểm thử toàn luồng.
- Trước bật stack: không có server ứng dụng trên 3000/5173/8000 và không có queued/processing. Đã backup tts_app: keycloak/backups/app-postgres-1792475405319.dump; Keycloak: keycloak/backups/keycloak-20261020-125006-29d670b4.dump. Không chạy migration/import/seed/reset tài khoản.
- Build cả ba image thành công; Compose up --wait hoàn tất, 7 service healthy. Engine nạp OpenVoice CPU 16 threads, không thiếu/thừa keys; Backend kết nối PostgreSQL, worker sẵn sàng và giữ lease. Bốn container ứng dụng chạy non-root, restart count 0 lúc đọc trạng thái.
- Đọc số lượng trước/sau giữ nguyên: 3 user (3 linked, 1 admin, 0 pending), 4 voice, 9 job (3 completed, 2 failed, 4 cancelled), 3 lịch sử. Worker hoạt động; không tự retry hoặc tạo job. Node/Python AST/PowerShell syntax và diff whitespace đạt; Frontend build còn cảnh báo chunk PDF lớn. Không thêm/chạy test hoặc gọi Gemini/TTS; đăng nhập/upload/VAD/clone/retry cần kiểm thử khi được yêu cầu.
- Cập nhật README, PHASE4 và hướng dẫn Engine/sách nói. Hoàn thành mục 1c, giữ stack local đang chạy; dừng trước mục 2 (chọn nơi deploy, tài nguyên, domain, backup/phục hồi).

---

### Phiên 21/10/2026 — Làm mới giao diện và thêm Light/Dark mode

- Thiết kế lại khung Vue cho người dùng/quản trị: sidebar xanh đậm, điểm nhấn xanh ngọc, banner có minh họa sóng âm bằng SVG/CSS, thẻ nội dung, biểu mẫu, thống kê và bảng quản trị đồng bộ. Áp dụng trang chào, bài giảng, sách nói và lịch sử; giữ điều hướng và nghiệp vụ.
- Thêm assets/theme.css với màu ngữ nghĩa cho hai chế độ; chuyển màu cứng ở nội dung/bảng/biểu mẫu/thông báo/trạng thái sang biến chung. Sidebar giữ nền tối ở cả hai chế độ; nội dung đổi nền và màu chữ theo theme. Bố cục chuyển một cột trên màn hình nhỏ, có focus bàn phím và giảm chuyển động theo hệ thống.
- Thêm ThemeToggle dùng chung trên trang chào và topbar; useTheme ghi nhớ text2speech.theme trong localStorage, mặc định theo hệ điều hành nếu chưa chọn và đồng bộ giữa các tab. Có fallback khi storage bị chặn; index.html áp dụng sớm trước khi khởi tạo OIDC. Không có cookie/token xác thực mới hoặc thay đổi luồng đăng nhập.
- Thêm StudioBanner dùng chung cho các trang user/admin. Phạm vi theme sáng/tối là Vue; Keycloak tiếp tục dùng theme riêng. Cập nhật README giải thích vị trí nút và cấu trúc mã.
- Build image Frontend thành công (389 modules); cảnh báo chunk PDF lớn vẫn còn. Không thêm/chạy bộ test hoặc gọi Gemini/TTS. Cập nhật riêng container frontend bằng Compose --no-deps; chưa rà soát tương tác bằng phiên người dùng thực. Không chuyển sang mục hạ tầng/cloud của Phase 4 trong lượt này.

---

### Phiên 21/10/2026 — Đồng bộ trang đăng nhập/đăng ký Keycloak

- Đồng bộ theme text2speech của Keycloak với Vue: bảng màu xanh ngọc sáng/tối, nền, card, tiêu đề, trường nhập, nút mật khẩu, liên kết, thông báo lỗi/thành công và favicon. Áp dụng layout kế thừa cho đăng nhập/đăng ký/quên mật khẩu/đặt mật khẩu mới; không sao chép hoặc thay biểu mẫu xác thực gốc.
- Thêm palette.css sao chép từ frontend/src/assets/theme.css; theme.properties tải bảng màu và js/theme.js. Footer cung cấp nút sáng/tối có nhãn Việt/Anh, aria-pressed và hỗ trợ bàn phím; script áp dụng theme trong head, gắn nút khi DOM sẵn sàng. Tắt toggler OS của theme cha để lựa chọn thủ công không bị ghi đè.
- Vue/Keycloak ghi nhớ localStorage và chia sẻ cookie host-only tts_theme, chỉ nhận light/dark, SameSite=Lax, Path=/, tối đa một năm, Secure khi HTTPS. Đồng bộ khi mở trang hoặc quay lại tab; localStorage tiếp tục đồng bộ các tab cùng origin. Mặc định theo hệ điều hành khi chưa có lựa chọn; có fallback khi storage bị chặn. Không chỉnh token, client, PKCE, session hoặc cấu hình tài khoản.
- Cơ chế chia sẻ local yêu cầu cùng hostname localhost giữa cổng 5173 và 8080; 127.0.0.1 hoặc app/auth khác hostname không dùng chung cookie. Đã ghi giới hạn và cách đồng bộ bảng màu trong keycloak/THEME.md và README; cần thiết kế riêng khi chốt hostname production.
- Node syntax và Frontend Docker build đạt, 389 modules; cảnh báo chunk PDF lớn giữ nguyên. Cập nhật riêng Frontend, theme Keycloak dùng bind mount hiện có và cache local đã tắt. Không restart Keycloak, không chạy migration/seed/đổi dữ liệu hoặc bộ test đăng nhập/đăng ký; tương tác thực tế cần rà soát khi được yêu cầu.

---

### Phiên 21/10/2026 — Chỉnh focus Keycloak và bổ sung Việt/Anh cho website

- Bỏ outline đen của input bên trong lớp form-control Keycloak, chỉ giữ viền xanh và bóng mờ ở wrapper; nhóm mật khẩu có một vùng focus chung. Focus bàn phím vẫn có chỉ báo; trường lỗi giữ viền đỏ. CSS dùng chung cho đăng nhập/đăng ký và các form kế thừa, không sửa action/validation.
- Thêm LocaleSelector trên trang chào và topbar user/admin; useLocale mặc định tiếng Việt, lưu text2speech.locale và cookie tùy chọn tts_locale. Đổi ngôn ngữ cập nhật Vue tại chỗ, đồng bộ các tab cùng origin và đọc lựa chọn cookie khi quay lại tab. Cookie chỉ nhận vi/en, host-only, Path=/, SameSite=Lax, một năm, Secure khi HTTPS; giới hạn cùng hostname localhost như theme.
- Thêm bộ dịch locales/en.json với chuỗi nguồn tiếng Việt làm khóa, $t và locale ngày/số dùng chung. Dịch điều hướng, banner, nhãn/placeholder/aria, nút, bảng/stat admin, xác nhận, trạng thái/tiến độ và các thông báo API đã biết. Thông báo đọc file có tham số để không dịch tên file và cập nhật được khi đổi ngôn ngữ; thông báo chưa có khóa giữ nguyên để không mất chẩn đoán.
- Giữ nguyên tên sách, tên giọng, nội dung người dùng nhập, dữ liệu/kịch bản AI và âm thanh; thay ngôn ngữ giao diện không chuyển sách nói thành tiếng Anh. Giữ key của các phần tử/bản ghi, các giá trị role/gender/voice và dữ liệu gửi API. Tìm lịch sử hỗ trợ cả nhãn phong cách nguồn và nhãn đã dịch.
- Khi đăng nhập/đăng ký, SDK Keycloak tiếp tục tạo URL cùng state/nonce/PKCE; client gửi locale hiện tại bằng ui_locales và kc_locale. Theme locale.js ghi ngôn ngữ render và lựa chọn dropdown gốc vào cookie để Vue tiếp nhận khi quay lại. Không làm mới trang Keycloak tự động khi tab nhận focus để tránh mất nội dung form đang nhập.
- Node syntax và Docker Frontend build thành công (392 modules); cảnh báo chunk PDF lớn vẫn còn. Chỉ cập nhật container Frontend, Keycloak đọc theme qua bind mount và cache local đã tắt. Không thêm/chạy bộ test, tạo tài khoản hoặc gọi Gemini/TTS; chưa kiểm thử tương tác thực tế. Cập nhật README và keycloak/THEME.md; không tiếp tục mục deploy/cloud trong lượt này.

---

### Phiên 21/10/2026 — Căn chỉnh form Keycloak và bộ chọn ngôn ngữ

- Sửa lưới header kế thừa 70%/30% cộng gap làm bộ chọn ngôn ngữ tràn sang phải; dùng cột nội dung co giãn và cột ngôn ngữ 124px. Tách vùng mũi tên khỏi chữ Tiếng Việt, đồng bộ màu icon theo theme và bố trí hàng riêng trên màn hình nhỏ.
- Bỏ margin thừa dưới logo; thống nhất khoảng đệm ngang của tiêu đề, ô nhập, nút và footer. Phân biệt footer thông tin lồng trong body với footer thương hiệu để không cộng khoảng đệm hai lần; ẩn footer rỗng của đăng ký. Bo góc phần viền nút hiện/ẩn mật khẩu.
- Đã đối chiếu DOM/CSS và quan sát trang đăng nhập/đăng ký local trên trình duyệt ở giao diện tối tiếng Việt. Bộ chọn ngôn ngữ và các trường có cùng mép phải, card nằm giữa khung xem. Lưu ảnh tham khảo local trong keycloak/backups/login-layout-fixed.jpg và register-layout-fixed.jpg. Chưa rà trực quan các kích thước điện thoại hoặc giao diện sáng/English trong lượt này.
- Theme được bind mount và cache local đã tắt nên tải lại trang để nhận CSS; không cần build Frontend hay restart Keycloak. Không thêm/chạy bộ test hoặc thực hiện đăng nhập/tạo tài khoản; cập nhật keycloak/THEME.md.

---

### Phiên 22/10/2026 — Tóm tắt bám nguồn, duyệt nội dung và nhịp đọc

- Triển khai luồng mới review-v1 cho yêu cầu mới: ghi chú có cấu trúc (nhân vật/quan hệ, dữ kiện, nguyên nhân–hệ quả, điều chưa chắc), dàn ý theo thể loại; truy xuất lại nguyên bản liên quan khi viết và đối chiếu. Cache grounded-review-1 riêng, không dùng lại ghi chú khái quát cũ. Giữ nguyên dữ kiện, diễn đạt riêng, tránh sao chép/tái hiện chi tiết. Nguồn ngắn trả bản ngắn trung thực thay vì ép đủ phút.
- Thêm bước đối chiếu bằng AI từng mục; sửa phần phát hiện có vấn đề và đối chiếu lại trong giới hạn. Kết quả còn nghi vấn có nhận xét ở bản nháp. Đối chiếu dùng trích đoạn chọn lọc, không phải chứng nhận chính xác toàn sách; chưa chạy đánh giá bằng sách thật.
- Thêm migration 004-book-editorial-review, draft/revision/approved_revision/work_action/edit_request và trạng thái review. API có ownership, kiểm tra phiên bản để tránh ghi đè hai tab. Cho sửa tay, nhờ AI chỉnh một mục/toàn bộ, nghe thử, duyệt; bản sửa tay được đối chiếu lại trước audio và trả về review nếu có vấn đề, không tự đổi nội dung đã duyệt. Luồng cũ và các job hiện hữu giữ cách chạy cũ.
- Thêm BookDraftEditor, sửa màn hình Sách nói và bổ sung nhãn Việt/Anh: lưu bản nháp, báo thay đổi chưa lưu, nhận xét AI, thời lượng dự kiến, chọn phạm vi/yêu cầu chỉnh AI, nghe thử tối đa 30 giây và duyệt tạo âm thanh. Job lỗi có bản nháp được quay lại chỉnh; tiếp tục từ checkpoint vẫn giữ.
- TTS mới chia theo đoạn/câu, thay tốc độ nhẹ theo phần nội dung/kết, thêm nghỉ theo đoạn/mục; cao độ giữ nguyên. Endpoint nghe thử nội bộ có xác thực, cắt tối đa 30 giây; dùng đúng giọng đã chọn. Tham số nhịp và phiên bản tham gia hash/cache. Chặn 1 giờ cả ước lượng trước audio, tổng đoạn và file ghép. Sửa dọn R2 chỉ xóa WAV từng đoạn, giữ MP3 kết quả chung prefix.
- JavaScript/Python qua kiểm tra cú pháp; Frontend build thành công 394 modules, cảnh báo chunk PDF lớn giữ nguyên. Không thêm/chạy bộ test, tạo job thật hoặc gọi Gemini/TTS trong lượt này. Chưa đánh giá chất lượng bằng nghe/đối chiếu sách thật; giữ Edge-TTS/OpenVoice đến khi có kết quả so sánh.
- Đã áp dụng local sau khi người dùng bật Docker: dừng worker, tạo backup keycloak/backups/app-postgres-1792631990530.dump (1.072.854 byte), build lại Backend/Frontend/Engine; dừng Backend và chạy migration 004 bằng container dùng image mới. Khởi động lại stack thành công; 7 service runtime healthy, container MongoDB migration cũ cũng đang chạy nhưng không dùng cho runtime.
- Kiểm tra vận hành sau cập nhật: Backend kết nối tts_app với role ứng dụng, schema mới đã sẵn sàng, worker_active=true. Hiện có 3 user (đều liên kết Keycloak, 1 admin, không pending), 4 giọng, 9 book_jobs và 3 generated_lectures. Chưa tạo job thử hoặc gọi Gemini/TTS để đánh giá chất lượng; các yêu cầu mới dùng bước review-v1, dữ liệu/job cũ giữ luồng cũ.

---

### Phiên 22/10/2026 — Sửa tải PDF worker trong Frontend Docker

- Người dùng gặp Setting up fake worker failed khi chọn PDF. Kiểm tra HTTP HEAD đúng URL ảnh báo lỗi: trả 200, file 1.265.413 byte, nhưng Content-Type application/octet-stream. Nginx Alpine thiếu ánh xạ .mjs nên trình duyệt không chạy được module worker; lỗi xảy ra ở bước đọc file trước Gemini/TTS.
- Bổ sung types text/javascript mjs trong nginx.conf, giữ bảng MIME chung. Tạo services/pdf.js để hai màn hình Sách nói/Bài giảng dùng cùng worker đóng gói đúng phiên bản PDF.js; bỏ cấu hình CDN của trang Bài giảng có thể ghi đè worker chung. Thêm query module=1 để bỏ qua phản hồi MIME cũ đã cache.
- Đã build Frontend thành công (395 modules) và cập nhật riêng container Frontend, healthy. Đọc lại HTTP HEAD sau triển khai: worker .mjs?module=1 trả 200, text/javascript, 1.265.413 byte; JavaScript .js vẫn application/javascript và CSS vẫn text/css. Không chạy bộ test hoặc gọi AI/TTS trong lượt sửa này; chưa đọc trực tiếp file PDF gốc của người dùng. Người dùng tải lại website Ctrl+F5 và chọn lại PDF để nhận cấu hình worker mới.

---

### Phiên 22/10/2026 — Điều tiết Gemini và tự tiếp tục có lịch chờ

- Thay vòng thử 3 lần cách 4/8 giây bằng gemini_reliability: phân loại RATE_LIMIT, DAILY_QUOTA, QUOTA_CONFIG, OVERLOADED, TIMEOUT, NETWORK, SERVER_ERROR, AUTH, MODEL_NOT_FOUND và BAD_REQUEST. Ghi HTTP, model, stage countTokens/generateContent, quota ID đã lọc và retry_at; không log raw exception, URL, API key hay nội dung nguồn. Lỗi Gemini không bị gán nhầm sang PostgreSQL/Keycloak.
- RPC trong worker được nối hàng một lượt tại một thời điểm, giãn mặc định 4 giây giữa các lần bắt đầu. Mặc định phân tích một phần. Ghi nhớ số token theo hash prompt/model/schema 15 phút, tối đa 256 mục để giảm đếm lại khi retry. Mô hình và khóa hiện tại giữ nguyên; chưa thêm nhà cung cấp dự phòng.
- Lỗi tạm chờ tăng dần: 429 từ 30 giây, lỗi tạm khác từ 15 giây, tăng gấp đôi đến 5 phút cộng tối đa 20% nhiễu; tôn trọng RetryInfo nếu yêu cầu chờ lâu hơn. SDK hiện giữ RetryInfo nhưng không giữ Retry-After header. Nghỉ theo scope hash khóa+model lưu ở worker_leases để các phần/việc khác không tiếp tục dồn yêu cầu khi đã nhận lỗi.
- Migration 005-book-ai-retry thêm next_attempt_at và retry_state. Worker lưu trạng thái rồi đưa về queued có giờ hẹn, không nhận trước giờ và không giữ job trong lúc ngủ dài; checkpoint/lịch còn sau restart. Ngân sách mặc định 8 lần liên tiếp/30 phút chờ, tối đa 20 lượt cộng dồn mỗi tác vụ; tiến độ mới làm mới phần liên tiếp. Hết ngân sách dừng có thông báo, không thử vô hạn.
- Chỉ nhận diện quota ngày từ thông tin cụ thể của Google, không suy từ mọi 429. Quota ngày/quota bằng 0 dừng tự thử; mốc reset RPD dùng Pacific có DST. Manual retry kiểm tra lại scope khi người dùng đã điều chỉnh quota/billing/key. API vẫn kiểm tra ownership và không cho bỏ qua lịch chờ bằng retry với job queued; hủy chờ được giữ.
- Frontend có trạng thái chờ Gemini, bộ đếm/thời điểm tiếp tục, mã HTTP/bước khi dừng; bổ sung Việt/Anh. Thêm env mẫu và đồng bộ tùy chọn vào công cụ tạo env Docker. Không đổi dữ liệu nguồn, giọng, nội dung đã duyệt hoặc cấu hình Gemini hiện tại.
- JavaScript qua kiểm tra cú pháp, Frontend build thành công 395 modules, cảnh báo chunk PDF lớn giữ nguyên. Đã build Backend/Frontend; dừng worker/Backend, backup keycloak/backups/app-postgres-1792660477231.dump, áp dụng migration 005 và bật lại stack; các container runtime healthy. Không thêm/chạy bộ test, giả lập lỗi hoặc chủ động tạo job/gọi Gemini/TTS trong lượt này. Còn cần quan sát lỗi thật hoặc kiểm thử khi có yêu cầu.

---

### 22/10/2026 — Hủy và xóa yêu cầu sách nói

- Thêm nút Hủy và xóa yêu cầu cho queued/processing/review; Xóa yêu cầu cho failed/cancelled. Có xác nhận bỏ bản nháp/chỉnh sửa và hỗ trợ Việt/Anh. Sau khi API nhận, gỡ khỏi Yêu cầu gần đây và chặn phản hồi polling cũ đưa yêu cầu trở lại.
- Thêm DELETE theo owner, khóa hàng khi hủy để tránh xung đột xuất bản; chặn completed/publishing/đã có lịch sử. Đánh dấu xóa bền vững, ngừng lịch Gemini retry; worker dừng sau lượt đang chạy và dọn dữ liệu tạm khi rảnh. Dọn đúng ID job ở Engine/local/R2, gồm preview và MP3 chưa xuất bản; giữ giọng mẫu/lịch sử.
- Sau cleanup xóa source/checkpoint/draft/metadata/voice/result/retry; giữ dấu ID/chủ sở hữu/request_id và trường vận hành để chống tạo lại do gửi trùng. Cache nguồn dùng chung giữ TTL hiện có. Yêu cầu cũ không bị xóa hàng loạt.
- Migration 006-book-discard, backup trước migration: keycloak/backups/app-postgres-1792662792936.dump. Đã kiểm tra cú pháp JavaScript, Frontend build 395 modules và build/cập nhật image Backend/worker/Frontend; các container runtime healthy. Chưa tạo job thật hoặc chạy kiểm thử chức năng hủy trong lượt này.

### 22/10/2026 — Popup thống nhất cho toàn bộ giao diện

- Thêm useNotifications và NotificationCenter dùng bảng màu sáng/tối, Việt/Anh, popup kết quả/lỗi ở góc và dialog xác nhận/chào mừng ở giữa. Native dialog hỗ trợ giữ focus, Escape, trả focus, khóa nội dung nền; thông báo có nút đóng/thử lại. Popup lỗi không tự biến mất; popup thành công tự đóng sau 8 giây, dialog chờ người dùng.
- Chuyển xác nhận hủy/xóa sách, bỏ chỉnh sửa/chuyển trang, phân quyền/ẩn giọng/đăng xuất sang template chung. Nối phản hồi đọc file, bài giảng, giọng cá nhân/chung, chỉnh/duyệt sách, nghe thử, retry và quản trị; giữ tiến độ/hướng dẫn và trạng thái lỗi để mở lại/thử lại. Chặn thông báo lỗi lặp do polling.
- Backend /api/auth/me thêm account_created khi thực sự tạo hồ sơ mới sau xác thực thành công; Frontend dùng cho lời chúc đăng ký. Phiên có sẵn hiện lời chào theo tên, ghi nhớ session identity trong sessionStorage để refresh không chào lặp; không lưu token ở đó. Chức năng đăng nhập/PKCE/phân quyền giữ nguyên.
- Keycloak theme thêm notifications.js đọc thông báo máy chủ thành text, dùng bảng màu và nhãn Việt/Anh; giữ lỗi cạnh input cho trợ năng. Không đọc mật khẩu/token. Trình duyệt vẫn tự quản lý cảnh báo đóng/tải lại tab khi có sửa chưa lưu.
- Kiểm tra cú pháp JavaScript và Frontend build thành công (398 modules); đã build/cập nhật Backend/worker/Frontend Docker, các dịch vụ báo healthy. Theme Keycloak mount trực tiếp, local đã tắt cache nên dùng source mới. Không cần migration database cho popup. Chưa chạy bộ test hay đăng nhập/đăng ký/tạo nội dung thử trong lượt này.

### 22/10/2026 — Tiêu đề mục thiếu dấu

- Nguyên nhân: bộ phát hiện mất dấu cho đoạn dài bỏ qua văn bản dưới 35 từ; title/focus trong schema dàn ý trước dùng chuỗi chung. Thêm bộ kiểm tra riêng cho tiêu đề ngắn dựa trên dấu hiệu tiếng Việt, giữ tên riêng ngoại ngữ; đổi schema title/focus/genre/reason sang mô tả tiếng Việt đầy đủ dấu.
- Kiểm tra đầu ra dàn ý trước lưu. Nếu tiêu đề còn thiếu dấu, Gemini viết lại danh sách tiêu đề có dấu tối đa 2 lượt, giữ thứ tự/phạm vi từng mục; không viết lại toàn bộ sách. Áp dụng với dàn ý đã lưu khi worker tiếp tục job review-v1, đồng bộ tiêu đề checkpoint/bản nháp; lỗi mạng/quá tải vẫn qua lịch retry hiện có. Không tự thêm dấu bằng ánh xạ từng từ.
- Đã backup keycloak/backups/app-postgres-1792680866007.dump và sửa 8 tiêu đề của bản nháp b2f06e2e128518158dc90544 trong transaction khi đang review. Tăng draft_revision 1 → 2, giữ nội dung tóm tắt, nguồn và preview, đồng bộ tiêu đề dàn ý/bản nháp trong checkpoint. Mục 4 có cụm cũ mơ hồ nên đặt tên rõ nghĩa theo đoạn tương ứng: Thử thách và cuộc gặp gỡ ở vùng băng giá. Không gọi Gemini để cập nhật bản nháp này.
- Kiểm tra cú pháp JavaScript và build Frontend 398 modules thành công, cập nhật image Backend/worker/Frontend vào Docker; các service runtime healthy. Chưa chạy test hoặc tạo sách/gọi Gemini để kiểm chứng bộ nhận diện tiêu đề mới.

### 22/10/2026 — Nhịp đọc, phong cách theo đoạn và SRT (bước 2, 3, 5)

- Theo yêu cầu, bỏ bước 1 (thanh tốc độ/cao độ riêng) và bước 4 (dịch vụ TTS diễn cảm khác). Giữ Edge-TTS/OpenVoice; triển khai chèn nghỉ 0–2 giây, năm phong cách định sẵn cho bài/mục/đoạn, chuẩn hóa số/ngày/đơn vị, từ điển phát âm và SRT cho bài giảng/sách nói.
- Tách lời văn đối chiếu nguồn khỏi chỉ dẫn đọc và lưu cấu hình riêng. Hash bản đọc + revision chặn dùng bản xem cũ sau sửa. Thay nhịp không tự gọi lại Gemini đối chiếu; sửa nội dung vẫn phải qua xác minh như trước. AI viết lại một mục sẽ bỏ chỉ dẫn nghỉ/lựa chọn theo đoạn cũ của mục đó.
- Thêm khối giao diện dùng chung, Việt/Anh, token giao diện sáng/tối, nút Xem cách đọc, nghe thử tối đa 30 giây và tải SRT tại kết quả/lịch sử. Phần xem quy tắc không gọi Gemini/TTS. Bài giảng dùng Engine nội bộ theo đoạn, kết quả cũ và job legacy được giữ tương thích.
- Engine tạo khoảng lặng thật, đo thời lượng lời đọc trước nghỉ. SRT dùng mốc đoạn đo được và ước lượng câu theo độ dài chữ; chưa phải căn phụ đề chính xác từng từ. Thêm migration 007-speech-subtitles cho cấu hình đọc và đường dẫn phụ đề trong lịch sử.
- Kiểm tra cú pháp JS/Python, build frontend (401 modules) và ba image Docker. Backup trước migration: `keycloak/backups/app-postgres-1792684119927.dump`; đã áp dụng `007-speech-subtitles` và cập nhật stack local, bảy service runtime healthy. Chưa chạy kiểm thử chức năng, chưa tạo/nghe âm thanh thật trong lượt triển khai này.

### 22/10/2026 — Đưa nhịp đọc sách nói sang menu bên phải

- Chuyển khối Nhịp đọc và phụ đề của bản nháp sách nói vào cùng panel chọn thời lượng/giọng đọc ở cột phải. Giữ chung trạng thái bản nháp, vị trí con trỏ chèn nghỉ, kiểm tra hash và luồng lưu/nghe thử/duyệt.
- Bổ sung bố cục gọn cho cột hẹp: phong cách từng đoạn, từ điển và so sánh cách đọc xếp dọc; có nhãn tên bản tóm tắt đang được áp dụng để phân biệt với thiết lập tạo yêu cầu mới. Trên màn hình nhỏ, panel theo bố cục một cột của trang.
- Build Frontend thành công (401 modules), cập nhật riêng container Frontend và chờ healthy. Chưa chạy kiểm thử tương tác trong lượt này.

### 22/10/2026 — Rút gọn chữ trong menu sách nói

- Rút gọn tiêu đề, nhãn thời lượng, chọn giọng và nút tạo; bỏ lời giải thích lặp ở cột phải. Hướng dẫn tạo, thông tin AI và cách dùng nhịp đọc/SRT chuyển vào mục mở rộng; lỗi nhập thời lượng và worker vẫn hiện trực tiếp.
- Khối nhịp đọc gọn chỉ hiện điều khiển chính, các lựa chọn theo đoạn/từ điển vẫn mở rộng khi cần; bản xem lời đọc mặc định thu gọn trong sidebar. Giữ bản đầy đủ cho trang bài giảng, đồng bộ nhãn Việt/Anh.
- Build Frontend thành công (401 modules), cập nhật riêng container Frontend và chờ healthy. Chưa chạy kiểm thử tương tác trong lượt này.

### 23/10/2026 — VieNeu-TTS tùy chọn và xem xét kiến trúc cloud + PC

- Giữ Edge-TTS + OpenVoice làm mặc định, thêm lựa chọn VieNeu cho bài giảng/sách nói; snapshot provider/giọng/phiên bản theo job và tách hash/cache. Job cũ vẫn Edge, không tự chuyển khi retry. Chuẩn bị VieNeu v3 Turbo SDK 3.8.3 trong service/venv riêng, CPU ONNX, preset và clone trực tiếp; không thay venv Engine cũ.
- Xác nhận máy đang thao tác là Intel Arc 140T, người dùng cho biết RTX 4060 ở máy bàn khác. Chuẩn bị overlay CUDA VieNeu riêng cho máy đó. Không hứa mốc 2–4 phút chưa đo; style v3 Turbo theo mẫu giọng, preset web vẫn chủ yếu đổi tốc độ/nghỉ.
- Giảm số lượt phân tích cho yêu cầu mới bằng chunk 12.000 ký tự có cấu hình 6.000–16.000, lưu kích thước trong checkpoint và cache namespace; job cũ giữ 6.000 để source_ids không lệch. Giữ đối chiếu nguồn độc lập, không gộp với chính lượt viết.
- Đánh giá từng đề xuất trong VIENEU.md: cloud + PC khả thi, nhưng cần giao thức file R2, tác vụ bất đồng bộ/heartbeat và xác thực tunnel; hiện chưa đổi hạ tầng sang cloud hoặc mở cổng/tunnel. Không chỉ đổi ENGINE_URL do còn phụ thuộc volume chia sẻ.
- Đã kiểm tra cú pháp JS/Python, build Frontend 401 modules và các image ứng dụng/VieNeu. VieNeu CPU đã tải weights và nạp model thành công; các service ứng dụng healthy. Không migration/import/seed database. Tạo mẫu nghe thử theo yêu cầu dùng thử (không tạo job DB hoặc gọi Gemini): giọng Thiện Minh, 9,309875 giây âm thanh, 22,17 giây xử lý lần đầu CPU (Engine bao gồm gọi model và FFmpeg). File ở `backend/data/book-audio/e59737c6da3e4d88bb607cc0/2d217b3e225b26cae74af09bcccb1b1aabdf1633fe2e12d7e156448a0891dc84.wav`. Chưa chạy test suite/toàn luồng sách, chưa nghe đánh giá chất lượng, chưa chạy trên RTX 4060.

### 23/10/2026 — Tải trước Edge-TTS có giới hạn

- Thêm cửa sổ tải trước mặc định 3 đoạn cho tạo toàn bộ sách theo luồng review-v1 và bài giảng có cấu hình nhịp đọc. Node điều phối các yêu cầu đồng thời, Engine chạy chờ CLI qua asyncio.to_thread, semaphore tối đa 3; tương thích Windows và Docker. Không chờ tải cả sách mới clone.
- Chuyển Edge network I/O ra ngoài ENGINE_LOCK; OpenVoice, lấy embedding mẫu/nguồn và FFmpeg xuất đoạn vẫn tuần tự. Mỗi lượt Edge có instance riêng, không chia sẻ trạng thái lỗi CLI. Không đổi giọng/rate/pitch/pause, part ID, hash hoặc provider của job cũ. VieNeu, preview cắt theo thời lượng và workflow legacy không tải trước.
- Cache nền theo job/part và chữ ký payload, xuất file hoàn chỉnh bằng rename; dùng lại khi retry, bỏ sau khi xuất WAV thành công. Giữ thứ tự checkpoint, khôi phục đoạn R2 và SRT. Prefetch lỗi tạm quay về xử lý đoạn theo retry cũ; HTTP 403 nhận diện dừng, không fallback giọng.
- Phiên tải trước có ID riêng; guard kiểm tra hủy/quyền/lease mỗi 2 giây. Khi đóng phiên, hủy CLI đang tải/chờ, không khởi chạy phần tiếp theo. Không cưỡng bức ngắt OpenVoice giữa inference; guard chặn xuất bản khi yêu cầu đã hủy. Cleanup đợi writer của job kết thúc trước khi xóa thư mục.
- Cấu hình Backend/worker EDGE_TTS_PREFETCH_CONCURRENCY=1..3 (mặc định 3, 1 chạy tuần tự trong job); Engine EDGE_TTS_MAX_CONCURRENCY=1..3 giới hạn tổng lượt Edge cho sách và bài giảng. Log EDGE PREFETCH và timing edge_prefetch phân biệt tải nền với clone; thời gian lời gọi có chồng lấp, không cộng thành wall time.
- Đã kiểm tra cú pháp JS/Python và build hai image. Không thay schema/dữ liệu/tài khoản, không chạy test suite hay gọi Gemini/Edge để benchmark trong lượt này. Đã cập nhật Engine/Backend/worker bằng image mới; 8 service runtime healthy (Mongo migration riêng vẫn healthy). Engine đã nạp 3 endpoint prefetch và báo ready; Backend đọc cửa sổ = 3. Chưa benchmark hoặc thử toàn luồng tạo sách thật.

### 23/10/2026 — Menu thời lượng gọn, tốc độ chung và nút duyệt

- Thu gọn radio 10/20/30 phút thành nút ngang cao tối thiểu 42 px; ô phút tùy chọn nằm cùng hàng nhãn, giữ số nguyên 1–59 và toàn bộ chọn provider/giọng mẫu. Dùng màu theme sẵn có, giữ thao tác bàn phím và tiếng Việt/Anh.
- Bỏ nút chèn khoảng nghỉ tại con trỏ ở sách/bài giảng. Giữ đọc markup cũ để không phá bản nháp/checkpoint; nghỉ tự nhiên theo phong cách, từ điển, chuẩn hóa và SRT vẫn có. Các tùy chọn chi tiết trong sidebar thu vào mục mở rộng.
- Thêm slider tốc độ chung 0,75x–1,50x, bước 0,05x, mặc định 1,00x, có đặt lại; rate_percent ghi vào speech-v1, bao gồm lời giới thiệu và mọi đoạn, ưu tiên trên rate của preset nhưng giữ pause/pitch. Job chưa có rate giữ hash/preset cũ đến khi người dùng lưu cấu hình mới. Edge áp rate trước OpenVoice; VieNeu dùng FFmpeg atempo giữ cao độ. Mở rộng xác thực Backend/Engine cùng miền -25..50%, cache/preview/SRT/ước lượng lấy đúng kế hoạch mới.
- Lưu tốc độ của yêu cầu mới trong checkpoint.initial_speech, đưa vào bản duyệt và ngân sách viết; không thêm cột DB hoặc đổi provider/giọng của job cũ.
- Nguyên nhân hai nút mờ: điều kiện !speechTools.ready đòi người dùng bấm Xem cách đọc ở cột phải. Bản mới tự chuẩn bị kế hoạch sau thay đổi (debounce 350 ms, không gọi AI); nút nghe thử/duyệt sách chỉ khóa theo busy/nội dung/thời lượng hợp lệ. Khi bấm, lưu bản nháp rồi tính hash từ đúng phiên bản đã lưu trước khi gửi preview/audio. Vẫn giữ chặn xung đột revision, đối chiếu nguồn và giới hạn dưới 1 giờ.
- Đã kiểm tra cú pháp JS/Python, build image Frontend/Backend/Engine (Frontend 403 modules). Không chạy test suite, không tạo job hoặc gọi AI/TTS thật trong lượt này; Đã recreate Frontend/Backend/Engine/worker và chờ các service cập nhật healthy; VieNeu giữ nguyên service riêng. Không chạy thử tạo âm thanh thực tế hoặc kiểm thử tương tác trình duyệt trong lượt này.

### 23/10/2026 — Giãn ô chọn giọng và bỏ Xem cách đọc

- Gom các ô Bộ tạo giọng/Loại giọng/Chọn giọng ở sidebar sách vào grid gap 20 px; giữ các chức năng và style theo theme.
- Thêm ghi chú ngắn dưới slider: Có thể đổi tốc độ sau khi có bản tóm tắt, trước khi tạo âm thanh. Hiện ở màn tạo mới lẫn slider của bản duyệt, có bản dịch tiếng Anh.
- Bỏ nút Xem cách đọc, lời nhắc thao tác thủ công và khung văn bản đọc/so sánh cách phát âm trong SpeechTools dùng chung cho sách/bài giảng. Vẫn lập kế hoạch tự động để ước lượng; API kiểm tra hash vẫn hoạt động. Bài giảng gọi ensurePlan khi bấm nghe thử/tạo, không khóa nút vì chưa có kết quả tự chuẩn bị; lỗi được báo qua feedback hiện có. Sách tiếp tục lưu revision rồi kiểm tra kế hoạch như bản sửa trước.
- Đã build Frontend 403 modules, không chạy test suite hoặc tạo âm thanh thật. Đã cập nhật riêng Frontend và chờ healthy; các service xử lý không cần khởi động lại.

### 23/10/2026 — Tài liệu quy trình sách đến file âm thanh

- Tạo QUY_TRINH_TAO_SACH_NOI.md theo yêu cầu: mô tả thao tác người dùng và luồng nội bộ của Frontend/Backend/worker/Gemini/Engine/PostgreSQL/R2, sơ đồ Mermaid, giới hạn đầu vào và cơ chế tạo/đối chiếu bản duyệt.
- Ghi rõ thời điểm áp dụng phút, giọng/provider được lưu theo yêu cầu và tốc độ có thể đổi ở bản duyệt; preset khoảng nghỉ, chuẩn hóa/từ điển, nghe thử 30 giây, kiểm tra revision/hash, hai nhánh TTS, tải trước Edge, MP3/SRT, checkpoint/retry và hủy.
- Có ví dụ hoàn chỉnh và bảng vị trí mã; dẫn tài liệu mới từ README. Chỉ cập nhật tài liệu, không thay mã chức năng hay chạy công việc AI/TTS.

### 25/10/2026 — Giảm thời gian xử lý, giữ hai nhánh TTS CPU

- Giảm `countTokens`: prompt nhỏ dùng ước lượng có biên dự phòng; gần 60% ngân sách thì đếm thật với cấu hình model/system/schema của SDK, cache 15 phút. Mặc định giữ 24.000 token đầu vào; hiệu chỉnh tăng từ usage thực, log token_mode và input_tokens không ghi nội dung/khóa bí mật.
- Yêu cầu mới có `analysis_strategy=adaptive-v1`: nguồn vừa ngân sách phân tích dữ kiện + lập dàn ý một lượt; nguồn dài gom tối đa 4 phần nguồn nhỏ/lượt, vẫn giữ ID tham chiếu. JSON/budget/truncation có fallback chia đôi; timeout lưu nhóm nhỏ cho lịch retry, không gọi dồn khi quota/503. Job cũ giữ chia nguồn/checkpoint cũ.
- Đối chiếu độc lập gom tối đa 3 mục theo ngân sách, fallback từng mục. Cache checkpoint xuyên revision/action gồm text, bằng chứng, ngữ cảnh trước, dàn ý, source hash, model và phiên bản prompt; các mục không đổi dùng lại, sửa ngữ cảnh kiểm tra lại. Vẫn đối chiếu bản AI tự sửa trước khi xác nhận đạt.
- Nghe thử mới do Backend nhận và xử lý riêng, không chiếm hàng đợi worker sách. Migration 008 lưu trạng thái/cache/lease trong PostgreSQL; file trên R2/local, tối đa 30 giây, TTL 7 ngày và tối đa 5 cache hoàn tất còn hiệu lực mỗi job. Một preview mới cùng lúc, dedup theo nội dung/cấu hình/giọng/provider/model, scratch và tên file riêng từng lần thử; hủy/đổi revision kiểm tra lại, lease hết hạn cho thử lại, worker dọn cache khi rảnh hoặc khi xóa yêu cầu. Preview cũ đã xếp hàng vẫn được worker tiếp tục như trước.
- Engine ModelLock ưu tiên preview tại ranh giới đoạn, giữ một lần suy luận; không can thiệp giữa đoạn đang chạy. Không đổi phần cứng, CUDA hay kiến trúc Edge + OpenVoice/VieNeu.
- UI thêm tự duyệt sau sửa tay, mặc định tắt; có xác nhận và audit user/revision/hash/time. Worker chỉ bỏ đối chiếu khi khớp chính xác, kết quả/lịch sử ghi method=user thay vì AI verified. AI revise xóa tự duyệt; giữ kiểm tra quyền, giọng, hash kế hoạch, giới hạn dưới 1 giờ. Nghe thử có trạng thái riêng và polling, phản hồi qua popup VI/EN.
- Đã backup `keycloak/backups/app-postgres-1792865959448.dump`, áp dụng 008 và cập nhật Backend/Engine/worker/Frontend healthy. Node/Python syntax và build Frontend/Docker đạt (cảnh báo chunk PDF lớn có sẵn). Không thêm/chạy bộ test, không gọi Gemini/TTS tạo sách thật; chưa có số đo tốc độ trước/sau. Cập nhật BOOK_AUDIO, tài liệu quy trình và env mẫu.

### 25/10/2026 — Sửa lỗi VieNeu kết hợp giọng cá nhân Thanh Hòa

- Log Engine báo HTTPError ở bước tải mẫu, chưa gọi VieNeu. Đối chiếu R2 trả 404 NoSuchKey cho `samples/male_ThanhHoa.m4a`, trong khi giọng trong PostgreSQL vẫn active và job lưu đúng provider VieNeu. Nguyên nhân lần này là file mẫu thiếu, không phải lỗi kết hợp provider/clone hay Gemini.
- Tìm thấy bản gốc local `backend/public/audio/samples/male_ThanhHoa.m4a` (128.925 byte). Khôi phục có điều kiện If-None-Match lên đúng key thiếu, không ghi đè object có sẵn; giữ nguyên database, giọng và checkpoint bản tóm tắt. SHA-256 bản gốc: `763f054cce30402664036e90942ba68a401bf0809ca1f740fa0fe7a9018dc827`. Đã xác nhận Engine đọc R2 thành công HTTP 206 qua URL ký tạm, không ghi URL/khóa vào log.
- Phân loại lỗi tải mẫu: không tồn tại, không có quyền, lỗi mạng, quá 50 MB, thiếu file local. Thiếu mẫu/quyền không retry 3 lần vô ích; thông báo riêng đi qua worker và luồng nghe thử. VieNeu client giữ lỗi dịch vụ/version/auth riêng, không bị gộp thành lỗi Edge/OpenVoice; bổ sung bản dịch tiếng Anh.
- Đã kiểm tra cú pháp Python/Node, build image và cập nhật Backend/Engine/worker/Frontend healthy. Không thêm/chạy test suite, không tự bấm retry job hay gọi Gemini/TTS sinh audio; mới xác nhận phần tải file mẫu từ Engine. Không thay model/GPU hoặc xóa file/lịch sử khác.

### 25/10/2026 — Hồ sơ cá nhân, phân hạng giọng và popup thư viện

- Thêm `/profile` cho user/admin, mở từ menu hoặc avatar. PATCH `/api/auth/me` chỉ cho đổi fullName/gender, kiểm tra profile_version; đồng bộ Keycloak rồi PostgreSQL trong khóa row, tăng authSyncVersion để chống resolver/role update cũ ghi đè. Kiểm tra cấu hình User Profile của realm xác nhận firstName/gender có quyền và bộ kiểm tra phù hợp. Email/mật khẩu/phiên đăng nhập được quản lý qua account console; không tự đổi role/status/gói tài khoản trong API hồ sơ.
- Migration 009 thêm `voices.class` (free/gold/diamond), description, `users.account_class` mặc định free và profile_version. Giọng cũ giữ nguyên, class mặc định free. Admin sửa tên/giới tính/mô tả/class của giọng chung; người dùng sửa tên/giới tính/mô tả của giọng riêng. Class Gold/Diamond và account_class là metadata chuẩn bị, chưa có thu phí, nâng cấp hay khóa giọng theo gói; user không tự nâng class.
- Thống nhất voice_access: giọng admin upload là global, mọi người chọn được, chỉ admin sửa/ẩn; giọng user upload chỉ owner thấy/sử dụng/sửa/ẩn, admin khác cũng không xem hoặc sử dụng. Quyền áp dụng trên list/update/delete/preview, chọn giọng sách, tạo bài giảng hiện tại/legacy, nghe thử và worker, không chỉ ẩn nút. Không cho body đổi user_id/is_global/file_path. Xóa vẫn là soft delete, không xóa R2.
- Thêm popup VoicePicker theo theme sáng/tối: tên giọng không nối giới tính/phạm vi, avatar chữ, tìm kiếm, tab tất cả/giọng của tôi, lọc class, nghe mẫu/chọn, nút sửa/ẩn theo can_edit. Áp dụng ở sách và bài giảng. Thêm `/voices` để user thêm/quản lý giọng riêng; admin có class/mô tả ở form tạo và sửa, bấm tên mở thư viện nghe mẫu. Có bản dịch tiếng Anh.
- Nghe mẫu bản upload qua GET `/api/voices/:id/preview` có xác thực/ownership, proxy stream R2 hoặc đọc local, dừng phát sau 30 giây. Đã chặn cả đường dẫn static samples mã hóa/canonical để không lộ mẫu private. Preset Edge/VieNeu dùng câu mẫu cố định, sinh khi người dùng bấm lần đầu, cache MP3 theo provider/model/voice, khóa lease giới hạn CPU; không gọi Gemini hoặc tạo lịch sử. Object URL/audio bị hủy khi đóng popup/đổi giọng.
- Sao lưu `keycloak/backups/app-postgres-1792871581767.dump`, áp dụng migration 009, build Frontend 411 modules và Backend, cập nhật Backend/worker/Frontend healthy. Node syntax/build đạt; không thêm/chạy test suite, không sửa thử hồ sơ thật hay tạo giọng/sách thật. Còn cần kiểm tra tương tác với tài khoản thật, đồng bộ hồ sơ, nghe mẫu từng provider, phân quyền hai user/admin và giao diện mobile khi được yêu cầu.

### 25/10/2026 — Thống nhất bộ chọn giọng hệ thống/giọng của bạn

- Bỏ ô Loại giọng đọc ở trang sách. Một catalogue theo bộ tạo giọng đang chọn gồm preset model + giọng admin upload trong Giọng hệ thống; giọng user upload nằm trong Giọng của bạn. Nguồn hiển thị tách khỏi mode nội bộ: preset chạy standard, mọi bản ghi mẫu chạy clone kể cả mẫu admin thuộc hệ thống. API giữ standard/clone cũ để tương thích, thêm voices hợp nhất với origin/voice_mode/choice_id.
- VoicePicker chung cho sách/bài giảng có 2 tab hệ thống/của bạn, nút Thêm giọng mới luôn hiện cho tài khoản đăng nhập, kể cả tab chưa có mẫu riêng. Thêm thành công chuyển sang nhóm chứa giọng mới và tải lại; helper thêm giọng của bài giảng cũng dùng một modal này. Bỏ form upload legacy trùng, đổi tên menu/trang Giọng của bạn.
- Dùng choice_id riêng cho preset và sample để tránh trùng mã giữa giọng model và giọng upload. Payload vẫn gửi voice_id thật + mode tự suy từ lựa chọn; không yêu cầu người dùng chọn loại xử lý. Bài giảng hỗ trợ cả preset và mẫu upload qua hai provider; giữ mặc định clone cho client cũ. Job/checkpoint cũ không đổi giọng, pipeline Edge/OpenVoice/VieNeu giữ if/else.
- Thêm origin vào snapshot và metadata lịch sử mới; nhãn kết quả không gọi nhầm giọng admin là giọng cá nhân. Chuẩn hóa font popup Teleport theo app và giới hạn cuộn trong danh sách, tránh hai thanh cuộn ở ảnh; giữ nghe mẫu, tìm kiếm, class, quyền chỉnh sửa/ẩn, light/dark và VI/EN.
- Node syntax và Frontend/Docker build 411 modules đạt; đã cập nhật Backend/worker/Frontend và chờ healthy. Không thêm/chạy test suite hoặc sinh âm thanh thử. Không cần migration mới; schema 009 và dữ liệu giọng giữ nguyên. Cần kiểm tra tương tác upload → chọn → tạo ở từng nhóm/provider và trường hợp trùng mã khi được yêu cầu.

### 25/10/2026 — Trả quyền sở hữu giọng Thanh Hòa

- Người dùng xác nhận giọng `male_ThanhHoa` do `phat@gmail.com` tải lên. Kiểm tra PostgreSQL thấy bản ghi đang gán cho admin và `is_global=true`; script seed cũ cũng khai báo giọng này là mẫu chung, xóa toàn bộ metadata rồi gán lại cho admin. Không có nhật ký đủ để xác định lần chạy lịch sử gây ra việc gán sai.
- Sau backup `keycloak/backups/app-postgres-1792873590910.dump`, sửa đúng một bản ghi trong transaction có điều kiện: owner về `phat@gmail.com`, `is_global=false`. Giữ ID, đường dẫn R2, âm thanh và lịch sử; không chạy lại seed/migration hoặc ghi lại checkpoint cũ. Hai job tham chiếu giọng này đều của phat (completed/cancelled), không có job đang chạy liên quan lúc sửa.
- Seed chỉ còn hai mẫu chuẩn male/female, chỉ thêm khi thiếu; bản ghi đã có (kể cả đã ẩn) không đổi. Bỏ thao tác xóa toàn bộ giọng, dùng khóa transaction cho seed đồng thời và key R2 mới riêng biệt khi cần thêm mẫu. Giọng cá nhân không nằm trong danh sách seed.
- Kiểm tra cú pháp script và quyền truy cập dữ liệu thực; không chạy seed hay bộ test. Sửa metadata có hiệu lực ngay, giao diện cần tải lại danh sách giọng.

### 25/10/2026 — Thu gọn popup thư viện giọng theo mẫu tham khảo

- Giảm chiều cao tiêu đề, thanh tab, bộ lọc và thẻ giọng; tìm kiếm dùng hết chiều rộng thay vì giới hạn 350px. Bỏ dòng thương hiệu phụ, thêm icon và số lượng giọng ở hai tab hệ thống/của bạn.
- Thẻ dùng avatar chữ tròn, tên/mô tả tối đa hai dòng, nhãn phân hạng cùng hàng với nút nghe tròn và nút chọn dạng pill. Dấu chọn và viền accent phân biệt giọng hiện tại; giữ tooltip tên đầy đủ, nhãn truy cập bàn phím và trạng thái đang chuẩn bị/phát mẫu.
- Grid căn hàng theo nội dung, không kéo giãn thẻ khi ít giọng; 3/2/1 cột theo màn hình, chỉ vùng danh sách cuộn. Giữ tìm/lọc, thêm/sửa/ẩn, nghe mẫu, phân quyền và dữ liệu; màu dùng token light/dark hiện có.
- Frontend Docker build đạt (411 modules), đã cập nhật riêng frontend và container healthy. Không chạy bộ test. Chưa xác nhận bằng ảnh trong trình duyệt: trang thật yêu cầu đăng nhập, bản xem tạm ở cổng 5174 bị timeout; đã dừng và xóa bản xem tạm.

### 25/10/2026 — Tải sách Markdown (.md)

- Trang Sách nói AI nhận thêm `.md` trong bộ chọn file và đọc bằng `File.text()` như TXT, giữ nguyên cấu trúc Markdown làm nguồn cho Gemini; không render HTML hoặc tải tài nguyên được liên kết trong tài liệu.
- Cập nhật nhãn định dạng, lỗi định dạng tiếng Việt/Anh và tài liệu quy trình. Giữ kiểm tra 30 MB, 500–1.000.000 ký tự, lấy tên sách từ tên file và giữ nội dung cũ khi đọc lỗi.
- Frontend Docker build đạt (411 modules), cập nhật riêng frontend healthy. Không thay API/database/Engine, không chạy bộ test hoặc tạo sách thử bằng Gemini.

### 25/10/2026 — Tải bản tóm tắt MD/TXT

- Thêm `SummaryDownload.vue`, dùng chung cho bản duyệt, kết quả sách nói và lịch sử sách nói. Chọn Markdown mặc định hoặc TXT UTF-8 BOM; tên file theo tên sách, lọc ký tự đường dẫn và giữ dấu tiếng Việt.
- Bản duyệt lấy snapshot từ các ô đang sửa (kể cả chưa lưu), lời giới thiệu và tiêu đề mục; có chú thích rõ. Kết quả/lịch sử lấy nguyên nội dung tóm tắt đã lưu. Kèm nhãn AI, tác giả/nguồn, không đưa nội dung sách gốc vào file xuất.
- Xuất bằng Blob/download ngay trên trình duyệt; không thay dữ liệu, không gọi Gemini/Engine. Có popup thành công/lỗi và dịch tiếng Anh; giải phóng URL tạm sau tải.
- Frontend Docker build đạt, cập nhật riêng frontend healthy. Không chạy bộ test hoặc tạo sách mới; thao tác tải thật sau đăng nhập chưa kiểm tra.

### 25/10/2026 — Khắc phục lệch lớn giữa phút mục tiêu và độ dài bản tóm tắt

- Chẩn đoán từ mã và số liệu job thật: review-v1 bỏ qua calibration của luồng legacy, cố định 300 đơn vị/phút; editorialScript chỉ nhắc độ dài trong prompt, không đếm/chỉnh; cờ insufficient_source bị bỏ qua và đối chiếu có thể rút ngắn mà không kiểm tra lại tổng độ dài. Các nguồn 1.024 ký tự cũng bị cap 55% đơn vị nguồn nên không thể mặc nhiên đạt nhiều phút. Chưa tìm thấy bản đúng 5 phút/81 giây trong 8 job gần nhất; có job mục tiêu 5 phút, dự kiến 151 giây, thực tế 209,736 giây.
- Thêm book_duration.service: đo mẫu thật ở 1x đúng provider/model/mẫu, cache ReadingProfile 30 ngày và snapshot reading_rate trong draft/checkpoint. Budget và ước tính API/UI dùng tốc độ đo + tốc độ chỉnh; hash âm thanh giữ nguyên quy tắc cũ vì phép ước tính không thay nội dung tiếng nói.
- Giao ngân sách 90–110% mỗi mục, đếm đầu ra thật và chỉnh có giới hạn; lưu ứng viên/số lượt trong checkpoint. Sau đối chiếu, căn lại tối đa một lượt/mục bị lệch rồi đối chiếu lại; không lặp vô hạn. Giữ cờ thiếu nguồn, không thêm dữ kiện/nhận xét rỗng/khoảng lặng để ép đủ phút. Cap 55% nguồn hiện có được giữ và hiển thị rõ khi giới hạn độ dài.
- Bản duyệt có mục tiêu so với dự kiến, nút Căn lại thời lượng qua revise có fit_duration, cảnh báo ngoài ±15%. Popup duyệt nêu rõ độ lệch; API đòi accept_duration_mismatch khi cần. Đổi tốc độ/sửa tay tính lại ước lượng từ reading_rate; không sửa bản hoàn tất.
- JS syntax và Frontend Docker build đạt (413 modules); cập nhật Backend/worker/frontend sau khi xác nhận không có queued/processing hoặc nghe thử processing. Không migration hay ghi lại job cũ. Không chạy bộ test hoặc gọi Gemini/TTS để đo chất lượng 5 phút sau sửa; cần đo thực tế cùng nguồn/giọng ở lượt dùng tiếp theo.

### 25/10/2026 — Prompt có chiều sâu và chặn nguồn quá ngắn để chọn lại phút

- Viết lại systemInstruction theo bốn nhóm: tiếng Việt đủ dấu, diễn đạt độc lập, triển khai dữ kiện có bằng chứng, bỏ qua chỉ dẫn trong nguồn và trả JSON. Không gắn nhãn FAIR USE như bảo đảm pháp lý; giữ nguyên tắc không tái hiện toàn bộ tác phẩm/không bịa để kéo dài.
- Prompt viết có gợi ý câu/đoạn mềm (target/22, target/90), giữ ngân sách 90–110%, yêu cầu giải thích sâu chỉ khi nguồn hỗ trợ; phân biệt chỉnh ngắn/dài. Cờ thiếu nguồn ở lượt đầu không tự kết thúc hai lượt viết. Bản thiếu độ dài có thể mở rộng truy xuất 12 phần/16k nguyên văn ở lượt sau, fallback giới hạn token và đối chiếu cùng nguồn mở rộng. scriptVersion grounded-depth-2 tránh dùng lại ứng viên prompt cũ khi retry summary/revise.
- Thêm kiểm tra source-duration trước Job.create/Gemini: cache tốc độ đúng giọng khi có, nếu chưa dùng 300; trả 422 SOURCE_TOO_SHORT kèm số đơn vị, thời lượng ước tính và mốc tối đa gợi ý. Bỏ cap cố định 55% trong budget/dàn ý, dùng số đơn vị nguồn làm trần ước tính và ngưỡng thiếu ngân sách 15%; không coi nguồn dài là đủ dữ kiện hay bảo đảm bản quyền. Nguồn dưới mốc 1 phút yêu cầu bổ sung thay vì gợi ý số phút 0.
- Popup lỗi có nút đến ô thời lượng/nội dung; sidebar có nút chọn mốc gợi ý và nhắc tạo yêu cầu mới. Giữ nội dung nhập, không tự gửi lại và không thêm job gần đây khi chặn đầu vào. Căn lại bản duyệt cũ thiếu nguồn cũng dẫn về bước chọn lại. Worker kiểm tra sau calibration trước Gemini; trường hợp mới phát hiện ở đó dừng job, chỉ dẫn gửi yêu cầu mới, không cho retry cùng lỗi vô hạn.
- reading key dùng mảng giá trị cố định (measured-duration-2), tránh lệch cache do JSONB đổi thứ tự thuộc tính. API nạp source/checkpoint ẩn ở phía server khi cần kiểm tra/căn lại, vẫn xóa khỏi phản hồi; chỉ trả số liệu lỗi cần thiết. Worker nhận đúng thông báo nguồn ngắn thay vì bị gom nhầm lỗi Keycloak.
- JS syntax và Docker build Backend/Frontend đạt; áp dụng Backend/worker/frontend khi không có job/preview đang xử lý. Không migration, không sửa/xóa job hoặc âm thanh cũ; không chạy bộ test hay gọi Gemini/TTS để đánh giá prompt mới.

### 25/10/2026 — Bốn câu dẫn mở đầu nội dung sách nói

- Thêm bốn câu dẫn được viết sẵn sau phần giới thiệu nguồn/tên sách/tác giả và trước nội dung chính. Dùng câu trung tính cho cả truyện lẫn sách kiến thức; không gọi thêm Gemini.
- Chọn luân phiên theo tài khoản trong bước admission đã khóa theo owner. Giữ index trong checkpoint khi tạo yêu cầu và trong draft khi có bản duyệt; đọc index gần nhất bằng query chỉ lấy hai trường JSON nhỏ, tránh tải toàn bộ nguồn. Yêu cầu bị chặn không làm tăng vòng chọn; request_id trùng dùng lại yêu cầu/câu dẫn cũ.
- introduction được chụp cùng bản nháp; giữ nguyên khi nghe thử/tạo âm thanh/revise/retry. Bản nháp và file cũ không tự đổi lời mở. Thời lượng kiểm tra đầu vào/budget tính cả câu dẫn, và nội dung tải MD/TXT/lịch sử tự chứa phần này khi có trong bản tóm tắt mới.
- JS syntax và Docker Backend build đạt, cập nhật Backend/worker khi hàng đợi trống. Không migration hoặc sửa dữ liệu cũ; không chạy bộ test hay tạo/nghe audio thật trong phiên này.

### 25/10/2026 — Tùy chọn biểu cảm VieNeu có thể bật/tắt

- Thêm **Biểu cảm thử nghiệm** trong bản duyệt sách VieNeu, mặc định tắt; ba nút chèn `[cười]`, `[thở dài]`, `[hắng giọng]` tại con trỏ của mục đang chọn. Tối đa 20 thẻ, có nút gỡ hết. Không tự chèn qua Gemini, giữ nhánh Edge + OpenVoice.
- Cấu hình lưu trong JSON speech theo revision. Khi tắt, thẻ còn trong markup nhưng không được đọc; bật lại dùng các vị trí cũ. Thẻ tách khỏi nội dung đối chiếu, từ điển, ngân sách từ, bản tải và SRT. Cache phân biệt cấu hình/vị trí mới, giữ hash cũ khi không dùng tùy chọn.
- Engine và VieNeu service kiểm tra cờ bật/thẻ cho phép; không cho gửi cờ VieNeu sang Edge. Chia đoạn và nghe thử giữ nguyên thẻ nhiều từ. Ước lượng cộng tạm 1 giây/thẻ; phụ đề trong mỗi đoạn vẫn phân bố theo thời lượng, chưa căn từng tiếng biểu cảm.
- Đã kiểm tra cú pháp Python và smoke logic kế hoạch (bật/tắt, provider, cache, chia thẻ, phụ đề sạch), không thêm/chạy bộ test. Build Backend/Frontend/Engine/VieNeu đạt, cập nhật container khi hàng đợi trống và các dịch vụ healthy. Tạo bốn mẫu CPU ngắn (thường/cười/thở dài/hắng giọng), không gọi Gemini/ghi job/upload R2; kiểm tra private Engine từ chối cờ trên Edge, thẻ chưa bật và token thô. Chưa đánh giá bằng nghe hoặc qua UI với sách thật. Hướng dẫn tại VIENEU.md và QUY_TRINH_TAO_SACH_NOI.md.
- Build VieNeu ban đầu phải tải lại dependency do base Engine thay đổi; dừng lượt tải chậm, build từ image SDK 3.8.3 đã có bằng build arg tùy chọn, không nâng cấp dependency. Build sạch vẫn dùng base mặc định; sửa cache pip trỏ đúng thư mục build.

### 25/10/2026 — Tách màn hình gửi sách và duyệt, tạm ẩn biểu cảm

- Sau khi bấm Tạo bản tóm tắt với đầu vào hợp lệ, chuyển sang màn hình theo dõi/duyệt/nghe thử: ẩn toàn bộ upload, metadata nguồn, thời lượng, bộ tạo giọng và bộ chọn giọng. Hiển thị cấu hình đã gửi dưới dạng thông tin ngắn; ở trạng thái chờ duyệt chỉ còn slider tốc độ ở sidebar, ẩn các tùy chọn đọc nâng cao. Khi đang gửi/chờ xử lý chưa cho sửa tốc độ; lỗi admission trả về form để sửa đầu vào.
- Thêm Tạo tóm tắt mới: xóa đầu vào cục bộ, về 10 phút/1,00x và chọn giọng lại, không hủy/xóa yêu cầu trước. Hỏi bỏ chỉnh sửa chỉ khi nháp có thay đổi chưa lưu. Poll không tự chọn lại job khi đang ở form mới; tăng selectionVersion để bỏ phản hồi chi tiết cũ, khóa chuyển màn hình lúc đang gửi/lưu. Vẫn mở lại job từ Yêu cầu gần đây.
- Nguồn quá ngắn khi worker/duyệt kiểm tra có đường chuyển sang form mới, gợi ý phút phù hợp; không gọi focus vào input đã ẩn. Khu vực duyệt vẫn có sửa nội dung tay/AI, tải bản tóm tắt, nghe thử, duyệt tạo âm thanh và hủy/xóa.
- Tạm ẩn nút biểu cảm theo phản hồi nghe chưa tự nhiên. Nháp cũ mở qua giao diện giản lược sẽ tắt experimental_cues trước lần lưu/nghe thử/duyệt tiếp theo; giữ vị trí thẻ trong markup nhưng không đọc chúng, không sửa file âm thanh đã tạo. Giữ mã SDK/nhánh TTS để có thể mở lại sau.
- Docker Frontend build đạt và container Frontend đã cập nhật healthy, không khởi động lại Backend/worker/Engine, không sửa database hoặc gọi Gemini/TTS. Không chạy bộ test hay luồng sách thật. Computer Use dừng kiểm tra trực tiếp vì không xác định được URL trình duyệt Windows đủ chắc chắn; chưa xác nhận hiển thị/thao tác hai màn bằng browser trong phiên này.

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
- [x] Popup chung sáng/tối, Việt/Anh; phản hồi thao tác, xác nhận hủy/xóa, chào đăng nhập/chúc đăng ký dựa trên xác thực thành công.
- [ ] Khi có yêu cầu kiểm thử: thao tác popup bằng chuột/bàn phím, mobile/dark mode, lỗi lặp, đăng ký/đăng nhập/logout thật, đóng/rời trang có chỉnh sửa.
- [x] Build frontend; xem trang quản trị với dữ liệu thật và bản xem trước ba trang người dùng.
- [ ] Rà soát tương tác bằng phiên user thật: tải TXT/DOCX/PDF, thêm giọng riêng, tạo âm thanh/sách nói và nghe lại lịch sử.
- [ ] Chạy lại kiểm thử auth/phân quyền và thao tác quản trị trong môi trường kiểm tra sau thay đổi frontend.
- [ ] Cân nhắc tối ưu chunk PDF lớn trước deploy.

**Phase 4:**
- [x] 1a: Build image Backend/worker và cấu hình kết nối container; image local `text2speech-backend:phase4.1`, đã bật ở mục 1c.
- [x] 1b: Build image Engine CPU, FFmpeg, OpenVoice và cấu hình weights/cache; tag text2speech-engine:phase4.1, đã nạp model/bật ở mục 1c.
- [x] 1c: Frontend và Compose local, mạng nội bộ, volume âm thanh dùng chung, tái sử dụng PostgreSQL/Keycloak hiện có; 7 service healthy, chưa kiểm thử toàn luồng.
- [ ] Chốt nơi deploy, tài nguyên, HTTPS/domain, Keycloak/PostgreSQL production và SMTP thật.
- [ ] Thử phục hồi PostgreSQL và chuyển database giữ đúng ID đã liên kết; sao lưu riêng ngoài máy phát triển.

**Chuyển database ứng dụng sang PostgreSQL:**
- [x] Tạo database/role riêng, schema quan hệ và chuyển toàn bộ truy cập runtime khỏi Mongoose.
- [x] Backup MongoDB nguồn thật, nhập PostgreSQL trong transaction, đối chiếu nội dung và tạo backup đích.
- [x] Giữ ID/mapping Keycloak/R2, cập nhật worker claim/checkpoint/cache và khởi động Backend/worker.
- [ ] Khi có yêu cầu kiểm thử: chuyển suite auth sang PostgreSQL cô lập, chạy lại đăng nhập/đăng ký/admin/ownership cùng các lỗi đồng bộ.
- [ ] Khi có yêu cầu kiểm thử: tạo bài giảng/sách nói thật, kiểm tra retry/restart và phục hồi backup PostgreSQL trên database riêng.

**Sách nói 1–59 phút — đã triển khai mã, còn kiểm thử thực tế:**
- [ ] Khi được yêu cầu kiểm thử: hai màn gửi sách/duyệt trên desktop và mobile, tạo mới khi có nháp chưa lưu, poll không tự mở job cũ, chuyển recent khi có phản hồi chậm, lỗi nguồn quá ngắn, slider đúng revision và nháp cũ bật biểu cảm đã tạm tắt.
- [ ] Khi được yêu cầu kiểm thử: nguồn quá ngắn 1/5/30 phút, mốc gợi ý null/1–59, thay tốc độ/giọng sau lỗi, cache đo có/không, worker phát hiện sau đo, không tạo recent khi 422, căn lại nháp cũ, source/checkpoint không lộ, truy xuất mở rộng/fallback và chất lượng prompt trên cùng sách thật.
- [ ] Khi được yêu cầu kiểm thử: đo cùng nguồn/giọng ở 2/5/10 phút sau bản sửa duration; cache tốc độ theo provider/mẫu, retry giữa viết/căn/đối chiếu, nguồn ngắn, đổi tốc độ, popup chấp nhận lệch và thời lượng âm thanh thực tế.
- [x] Hồ sơ cá nhân đồng bộ Keycloak, popup chọn/nghe mẫu giọng, class Free/Gold/Diamond và quyền owner-only cho giọng riêng; migration 009 đã áp dụng local.
- [ ] Khi được yêu cầu kiểm thử: hai user/admin khác nhau với giọng private/global; gọi thẳng API sửa/xóa/nghe/tạo; đường dẫn samples mã hóa; sửa hồ sơ ở hai tab/Keycloak và role sync đồng thời; cache preset, đóng popup khi chờ, R2 thiếu file, light/dark/VI/EN/mobile. Gói Gold/Diamond chưa triển khai nghiệp vụ.
- [x] Giảm countTokens, nghe thử riêng có cache, phân tích + dàn ý thích ứng, gom/cache đối chiếu và tự duyệt sau sửa tay; migration 008 và container mới đã áp dụng local.
- [ ] Khi được yêu cầu kiểm thử: đo từng bước cùng nguồn trước/sau; thử cache nghe thử trùng/đổi tốc độ/giọng, restart/lease, hủy/xóa, hai tab, đối chiếu cache sau sửa mục/ngữ cảnh, fallback JSON/token/timeout và tự duyệt đúng revision. Chưa hứa mức tăng tốc.
- [x] Tải trước Edge-TTS cửa sổ 3 đoạn, khóa OpenVoice riêng, cache nền, hủy phiên và đồng bộ cleanup; giữ nhánh VieNeu.
- [ ] Khi có yêu cầu kiểm thử: đo cùng đầu vào với cửa sổ 1/3, kiểm tra giới hạn đồng thời, cache/restart, thứ tự/SRT, hủy trong tải/clone, lỗi mạng/403 và phục hồi R2.
- [x] Chèn nghỉ, phong cách chung/mục/đoạn, chuẩn hóa cách đọc và từ điển, bản xem có hash, nghe thử và SRT cho bài giảng/sách nói.
- [ ] Khi được yêu cầu kiểm thử: nghe trước/sau phong cách/ngắt nghỉ, kiểm tra từ điển/số/ngày/đơn vị, quyền tải SRT, đồng bộ timeline và retry/phiên bản cũ.
- [x] Sửa 8 tiêu đề không dấu của bản nháp hiện tại sau backup; thêm kiểm tra riêng tiêu đề ngắn và bước AI viết lại tiêu đề khi cần.
- [ ] Khi có yêu cầu kiểm thử: tiêu đề ngắn không dấu/có dấu/tên ngoại ngữ, retry dàn ý đã lưu và giữ nội dung bản nháp khi chỉ chỉnh tiêu đề.
- [x] Hủy và xóa khỏi yêu cầu gần đây, chặn tiếp tục và dọn file tạm theo job; migration 006 đã áp dụng sau backup.
- [ ] Khi được yêu cầu kiểm thử: hủy queued/chờ Gemini/processing/review, xóa failed/cancelled, hai tab, gửi lại trùng ID, restart worker và đối chiếu cleanup R2/local.
- [x] Điều tiết Gemini, chờ tăng dần có giờ hẹn lưu PostgreSQL, phân loại lỗi và dừng quota ngày; migration 005 và image mới đã áp dụng local sau backup.
- [ ] Khi được yêu cầu kiểm thử: phân loại 429 ngày/phút, RetryInfo, 503/504/mạng, ngân sách, hủy trong lúc chờ, restart và phục hồi lịch retry; quan sát quota thật trên AI Studio.
- [x] Luồng mới có dữ kiện cấu trúc, truy xuất nguyên bản và đối chiếu AI, bản nháp duyệt/sửa tay/AI, nghe thử và nhịp nghỉ theo đoạn; giữ job cũ.
- [x] Áp dụng migration 004 và image/container mới sau khi Docker Desktop chạy; đã backup trước migration ngày 22/10/2026 và các service runtime healthy.
- [ ] Khi được yêu cầu kiểm thử: đối chiếu sách thật, nghe so sánh trước/sau, thử lưu xung đột hai tab, AI chỉnh, duyệt đúng phiên bản, preview/retry/restart và quyền truy cập.
- [x] Thêm lựa chọn thời lượng và đo tốc độ đọc để tính ngân sách kịch bản.
- [x] Thêm nhập số phút nguyên 1–59, xác thực xuyên suốt UI/API/worker/PostgreSQL và chặn file kết quả đạt 1 giờ.
- [x] Phân tích sách theo phần, lập dàn ý chung và viết kịch bản có giới hạn token.
- [x] Công việc nền có chủ sở hữu, tiến độ, điểm lưu và retry phần lỗi.
- [x] Tạo TTS/clone theo đoạn, ghép bằng FFmpeg và đo thời lượng kết quả.
- [x] Rà soát giới hạn payload, phạm vi đọc PDF và tài nguyên Engine cho nội dung dài.
- [x] Bổ sung hướng dẫn AI diễn đạt riêng, tránh nguyên văn/tái hiện chi tiết; ghi thông tin nguồn và nhãn AI ở job/kết quả/lịch sử/lời mở đầu âm thanh.
- [ ] Tạo/nghe sách thật ở 3 mốc thời lượng và 2 loại giọng; đối chiếu nguồn, độ dài, nhịp ghép và thời gian xử lý.
- [ ] Kiểm thử refresh/restart, mất kết nối, hủy/retry, phân quyền job, idempotency và phục hồi đoạn R2 khi được yêu cầu.
- [ ] Chốt chính sách lưu/xóa job lỗi và phương án vận chuyển file khi deploy Engine/worker khác máy.

**Phase 5 / ưu tiên trung:**
- [x] Working tree đã xóa 5 file service rỗng, module Lecture và bỏ mount route trong backend (chưa chạy lại toàn bộ ứng dụng trong phiên Phase 2).
- [x] Truyền gender của giọng mẫu sang Engine một cách tường minh (Backend bài giảng và worker sách nói).

**Ưu tiên thấp (chỉnh tề):**
- [x] Đã tách CSS chung; phiên làm mới giao diện thay `common.css` bằng `frontend/src/assets/workspace.css`.
- [ ] Cân nhắc kiểm tra sâu nội dung/tỷ lệ audio upload; hiện đã giới hạn dung lượng 50 MB và lọc phần mở rộng, nhưng chưa xác minh nội dung thực của file.

---

## 6. Ghi Chú Vận Hành (cần nhớ khi chạy dự án)

- Chế độ Docker đã chuẩn bị trên máy: mở **Docker Desktop**, từ repo root chạy **`.\deploy\stack.ps1 up`**, mở http://localhost:5173. Stack có sẵn Backend/Frontend/Engine/worker/PostgreSQL/Keycloak/Mailpit; không chạy thêm terminal ứng dụng. Dùng status/logs/stop, xem PHASE4.md. Chế độ terminal cũ vẫn dùng được sau khi dừng bốn service Docker ứng dụng để tránh trùng cổng/worker; khi đó Backend 3000, Frontend 5173, Engine 8000 và npm run worker:books chạy riêng.
  Hướng dẫn chi tiết trong `README.md`, `keycloak/PHASE3.md` và `engine/README.md`.
- Admin ứng dụng được quản lý qua Keycloak/AdminPanel; create_admin.js đã bỏ. Từ thư mục backend, `node seed_voices.js` chỉ bổ sung mẫu chuẩn male/female còn thiếu; giữ nguyên giọng hiện có, chủ sở hữu, trạng thái và file. Không dùng seed để chuyển quyền sở hữu giọng cá nhân.
- Engine lần đầu chạy phải tải weights (~260MB); cần FFmpeg trong `engine/venv/Scripts/`.
- Stack local: từ repo root chạy `docker compose --env-file keycloak/.env -f keycloak/compose.yaml up -d --wait postgres mailpit keycloak`; Admin Console `http://localhost:8080/admin/`, Mailpit `http://localhost:8025`. MongoDB migration profile chỉ phục vụ công cụ lịch sử, không cần cho runtime. Secrets nằm trong `keycloak/.env`. Không dùng `down -v` nếu cần giữ dữ liệu.
- PostgreSQL ứng dụng: xem `POSTGRES_MIGRATION.md`. Backend/worker đọc `backend/.env.postgres.local` (`tts_app`, cổng Windows 5433); Keycloak dùng database riêng. Dữ liệu đã nhập, không cần nhập lại mỗi lần bật máy. `npm run db:status` xem trạng thái; `npm run backup:postgres` tạo backup ứng dụng. Không xóa file cấu hình private hoặc volume.
- Runtime Phase 3: xem `keycloak/PHASE3.md`; backend đọc service account từ `backend/.env.keycloak.local`. Mở frontend http://localhost:5173 để đăng nhập realm tts-local bằng mật khẩu Keycloak.
- Theme xác thực: xem `keycloak/THEME.md`; source nằm trong `keycloak/themes/text2speech/login/`. Áp dụng vào realm local đã có bằng `node backend/scripts/configure_keycloak_theme.js`.
- Khi sửa frontend, dùng đúng đường dẫn `views/user/` và `views/admin/`; khung điều hướng nằm ở `layouts/AppShell.vue`, CSS chung ở `assets/workspace.css`. Các script xem trước tạm không thuộc luồng vận hành ứng dụng.
- Backend/worker truyền gender metadata sang Engine: male dùng `vi-VN-NamMinhNeural`, female dùng `vi-VN-HoaiMyNeural`. Chỉ lệnh gọi pipeline legacy không truyền gender mới giữ fallback đoán tên file để tương thích.
- Phong cách đọc legacy: `news` = +12%, `story` = −8%, `normal` = mặc định. Cấu hình `speech-v1` có năm preset nhịp/khoảng nghỉ định sẵn, xem BOOK_AUDIO.md; không có thanh tốc độ/cao độ riêng.
- Bật R2 bằng cách điền `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` trong `backend/.env`; để trống các khóa thì dùng local.
