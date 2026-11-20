import { DiagramNode, NodeResult } from './types';

/** Hậu tố mô tả vai trò bị bỏ qua khi so khớp tên file. */
const ROLE_SUFFIXES = ['service', 'api', 'gateway', 'server', 'database', 'db', 'client'];

/** Bỏ phần đuôi mở rộng của đường dẫn file. */
function baseName(filePath: string): string {
  const file = filePath.split('/').pop() || filePath;
  const dot = file.lastIndexOf('.');
  return dot > 0 ? file.slice(0, dot) : file;
}

/** Chỉ giữ chữ và số, chữ thường. `Backend API Gateway` -> `backendapigateway`. */
function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Bỏ một hậu tố vai trò ở cuối, trả về danh sách biến thể ứng viên. */
function stripRoleSuffix(normalized: string): string[] {
  const variants = [normalized];
  for (const suffix of ROLE_SUFFIXES) {
    if (normalized.length > suffix.length && normalized.endsWith(suffix)) {
      variants.push(normalized.slice(0, -suffix.length));
    }
  }
  return variants;
}

/**
 * Ánh xạ một node tới file trong repo. Tất định, không fuzzy, không LLM.
 *
 * Thứ tự ưu tiên:
 * 1. Node khai báo `path` tường minh -> kiểm tra file đó có trong file tree.
 * 2. Tên file (bỏ đuôi) chuẩn hoá trùng khớp với label chuẩn hoá (bỏ hậu tố vai trò).
 * 3. Không khớp file nào -> UNMAPPED. Khớp nhiều hơn một -> AMBIGUOUS.
 */
export function resolveNode(node: DiagramNode, fileTree: string[]): NodeResult {
  if (node.path) {
    const matches = fileTree.filter(
      (file) => file === node.path || file.endsWith('/' + node.path)
    );
    if (matches.length === 1) {
      return { node, status: 'OK', files: matches, reason: `khai báo path=${node.path}` };
    }
    if (matches.length === 0) {
      return {
        node,
        status: 'UNMAPPED',
        files: [],
        reason: `khai báo path=${node.path} nhưng file không tồn tại`,
      };
    }
    return {
      node,
      status: 'AMBIGUOUS',
      files: matches,
      reason: `khai báo path=${node.path} khớp ${matches.length} file`,
    };
  }

  const candidates = stripRoleSuffix(normalize(node.label)).filter(
    (variant) => variant.length >= 3
  );
  if (candidates.length === 0) {
    return { node, status: 'UNMAPPED', files: [], reason: 'nhãn quá ngắn để so khớp' };
  }

  const matches = fileTree.filter((file) => candidates.includes(normalize(baseName(file))));

  if (matches.length === 1) {
    return { node, status: 'OK', files: matches, reason: `tên file khớp nhãn "${node.label}"` };
  }
  if (matches.length > 1) {
    return {
      node,
      status: 'AMBIGUOUS',
      files: matches,
      reason: `nhãn "${node.label}" khớp ${matches.length} file`,
    };
  }
  return {
    node,
    status: 'UNMAPPED',
    files: [],
    reason: `không có file nào tên khớp nhãn "${node.label}"`,
  };
}

/**
 * Đọc danh sách import nội bộ từ nội dung một file TypeScript/JavaScript.
 * Trả về các specifier dạng `./foo`, `../bar` — bỏ qua package ngoài.
 */
export function parseImports(source: string): string[] {
  const specifiers: string[] = [];
  const patterns = [
    /(?:^|\n)\s*import\s[^;]*?from\s*['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g,
    /require\(\s*['"]([^'"]+)['"]\s*\)/g,
    /(?:^|\n)\s*export\s[^;]*?from\s*['"]([^'"]+)['"]/g,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      if (match[1].startsWith('.')) {
        specifiers.push(match[1]);
      }
    }
  }
  return [...new Set(specifiers)];
}

/**
 * Dịch một specifier tương đối về đường dẫn file trong repo.
 * `src/a.ts` + `./b` -> `src/b.ts`; thử các đuôi phổ biến và `index`.
 */
export function resolveSpecifier(fromFile: string, specifier: string, fileTree: string[]): string | null {
  const segments = fromFile.split('/').slice(0, -1);
  for (const part of specifier.split('/')) {
    if (part === '.' || part === '') continue;
    if (part === '..') segments.pop();
    else segments.push(part);
  }
  const base = segments.join('/');
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.mjs`,
    `${base}.cjs`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    `${base}/index.js`,
  ];
  return candidates.find((candidate) => fileTree.includes(candidate)) ?? null;
}
