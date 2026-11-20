import { DiagramNode, NodeResult, extractDiagramBlock, parseMermaid, resolveNode } from 'aider-core';

export interface DiagramCheck {
  ok: boolean;
  unmapped: NodeResult[];
  ambiguous: NodeResult[];
}

/**
 * Kiểm chứng sơ đồ trong nội dung README của một PR (repo từ xa).
 *
 * Dùng chính bộ phân tích và luật ánh xạ của `aider-core` để bot và CLI không bao giờ
 * phán quyết khác nhau. Không kiểm tra cạnh: nội dung file không có sẵn, nên mọi cạnh
 * sẽ bị báo lệch sai.
 */
export function checkDiagram(markdown: string, fileTreeText: string): DiagramCheck | null {
  const block = extractDiagramBlock(markdown);
  if (!block) {
    return null;
  }
  return checkMermaidText(block.body, fileTreeText, block.blockLine);
}

/** Kiểm chứng một đoạn Mermaid trần (không cần khối AIDER), ví dụ sơ đồ LLM vừa đề xuất. */
export function checkMermaidText(
  mermaidText: string,
  fileTreeText: string,
  firstLine = 1
): DiagramCheck {
  const fileTree = fileTreeText.split(/\r?\n/).filter(Boolean);
  const { nodes } = parseMermaid(mermaidText, firstLine);

  const results: NodeResult[] = nodes.map((node: DiagramNode) => resolveNode(node, fileTree));
  return {
    ok: results.every((result) => result.status !== 'UNMAPPED'),
    unmapped: results.filter((result) => result.status === 'UNMAPPED'),
    ambiguous: results.filter((result) => result.status === 'AMBIGUOUS'),
  };
}

/** Định dạng kết quả kiểm chứng thành Markdown để nhúng vào comment PR. */
export function renderDiagramCheck(check: DiagramCheck | null): string {
  if (!check) {
    return '#### 🧭 Kiểm chứng sơ đồ\nREADME không có khối `AIDER:START/END`.';
  }
  if (check.ok && check.ambiguous.length === 0) {
    return '#### 🧭 Kiểm chứng sơ đồ\n✅ Mọi node ánh xạ tới file có thật.';
  }

  const lines = ['#### 🧭 Kiểm chứng sơ đồ'];
  if (check.unmapped.length > 0) {
    lines.push(`❌ ${check.unmapped.length} node không ánh xạ tới file nào:`);
    for (const result of check.unmapped) {
      lines.push(`- \`${result.node.id}\` "${result.node.label}"  ← ${result.reason}`);
    }
  }
  if (check.ambiguous.length > 0) {
    lines.push(`⚠️ ${check.ambiguous.length} node khớp nhiều file:`);
    for (const result of check.ambiguous) {
      lines.push(`- \`${result.node.id}\` "${result.node.label}"  ← ${result.files.join(', ')}`);
    }
  }
  return lines.join('\n');
}

/**
 * Đưa sơ đồ LLM đề xuất vào comment PR chỉ khi nó tự đứng vững trước bộ kiểm chứng.
 */
export function renderProposedDiagram(mermaidText: string, fileTreeText: string): string {
  const check = checkMermaidText(mermaidText, fileTreeText);
  if (!check.ok) {
    return [
      '#### 📊 Sơ đồ kiến trúc (đề xuất)',
      `⚠️ Đề xuất bị từ chối: ${check.unmapped.length} node không ánh xạ tới file nào. Không đưa sơ đồ này lên sơ đồ chính.`,
      ...check.unmapped.map(
        (result) => `- \`${result.node.id}\` "${result.node.label}"  ← ${result.reason}`
      ),
    ].join('\n');
  }
  return ['#### 📊 Sơ đồ kiến trúc (đề xuất, đã kiểm chứng)', '```mermaid', mermaidText, '```'].join('\n');
}
