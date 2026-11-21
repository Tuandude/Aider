import { extractDiagramBlock, parseMermaid, readFileTree, resolveNode, VerifyError } from 'aider-core';
import { Command } from 'commander';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { renderMapHtml, readMermaidBundle } from '../mapViewer';

export interface MapCommandOptions {
  out?: string;
  open?: boolean;
  path?: string;
  readme?: string;
}

/**
 * Mở file bằng trình duyệt mặc định của hệ điều hành, không thêm dependency:
 * Windows dùng `start`, macOS dùng `open`, Linux dùng `xdg-open`.
 */
export function openInBrowser(filePath: string): void {
  const platform = process.platform;
  try {
    if (platform === 'win32') {
      // `start` là lệnh nội bộ của cmd, không phải file thực thi riêng.
      exec(`start "" "${filePath}"`);
    } else if (platform === 'darwin') {
      exec(`open "${filePath}"`);
    } else {
      exec(`xdg-open "${filePath}"`);
    }
  } catch {
    console.error(`Không mở được trình duyệt. Hãy mở thủ công: ${filePath}`);
  }
}

/**
 * Lấy danh sách file để ánh xạ node. Ưu tiên `git ls-files` (đúng cái người đọc
 * repo thấy); khi thư mục không phải git repo, đi bộ đĩa thay vì từ chối — bản đồ
 * vẫn hữu ích để NGẮM lỗi kể cả ngoài repo git.
 */
function loadFileTree(repoPath: string): string[] {
  try {
    return readFileTree(repoPath);
  } catch (err: any) {
    if (!(err instanceof VerifyError)) throw err;
  }
  const files: string[] = [];
  const skip = new Set(['node_modules', '.git', 'dist']);
  const walk = (dir: string, prefix: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!skip.has(entry.name)) walk(path.join(dir, entry.name), `${prefix}${entry.name}/`);
      } else if (entry.isFile()) {
        files.push(`${prefix}${entry.name}`);
      }
    }
  };
  walk(repoPath, '');
  return files.sort();
}

/**
 * Chạy `aider map`. Sinh HTML bản đồ tương tác từ sơ đồ trong README.
 *
 * Trả exit code: 0 khi ghi được file (dù sơ đồ còn lỗi — bản đồ vẫn hữu ích để
 * NGẮM lỗi), 2 khi VerifyError (không tìm thấy khối sơ đồ, v.v.).
 */
export function runMap(options: MapCommandOptions): number {
  try {
    const repoPath = options.path ?? process.cwd();
    const readmeFile = options.readme ?? 'README.md';
    const readmePath = path.resolve(repoPath, readmeFile);

    if (!fs.existsSync(readmePath)) {
      throw new VerifyError(`Không tìm thấy ${readmePath}.`);
    }
    const markdown = fs.readFileSync(readmePath, 'utf8');
    const block = extractDiagramBlock(markdown);
    if (!block) {
      throw new VerifyError(
        `Không tìm thấy khối <!-- AIDER:START --> ... <!-- AIDER:END --> trong ${readmePath}.`
      );
    }

    const fileTree = loadFileTree(repoPath);

    const { nodes } = parseMermaid(block.body, block.blockLine);
    const results = nodes.map((node) => resolveNode(node, fileTree));

    const html = renderMapHtml({
      diagramBody: block.body,
      results,
      mermaidBundle: readMermaidBundle(),
      checkedAt: new Date().toISOString(),
    });

    const outFile = path.resolve(options.out ?? 'aider-map.html');
    fs.writeFileSync(outFile, html, 'utf8');

    const counts = { OK: 0, AMBIGUOUS: 0, UNMAPPED: 0 };
    for (const result of results) counts[result.status] += 1;

    console.log(`Đã ghi bản đồ: ${outFile}`);
    console.log(
      `Node: ${results.length} — ${counts.OK} OK, ${counts.AMBIGUOUS} AMBIGUOUS, ${counts.UNMAPPED} UNMAPPED`
    );

    if (options.open) {
      openInBrowser(outFile);
    }
    return 0;
  } catch (err: any) {
    if (err instanceof VerifyError) {
      console.error(`Lỗi: ${err.message}`);
    } else {
      console.error(`Lỗi không mong đợi: ${err.message}`);
    }
    return 2;
  }
}

export function registerMap(command: Command): void {
  command
    .command('map')
    .description('Sinh bản đồ kiến trúc tương tác (HTML) từ sơ đồ trong README')
    .option('--out <file>', 'File HTML ghi ra (mặc định: aider-map.html)')
    .option('--open', 'Mở bản đồ bằng trình duyệt sau khi ghi')
    .option('--path <dir>', 'Thư mục gốc của repo cần vẽ (mặc định: thư mục hiện tại)')
    .option('--readme <file>', 'File chứa sơ đồ, tương đối so với --path (mặc định: README.md)')
    .action((options: MapCommandOptions) => {
      process.exitCode = runMap(options);
    });
}
