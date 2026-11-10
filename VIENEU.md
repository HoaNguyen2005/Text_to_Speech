# VieNeu-TTS dùng thử và đánh giá phương án cloud + PC

Phần **Dùng trên web** giải thích cách chọn VieNeu-TTS cho bài giảng và sách nói.
Để thiết lập trạm GPU độc lập, xem [PC_AGENT_SETUP.md](PC_AGENT_SETUP.md).

## Phạm vi ngày 23/10/2026

VieNeu được thêm theo nhánh `if provider === vieneu`; giữ nguyên Edge-TTS + OpenVoice và để Edge làm mặc định. Không thay model của yêu cầu cũ. Giọng và Engine của sách được chụp vào `selected_voice`, giữ khi retry; hash audio có provider/phiên bản để không trộn cache.

Tài liệu mới của tác giả có VieNeu v3 Turbo mã nguồn mở. Tích hợp SDK `vieneu==3.8.3`, backbone `pnnbao-ump/VieNeu-TTS-v3-Turbo`, revision `61b85e3d937fbbacb387714180e8182823512523`. Runtime CPU/ONNX nằm trong service `vieneu` riêng, không cài chung vào venv OpenVoice. Weight/cache giữ trong volume `vieneu-cache`; lần đầu phải tải. Không dùng dịch vụ v4 trả phí.

## Dùng trên web

1. Tại Bài giảng hoặc Sách nói, chọn **Bộ tạo giọng → VieNeu-TTS**.
2. Sách nói: chọn giọng có sẵn Hải Đăng, Trúc Ly, Thiện Minh (mẫu kể chuyện), Mai Anh (mẫu bản tin), hoặc giọng cá nhân có quyền dùng. Bài giảng dùng thư viện giọng mẫu hiện có.
3. Nghe thử nếu cần. Với sách nói, đọc và duyệt bản tóm tắt trước khi tạo toàn bộ âm thanh.
4. Muốn quay lại, chọn Edge-TTS + OpenVoice trước khi gửi yêu cầu mới. Yêu cầu cũ không đổi Engine khi bạn đổi dropdown tạo yêu cầu mới.

VieNeu tạo tiếng nói và clone trực tiếp, không cần tạo âm thanh Edge rồi chuyển qua OpenVoice. Mẫu clone được chuẩn hóa và lấy 8 giây đầu để tái sử dụng embedding trong dịch vụ. Chọn mẫu rõ tiếng, không nhạc, không khoảng im lặng dài ở đầu. Tính giống giọng phải nghe đánh giá thực tế.

**Giọng điệu:** v3 Turbo lấy phong cách từ giọng tham chiếu; tham số `style` trong SDK hiện bị bỏ qua. Các preset Giảng giải/Kể chuyện trên web tiếp tục điều chỉnh tốc độ/khoảng nghỉ; không được mô tả là điều khiển cảm xúc gốc của model. Những thẻ cười/thở dài trong upstream còn thử nghiệm và chưa bật trên web. Tốc độ được áp bằng FFmpeg `atempo` sau tổng hợp, giữ cao độ.

## Máy hiện tại và máy bàn RTX 4060

Máy đang thao tác nhận Intel Arc 140T. Theo người dùng, RTX 4060 nằm ở PC khác. CPU image là bản chạy tại máy này; chưa có số đo trên RTX 4060.

```powershell
.\deploy\stack.ps1 build -Service vieneu
.\deploy\stack.ps1 up
.\deploy\stack.ps1 logs -Service vieneu
```

Trên máy bàn NVIDIA đã có toàn bộ repo/cấu hình/data cần thiết, Docker Desktop Linux containers + WSL2 và driver NVIDIA hỗ trợ GPU, dùng thêm overlay GPU:

```powershell
docker compose --env-file keycloak/.env -f keycloak/compose.yaml -f deploy/compose.app.yaml -f deploy/compose.vieneu.gpu.yaml build vieneu
docker compose --env-file keycloak/.env -f keycloak/compose.yaml -f deploy/compose.app.yaml -f deploy/compose.vieneu.gpu.yaml up -d --wait --wait-timeout 1800
```

Overlay chỉ cấp NVIDIA GPU cho VieNeu; không thay CPU image/requirements của Engine OpenVoice cũ. GPU image dùng PyTorch CUDA 2.8.0/cu128 theo SDK, batch tối đa 4 chunk nội bộ một lần infer. Không chạy nhiều infer GPU đồng thời chưa đo VRAM. Chưa build/chạy GPU image trên laptop này. Hai máy không tự có cùng dữ liệu chỉ vì cùng repo: cần kế hoạch backup/chuyển database và file trước khi chuyển nơi chạy stack.

## Đánh giá hai ảnh đề xuất

| Đề xuất | Quyết định / điều chỉnh |
|---|---|
| Web + Backend + Worker + PostgreSQL + Keycloak trên cloud | Hướng phù hợp. Với demo, một VPS chạy Compose giúp giảm số nơi cấu hình. Nếu frontend ở Vercel thì Backend/worker/Keycloak cần môi trường dịch vụ thường trực riêng; không coi mọi thành phần là Vercel Functions. |
| Engine trên PC RTX 4060 | Phù hợp để giảm tiền thuê GPU. PC cần bật khi xử lý; website có thể mở 24/7 nhưng việc tạo âm thanh không bảo đảm 24/7 nếu PC tắt/mất mạng. Cần trạng thái chờ Engine và heartbeat. |
| Cloudflare Tunnel / Tailscale | Có thể dùng, nhưng chưa mở tunnel. Tunnel cần service authentication; Tailscale cần cả bên cloud và PC tham gia mạng riêng. Không public endpoint quản trị/model tùy ý. |
| Chỉ đổi ENGINE_URL sang địa chỉ PC | **Chưa đủ:** worker hiện đọc đường dẫn output_path qua volume dùng chung, restore WAV từ R2 cũng ghi vào filesystem của worker. Khi khác máy phải có giao thức chuyển file theo job/part, upload Engine→R2 và trả key+checksum, tải về có xác thực hoặc presigned URL. Không gửi đường dẫn đĩa PC cho worker cloud đọc. |
| Upload Engine thẳng R2 | Nên làm trong bước tách hạ tầng. Cần idempotency, giới hạn prefix/job, checksum, xác thực chủ sở hữu, dọn file và ghép phần ngay trên PC. Bản dùng thử hiện vẫn upload từ Backend/worker như cũ. |
| CUDA cho Docker | Đã chuẩn bị overlay VieNeu cho RTX 4060. Không áp `driver:nvidia` lên Intel Arc. Có thể làm overlay CUDA OpenVoice riêng sau nếu còn dùng và cần tăng tốc nó. |
| Gọi Edge song song | Đã thêm prefetch 1–3 đoạn cho nhánh Edge trong sách review-v1 và bài giảng đầy đủ; network ngoài khóa OpenVoice, inference vẫn tuần tự. Không giúp VieNeu vì VieNeu không gọi Edge. Xem BOOK_AUDIO.md để cấu hình và giới hạn. |
| Gom 50.000–100.000 ký tự vào một lượt Gemini | Chưa áp mức này: ngân sách token hiện 24.000/lượt, đầu ra có giới hạn và context lớn không tự bảo đảm giữ đủ chi tiết. Bản này cho yêu cầu mới dùng 12.000 ký tự/phần (cấu hình 6.000–16.000), giảm số lượt phân tích với nguồn dài. Job cũ giữ 6.000; cache tách theo kích thước phần để giữ source_ids đúng. Có thể đặt lại BOOK_ANALYSIS_CHUNK_CHARS=6000 cho yêu cầu mới. |
| Gộp viết và đối chiếu vào cùng prompt | Giữ đối chiếu riêng. Tự kiểm tra trong cùng lượt viết không tương đương lượt đánh giá độc lập, đặc biệt sau các lỗi lệch nguyên tác. Checkpoint chỉ kiểm tra lại mục thay đổi để tiết kiệm lượt. |
| Giảm 28 phút xuống 2–4 phút | Chưa có bằng chứng trên dữ liệu/máy này. Cần đo riêng phân tích, viết, đối chiếu, chờ quota, TTS, ghép, upload; phân biệt model nóng và lần tải weights đầu tiên. Không hứa thời gian toàn luồng từ benchmark TTS của tác giả. |

## Phương án cloud được đề xuất ngày 23/10/2026

```mermaid
flowchart LR
  U[Trình duyệt] --> W[Web + Backend + Keycloak]
  W --> DB[(PostgreSQL: job và tiến độ)]
  DB --> Q[Worker cloud]
  Q -->|lệnh ngắn có xác thực| E[Engine PC RTX 4060]
  E -->|WAV / MP3 và checksum| R[(R2)]
  Q -->|kiểm tra key, ghi kết quả| DB
  W -->|URL tải có thời hạn| U
```

Nên chuyển lệnh tạo đoạn sang trả task ID nhanh + polling/heartbeat thay vì giữ HTTP lâu xuyên tunnel; triển khai lease/idempotency và hủy theo job trước. Đối với bài giảng, cũng cần chuyển tác vụ đồng bộ dài thành job nếu Backend chạy trên cloud. Bản hiện tại là thử VieNeu local, chưa phải bản cloud tách máy hoàn chỉnh.

## Ghi nhận dùng thử local

Ngày 23/10/2026: build/cú pháp đạt, VieNeu CPU nạp model và báo healthy. Đã tạo một mẫu giọng Thiện Minh qua nhánh `/book/part` mới: âm thanh 9,309875 giây (gồm 650 ms nghỉ cuối), tổng lượt gọi lần đầu 22,17 giây. Đây chỉ là một đoạn ngắn, chưa phải benchmark sách dài; chưa đánh giá chất lượng bằng nghe hoặc chạy clone/luồng web toàn bộ. Không gọi Gemini, không tạo bản ghi lịch sử/job cho mẫu này, chưa dùng GPU RTX 4060.

File: `backend/data/book-audio/e59737c6da3e4d88bb607cc0/2d217b3e225b26cae74af09bcccb1b1aabdf1633fe2e12d7e156448a0891dc84.wav`.

## Thẻ biểu cảm trong sách nói

Giao diện duyệt đã bỏ các nút chèn thẻ. Khi nghe thử hoặc tạo sách nói, hệ thống lọc các thẻ biểu cảm còn sót trong bản nháp cũ trước khi gửi nội dung sang bộ tạo giọng.

## Nguồn

- SDK / giới hạn style và benchmark: https://github.com/pnnbao97/VieNeu-TTS
- Model: https://huggingface.co/pnnbao-ump/VieNeu-TTS-v3-Turbo
- GPU Docker Windows: https://docs.docker.com/desktop/features/gpu/
- Tunnel: https://developers.cloudflare.com/tunnel/get-started/
- Vercel Functions: https://vercel.com/docs/functions/limitations
