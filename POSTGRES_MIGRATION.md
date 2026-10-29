# Chuyển dữ liệu ứng dụng từ MongoDB sang PostgreSQL

## Kết quả trên máy hiện tại — 17/10/2026

- Đã nhập nguồn Atlas: 3 tài khoản (1 admin, đủ 3 mapping Keycloak), 3 giọng mẫu, 1 worker lease. Nguồn có 0 lịch sử, 0 job và 0 cache; không có document legacy ngoài mapping.
- Số lượng và digest nội dung từng bảng khớp trước COMMIT; nguồn được đọc lại và không thay đổi. MongoDB được giữ nguyên.
- Backup nguồn: `keycloak/backups/app-mongodb-before-postgres-1792242835363.json`; backup PostgreSQL: `keycloak/backups/app-postgres-1792242848210.dump` (private, bị Git bỏ qua).
- Backend đã kết nối PostgreSQL, health `ok`; worker đã giữ lease hoạt động. Không cần nhập lại sau mỗi lần bật máy.
- Chưa chạy lại bộ test auth hoặc pipeline Gemini/TTS trên PostgreSQL; chưa phục hồi thử file dump. Những kết quả kiểm thử Phase 3 cũ thuộc bản MongoDB.

## Kiến trúc

- PostgreSQL 17 local dùng service `postgres` trong `keycloak/compose.yaml`, cổng Windows **127.0.0.1:5433**.
- Database `keycloak` tiếp tục do Keycloak quản lý. Database ứng dụng **`tts_app`** có login `tts_app` riêng (không phải superuser). Backend chỉ kết nối `tts_app`.
- Backend/worker dùng thư viện `pg` và lớp repository SQL tại `backend/app/db/`. Các bảng có cột định kiểu, UNIQUE, CHECK, khóa ngoại; checkpoint/dàn ý/metadata dùng JSONB. Mongoose chỉ còn phục vụ công cụ đọc nguồn/backup lịch sử.
- Giữ `_id` cũ dưới dạng text 24 ký tự hex; hồ sơ mới cũng sinh ID cùng định dạng. `keycloakId`, `user_id`, `book_job_id`, các key file R2 được giữ nguyên. Thuộc tính Keycloak `mongoUserId` giữ tên legacy để token/mapping không phải đổi; giá trị của nó là ID hồ sơ PostgreSQL sau chuyển.
- R2 và Engine không đổi nơi lưu file. Không chuyển mật khẩu vào database ứng dụng; Keycloak tiếp tục giữ thông tin xác thực trong database riêng.

## Các bảng

| Nguồn MongoDB | Bảng PostgreSQL | Nội dung |
| --- | --- | --- |
| users | users | Hồ sơ, mapping Keycloak và trạng thái đồng bộ |
| voices | voices | Giọng mẫu, chủ sở hữu, key R2 |
| generatedlectures | generated_lectures | Lịch sử, thời lượng, thông tin nguồn sách |
| bookjobs | book_jobs | Nguồn sách, tiến độ, checkpoint, kết quả |
| bookcaches | book_caches | Cache ghi chú theo user/hash/phiên bản |
| readingprofiles | reading_profiles | Tốc độ giọng đọc |
| bookworkerleases | worker_leases | Khóa worker và khóa gửi yêu cầu |
| Các collection khác | legacy_documents | Lưu nguyên EJSON để không âm thầm bỏ dữ liệu |

Trường ngoài schema được lưu ở `legacy_data`, không trả qua API. `schema_migrations` ghi phiên bản schema; `data_migrations` ghi digest nguồn, đường dẫn backup và số lượng nhập.

## Quy trình chuyển local

Các lệnh npm chạy trong thư mục `backend`. Không khởi động Backend/worker ghi MongoDB trong thời gian chuyển.

1. Mở Docker Desktop. Từ repo root:

   ```powershell
   docker compose --env-file keycloak/.env -f keycloak/compose.yaml up -d --wait postgres mailpit keycloak
   ```

2. Cài dependencies bằng `npm ci` (cần cả adapter MongoDB cho công cụ nhập), sau đó:

   ```powershell
   npm run db:init
   npm run db:migrate
   npm run db:import:preview
   npm run db:import
   ```

   `db:init` tạo mật khẩu ngẫu nhiên trong `.env.postgres.local` bị Git bỏ qua, không in ra màn hình. Không thay role hoặc mật khẩu Keycloak. `db:migrate` tạo schema trong transaction, kiểm tra digest schema để tránh sửa âm thầm migration đã áp dụng.

3. Công cụ nhập kết nối MongoDB Atlas bằng `MONGODB_URI` hiện có, chỉ đọc nguồn. Nếu Atlas không kết nối được, kiểm tra cluster đang chạy và Network Access cho IP hiện tại; không dùng snapshot cũ thay cho nguồn mới mà chưa xác nhận.
4. `db:import` yêu cầu lease worker nguồn đã hết hạn (90 giây sau khi worker dừng). Nó sao lưu toàn bộ nguồn vào `keycloak/backups/app-mongodb-before-postgres-*.json`, đọc lại/đối chiếu digest, nhập theo thứ tự khóa ngoại trong một transaction và so sánh số lượng + digest từng bảng. Nguồn được đọc lại trước COMMIT; nếu nguồn thay đổi, dữ liệu sai, có bản ghi mồ côi hoặc trùng khóa, transaction rollback. Mọi lỗi giữ nguyên MongoDB.
5. Đích phải trống. Chạy lại cùng nguồn sau khi hoàn thành chỉ báo đã nhập và giữ nguyên PostgreSQL; nguồn khác sẽ bị từ chối. Không upsert đè các bản ghi mới phát sinh ở PostgreSQL.
6. Sau khi nhập thành công:

   ```powershell
   npm run backup:postgres
   npm start
   ```

   Terminal khác: `npm run worker:books`. Frontend/Engine dùng lệnh hiện có. Backend/worker từ chối khởi động khi thiếu marker chuyển dữ liệu để tránh tạo hồ sơ mới trong database trống. `PG_ALLOW_EMPTY_DATABASE=true` chỉ dành cho môi trường hoàn toàn mới được thiết lập có chủ đích; không đặt khi chuyển dữ liệu thật.

## Vận hành

- Migration `003-book-selected-voice` (19/10/2026) thêm snapshot `book_jobs.selected_voice` có CHECK JSONB; giữ giọng cũ từ checkpoint. Đã áp dụng local sau backup, đủ 5/5 job cũ có snapshot. Job mới bắt buộc chọn giọng qua API; job cũ thiếu snapshot/checkpoint cần tạo yêu cầu mới. Không thay ID/ownership/file R2 hoặc kết quả đã hoàn thành.
- Migration `002-book-custom-duration` (19/10/2026) mở CHECK thời lượng từ 10/20/30 sang số phút nguyên 1–59 cho job và lịch sử có thời lượng mục tiêu. Chạy `npm run db:migrate` sau khi backup; đã áp dụng trên máy local. Driver áp dụng từng file có digest, giữ nguyên schema 001. Backend/worker yêu cầu phiên bản mới nhất trước khi khởi động.
- Sau tắt máy, bật Docker Desktop và stack PostgreSQL/Keycloak trước, rồi Backend, worker, Frontend và Engine khi tạo âm thanh. Backend/worker cùng đọc `.env.postgres.local`; khi deploy dùng cùng `DATABASE_URL` và cấu hình TLS hợp lệ.
- Worker nhận job trong transaction, dùng `FOR UPDATE SKIP LOCKED` khi chọn job. Các cập nhật checkpoint và phiên bản auth giữ điều kiện ownership/lease/version. Upsert khóa được tuần tự hóa bằng advisory lock, UNIQUE ngăn lịch sử hoặc request trùng.
- Thay TTL MongoDB bằng tác vụ xóa cache hết hạn của worker mỗi phút. Cache vẫn kiểm tra `expires_at` khi đọc. Job lỗi giữ checkpoint để retry; không xóa tự động dữ liệu người dùng.
- Backup ứng dụng: `npm run backup:postgres` ghi file `.dump` private, dùng pg_dump custom. Backup Keycloak riêng theo tài liệu Keycloak. Dùng `pg_restore` để phục hồi vào database ứng dụng mới trước khi đổi URL; không restore vào database Keycloak. File R2/model/đoạn đang xử lý cần backup riêng.
- Trạng thái dữ liệu: `npm run db:status` chỉ đọc database/role, số lượng từng bảng, số mapping Keycloak/admin/pending, lease và marker chuyển dữ liệu; không in email hoặc secret.
- Với pgAdmin trên Windows: host `127.0.0.1`, port `5433`, database/user `tts_app`; lấy mật khẩu từ file cấu hình riêng trên máy, không gửi vào chat. pgAdmin chạy cùng mạng Docker dùng host `postgres`, port `5432`.
- Các công cụ Phase 2/3 ghi MongoDB và bộ kiểm thử auth MongoDB cũ được khóa khi có cấu hình PostgreSQL, tránh vô tình chạy fixture/đồng bộ vào database đang dùng. Cần chuyển bộ kiểm thử sang database PostgreSQL cô lập khi yêu cầu kiểm thử; không dùng báo cáo test Phase 3 cũ làm bằng chứng cho bản PostgreSQL.

## Quay lui

MongoDB nguồn được giữ nguyên. Nếu phải quay lui trước khi PostgreSQL phát sinh dữ liệu mới, dừng Backend/worker và dùng lại mã/cấu hình MongoDB tương ứng sau khi xác nhận snapshot nguồn. Nếu PostgreSQL đã phát sinh dữ liệu mới, cần đối chiếu/chuyển dữ liệu chênh lệch; chỉ đổi URI sẽ làm mất khả năng nhìn thấy dữ liệu mới. Không xóa volume, không chạy `down -v`.
