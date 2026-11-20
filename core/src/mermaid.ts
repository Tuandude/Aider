import { DiagramEdge, DiagramNode } from './types';

export interface ParsedDiagram {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

export interface MermaidBlock {
  /** Nội dung bên trong khối ```mermaid, đã bỏ fence. */
  body: string;
  /** Số dòng 1-based của dòng chứa `AIDER:START` trong tài liệu gốc. */
  blockLine: number;
}

export class MermaidParseError extends Error {}

const NODE_DECLARATION = /^([A-Za-z_][\w-]*)\s*([\[\(\{])([^\]\)\}]+)([\]\)\}])\s*$/;

/** Dòng mở/đóng nhóm và dòng trang trí, không phải node cũng không phải cạnh. */
const STRUCTURAL_LINE = /^(subgraph\b|end\s*$|classDef\b|class\b|style\b|linkStyle\b|click\b|direction\b)/i;

/**
 * Bóc thẻ xuống dòng trong nhãn. Mermaid hiển thị `<br/>` thành xuống dòng; parser chỉ
 * giữ phần chữ để `path=` và so khớp tên file không bị dính ký tự trang trí.
 */
function stripLineBreaks(label: string): string {
  return label.replace(/<br\s*\/?>/gi, ' ');
}


/**
 * Trích khối sơ đồ giữa `<!-- AIDER:START -->` và `<!-- AIDER:END -->` trong một tài liệu Markdown.
 * Trả về null khi không có khối.
 */
export function extractDiagramBlock(markdown: string): MermaidBlock | null {
  const lines = markdown.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => line.includes('AIDER:START'));
  if (startIndex === -1) {
    return null;
  }
  const endIndex = lines.findIndex((line, i) => i > startIndex && line.includes('AIDER:END'));
  if (endIndex === -1) {
    throw new MermaidParseError(
      `Không tìm thấy dòng AIDER:END sau AIDER:START (dòng ${startIndex + 1}).`
    );
  }

  const inner = lines.slice(startIndex + 1, endIndex);
  const fenceStart = inner.findIndex((line) => /^\s*```mermaid\s*$/.test(line));
  const body = fenceStart === -1
    ? inner.join('\n')
    : inner.slice(fenceStart + 1).join('\n');

  return {
    body: body.replace(/```/g, '').trim(),
    // Dòng đầu tiên của sơ đồ có thể là dòng đầu khối; dùng dòng chứa fence để báo lỗi đúng hơn.
    blockLine: startIndex + 2 + (fenceStart === -1 ? 0 : fenceStart + 1),
  };
}

/**
 * Tách khai báo node và cạnh từ thân sơ đồ Mermaid.
 *
 * Nhận dạng node: `ID[Label]`, `ID(Label)`, `ID{Label}`, hoặc `ID` trần.
 * Nhận dạng cạnh: `A --> B`, `A -->|label| B`.
 * Dòng cấu trúc (`subgraph`, `end`, `classDef`, `style`, …) bị bỏ qua: chúng trang trí
 * sơ đồ chứ không khai báo thành phần nào ánh xạ tới file.
 */
export function parseMermaid(body: string, firstLine = 1): ParsedDiagram {
  const nodes = new Map<string, DiagramNode>();
  const edges: DiagramEdge[] = [];

  body.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    const lineNumber = firstLine + index;

    if (!line || line.startsWith('%%') || /^graph\s+/i.test(line) || /^flowchart\s+/i.test(line)) {
      return;
    }
    if (STRUCTURAL_LINE.test(line)) {
      return;
    }

    const cleaned = line.replace(/;+$/, '').trim();
    const arrow = splitOnArrow(cleaned);

    if (!arrow) {
      const declared = parseNodeDeclaration(cleaned);
      if (declared) {
        const existing = nodes.get(declared.id);
        if (!existing || (existing.label === existing.id && declared.label !== declared.id)) {
          nodes.set(declared.id, { ...declared, line: lineNumber });
        }
      }
      return;
    }

    const from = parseNodeDeclaration(arrow.left);
    const to = parseNodeDeclaration(arrow.right);
    if (!from || !to) {
      return;
    }

    registerNode(nodes, from, lineNumber);
    registerNode(nodes, to, lineNumber);
    edges.push({
      from: from.id,
      to: to.id,
      ...(arrow.label ? { label: arrow.label } : {}),
      line: lineNumber,
    });
  });

  return { nodes: [...nodes.values()], edges };
}

function registerNode(nodes: Map<string, DiagramNode>, node: DiagramNode, line: number): void {
  const existing = nodes.get(node.id);
  if (!existing) {
    nodes.set(node.id, { ...node, line });
    return;
  }
  // Ưu tiên khai báo có nhãn hơn nhãn mặc định bằng id.
  if (existing.label === existing.id && node.label !== node.id) {
    nodes.set(node.id, { ...node, line: existing.line });
  }
}

function splitOnArrow(line: string): { left: string; right: string; label?: string } | null {
  const labeled = line.match(/^(.+?)\s*-->\s*\|([^|]*)\|\s*(.+)$/);
  if (labeled) {
    return { left: labeled[1], right: labeled[3], label: labeled[2].trim() };
  }
  const plain = line.match(/^(.+?)\s*-->\s*(.+)$/);
  if (plain) {
    return { left: plain[1], right: plain[2] };
  }
  return null;
}

/**
 * Đọc một mẩu văn bản thành node. Nhận cả dạng có nhãn `ID[...]` và dạng trần `ID`.
 * Trả về null nếu không phải node.
 */
export function parseNodeDeclaration(raw: string): DiagramNode | null {
  const text = raw.trim();
  const match = text.match(NODE_DECLARATION);
  if (!match) {
    if (/^[A-Za-z_][\w-]*$/.test(text)) {
      return { id: text, label: text, line: 0 };
    }
    return null;
  }

  const [, id, , label] = match;
  const trimmedLabel = stripLineBreaks(label.trim());
  // Nhãn Mermaid thường được bọc ngoặc kép; `path=` dừng ở ngoặc để không nuốt dấu đóng.
  const inlinePath = trimmedLabel.match(/\bpath\s*=\s*([^\s\]"']+)/);
  const labelText = trimmedLabel
    .replace(/\bpath\s*=\s*[^\s\]"']+/g, '')
    .replace(/^["']|["']$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return {
    id,
    label: labelText || id,
    ...(inlinePath ? { path: inlinePath[1] } : {}),
    line: 0,
  };
}
