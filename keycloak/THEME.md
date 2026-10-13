# Theme Text2Speech

Theme `text2speech` kế thừa `keycloak.v2` của Keycloak **26.8.0**. Nền `#f7f7f8`,
khung trắng bo góc, chữ/nút `#111827` và font hệ thống đồng bộ với frontend.
Giao diện mặc định tiếng Việt; người dùng có thể chọn English.

## Áp dụng local

Từ thư mục gốc, khi Docker Desktop đã chạy:

```powershell
docker compose --env-file keycloak/.env -f keycloak/compose.yaml up -d --wait keycloak
node backend/scripts/configure_keycloak_theme.js
```

Mở [website](http://localhost:5173), bấm **Đăng nhập** hoặc **Tạo tài khoản**.
Nếu còn trang cũ, bắt đầu lại từ website hoặc tải lại trang. Nếu trình duyệt đã ghi nhớ
English, chọn **Tiếng Việt** tại góc trên của biểu mẫu.

Script áp dụng theme cho realm `tts-local` đã tồn tại và lưu cấu hình theme trước đó
trong `keycloak/backups/theme-settings-before-*.json`. Lệnh `configure_keycloak_phase3.js`
cũng áp dụng theme khi dựng stack mới. Realm import khai báo theme sẵn; realm đã tồn tại
cần dùng script vì `--import-realm` không ghi đè cấu hình hiện có.

## Các file chỉnh sửa

| File trong `themes/text2speech/login/` | Nội dung |
|---|---|
| `theme.properties` | Theme cha, CSS, ngôn ngữ và favicon |
| `resources/css/text2speech.css` | Màu sắc, font, bố cục và kích thước trên điện thoại |
| `resources/img/favicon.svg` | Biểu tượng sóng âm Text2Speech |
| `messages/messages_vi.properties` | Nhãn và thông báo tiếng Việt |
| `messages/messages_en.properties` | Nhãn và thông báo tiếng Anh |
| `footer.ftl` | Dòng giới thiệu ở cuối biểu mẫu |

Đăng nhập, đăng ký, quên mật khẩu, đặt mật khẩu mới và các trang thông báo sử dụng
biểu mẫu kế thừa từ Keycloak. Theme giữ nguyên action, trường ẩn, thông báo lỗi,
hiện/ẩn mật khẩu và kiểm tra dữ liệu của Keycloak. Trường giới tính được hiển thị
dạng danh sách Nam/Nữ/Khác; giá trị lưu vẫn là `male`/`female`/`other`.

Compose mount theme chỉ đọc tại `/opt/keycloak/themes/text2speech`. Local tắt cache theme
để sửa CSS/nội dung rồi tải lại trang. Nếu đổi `theme.properties`, khởi động lại dịch vụ
Keycloak khi cần. Không cần build lại Vue cho thay đổi theme.

## Khi deploy hoặc nâng cấp

- Đưa thư mục theme vào image Keycloak hoặc mount nó trên máy chủ, rồi chọn
  **Realm settings → Themes → Login theme → text2speech**.
- Bật lại cache cho production: bỏ ba tùy chọn `--spi-theme--...` tắt cache trong Compose;
  dùng cấu hình production riêng thay cho `start-dev`.
- Khi nâng Keycloak, rà soát các trang và CSS theo theme cha mới, đặc biệt các lớp PatternFly.
- Để trở về giao diện mặc định, chọn `keycloak.v2` tại Login theme. Có thể dùng file backup
  cấu hình để khôi phục tên hiển thị/ngôn ngữ trước khi tùy chỉnh.

Tham khảo: [Keycloak — Working with themes](https://www.keycloak.org/ui-customization/themes).
