# Hệ Thống Sinh Bài Giảng Tự Động (Voice Cloning TTS)

Dự án niên luận: hệ thống chuyển văn bản thành bài giảng dạng âm thanh bằng công nghệ
TTS tiếng Việt và nhân bản âm sắc (Voice Cloning), với tài khoản người dùng và trang
quản trị dành cho admin.

Hệ thống được thiết kế theo mô hình Microservices với 3 thành phần chính:

## Quy trình tạo sách nói

Khởi tạo mẫu chuẩn (khi cần): từ thư mục `backend` chạy `node seed_voices.js`.
Script chỉ bổ sung hai mẫu `male`/`female` còn thiếu, giữ nguyên các giọng đã có
và quyền sở hữu. Giọng Thanh Hòa là giọng riêng của tài khoản tải lên, không thuộc seed hệ thống.

Xem [QUY_TRINH_TAO_SACH_NOI.md](QUY_TRINH_TAO_SACH_NOI.md) để theo dõi toàn bộ
quy trình từ chọn sách/phút/giọng/tốc độ, Gemini phân tích–viết–đối chiếu, duyệt
và nghe thử đến xuất MP3/SRT, lưu lịch sử và tiếp tục khi có lỗi.

## Kiến Trúc Hệ Thống

1. **Frontend (Vue.js 3 + Vite):**
   - Giao diện người dùng: tạo bài giảng từ văn bản hoặc file (.txt/.docx/.pdf), chọn
     giọng đọc mẫu và phong cách đọc, nghe kết quả ngay trên trình duyệt.
   - Trang **Sách Nói AI**: nhập thời lượng 1–59 phút, tự chọn giọng; AI tạo và đối chiếu bản tóm tắt, cho phép xem/chỉnh tay hoặc nhờ AI sửa, nghe thử rồi duyệt tạo âm thanh; xử lý nền, tiếp tục khi lỗi và nghe trong lịch sử.
   - Trang **Quản Trị** (chỉ admin): quản lý người dùng (role, trạng thái) và giọng đọc mẫu.
   - Thư mục: `frontend/` — Cổng mặc định: `5173`

2. **Backend Gateway (Node.js + Express):**
   - Cầu nối giữa Frontend và AI Engine, đồng thời host tĩnh các file âm thanh kết quả.
   - Xác thực access token Keycloak bằng JWKS, phân quyền `user`/`admin`; **PostgreSQL `tts_app`** giữ hồ sơ, giọng mẫu, lịch sử và công việc sách nói; database `keycloak` tách riêng cho xác thực.
   - Tích hợp Google Gemini cho tính năng tóm tắt sách.
   - Thư mục: `backend/` — Cổng mặc định: `3000` (cấu hình qua biến `PORT`)

3. **AI Engine (Python + FastAPI):**
   - Sinh giọng nói tiếng Việt bằng **Edge-TTS** (fallback gTTS) và nhân bản âm sắc
     bằng **OpenVoice V2** (ToneColorConverter), hỗ trợ GPU CUDA.
   - Thư mục: `engine/` — Cổng mặc định: `8000`

```
Frontend (5173) ──► Backend Gateway (3000) ──► AI Engine (8000)
                        ├── PostgreSQL tts_app      └─ Edge-TTS + OpenVoice V2
                        ├── Gemini
                        └── R2
Frontend ──► Keycloak (8080) ──► PostgreSQL keycloak (database riêng)
```

## Chuyển database ứng dụng sang PostgreSQL

Mã hiện tại dùng `pg` và database `tts_app`, giữ nguyên ID đã liên kết Keycloak.
**Ngày 17/10/2026 đã chuyển dữ liệu local:** 3 tài khoản (1 admin), 3 giọng mẫu và 1 worker lease;
nguồn hiện không có lịch sử/job sách nói. Backend và worker đã kết nối PostgreSQL.
Trên máy hiện tại không cần nhập lại khi khởi động; khi dựng từ nguồn khác cần hoàn tất nhập
trước khi bật Backend/worker. Xem [POSTGRES_MIGRATION.md](POSTGRES_MIGRATION.md).
MongoDB nguồn được giữ nguyên để backup/đối chiếu. Phần công cụ MongoDB Phase 2–3 bên dưới là lịch sử;
các công cụ ghi nguồn và bộ kiểm thử MongoDB cũ được khóa khi có cấu hình PostgreSQL.

## Hướng Dẫn Cài Đặt & Khởi Chạy

### Phase 4 — Thực hiện từng mục

Xem [PHASE4.md](PHASE4.md). Ngày 20/10/2026 đã hoàn thành **1a–1c: đóng gói và bật
stack local bằng Compose**: Frontend/Nginx, Backend, worker, Engine CPU, PostgreSQL,
Keycloak và Mailpit. Đã đọc trạng thái cả 7 service `healthy`; Engine nạp được model,
Backend/worker kết nối database hiện có. Chưa kiểm thử toàn luồng đăng nhập/Gemini/TTS
trong Docker. Các mục chọn máy chủ, cấu hình production và deploy thực hiện sau.

**Trên máy hiện tại**, mở Docker Desktop, đợi Engine running; từ thư mục gốc chạy:

```powershell
.\deploy\stack.ps1 up
```

Mở **http://localhost:5173**. Worker đã nằm trong stack, không cần chạy thêm
`node server.js`, `npm run dev`, `python main.py` hoặc `npm run worker:books`.
Frontend Docker dùng bản build; sau sửa mã cần build lại image tương ứng rồi `up`.

```powershell
.\deploy\stack.ps1 status
.\deploy\stack.ps1 logs -Service engine
.\deploy\stack.ps1 build
.\deploy\stack.ps1 up
.\deploy\stack.ps1 stop
```

Khi dựng cấu hình Docker lần đầu trên bản dự án đã có bốn file env private của
Backend và dữ liệu PostgreSQL đã chuyển, chạy `.\deploy\stack.ps1 prepare`,
rồi `build`, `up`. Máy hiện tại đã hoàn tất, không cần `prepare` lại. Nếu đổi
API key/secret trong env Windows, dùng `node backend/scripts/init_docker_local.js --refresh`,
rồi `up` để các container nhận cấu hình mới. Env Docker bị Git bỏ qua, không nằm trong image.

Stack tái sử dụng volume PostgreSQL và các thư mục âm thanh cũ, không chuyển dữ liệu
lên cloud. Không dùng `down -v`. Hướng dẫn chuyển lại chế độ terminal và lưu dữ liệu
nằm ở [PHASE4.md](PHASE4.md). Các bước chạy thủ công bên dưới dành cho chế độ phát triển;
dừng service Docker tương ứng trước để tránh trùng cổng hoặc có hai worker.

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
├── assets/theme.css            # Bảng màu sáng/tối dùng chung
└── assets/workspace.css        # Bố cục studio và thành phần giao diện
```

Đường dẫn ứng dụng: `/`, `/book`, `/history`, `/admin`, thêm `/profile` và `/voices`.

### Hồ sơ và thư viện giọng (25/10/2026)

- Bấm avatar hoặc **Thông tin cá nhân** để đổi tên/giới tính, đồng bộ Keycloak.
  Nút **Quản lý tài khoản** mở phần đổi email, mật khẩu và phiên đăng nhập.
- Bấm ô giọng đọc để mở một popup thống nhất: **Giọng hệ thống** gồm preset
  của model đang chọn và mẫu admin upload; **Giọng của bạn** gồm mẫu riêng của
  tài khoản. Có nút **Thêm giọng mới**, tìm tên, lọc Free/Gold/Diamond, nghe mẫu
  tối đa 30 giây và chọn. Không còn ô Loại giọng đọc; mode xử lý tự suy từ giọng
  đã chọn. Ô chọn chỉ hiện tên, không nối giới tính hoặc phạm vi.
- Admin tải lên giọng chung và sửa tên, giới tính, mô tả, `class`. User tải lên
  giọng riêng ở **Giọng của bạn**, chỉ chủ sở hữu thấy và sửa/ẩn được; admin
  khác cũng không xem hoặc sử dụng giọng riêng. User không sửa/ẩn giọng chung.
- `class` và `account_class` là dữ liệu chuẩn bị: chưa triển khai thu phí,
  nâng cấp Gold/Diamond hoặc khóa giọng theo gói. Dữ liệu cũ mặc định Free.
- Migration `009-profiles-voice-library` đã áp dụng local sau backup. Trên máy
  khác, sao lưu và chạy `npm run db:migrate` trước khi bật mã mới. File giọng
  mẫu local không còn được truy cập công khai qua `/public/audio/samples`;
  dùng API nghe mẫu có xác thực. Hai nhánh Edge/OpenVoice và VieNeu giữ nguyên.
Router tải trang theo nhu cầu và giữ guard quyền quản trị.

### Giao diện sáng/tối

Nút biểu tượng mặt trời/mặt trăng ở góc trên bên phải xuất hiện trên trang chào
và trong không gian người dùng/quản trị. Bấm để đổi **Light/Dark mode**. Lần đầu
truy cập theo chế độ của hệ điều hành; sau khi chọn, trình duyệt ghi nhớ bằng
`localStorage` với khóa `text2speech.theme` và đồng bộ giữa các tab cùng địa chỉ.
Nếu trình duyệt chặn lưu trữ, vẫn đổi được trong lần truy cập hiện tại.

Giao diện studio dùng thanh bên xanh đậm, điểm nhấn xanh ngọc, banner âm thanh,
biểu mẫu và bảng quản trị theo cùng bảng màu. `assets/theme.css` định nghĩa màu;
`composables/useTheme.js` quản lý lựa chọn; `ThemeToggle.vue` dùng chung nút chuyển
và `StudioBanner.vue` dùng chung phần giới thiệu trang. Theme được áp dụng từ
`index.html` trước khi khởi tạo đăng nhập để hạn chế nháy nền sáng.
Trang đăng nhập/đăng ký, quên mật khẩu và đặt mật khẩu mới của Keycloak cũng dùng
cùng bảng màu và có nút sáng/tối. Trên local, mở web bằng `localhost:5173` để chia sẻ
lựa chọn với Keycloak `localhost:8080` qua cookie tùy chọn `tts_theme` (chỉ chứa
`light`/`dark`). Chi tiết đồng bộ bảng màu và giới hạn hostname trong
[keycloak/THEME.md](keycloak/THEME.md).

### Tiếng Việt / English

Bộ chọn ngôn ngữ nằm ở góc trên bên phải, trên trang chào và trong không gian user/admin.
Đổi ngôn ngữ cập nhật nhãn, điều hướng, biểu mẫu, các trạng thái và ngày/số hiển thị
ngay trong Vue, giữ nguyên nội dung đang nhập và dữ liệu người dùng. Mặc định tiếng Việt;
lưu lựa chọn trong `text2speech.locale` (localStorage) và cookie tùy chọn `tts_locale`.

Đăng nhập/đăng ký dùng URL do SDK Keycloak tạo (giữ PKCE/state/nonce), kèm `ui_locales`
và `kc_locale` theo lựa chọn. Bộ chọn ngôn ngữ gốc trên Keycloak vẫn hoạt động, đồng bộ
lại với web khi dùng cùng hostname `localhost` và quay lại trang/tab. Cookie chỉ chứa
`vi` hoặc `en`, cùng phạm vi/thuộc tính bảo vệ như tùy chọn theme; xem `keycloak/THEME.md`.

Mã dịch ở `composables/useLocale.js`, bản dịch ở `locales/en.json`, bộ chọn ở
`components/LocaleSelector.vue`. `$t` dùng chuỗi nguồn tiếng Việt làm khóa, hỗ trợ
tham số và một số thông báo tiến độ/API đã biết. Thông báo kỹ thuật chưa có trong
từ điển được giữ nguyên để không mất chẩn đoán. Tên sách, tên giọng, văn bản nguồn,
kịch bản/kết quả AI và ngôn ngữ âm thanh không bị dịch khi chuyển giao diện.

Khi thêm giọng mẫu, **mã giọng phải duy nhất**, kể cả các giọng đã ẩn; `male`, `female`
và `male_ThanhHoa` đã được dùng cho giọng mặc định. Ví dụ mã mới: `male_hn_2` hoặc
`my_voice_2`. Website hiển thị giọng theo bản ghi PostgreSQL; chỉ có file trên R2 chưa
đủ để xuất hiện trong thư viện. Khi bị từ chối, lỗi hiển thị ngay trong biểu mẫu.

Ngoài stack Keycloak local, chạy Frontend và Backend trên các terminal riêng.
Khi tạo âm thanh, chạy thêm AI Engine.

### Thông báo và xác nhận

Web dùng popup theo giao diện Text2Speech, hỗ trợ sáng/tối và Việt/Anh.
Xác nhận hủy/xóa, bỏ chỉnh sửa, đổi quyền và đăng xuất dùng hộp thoại ở giữa;
kết quả thao tác/lỗi dùng popup góc màn hình (có đóng và nút thử lại khi phù hợp).
Đăng nhập có lời chào theo tên, một lần cho mỗi phiên đăng nhập trong tab;
hồ sơ mới được Backend tạo sau xác thực sẽ nhận lời chúc đăng ký thành công.
Không hiện thành công chỉ vì người dùng bấm mở trang đăng ký.
Tiến độ xử lý và hướng dẫn gắn với biểu mẫu vẫn nằm trong trang.
Theme Keycloak cũng hiển thị thông báo máy chủ bằng popup cùng bảng màu.

### Sách nói tùy chọn 1–59 phút

Xem [BOOK_AUDIO.md](BOOK_AUDIO.md) để cấu hình và vận hành luồng sách nói dài.

Luồng mới `review-v1` (22/10/2026) dừng ở **Chờ duyệt nội dung**: đọc lại bản tóm tắt,
chỉnh trực tiếp hoặc yêu cầu AI sửa từng mục/toàn bộ, nghe thử tối đa 30 giây,
rồi **Duyệt và tạo âm thanh**. AI viết từ các đoạn nguồn liên quan, giữ rõ tên,
quan hệ và nguyên nhân–kết quả, đối chiếu trước TTS; không bảo đảm phát hiện mọi sai sót.
Nhịp đọc có khoảng nghỉ theo đoạn và thay tốc độ nhẹ, vẫn dùng Edge-TTS/OpenVoice.
Nguồn ngắn có thể trả bản ngắn hơn mục tiêu để tránh kéo dài/lặp ý.
Mã mới yêu cầu migration **004-book-editorial-review** sau backup và build/restart
Backend, worker, Engine, Frontend; xem lệnh cập nhật trong BOOK_AUDIO.md. Job cũ
giữ luồng cũ, cần tạo yêu cầu mới để dùng bước duyệt.

Cơ chế Gemini mới dùng migration **005-book-ai-retry** (đã áp dụng local): điều
tiết RPC, phân biệt 429/quota ngày/503/timeout/mạng/quyền, lưu lịch chờ và tự
tiếp tục từ checkpoint. UI báo thời điểm thử lại; hết quota ngày hoặc hết ngân
sách tự thử thì dừng có thông báo. Xem cấu hình và giới hạn trong BOOK_AUDIO.md.

Trong **Yêu cầu gần đây**, chọn yêu cầu rồi bấm **Hủy và xóa yêu cầu**
(yêu cầu lỗi/đã hủy dùng **Xóa yêu cầu**). Sau xác nhận, yêu cầu biến mất khỏi
danh sách; worker dừng sau bước đang chạy và dọn bản nháp/file tạm. Nếu worker
đang tắt, việc dọn chờ đến khi bật lại. Chức năng dùng migration
**006-book-discard** đã áp dụng local; không hủy kết quả đã hoàn tất/đang lưu lịch sử.

Từ `backend`, chạy `npm run books:init` một lần, sau đó chạy thêm
`npm run worker:books` trên terminal riêng cùng Backend, Engine và Frontend.
Điền Gemini API key thật trong `backend/.env`; thời lượng là gần đúng theo tốc độ
giọng đo được, kết quả hiển thị thời lượng thực tế. Worker lưu từng phần vào PostgreSQL,
giúp tiếp tục sau lỗi hoặc restart. Khóa nội bộ/file tạm bị Git bỏ qua.
Ba mốc 10/20/30 vẫn là nút chọn nhanh; ô nhập nhận số phút nguyên 1–59.
Frontend, API và PostgreSQL đều kiểm tra phạm vi. Worker kiểm tra âm thanh thực tế
dưới 1 giờ trước khi lưu; nếu vượt giới hạn, yêu cầu báo lỗi để chọn thời lượng ngắn hơn,
không tự cắt hoặc tăng tốc âm thanh. Sau cập nhật cần restart Backend và worker.
Người dùng chọn giọng cụ thể: Nam Minh/Hoài My với giọng tiêu chuẩn; giọng chung/giọng riêng
đang hoạt động với mẫu clone. Gemini chỉ lập dàn ý/kịch bản và chọn nhịp đọc. Giọng được
lưu theo từng job, giữ khi retry; muốn đổi giọng cho job cũ cần gửi yêu cầu mới.
Trang sách nói có tên tác phẩm, tác giả và nguồn do người dùng nhập; kết quả/lịch sử
hiển thị nhãn “Bản tóm tắt do AI hỗ trợ”, âm thanh có lời giới thiệu nguồn. Hướng dẫn
AI yêu cầu tổng hợp bằng cách diễn đạt riêng, tránh chép nguyên văn và kể lại quá chi tiết.
Đây là biện pháp giảm rủi ro, không xác minh giấy phép hoặc bảo đảm không vi phạm bản quyền.

### VieNeu-TTS dùng thử (tùy chọn)

Bài giảng và Sách nói có **Bộ tạo giọng** để chọn **VieNeu-TTS** hoặc **Edge-TTS + OpenVoice**. Engine cũ giữ mặc định, các job cũ không tự đổi model. VieNeu v3 Turbo chạy service riêng, CPU trên laptop hiện tại; có overlay CUDA dành cho PC RTX 4060 khác của người dùng. Xem [VIENEU.md](VIENEU.md) để dùng thử, build, chuyển cấu hình GPU và đánh giá phương án cloud + PC trong hai ảnh đề xuất. Chưa tách hạ tầng cloud chỉ bằng việc đổi ENGINE_URL.

### Điều chỉnh nhịp đọc và phụ đề (bước 2, 3, 5)

Trong **Tạo bài giảng** hoặc bản nháp **Sách nói**, có khối **Nhịp đọc và phụ đề**:

1. Đặt con trỏ trong nội dung, bấm khoảng nghỉ có sẵn hoặc nhập 0–2 giây rồi **Chèn nghỉ**. Chỉ dẫn dạng `[nghỉ 0.5s]` được chuyển thành khoảng lặng, không đọc thành lời.
2. Chọn **Tự nhiên / Giảng giải / Kể chuyện / Bản tin / Thư giãn** cho toàn bài, từng mục hoặc từng đoạn. Dùng một dòng trống để phân chia đoạn.
3. Nếu cần, bật chuẩn hóa số/ngày/đơn vị và thêm từ điển phát âm, ví dụ `TP.HCM` → `Thành phố Hồ Chí Minh`. Văn bản nguồn được giữ riêng với bản đọc.
4. Bấm **Xem cách đọc**, kiểm tra các chỗ thay đổi, rồi **Nghe thử** hoặc tạo toàn bộ âm thanh. Thay nội dung/cấu hình cần xem lại trước khi tạo.
5. File tạo mới có nút **Tải phụ đề SRT** tại kết quả và lịch sử. Mốc đoạn dựa trên thời lượng âm thanh đo được; mốc câu bên trong đoạn là ước lượng, cần chỉnh nếu dựng video yêu cầu chính xác.

Các phong cách dùng tốc độ và khoảng nghỉ định sẵn trên Edge-TTS/OpenVoice, cao độ giữ nguyên. Chưa thêm thanh chỉnh tốc độ/cao độ độc lập hoặc dịch vụ TTS diễn cảm mới. Kết quả cũ không tự sinh thêm phụ đề. Xem chi tiết và hướng dẫn cập nhật migration **007-speech-subtitles** trong BOOK_AUDIO.md.

### Bước 0: Cấu hình biến môi trường
- `backend/`: copy `backend/.env.example` thành `backend/.env` và điền `GEMINI_API_KEY`.
  Chạy `npm run db:init` tại backend để tạo cấu hình PostgreSQL local riêng.
  Xem [POSTGRES_MIGRATION.md](POSTGRES_MIGRATION.md) để tạo schema và nhập dữ liệu trước khi chạy.
  `MONGODB_URI` chỉ cần cho công cụ đọc nguồn chuyển dữ liệu/backup.
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
npm ci
# Lần đầu: hoàn tất db:init, db:migrate và db:import theo POSTGRES_MIGRATION.md
npm start
```
*Backend đọc `.env.postgres.local` và `.env.keycloak.local`; không kết nối MongoDB khi chạy ứng dụng.*

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

**Trạng thái ngày 17/10/2026:** Phase 3 đã tích hợp Keycloak vào frontend/backend;
3 tài khoản nguồn đã chuyển sang PostgreSQL `tts_app`, giữ nguyên `_id` và quyền sở hữu
dữ liệu. Mật khẩu được quản lý ở PostgreSQL qua Keycloak; hash bcrypt và JWT auth cũ đã dọn
sau backup. Chi tiết: [keycloak/PHASE3.md](keycloak/PHASE3.md).

#### A. Phần mềm và cấu hình cần có

- **Docker Desktop** đang chạy, dùng **Linux containers**, có Docker Compose.
  Trong cửa sổ Docker Desktop, góc dưới hiển thị `Engine running` khi Engine đã chạy.
- **Node.js và npm**; frontend hỗ trợ `^22.18.0 || >=24.12.0`.
- Các cổng local còn trống: **8080** (Keycloak), **8025** (Mailpit), **27018** (MongoDB migration).
  PostgreSQL mở cổng **127.0.0.1:5433** ra Windows cho Backend/worker; bên trong Docker dùng cổng 5432.
- Chỉ khi đọc nguồn để chuyển dữ liệu/backup: cần `MONGODB_URI` hợp lệ trong `backend/.env`
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
