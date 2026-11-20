import { Command } from 'commander';
import { verify, VerifyError } from 'aider-core';
import { printHumanReport, renderMarkdownReport } from '../report';

export interface VerifyCommandOptions {
  json?: boolean;
  markdown?: boolean;
  path?: string;
  readme?: string;
}

/**
 * Chạy `aider verify`. Trả exit code để commander không tự thoát.
 */
export function runVerify(options: VerifyCommandOptions): number {
  try {
    const report = verify({
      repoPath: options.path,
      readmeFile: options.readme,
    });

    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else if (options.markdown) {
      console.log(renderMarkdownReport(report));
    } else {
      printHumanReport(report);
    }

    return report.ok ? 0 : 1;
  } catch (err: any) {
    if (err instanceof VerifyError) {
      console.error(`Lỗi: ${err.message}`);
    } else {
      console.error(`Lỗi không mong đợi: ${err.message}`);
    }
    return 2;
  }
}

export function registerVerify(command: Command): void {
  command
    .command('verify')
    .description('Kiểm chứng mọi node trong sơ đồ README ánh xạ tới file có thật')
    .option('--json', 'In báo cáo dạng JSON máy đọc')
    .option('--markdown', 'In báo cáo dạng Markdown để dán vào bình luận PR')
    .option('--path <dir>', 'Thư mục gốc của repo cần kiểm chứng (mặc định: thư mục hiện tại)')
    .option('--readme <file>', 'File chứa sơ đồ, tương đối so với --path (mặc định: README.md)')
    .action((options: VerifyCommandOptions) => {
      process.exitCode = runVerify(options);
    });
}
