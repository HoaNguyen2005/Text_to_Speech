# Chuyển dữ liệu ứng dụng từ MongoDB sang PostgreSQL

## Hiện trạng — 12/11/2026: tách dữ liệu yêu cầu sách nói

Migration `011-split-book-job-storage` đã áp dụng lên Supabase ứng dụng. Không thay đổi
database Keycloak hoặc file audio trên R2. Hiện có **13 bảng vật lý và một view tương thích**.

| Bảng vật lý mới | Số cột | Nội dung |
|---|---:|---|
| `book_job_requests` | 12 | ID, người dùng, tên yêu cầu, thông tin sách, thời lượng, giọng, trạng thái, thời điểm |
| `book_job_sources` | 3 | `job_id`, văn bản nguồn, hash nguồn |
| `book_job_drafts` | 5 | `job_id`, bản nháp, phiên bản nháp/duyệt, yêu cầu AI sửa |
| `book_job_runtime` | 15 | `job_id`, hành động, tiến độ, checkpoint, kết quả, lỗi/retry, khóa worker và cờ hủy/dọn |

Ba bảng phụ dùng `job_id` vừa làm PK vừa làm FK tới `book_job_requests._id`, quan hệ 1–1.
`generated_lectures.book_job_id` và `book_previews.job_id` tham chiếu bảng chính mới.
Giữ `result` trong runtime để mã cũ vẫn nhận đúng kết quả; chưa loại bỏ phần dữ liệu giao
nhau với lịch sử khi chưa chuyển toàn bộ API sang cơ chế đọc kết quả duy nhất.

`book_jobs` hiện là **view**, ghép bốn bảng thành giao diện 32 cột cũ; không lưu thêm một
bản sao dữ liệu. Trigger INSTEAD OF chuyển thao tác INSERT/UPDATE/DELETE vào đúng các bảng
trong cùng transaction. Backend/Worker cũ tiếp tục dùng model hiện tại, kể cả khóa dòng và
`SKIP LOCKED`. Trigger chỉ cập nhật nhóm có dữ liệu thay đổi để tránh ghi lại nguồn/nháp
lớn trong mỗi heartbeat. Các constraint trigger kiểm tra đủ bảng phụ và điều kiện nguồn
khi commit, cả khi sửa trực tiếp bằng SQL/Table Editor.

Khi quản lý dữ liệu, mở bốn bảng vật lý. Khi tạo một yêu cầu thủ công bằng SQL, dùng view
`book_jobs` để tạo đủ các phần trong một thao tác, hoặc INSERT cả bốn bảng trong cùng
transaction. Không xóa riêng bản ghi bảng phụ khi yêu cầu chính vẫn tồn tại.
View dùng `security_invoker`; các bảng mới bật RLS và chặn truy cập trực tiếp bằng
`anon`/`authenticated`. Hai function trigger chạy bằng quyền người gọi, không nâng quyền.

Sơ đồ cho báo cáo (được sinh từ catalog sau migration, không đưa view tương thích vào
như bảng lưu trữ): [DATABASE.dbml](DATABASE.dbml) và [DATABASE.mmd](DATABASE.mmd).
Các file này mô tả cột, PK/FK/unique; không phải bản sao toàn bộ default/CHECK/trigger.
Sinh lại bằng `node backend/scripts/export_database_diagrams.js` tại repo root.

Sao lưu trước thay đổi: `keycloak/backups/before-job-split-1794453135402.json`, đã đọc lại
đối chiếu. Đây là snapshot JSON của dữ liệu ứng dụng kèm metadata cột/ràng buộc, không phải
pg_dump đầy đủ. Migration khóa ghi trong lúc chuyển và so sánh toàn bộ hàng qua view với
bản trước thay đổi ngay trong transaction; nếu không khớp thì rollback.

Kiểm tra bằng `node backend/scripts/check_book_split.js`: dựng schema cũ trong schema
kiểm thử riêng, chạy migration, kiểm tra CRUD qua view, duyệt, xóa/cascade, owner, constraint
và hai client tranh khóa. Schema kiểm thử tự xóa sau khi chạy. Regression egress vẫn đạt.
Sau migration giữ đủ 38 yêu cầu trong mỗi bảng mới, 14 kết quả, 3 tài khoản và 5 giọng.

Mã tương thích đã có hiệu lực ở database nên không cần deploy đồng thời mọi máy để tiếp
tục dùng cấu trúc mới. Chưa push các thay đổi trong workspace; khi pull bản có migration
011 trên máy khác, chạy `npm run db:migrate` trước khi khởi động (chạy lại là an toàn).
Docker phải build lại image để nhận file migration/tài liệu mới. Chưa kiểm thử tạo audio
thật qua Gemini/Engine trên máy bàn trong lượt này.

## Lịch sử tối ưu — 11/11/2026

Ứng dụng đang dùng Supabase PostgreSQL. Migration `010-reduce-egress` đã được áp dụng
trên project ứng dụng; database Keycloak riêng không thay đổi.
Các hướng dẫn nhập MongoDB bên dưới chỉ ghi lại lịch sử, không dùng cho schema hiện tại.
Muốn chuyển máy chủ sau này, dùng backup/restore PostgreSQL.

### Những gì đã dọn

- Xóa bảng `legacy_documents` sau khi kiểm tra bảng rỗng.
- Xóa cột `legacy_data` rỗng ở `users`, `voices`, `book_jobs`, `generated_lectures`,
  `book_caches`, `reading_profiles`. Migration từ chối chạy nếu các cột này chứa dữ liệu.
- Giữ `worker_leases.legacy_data`: đang chứa cấu hình Engine GPU/CPU, chưa phải dữ liệu thừa.
- Giữ `schema_migrations` để theo dõi schema và `data_migrations` để tương thích kiểm tra khởi động hiện tại.
- Bật RLS cho `book_previews`. Các bảng ứng dụng chỉ được truy cập qua Backend kiểm tra
  quyền Keycloak; chưa cho trình duyệt truy cập trực tiếp Supabase Data API.

### Các bảng còn lại dùng để làm gì?

| Bảng | Nội dung và lý do cần giữ |
|---|---|
| `users` | Hồ sơ, quyền, liên kết Keycloak và trạng thái đồng bộ tài khoản |
| `voices` | Tên giọng, chủ sở hữu, phạm vi, phân hạng và đường dẫn mẫu âm thanh |
| `book_jobs` | Yêu cầu sách nói, bản duyệt, tiến độ, checkpoint và trạng thái thử lại |
| `generated_lectures` | Kết quả cuối cùng, bản tóm tắt, thời lượng, đường dẫn audio/phụ đề |
| `book_caches` | Kết quả phân tích nguồn có hạn dùng, giúp giảm gọi Gemini |
| `reading_profiles` | Tốc độ đọc đã đo để tính thời lượng sát hơn |
| `book_previews` | Cache nghe thử và khóa chống tạo trùng cùng một bản nghe thử |
| `worker_leases` | Khóa xử lý, khóa gửi yêu cầu và đăng ký Engine |
| `schema_migrations` | Phiên bản và checksum của migration đã áp dụng |
| `data_migrations` | Dấu mốc nhập dữ liệu cũ mà kiểm tra khởi động vẫn sử dụng |

`book_jobs` vẫn có nhiều cột vì cần giữ luồng duyệt, khôi phục sau lỗi và chống hai worker
nhận cùng việc. Không gộp các cột cần lọc/lập chỉ mục vào một JSON chỉ để bảng nhìn ngắn hơn.
Khi kiểm tra tiến độ, dùng truy vấn gọn trong SQL Editor thay vì tải toàn bộ nội dung:

```sql
SELECT _id, title, status, target_minutes,
       progress->>'phase' AS phase,
       progress->>'percent' AS percent,
       error, "updatedAt"
FROM public.book_jobs
WHERE delete_requested = false
ORDER BY "updatedAt" DESC
LIMIT 50;
```

### Giảm dữ liệu truyền ra ngoài (egress)

Worker cũ đọc cả checkpoint/bản nháp của những job cần dọn mỗi khoảng 3 giây.
So sánh timestamp PostgreSQL có microsecond với JavaScript Date chỉ có millisecond
khiến 36 job đã kết thúc liên tục bị bỏ qua, rồi lại bị tải về ở lượt sau.

- Truy vấn dọn mới chỉ lấy ID, trạng thái, cờ xóa và timestamp nguyên vẹn; chạy tối đa mỗi phút.
- `book_jobs.updatedAt` dùng millisecond để worker phiên bản cũ cũng so sánh đúng.
- `updateOne` chỉ cần số dòng sẽ không tải toàn bộ dòng trước và sau cập nhật; giữ điều kiện lọc và khóa dòng.
- Danh sách yêu cầu không lấy toàn bộ `source`, `checkpoint`, `draft` và `result.summary`.
  Khi mở yêu cầu riêng vẫn có đầy đủ bản duyệt/kết quả.
- Trang sách nói cập nhật mỗi 5 giây khi đang xử lý, 30 giây khi rảnh, 60 giây khi tab bị ẩn.

Thay đổi schema đã áp dụng, nhưng cần phát hành mã mới cho Backend, Worker trên PC và
Frontend để dùng đầy đủ các tối ưu. Sau khi cập nhật mã, chạy `npm run db:migrate`
trước khi khởi động lại Backend/Worker. Với Docker phải build lại image; restart image
cũ không cập nhật mã. Không ghi đè các file `.env` riêng của từng máy.

Kiểm tra bằng `node backend/scripts/check_migration_digest.js`,
`node backend/scripts/check_egress.js` và `npm run build` tại repo root.
Test egress dùng bảng tạm trong transaction rồi rollback, không tạo dữ liệu kiểm thử lâu dài.

Bản sao dữ liệu trước thay đổi nằm trong thư mục `keycloak/backups/` bị Git bỏ qua,
tên `before-egress-1794409698789.json` (dữ liệu ứng dụng; không phải pg_dump đầy đủ).
Giảm truy vấn chỉ giảm egress phát sinh tiếp theo, không xóa mức 16 GB đã được ghi nhận.

Supabase Advisor còn thông tin [RLS enabled, no policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy):
đây là chủ đích chặn truy cập Data API trực tiếp trong kiến trúc Backend + Keycloak hiện tại.

## Lịch sử chuyển MongoDB — không chạy lại trên schema hiện tại

Phần dưới ghi lại đợt chuyển từ MongoDB sang PostgreSQL local/Supabase trước migration 010.

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
