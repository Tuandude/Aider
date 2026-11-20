import { VerifyReport } from 'aider-core';

const RESET = '\u001b[0m';
const colors = {
  red: (text: string) => `\u001b[31m${text}${RESET}`,
  yellow: (text: string) => `\u001b[33m${text}${RESET}`,
  green: (text: string) => `\u001b[32m${text}${RESET}`,
  dim: (text: string) => `\u001b[2m${text}${RESET}`,
  bold: (text: string) => `\u001b[1m${text}${RESET}`,
};

function usesColor(): boolean {
  return process.stdout.isTTY === true && !process.env.NO_COLOR;
}

function paint(enable: boolean, fn: (text: string) => string, text: string): string {
  return enable ? fn(text) : text;
}

function formatLine(line: number): string {
  return line > 0 ? ` (dòng ${line})` : '';
}

/** In báo cáo verify cho người đọc. */
export function printHumanReport(report: VerifyReport): void {
  const color = usesColor();

  if (report.unmapped.length > 0) {
    console.log(
      paint(color, colors.red, `✗ ${report.unmapped.length} node không ánh xạ tới file nào`)
    );
    for (const result of report.unmapped) {
      console.log(
        `  ${paint(color, colors.bold, result.node.id.padEnd(12))} ${paint(
          color,
          colors.dim,
          `"${result.node.label}"`
        )}${formatLine(result.node.line)}  ← ${result.reason}`
      );
    }
    console.log('');
  }

  if (report.ambiguous.length > 0) {
    console.log(
      paint(color, colors.yellow, `! ${report.ambiguous.length} node khớp nhiều file`)
    );
    for (const result of report.ambiguous) {
      console.log(
        `  ${paint(color, colors.bold, result.node.id.padEnd(12))} ${paint(
          color,
          colors.dim,
          `"${result.node.label}"`
        )}${formatLine(result.node.line)}  ← ${result.files.join(', ')}`
      );
    }
    console.log('');
  }

  if (report.staleEdges.length > 0) {
    console.log(paint(color, colors.yellow, `! ${report.staleEdges.length} cạnh không có import tương ứng`));
    for (const result of report.staleEdges) {
      console.log(
        `  ${result.edge.from} --> ${result.edge.to}${formatLine(result.edge.line)}  ← ${result.reason}`
      );
    }
    console.log('');
  }

  const mapped = report.unmapped.length === 0
    ? 'Toàn bộ node đều ánh xạ tới file có thật.'
    : 'Sửa sơ đồ hoặc thêm dòng %% path <ID>=<file> dưới node.';
  console.log(report.ok ? paint(color, colors.green, `✓ ${mapped}`) : paint(color, colors.dim, mapped));
}

/**
 * Dựng nội dung bình luận PR từ báo cáo verify.
 *
 * Dòng đánh dấu ở đầu cho phép workflow tìm lại bình luận cũ và cập nhật thay vì
 * thêm bình luận mới sau mỗi lần push.
 */
export function renderMarkdownReport(report: VerifyReport): string {
  const lines: string[] = ['<!-- AIDER-REVIEW -->', '### 🧭 Aider — Kiểm chứng sơ đồ kiến trúc'];

  if (report.ok && report.staleEdges.length === 0) {
    lines.push('', '✅ Mọi node ánh xạ tới file có thật, không có cạnh lệch.');
  }

  if (report.unmapped.length > 0) {
    lines.push('', `#### ❌ ${report.unmapped.length} node không ánh xạ tới file nào`);
    for (const result of report.unmapped) {
      lines.push(`- \`${result.node.id}\` "${result.node.label}"${formatLine(result.node.line)}  ← ${result.reason}`);
    }
    lines.push('', 'Sửa sơ đồ hoặc thêm dòng `%% path <ID>=<file>` dưới node.');
  }

  if (report.ambiguous.length > 0) {
    lines.push('', `#### ⚠️ ${report.ambiguous.length} node khớp nhiều file`);
    for (const result of report.ambiguous) {
      lines.push(`- \`${result.node.id}\` "${result.node.label}"${formatLine(result.node.line)}  ← ${result.files.join(', ')}`);
    }
  }

  if (report.staleEdges.length > 0) {
    lines.push('', `#### ⚠️ ${report.staleEdges.length} cạnh không có import tương ứng`);
    for (const result of report.staleEdges) {
      lines.push(`- \`${result.edge.from}\` → \`${result.edge.to}\`${formatLine(result.edge.line)}  ← ${result.reason}`);
    }
  }

  lines.push('', '---', `*Kiểm chứng tất định, không dùng LLM · ${report.checkedAt}*`);
  return lines.join('\n');
}
