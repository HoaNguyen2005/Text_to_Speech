# Triển khai hai nhánh Text2Speech

| Nhánh | Bộ tạo giọng | Cloudflare Pages |
| --- | --- | --- |
| `main` | Edge-TTS + OpenVoice V2, VieNeu-TTS v3 Turbo | [text2speech-main.pages.dev](https://text2speech-main.pages.dev), project `text2speech-main` |
| `codex/omnivoice-windows` | Bản thử nghiệm có thêm OmniVoice | [text2speech-at0.pages.dev](https://text2speech-at0.pages.dev), project `text2speech` |

Project main đã liên kết GitHub, production branch `main`, tự build khi push
nhánh main và tắt preview cho các nhánh khác. Project cũ giữ nguyên cấu hình.
Hiện hai frontend trỏ tới cùng API `https://text2speech-backend.onrender.com`;
việc tạo Pages mới không thay đổi nhánh đang chạy của backend Render.

Giao diện của `main` dùng cùng sidebar, Particles, Floating Lines, dropdown và
hiệu ứng thông báo với nhánh thử nghiệm. Main không có service, lựa chọn API hay
lệnh cài OmniVoice. Dữ liệu và âm thanh đã tạo không bị xóa; yêu cầu OmniVoice cũ
cần được tiếp tục bằng đúng bản thử nghiệm, không tự chuyển sang model khác.

## Tạo project Pages cho main

Trong Cloudflare: **Workers & Pages → Create application → Pages → Connect to Git**.
Chọn repository `HoaNguyen2005/Text_to_Speech` và cấu hình:

| Thiết lập | Giá trị |
| --- | --- |
| Project name | `text2speech-main` nếu tên còn trống |
| Production branch | `main` |
| Root directory | `frontend` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node.js | `24.12.0` hoặc mới hơn tương thích package.json |

Thiết lập các biến **Production** trước khi build:

```dotenv
VITE_API_URL=https://<backend-cho-main>
VITE_KEYCLOAK_URL=https://text2speech-keycloak.onrender.com
VITE_KEYCLOAK_REALM=tts-local
VITE_KEYCLOAK_CLIENT_ID=tts-frontend
NODE_VERSION=24.12.0
```

Các biến VITE là cấu hình public được đóng vào bản build. Không đặt API key
Gemini, secret Keycloak, R2 hay token Cloudflare vào đây. Giữ nguyên project
Pages cũ; không đổi production branch của nó sang main.

## Đăng nhập và gọi API từ domain mới

Sau khi Cloudflare cấp domain, dùng đúng origin thực tế, chẳng hạn
`https://text2speech-main.pages.dev`:

1. Thêm origin vào `FRONTEND_ORIGINS` của backend phù hợp, giữ các origin cũ.
2. Trong Keycloak, realm `tts-local`, client `tts-frontend`, thêm
   `https://text2speech-main.pages.dev/*` vào Valid redirect URIs và Valid post
   logout redirect URIs; thêm origin không có `/*` vào Web origins. Giữ cấu hình cũ.
3. Kiểm tra trang mới, đăng nhập/đăng xuất, tải danh sách giọng của cả hai bộ tạo.

**Hai Pages chỉ tách frontend.** Để chạy cả hai bản đồng thời, bản main cần
backend/worker/Engine riêng; worker main từ chối yêu cầu OmniVoice cũ. Nếu hai bản
dùng chung database/hàng đợi, cần tách môi trường trước khi chạy worker khác
phiên bản. Không đổi nhánh dịch vụ Render hiện tại chỉ để tạo Pages mới.

## Chạy main trên CPU hoặc GPU

Trước khi chuyển nhánh trên máy đang chạy dịch vụ, dừng dịch vụ bằng script của
nhánh cũ. Không xóa volume hoặc thư mục dữ liệu/model.

```powershell
git switch main
git pull --ff-only origin main

# Laptop CPU với Docker
.\deploy\stack.ps1 build
.\deploy\stack.ps1 up

# Máy bàn CUDA, Docker hoặc Windows trực tiếp
.\deploy\gpu-node.ps1 -Action all
```

Chỉ chạy bộ lệnh cho máy tương ứng. Main vẫn sử dụng dịch vụ Edge-TTS làm giọng
nền cho OpenVoice; quyền thương mại của OpenVoice không thay thế điều khoản
dịch vụ Microsoft. VieNeu v3 Turbo có giấy phép Apache 2.0.
