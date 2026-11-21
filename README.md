# Aider

**Mỗi node trong sơ đồ kiến trúc của bạn phải ánh xạ tới một file có thật. Aider chỉ ra chính xác node nào đang nói dối.**

Aider giữ cho sơ đồ kiến trúc trong `README.md` không trôi khỏi code — nhưng không bằng cách để một mô hình ngôn ngữ tự sửa sơ đồ. Phần kiểm chứng chạy hoàn toàn tất định: nó đọc file tree thật từ `git ls-files`, đối chiếu từng node trong sơ đồ Mermaid, và báo node nào không tương ứng với file nào. Không có mạng, không có API key, không có ảo giác.

<!-- AIDER:START -->
```mermaid
flowchart TD
  %% Mermaid xếp các nhóm rời nhau theo thứ tự khai báo từ phải sang trái, nên backend
  %% đứng đầu trong nguồn để hình đọc từ trái sang phải là core -> cli -> backend.
  subgraph BACKEND["🌐 backend — service webhook"]
    direction TB
    SERVER["server"]
    DOCS_LOADER["docsLoader"]
    GITHUB_SVC["GitHub Service"]
    LLM_BACKEND["llm"]
    DIAGRAM_CHECK["diagramCheck"]
    DIFF_FILTER["diffFilter"]
    SERVER --> DOCS_LOADER & GITHUB_SVC & LLM_BACKEND & DIAGRAM_CHECK & DIFF_FILTER
  end

  subgraph CLI["⌨️ cli — dòng lệnh"]
    direction TB
    CMD_VERIFY["verify"]
    REPORT["report"]
    CMD_PROPOSE["propose"]
    LLM_CLI["llm"]
    CMD_VERIFY --> REPORT
    CMD_PROPOSE --> LLM_CLI
  end

  subgraph CORE["⚖️ core — bộ luật tất định"]
    direction TB
    PROPOSE["propose"]
    VERIFY["verify"]
    MERMAID["mermaid"]
    RESOLVE["resolve"]
    PROPOSE --> VERIFY
    VERIFY --> MERMAID & RESOLVE
  end

  classDef core fill:#dcfce7,stroke:#15803d,stroke-width:2px,color:#14532d
  classDef cli fill:#dbeafe,stroke:#1d4ed8,stroke-width:2px,color:#1e3a8a
  classDef backend fill:#ffedd5,stroke:#c2410c,stroke-width:2px,color:#7c2d12
  class PROPOSE,VERIFY,MERMAID,RESOLVE core
  class CMD_VERIFY,REPORT,CMD_PROPOSE,LLM_CLI cli
  class SERVER,DOCS_LOADER,GITHUB_SVC,LLM_BACKEND,DIAGRAM_CHECK,DIFF_FILTER backend
  style CORE fill:#f0fdf4,stroke:#15803d,stroke-width:2px
  style CLI fill:#eff6ff,stroke:#1d4ed8,stroke-width:2px
  style BACKEND fill:#fff7ed,stroke:#c2410c,stroke-width:2px

  %% Mỗi dòng dưới đây gắn một node với file nguồn của nó. Chú thích không được vẽ ra
  %% hình, nên sơ đồ chỉ hiện tên; bộ kiểm chứng vẫn đọc được đường dẫn.
  %% Mỗi cạnh là một import thật trong mã nguồn; không có cạnh nào do suy đoán.
  %% Ba khối rời nhau vì core/cli/backend không import lẫn nhau bằng đường dẫn tương đối.
  %% path PROPOSE=core/src/propose.ts
  %% path VERIFY=core/src/verify.ts
  %% path MERMAID=core/src/mermaid.ts
  %% path RESOLVE=core/src/resolve.ts
  %% path CMD_VERIFY=cli/src/commands/verify.ts
  %% path REPORT=cli/src/report.ts
  %% path CMD_PROPOSE=cli/src/commands/propose.ts
  %% path LLM_CLI=cli/src/llm.ts
  %% path SERVER=backend/src/server.ts
  %% path DOCS_LOADER=backend/src/utils/docsLoader.ts
  %% path GITHUB_SVC=backend/src/services/github.ts
  %% path LLM_BACKEND=backend/src/llm.ts
  %% path DIAGRAM_CHECK=backend/src/utils/diagramCheck.ts
  %% path DIFF_FILTER=backend/src/utils/diffFilter.ts
```
<!-- AIDER:END -->

## Cách cài

```bash
cd cli
npm install
npm run build
```

## Cách dùng

```bash
# Kiểm chứng sơ đồ trong README.md (chạy được offline, không cần LLM)
node cli/dist/index.js verify

# Kiểm chứng một repo khác
node cli/dist/index.js verify --path /đường/dẫn/repo

# Máy đọc
node cli/dist/index.js verify --json

# Đề xuất cập nhật sơ đồ (cần AIDER_LLM_API_KEY)
node cli/dist/index.js propose --dry-run
node cli/dist/index.js propose --write

# Cài git hook tự động sinh commit message
node cli/dist/index.js init
```

`verify` trả exit code `1` khi có node không ánh xạ tới file nào — cắm thẳng vào CI (xem `.github/workflows/aider-verify.yml`).

### Cấu hình LLM

`propose` gọi một API tương thích OpenAI (`POST /chat/completions`). Không cần SDK, chỉ cần ba biến môi trường:

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `AIDER_LLM_API_KEY` | *(bắt buộc)* | Khoá gọi mô hình. Thiếu nó, `propose` thoát code `2` và `verify` không bị ảnh hưởng. |
| `AIDER_LLM_BASE_URL` | `https://api-cdn.deploy.com/api/v1` | Endpoint. Đổi sang nhà cung cấp khác nếu cần. |
| `AIDER_LLM_MODEL` | `zai-org/glm-5.3-flash` | Tên model gửi trong request. |

## Tự động bình luận lên Pull Request

Không cần máy chủ. Job `review` trong `.github/workflows/aider-verify.yml` chạy bộ kiểm chứng trên mỗi PR và đăng kết quả thành bình luận, cập nhật bình luận cũ thay vì thêm mới. Vì Actions có toàn bộ mã nguồn sau khi checkout, nó kiểm tra được cả **cạnh lệch** — điều một webhook chỉ có danh sách tên file không làm được.

`verify --markdown` sinh nội dung bình luận:

```bash
node cli/dist/index.js verify --markdown > report.md
```

### Bước AI trên PR (tùy chọn)

Job `review` có thêm một bước gọi `propose` và nối đề xuất của mô hình vào cuối bình luận. Nó chỉ chạy khi repo có:

| Loại | Tên | Giá trị |
|---|---|---|
| Variable | `AIDER_AI_REVIEW` | `on` để bật |
| Secret | `AIDER_LLM_API_KEY` | khoá gọi mô hình |
| Variable | `AIDER_LLM_BASE_URL` | ví dụ `https://api-cdn.deploy.com/api/v1` |
| Variable | `AIDER_LLM_MODEL` | ví dụ `zai-org/glm-5.3-flash` |

Bước này **không bao giờ làm đỏ CI**. `propose` chỉ đề xuất trên nền sơ đồ đang đúng, và tự loại mọi node không kèm đường dẫn file có thật — nên mô hình sai thì kết quả tệ nhất là không có đề xuất, không phải sơ đồ bịa. Thiếu khoá hoặc endpoint lỗi thì bình luận ghi rõ lý do.

Hai điều cần biết trước khi bật:

- **PR mở từ fork không nhận được secret.** Bước AI tự bỏ qua ở đó; phần kiểm chứng tất định vẫn chạy.
- **Variables là công khai.** Chỉ `AIDER_LLM_API_KEY` nằm trong Secrets; đừng bao giờ đặt khoá vào Variables.

## Backend (tùy chọn, không cần cho CI)

Có một service Express nhận webhook GitHub, dùng khi bạn muốn phản hồi tức thì thay vì chờ Actions, hoặc dùng ngoài GitHub:

```bash
cd backend
npm install
npm run build
AIDER_LLM_API_KEY=... GITHUB_TOKEN=... WEBHOOK_SECRET=... npm start
```

Cùng ba biến `AIDER_LLM_*` như trên. `POST /api/commit` còn nhận khoá theo từng request qua header `x-llm-api-key`, để client không phải chia sẻ khoá với server.

Xem `docs/self_hosting_guide.md` để triển khai bằng Docker. Lưu ý: build context là thư mục gốc `Aider/`, không phải `backend/`.

`WEBHOOK_SECRET` là bắt buộc — thiếu nó server từ chối khởi động, vì route webhook không được phép chạy mà không xác thực chữ ký.

## Giới hạn

Ánh xạ node → file dựa trên tên file, không dùng embedding hay LLM. Với repo có tên file khác xa khái niệm kiến trúc (ví dụ node `Auth Service` nhưng file tên `middleware.ts`), node đó sẽ bị báo `UNMAPPED`. Khi cần chỉ định chính xác, thêm một dòng chú thích ngay dưới node:

```mermaid
graph TD
  AUTH["Auth Service"]
  %% path AUTH=src/middleware.ts
```

Chú thích `%%` không được Mermaid vẽ ra, nên hình chỉ còn tên thành phần — bộ kiểm chứng vẫn đọc được đường dẫn. Viết `path=...` ngay trong nhãn cũng được, nhưng đường dẫn sẽ hiện lên hình.

## License

MIT
