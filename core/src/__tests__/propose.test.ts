import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { idFromPath, renderDiagram, replaceDiagramBlock } from '../diagram';
import { parseProposal, ProposeBlockedError, propose, verifyProposal } from '../propose';
import { Proposal } from '../types';

function makeRepo(readme: string, files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aider-propose-'));
  fs.writeFileSync(path.join(dir, 'README.md'), readme, 'utf8');
  for (const [file, content] of Object.entries(files)) {
    const absolute = path.join(dir, file);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content, 'utf8');
  }
  return dir;
}

const VALID_README = [
  '# Project',
  '',
  '<!-- AIDER:START -->',
  '```mermaid',
  'graph TD',
  '  SERVER[Server]',
  '```',
  '<!-- AIDER:END -->',
].join('\n');

const FILES = {
  'src/server.ts': 'export const server = 1;\n',
  'src/utils/diffFilter.ts': 'export function filterDiff(x: string) { return x; }\n',
};

test('node có evidence hợp lệ được giữ, evidence bịa bị loại', () => {
  const proposal: Proposal = {
    nodes: [
      { id: 'SERVER', label: 'Server', evidence: 'src/server.ts' },
      { id: 'AUTH', label: 'Auth Service', evidence: 'src/auth.ts' },
    ],
    edges: [],
    rationale: 'test',
  };

  const result = verifyProposal(proposal, Object.keys(FILES));

  assert.deepEqual(result.nodes.map((node) => node.id), ['SERVER']);
  assert.equal(result.rejected.length, 1);
  assert.match(result.rejected[0], /AUTH.*src\/auth\.ts/);
});

test('cạnh có evidence bịa bị loại', () => {
  const proposal: Proposal = {
    nodes: [
      { id: 'SERVER', label: 'Server', evidence: 'src/server.ts' },
      { id: 'FILTER', label: 'diffFilter', evidence: 'src/utils/diffFilter.ts' },
    ],
    edges: [
      { from: 'SERVER', to: 'FILTER', evidence: 'src/utils/diffFilter.ts' },
      { from: 'SERVER', to: 'FILTER', evidence: 'src/khong-co.ts' },
    ],
    rationale: 'test',
  };

  const result = verifyProposal(proposal, Object.keys(FILES));

  assert.equal(result.edges.length, 1);
  assert.equal(result.rejected.length, 1);
  assert.match(result.rejected[0], /src\/khong-co\.ts/);
});

test('cạnh trỏ tới node đã bị loại cũng bị loại', () => {
  const proposal: Proposal = {
    nodes: [{ id: 'SERVER', label: 'Server', evidence: 'src/server.ts' }],
    edges: [{ from: 'SERVER', to: 'AUTH', evidence: 'src/server.ts' }],
    rationale: 'test',
  };

  const result = verifyProposal(proposal, Object.keys(FILES));

  assert.equal(result.edges.length, 0);
  assert.match(result.rejected[0], /trỏ tới node chưa được giữ/);
});

test('propose từ chối chạy khi sơ đồ hiện tại còn node không ánh xạ', async () => {
  const dir = makeRepo(
    '# Project\n\n<!-- AIDER:START -->\n```mermaid\ngraph TD\n  AUTH[Auth Service]\n```\n<!-- AIDER:END -->\n',
    FILES
  );

  await assert.rejects(
    () =>
      propose({
        repoPath: dir,
        fileTree: Object.keys(FILES),
        complete: async () => 'unused',
      }),
    ProposeBlockedError
  );
});

test('propose ghép LLM trả về thành sơ đồ đã kiểm chứng', async () => {
  const dir = makeRepo(VALID_README, FILES);
  const llmOutput = JSON.stringify({
    nodes: [
      { id: 'SERVER', label: 'Server', evidence: 'src/server.ts' },
      { id: 'FILTER', label: 'diffFilter', evidence: 'src/utils/diffFilter.ts' },
      { id: 'FAKE', label: 'Fake', evidence: 'src/fake.ts' },
    ],
    edges: [{ from: 'SERVER', to: 'FILTER', evidence: 'src/server.ts' }],
    rationale: 'vì server dùng bộ lọc diff',
  });

  const result = await propose({
    repoPath: dir,
    fileTree: Object.keys(FILES),
    complete: async () => llmOutput,
  });

  assert.equal(result.nodes.length, 2);
  assert.equal(result.rejected.length, 1);
  assert.match(result.diagram, /SERVER\[Server path=src\/server\.ts\]/);
  assert.match(result.diagram, /SERVER --> FILTER/);
  assert.doesNotMatch(result.diagram, /FAKE/);
});

test('propose ném lỗi khi LLM trả JSON hỏng, không ghi gì', async () => {
  const dir = makeRepo(VALID_README, FILES);

  await assert.rejects(
    () =>
      propose({
        repoPath: dir,
        fileTree: Object.keys(FILES),
        complete: async () => 'not json at all',
      }),
    /JSON không hợp lệ/
  );

  assert.match(fs.readFileSync(path.join(dir, 'README.md'), 'utf8'), /SERVER\[Server\]/);
});

test('idFromPath sinh id hợp lệ, ASCII và tránh trùng', () => {
  const used = new Set<string>();
  assert.equal(idFromPath('src/server.ts', used), 'Server');
  assert.equal(idFromPath('other/server.ts', used), 'Server2');
  assert.equal(idFromPath('src/chung-café.ts', used), 'ChungCaf');
});

test('replaceDiagramBlock thay đúng khối', () => {
  const updated = replaceDiagramBlock(VALID_README, 'graph TD\n  A[One]');
  assert.match(updated, /A\[One\]/);
  assert.doesNotMatch(updated, /SERVER\[Server\]/);
  assert.equal(updated.match(/AIDER:START/g)?.length, 1);
});

test('replaceDiagramBlock ném lỗi khi thiếu khối', () => {
  assert.throws(() => replaceDiagramBlock('# No block', 'graph TD'), /không có khối/);
});

test('renderDiagram vẽ đủ node và cạnh có nhãn', () => {
  const diagram = renderDiagram(
    [
      { id: 'A', label: 'One', path: 'src/a.ts', line: 0 },
      { id: 'B', label: 'Two', path: 'src/b.ts', line: 0 },
    ],
    [{ from: 'A', to: 'B', label: 'gọi', line: 0 }]
  );
  assert.match(diagram, /A\[One path=src\/a\.ts\]/);
  assert.match(diagram, /A -->\|gọi\| B/);
});

test('parseProposal báo lỗi khi thiếu mảng nodes', () => {
  assert.throws(() => parseProposal('{"edges":[],"rationale":""}'), /thiếu mảng/);
});
