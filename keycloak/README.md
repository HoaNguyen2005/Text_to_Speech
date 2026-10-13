# Keycloak + PostgreSQL local — Phase 2 và 3

## Trạng thái

Stack local đã chạy; realm `tts-local` có roles `user`/`admin`, client SPA `tts-frontend` (Authorization Code + PKCE S256) và client API `tts-backend` (bearer-only). Access token được cấu hình audience `tts-backend` và claim `mongoUserId`.

Ngày 10/10/2026 đã sao chép và nhập **3 tài khoản thật, gồm 1 admin**. Cả 3 đang active. Thư đặt mật khẩu được giữ trong Mailpit trên máy, không gửi ra email bên ngoài.

| Dịch vụ | Địa chỉ / dữ liệu |
|---|---|
| Keycloak Admin Console | http://localhost:8080/admin/ |
| Mailpit | http://localhost:8025 |
| PostgreSQL | Chỉ trong mạng Docker; lưu tài khoản/cấu hình Keycloak |
| MongoDB migration | `mongodb://127.0.0.1:27018/tts_phase2_local`; bản sao metadata tài khoản |
| MongoDB ứng dụng | Vẫn dùng `backend/.env`; công cụ sao chép chỉ đọc nguồn |

**Cập nhật 13/10/2026: ứng dụng đã dùng auth Keycloak.** Đã liên kết 3 tài khoản trên MongoDB ứng dụng, giữ nguyên `_id` và dọn hash mật khẩu/JWT cũ sau backup. Hướng dẫn runtime, kiểm tra và chuyển đổi Phase 3 nằm trong [PHASE3.md](PHASE3.md). Các mục sao chép/import dưới đây ghi lại công cụ Phase 2, không phải thao tác cần lặp lại khi bật máy.

## 1. Khởi chạy

**Giao diện Text2Speech:** realm `tts-local` dùng theme riêng cho đăng nhập, đăng ký và
đặt lại mật khẩu, mặc định tiếng Việt. Cách áp dụng/chỉnh sửa/deploy xem [THEME.md](THEME.md).

Cần Docker Desktop ở chế độ Linux containers và Node.js 22 trở lên. Từ repo root:

Các bước cài phần mềm, cấu hình và bật lại sau khi khởi động máy cũng được trình bày
trong [README chính — Keycloak + PostgreSQL local](../README.md#keycloak--postgresql-local).

```powershell
# Lần đầu, cài thư viện backend theo package-lock.json
cd backend
npm ci
cd ..

# Tạo secrets ngẫu nhiên; giữ các file đã tồn tại
node backend/scripts/init_keycloak_local.js

docker compose --env-file keycloak/.env -f keycloak/compose.yaml --profile migration up -d --wait

# Khai báo thuộc tính mapping, chỉ administrator được sửa
node backend/scripts/configure_keycloak_phase3.js
```

Hai file cấu hình thật đều được Git bỏ qua:

- `keycloak/.env`: phiên bản image, mật khẩu PostgreSQL và administrator của realm `master`.
- `backend/.env.migration.local`: URL/realm Keycloak và URI MongoDB migration riêng.
- `backend/.env.keycloak.local`: cấu hình runtime/service account backend; script Phase 3 tạo, không đưa secret vào frontend.

Tài khoản bootstrap administrator hiện là `local-admin`; xem mật khẩu tại `KEYCLOAK_ADMIN_PASSWORD` trong `keycloak/.env`. Đây là administrator quản trị Keycloak, khác tài khoản role `admin` trong realm ứng dụng. Keycloak tạo bootstrap administrator dạng temporary; có thể tạo administrator lâu dài trong Admin Console rồi cập nhật credentials công cụ local.

Cổng công khai chỉ bind `127.0.0.1`. Keycloak dùng `start-dev`; cấu hình này dành cho máy phát triển. Phase 4 cần cấu hình HTTPS/hostname, database và secrets riêng cho môi trường deploy.

Realm JSON chỉ được import khi realm chưa tồn tại. Sửa `realm-export.json` không ghi đè realm hiện có; cấu hình profile được cập nhật bằng script ở trên.

## 2. Sao chép tài khoản nguồn sang local

```powershell
# Chỉ đọc nguồn và báo số tài khoản
node backend/scripts/copy_users_for_keycloak_local.js

# Lưu snapshot metadata rồi upsert bản sao local
node backend/scripts/copy_users_for_keycloak_local.js --execute
```

Công cụ đọc URI nguồn từ `backend/.env`, giữ nguyên `_id`, và chỉ sao chép email, họ tên, gender, role, status. Không sao chép password hash hoặc `keycloakId` cũ; không cập nhật MongoDB nguồn. Bản snapshot metadata nằm trong `keycloak/backups/users-metadata-*.json`, được Git bỏ qua. Nó không phải backup đầy đủ database ứng dụng.

MongoDB local bổ sung chỉ phục vụ chuẩn bị migration. Đây không phải việc chuyển toàn bộ MongoDB ứng dụng từ Atlas về local.

Nếu Atlas không kết nối được, kiểm tra cluster, Network Access và kết nối máy. Script dùng IPv4. Không ghi URI/credentials nguồn vào log.

## 3. Nhập tài khoản vào Keycloak

```powershell
# Dry-run: không gọi Keycloak, không ghi database/index
node backend/scripts/migrate_users_to_keycloak.js

# Nhập bản sao local + gửi thư đặt mật khẩu tới Mailpit
node backend/scripts/migrate_users_to_keycloak.js --execute --send-reset-email
```

- Giữ `_id` MongoDB và lưu ID Keycloak vào `keycloakId` trên bản sao local.
- Ghi `mongoUserId`, `legacyStatus`, `fullName`, `gender` vào profile Keycloak.
- Ánh xạ role `user`/`admin`; `inactive`/`banned` trở thành disabled.
- Không chuyển hash bcrypt. Tài khoản active nhận action `UPDATE_PASSWORD`.
- Kiểm tra trùng email/username và mapping trước khi ghi; từ chối ghi đè liên kết của người khác.
- Chạy lại giữ ID/credentials; marker `migrationResetEmailSent` tránh gửi lại thư đã ghi nhận thành công. Nếu tiến trình bị ngắt giữa gửi thư và ghi marker, lần chạy tiếp có thể gửi lại thư đó.
- Các thuộc tính mapping chỉ administrator được sửa; người đăng ký không thể tự đặt `mongoUserId`.

Công cụ chỉ chấp nhận Keycloak localhost và MongoDB port 27018 với database `tts_phase2_local` hoặc `tts_phase2_checks`; SMTP phải là Mailpit. Không dùng công cụ này để ghi trực tiếp dữ liệu production.

## 4. Đặt mật khẩu và kiểm tra local

### Phân biệt hai loại tài khoản

| Mục đích | URL | Realm / thông tin đăng nhập |
|---|---|---|
| Quản trị Keycloak | http://localhost:8080/admin/ | `master`; username `KEYCLOAK_ADMIN_USERNAME` (mặc định `local-admin`), password `KEYCLOAK_ADMIN_PASSWORD` trong `keycloak/.env` |
| Tài khoản ứng dụng đã migrate | http://localhost:8080/realms/tts-local/account/ | `tts-local`; email của mình và mật khẩu đặt qua Mailpit |

Role `admin` của ứng dụng không cấp quyền đăng nhập quản trị realm `master`. Nếu đang
ở `/realms/master/` và nhập email/mật khẩu MongoDB, đăng nhập sẽ không thành công.
Trong Admin Console, chọn realm `tts-local` → **Users** để xem tài khoản ứng dụng.

Hash mật khẩu MongoDB cũ đã được dọn sau backup; frontend/backend hiện dùng Keycloak. Mật khẩu Keycloak
được lưu dưới dạng hash trong PostgreSQL (`credential`, `type = 'password'`); chỉ có sau
khi tài khoản được đặt mật khẩu. Sửa `KEYCLOAK_ADMIN_PASSWORD` trong file `.env` không
tự đổi mật khẩu administrator đã tồn tại; nếu đổi mật khẩu qua Keycloak, cập nhật file
cấu hình để công cụ local tiếp tục kết nối được.

### Đặt mật khẩu ứng dụng

1. Mở Mailpit tại http://localhost:8025.
2. Chọn thư của tài khoản muốn dùng và mở link đặt mật khẩu.
3. Link có thời hạn **12 giờ**. Sau thao tác quay về frontend và đăng nhập bằng mật khẩu mới nếu chưa có phiên SSO.
4. Đăng nhập riêng trên Keycloak tại http://localhost:8080/realms/tts-local/account/ bằng email và mật khẩu mới.

Muốn tạo link mới khi thư hết hạn:

```powershell
node backend/scripts/migrate_users_to_keycloak.js --execute --send-reset-email --resend-reset-email
```

Cờ này gửi lại cho tất cả tài khoản active trong bản sao local (công cụ Phase 2). Ở Phase 3, dùng `prepare_keycloak_account_links.js --execute` để chỉ gửi cho tài khoản còn thiếu password credential; tài khoản đã có mật khẩu dùng Forgot Password trên trang đăng nhập.

Kiểm tra vận hành (chỉ đọc; không đặt mật khẩu, không tạo tài khoản/session):

```powershell
node backend/scripts/check_keycloak_local.js
```

Công cụ đối chiếu discovery/JWKS, PKCE, audience/mapping mappers, quyền sửa profile, ID/email/họ tên/role/status của tài khoản và action email trong Mailpit. Không thay cho kiểm thử đăng nhập tương tác và token thật khi nối ứng dụng ở Phase 3. Nếu tự xóa thư trong Mailpit, kiểm tra email sẽ báo thiếu thư.

## 5. Lưu trữ và sao lưu

Sau khi bật máy, mở Docker Desktop và chờ `Engine running`, rồi chạy lệnh `up` ở dưới.
Có thể bật **Settings → General → Start Docker Desktop when you sign in to your computer**
để Docker tự khởi động khi đăng nhập Windows. Các service dùng `restart: unless-stopped`;
nếu đã chủ động Stop hoặc chạy `down`, cần bật lại bằng `up`. Không chạy lại migration
mỗi lần khởi động máy.

Các volume PostgreSQL, MongoDB migration và Mailpit giữ dữ liệu qua restart hoặc `docker compose down`. Không dùng `down -v` nếu cần giữ dữ liệu.

```powershell
# Backup PostgreSQL dạng custom archive; xác nhận pg_restore đọc được archive
./keycloak/backup.ps1

# Dừng services, giữ volumes
docker compose --env-file keycloak/.env -f keycloak/compose.yaml --profile migration down

# Khởi động lại
docker compose --env-file keycloak/.env -f keycloak/compose.yaml --profile migration up -d --wait
```

Backup nằm trong `keycloak/backups/keycloak-*.dump`, chứa dữ liệu tài khoản nhạy cảm và không được commit. Script tạo archive trong container rồi copy về Windows để tránh lỗi redirect dữ liệu binary qua PowerShell.

Khôi phục PostgreSQL: dừng Keycloak, copy archive vào container PostgreSQL, dùng `pg_restore -U keycloak -d keycloak --clean --if-exists <archive>`, rồi khởi động Keycloak. Thao tác này ghi đè database Keycloak; hãy giữ bản backup hiện tại trước khi thực hiện. Cần giữ cả file cấu hình local và snapshot metadata mapping để phục hồi đồng bộ.

Volume không thay thế backup; backup trên cùng máy không bảo vệ khi mất ổ đĩa. Khi chuyển cloud ở Phase 4, tạo database/secrets mới, backup và khôi phục có kiểm soát.

## Phase 3 đã hoàn thành; tiếp theo là Phase 4

Vue đã dùng Authorization Code + PKCE; backend kiểm tra JWT/JWKS, issuer/audience/role/phiên SSO và liên kết MongoDB qua `sub`/`mongoUserId`. Auth cũ và `create_admin.js` đã bỏ; xem [PHASE3.md](PHASE3.md). Phase 4 sẽ cấu hình container ứng dụng, HTTPS/hostname/SMTP thật và chuyển hạ tầng có kiểm soát.
