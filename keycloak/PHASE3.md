# Phase 3 — Xác thực ứng dụng bằng Keycloak local

## Cập nhật database ứng dụng 17/10/2026

Backend/worker đã được chuyển mã sang PostgreSQL database `tts_app`, tách database `keycloak`.
Chỉ bật ứng dụng sau khi nhập nguồn và ghi marker thành công; xem [POSTGRES_MIGRATION.md](../POSTGRES_MIGRATION.md).
ID cũ và thuộc tính `mongoUserId` được giữ để không đổi token/mapping. Các số liệu Phase 3 dưới đây là lịch sử.

## Trạng thái ngày 13/10/2026

Frontend/backend đã dùng Keycloak realm `tts-local`. MongoDB ứng dụng giữ hồ sơ và dữ liệu nghiệp vụ; mật khẩu do Keycloak lưu trong PostgreSQL local.

Đã liên kết 3 tài khoản nguồn (1 admin), giữ nguyên MongoDB `_id`; dọn 3 hash bcrypt và JWT_SECRET cũ sau backup. Giọng mẫu và lịch sử không bị thay đổi. Các tài khoản đã đặt mật khẩu Keycloak giữ nguyên mật khẩu đó; tài khoản còn thiếu nhận link mới trong Mailpit.

## Bật ứng dụng trên máy hiện tại

1. Mở Docker Desktop và chờ Engine chạy.
2. Từ repo root bật stack:

   ```powershell
   docker compose --env-file keycloak/.env -f keycloak/compose.yaml --profile migration up -d --wait
   ```

3. Mở terminal backend:

   ```powershell
   cd backend
   npm ci
   npm start
   ```

4. Mở terminal frontend:

   ```powershell
   cd frontend
   npm ci
   npm run dev
   ```

5. Mở http://localhost:5173, bấm **Đăng nhập** hoặc **Tạo tài khoản**.
6. Khi tạo âm thanh, chạy thêm Engine theo `engine/README.md`.

Sau mỗi lần mở máy chỉ bật services; không chạy lại migration/cleanup. Node cần phù hợp với frontend: `^22.18.0 || >=24.12.0`.

## Đăng nhập và mật khẩu

| Mục đích | Địa chỉ | Tài khoản |
|---|---|---|
| Dùng TTS | http://localhost:5173 | Email/username và mật khẩu Keycloak của realm tts-local |
| Hồ sơ Keycloak | http://localhost:8080/realms/tts-local/account/ | Cùng tài khoản dùng TTS |
| Quản trị Keycloak | http://localhost:8080/admin/ | Administrator master; mặc định local-admin, mật khẩu trong keycloak/.env |
| Thư đặt mật khẩu | http://localhost:8025 | Mailpit local |

Role `admin` của ứng dụng khác administrator `master`. Frontend tự chọn realm `tts-local`; user không nhập mật khẩu MongoDB cũ vào trang quản trị master.

Tài khoản chưa có mật khẩu: mở thư mới nhất trong Mailpit, đặt mật khẩu, quay lại web và đăng nhập. Link có thời hạn 12 giờ. Chỉ tạo lại link cho tài khoản active **chưa có password credential**:

```powershell
node backend/scripts/prepare_keycloak_account_links.js
node backend/scripts/prepare_keycloak_account_links.js --execute
```

Tài khoản đã có mật khẩu muốn đổi/quên mật khẩu: dùng trang tài khoản hoặc **Forgot Password?** trên trang đăng nhập. Mailpit giữ thư trên máy, không gửi ra email thật.

## Cấu hình

| File | Mục đích |
|---|---|
| keycloak/.env | Secrets PostgreSQL và bootstrap administrator; dùng cho Compose/công cụ cấu hình |
| backend/.env | R2, Gemini, PORT/HOST, FRONTEND_ORIGINS; MONGODB_URI chỉ cho công cụ đọc nguồn |
| backend/.env.postgres.local | DATABASE_URL ứng dụng tts_app, bị Git bỏ qua |
| backend/.env.keycloak.local | URL/realm/audience và service account backend; được script provision tạo |
| frontend/.env | VITE_API_URL, VITE_KEYCLOAK_URL, VITE_KEYCLOAK_REALM, VITE_KEYCLOAK_CLIENT_ID |

Backend ưu tiên biến môi trường của tiến trình, sau đó `.env.postgres.local`, `.env.keycloak.local`, `.env.books.local`, rồi `.env`. Frontend chỉ có cấu hình public, không có service client secret.

Service account `tts-admin-service` dùng client credentials trong realm tts-local, với `view-users`, `query-users`, `manage-users`, `view-realm`. Credentials master chỉ dùng trong công cụ provision/migration, không dùng khi backend chạy.

Nếu cần cấu hình lại backend service account/hồ sơ realm:

```powershell
node backend/scripts/configure_keycloak_phase3.js
```

Khởi động lại backend sau khi script cập nhật file cấu hình. Dùng script Phase 3 này thay cho configure_keycloak_local.js trực tiếp, để giữ cấu hình gender cho đăng ký.

## Cơ chế xác thực và dữ liệu

- Vue dùng keycloak-js, Authorization Code + PKCE S256; adapter xử lý callback trước khi khởi tạo router.
- Access/refresh token giữ trong bộ nhớ; xóa các khóa token/user cũ khỏi localStorage. Tải lại trang khôi phục đăng nhập qua SSO của Keycloak.
- Axios refresh token trước khi gọi API và gửi Authorization: Bearer.
- Backend dùng jose/JWKS, chỉ nhận RS256 access token với issuer tts-local, audience tts-backend và thời hạn hợp lệ.
- Backend kiểm tra tài khoản/role và phiên SSO còn sống qua Keycloak Admin API. Đăng xuất/revoke session khiến access token cũ bị chặn, dù exp chưa tới.
- Token liên kết qua sub ↔ keycloakId; mongoUserId phải khớp _id hồ sơ ứng dụng (giữ nguyên khi chuyển PostgreSQL). Không tự ghép tài khoản cũ theo email.
- Đăng ký mới tạo hồ sơ PostgreSQL tts_app và ghi mapping bằng service account; không lưu password vào database ứng dụng.
- GET /api/auth/me trả hồ sơ và quyền hiệu lực. Các API tạo bài giảng/tóm tắt yêu cầu đăng nhập; GET voices không có token chỉ trả giọng global, token sai bị từ chối.
- Giọng riêng, lịch sử và quyền sửa giọng tiếp tục dựa trên _id được giữ nguyên trong PostgreSQL.

## Quản trị user và xử lý lỗi đồng bộ

AdminPanel vẫn quản lý user/giọng. Khi đổi role/status:

1. Đặt cờ authSyncPending và tăng phiên bản đồng bộ trong PostgreSQL.
2. Cập nhật enabled/role/legacyStatus trên Keycloak và kiểm tra lại kết quả.
3. Thu hồi các phiên của tài khoản đích.
4. Ghi trạng thái đã xác nhận vào PostgreSQL, bỏ cờ pending.

Nếu một bước thất bại, tài khoản pending bị chặn; AdminPanel hiển thị cảnh báo. Thực hiện lại thao tác role/status để sửa đồng bộ. Nếu tiến trình bị ngắt lúc đang chạy, có thể thử lại sau 5 phút. Backend dùng kiểm tra phiên bản để tránh ghi đè cập nhật đồng thời.

Inactive/banned bị chặn ở cả Keycloak và API. Admin không tự khóa/hạ quyền tài khoản đang quản trị. Người bị đổi quyền cần đăng nhập lại để nhận token mới. Nên quản lý role/status qua AdminPanel để giữ hai hệ thống đồng bộ.

## Công cụ chuyển đổi và backup

Các bước dưới chỉ dành cho chuyển đổi có kiểm soát, không chạy mỗi lần mở máy:

```powershell
# Full snapshot BSON/EJSON: documents và indexes, bao gồm dữ liệu nhạy cảm
node backend/scripts/backup_app_mongodb.js

# Chỉ đối chiếu mapping
node backend/scripts/link_app_users_to_keycloak.js

# Ghi mapping: thay đường dẫn bằng snapshot đã tạo
node backend/scripts/link_app_users_to_keycloak.js --execute --backup keycloak/backups/app-mongodb-<timestamp>.json

# Chỉ thống kê hash cũ; chế độ execute có ghi/xóa dữ liệu
node backend/scripts/cleanup_legacy_auth.js
node backend/scripts/cleanup_legacy_auth.js --execute --backup keycloak/backups/app-mongodb-<timestamp>.json

# Backup PostgreSQL
./keycloak/backup.ps1
```

Snapshot metadata Phase 2 không thay full backup MongoDB. Công cụ cleanup xác minh hash trong backup và mapping trước khi unset password; lưu bản backend/.env trước khi bỏ JWT_SECRET.

Backup thật nằm trong keycloak/backups, được Git bỏ qua. Snapshot EJSON giữ BSON ObjectId/Date và indexes; không phải archive dùng được trực tiếp với mongorestore. Có thể xác nhận phục hồi vào database local rỗng riêng:

```powershell
node backend/scripts/check_mongodb_backup_restore.js --backup keycloak/backups/app-mongodb-<timestamp>.json
```

Công cụ phục hồi chỉ tới localhost:27018/tts_phase3_restore_checks, từ chối database đã có collection và dọn database kiểm tra sau khi xong.

Muốn rollback auth cũ: dừng app, dùng backup để phục hồi password/keycloakId của các user đã chuyển đổi, khôi phục code/dependencies và backend/.env tương ứng. Việc này có ghi đè dữ liệu, cần đối chiếu các thay đổi phát sinh sau snapshot trước khi thực hiện. Không có tự động fallback sang JWT cũ trong runtime mới.

Máy mới hoặc cloud cần phục hồi database Keycloak giữ đúng ID đã liên kết với MongoDB; realm-export.json chỉ chứa cấu hình, không thay backup tài khoản. HTTPS/hostname/SMTP thật và kế hoạch chuyển cloud thuộc Phase 4.

## Kiểm tra lại

```powershell
npm --prefix backend run test:auth
npm --prefix frontend run build
node backend/scripts/check_phase3_cutover.js --backup keycloak/backups/app-mongodb-<timestamp>.json
```

Test auth dùng database local tts_phase3_checks và tài khoản/client tạm có prefix ngẫu nhiên. Kiểm tra code + PKCE, đăng ký, mapping, admin, ownership/lịch sử, role/status, lỗi đồng bộ, token giả/cũ/hết hạn/sai issuer/audience, refresh và logout; dọn dữ liệu tạm trong finally. Không đổi mật khẩu thật, không gọi Gemini hoặc Engine để tạo audio.

Muốn giữ fixtures cho kiểm tra giao diện, chạy trong terminal tương tác:

```powershell
node backend/scripts/check_keycloak_phase3.js --serve
```

Thông tin thử nằm trong file riêng ở keycloak/backups. Nhấn ENTER để dọn sau khi xong. Nếu tiến trình giữ fixtures bị ngắt, dừng tiến trình đó và dùng cleanup_phase3_checks.js; công cụ chỉ xóa prefix được xác nhận trong database kiểm tra và realm local.
