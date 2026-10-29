# Sách nói tùy chọn 1–59 phút

## Bật các dịch vụ local

**Chẩn đoán giọng cá nhân:** file có tên trong danh sách không bảo đảm object
`samples/...` còn tồn tại trên R2. Xóa tay object R2 không cập nhật PostgreSQL.
Engine nay báo riêng thiếu file mẫu (404), lỗi quyền (401/403), lỗi kết nối hoặc
lỗi VieNeu; không quy tất cả thành Edge/OpenVoice/FFmpeg. Trường hợp Thanh Hòa
ngày 25/10 đã khôi phục đúng bản gốc local lên key R2 bị thiếu. Job lỗi có thể
**Tiếp tục từ phần lỗi** sau khi kho mẫu được sửa; không cần tóm tắt lại.

**Cập nhật 25/10/2026:** đã thêm migration `008-book-preview-cache`. Sao lưu và
chạy migration trước khi bật Backend/worker mới. Nghe thử được Backend xử lý
riêng, có cache 7 ngày và ưu tiên giữa các đoạn TTS; không phải chờ hàng đợi
sách nặng. `countTokens` chỉ gọi gần ngân sách đầu vào (mặc định 24.000 token),
prompt nhỏ ước lượng cục bộ. Yêu cầu mới phân tích theo nhóm thích ứng và có
thể gộp phân tích + dàn ý; ID nguồn nhỏ vẫn giữ nguyên. Đối chiếu gom tối đa
3 mục/lượt với cache từng mục theo nội dung, bằng chứng, ngữ cảnh và model.
Sửa tay có lựa chọn tự duyệt rõ ràng, mặc định tắt; không gán nhãn AI xác nhận.
Xem quy trình cập nhật trong [QUY_TRINH_TAO_SACH_NOI.md](QUY_TRINH_TAO_SACH_NOI.md).

**Chế độ Docker (đã chuẩn bị trên máy, 20/10/2026):** mở Docker Desktop rồi chạy
`.\deploy\stack.ps1 up` tại repo root. Stack bật cả worker và Engine, không cần
terminal riêng. Xem [PHASE4.md](PHASE4.md). Các bước sau dành cho chế độ terminal;
không chạy đồng thời hai worker. Đổi env Windows cần chạy
`node backend/scripts/init_docker_local.js --refresh` rồi `up` để cập nhật env Docker.

Giữ Docker Desktop, Keycloak và PostgreSQL chạy. Database `tts_app` lưu hồ sơ, giọng, lịch sử và công việc sách nói; database `keycloak` quản lý tài khoản xác thực. Hoàn tất [chuyển dữ liệu PostgreSQL](POSTGRES_MIGRATION.md) trước khi bật Backend/worker.

1. Điền `GEMINI_API_KEY` thật và một `GEMINI_MODEL` hỗ trợ JSON structured output trong `backend/.env`. Ví dụ cấu hình dùng alias `gemini-flash-latest`; có thể thay bằng tên model bạn được cấp quyền. Thay env cần khởi động lại worker.
2. Từ thư mục `backend`, chạy một lần:

   ```powershell
   npm run books:init
   ```

   Lệnh tạo `backend/.env.books.local` chứa khóa nội bộ ngẫu nhiên. Backend, worker và Engine cùng đọc file; file bị Git bỏ qua. Chạy lại giữ nguyên khóa. Không đưa khóa vào frontend.

3. Mở các terminal riêng:

   | Thư mục | Lệnh | Vai trò |
   | --- | --- | --- |
   | `backend` | `npm start` | API, cổng 3000 |
   | `backend` | `npm run worker:books` | Xử lý hàng đợi |
   | `engine` | `.\venv\Scripts\python.exe main.py` | TTS, cổng 8000 |
   | `frontend` | `npm run dev` | Giao diện, cổng 5173 |

   Engine cần FFmpeg/FFprobe trong PATH hoặc `engine/venv/Scripts`. Giọng tiêu chuẩn dùng Edge-TTS; giọng cá nhân cần thêm OpenVoice và weights. Engine mặc định chỉ nghe `127.0.0.1`; chỉ đổi `ENGINE_HOST` khi cấu hình mạng riêng cho deploy.

4. Đăng nhập bằng tài khoản người dùng, mở **Sách nói AI**, tải/dán sách, nhập tên sách/tài liệu, tác giả và nguồn. Kiểm tra tên gợi ý từ tên file; tác giả/nguồn chưa biết có thể để trống và sẽ hiển thị “Chưa cung cấp”. Chọn nhanh 10/20/30 hoặc nhập số phút nguyên **1–59**, chọn loại giọng và **giọng cụ thể**, rồi bấm **Tạo bản tóm tắt để xem trước**. Khi trạng thái là **Chờ duyệt nội dung**, bạn có thể dùng ngay, sửa trực tiếp hoặc yêu cầu AI chỉnh một mục/toàn bộ. Nghe thử tối đa 30 giây nếu muốn, sau đó bấm **Duyệt và tạo âm thanh**. Tiến độ nằm trong **Yêu cầu gần đây**, âm thanh hoàn thành nằm trong **Lịch sử**.

### Cập nhật luồng duyệt nội dung (22/10/2026)

Migration **004-book-editorial-review** bổ sung bản nháp, phiên bản bản nháp,
trạng thái `review`, tác vụ AI chỉnh/nghe thử/tạo âm thanh và phiên bản đã duyệt.
Chỉ job mới có `workflow_version=review-v1`; job cũ tiếp tục luồng cũ và không bị
chuyển trạng thái hay viết lại. Muốn dùng tính năng mới cho sách đã tạo, gửi yêu cầu mới.

Đã áp dụng migration và cập nhật cả Backend/worker/Engine/Frontend local ngày
22/10/2026, sau backup `keycloak/backups/app-postgres-1792631990530.dump`.
Các service runtime healthy, PostgreSQL và worker đã kết nối. Chỉ cần tải lại
website để dùng luồng mới; không chạy lại migration hoặc nhập lại dữ liệu mỗi lần bật máy.
Chưa chạy sách thật để đánh giá độ bám nguồn, nhịp đọc hoặc thời gian xử lý.

Trước khi bật mã mới trên môi trường khác:

```powershell
# Từ repo root; Docker Desktop phải ở trạng thái Engine running.
.\deploy\stack.ps1 stop -Service worker
node backend/scripts/backup_app_postgres.js
.\deploy\stack.ps1 build -Service backend
.\deploy\stack.ps1 build -Service engine
.\deploy\stack.ps1 build -Service frontend
docker compose --env-file keycloak/.env -f keycloak/compose.yaml -f deploy/compose.app.yaml run --rm --no-deps backend node scripts/migrate_postgres_schema.js
.\deploy\stack.ps1 up
```

Chế độ terminal: sau backup, chạy `npm run db:migrate` trong backend rồi khởi động
lại Backend/worker/Engine và Frontend. Không chạy đồng thời hai chế độ.

Cập nhật thời lượng ngày 19/10/2026 dùng migration `002-book-custom-duration`: chạy `npm run db:migrate` trước khi bật mã mới trên máy khác, rồi restart Backend và worker. Database local hiện tại đã áp dụng migration; không cần nhập lại dữ liệu. Schema 001 và job/lịch sử cũ được giữ nguyên.

Cập nhật chọn giọng thủ công dùng migration **003-book-selected-voice**, cũng đã áp dụng local sau backup. Backend/worker đã restart để nạp API mới. `GET /api/book-jobs/voices` trả hai nhóm giọng được phép dùng; `POST /api/book-jobs` cần `voice_id` cùng `voice_mode`. API tóm tắt ngắn cũ `/api/summarize-book` cũng yêu cầu `voice_id` (mặc định `voice_mode=clone`), không tự chọn hoặc fallback sang mẫu khác.

Sau khi tắt máy, cần chạy lại cả worker; bật Backend/Engine thôi chưa xử lý hàng đợi. Khi worker không hoạt động, UI báo yêu cầu đang chờ. Backend/worker không được dùng hai DATABASE_URL khác nhau.

## Luồng xử lý

```text
Vue → POST /api/book-jobs → lưu PostgreSQL → trả job ID ngay
                                       ↓
                         worker nhận một công việc
                                       ↓
               dữ kiện có cấu trúc → dàn ý theo thể loại
                                       ↓
               viết từ đoạn nguồn gốc → đối chiếu bằng AI
                                       ↓
               review: xem / sửa tay / nhờ AI chỉnh từng mục
                                       ↓
               nghe thử (tùy chọn) → duyệt đúng phiên bản
                                       ↓
               Edge-TTS / OpenVoice từng đoạn → FFmpeg ghép MP3
                                       ↓
               lưu R2 hoặc local → lịch sử → completed
```

- **Thời lượng gần đúng:** luồng mới dùng tốc độ ước lượng ban đầu theo nhịp đọc, trừ lời giới thiệu và khoảng nghỉ; chưa gọi TTS khi chỉ tạo bản tóm tắt. UI cập nhật thời lượng dự kiến theo phần bạn chỉnh. Đo lại thời lượng file thật, cảnh báo khi lệch hơn 15%; không tự kéo giãn hoặc thêm ý để đủ phút. Luồng cũ vẫn đo đoạn mẫu và dùng cache `reading_profiles` 30 ngày.
- **Dưới 1 giờ:** UI/API/database chỉ nhận số phút nguyên 1–59; không nhận chuỗi, số lẻ, 0 hoặc 60. Worker kiểm tra tổng đoạn trước ghép và thời lượng file ghép trước upload/lưu lịch sử. Nếu đạt 3.600 giây, yêu cầu dừng và đề nghị gửi job mới với số phút ngắn hơn. Không tự cắt nội dung. Với mục tiêu ngắn, phần giới thiệu nguồn cũng tính vào ngân sách; metadata quá dài có thể cần rút gọn hoặc tăng thời lượng.
- **Nguồn ngắn:** luồng mới hạ ngân sách theo độ dài nguồn và cho phép trả bản ngắn trung thực kèm thông báo. Không ép kéo dài, lặp ý hoặc bịa chi tiết để đủ phút. Luồng cũ vẫn dùng điều kiện nguồn tối thiểu 1,2 lần ngân sách.
- **Giọng tiêu chuẩn:** người dùng chọn Nam Minh hoặc Hoài My, không cần file mẫu. **Giọng cá nhân:** người dùng chọn một giọng mẫu được phép dùng (giọng chung + giọng riêng; admin có thể chọn tất cả giọng active). Có nút tải lại danh sách sau khi thêm mẫu. Backend/worker kiểm tra quyền, trạng thái và file mẫu; không thay sang mẫu khác khi mẫu bị ẩn/thay đổi. Gemini chỉ chọn nhịp story/news/normal, không được cung cấp danh sách giọng để tự chọn.
- **Giữ lựa chọn:** `book_jobs.selected_voice` lưu snapshot ID/tên/giới tính/key mẫu từ Backend, không nhận file path từ người dùng. Checkpoint, đo tốc độ, đoạn âm thanh và retry dùng đúng snapshot. Muốn đổi giọng của job đã gửi, tạo job mới để không trộn âm sắc. Migration sao chép giọng từ checkpoint của job cũ; job cũ chưa có giọng cần gửi lại với lựa chọn cụ thể. Cùng một sách giữ nguyên mẫu, gender, nhịp đọc và vector âm sắc nguồn. Cache mẫu theo nội dung; không suy đoán gender từ tên file.
- **Giới hạn nội dung:** tối đa 30 MB/file trên giao diện, 1.000.000 ký tự, PDF tối đa 1.000 trang. PDF được đọc hết hoặc báo vượt giới hạn, không âm thầm lấy 50 trang đầu. PDF ảnh cần OCR bên ngoài. PDF worker được đóng gói cùng frontend, không phụ thuộc CDN.
- **Giới hạn từng bước:** chia nguồn khoảng 6.000 ký tự; kiểm tra token trước lời gọi Gemini, ngân sách input 24.000 token (không đếm lại cùng prompt khi retry lỗi mạng). Phân tích tối đa hai phần nguồn đồng thời, lưu đúng thứ tự; một phần lỗi vẫn giữ phần thành công. Đặt `BOOK_ANALYSIS_CONCURRENCY=1` trong env Backend rồi restart worker nếu hạn mức Gemini thấp. Ghi chú gộp nhiều tầng khi sách lớn. Chỉ nhận model kết thúc `STOP`, không dùng nội dung bị cắt. Mỗi đoạn audio tối đa 1.200 ký tự; PCM 24 kHz mono trước khi ghép MP3 128 kbps.
- **Cân đối kịch bản:** luồng mới ưu tiên đúng nguồn và dễ hiểu hơn số phút. Độ dài là gợi ý khi viết; lời văn không bị tự cắt hoặc kéo dài sau khi duyệt. Luồng cũ vẫn dùng ngân sách mỗi mục ±25%, kiểm tra tổng ±35% và giới hạn hai lần sinh/chỉnh. Cả hai luồng đo file cuối và chặn kết quả đạt 3.600 giây.

## Chất lượng nội dung, duyệt và nghe thử

- Phân tích mỗi phần thành `kind`, `synopsis`, danh sách nhân vật/thuật ngữ, dữ kiện,
  nguyên nhân–hệ quả, chủ đề và điều chưa chắc chắn. Giữ tên/quan hệ đúng nguồn;
  không tự lấp nguyên nhân còn thiếu. Dàn ý truyện theo hoàn cảnh–xung đột–bước ngoặt
  thiết yếu–kết quả; sách kiến thức theo vấn đề–luận điểm–giải thích–kết luận.
- Khi viết và đối chiếu từng mục, truy xuất lại các đoạn nguyên bản liên quan,
  tối đa 8 phần nguồn và khoảng 11.000 ký tự nguyên bản/lượt cùng ghi chú giới hạn.
  Mã tham chiếu là thứ tự phần văn bản đã chia, **không phải số trang PDF**.
  Đây là truy xuất chọn lọc, không có nghĩa mỗi lần AI đọc lại toàn bộ sách.
- Đối chiếu AI phát hiện sai tên, quan hệ, luận điểm, ý không có căn cứ, thiếu
  liên kết và lặp. Chỉ phần bị phát hiện có vấn đề được sửa và đối chiếu lại một
  lượt; nếu còn nghi vấn, trả bản nháp kèm nhận xét. Không bảo đảm AI phát hiện
  mọi sai sót; người dùng vẫn xem lại trước khi duyệt.
- Đối chiếu bổ sung lời gọi Gemini nên có thể tăng thời gian/chi phí phần văn bản.
  Checkpoint giữ kết quả từng mục để retry không làm lại phần đạt. Chọn chỉnh
  một mục khi lỗi cục bộ; bước duyệt/nghe thử giúp tránh tạo lại toàn bộ audio
  từ kịch bản chưa đạt. Chưa có số đo thời gian hoặc chất lượng thực tế của luồng mới.
- Bản nháp lưu PostgreSQL theo chủ sở hữu. `draft_revision` chống ghi đè từ hai tab;
  thay nội dung làm mất xác nhận đối chiếu cũ và ẩn đoạn nghe thử cũ. Các nút AI,
  nghe thử và tạo âm thanh lưu chỉnh sửa trước khi tiếp tục. Chỉnh bằng AI chạy
  nền, có thể chọn từng mục để giảm lời gọi/thời gian; không đổi metadata nguồn.
- Trước tạo toàn bộ âm thanh, bản sửa tay chưa đối chiếu được kiểm tra lại. Nếu
  có vấn đề, trả về `review` cùng nhận xét, **không âm thầm đổi lời văn đã duyệt**.
  Nếu đạt, TTS dùng đúng nội dung và phiên bản đã duyệt. Job lỗi có bản nháp có
  nút quay lại chỉnh; retry vẫn dùng điểm lưu.
- Nghe thử dùng giọng tiêu chuẩn/giọng mẫu đã chọn, cắt file bằng FFmpeg tối đa
  30 giây; tài liệu ngắn có thể cho đoạn ngắn hơn. Giọng cá nhân vẫn phải chạy
  OpenVoice nên nghe thử có thể mất thời gian. File nghe thử không tạo lịch sử.
- Tách audio theo đoạn văn/câu, thay tốc độ nhẹ theo kiểu đoạn và phần kết;
  nghỉ 400 ms giữa đoạn, 650 ms khi chuyển mục (có điều chỉnh cho câu hỏi).
  Cao độ hiện giữ nguyên để tránh thay đổi thanh điệu tiếng Việt. Tham số nhịp
  và phiên bản có trong hash/cache; đổi nội dung/nhịp không dùng nhầm file cũ.
  Đây là cải thiện nhịp kể trên Edge-TTS/OpenVoice, chưa thay bằng dịch vụ diễn
  cảm khác; cần nghe so sánh thực tế trước khi quyết định đổi công nghệ.
- Bản nháp `review` giữ nguồn/checkpoint và không chiếm worker khi đang chờ.
  Cache nội dung mới dùng namespace `grounded-review-1`, không dùng ghi chú
  khái quát của luồng cũ. Nghe thử mới có TTL 7 ngày và tối đa 5 bản cache còn
  hiệu lực mỗi job, worker dọn khi rảnh; bản nghe thử legacy giữ cách lưu cũ. Dọn đoạn R2 chỉ xóa WAV có
  hash của job, giữ MP3 kết quả/lịch sử.

### Chi tiết kiểm tra dấu của luồng cũ
- **Dấu tiếng Việt:** yêu cầu đầy đủ dấu được đặt cả trong `systemInstruction`, mô tả trường JSON và prompt các bước phân tích/gộp ý/dàn ý/viết. AI viết trực tiếp có dấu kể cả nguồn không dấu; không có API phục hồi dấu riêng. Ghi chú mới và đầu ra gộp được kiểm tra trước khi dùng, tối đa hai lượt viết từ nguồn. Khi tiếp tục hoặc đọc cache cũ, kiểm tra từng ghi chú: giữ phần đạt, viết lại phần thiếu dấu từ đoạn sách gốc, tính lại dữ liệu gộp/brief phụ thuộc. Cache mới dùng namespace `languageVersion` riêng; cache cũ chỉ được tái sử dụng sau kiểm tra. Giữ kịch bản đã đạt và tốc độ giọng đã đo. Kịch bản được chuẩn hóa NFC và kiểm tra đoạn/cửa sổ dài thiếu dấu; mục lỗi được viết lại trong giới hạn hai lượt rồi dừng nếu vẫn không đạt. Bản bị chặn và chỉ số nhận diện lưu trong checkpoint riêng để chẩn đoán, không đưa sang TTS hoặc API công khai. Script thiếu dấu từ checkpoint cũ được viết lại từ nguồn đã kiểm tra; hash khác không dùng lại audio cũ. Bộ phát hiện theo quy tắc không thay thế rà soát chính tả/ngữ nghĩa. Bản hoàn thành cần tạo yêu cầu mới để có cả văn bản và âm thanh đã sửa.
- **Thời gian xử lý:** giọng tiêu chuẩn bỏ qua OpenVoice; giọng mẫu vẫn clone tuần tự để tránh tranh tài nguyên. Log `[BOOK GEMINI]`, `[BOOK TIMING]`, `[TTS TIMING]` phân biệt phân tích, viết, đo giọng, Edge-TTS, embedding, clone, upload và ghép. Kết quả mới lưu `processing_times` (tổng thời gian lời gọi theo bước, có thể chồng lấp khi phân tích song song; không phải tổng thời gian chờ). Chưa benchmark sau thay đổi; không cam kết mức tăng tốc cụ thể.
- **Tiến độ:** phần trăm là tỷ lệ bước/phần hoàn thành, không phải thời gian còn lại. Gemini có timeout, thử lại tối đa 3 lần với lỗi tạm thời. Bản nháp và số đếm từng lần viết được lưu để retry tiếp phần lỗi; lỗi API/nguồn không đầy đủ vẫn dừng. Engine có retry riêng. Không chuyển sang giọng/phong cách khác giữa sách khi Edge-TTS lỗi.

## Tiếp tục, hủy và lưu dữ liệu

### Diễn đạt riêng và ghi nguồn

- Prompt tại các bước phân tích, gộp ý, dàn ý và viết kịch bản yêu cầu tổng hợp bằng cách diễn đạt riêng, không chỉ thay vài từ trong câu gốc. Không chép nguyên văn đoạn văn, lời thoại, thơ/ca từ hoặc câu văn đặc trưng. Giữ tên riêng, thuật ngữ và dữ kiện cần thiết để đúng nghĩa. Với truyện, khái quát chủ đề/xung đột/thông điệp, tránh tái hiện từng cảnh và toàn bộ tình tiết chi tiết; không cố thay thế trải nghiệm đọc bản gốc.
- Nếu không đủ ý để đạt độ dài mà vẫn tuân thủ hướng dẫn, model báo thiếu nguồn; không thêm chi tiết, lời thoại hoặc nội dung lặp để kéo dài. Endpoint tóm tắt ngắn tương thích cũng dùng cùng hướng dẫn.
- Tên sách, tác giả và nguồn do người tạo cung cấp được lưu trong `book_metadata` của job, kết quả và lịch sử. Metadata không được model suy đoán. UI ghi rõ **Bản tóm tắt do AI hỗ trợ** và thông tin nguồn; lịch sử tìm kiếm được theo tên sách/tác giả/nguồn. Bản ghi cũ thiếu metadata hiển thị thông tin còn có hoặc “Chưa cung cấp”.
- Âm thanh và kịch bản có lời mở đầu ghi nhãn AI, tên sách và tác giả (hoặc báo chưa được cung cấp). Phần mở đầu được tạo từ metadata ở Backend, không giao cho Gemini viết; ngân sách nội dung đã trừ độ dài lời giới thiệu để giữ mốc thời lượng gần đúng. Chi tiết nguồn/nhà xuất bản/đường dẫn nằm trong UI và metadata, không đọc URL dài trong audio.
- Phiên bản pipeline `book-v2-paraphrase-attribution` dùng cache mới. Job đã có checkpoint `book-v1` cần tạo yêu cầu mới để không dùng lại kịch bản từ hướng dẫn cũ; kết quả hoàn thành trước đây được giữ nguyên. Job chưa bắt đầu có thể chạy với phiên bản mới.
- Các thay đổi trên áp dụng đúng phạm vi diễn đạt riêng và ghi nguồn. Đây là hướng dẫn model và thông tin minh bạch, **không phải kiểm tra sao chép tự động hoặc xác minh giấy phép**, không bảo đảm một kết quả cụ thể không vi phạm bản quyền. Ghi nguồn không thay thế việc xin phép khi cần.

- PostgreSQL có `book_jobs` (nguồn, dàn ý, script, tiến độ, điểm lưu), `book_caches` (ghi chú theo chủ sở hữu + hash nguồn, hết hạn 7 ngày), `reading_profiles` (tốc độ, hết hạn 30 ngày), `worker_leases` (khóa worker). `generated_lectures` có `book_job_id`, tiêu đề, thời lượng và loại giọng. Worker dọn cache hết hạn mỗi phút thay TTL MongoDB; dữ liệu lịch sử cũ được giữ khi chuyển.
- Worker tách khỏi HTTP và chỉ chạy một công việc tại một thời điểm. Khóa PostgreSQL được gia hạn mỗi 10 giây, hết hạn sau 90 giây nếu worker chết; worker mới tiếp tục từ điểm lưu. Khi đóng bằng Ctrl+C, worker dừng sau lời gọi đang chờ. Không xóa điểm lưu để khởi động lại.
- Mỗi người có tối đa 3 yêu cầu chờ/đang chạy. API dùng Keycloak và kiểm tra chủ sở hữu với cả đọc, hủy, retry. Worker kiểm tra trạng thái tài khoản, quyền dùng giọng và Keycloak định kỳ. Logout/rời trình duyệt không hủy một công việc đã gửi hợp lệ.
- **Hủy:** yêu cầu đang chạy đợi lời gọi hiện tại kết thúc rồi dừng. Giai đoạn xuất bản cuối đã khóa hủy để lịch sử/kết quả được ghi nhất quán. **Thử lại:** chỉ áp dụng với công việc lỗi, giữ các phần thành công; sửa key/model/kết nối trước khi thử lại. Nếu giọng mẫu hoặc phiên bản pipeline đổi, tạo yêu cầu mới.
- Các đoạn tạm nằm trong `backend/data/book-audio/<job-id>` ngoài thư mục public, bị Git bỏ qua. Khi bật R2, worker lưu đoạn bằng key xác định và khôi phục từ R2 nếu file local bị mất. Chỉ cần chia sẻ filesystem giữa Backend/worker/Engine ở cấu hình local này; deploy nhiều máy cần thay phần vận chuyển file (xem Phase 4).
- MP3 cuối được upload R2 hoặc chép vào `backend/public/audio/generated`; DB lưu key R2 để API sinh URL mới. Không xóa MP3 cuối khi dọn các đoạn. Upload dùng stream để không nạp toàn bộ sách nói vào RAM.
- Worker dọn file tạm và các đoạn R2 sau hoàn thành/hủy; nguồn/điểm lưu của hai trạng thái này được bỏ, kịch bản kết quả/lịch sử được giữ. Công việc lỗi giữ nguồn và các đoạn để retry; cần chính sách lưu trữ/xóa theo nhu cầu trước production. Không xóa thủ công file của job đang chạy.
- Unique `book_job_id` trong lịch sử và mã yêu cầu do frontend tạo giúp gửi lại/khôi phục không tạo kết quả trùng. API vẫn giữ endpoint tóm tắt ngắn cũ để tương thích, trang Sách nói dùng hàng đợi mới.

## Chẩn đoán

### Gemini: điều tiết và tự tiếp tục (22/10/2026)

Luồng sách nói dùng migration **005-book-ai-retry**: `next_attempt_at` và
`retry_state` lưu thời điểm thử lại, mã lỗi, mã HTTP, bước xử lý và ngân sách thử.
Mặc định mỗi worker chỉ gửi một RPC Gemini tại một thời điểm, cách thời điểm
bắt đầu RPC trước ít nhất 4 giây; áp dụng cả `countTokens` và `generateContent`.
Kết quả đếm token cùng prompt/model/schema được nhớ 15 phút, tối đa 256 mục
trong bộ nhớ (chỉ giữ hash và số token), giúp không đếm lại khi retry trong cùng tiến trình.
Phân tích nguồn mặc định một phần/lượt, có thể đặt `BOOK_ANALYSIS_CONCURRENCY=2`
nhưng RPC vẫn đi qua bộ điều tiết chung. Không tự đổi model/API key/nhà cung cấp.

| Mã nội bộ | Cách xử lý |
| --- | --- |
| RATE_LIMIT (429 chưa có bằng chứng hạn mức ngày) | Nghỉ dùng chung theo khóa API + model, lên lịch lại công việc |
| OVERLOADED / SERVER_ERROR (503 / 500,502) | Giữ checkpoint, chờ tăng dần và tự tiếp tục |
| TIMEOUT (408/504 hoặc timeout phía client) / NETWORK | Tự lên lịch lại có giới hạn; timeout countTokens 60 giây, sinh nội dung 180 giây |
| DAILY_QUOTA | Chỉ nhận diện khi phản hồi có quota ID/metric hoặc mô tả hạn mức ngày; dừng tự retry và báo kiểm tra AI Studio |
| QUOTA_CONFIG | Google báo mọi vi phạm quota trong phản hồi có giá trị 0; dừng để kiểm tra quyền/model/project/billing |
| AUTH / MODEL_NOT_FOUND / BAD_REQUEST | Dừng và báo lỗi cấu hình; không retry tự động |

- Khoảng chờ cho 429 bắt đầu 30 giây; lỗi tạm khác bắt đầu 15 giây, tăng gấp đôi
  đến 5 phút cộng nhiễu ngẫu nhiên tối đa 20%. Ưu tiên thời gian `RetryInfo.retryDelay`
  Google trả về nếu dài hơn. Có hỗ trợ `Retry-After` khi transport cung cấp;
  SDK hiện tại chỉ giữ errorDetails/RetryInfo, không giữ HTTP response headers.
- Nghỉ dùng chung được lưu ở `worker_leases` với scope hash theo khóa + model;
  không lưu khóa API trong scope. Công việc trở lại `queued` với thời điểm hẹn;
  worker không nhận nó trước giờ, có thể xử lý việc khác trong lúc chờ.
  Sau restart, lịch chờ và checkpoint vẫn còn. Khi tắt máy, không có xử lý cho
  đến lúc Docker/worker hoạt động lại.
- Mặc định tối đa 8 lần lên lịch lại liên tiếp, 30 phút chờ liên tục, 20 lượt
  cộng dồn mỗi tác vụ. Khi đã sinh nội dung thành công và lưu tiến độ, ngân sách
  liên tiếp được làm mới; tổng lượt vẫn giữ. Nếu Google yêu cầu chờ vượt ngân
  sách, dừng có thông báo thay vì gọi sớm hơn thời điểm đó hoặc thử vô hạn.
- Hạn mức ngày được chặn đến mốc reset RPD theo giờ Pacific, tính cả PST/PDT;
  job vẫn ở `failed`, không tự chạy lại. Cần kiểm tra quota/billing rồi bấm
  **Tiếp tục từ phần lỗi**. Thao tác thủ công cho phép kiểm tra lại gate ngày/quota
  bằng 0 của scope hiện tại; nếu quota vẫn hết sẽ dừng lại. Không suy ra hạn mức
  ngày chỉ từ một HTTP 429. Tham khảo [Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)
  và [Troubleshooting](https://ai.google.dev/gemini-api/docs/troubleshooting) của Google.
- UI hiển thị **Chờ Gemini thử lại**, bộ đếm và thời điểm tiếp tục; không cần giữ
  trang mở hoặc bấm retry trong lúc chờ. Hủy vẫn có hiệu lực. Khi dừng hẳn, UI
  hiển thị mã lỗi/HTTP/bước; log chỉ ghi các trường cho phép, không in raw SDK
  exception, URL có khóa, tài liệu hay API key. Lỗi Gemini không bị gán nhầm
  thành lỗi PostgreSQL/Keycloak.
- Tùy chọn trong `backend/.env`: `GEMINI_MIN_INTERVAL_MS=4000` (1.000–60.000),
  `GEMINI_MAX_AUTO_RETRIES=8` (1–12), `GEMINI_RETRY_WINDOW_MINUTES=30` (5–120).
  Giá trị mặc định chỉ là giới hạn vận hành thận trọng, không phải quota đã xác
  minh của tài khoản. Chỉnh theo hạn mức của project trên AI Studio. Chế độ Docker
  cần `node backend/scripts/init_docker_local.js --refresh` rồi recreate Backend/worker
  để nhận env; không in hoặc gửi API key vào cuộc trò chuyện.

Đã backup `keycloak/backups/app-postgres-1792660477231.dump`, áp dụng migration 005,
build/cập nhật Backend/worker/Frontend local ngày 22/10/2026. Không tự đưa các job
lỗi cũ vào hàng đợi; bấm tiếp tục một lần nếu cần, sau đó dùng cơ chế mới. Chưa
giả lập lỗi, chạy bộ test hay chủ động gọi Gemini/TTS để đo cơ chế này.

| Hiện tượng | Cách xử lý |
| --- | --- |
| Setting up fake worker failed / Failed to fetch dynamically imported module pdf.worker…mjs | Kiểm tra worker trả HTTP 200 và Content-Type text/javascript. Nginx cần ánh xạ mjs trong types; Frontend dùng worker đóng gói chung và URL module=1 để tránh cache MIME cũ. Build/cập nhật Frontend, Ctrl+F5 rồi chọn lại PDF; lỗi này xảy ra trước Gemini/TTS |
| Chờ mãi ở hàng đợi | Chạy `npm run worker:books`, kiểm tra DATABASE_URL của Backend/worker trùng nhau |
| Gemini tạm giới hạn/quá tải/timeout/mạng | Chờ trạng thái tự thử lại; xem thời điểm và bộ đếm. Nếu hết ngân sách, kiểm tra mã lỗi/log rồi tiếp tục |
| Gemini hết hạn mức ngày / quota bằng 0 / từ chối quyền | Kiểm tra quota, billing, model và API key trên AI Studio; sau khi xử lý bấm Tiếp tục từ phần lỗi |
| Lỗi khóa nội bộ Engine | Giữ cùng `.env.books.local` / `BOOK_ENGINE_SECRET` ở cả ba dịch vụ, restart cả ba |
| Lỗi tạo đoạn | Kiểm tra Edge-TTS, internet, FFmpeg/FFprobe và OpenVoice nếu clone; retry phần lỗi |
| Edge-TTS từ chối kết nối HTTP 403 | Dùng `edge-tts==7.3.1` trong venv Engine theo `engine/README.md`, restart Engine/worker rồi tiếp tục job; nếu vẫn lỗi kiểm tra log/dịch vụ. Không retry tự động liên tiếp với lỗi 403 đã nhận diện |
| Nguồn quá ngắn | Thêm các chương còn thiếu hoặc chọn mốc ngắn hơn, gửi yêu cầu mới |
| Kịch bản lệch ngân sách | Dùng worker mới rồi tiếp tục job; xem tiến độ số âm tiết hiện tại/mục tiêu. Bản nháp được giữ để chỉnh trực tiếp; độ lệch lớn vẫn cần chỉnh hoặc đổi thời lượng |
| Worker restart chưa nhận ngay | Chờ lease cũ hết hạn (khoảng 90 giây); theo dõi yêu cầu trong UI |

## Tiêu đề mục tiếng Việt

Tiêu đề được kiểm tra riêng vì ngắn hơn ngưỡng phát hiện mất dấu của đoạn văn.
Schema dàn ý yêu cầu title/focus viết tiếng Việt đầy đủ dấu; nếu nhận diện tiêu đề
thiếu dấu, worker yêu cầu Gemini viết lại danh sách tiêu đề tối đa 2 lượt, giữ
số mục/thứ tự/phạm vi và tên riêng nước ngoài. Áp dụng cả dàn ý đã lưu khi tiếp tục
review-v1; không viết lại nội dung đã có chỉ vì tiêu đề sai. Đây là kiểm tra theo
dấu hiệu ngôn ngữ, không phải bộ kiểm tra chính tả hoàn chỉnh.

Ngày 22/10/2026 đã sửa 8 tiêu đề của bản nháp hiện tại sau backup
`keycloak/backups/app-postgres-1792680866007.dump`, tăng phiên bản bản nháp và
đồng bộ checkpoint; nội dung đoạn văn giữ nguyên. Tải lại yêu cầu để nhận phiên bản mới.

## Điều chỉnh cách đọc và xuất SRT — bước 2, 3, 5 (22/10/2026)

### Thao tác trên giao diện

- Bài giảng và bản nháp sách nói có khối **Nhịp đọc và phụ đề**. Đặt con trỏ vào vị trí cần nghỉ, chọn 0,3 / 0,5 / 1 giây hoặc nhập 0–2 giây. Có thể tự nhập `[nghỉ 0.5s]`, `[pause 0.5s]`, `<break time="0.5s" />`. Không chèn giữa một từ. Mỗi chỉ dẫn tạo một khoảng lặng thực trong file.
- Chọn phong cách chung hoặc mở **Phong cách từng mục và đoạn** để thay riêng. Một dòng trống phân chia đoạn; thay số đoạn sẽ đặt lại các lựa chọn đoạn của mục đó để tránh áp dụng nhầm.
- Năm phong cách: Tự nhiên (0%, nghỉ đoạn/mục 400/650 ms), Giảng giải (−4%, 600/850 ms), Kể chuyện (−5%, 550/800 ms), Bản tin (+8%, 250/450 ms), Thư giãn (−10%, 750/1000 ms). Chỉ dẫn nghỉ tường minh thay khoảng nghỉ mặc định tại vị trí đó. Cao độ giữ nguyên; không tạo cảm xúc diễn xuất.
- Chuẩn hóa đọc hỗ trợ số nguyên, một số dạng thập phân/phân nhóm theo quy ước tiếng Việt, ngày hợp lệ `dd/mm/yyyy`, đơn vị kg/km/cm/mm/ml/%/₫/đ. URL/email được giữ nguyên. Từ điển tối đa 50 mục, khớp cả từ/cụm; hỗ trợ tên riêng và chữ viết tắt. Cần kiểm tra bản xem cách đọc, đặc biệt định dạng số dễ gây hiểu khác nhau.
- Bấm **Xem cách đọc** trước **Nghe thử** hoặc **Duyệt và tạo âm thanh**. Mỗi thay đổi làm bản xem cũ hết hiệu lực. Phần xem cách đọc xử lý quy tắc tại Backend, không gọi Gemini hay TTS. Nghe thử mới gọi Engine, tối đa 30 giây và không thêm lịch sử.
- Khi hoàn tất, tải SRT ở kết quả hoặc lịch sử. **Mốc đoạn theo thời lượng WAV đo thực tế, mốc câu trong đoạn phân bổ theo độ dài chữ**; chưa dùng nhận dạng/forced alignment để căn từng từ. SRT bỏ qua khoảng lặng chủ động giữa đoạn. Kết quả cũ không được tự tạo lại phụ đề.

### Lưu trữ và giới hạn

- `draft.sections[].text` giữ lời văn đối chiếu nguồn; `delivery.markup` giữ chỉ dẫn nghỉ; `draft.speech` giữ chuẩn hóa/từ điển/phong cách chung, `delivery.profile/paragraph_profiles` giữ lựa chọn riêng. Thay cách đọc không tự thay lời văn nguồn hay gọi lại Gemini đối chiếu; sửa lời văn làm mất xác nhận đối chiếu cũ.
- Hash bản đọc gồm nội dung sẽ đọc, nhịp và cấu hình. API kiểm tra hash cùng `draft_revision` trước khi xếp hàng; worker hash riêng từng đoạn để tránh dùng nhầm cache. AI chỉnh lời văn sẽ bỏ các chỉ dẫn nghỉ/lựa chọn theo đoạn của mục bị viết lại.
- Bài giảng mới nhận tối đa 20.000 ký tự và 80 đoạn TTS; bản tóm tắt sách giữ giới hạn 250.000 ký tự và tối đa 300 đoạn. Giới hạn một khoảng nghỉ 2 giây; quá nhiều chỉ dẫn bị từ chối. Âm thanh vẫn phải dưới 1 giờ. Bài giảng tạo đồng bộ có giới hạn một lượt trên mỗi tiến trình Backend; chưa có phục hồi checkpoint như worker sách nói.
- History thêm `speech_config`, `subtitle_url`, `subtitle_timing`; SRT lưu cùng MP3 trên R2 hoặc local. Route tải phụ đề kiểm tra chủ sở hữu; cleanup job bỏ dở có thể dọn SRT chưa xuất bản, giữ kết quả đã lưu lịch sử.
- Giữ tương thích job cũ: luồng legacy tiếp tục như cũ. Bản nháp review đang có có thể dùng cấu hình mới sau khi lưu; các job đã hoàn tất không tự thay đổi audio.

### Cập nhật Docker

Build Backend/Frontend/Engine, dừng worker và Backend có chờ hoàn tất bước đang chạy, backup `tts_app`, áp dụng migration `007-speech-subtitles`, sau đó bật stack:

```powershell
docker compose --env-file keycloak/.env -f keycloak/compose.yaml -f deploy/compose.app.yaml build backend frontend engine
docker compose --env-file keycloak/.env -f keycloak/compose.yaml -f deploy/compose.app.yaml stop worker backend
node backend/scripts/backup_app_postgres.js
docker compose --env-file keycloak/.env -f keycloak/compose.yaml -f deploy/compose.app.yaml run --rm --no-deps backend node scripts/migrate_postgres_schema.js
.\deploy\stack.ps1 up
```

Migration 007 đã áp dụng local ngày 22/10/2026 sau backup `keycloak/backups/app-postgres-1792684119927.dump`; các service runtime đã cập nhật và healthy. Chỉ kiểm tra cú pháp/build/trạng thái vận hành, chưa tạo hoặc nghe audio thật trong lượt triển khai.

Không thực hiện `down -v`, import hoặc seed lại dữ liệu. Chỉ triển khai bước 2, 3, 5; bỏ bước 1 (thanh tốc độ/cao độ độc lập) và bước 4 (nhà cung cấp TTS diễn cảm mới).

## Hủy và xóa yêu cầu

- Chọn yêu cầu trong **Yêu cầu gần đây**, bấm **Hủy và xóa yêu cầu** rồi xác nhận. Yêu cầu lỗi/đã hủy có nút **Xóa yêu cầu**. Thao tác áp dụng cho yêu cầu chưa hoàn tất; không thể tiếp tục sau khi xóa.
- API `DELETE /api/book-jobs/:id` kiểm tra chủ sở hữu, khóa hàng trong transaction và đánh dấu `delete_requested`/`cancel_requested`. Yêu cầu biến mất khỏi danh sách ngay, không còn mở chi tiết, chỉnh sửa hoặc retry được. Không cho hủy khi đang xuất bản hoặc đã có bản ghi lịch sử.
- Nếu queued/review/failed, chuyển sang cancelled ngay. Nếu processing, đợi lượt AI/Engine đang chạy trả về rồi guard dừng trước bước tiếp theo. Không thu hồi được lượt gọi API đã gửi; không ngắt cả Engine đang phục vụ hệ thống.
- Worker dọn khi không còn công việc cần nhận: thư mục riêng của job ở Engine, đoạn WAV, bản nghe thử và MP3 chưa xuất bản có đúng ID job trên local/R2. Dọn thất bại sẽ thử lại. Worker/Engine tắt thì yêu cầu vẫn ẩn, việc dọn chờ dịch vụ hoạt động. File đã xuất bản vào lịch sử và giọng mẫu được bảo vệ.
- Sau khi dọn, xóa source/checkpoint/draft/metadata/voice/retry/result của job. Giữ hàng đánh dấu với ID/chủ sở hữu/request_id và các trường vận hành bắt buộc để một lần gửi lại do lỗi mạng không tạo lại yêu cầu đã xóa (trả HTTP 410). Cache phân tích dùng chung theo chủ sở hữu/nguồn vẫn hết hạn theo TTL hiện có; không xóa cache đang có thể phục vụ yêu cầu khác.
- Migration `006-book-discard` đã áp dụng ngày 22/10/2026 sau backup `keycloak/backups/app-postgres-1792662792936.dump`. Đã kiểm tra cú pháp và build; chưa tạo job hoặc chạy kiểm thử hủy thực tế trong lượt triển khai.

Không lưu access token người dùng vào công việc. API nội bộ `/book/*` yêu cầu khóa riêng và xác thực ID/đường dẫn; frontend gọi qua Backend. Backup PostgreSQL ứng dụng bằng `npm run backup:postgres`, bao gồm cả bảng công việc; backup file/R2 riêng nếu muốn tiếp tục những sách đang xử lý sau phục hồi.


## Tải trước Edge-TTS (23/10/2026)

Luồng tạo toàn bộ sách `review-v1` và bài giảng có nhịp đọc tải trước theo cửa sổ,
không gửi toàn bộ sách lên Edge cùng lúc:

```text
Edge-TTS: chuẩn bị tối đa 3 đoạn kế tiếp → cache nền riêng theo job/part
                                      ↓
OpenVoice/chuẩn hóa: lấy đoạn theo đúng thứ tự → lưu checkpoint → ghép MP3/SRT
```

- Backend/worker: `EDGE_TTS_PREFETCH_CONCURRENCY=3`, chấp nhận 1–3. Đặt `1`
  để bỏ prefetch và chạy tuần tự trong từng job. Engine:
  `EDGE_TTS_MAX_CONCURRENCY=3`, chấp nhận 1–3, giới hạn tổng network Edge
  của sách/bài giảng. Muốn giới hạn toàn hệ thống về một lượt, đặt cả hai bằng 1.
  Sửa env của đúng chế độ đang chạy rồi recreate container hoặc restart terminal.
- Worker khởi động phiên qua `/book/prefetch/open`, gọi `/book/prefetch` đồng thời,
  rồi `/book/part` lần lượt; `/book/prefetch/close` hủy tải nền khi kết thúc/lỗi/hủy.
  Các endpoint giữ khóa nội bộ BOOK_ENGINE_SECRET. Engine dùng `asyncio.to_thread`
  để chờ CLI mà không chặn ASGI; semaphore và instance riêng giới hạn đồng thời.
  Không cần phụ thuộc event loop Windows hỗ trợ async subprocess hay không.
- Network Edge nằm ngoài ENGINE_LOCK; OpenVoice và embedding vẫn khóa tuần tự.
  Nếu một đoạn sẵn sàng, clone ngay trong lúc Edge chuẩn bị đoạn sau, không đợi đủ
  cả nhóm. Mỗi part giữ giọng, nhịp, cao độ và khoảng nghỉ của payload đã duyệt.
- Cache `edge_<part_id>.mp3` + JSON đối chiếu chữ ký payload (bỏ URL ký tạm).
  Chỉ công bố khi file hoàn chỉnh/đo được thời lượng; dùng lại sau lỗi/restart.
  Xuất WAV thành công thì bỏ cache nền của đoạn. WAV/checkpoint/R2 và thứ tự SRT
  giữ nguyên. Prefetch lỗi tạm để `/book/part` thử lại theo cơ chế cũ; lỗi 403
  nhận diện không thử dồn hoặc chuyển giọng khác.
- Guard kiểm tra hủy/quyền/lease mỗi 2 giây. Đóng phiên hủy CLI tải trước, đợi
  writer kết thúc; cleanup không xóa khi writer còn ghi. OpenVoice đang inference
  được phép hoàn tất đoạn hiện tại; guard chặn bước tiếp theo/xuất bản khi hủy.
  Yêu cầu đã hủy vẫn ẩn và được dọn theo cơ chế hiện có.
- VieNeu đi nhánh riêng, không dùng prefetch Edge. Preview và workflow legacy
  giữ cách gọi tuần tự. Không đổi phần phân tích/viết/đối chiếu Gemini.
- Log `[EDGE PREFETCH] ready/cache_hit/window` và `[BOOK TIMING] stage=edge_prefetch`
  giúp phân biệt chờ mạng với clone. Các thời gian lời gọi có thể chồng lấp, không
  cộng thành tổng thời gian thực. Chưa benchmark đầu-cuối; tốc độ còn phụ thuộc
  Gemini, mạng, CPU/GPU OpenVoice và upload.


## Tốc độ đọc chung và bản duyệt (23/10/2026)

- Sidebar giữ nút 10/20/30 phút gọn và ô nhập 1–59 phút. Slider **Tốc độ đọc**
  0,75x–1,50x, bước 0,05x; 1,00x là tốc độ chuẩn. Đây là tốc độ khi tạo file,
  không phải playbackRate của trình phát. Áp dụng cho cả lời giới thiệu và tất cả
  các mục/đoạn. Tốc độ này ghi đè rate của preset, không thay pause/pitch.
- Backend xác thực `speech.rate_percent` nguyên -25..50; Engine nhận cùng giới hạn.
  Edge sinh audio theo rate trước bước OpenVoice. VieNeu tạo tiếng nói rồi đổi
  tốc độ bằng FFmpeg atempo. Ước lượng thời lượng, cache, preview và SRT dùng
  kế hoạch chứa rate mới. Không đổi giọng hoặc provider khi kéo slider.
- Yêu cầu sách mới lưu cấu hình trong checkpoint.initial_speech, đưa vào bản nháp.
  Bản cũ thiếu rate vẫn dùng preset/hash cũ nếu chưa lưu cấu hình mới. Không cần
  migration DB. Sau khi có bản duyệt, slider tại cột phải chỉnh bản nháp đang mở;
  thao tác nghe thử/tạo sẽ lưu lại cấu hình trước khi gửi yêu cầu.
- Đã bỏ nút chèn nghỉ tại con trỏ; parser vẫn đọc chỉ dẫn nghỉ trong bản cũ.
  Nghỉ theo phong cách, chuẩn hóa số/từ điển và SRT giữ nguyên trong tùy chọn đọc.
- Nút **Nghe thử tối đa 30 giây** và **Duyệt và tạo âm thanh** không còn phụ thuộc
  thao tác Xem cách đọc thủ công. UI tự lập kế hoạch không qua AI; khi nhấn nút,
  lưu đúng draft revision, tính hash từ bản đã lưu rồi gửi preview/audio. Lỗi
  xác thực được hiển thị bằng popup. Phiên bản xung đột/nội dung không hợp lệ/
  giới hạn 1 giờ/đối chiếu nguồn vẫn được kiểm tra như trước.


### Tinh gọn sidebar và bỏ bước Xem cách đọc (23/10/2026)

Các ô chọn giọng cách nhau 20 px. Ghi chú ngay dưới slider cho biết tốc độ có thể
đổi sau khi có bản tóm tắt, trước khi tạo âm thanh. Đã bỏ toàn bộ nút và khung
Xem cách đọc. Hệ thống vẫn tự lập kế hoạch để ước lượng và kiểm tra hash trước
nghe thử/tạo âm thanh; không cần thao tác xác nhận cách đọc riêng. Bài giảng thực
hiện ensurePlan khi bấm nút nên không bị kẹt nếu lần chuẩn bị tự động chưa xong
hoặc gặp lỗi mạng; xác thực backend và giới hạn thời lượng giữ nguyên.
