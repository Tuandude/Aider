import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { extractDiagramBlock, MermaidParseError, parseMermaid } from './mermaid';
import { parseImports, resolveNode, resolveSpecifier } from './resolve';
import { EdgeResult, NodeResult, VerifyReport } from './types';

export interface VerifyOptions {
  /** Thư mục gốc của repo cần kiểm chứng. Mặc định là thư mục hiện tại. */
  repoPath?: string;
  /** Tên file chứa sơ đồ, tương đối so với repoPath. Mặc định `README.md`. */
  readmeFile?: string;
  /** Danh sách file đã biết, dùng khi không chạy được `git ls-files` (ví dụ trong test). */
  fileTree?: string[];
  /** Nội dung README đã có sẵn, dùng cho repo từ xa (GitHub API) thay vì đọc đĩa. */
  markdown?: string;
  /**
   * Kiểm tra cạnh có import tương ứng không. Phải tắt khi kiểm chứng repo từ xa,
   * vì không đọc được nội dung file nên mọi cạnh sẽ bị báo lệch sai.
   */
  checkEdges?: boolean;
}

export class VerifyError extends Error {}

/**
 * Lấy file tree từ `git ls-files` (chỉ file được track, đúng cái mà người đọc repo thấy).
 */
export function readFileTree(repoPath: string): string[] {
  try {
    const output = execFileSync('git', ['ls-files'], {
      cwd: repoPath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return output.split(/\r?\n/).filter(Boolean);
  } catch (err: any) {
    throw new VerifyError(
      `Không đọc được file tree bằng "git ls-files" trong ${repoPath}: ${err.message}`
    );
  }
}

/**
 * Kiểm chứng sơ đồ kiến trúc trong README.md của một repo.
 * Hoàn toàn tất định: không gọi mạng, không cần API key.
 */
export function verify(options: VerifyOptions = {}): VerifyReport {
  const repoPath = options.repoPath ?? process.cwd();
  const readmeFile = options.readmeFile ?? 'README.md';
  const readmePath = path.resolve(repoPath, readmeFile);

  if (options.markdown === undefined && !fs.existsSync(readmePath)) {
    throw new VerifyError(`Không tìm thấy ${readmePath}.`);
  }

  const fileTree = options.fileTree ?? readFileTree(repoPath);
  const markdown = options.markdown ?? fs.readFileSync(readmePath, 'utf8');
  const block = extractDiagramBlock(markdown);
  if (!block) {
    throw new VerifyError(
      `Không tìm thấy khối <!-- AIDER:START --> ... <!-- AIDER:END --> trong ${readmePath}.`
    );
  }

  const { nodes, edges } = parseMermaid(block.body, block.blockLine);

  const results = nodes.map((node) => resolveNode(node, fileTree));
  const unmapped = results.filter((result) => result.status === 'UNMAPPED');
  const ambiguous = results.filter((result) => result.status === 'AMBIGUOUS');

  const fileOfNode = new Map<string, NodeResult>();
  for (const result of results) {
    fileOfNode.set(result.node.id, result);
  }

  const staleEdges: EdgeResult[] = [];
  if (options.checkEdges !== false) {
    for (const edge of edges) {
      const stale = findStaleEdgeReason(edge.from, edge.to, fileOfNode, repoPath, fileTree);
      if (stale) {
        staleEdges.push({ edge, reason: stale });
      }
    }
  }

  return {
    ok: unmapped.length === 0,
    unmapped,
    ambiguous,
    staleEdges,
    blockLine: block.blockLine,
    checkedAt: new Date().toISOString(),
  };
}

function findStaleEdgeReason(
  from: string,
  to: string,
  fileOfNode: Map<string, NodeResult>,
  repoPath: string,
  fileTree: string[]
): string | null {
  const fromResult = fileOfNode.get(from);
  const toResult = fileOfNode.get(to);

  // Node chưa ánh xạ tới file thì đã bị báo ở `unmapped`; cạnh này không nói thêm được gì.
  if (!fromResult || !toResult || fromResult.status !== 'OK' || toResult.status !== 'OK') {
    return null;
  }

  const fromFile = fromResult.files[0];
  const toFile = toResult.files[0];
  if (fromFile === toFile) {
    return null;
  }

  if (importsFile(fromFile, toFile, repoPath, fileTree)) {
    return null;
  }
  if (importsFile(toFile, fromFile, repoPath, fileTree)) {
    return null;
  }

  return `${fromFile} không import ${toFile} và ngược lại`;
}

function importsFile(sourceFile: string, targetFile: string, repoPath: string, fileTree: string[]): boolean {
  const absolute = path.resolve(repoPath, sourceFile);
  let source: string;
  try {
    source = fs.readFileSync(absolute, 'utf8');
  } catch {
    return false;
  }
  return parseImports(source).some(
    (specifier) => resolveSpecifier(sourceFile, specifier, fileTree) === targetFile
  );
}

export { MermaidParseError, MermaidParseError as ParseError };
