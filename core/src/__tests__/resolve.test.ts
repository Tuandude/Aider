import test from 'node:test';
import assert from 'node:assert/strict';
import { DiagramNode } from '../types';
import { parseImports, resolveNode, resolveSpecifier } from '../resolve';

function node(label: string, extra: Partial<DiagramNode> = {}): DiagramNode {
  return { id: label.toUpperCase().replace(/\s+/g, '_'), label, line: 1, ...extra };
}

const TREE = [
  'backend/src/server.ts',
  'backend/src/services/github.ts',
  'backend/src/services/audio.ts',
  'backend/src/utils/diffFilter.ts',
  'core/src/resolve.ts',
  'cli/src/index.ts',
];

test('resolve khớp đúng khi tên file trùng nhãn', () => {
  const result = resolveNode(node('diffFilter'), TREE);
  assert.equal(result.status, 'OK');
  assert.deepEqual(result.files, ['backend/src/utils/diffFilter.ts']);
});

test('resolve khớp sau khi bỏ hậu tố vai trò', () => {
  const result = resolveNode(node('GitHub Service'), TREE);
  assert.equal(result.status, 'OK');
  assert.deepEqual(result.files, ['backend/src/services/github.ts']);
});

test('resolve khớp nhiều file trả AMBIGUOUS', () => {
  const result = resolveNode(node('Server'), ['backend/src/server.ts', 'core/src/server.ts']);
  assert.equal(result.status, 'AMBIGUOUS');
  assert.equal(result.files.length, 2);
});

test('resolve không khớp file nào trả UNMAPPED', () => {
  const result = resolveNode(node('Auth Service'), TREE);
  assert.equal(result.status, 'UNMAPPED');
  assert.deepEqual(result.files, []);
});

test('resolve theo path tường minh, kể cả khi nhãn không khớp', () => {
  const result = resolveNode(node('Cổng API', { path: 'backend/src/server.ts' }), TREE);
  assert.equal(result.status, 'OK');
  assert.deepEqual(result.files, ['backend/src/server.ts']);
});

test('resolve theo path báo UNMAPPED khi file không tồn tại', () => {
  const result = resolveNode(node('Cổng API', { path: 'backend/src/khong-co.ts' }), TREE);
  assert.equal(result.status, 'UNMAPPED');
  assert.match(result.reason, /không tồn tại/);
});

test('chuẩn hoá bỏ dấu, khoảng trắng và khác biệt hoa thường', () => {
  const result = resolveNode(node('Diff Filter'), TREE);
  assert.equal(result.status, 'OK');
  assert.deepEqual(result.files, ['backend/src/utils/diffFilter.ts']);
});

test('parseImports chỉ giữ specifier tương đối', () => {
  const source = [
    "import fs from 'fs';",
    "import path from 'path';",
    "import { filterDiff } from './utils/diffFilter';",
    "const other = require('../services/github');",
    "export { x } from './resolve';",
  ].join('\n');
  assert.deepEqual(parseImports(source), ['./utils/diffFilter', '../services/github', './resolve']);
});

test('resolveSpecifier dịch ../ về đúng thư mục', () => {
  const target = resolveSpecifier('backend/src/services/github.ts', '../utils/diffFilter', TREE);
  assert.equal(target, 'backend/src/utils/diffFilter.ts');
});

test('resolveSpecifier trả null khi file đích không có trong cây', () => {
  const target = resolveSpecifier('backend/src/services/github.ts', '../utils/missing', TREE);
  assert.equal(target, null);
});
