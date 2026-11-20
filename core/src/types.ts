/**
 * Kiểu dữ liệu dùng chung giữa core, CLI và backend.
 */

/** Một node trong sơ đồ Mermaid, kèm số dòng để báo lỗi chỉ đúng chỗ. */
export interface DiagramNode {
  id: string;
  /** Nhãn hiển thị. Bằng `id` khi node không có nhãn. */
  label: string;
  /** Thuộc tính `path` tường minh, nếu node khai báo. */
  path?: string;
  /** Số dòng 1-based trong README.md. */
  line: number;
}

/** Một cạnh `A --> B` (có thể kèm nhãn) trong sơ đồ. */
export interface DiagramEdge {
  from: string;
  to: string;
  label?: string;
  line: number;
}

export type ResolveStatus = 'OK' | 'AMBIGUOUS' | 'UNMAPPED';

/** Kết quả ánh xạ một node tới file trong repo. */
export interface NodeResult {
  node: DiagramNode;
  status: ResolveStatus;
  /** File khớp. Một phần tử khi OK, nhiều khi AMBIGUOUS, rỗng khi UNMAPPED. */
  files: string[];
  /** Lý do ngắn gọn để in cho người đọc. */
  reason: string;
}

/** Cạnh có thật trong code (một file import file khác) nhưng không có trên sơ đồ. */
export interface EdgeResult {
  edge: DiagramEdge;
  reason: string;
}

export interface VerifyReport {
  ok: boolean;
  unmapped: NodeResult[];
  ambiguous: NodeResult[];
  staleEdges: EdgeResult[];
  /** Dòng trong README chứa khối AIDER; 0 khi không tìm thấy khối. */
  blockLine: number;
  checkedAt: string;
}

/** LLM đề xuất sơ đồ. Mọi `evidence` phải là đường dẫn file có thật. */
export interface Proposal {
  nodes: Array<{ id: string; label: string; evidence: string }>;
  edges: Array<{ from: string; to: string; evidence: string }>;
  rationale: string;
}
