# Tài khoản VIP và SePay

Áp dụng cho nhánh `main`: OpenVoice V2 (`edge`) và VieNeu. Tài khoản Free dùng được giọng hệ thống của cả hai bộ tạo giọng; clone giọng cá nhân bằng VieNeu cần Gold hoặc Diamond. Các giọng hệ thống Gold/Diamond cần đúng hạng tài khoản; nghe bản ghi mẫu vẫn được phép.

## Bật phần tài khoản

1. Sao lưu PostgreSQL ứng dụng bằng `npm --prefix backend run backup:postgres`.
2. Chạy `npm --prefix backend run db:migrate` để áp dụng migration `012-account-subscriptions-billing`. Migration bổ sung thời hạn gói vào `users`, tạo `payment_orders` và `account_usage_daily`; không xóa bảng/dữ liệu cũ.
3. Khởi động lại backend và worker cùng phiên bản code. Build frontend bằng `npm --prefix frontend run build`. Docker đã đọc cấu hình từ `deploy/backend.env`; rebuild backend và worker sau migration. Database Keycloak không thay đổi.
4. Đăng nhập admin, vào tab Tài khoản để cấp thử Gold/Diamond trong 30 ngày, 365 ngày hoặc vĩnh viễn. Chọn lại cùng hạng để thay thời hạn tính từ lúc cấp. Admin được hưởng quyền Diamond và không giới hạn lượt/ngày, giọng riêng; giới hạn an toàn 20.000 ký tự, 59 phút và 3 tác vụ vẫn giữ.

## Chuẩn bị SePay khi chưa liên kết ngân hàng

Tạm giữ `BILLING_ENABLED=false`. Trang hồ sơ vẫn xem được quyền lợi, hạn mức và bảng giá; nút thanh toán bị tắt. Chỉ kiểm thử với dữ liệu giả lập; không có đường dẫn công khai để giả lập tiền vào hoặc tự đánh dấu đơn đã thanh toán.

File mẫu: `deploy/billing.env.example`. Thêm các khóa vào `backend/.env` khi chạy Windows, `deploy/backend.env` khi chạy Docker, hoặc Environment của backend trên Render. Không thêm vào frontend và không commit file bí mật.

Khi đã có tài khoản SePay:

1. Liên kết đúng tài khoản ngân hàng trên [SePay](https://my.sepay.vn).
2. Điền `SEPAY_BANK_CODE`, `SEPAY_BANK_GATEWAY` (đúng `gateway`/`bank_brand_name` SePay trả về), `SEPAY_ACCOUNT_NUMBER`, `SEPAY_ACCOUNT_NAME`.
3. Tạo chuỗi ngẫu nhiên tối thiểu 24 ký tự cho `SEPAY_WEBHOOK_SECRET`. Ví dụ tạo bằng Node: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Không gửi giá trị này vào chat.
4. Tạo webhook nhận **tiền vào**, dữ liệu **JSON**, chứng thực **API Key** tại `https://text2speech-backend.onrender.com/api/billing/webhook/sepay`. API Key phải trùng `SEPAY_WEBHOOK_SECRET`. Bật retry khi HTTP ngoài 2xx.
5. Tùy chọn: thêm SePay User API Token vào `SEPAY_API_TOKEN` để dùng nút kiểm tra giao dịch khi webhook trễ hoặc khi thử local. Local không nhận được webhook online; User API đối soát trực tiếp từ backend.
6. Bật `BILLING_DEMO_PRICES=true` cho giá nhỏ (2.000–10.000 đồng). Đây vẫn là chuyển khoản thật, không phải sandbox. Đặt `BILLING_ENABLED=true`, restart/redeploy backend và thử một giao dịch nhỏ bằng tài khoản thử nghiệm.
7. Kiểm tra gói, ngày hết hạn, lịch sử thanh toán; gửi lại webhook để xác nhận không cộng ngày lần hai. Trước khi dùng chính thức, đặt `BILLING_DEMO_PRICES=false` và kiểm tra lại giá. Mỗi đơn giữ nguyên giá và ngân hàng tại thời điểm tạo.

## Quy tắc xử lý

- Ngày hạn mức theo `Asia/Ho_Chi_Minh`. Đếm lượt đã nhận xử lý, kể cả khi xử lý lỗi; xóa lịch sử/hủy sách không trả lại lượt. Tiếp tục cùng sách bị lỗi không tính thêm lượt tạo sách; AI sửa lại nội dung tính một lượt cho mỗi yêu cầu được nhận, kể cả yêu cầu thất bại. Bản nghe thử mới có hạn mức riêng 20/60/120 lượt/ngày cho Free/Gold/Diamond; bản mẫu giọng có sẵn không tính.
- Gói hết hạn trở về Free khi nạp hồ sơ/kiểm tra quyền, bao gồm trong worker. Không xóa giọng hoặc sách cũ; vẫn nghe các kết quả đã lưu được. Cần giọng, độ dài, thời lượng phù hợp gói hiện tại khi tiếp tục xử lý.
- Gia hạn cùng gói cộng thêm ngày. Free → VIP và Gold → Diamond bắt đầu thời hạn mới; không quy đổi phần Gold còn lại. Chặn mua gói thấp hơn khi đang có gói cao hơn/vĩnh viễn.
- QR có hạn 15 phút. Nếu giao dịch xảy ra trong hạn nhưng webhook đến muộn, vẫn ghi nhận. Chuyển sau hạn, thiếu tiền, đơn đã hủy, tài khoản bị khóa hoặc gói thấp hơn hiện tại được ghi `review_required`, không tự đổi gói. Admin kiểm tra mã tham chiếu trong tab Giao dịch để xử lý với ngân hàng, cấp gói thủ công hoặc hoàn tiền ngoài hệ thống; không có hoàn tiền tự động.
- Chỉ chấp nhận dữ liệu SePay đã xác thực, đúng ngân hàng, số tài khoản, mã đơn, thời gian và số tiền. Không tin xác nhận từ trình duyệt. Mỗi ID giao dịch chỉ được dùng một lần.
- API đối soát lọc theo tài khoản và ngày của đơn, lấy tối đa 5.000 giao dịch. Nếu đầy trang và chưa tìm thấy, trả lỗi cần kiểm tra, không kết luận chưa nhận tiền. Mỗi tài khoản kiểm tra API tối đa một lần/30 giây, kể cả khi đổi/hủy/tạo đơn khác; polling trạng thái không gọi SePay.
- `account_usage_daily` và `payment_orders` bật RLS, không cho `anon`/`authenticated` truy cập trực tiếp. Backend dùng kết nối PostgreSQL và kiểm tra chủ sở hữu, quyền admin ở API.

## Kiểm thử

`npm --prefix backend run test:tiers` chạy kiểm thử offline, không gọi ngân hàng. `npm --prefix backend run test:tiers:postgres` dùng `VIP_TEST_DATABASE_URL` trỏ tới database thử nghiệm `tts_*`; tạo schema riêng và luôn dọn bằng tên schema ngẫu nhiên. Không dùng script để xác nhận giao dịch thật. Các API trong script dùng tài khoản, dữ liệu và Engine giả lập; không gọi Keycloak/SePay/Engine thật.

Ví dụ PostgreSQL local cô lập (PowerShell):

```powershell
docker run --rm -d --name text2speech-vip-test -p 127.0.0.1:55432:5432 -e POSTGRES_USER=vip_test -e POSTGRES_PASSWORD=local-vip-test-only -e POSTGRES_DB=tts_vip_test postgres:17-alpine
$env:VIP_TEST_DATABASE_URL='postgresql://vip_test:local-vip-test-only@127.0.0.1:55432/tts_vip_test'
npm --prefix backend run test:tiers:postgres
docker stop text2speech-vip-test
```

Đặt thêm `VIP_TEST_EXPORT_DIAGRAMS=true` khi chạy kiểm thử để sinh `DATABASE.dbml`/`DATABASE.mmd` từ schema đã áp dụng migration mới mà không cần thay database online. Sơ đồ này mô tả phiên bản code mới, chưa xác nhận migration đã chạy trên online.

Hai Pages hiện dùng chung backend/database/worker. Trước khi bật VIP online cần triển khai kiểm tra quyền/hạn mức ở tất cả API và worker có thể ghi vào cùng database. Nếu giữ nhánh OmniVoice cũ, dùng backend và database riêng hoặc cập nhật cùng cơ chế VIP cho nhánh đó; worker cũ không có kiểm tra hạn mức có thể bỏ qua quyền của bản mới.

Tài liệu giao thức: [Webhook SePay](https://docs.sepay.vn/tich-hop-webhooks.html), [API giao dịch](https://docs.sepay.vn/api-giao-dich.html).
