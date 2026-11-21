import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { renderMapHtml, safeJson, readMermaidBundle } from '../mapViewer';
import { runMap } from '../commands/map';
import { extractDiagramBlock, parseMermaid, resolveNode } from 'aider-core';

function readmeWith(diagram: string): string {
  return `# Project\n\n<!-- AIDER:START -->\n\`\`\`mermaid\n${diagram}\n\`\`\`\n<!-- AIDER:END -->\n`;
}

function makeRepo(readme: string, files: Record<string, string> = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aider-map-'));
  fs.writeFileSync(path.join(dir, 'README.md'), readme, 'utf8');
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content, 'utf8');
  }
  return dir;
}

const DIAGRAM = [
  'flowchart TD',
  '  SERVER[Server] --> FILTER[diffFilter]',
  '  %% path SERVER=src/server.ts',
  '  %% path FILTER=src/utils/diffFilter.ts',
].join('\n');

test('renderMapHtml nhúng nguyên thân sơ đồ, báo cáo JSON và bundle mermaid', () => {
  const html = renderMapHtml({
    diagramBody: DIAGRAM,
    results: [
      {
        node: { id: 'SERVER', label: 'Server', path: 'src/server.ts', line: 3 },
        status: 'OK',
        files: ['src/server.ts'],
        reason: 'khai báo path=src/server.ts',
      },
    ],
    mermaidBundle: '/*MERMAID_BUNDLE_MARKER*/',
    checkedAt: '2026-11-21T00:00:00.000Z',
  });

  // Thân sơ đồ nguyên bản: giữ cả subgraph/classDef lẫn chú thích %% path.
  assert.ok(html.includes('%% path SERVER=src/server.ts'));
  assert.ok(html.includes('flowchart TD'));
  assert.ok(html.includes('/*MERMAID_BUNDLE_MARKER*/'));
  // Báo cáo JSON cho panel nhấp.
  assert.ok(html.includes('"id":"SERVER"'));
  assert.ok(html.includes('"status":"OK"'));
});

test('safeJson escapes < để dữ liệu không đóng sớm thẻ script', () => {
  const json = safeJson({ label: 'a<br/>b' });
  assert.ok(!json.includes('<'));
  assert.equal(JSON.parse(json).label, 'a<br/>b');
});

test('readMermaidBundle đọc được bundle IIFE gán globalThis.mermaid', () => {
  const bundle = readMermaidBundle();
  assert.ok(bundle.length > 100_000, 'bundle mermaid phải là file lớn');
  assert.ok(bundle.includes('globalThis["mermaid"]'), 'bundle IIFE phải gán globalThis.mermaid');
});

test('runMap ghi file và trả exit code 0 kể cả khi sơ đồ còn lỗi', () => {
  // FILTER trỏ tới file không tồn tại -> UNMAPPED, nhưng map vẫn phải ghi được.
  const dir = makeRepo(readmeWith(DIAGRAM), { 'src/server.ts': 'export const x = 1;\n' });
  const out = path.join(dir, 'map.html');

  const code = runMap({ path: dir, out });

  assert.equal(code, 0);
  const html = fs.readFileSync(out, 'utf8');
  assert.ok(html.includes('"id":"SERVER"'));
  assert.ok(html.includes('"status":"UNMAPPED"'));
  // Chú thích %% path phải được nhúng nguyên bản cho panel nhấp.
  assert.ok(html.includes('%% path FILTER=src/utils/diffFilter.ts'));
});

test('runMap trả exit code 2 khi README không có khối AIDER', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aider-map-'));
  fs.writeFileSync(path.join(dir, 'README.md'), '# Không có sơ đồ\n', 'utf8');
  const out = path.join(dir, 'map.html');

  const code = runMap({ path: dir, out });

  assert.equal(code, 2);
  assert.equal(fs.existsSync(out), false);
});

test('runMap trả exit code 2 khi README không tồn tại', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aider-map-'));

  const code = runMap({ path: dir, out: path.join(dir, 'map.html') });

  assert.equal(code, 2);
});

test('sơ đồ của chính Aider sinh được bản đồ với đủ node', () => {
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const readme = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
  const block = extractDiagramBlock(readme);
  assert.ok(block, 'README của Aider phải có khối AIDER');

  const { nodes } = parseMermaid(block.body, block.blockLine);
  // File tree tối thiểu của chính Aider: đủ cho các node core khai báo trong README.
  const fileTree = ['core/src/propose.ts', 'core/src/verify.ts', 'core/src/mermaid.ts', 'core/src/resolve.ts'];

  const results = nodes.map((node) => resolveNode(node, fileTree));
  const okIds = results.filter((r) => r.status === 'OK').map((r) => r.node.id);
  for (const id of ['PROPOSE', 'VERIFY', 'MERMAID', 'RESOLVE']) {
    assert.ok(okIds.includes(id), `node ${id} phải ánh xạ được tới core/src`);
  }
});

test('CLI built gọi được lệnh map (smoke qua bin sau khi build)', () => {
  // Test này chỉ chạy khi dist đã build; npm test ở workspace root build trước rồi mới test.
  const distIndex = path.resolve(__dirname, '..', 'index.js');
  if (!fs.existsSync(distIndex)) return;

  const dir = makeRepo(readmeWith(DIAGRAM), { 'src/server.ts': 'export const x = 1;\n' });
  const out = path.join(dir, 'cli-map.html');
  execFileSync(process.execPath, [distIndex, 'map', '--path', dir, '--out', out], {
    encoding: 'utf8',
  });
  assert.ok(fs.existsSync(out));
  const stdout = fs.readFileSync(out, 'utf8');
  assert.ok(stdout.includes('Aider'));
});
