import { DiagramEdge, DiagramNode } from './types';

/** Đổi đường dẫn file thành id Mermaid hợp lệ: `backend/src/server.ts` -> `SERVER`. */
export function idFromPath(filePath: string, used: Set<string>): string {
  const base = (filePath.split('/').pop() || filePath).replace(/\.[^.]+$/, '');
  const candidate = base
    .replace(/[^A-Za-z0-9]+(.)/g, (_, next: string) => next.toUpperCase())
    .replace(/^./, (char) => char.toUpperCase())
    .replace(/[^A-Za-z0-9_]/g, '');
  const safe = /^[A-Za-z_]/.test(candidate) ? candidate : `N${candidate}`;

  let id = safe;
  let counter = 2;
  while (used.has(id)) {
    id = `${safe}${counter}`;
    counter += 1;
  }
  used.add(id);
  return id;
}

/**
 * Vẽ lại sơ đồ Mermaid từ node và cạnh đã kiểm chứng.
 *
 * Đường dẫn file nằm trong dòng chú thích `%%` chứ không nằm trong nhãn: người đọc chỉ
 * cần thấy tên thành phần, còn `parseMermaid` vẫn đọc được đường dẫn để kiểm chứng.
 */
export function renderDiagram(nodes: DiagramNode[], edges: DiagramEdge[]): string {
  const lines = ['graph TD'];
  for (const node of nodes) {
    lines.push(`  ${node.id}[${node.label}]`);
    if (node.path) {
      lines.push(`  %% path ${node.id}=${node.path}`);
    }
  }
  for (const edge of edges) {
    const label = edge.label ? `|${edge.label}|` : '';
    lines.push(`  ${edge.from} -->${label} ${edge.to}`);
  }
  return lines.join('\n');
}

/**
 * Thay khối `AIDER:START/END` trong README bằng sơ đồ mới.
 * Ném lỗi khi README không có khối — không tự thêm khối ở đây.
 */
export function replaceDiagramBlock(markdown: string, diagram: string): string {
  if (!/<!--\s*AIDER:START\s*-->/.test(markdown) || !/<!--\s*AIDER:END\s*-->/.test(markdown)) {
    throw new Error('README.md không có khối <!-- AIDER:START --> ... <!-- AIDER:END -->.');
  }
  return markdown.replace(
    /<!--\s*AIDER:START\s*-->[\s\S]*?<!--\s*AIDER:END\s*-->/,
    `<!-- AIDER:START -->\n\`\`\`mermaid\n${diagram}\n\`\`\`\n<!-- AIDER:END -->`
  );
}
