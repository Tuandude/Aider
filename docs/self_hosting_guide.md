# Hướng dẫn Tự Triển khai (Self-Host) Aider Bot cho Repository của riêng bạn

Tài liệu này hướng dẫn cách đưa Aider Bot về chạy riêng cho các dự án/repository khác của bạn hoặc đội ngũ của bạn.

---

## Chọn cách chạy

Có hai cách, và **cách 1 là mặc định nên dùng**:

| | GitHub Actions | Backend webhook |
|---|---|---|
| Cần máy chủ | Không | Có |
| Cần token riêng | Không (GitHub tự cấp) | Có (PAT) |
| URL công khai | Không | Có |
| Kiểm tra cạnh lệch | **Có** (đã checkout cả repo) | Không (chỉ có danh sách tên file) |
| Độ trễ | 1–2 phút | Gần như tức thì |
| Phù hợp khi | Dùng trên GitHub | Cần phản hồi tức thì, hoặc dùng ngoài GitHub |

### Cách 1 — GitHub Actions (khuyến nghị)

Chép hai job trong `.github/workflows/aider-verify.yml` của repo này vào repo bạn muốn dùng. Xong. Không cần tạo token, không cần đặt secret, không cần deploy gì.

Job `review` tự bình luận lên PR và cập nhật bình luận cũ thay vì thêm mới.

Muốn bot **đề xuất sơ đồ bằng AI** ngay trên PR, bật thêm bốn mục trong Settings → Secrets and variables → Actions:

| Loại | Tên | Giá trị |
|---|---|---|
| Variable | `AIDER_AI_REVIEW` | `on` |
| Secret | `AIDER_LLM_API_KEY` | khoá gọi mô hình |
| Variable | `AIDER_LLM_BASE_URL` | endpoint tương thích OpenAI |
| Variable | `AIDER_LLM_MODEL` | tên model |

Variables là công khai; chỉ khoá nằm trong Secrets. PR mở từ fork không nhận được secret nên bước AI tự bỏ qua ở đó, còn phần kiểm chứng tất định vẫn chạy.

Giới hạn: PR mở từ fork sẽ không bình luận được (token chỉ đọc trên fork). Nếu cần, đổi trigger sang `pull_request_target` — nhưng đọc kỹ cảnh báo bảo mật của GitHub trước khi làm.

### Cách 2 — Backend webhook

Chỉ dùng khi bạn cần phản hồi tức thì, hoặc khi bot phải chạy ngoài GitHub.

---

## Các thành phần cần chuẩn bị (chỉ cho cách 2)
Để chạy Aider Bot, bạn cần:
1. **LLM API Key**: Dùng để phân tích code diff và sinh sơ đồ/tóm tắt. Aider gọi một API tương thích OpenAI (`POST /chat/completions`), nên dùng được bất kỳ nhà cung cấp nào theo chuẩn đó.
2. **GitHub Personal Access Token (PAT)**: Token có quyền `repo` để Bot có thể đọc diff và tự động ghi nhận xét (comment) lên Pull Request.
3. **Webhook Secret**: Một chuỗi ký tự tự chọn để bảo mật kết nối giữa GitHub và Backend Server của bạn.

---

## HƯỚNG DẪN CHI TIẾT CÁC BƯỚC (cách 2)

### Bước 1: Tạo GitHub Personal Access Token (PAT)
1. Truy cập [GitHub Token Settings (Classic)](https://github.com/settings/tokens).
2. Chọn **Generate new token (classic)**.
3. Đặt tên gợi nhớ (ví dụ: `aider-bot-token`).
4. Chọn phạm vi quyền (Scope): tích chọn mục **`repo`** (bao gồm toàn bộ quyền quản lý repository).
5. Cuộn xuống bấm **Generate token** và sao lưu Token này lại (dạng `ghp_...`).

---

### Bước 2: Triển khai Backend Server
Backend nằm trong `backend/`, nhưng nó import `aider-core` từ workspace, nên **build context là thư mục gốc `Aider/`**, không phải `backend/`. `Dockerfile` đặt ở gốc workspace. Bạn có thể triển khai lên bất cứ đâu hỗ trợ Docker (như Render, Fly.io, VPS hoặc Google Cloud Run).

#### Cách triển khai nhanh lên Google Cloud Run:
1. Cài đặt và đăng nhập [Google Cloud SDK](https://cloud.google.com/sdk).
2. Chuyển vào thư mục gốc `Aider/` (nơi có `Dockerfile`).
3. Chạy lệnh deploy:
   ```bash
   gcloud run deploy aider-backend --source . --region us-central1
   ```
4. Sau khi deploy xong, Cloud Run sẽ trả về một **Service URL** (ví dụ: `https://aider-backend-xxxxx.run.app`).

#### Thử image Docker ở máy trước khi deploy:
```bash
# Từ thư mục gốc Aider/
docker build -t aider-backend .
docker run -d --name aider -p 8085:8085 \
  -e AIDER_LLM_API_KEY=... \
  -e GITHUB_TOKEN=... \
  -e WEBHOOK_SECRET=... \
  aider-backend
curl http://localhost:8085/          # → "Aider backend is running!"
docker rm -f aider
```

#### Cấu hình các biến môi trường (Environment Variables):
Bạn cần thiết lập các biến môi trường sau cho Server của mình:
- `AIDER_LLM_API_KEY`: Khoá gọi mô hình. **Bắt buộc** — thiếu nó, `/api/commit` trả HTTP 500 và webhook không phân tích được PR.
- `AIDER_LLM_BASE_URL`: Endpoint tương thích OpenAI. Mặc định `http://127.0.0.1:8317/v1`.
- `AIDER_LLM_MODEL`: Tên model. Mặc định `glm-flash`.
- `GITHUB_TOKEN`: GitHub PAT bạn vừa tạo ở Bước 1.
- `WEBHOOK_SECRET`: Một mật khẩu tự chọn để xác thực webhook (ví dụ: `my-super-secret-123`).

> **Endpoint mặc định là `127.0.0.1`.** Nếu chạy trong container hoặc trên cloud, phải đặt `AIDER_LLM_BASE_URL` trỏ tới một endpoint mà server truy cập được — `127.0.0.1` trong container là chính container đó.

> **`WEBHOOK_SECRET` là bắt buộc.** Thiếu biến này, server **từ chối khởi động** (exit code `1`) chứ không chạy ở chế độ bỏ xác thực. Route webhook là đầu vào công khai duy nhất; nếu bỏ qua xác thực chữ ký, bất kỳ ai biết URL đều gửi được payload giả để bot bình luận lên PR của bạn.

*Lưu ý: Nếu sử dụng Cloud Run, bạn cần cấu hình cờ `--no-cpu-throttling` để giữ CPU luôn hoạt động cho các tác vụ ngầm (tránh bị Cloud Run tắt container trước khi AI phân tích xong). Chạy lệnh sau để thiết lập biến môi trường và tắt CPU throttling:*
```bash
gcloud run services update aider-backend \
  --update-env-vars AIDER_LLM_API_KEY=YOUR_KEY,AIDER_LLM_BASE_URL=YOUR_ENDPOINT,AIDER_LLM_MODEL=glm-flash,GITHUB_TOKEN=YOUR_GITHUB_TOKEN,WEBHOOK_SECRET=YOUR_SECRET \
  --no-cpu-throttling \
  --region us-central1
```

---

### Bước 3: Cấu hình Webhook trên GitHub Repository của bạn
1. Truy cập vào repository GitHub mà bạn muốn Bot hoạt động.
2. Đi tới **Settings** -> **Webhooks** -> Bấm **Add webhook**.
3. Cấu hình các trường như sau:
   - **Payload URL**: Nhập URL server của bạn kèm theo đường dẫn `/api/webhook/github` (ví dụ: `https://aider-backend-xxxxx.run.app/api/webhook/github`).
   - **Content type**: Chọn **`application/json`**.
   - **Secret**: Nhập đúng chuỗi `WEBHOOK_SECRET` bạn đã cấu hình ở Bước 2.
   - **Which events would you like to trigger this webhook?**:
     - Chọn **Let me select individual events**.
     - Tích chọn duy nhất mục **`Pull requests`**.
     - Bỏ tích các mục khác (như `Pushes`).
   - **Active**: Tích chọn hoạt động.
4. Bấm **Add webhook**.

---

## HOÀN TẤT & KIỂM TRA
Giờ đây mỗi khi có Pull Request mới được mở hoặc cập nhật trên repository của bạn:
1. GitHub sẽ gửi sự kiện Webhook sang Backend Server của bạn.
2. Server xác thực chữ ký bảo mật.
3. Server tải diff, gửi tới LLM để phân tích.
4. Bot tự động bình luận sơ đồ Mermaid sống và nhận xét kiến trúc trực tiếp trên PR!

Lưu ý: `aider verify` (kiểm chứng sơ đồ với file thật) chạy hoàn toàn cục bộ và không cần backend, GitHub token, hay LLM API key. Backend chỉ cần thiết nếu bạn muốn bot tự bình luận lên Pull Request.
