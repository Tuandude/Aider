import { NodeResult, ResolveStatus } from 'aider-core';
import fs from 'fs';

/** Dữ liệu một node nhúng vào HTML cho panel nhấp-chi tiết. */
export interface MapNodeData {
  id: string;
  label: string;
  /** Đường dẫn khai báo qua `%% path ID=...`, null khi node không khai báo. */
  path: string | null;
  /** Số dòng 1-based trong README; 0 khi không xác định. */
  line: number;
  status: ResolveStatus;
  files: string[];
  reason: string;
}

export interface MapHtmlInput {
  /** Thân sơ đồ Mermaid nguyên bản (giữ subgraph, classDef, style, chú thích %%). */
  diagramBody: string;
  /** Kết quả ánh xạ từng node, tính bằng `resolveNode` của core. */
  results: NodeResult[];
  /** Toàn bộ bundle mermaid trình duyệt, nhúng thẳng vào trang. */
  mermaidBundle: string;
  checkedAt: string;
}

/** Đường dẫn bundle mermaid dạng IIFE: gán `globalThis.mermaid` khi nhúng qua thẻ script. */
export function resolveMermaidBundlePath(): string {
  return require.resolve('mermaid/dist/mermaid.min.js');
}

/** Đọc bundle mermaid từ node_modules để nhúng nội tuyến. */
export function readMermaidBundle(): string {
  return fs.readFileSync(resolveMermaidBundlePath(), 'utf8');
}

/**
 * JSON an toàn khi nhúng vào thẻ <script>: escapes `<` để chuỗi `</script>`
 * trong dữ liệu (ví dụ nhãn chứa `<br/>`) không đóng thẻ sớm.
 */
export function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Sinh trang HTML bản đồ tương tác, tự trọn vẹn: mermaid nhúng nội tuyến,
 * sơ đồ gốc giữ nguyên, báo cáo ánh xạ nhúng dạng JSON. Mở được qua file://.
 */
export function renderMapHtml(input: MapHtmlInput): string {
  const counts: Record<ResolveStatus, number> = { OK: 0, AMBIGUOUS: 0, UNMAPPED: 0 };
  for (const result of input.results) {
    counts[result.status] += 1;
  }

  const payload = {
    diagram: input.diagramBody,
    nodes: input.results.map((result) => ({
      id: result.node.id,
      label: result.node.label,
      path: result.node.path ?? null,
      line: result.node.line,
      status: result.status,
      files: result.files,
      reason: result.reason,
    })),
    checkedAt: input.checkedAt,
  };

  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Aider — bản đồ kiến trúc tương tác</title>
<style>
  :root {
    --bg: #0f172a; --chrome: #1e293b; --line: #334155;
    --fg: #e2e8f0; --muted: #94a3b8;
    --ok: #16a34a; --warn: #d97706; --bad: #dc2626;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; height: 100vh; overflow: hidden;
    display: flex; flex-direction: column;
    background: var(--bg); color: var(--fg);
    font-family: 'Segoe UI', system-ui, sans-serif; font-size: 14px;
  }
  code, .mono { font-family: Consolas, 'Cascadia Mono', monospace; }
  #bar {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 12px; background: var(--chrome);
    border-bottom: 1px solid var(--line); flex: none;
  }
  #bar strong { margin-right: 8px; }
  #bar button {
    background: #0f172a; color: var(--fg); border: 1px solid var(--line);
    border-radius: 6px; padding: 4px 10px; cursor: pointer; font-size: 13px;
  }
  #bar button:hover { border-color: var(--muted); }
  #zoom-label { min-width: 44px; text-align: center; color: var(--muted); }
  .legend { display: inline-flex; align-items: center; gap: 6px; margin-left: auto; color: var(--muted); }
  .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; }
  .lg-ok { background: var(--ok); } .lg-warn { background: var(--warn); } .lg-bad { background: var(--bad); }
  #summary-chip {
    margin-left: 12px; padding: 3px 10px; border-radius: 999px;
    background: #0f172a; border: 1px solid var(--line); color: var(--muted); font-size: 12px;
  }
  #viewport { position: relative; flex: 1; overflow: hidden; cursor: grab; user-select: none; touch-action: none; }
  #viewport.dragging { cursor: grabbing; }
  #canvas { position: absolute; top: 0; left: 0; transform-origin: 0 0; will-change: transform; }
  #canvas svg { display: block; }
  #hint {
    position: absolute; bottom: 10px; left: 50%; transform: translateX(-50%);
    padding: 4px 14px; border-radius: 999px; background: var(--chrome);
    border: 1px solid var(--line); color: var(--muted); font-size: 12px; pointer-events: none;
  }
  .render-error { margin: 40px auto; max-width: 640px; padding: 16px; border: 1px solid var(--bad); border-radius: 8px; }
  #panel {
    position: absolute; top: 0; right: 0; width: 320px; height: 100%;
    background: var(--chrome); border-left: 1px solid var(--line);
    padding: 16px; overflow-y: auto;
  }
  #panel[hidden] { display: none; }
  #panel h2 { margin: 0 24px 4px 0; font-size: 16px; }
  #panel .lbl { margin: 0 0 10px; color: var(--muted); }
  #panel-close {
    position: absolute; top: 10px; right: 10px;
    background: none; border: 1px solid var(--line); border-radius: 6px;
    color: var(--muted); cursor: pointer; padding: 2px 8px;
  }
  #panel dl { margin: 12px 0 0; }
  #panel dt { color: var(--muted); font-size: 12px; text-transform: uppercase; margin-top: 10px; }
  #panel dd { margin: 4px 0 0; }
  #panel ul.files { list-style: none; margin: 0; padding: 0; }
  #panel ul.files li { margin: 2px 0; }
  #panel ul.files li.none { color: var(--muted); }
  .badge {
    display: inline-block; padding: 2px 10px; border-radius: 999px;
    font-size: 12px; font-weight: 600; color: #fff;
  }
  .badge-ok { background: var(--ok); } .badge-warn { background: var(--warn); } .badge-bad { background: var(--bad); }

  /* Tô trạng thái verify bằng nét viền, KHÔNG đụng vào fill của classDef gốc
     để màu nhóm (core/cli/backend) vẫn giữ nguyên. */
  #canvas svg g.node { cursor: pointer; }
  #canvas svg g.node.aider-unknown { cursor: default; }
  #canvas svg g.node rect, #canvas svg g.node polygon, #canvas svg g.node path,
  #canvas svg g.node circle, #canvas svg g.node ellipse { stroke-width: 2.5px !important; }
  #canvas svg g.node.aider-ok rect, #canvas svg g.node.aider-ok polygon,
  #canvas svg g.node.aider-ok path, #canvas svg g.node.aider-ok circle,
  #canvas svg g.node.aider-ok ellipse { stroke: var(--ok) !important; }
  #canvas svg g.node.aider-warn rect, #canvas svg g.node.aider-warn polygon,
  #canvas svg g.node.aider-warn path, #canvas svg g.node.aider-warn circle,
  #canvas svg g.node.aider-warn ellipse { stroke: var(--warn) !important; }
  #canvas svg g.node.aider-bad rect, #canvas svg g.node.aider-bad polygon,
  #canvas svg g.node.aider-bad path, #canvas svg g.node.aider-bad circle,
  #canvas svg g.node.aider-bad ellipse { stroke: var(--bad) !important; }
  #canvas svg g.node:hover { filter: brightness(1.08); }
</style>
</head>
<body>
<header id="bar">
  <strong>Aider</strong>
  <button data-act="in" title="Phóng to (+)">＋</button>
  <button data-act="out" title="Thu nhỏ (−)">－</button>
  <button data-act="fit" title="Vừa khung (F)">⤢ Vừa khung</button>
  <button data-act="reset" title="Đặt lại 100% (0)">100%</button>
  <span id="zoom-label">100%</span>
  <span id="summary-chip">${counts.OK} OK · ${counts.AMBIGUOUS} AMBIGUOUS · ${counts.UNMAPPED} UNMAPPED</span>
  <span class="legend"><i class="lg-ok"></i>OK&nbsp;<i class="lg-warn"></i>AMBIGUOUS&nbsp;<i class="lg-bad"></i>UNMAPPED</span>
</header>
<main id="viewport">
  <div id="canvas"></div>
  <div id="hint">Kéo để di chuyển · Cuộn để thu phóng · Nhấp vào node để xem chi tiết</div>
</main>
<aside id="panel" hidden></aside>
<noscript>Trang này cần JavaScript để vẽ sơ đồ.</noscript>
<script>${input.mermaidBundle}</script>
<script>
var AIDER_DATA = ${safeJson(payload)};
</script>
<script>
(function () {
  'use strict';
  var data = AIDER_DATA;
  var byId = {};
  data.nodes.forEach(function (n) { byId[n.id] = n; });

  var viewport = document.getElementById('viewport');
  var canvas = document.getElementById('canvas');
  var panel = document.getElementById('panel');
  var zoomLabel = document.getElementById('zoom-label');
  var tx = 0, ty = 0, scale = 1;

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function apply() {
    canvas.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
    zoomLabel.textContent = Math.round(scale * 100) + '%';
  }
  function center() { return [viewport.clientWidth / 2, viewport.clientHeight / 2]; }
  function zoomAt(px, py, factor) {
    var ns = clamp(scale * factor, 0.05, 8);
    if (ns === scale) return;
    // Giữ điểm dưới con trỏ đứng yên: điểm thế giới p không đổi trước và sau khi đổi tỉ lệ.
    tx = px - (px - tx) * (ns / scale);
    ty = py - (py - ty) * (ns / scale);
    scale = ns;
    apply();
  }
  function fit() {
    var svg = canvas.querySelector('svg');
    if (!svg) return;
    var vb = svg.viewBox.baseVal;
    if (!vb || !vb.width || !vb.height) return;
    var pad = 24;
    scale = clamp(Math.min((viewport.clientWidth - pad * 2) / vb.width, (viewport.clientHeight - pad * 2) / vb.height), 0.05, 2);
    tx = (viewport.clientWidth - vb.width * scale) / 2 - vb.x * scale;
    ty = (viewport.clientHeight - vb.height * scale) / 2 - vb.y * scale;
    apply();
  }
  function reset() { scale = 1; tx = 0; ty = 0; apply(); }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---- Ghép SVG element về id node ----
  // Mermaid v12 vẽ node flowchart thành <g class="node" id="<render-id>-flowchart-<ID>-<n>">
  // (render-id do chúng ta truyền vào mermaid.render, có thể đứng trước), còn subgraph là
  // <g class="cluster" data-id="<ID>">. So với tập id đã biết để không nhận nhầm; sai thì
  // báo "không nhận diện được" thay vì văng lỗi.
  var FLOWCHART_ID_RE = /flowchart-([A-Za-z_][\\w-]*)-\\d+$/;
  function extractNodeId(el) {
    var raw = el.id || '';
    var flowMatch = raw.match(FLOWCHART_ID_RE);
    if (flowMatch && byId[flowMatch[1]]) return flowMatch[1];
    if (byId[raw]) return raw;
    var dataId = el.getAttribute('data-id');
    if (dataId && byId[dataId]) return dataId;
    return null;
  }

  function applyStatus(svg) {
    var unknown = 0;
    var gNodes = svg.querySelectorAll('g.node');
    Array.prototype.forEach.call(gNodes, function (g) {
      var id = extractNodeId(g);
      if (!id) { g.classList.add('aider-unknown'); unknown += 1; return; }
      g.setAttribute('data-aider-id', id);
      var st = byId[id].status;
      g.classList.add(st === 'OK' ? 'aider-ok' : st === 'AMBIGUOUS' ? 'aider-warn' : 'aider-bad');
    });
    if (unknown > 0) {
      var chip = document.getElementById('summary-chip');
      chip.textContent += ' · ' + unknown + ' không nhận diện';
    }
  }

  function hidePanel() { panel.hidden = true; }
  function showPanel(node) {
    var badgeClass = node.status === 'OK' ? 'badge-ok' : node.status === 'AMBIGUOUS' ? 'badge-warn' : 'badge-bad';
    var files = node.files.length
      ? node.files.map(function (f) { return '<li><code>' + esc(f) + '</code></li>'; }).join('')
      : '<li class="none">—</li>';
    panel.innerHTML =
      '<button id="panel-close" title="Đóng (Esc)">✕</button>' +
      '<h2><code>' + esc(node.id) + '</code></h2>' +
      '<p class="lbl">' + esc(node.label) + '</p>' +
      '<p><span class="badge ' + badgeClass + '">' + node.status + '</span></p>' +
      '<dl>' +
      '<dt>File ánh xạ</dt><dd><ul class="files">' + files + '</ul></dd>' +
      (node.path ? '<dt>path khai báo</dt><dd><code>' + esc(node.path) + '</code></dd>' : '') +
      '<dt>Dòng trong README</dt><dd>' + (node.line > 0 ? node.line : '—') + '</dd>' +
      '<dt>Ghi chú</dt><dd>' + esc(node.reason) + '</dd>' +
      '</dl>';
    panel.hidden = false;
    document.getElementById('panel-close').addEventListener('click', hidePanel);
  }
  function showUnknown(rawId) {
    panel.innerHTML =
      '<button id="panel-close" title="Đóng (Esc)">✕</button>' +
      '<h2>?</h2>' +
      '<p class="lbl">Không nhận diện được node này' + (rawId ? ' (id SVG: ' + esc(rawId) + ')' : '') + '.</p>';
    panel.hidden = false;
    document.getElementById('panel-close').addEventListener('click', hidePanel);
  }

  // ---- Kéo để di chuyển ----
  var drag = null;
  viewport.addEventListener('pointerdown', function (e) {
    drag = { x: e.clientX, y: e.clientY, tx: tx, ty: ty, moved: false, target: e.target };
    viewport.setPointerCapture(e.pointerId);
    viewport.classList.add('dragging');
  });
  viewport.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) > 4) drag.moved = true;
    if (drag.moved) { tx = drag.tx + dx; ty = drag.ty + dy; apply(); }
  });
  viewport.addEventListener('pointerup', function () {
    if (!drag) return;
    var moved = drag.moved;
    var target = drag.target;
    drag = null;
    viewport.classList.remove('dragging');
    if (moved) return;
    // Sau setPointerCapture, target của pointerup là viewport nên dùng target lúc pointerdown.
    var nodeEl = target && target.closest ? target.closest('g.node') : null;
    if (nodeEl) {
      var id = nodeEl.getAttribute('data-aider-id');
      if (id && byId[id]) showPanel(byId[id]);
      else showUnknown(nodeEl.id || id);
    } else {
      hidePanel();
    }
  });

  // ---- Cuộn để thu phóng, tâm là vị trí con trỏ ----
  viewport.addEventListener('wheel', function (e) {
    e.preventDefault();
    var rect = viewport.getBoundingClientRect();
    var factor = Math.exp(-e.deltaY * 0.0015);
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor);
  }, { passive: false });

  // ---- Thanh công cụ + bàn phím ----
  document.querySelectorAll('#bar button').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var act = btn.getAttribute('data-act');
      if (act === 'in') { var c = center(); zoomAt(c[0], c[1], 1.2); }
      else if (act === 'out') { var c2 = center(); zoomAt(c2[0], c2[1], 1 / 1.2); }
      else if (act === 'fit') fit();
      else if (act === 'reset') reset();
    });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { hidePanel(); return; }
    var c = center();
    if (e.key === '+' || e.key === '=') zoomAt(c[0], c[1], 1.2);
    else if (e.key === '-' || e.key === '_') zoomAt(c[0], c[1], 1 / 1.2);
    else if (e.key === 'f' || e.key === 'F') fit();
    else if (e.key === '0') reset();
  });

  mermaid.initialize({
    startOnLoad: false,
    // 'loose' giữ nguyên classDef/style của sơ đồ gốc; trang chạy offline từ
    // file HTML do chính CLI sinh ra, không nhận dữ liệu từ nguồn lạ.
    securityLevel: 'loose',
    flowchart: { useMaxWidth: false }
  });

  mermaid.render('aider-svg', data.diagram).then(function (result) {
    canvas.innerHTML = result.svg;
    var svg = canvas.querySelector('svg');
    if (svg) { applyStatus(svg); fit(); }
  }).catch(function (err) {
    canvas.innerHTML = '<div class="render-error">Không vẽ được sơ đồ: ' +
      esc(err && err.message ? err.message : err) + '</div>';
  });
})();
</script>
</body>
</html>
`;
}
