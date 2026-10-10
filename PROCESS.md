# PROCESS — Nhật Ký Tiến Độ Dự Án

> **Cách dùng file này:** Đọc từ đầu đến cuối để nắm toàn bộ bối cảnh và tiến độ hiện tại.
> Mỗi lần làm việc mới trên dự án, cập nhật thêm mục [4. Nhật ký làm việc](#4-nhật-ký-làm-việc)
> và [5. Việc tiếp theo](#5-việc-tiếp-theo--todo).
>
> **Cập nhật lần cuối:** 03/10/2026

---

## 1. Tổng Quan Dự Án

**Tên:** Hệ Thống Sinh Bài Giảng Tự Động (Voice Cloning TTS) — Dự án Niên luận.

**Mục tiêu:** Chuyển văn bản thành bài giảng / sách nói dạng âm thanh tiếng Việt,
kèm nhân bản âm sắc (voice cloning) từ file ghi âm mẫu, có tài khoản người dùng
và trang quản trị.

**Kiến trúc Microservices — 3 thành phần:**

```
Frontend (Vue 3 + Vite, cổng 5173)
      │  axios + JWT (localStorage)
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
| `engine/` | FastAPI: pipeline TTS 2 bước; thư viện OpenVoice vendored tại `engine/openvoice/` |
| Cloudflare R2 (`samples/`, `generated/`) | Âm thanh dùng chung khi R2 được cấu hình; MongoDB giữ object key để Backend tạo URL truy cập mới |
| `backend/public/audio/` | Fallback local cho phát triển khi chưa cấu hình R2; audio sinh tạm được Backend chuyển lên R2 khi bật cloud |

**Tính năng hiện có:**

1. **Tạo Bài Giảng** (`/`): nhập văn bản hoặc upload .txt/.docx/.pdf → chọn giọng + phong cách
   (news/story/normal) → sinh audio, nghe ngay trên trang. User có thể tự thêm giọng mẫu riêng.
2. **Sách Nói AI** (`/book`): upload sách → Gemini tóm tắt + phân tích thể loại + tự chọn
   giọng/phong cách phù hợp → tự sinh audio từ bản tóm tắt.
3. **Lịch Sử** (`/history`): 100 bản ghi sinh audio gần nhất của user.
4. **Quản Trị** (`/admin`, chỉ admin): quản lý user (role, status), quản lý giọng mẫu global.
5. **Đăng nhập/Đăng ký** bắt buộc trước khi dùng app (màn hình Auth hiển thị khi chưa có session).

---

## 2. Trạng Thái Hiện Tại (03/10/2026)

- **Git:** nhánh `main`, remote `origin` đã cấu hình; đang có thay đổi chưa commit cho Phase 1, PROCESS.md và nút hiện/ẩn mật khẩu trong `frontend/src/components/Auth.vue`.
- **Đã hoạt động end-to-end:** luồng đăng nhập → tạo bài giảng → clone giọng → nghe kết quả → lịch sử.
- **Luồng Sách Nói AI** đã tích hợp Gemini (có retry + fallback model).
- **Engine** tự tải weights OpenVoice V2 (~260MB) từ HuggingFace lần chạy đầu;
  FFmpeg phải nằm trong `engine/venv/Scripts/`.
- `.env` đã được gitignore đúng; `backend/.env` có cấu hình MongoDB và R2. Không ghi giá trị secret vào tài liệu.

### Lộ trình triển khai

| Phase | Trạng thái | Ghi chú |
|---|---|---|
| 1. Tách lưu trữ ra R2 | **Hoàn thành** | 3/3 giọng mẫu tham chiếu key R2; 17 audio kết quả local đã upload. MongoDB lưu object key, API trả presigned URL mới để lịch sử không bị hết hạn. 7 bản ghi lịch sử thiếu audio đã được xóa theo yêu cầu. |
| 2. Dựng Keycloak | Chưa bắt đầu | Compose local, realm/clients/roles và script migrate user. |
| 3. Cắt auth cũ | Chưa bắt đầu | Thay auth frontend/backend; xóa `create_admin.js` sau khi chuyển user. |
| 4. Dockerize + deploy | Chưa bắt đầu | Backend/Engine, VPS, Vercel, HTTPS và domain. |
| 5. Dọn dẹp | Chưa bắt đầu | Lecture legacy, CSS trùng, README và PROCESS. |

---

## 3. Lịch Sử Commit (điểm mốc chính)

| Commit | Nội dung |
|---|---|
| `e5ba64d` | Initial commit |
| `ba413a5` | Remove node_modules |
| `560bb34` | Tối ưu cấu trúc, dọn model cũ, thêm .gitignore |
| `ccb3132` | Update README.md |
| `d5a4d70` | Thêm backend/.env.example |
| `6a7f21d` | **(mới nhất)** Tích hợp Gemini cho Sách Nói AI + cập nhật OpenVoice Tone Converter |

*(Commit mới sẽ được bổ sung vào bảng này.)*

---

## 4. Nhật Ký Làm Việc

### Phiên 02/10/2026 — Rà soát toàn dự án (audit)

**Đã làm:** Xem toàn bộ mã nguồn 3 thành phần, ghi nhận kiến trúc và phát hiện các vấn đề sau
(chưa sửa — xem mục 5):

1. **[Bảo mật — nghiêm trọng] Backend thiếu kiểm tra phân quyền admin:**
   `GET /api/auth/users`, `PUT /api/auth/users/:id/status`, `PUT /api/auth/users/:id/role`
   (`backend/app/routes/auth.route.js`) không có middleware kiểm tra role — chỉ frontend
   router guard chặn. User thường có token hợp lệ có thể tự cấp quyền admin bằng gọi API trực tiếp.
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

---

## 5. Việc Tiếp Theo / TODO

**Trước/song song Phase 2:**
- [ ] Bắt đầu dựng Keycloak + Postgres local, realm, hai client và roles.
- [ ] Viết script migrate tài khoản hiện có sang Keycloak.

**Ưu tiên cao (bảo mật đang tồn tại ở auth cũ):**
- [ ] Thêm middleware `adminOnly` vào 3 route quản lý user (`auth.route.js`).
- [ ] Kiểm tra ownership trong `PUT/DELETE /api/voices/:id` (chỉ chủ sở hữu hoặc admin).

**Phase 3:**
- [ ] Xóa `create_admin.js` sau khi migrate tài khoản sang Keycloak.

**Phase 5 / ưu tiên trung:**
- [ ] Dọn legacy: xóa `app/services/*.js` rỗng, cân nhắc xóa model Lecture + `/api/lectures`.
- [ ] Commit thay đổi `Auth.vue` (nút hiện/ẩn mật khẩu).
- [ ] Thống nhất: cho phép khách dùng không đăng nhập hay cập nhật README.
- [ ] Truyền gender của giọng mẫu sang Engine một cách tường minh (thay vì đoán từ tên file).

**Ưu tiên thấp (chỉnh tề):**
- [ ] Tách CSS dùng chung (App.vue / LectureCreator.vue) ra file chung hoặc global styles.
- [ ] Cân nhắc giới hạn dung lượng/tỷ lệ âm thanh upload cho giọng mẫu (hiện chưa có limit).

---

## 6. Ghi Chú Vận Hành (cần nhớ khi chạy dự án)

- Chạy 3 dịch vụ theo thứ tự: **Engine (8000) → Backend (3000) → Frontend (5173)**
  (hướng dẫn chi tiết trong `README.md` và `engine/README.md`).
- Tạo admin đầu tiên: `node create_admin.js` trong `backend/`; seed giọng mẫu: `node seed_voices.js`
  (lưu ý: seed xóa sạch giọng cũ rồi mới thêm 3 giọng mặc định).
- Engine lần đầu chạy phải tải weights (~260MB); cần FFmpeg trong `engine/venv/Scripts/`.
- Giọng đọc gốc Edge-TTS: `vi-VN-NamMinhNeural` (nếu voice_id chứa "male") / `vi-VN-HoaiMyNeural`.
- Phong cách đọc = tốc độ Edge-TTS: `news` = +12%, `story` = −8%, `normal` = mặc định.
- Bật R2 bằng cách điền `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` trong `backend/.env`; để trống các khóa thì dùng local.
- Chuyển dữ liệu hiện có bằng `cd backend && node migrate_audio_to_r2.js`. Lệnh upload audio lên R2 và cập nhật key trong MongoDB; file local được giữ lại.
