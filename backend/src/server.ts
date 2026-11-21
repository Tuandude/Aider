import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';
import crypto from 'crypto';
import path from 'path';
import { GitHubService } from './services/github';
import { filterDiff, limitDiffSize } from './utils/diffFilter';
import { loadProjectDocs } from './utils/docsLoader';
import { checkDiagram, renderDiagramCheck, renderProposedDiagram } from './utils/diagramCheck';
import { DEFAULT_BASE_URL, DEFAULT_MODEL, createCompleter, parseJsonResponse, readLlmConfig } from './llm';

// .env nằm ở gốc workspace (hai cấp trên entry point, dù chạy từ src/ hay dist/).
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const app = express();
const githubService = new GitHubService();
app.use(cors());
app.use(express.json({
  limit: '10mb',
  verify: (req: any, res, buf) => {
    req.rawBody = buf;
  }
}));

function getModifiedFiles(diff: string): string[] {
  const files: string[] = [];
  const lines = diff.split('\n');
  for (const line of lines) {
    if (line.startsWith('diff --git a/')) {
      const parts = line.split(' ');
      if (parts.length >= 3) {
        const file = parts[2].substring(2);
        files.push(file);
      }
    }
  }
  return files;
}

app.post('/api/commit', async (req, res) => {
  const { fileTree, currentMermaid, projectToken } = req.body;
  const rawDiff = req.body.diff || '';
  const diff = limitDiffSize(filterDiff(rawDiff));
  const apiKey = req.headers['x-llm-api-key'] || req.body.llmApiKey || process.env.AIDER_LLM_API_KEY;
  console.log(`Received commit request for token: ${projectToken}`);

  if (!apiKey) {
    const message = 'AIDER_LLM_API_KEY is missing. Provide it in the x-llm-api-key header or configure it on the server.';
    console.error(message);
    return res.status(500).json({ error: message });
  }

  try {
    const systemInstruction = `You are an expert system architect and technical writer.
You will analyze a code diff and directory structure, then update the Mermaid diagram representing the codebase.
Every node you add MUST correspond to an existing file in the provided directory structure. Do not invent services, databases, or components.
You must return a JSON response containing:
1. commitMessage: conventional commit format (feat/fix/chore)
2. updatedMermaid: updated graph syntax. Mark changed components.
3. pmSummary: friendly Vietnamese summary.
Return ONLY raw JSON. No markdown ticks.`;

    const prompt = `${systemInstruction}

Current Mermaid Diagram:
${currentMermaid}

Directory Structure:
${fileTree}

Git Diff:
${diff}
`;

    const complete = createCompleter({
      baseUrl: (process.env.AIDER_LLM_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, ''),
      apiKey: apiKey as string,
      model: process.env.AIDER_LLM_MODEL ?? DEFAULT_MODEL,
    });
    const parsed = parseJsonResponse(await complete(prompt));

    res.json({
      commitMessage: parsed.commitMessage,
      updatedMermaid: parsed.updatedMermaid,
      pmSummary: parsed.pmSummary
    });
  } catch (err: any) {
    console.error(`[Aider API Error] ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => {
  res.send('Aider backend is running!');
});

app.get('/api/webhook/github', (req, res) => {
  res.json({
    status: 'active',
    message: 'Aider GitHub Webhook endpoint is active. Please configure and send POST requests from GitHub.'
  });
});

app.post('/api/webhook/github', async (req: express.Request, res: express.Response) => {
  const event = req.headers['x-github-event'];
  console.log(`Received GitHub Webhook event: ${event}`);

  // Signature verification
  const signature = req.headers['x-hub-signature-256'] as string;
  // WEBHOOK_SECRET được kiểm tra lúc khởi động, nên nhánh dưới luôn có secret.
  const webhookSecret = process.env.WEBHOOK_SECRET as string;

  if (!signature) {
    console.warn('[Security Warning] Webhook signature header missing.');
    return res.status(401).send('Signature verification failed. Missing signature header.');
  }
  const rawBody = (req as any).rawBody;
  if (!rawBody) {
    return res.status(400).send('Missing raw body for signature verification.');
  }
  const hmac = crypto.createHmac('sha256', webhookSecret);
  const digest = 'sha256=' + hmac.update(rawBody).digest('hex');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest))) {
      console.error('[Security Error] Webhook signature mismatch.');
      return res.status(401).send('Signature verification failed.');
    }
  } catch (e) {
    console.error('[Security Error] Signature comparison error.');
    return res.status(401).send('Signature verification failed.');
  }
  console.log('Webhook signature verified successfully.');

  if (event !== 'pull_request') {
    return res.status(200).send('Event ignored. Only pull_request is supported.');
  }

  const { action, pull_request, repository } = req.body;
  if (!pull_request || !repository) {
    return res.status(400).send('Invalid webhook payload.');
  }

  if (action !== 'opened' && action !== 'synchronize') {
    return res.status(200).send(`Action ${action} ignored. Only opened and synchronize are supported.`);
  }

  const prNumber = pull_request.number;
  const diffUrl = pull_request.diff_url;
  const sha = pull_request.head.sha;
  const owner = repository.owner.login;
  const repo = repository.name;

  console.log(`Processing PR #${prNumber} for ${owner}/${repo} at SHA ${sha}`);

  // Phản hồi webhook ngay lập tức để tránh GitHub báo timeout 10s
  res.status(202).send('PR analysis started.');

  try {
    const llmConfig = readLlmConfig();
    if (!llmConfig) {
      throw new Error('AIDER_LLM_API_KEY is not configured on the server.');
    }

    const rawDiff = await githubService.downloadDiff(diffUrl);
    const diff = limitDiffSize(filterDiff(rawDiff));
    const fileTree = await githubService.getFileTree(owner, repo, sha);
    const docsDirPath = path.resolve(__dirname, '../../docs');
    const docsContext = await loadProjectDocs(docsDirPath);

    let currentMermaid = '';
    let readmeMarkdown = '';
    try {
      const readmeUrl = `https://api.github.com/repos/${owner}/${repo}/contents/README.md?ref=${sha}`;
      const headers: Record<string, string> = {
        'User-Agent': 'Aider-Biographer-Bot',
      };
      if (process.env.GITHUB_TOKEN) {
        headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
      }
      const readmeResponse = await axios.get(readmeUrl, { headers });
      readmeMarkdown = Buffer.from(readmeResponse.data.content, 'base64').toString('utf8');
      const match = readmeMarkdown.match(/<!-- AIDER:START -->([\s\S]*?)<!-- AIDER:END -->/);
      if (match) {
        currentMermaid = match[1].replace(/```mermaid/g, '').replace(/```/g, '').trim();
      }
    } catch (e: any) {
      console.warn(`Failed to read current README.md from GitHub: ${e.message}`);
    }

    // Kiểm chứng sơ đồ bằng đúng luật của `aider verify`, trước khi nói bất cứ điều gì về nó.
    const diagramCheck = readmeMarkdown ? checkDiagram(readmeMarkdown, fileTree) : null;

    const systemInstruction = `You are an expert system architect, code reviewer, and technical writer.
You will analyze a code diff, directory structure, and project documentation context, then:
1. Review the code changes for logic bugs, performance issues, security vulnerabilities, and clean code practices with a focus on:
   - **Clarity & Naming**: Check if variable, function, and class names are descriptive, clear, and follow standard naming conventions.
   - **Function Structure**: Ensure functions are single-responsibility, short, and structured cleanly.
   - **Error & Exception Handling**: Check that potential errors are caught and handled gracefully without leaking sensitive details or crashing the application.
   - **Security**: Identify vulnerabilities such as hardcoded secrets/credentials, SQL injections, or missing input validation.
   - **Testing Coverage**: Check if new features or major modifications include corresponding test files. Flag warnings if tests are missing.
2. Compare the code changes against the provided project documentation context to identify architectural inconsistencies, business domain violations, or missed requirements.
3. Decide the review status:
   - "APPROVE": If the code is of high quality, meets all business requirements, has no critical bugs, security vulnerabilities, or major code smells, and follows clean code practices.
   - "REQUEST_CHANGES": If there are critical bugs, security risks (like hardcoded credentials), severe contradictions to project documentation, or major unhandled error paths.
   - "COMMENT": If the code is generally safe to merge but has minor refactoring suggestions, style improvements, or a warning about missing test coverage.

You must return a JSON response containing:
1. commitMessage: conventional commit format (feat/fix/chore)
2. proposedMermaid: an optional updated graph. EVERY node MUST declare its source file on its own comment line, e.g. "%% path SERVER=backend/src/server.ts", with the path copied exactly from the directory structure. Keep the node label itself to the bare component name so the rendered graph stays readable. Nodes without a real file path are discarded by the verifier.
3. pmSummary: friendly Vietnamese summary of what changed.
4. reviewDecision: "APPROVE" | "REQUEST_CHANGES" | "COMMENT"
5. reviewFeedback: A detailed review feedback in Vietnamese, pointing out specific suggestions, bugs, or domain violations.
Return ONLY raw JSON. No markdown ticks.`;

    const complete = createCompleter(llmConfig);
    const prompt = `${systemInstruction}

Current Mermaid Diagram:
${currentMermaid}

Directory Structure:
${fileTree}

Project Documentation (Business Domain Context):
${docsContext}

Git Diff to Review:
${diff}
`;
    const parsed = parseJsonResponse(await complete(prompt));

    const pmSummary: string = parsed.pmSummary;
    const proposedMermaid: string = parsed.proposedMermaid || '';
    const reviewDecision: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT' = parsed.reviewDecision || 'COMMENT';
    const reviewFeedback: string = parsed.reviewFeedback || '';

    const diagramSection = [
      renderDiagramCheck(diagramCheck),
      proposedMermaid ? renderProposedDiagram(proposedMermaid, fileTree) : '',
    ].filter(Boolean).join('\n\n');

    const commentBody = `### 🤖 Aider Automated Code Review
<!-- AIDER-BOT-REVIEW-COMMENT -->

#### 🚦 Quyết định Review: **${reviewDecision}**

#### 📋 Chi tiết đánh giá & Góp ý (Review Feedback)
${reviewFeedback || pmSummary}

${diagramSection}

#### 📝 PM Summary (Tóm tắt từ PM)
> ${pmSummary}

---
*Review được tự động thực hiện bởi [Aider Bot](https://github.com/Tuandude/Aider).*`;

    await githubService.submitReview(owner, repo, prNumber, commentBody, reviewDecision);

    // Tự động Merge nếu được Approve
    if (reviewDecision === 'APPROVE' && process.env.AUTO_MERGE === 'true') {
      try {
        console.log(`PR #${prNumber} was APPROVED. Triggering auto-merge...`);
        await githubService.mergePullRequest(owner, repo, prNumber);
      } catch (e: any) {
        console.error(`Failed to auto-merge PR #${prNumber}: ${e.message}`);
      }
    }
  } catch (err: any) {
    console.error(`Error in PR analysis flow: ${err.message}`);
  }
});

const PORT = process.env.PORT || 8085;

// Không khởi động khi thiếu WEBHOOK_SECRET: route webhook là đầu vào công khai duy nhất,
// và bỏ xác thực chữ ký sẽ cho phép bất kỳ ai gửi payload giả để bot bình luận lên PR.
if (!process.env.WEBHOOK_SECRET) {
  console.error('Lỗi: thiếu WEBHOOK_SECRET. Từ chối khởi động để không mở route webhook mà không xác thực chữ ký.');
  process.exit(1);
}

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
