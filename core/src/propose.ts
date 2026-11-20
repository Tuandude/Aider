import fs from 'fs';
import path from 'path';
import { renderDiagram } from './diagram';
import { Proposal, DiagramEdge, DiagramNode, VerifyReport } from './types';
import { readFileTree, verify } from './verify';

/** Hàm gọi LLM được inject, để test không cần mạng. Nhận prompt, trả văn bản. */
export type CompletePrompt = (prompt: string) => Promise<string>;

export interface ProposeOptions {
  repoPath?: string;
  readmeFile?: string;
  fileTree?: string[];
  /** Gọi LLM. Bỏ trống thì `propose` sẽ từ chối chạy. */
  complete?: CompletePrompt;
  /** Hàm verify, cho test thay thế. Mặc định là `verify` thật. */
  runVerify?: (options: { repoPath?: string; readmeFile?: string; fileTree?: string[] }) => VerifyReport;
}

export interface ProposeResult {
  /** Sơ đồ đã qua kiểm chứng, sẵn sàng ghi nếu mọi evidence hợp lệ. */
  diagram: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  /** Node/cạnh do LLM đề xuất nhưng bị loại vì evidence không có trong file tree. */
  rejected: string[];
  rationale: string;
  verify: VerifyReport;
}

export class ProposeBlockedError extends Error {}

/**
 * Đề xuất cập nhật sơ đồ, nhưng chốt chặn cuối nằm ở đây:
 * LLM không được đưa vào sơ đồ thứ nó không chứng minh được bằng đường dẫn file có thật.
 */
export async function propose(options: ProposeOptions): Promise<ProposeResult> {
  const repoPath = options.repoPath ?? process.cwd();
  const readmeFile = options.readmeFile ?? 'README.md';
  const runVerify = options.runVerify ?? verify;

  const report = runVerify({ repoPath, readmeFile, fileTree: options.fileTree });

  // Không đề xuất trên nền sơ đồ đang sai: người dùng phải tự quyết node bịa đi đâu.
  if (!report.ok) {
    const list = report.unmapped.map((result) => `  ${result.node.id} "${result.node.label}"`).join('\n');
    throw new ProposeBlockedError(
      `Sơ đồ hiện tại còn ${report.unmapped.length} node không ánh xạ tới file nào:\n${list}\n` +
        'Sửa hoặc xoá các node này trước khi chạy propose.'
    );
  }

  if (!options.complete) {
    throw new ProposeBlockedError('Không có hàm gọi LLM được cấu hình (cần GEMINI_API_KEY).');
  }

  const fileTree = options.fileTree ?? readFileTree(repoPath);
  const readmePath = path.resolve(repoPath, readmeFile);
  const markdown = fs.readFileSync(readmePath, 'utf8');
  const current = currentDiagramText(markdown);

  const raw = await options.complete(buildPrompt(fileTree, current));
  const proposal = parseProposal(raw);
  const { nodes, edges, rejected } = verifyProposal(proposal, fileTree);

  return {
    diagram: renderDiagram(nodes, edges),
    nodes,
    edges,
    rejected,
    rationale: proposal.rationale,
    verify: report,
  };
}

function currentDiagramText(markdown: string): string {
  const match = markdown.match(/<!--\s*AIDER:START\s*-->([\s\S]*?)<!--\s*AIDER:END\s*-->/);
  if (!match) return '';
  return match[1].replace(/```mermaid/g, '').replace(/```/g, '').trim();
}

function buildPrompt(fileTree: string[], currentDiagram: string): string {
  return `You maintain an architecture diagram for a repository.

Return ONLY raw JSON, no markdown fences, matching this shape:
{
  "nodes": [{ "id": "SERVER", "label": "Backend Server", "evidence": "backend/src/server.ts" }],
  "edges": [{ "from": "SERVER", "to": "GITHUB", "evidence": "backend/src/server.ts" }],
  "rationale": "one paragraph"
}

Rules:
- Every node MUST list as evidence an existing file path copied exactly from the file list below.
- Every edge MUST list the file that creates the relationship.
- Use only file paths that appear verbatim in the file list.

Current diagram:
${currentDiagram || '(empty)'}

Files in the repository:
${fileTree.join('\n')}
`;
}

export function parseProposal(raw: string): Proposal {
  const cleaned = raw.replace(/```json/g, '').replace(/```/g, '').trim();
  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err: any) {
    throw new Error(`LLM trả về JSON không hợp lệ: ${err.message}`);
  }
  if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
    throw new Error('LLM trả về thiếu mảng nodes hoặc edges.');
  }
  return {
    nodes: parsed.nodes,
    edges: parsed.edges,
    rationale: typeof parsed.rationale === 'string' ? parsed.rationale : '',
  };
}

/**
 * Kiểm chứng từng node/cạnh LLM đề xuất. Evidence không có trong file tree bị loại thẳng.
 */
export function verifyProposal(
  proposal: Proposal,
  fileTree: string[]
): { nodes: DiagramNode[]; edges: DiagramEdge[]; rejected: string[] } {
  const rejected: string[] = [];
  const nodes: DiagramNode[] = [];

  for (const proposed of proposal.nodes) {
    if (!proposed || typeof proposed.id !== 'string') {
      rejected.push(`node không hợp lệ: ${JSON.stringify(proposed)}`);
      continue;
    }
    if (!fileTree.includes(proposed.evidence)) {
      rejected.push(`node ${proposed.id} "${proposed.label}" -> evidence "${proposed.evidence}" không có trong file tree`);
      continue;
    }
    const node: DiagramNode = {
      id: proposed.id,
      label: typeof proposed.label === 'string' && proposed.label ? proposed.label : proposed.id,
      path: proposed.evidence,
      line: 0,
    };
    nodes.push(node);
  }

  const edges: DiagramEdge[] = [];
  for (const proposed of proposal.edges) {
    if (!proposed || typeof proposed.from !== 'string' || typeof proposed.to !== 'string') {
      rejected.push(`cạnh không hợp lệ: ${JSON.stringify(proposed)}`);
      continue;
    }
    const fromKnown = nodes.some((node) => node.id === proposed.from);
    const toKnown = nodes.some((node) => node.id === proposed.to);
    if (!fromKnown || !toKnown) {
      rejected.push(`cạnh ${proposed.from} --> ${proposed.to} trỏ tới node chưa được giữ`);
      continue;
    }
    if (!fileTree.includes(proposed.evidence)) {
      rejected.push(`cạnh ${proposed.from} --> ${proposed.to} -> evidence "${proposed.evidence}" không có trong file tree`);
      continue;
    }
    edges.push({ from: proposed.from, to: proposed.to, line: 0 });
  }

  return { nodes, edges, rejected };
}
