import fs from 'fs';
import path from 'path';
import { Command } from 'commander';
import { ProposeBlockedError, propose, replaceDiagramBlock } from 'aider-core';
import { createGeminiCompleter } from '../gemini';

export interface ProposeCommandOptions {
  dryRun?: boolean;
  write?: boolean;
  path?: string;
  readme?: string;
}

/**
 * Chạy `aider propose`. Mặc định chỉ in ra; `--write` mới ghi vào README.
 * Không có fallback: LLM lỗi thì thoát khác 0 và không ghi gì.
 */
export async function runPropose(options: ProposeCommandOptions): Promise<number> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('Lỗi: thiếu GEMINI_API_KEY. `propose` cần LLM; `verify` thì không.');
    return 2;
  }

  const repoPath = options.path ?? process.cwd();
  const readmeFile = options.readme ?? 'README.md';
  const shouldWrite = options.write === true && options.dryRun !== true;

  try {
    const result = await propose({
      repoPath,
      readmeFile,
      complete: createGeminiCompleter(apiKey),
    });

    if (result.rejected.length > 0) {
      console.warn(`! ${result.rejected.length} đề xuất bị loại vì evidence không có thật:`);
      for (const rejection of result.rejected) {
        console.warn(`  - ${rejection}`);
      }
      console.warn('');
    }

    console.log(result.diagram);
    if (result.rationale) {
      console.log(`\nLý do: ${result.rationale}`);
    }

    if (!shouldWrite) {
      console.log('\n(dry-run: chưa ghi. Thêm --write để cập nhật README.)');
      return 0;
    }

    const readmePath = path.resolve(repoPath, readmeFile);
    const markdown = fs.readFileSync(readmePath, 'utf8');
    fs.writeFileSync(readmePath, replaceDiagramBlock(markdown, result.diagram), 'utf8');
    console.log(`\nĐã ghi sơ đồ vào ${readmeFile}.`);
    return 0;
  } catch (err: any) {
    if (err instanceof ProposeBlockedError) {
      console.error(`Không thể propose:\n${err.message}`);
      return 1;
    }
    console.error(`Lỗi: ${err.message}`);
    return 2;
  }
}

export function registerPropose(command: Command): void {
  command
    .command('propose')
    .description('Đề xuất sơ đồ mới; mọi node phải chứng minh bằng đường dẫn file có thật')
    .option('--dry-run', 'Chỉ in ra, không ghi (mặc định)')
    .option('--write', 'Ghi sơ đồ vào khối AIDER trong README')
    .option('--path <dir>', 'Thư mục gốc của repo (mặc định: thư mục hiện tại)')
    .option('--readme <file>', 'File chứa sơ đồ (mặc định: README.md)')
    .action((options: ProposeCommandOptions) => {
      runPropose(options).then((code) => {
        process.exitCode = code;
      });
    });
}
