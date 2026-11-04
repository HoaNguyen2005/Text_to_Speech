# PostgreSQL ứng dụng trên Neon

Project: `billowing-firefly-62369175`, organization `org-rough-queen-02852755`, branch `production`.

## Phạm vi

Neon lưu hồ sơ, giọng đọc, lịch sử và yêu cầu sách nói. Express và worker kết nối qua `pg`.
Keycloak có database riêng. R2 lưu audio, còn Gemini xử lý nội dung sách.

Để chạy trên máy đã cấu hình, dùng [hướng dẫn Docker](README.md#chạy-trên-máy-hiện-tại).
Các bước bên dưới dành cho lần thiết lập Neon, chuyển dữ liệu, cập nhật kết nối hoặc kiểm tra backup.
`neon deploy` áp dụng cấu hình cho database Neon. Cách chạy các thành phần còn lại nằm trong [README.md](README.md).

## Cấu hình

CLI tạo `.neon` (liên kết local, Git bỏ qua), `neon.ts` và `.env.local` tại repo root.
Nếu CLI không nhận trong terminal, dùng `npx --yes neon@latest` thay cho `neon`.

```powershell
neon login
neon init -y --org-id org-rough-queen-02852755 --project-id billowing-firefly-62369175 --branch production --services postgres
neon config plan
neon deploy
```

Chỉ khai báo PostgreSQL; không bật Neon Auth, Data API hoặc Object Storage.
Giữ nguyên cơ chế đăng nhập Keycloak và lưu file R2.

`backend/app/config/env.js` đọc cấu hình theo thứ tự:

1. Biến môi trường đã được tiến trình/container cung cấp.
2. `.env.local`, rồi `.env` tại repo root (do Neon CLI quản lý).
3. `backend/.env.local`, `.env.postgres.local`, `.env.keycloak.local`, `.env.books.local`, `.env`.

Backend và worker dùng chung thứ tự này, không phụ thuộc thư mục chạy lệnh.
Không đưa `DATABASE_URL` vào biến `VITE_*` hay mã frontend. File private đã được Git bỏ qua.

- `DATABASE_URL`: URL pooled cho query/transaction runtime, pool tối đa 5 kết nối/tiến trình.
- `DATABASE_URL_UNPOOLED`: URL trực tiếp, pool riêng tối đa 1 kết nối, dùng khi migrate schema.
- Với Neon, `pg` luôn bật TLS và kiểm tra chứng chỉ + hostname; bật channel binding.
- Không dùng `rejectUnauthorized: false`. `PG_SSL_CA_FILE` chỉ dùng nếu thật sự có CA riêng cần thiết.

## Chuyển dữ liệu local

Không chạy lại công cụ nhập MongoDB. Nguồn lần này là PostgreSQL local `tts_app`.
Không bật `PG_ALLOW_EMPTY_DATABASE=true` để né kiểm tra dữ liệu đã migrate.

```powershell
npm run db:migrate
npm run neon:import:preview
```

Lệnh xem trước không ghi dữ liệu. Lệnh nhập cần hoàn tất các job queued/processing,
nghe thử và đồng bộ hồ sơ trước, sau đó dừng **Backend và worker** để ngăn ghi mới:

```powershell
docker compose --env-file keycloak/.env -f keycloak/compose.yaml -f deploy/compose.app.yaml stop backend worker
npm run neon:import
```

Công cụ đọc nguồn bằng transaction repeatable-read/read-only, đối chiếu schema,
tạo snapshot private trong `backend/data/neon-backups/`, rồi nhập các bảng trong một
transaction ở Neon. Tự kiểm tra hash nội dung từng bảng trước commit; từ chối đích
đã có dữ liệu. Giữ ID, quyền sở hữu giọng, mapping Keycloak, R2 key và bản nháp.
Lease tiến trình cũ được đặt hết hạn để worker mới nhận việc; database nguồn không bị sửa/xóa.

Nếu chuyển thất bại, transaction đích rollback; khởi động lại Backend/worker bằng
`deploy/backend.env` cũ. Không xóa volume PostgreSQL local: Keycloak vẫn đang dùng nó.

## Docker

Container không tự đọc file `.env.local` trên Windows. Đồng bộ riêng hai biến database,
sao lưu cấu hình cũ và giữ các secret/dịch vụ khác:

```powershell
npm run neon:docker-env
docker compose --env-file keycloak/.env -f keycloak/compose.yaml -f deploy/compose.app.yaml build backend
docker compose --env-file keycloak/.env -f keycloak/compose.yaml -f deploy/compose.app.yaml up -d --no-deps --wait backend worker
```

Cấu hình trước khi chuyển nằm ở `deploy/backend.pre-neon-<timestamp>.env` (private).
Recreate container sau khi đổi `env_file`; chỉ `restart` không tải lại biến mới.
`deploy/stack.ps1 prepare` là công cụ tạo cấu hình **local**; không chạy `prepare --refresh`
để thay cấu hình Neon. Các lệnh `up/status/logs/stop` vẫn dùng stack hiện có.

## Kiểm chứng

```powershell
npm run build
npm run db:status
npm run neon:check
```

`neon:check` chỉ chạy khi URL thật sự trỏ Neon. Nó xác nhận TLS đã kiểm tra chứng chỉ,
CRUD qua repository, transaction rollback và lease worker; tiếp đó khởi động chính
Express app trên cổng loopback ngẫu nhiên, kiểm tra `/api/health`, danh sách giọng
công khai đối chiếu dữ liệu Neon, và HTTP 401 khi đọc lịch sử không có token.
Tất cả bản ghi kiểm tra được rollback; không gọi Gemini, TTS hay R2 và không tạo audio.
Đây là kiểm tra tích hợp PostgreSQL, không thay cho kiểm tra đăng nhập hoặc sinh sách nói đầy đủ.

Backup database đang được chọn:

```powershell
npm --prefix backend run backup:postgres
```

Với Neon, công cụ dùng URL trực tiếp, xác minh TLS bằng CA hệ thống và client
`postgres:18-alpine` tạm thời (Neon hiện chạy PostgreSQL 18). Không dùng client 17
trong container Keycloak để dump server 18. Kết quả nằm trong `keycloak/backups/`
và không được đưa vào Git; mật khẩu chỉ truyền qua environment của tiến trình.

## Kết quả thực tế 01/11/2026

- Neon CLI 8.16.0: init đúng project/production; deploy báo `No changes` và
  `Pulled 3 Neon variables into .env.local` (Postgres đã có sẵn, không tạo project mới).
- Đã áp dụng đủ migration 001–009 và chuyển dữ liệu, xác minh hash từng bảng.
- Đã lưu snapshot trước chuyển tại `backend/data/neon-backups/local-postgres-1793507856139.json`.
- Đã lưu cấu hình Docker cũ tại `deploy/backend.pre-neon-1793507869283.env`.
- Đã tạo backup cloud `keycloak/backups/app-postgres-1793508266495.dump` (2.274.842 byte).
- `npm run build`: exit 0; Vite 8.2.2, `414 modules transformed`, `built in 1.09s`.
  Có cảnh báo chunk PDF lớn hơn 500 kB, không làm build thất bại.
- `npm run neon:check`: TLS/chứng chỉ, CRUD/lease/rollback, HTTP health 200,
  API giọng 200 (2 giọng công khai đúng Neon) và history 401 khi chưa đăng nhập đều PASS.
- Đã build/recreate Backend và worker; cả hai `running healthy`.
  `postgres_status.js` **trong container Backend** đọc database `neondb`,
  3 user/5 voice/33 job/11 history, 3 mapping Keycloak, worker lease active.
- Web `http://localhost:5173` trả HTTP 200; API `http://localhost:3000/api/health`
  trả `{"status":"ok"}`.

Lỗi đã xử lý trong phiên: quyền cài CLI/config, phiên OAuth hết hạn và terminal
không nhận lệnh `neon` (dùng `npx --yes neon@latest login`), và pg_dump 17 không
tương thích Neon PostgreSQL 18 (đổi client backup sang 18). Không chạy lại Gemini/TTS,
không kiểm tra toàn bộ phiên đăng nhập có người dùng và chưa thử restore bản dump cloud.

Pool/query định kỳ của worker và Docker healthcheck có thể giữ compute Neon hoạt động.
Theo dõi Usage trong Neon để kiểm soát hạn mức gói miễn phí; việc chuyển database
không đảm bảo cả hệ thống sẽ hoạt động miễn phí liên tục.

Tài liệu tham khảo:

- [Chọn driver theo runtime](https://neon.com/docs/connect/choose-connection)
- [Pooled và direct connections](https://neon.com/docs/connect/connection-pooling)
