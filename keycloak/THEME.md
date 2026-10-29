# Theme Text2Speech

Theme `text2speech` kế thừa `keycloak.v2` của Keycloak **26.8.0**. Giao diện studio
đồng bộ với Vue: xanh ngọc, card bo góc, nền sáng dịu hoặc nền tối xanh đậm và font hệ thống.
Giao diện mặc định tiếng Việt; người dùng có thể chọn English.

## Light/Dark mode và đồng bộ với website

Nút **Sáng/Tối** ở góc trên bên phải xuất hiện trên các biểu mẫu dùng layout kế thừa,
gồm đăng nhập, đăng ký, quên mật khẩu và đặt mật khẩu mới. Lần đầu theo cài đặt hệ điều hành;
sau khi chọn thì ghi nhớ trong trình duyệt. Script áp dụng theme trong head trước khi
body được vẽ; nút điều khiển được gắn sau khi DOM sẵn sàng. Không thay template của
biểu mẫu, form action, PKCE, session, xác thực dữ liệu hoặc xử lý mật khẩu.

Website và Keycloak local dùng cùng hostname **localhost**, khác cổng 5173/8080.
Cookie tùy chọn `tts_theme=light|dark` chia sẻ được giữa các cổng cùng hostname;
`localStorage` có khóa `text2speech.theme` vẫn riêng từng origin. Cookie được ưu tiên
khi mở trang, cập nhật lại localStorage và khi tab nhận focus. Cookie chỉ chứa tên
chế độ, host-only, `Path=/`, `SameSite=Lax`, tối đa 1 năm; thêm `Secure` khi dùng HTTPS.
Không đặt `Domain` rộng hoặc lưu dữ liệu xác thực. Nếu trình duyệt chặn storage,
nút vẫn đổi giao diện trong lần truy cập hiện tại; việc ghi nhớ/đồng bộ có thể không khả dụng.

**Dùng http://localhost:5173 để mở web** nếu cần đồng bộ với Keycloak localhost.
`127.0.0.1` và `localhost` là hai hostname khác nhau. Khi triển khai app/auth trên
hai hostname khác nhau, cần thiết kế cơ chế truyền tùy chọn riêng; cấu hình hiện tại
không mở rộng phạm vi cookie để chia sẻ giữa các miền.

`darkMode=false` trong theme.properties tắt script tự đổi theo hệ điều hành của theme cha,
để không tranh quyền điều khiển với lựa chọn thủ công. Nó không tắt chế độ tối của theme
Text2Speech; màu tối do `palette.css`, `data-theme` và `js/theme.js` quản lý.

## Đồng bộ ngôn ngữ

Website có bộ chọn **Tiếng Việt / English** trên trang chào và topbar user/admin.
Khi mở đăng nhập/đăng ký, SDK tạo URL kèm locale hiện tại; thêm `kc_locale` theo
danh sách `vi`/`en` để lựa chọn hiện tại được ưu tiên trước ngôn ngữ cũ của Keycloak.
Không tạo URL xác thực thủ công hoặc bỏ qua PKCE/state/nonce. Keycloak có quy tắc
[chọn ngôn ngữ](https://www.keycloak.org/docs/latest/server_admin/index.html#_user_locale_selection)
riêng, gồm lựa chọn của người dùng, hồ sơ, client và cookie.

`resources/js/locale.js` đọc `html.lang` đã render, ghi cookie tùy chọn `tts_locale`
và localStorage `text2speech.locale`; khi chọn dropdown gốc, ghi lựa chọn trước khi
handler gốc điều hướng. Script không đổi form, mật khẩu hoặc URL action. Vue đọc
cookie này khi tải/nhận focus; đồng bộ giữa các cổng trên cùng hostname localhost.
Cookie chỉ chứa `vi`/`en`, host-only, SameSite=Lax, Path=/, tối đa một năm, Secure
khi HTTPS. Cookie bị chặn hoặc app/auth khác hostname thì không cam kết đồng bộ
ngược; client vẫn truyền locale khi mở trang đăng nhập/đăng ký.

Focus của ô nhập dùng một viền xanh nhẹ và bóng mờ ở wrapper, loại outline đen
của input bên trong. Trạng thái focus bàn phím và viền đỏ của trường lỗi vẫn được giữ.

## Căn chỉnh biểu mẫu

Đăng nhập và đăng ký dùng chung khoảng đệm ngang cho tiêu đề, trường nhập, nút
và footer. Footer thông tin nằm trong body không cộng thêm khoảng đệm ngang;
footer thương hiệu bên ngoài dùng khoảng đệm của card. Bỏ margin dưới logo do
theme cha thêm để giữ khoảng cách logo–card nhất quán.

Header dùng hai cột `minmax(0, 1fr) 124px`, dành riêng chiều rộng cho bộ chọn
ngôn ngữ và khoảng trống cho mũi tên. Selector `div...:has(...)` cần giữ đủ độ
ưu tiên để ghi đè lưới 70%/30% của theme cha, vốn có thể tràn khi cộng gap.
Ở màn hình nhỏ, bộ chọn chuyển xuống hàng riêng. Mũi tên dùng màu theo theme;
khung mật khẩu và nút hiện/ẩn có góc bo đồng nhất.

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
| `theme.properties` | Theme cha, CSS, script, ngôn ngữ và favicon |
| `resources/css/palette.css` | Bản sao bảng màu sáng/tối từ `frontend/src/assets/theme.css` |
| `resources/css/text2speech.css` | Màu sắc, font, bố cục và kích thước trên điện thoại |
| `resources/js/theme.js` | Áp dụng theme sớm, nút đổi chế độ và chia sẻ tùy chọn với Vue local |
| `resources/js/locale.js` | Chia sẻ lựa chọn Việt/Anh từ Keycloak về Vue local |
| `resources/img/favicon.svg` | Biểu tượng sóng âm Text2Speech |
| `messages/messages_vi.properties` | Nhãn và thông báo tiếng Việt |
| `messages/messages_en.properties` | Nhãn và thông báo tiếng Anh |
| `footer.ftl` | Dòng giới thiệu và nút sáng/tối, kế thừa layout gốc |

Đăng nhập, đăng ký, quên mật khẩu, đặt mật khẩu mới và các trang thông báo sử dụng
biểu mẫu kế thừa từ Keycloak. Theme giữ nguyên action, trường ẩn, thông báo lỗi,
hiện/ẩn mật khẩu và kiểm tra dữ liệu của Keycloak. Trường giới tính được hiển thị
dạng danh sách Nam/Nữ/Khác; giá trị lưu vẫn là `male`/`female`/`other`.

Compose mount theme chỉ đọc tại `/opt/keycloak/themes/text2speech`. Local tắt cache theme
để sửa CSS/nội dung rồi tải lại trang. Nếu đổi `theme.properties`, khởi động lại dịch vụ
Keycloak khi cần. Không cần build lại Vue cho thay đổi theme.

Khi đổi bảng màu chung, đồng bộ bản sao trước khi build Frontend:

```powershell
Copy-Item frontend/src/assets/theme.css keycloak/themes/text2speech/login/resources/css/palette.css
.\deploy\stack.ps1 build -Service frontend
.\deploy\stack.ps1 up -Service frontend
```

Đồng bộ cookie ở Vue dùng `frontend/src/composables/useTheme.js` và đoạn áp dụng sớm
trong `frontend/index.html`; cần build lại Frontend nếu thay các file này. Theme Keycloak
được mount từ source nên không cần tạo lại realm hoặc chạy migration. Local đã tắt cache;
bắt đầu lại từ trang chào nếu trang xác thực cũ đã hết phiên.

### Popup thông báo (22/10/2026)

`resources/js/notifications.js` hiển thị thông báo máy chủ và lỗi biểu mẫu bằng
popup góc màn hình cùng palette với Vue. Nhãn lấy từ messages_vi/en.properties
qua footer.ftl; nội dung hiển thị bằng textContent, không đọc dữ liệu input/token.
Thông báo chung cũ được ẩn, lỗi gắn input vẫn giữ cho trợ năng. Script chạy sau DOM
và có nút đóng; không can thiệp việc gửi form hoặc xác thực Keycloak.
Popup chúc đăng ký/chào người dùng xuất hiện tại Vue sau khi Backend xác nhận
hồ sơ và phiên đăng nhập; không dựa vào việc mở trang đăng ký.

## Khi deploy hoặc nâng cấp

- Đưa thư mục theme vào image Keycloak hoặc mount nó trên máy chủ, rồi chọn
  **Realm settings → Themes → Login theme → text2speech**.
- Bật lại cache cho production: bỏ ba tùy chọn `--spi-theme--...` tắt cache trong Compose;
  dùng cấu hình production riêng thay cho `start-dev`.
- Khi nâng Keycloak, rà soát các trang và CSS theo theme cha mới, đặc biệt các lớp PatternFly.
- Để trở về giao diện mặc định, chọn `keycloak.v2` tại Login theme. Có thể dùng file backup
  cấu hình để khôi phục tên hiển thị/ngôn ngữ trước khi tùy chỉnh.

Tham khảo: [Keycloak — Working with themes](https://www.keycloak.org/ui-customization/themes).
