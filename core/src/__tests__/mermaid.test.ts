import test from 'node:test';
import assert from 'node:assert/strict';
import { extractDiagramBlock, MermaidParseError, parseMermaid, parseNodeDeclaration } from '../mermaid';

const SIMPLE = `
graph TD
  AUTH[Auth Service] --> API[Backend Server]
  API --> DB[Firestore Database]
`;

test('parse node có nhãn', () => {
  const { nodes } = parseMermaid(SIMPLE);
  const auth = nodes.find((node) => node.id === 'AUTH');
  assert.ok(auth, 'phải tìm thấy node AUTH');
  assert.equal(auth.label, 'Auth Service');
});

test('parse node không nhãn và node kiểu tròn/nhọn', () => {
  const { nodes } = parseMermaid('graph LR\n  PLAIN\n  ROUND(Round Label)\n  DIA{Decision}');
  assert.equal(nodes.find((node) => node.id === 'PLAIN')?.label, 'PLAIN');
  assert.equal(nodes.find((node) => node.id === 'ROUND')?.label, 'Round Label');
  assert.equal(nodes.find((node) => node.id === 'DIA')?.label, 'Decision');
});

test('parse edge có nhãn', () => {
  const { edges } = parseMermaid('graph TD\n  A[One] -->|gọi HTTP| B[Two]');
  assert.equal(edges.length, 1);
  assert.deepEqual(
    { from: edges[0].from, to: edges[0].to, label: edges[0].label },
    { from: 'A', to: 'B', label: 'gọi HTTP' }
  );
});

test('parse edge trần sinh ra node từ hai đầu', () => {
  const { nodes, edges } = parseMermaid('graph TD\n  A --> B');
  assert.equal(edges.length, 1);
  assert.deepEqual(nodes.map((node) => node.id).sort(), ['A', 'B']);
});

test('node khai báo path tường minh được đọc ra', () => {
  const node = parseNodeDeclaration('SVC[Gateway Service path=backend/src/server.ts]');
  assert.equal(node?.id, 'SVC');
  assert.equal(node?.path, 'backend/src/server.ts');
  assert.equal(node?.label, 'Gateway Service');
});

test('bỏ qua dòng graph, comment và dòng trống', () => {
  const { nodes, edges } = parseMermaid('graph TD\n\n%% chú thích\n  A[One]');
  assert.equal(edges.length, 0);
  assert.equal(nodes.length, 1);
});

test('ghi số dòng theo dòng đầu của khối', () => {
  const { nodes } = parseMermaid('graph TD\n  A[One]', 10);
  assert.equal(nodes[0].line, 11);
});

test('extractDiagramBlock trả về thân sơ đồ và dòng khối', () => {
  const markdown = [
    '# Project',
    '',
    '<!-- AIDER:START -->',
    '```mermaid',
    'graph TD',
    '  A[One]',
    '```',
    '<!-- AIDER:END -->',
  ].join('\n');
  const block = extractDiagramBlock(markdown);
  assert.ok(block);
  assert.equal(block.blockLine, 5);
  assert.match(block.body, /graph TD/);
  assert.doesNotMatch(block.body, /```/);
});

test('extractDiagramBlock trả null khi không có khối', () => {
  assert.equal(extractDiagramBlock('# Project\n\nkhông có sơ đồ'), null);
});

test('extractDiagramBlock báo lỗi khi thiếu AIDER:END', () => {
  assert.throws(
    () => extractDiagramBlock('<!-- AIDER:START -->\n```mermaid\ngraph TD\n  A[x]\n'),
    MermaidParseError
  );
});
