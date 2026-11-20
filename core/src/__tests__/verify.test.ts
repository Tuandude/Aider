import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { verify } from '../verify';

function makeRepo(readme: string, files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aider-verify-'));
  fs.writeFileSync(path.join(dir, 'README.md'), readme, 'utf8');
  for (const [file, content] of Object.entries(files)) {
    const absolute = path.join(dir, file);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content, 'utf8');
  }
  return dir;
}

function readmeWith(diagram: string): string {
  return `# Project\n\n<!-- AIDER:START -->\n\`\`\`mermaid\n${diagram}\n\`\`\`\n<!-- AIDER:END -->\n`;
}

test('verify báo đúng node không ánh xạ và trả ok=false', () => {
  const dir = makeRepo(readmeWith('graph TD\n  AUTH[Auth Service] --> API[Server]\n  API --> DB[Firestore Database]'), {
    'src/server.ts': 'export const x = 1;\n',
  });
  const report = verify({ repoPath: dir, fileTree: ['src/server.ts'] });

  assert.equal(report.ok, false);
  assert.deepEqual(report.unmapped.map((result) => result.node.id).sort(), ['AUTH', 'DB']);
  assert.equal(report.unmapped.find((r) => r.node.id === 'API')?.status ?? 'OK', 'OK');
});

test('verify trả ok=true khi mọi node đều ánh xạ', () => {
  const dir = makeRepo(readmeWith('graph TD\n  SERVER[Server] --> FILTER[diffFilter]'), {
    'src/server.ts': "import { filterDiff } from './utils/diffFilter';\n",
    'src/utils/diffFilter.ts': 'export function filterDiff(x: string) { return x; }\n',
  });
  const report = verify({
    repoPath: dir,
    fileTree: ['src/server.ts', 'src/utils/diffFilter.ts'],
  });

  assert.equal(report.ok, true);
  assert.equal(report.unmapped.length, 0);
  assert.equal(report.staleEdges.length, 0);
});

test('verify báo cạnh lệch khi hai file không import nhau', () => {
  const dir = makeRepo(readmeWith('graph TD\n  SERVER[Server] --> FILTER[diffFilter]'), {
    'src/server.ts': 'export const x = 1;\n',
    'src/utils/diffFilter.ts': 'export function filterDiff(x: string) { return x; }\n',
  });
  const report = verify({
    repoPath: dir,
    fileTree: ['src/server.ts', 'src/utils/diffFilter.ts'],
  });

  assert.equal(report.ok, true);
  assert.equal(report.staleEdges.length, 1);
  assert.match(report.staleEdges[0].reason, /không import/);
});

test('verify đọc file tree bằng git ls-files khi không truyền fileTree', () => {
  const aiderRoot = path.resolve(__dirname, '../../..');
  const report = verify({ repoPath: aiderRoot });
  // Sơ đồ trong README đã được sửa ở Pha 2; giờ phải xanh trên chính repo này.
  assert.equal(report.ok, true);
  assert.equal(report.unmapped.length, 0);
});
