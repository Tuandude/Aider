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
  /* ---- Design tokens: tối giản kiểu Apple — nền xám rất nhạt, bề mặt trắng,
         viền tóc mảnh, bóng khuếch tán mềm, màu hệ thống, không hoa văn ---- */
  :root {
    --bg: #fafafa;
    --surface: #ffffff;
    --ink: #1d1d1f;
    --fg: #1d1d1f;
    --muted: #6e6e73;
    --gray-icon: #86868b;
    --hairline: rgba(0, 0, 0, 0.08);
    --border: #d2d2d7;
    --blue: #0071e3;
    --ok: #34c759;
    --warn: #ff9f0a;
    --bad: #ff3b30;
    --t-fast: 150ms;
    --t-med: 260ms;
    --font-ui: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, 'Helvetica Neue', Arial, sans-serif;
    --font-mono: ui-monospace, 'SF Mono', 'Cascadia Mono', Consolas, monospace;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; height: 100vh; overflow: hidden;
    display: flex; flex-direction: column;
    background: var(--bg);
    color: var(--fg);
    font-family: var(--font-ui); font-size: 13px;
    -webkit-font-smoothing: antialiased;
  }
  code, .mono { font-family: var(--font-mono); }
  button { font-family: var(--font-ui); }
  button:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }

  /* ---- Thanh công cụ: viên thuốc nổi ở giữa đỉnh, trắng mờ có blur,
         viền tóc, bóng khuếch tán; nút icon tròn đơn sắc ---- */
  #bar {
    position: fixed; top: 14px; left: 50%; transform: translateX(-50%);
    z-index: 20;
    display: flex; align-items: center; gap: 10px;
    height: 48px; padding: 0 12px;
    background: rgba(255, 255, 255, 0.78);
    -webkit-backdrop-filter: saturate(180%) blur(20px);
    backdrop-filter: saturate(180%) blur(20px);
    border: 1px solid var(--hairline);
    border-radius: 999px;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);
  }
  .brand { display: flex; align-items: center; gap: 8px; padding-left: 6px; color: var(--ink); }
  .brand-title {
    font-size: 13px; font-weight: 590; letter-spacing: -0.01em;
    color: var(--ink); white-space: nowrap;
  }
  .bar-sep { width: 1px; height: 22px; background: var(--hairline); flex: none; }
  .bar-right { display: flex; align-items: center; gap: 10px; }
  .zoom-group { display: inline-flex; align-items: center; gap: 2px; }
  #bar button {
    display: inline-flex; align-items: center; justify-content: center;
    width: 32px; height: 32px; padding: 0;
    background: transparent; color: var(--gray-icon);
    border: none; border-radius: 50%;
    cursor: pointer; font-size: 12px;
    transition: background-color var(--t-fast) ease, color var(--t-fast) ease;
  }
  #bar button:hover { background: rgba(0, 0, 0, 0.06); color: var(--ink); }
  #bar button:active { background: rgba(0, 0, 0, 0.1); }
  #bar button.btn-text { width: auto; padding: 0 10px; border-radius: 999px; font-weight: 590; }
  #zoom-label {
    min-width: 44px; text-align: center;
    font-size: 13px; font-weight: 590; color: var(--ink);
    font-variant-numeric: tabular-nums;
  }
  #summary-chip {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 5px 11px;
    background: rgba(0, 0, 0, 0.04);
    border-radius: 999px;
    font-size: 12px; color: var(--muted);
    white-space: nowrap;
  }
  .chip-sep { color: rgba(0, 0, 0, 0.25); }
  .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; flex: none; }
  .dot-ok { background: var(--ok); }
  .dot-warn { background: var(--warn); }
  .dot-bad { background: var(--bad); }

  /* ---- Chú giải: thẻ nhỏ trôi ở góc dưới trái, rất lặng ---- */
  .legend {
    position: fixed; left: 16px; bottom: 16px; z-index: 15;
    display: inline-flex; align-items: center; gap: 14px;
    padding: 8px 14px;
    background: rgba(255, 255, 255, 0.78);
    -webkit-backdrop-filter: saturate(180%) blur(20px);
    backdrop-filter: saturate(180%) blur(20px);
    border: 1px solid var(--hairline);
    border-radius: 999px;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
  }
  .legend-item { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); }

  /* ---- Viewport: nền phẳng không hoạ tiết + hint viên thuốc mờ ---- */
  #viewport {
    position: relative; flex: 1; overflow: hidden;
    cursor: grab; user-select: none; touch-action: none;
    background: var(--bg);
  }
  #viewport.dragging { cursor: grabbing; }
  #canvas { position: absolute; top: 0; left: 0; transform-origin: 0 0; will-change: transform; }
  #canvas svg { display: block; }
  /* Sơ đồ dùng chung font hệ thống của trang: luật này chỉ là dự phòng,
     nguồn thắng cuối là sheet nhúng trong SVG được tái trang trí xử lý. */
  #canvas svg { font-family: var(--font-ui); }
  #hint {
    position: absolute; bottom: 18px; left: 50%; transform: translateX(-50%);
    padding: 8px 16px;
    background: rgba(255, 255, 255, 0.85);
    -webkit-backdrop-filter: blur(12px);
    backdrop-filter: blur(12px);
    border: 1px solid var(--hairline); border-radius: 999px;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
    color: var(--muted); font-size: 12px;
    pointer-events: none;
    opacity: 1; transition: opacity 350ms ease;
  }
  #hint.faded { opacity: 0; }
  .render-error {
    margin: 40px auto; max-width: 640px; padding: 16px 20px;
    background: var(--surface);
    border: 1px solid var(--hairline); border-radius: 12px;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);
    color: var(--fg);
  }

  /* ---- Panel chi tiết: thẻ trắng bo tròn nổi bên phải, viền tóc, bóng mềm,
         không còn dải màu dày ở mép ---- */
  #panel {
    position: fixed; top: 14px; right: 14px; bottom: 14px;
    width: 340px; max-width: 85vw;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: 16px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
    padding: 22px 22px 24px; overflow-y: auto;
    transform: translateX(calc(100% + 30px)); visibility: hidden;
    transition: transform var(--t-med) cubic-bezier(0.32, 0.72, 0, 1), visibility 0s linear var(--t-med);
  }
  #panel.open {
    transform: translateX(0); visibility: visible;
    transition: transform var(--t-med) cubic-bezier(0.32, 0.72, 0, 1);
  }
  #panel::-webkit-scrollbar { width: 8px; }
  #panel::-webkit-scrollbar-thumb {
    background: rgba(0, 0, 0, 0.15); border-radius: 4px;
    border: 2px solid transparent; background-clip: padding-box;
  }
  #panel .micro {
    margin: 0; color: var(--muted);
    font-size: 11px; font-weight: 590; text-transform: uppercase; letter-spacing: 0.08em;
  }
  #panel h2 { margin: 8px 34px 4px 0; font-size: 17px; font-weight: 700; letter-spacing: -0.01em; }
  #panel h2 code { background: none; padding: 0; font-size: 16px; color: var(--ink); }
  #panel .lbl { margin: 4px 0 0; color: var(--muted); font-size: 13px; line-height: 1.5; }
  #panel .status-row { margin: 14px 0 0; }
  #panel-close {
    position: absolute; top: 12px; right: 12px; width: 30px; height: 30px;
    display: inline-flex; align-items: center; justify-content: center;
    background: transparent; color: var(--gray-icon);
    border: none; border-radius: 50%;
    cursor: pointer;
    transition: background-color var(--t-fast) ease, color var(--t-fast) ease;
  }
  #panel-close:hover { background: rgba(0, 0, 0, 0.06); color: var(--ink); }
  #panel dl { margin: 18px 0 0; }
  #panel dt {
    margin-top: 16px; color: var(--muted);
    font-size: 11px; font-weight: 590; text-transform: uppercase; letter-spacing: 0.08em;
  }
  #panel dd { margin: 6px 0 0; font-size: 13px; }
  #panel dd code { color: var(--ink); font-weight: 590; }
  #panel ul.files { list-style: none; margin: 0; padding: 0; }
  #panel ul.files li { margin: 6px 0; }
  #panel ul.files li code {
    display: block; padding: 7px 11px;
    background: #f5f5f7; border-radius: 8px;
    font-size: 12px; color: var(--ink);
  }
  #panel ul.files li.none { color: var(--muted); }
  .badge {
    display: inline-flex; align-items: center; gap: 7px;
    padding: 4px 11px;
    background: rgba(0, 0, 0, 0.04); border-radius: 999px;
    font-size: 12px; font-weight: 590; color: var(--ink);
  }
  .badge::before { content: ''; width: 7px; height: 7px; border-radius: 50%; flex: none; }
  .badge-ok::before { background: var(--ok); }
  .badge-warn::before { background: var(--warn); }
  .badge-bad::before { background: var(--bad); }

  /* ---- Sơ đồ: nền tint rất nhạt theo nhóm, viền mềm CÙNG SẮC với nền
     (ghi trực tiếp lên style inline của shape ở bước tái trang trí — luật
     !important bên dưới vẫn thắng style inline thường nên trạng thái và node
     đang chọn hoạt động bình thường), chữ #1d1d1f. Trạng thái OK là trung tính:
     giữ nguyên viền mềm của nhóm, chỉ báo OK nằm ở pill tổng và panel. Chỉ
     AMBIGUOUS/UNMAPPED mới đổi màu viền. Node đang chọn: vòng xanh Apple +
     quầng sáng mềm, thắng mọi trạng thái. ---- */
  #canvas svg g.node { cursor: pointer; transition: filter var(--t-fast) ease; }
  #canvas svg g.node.aider-unknown { cursor: default; }
  #canvas svg g.node rect { rx: 8px; ry: 8px; }
  #canvas svg g.node rect, #canvas svg g.node polygon, #canvas svg g.node path,
  #canvas svg g.node circle, #canvas svg g.node ellipse {
    stroke: var(--border); stroke-width: 1px;
  }
  #canvas svg g.node.aider-warn rect, #canvas svg g.node.aider-warn polygon,
  #canvas svg g.node.aider-warn path, #canvas svg g.node.aider-warn circle,
  #canvas svg g.node.aider-warn ellipse { stroke: var(--warn) !important; stroke-width: 2px !important; }
  #canvas svg g.node.aider-bad rect, #canvas svg g.node.aider-bad polygon,
  #canvas svg g.node.aider-bad path, #canvas svg g.node.aider-bad circle,
  #canvas svg g.node.aider-bad ellipse { stroke: var(--bad) !important; stroke-width: 2px !important; }
  #canvas svg g.node:hover { filter: brightness(0.97); }
  #canvas svg g.node.aider-selected rect, #canvas svg g.node.aider-selected polygon,
  #canvas svg g.node.aider-selected path, #canvas svg g.node.aider-selected circle,
  #canvas svg g.node.aider-selected ellipse { stroke: var(--blue) !important; stroke-width: 2.5px !important; }
  #canvas svg g.node.aider-selected { filter: drop-shadow(0 0 6px rgba(0, 113, 227, 0.4)); }

  /* Cạnh nối + đầu mũi tên: xám nhạt mảnh */
  #canvas svg .edgePath path, #canvas svg .flowchart-link {
    stroke: #c7c7cc !important; stroke-width: 1.5px !important;
  }
  #canvas svg marker path { fill: #c7c7cc !important; }

  @media (prefers-reduced-motion: reduce) {
    * { transition: none !important; animation: none !important; }
  }
</style>
</head>
<body>
<div id="bar">
  <div class="brand">
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.5" y="1.5" width="13" height="13" rx="4" fill="none" stroke="currentColor" stroke-width="1.6"/>
      <path d="M5.2 10.8L10.8 5.2M10.8 10.8L5.2 5.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    </svg>
    <span class="brand-title">Aider — Bản đồ kiến trúc</span>
  </div>
  <span class="bar-sep"></span>
  <div class="zoom-group" role="group" aria-label="Thu phóng">
    <button data-act="in" title="Phóng to (+)" aria-label="Phóng to">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M7 2.5v9M2.5 7h9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
    </button>
    <button data-act="out" title="Thu nhỏ (−)" aria-label="Thu nhỏ">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M2.5 7h9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
    </button>
    <button data-act="fit" title="Vừa khung (F)" aria-label="Vừa khung">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M8.5 2h3.5v3.5M5.5 12H2V8.5M12 8.5V12H8.5M2 5.5V2h3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
    <button data-act="reset" class="btn-text" title="Đặt lại 100% (0)" aria-label="Đặt lại 100%">100%</button>
  </div>
  <span id="zoom-label" role="status">100%</span>
  <span class="bar-sep"></span>
  <span id="summary-chip" role="status">
    <span class="dot dot-ok"></span>${counts.OK} OK
    <span class="chip-sep">·</span>
    <span class="dot dot-warn"></span>${counts.AMBIGUOUS} AMBIGUOUS
    <span class="chip-sep">·</span>
    <span class="dot dot-bad"></span>${counts.UNMAPPED} UNMAPPED
  </span>
</div>
<main id="viewport">
  <div id="canvas"></div>
  <div id="hint">Kéo để di chuyển · Cuộn để thu phóng · Nhấp vào node để xem chi tiết</div>
</main>
<div class="legend" aria-hidden="true">
  <span class="legend-item"><span class="dot dot-ok"></span>OK</span>
  <span class="legend-item"><span class="dot dot-warn"></span>AMBIGUOUS</span>
  <span class="legend-item"><span class="dot dot-bad"></span>UNMAPPED</span>
</div>
<aside id="panel" aria-label="Chi tiết node"></aside>
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
  var hint = document.getElementById('hint');
  var tx = 0, ty = 0, scale = 1;

  // ---- Hint pill: mờ dần sau 5s hoặc ngay khi người dùng chạm chuột lần đầu ----
  var hintGone = false;
  function fadeHint() {
    if (hintGone) return;
    hintGone = true;
    hint.classList.add('faded');
    window.setTimeout(function () { hint.style.display = 'none'; }, 400);
  }
  window.setTimeout(fadeHint, 5000);

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
      // Nối bằng text node thay vì textContent += để giữ lại các chấm màu con bên trong pill.
      chip.appendChild(document.createTextNode(' · ' + unknown + ' không nhận diện'));
    }
  }

  // ---- Tái trang trí SVG theo phong cách tối giản: nền node tint rất nhạt theo nhóm,
  // viền mềm cùng sắc độ (cùng gia đình màu, nhẹ nhàng kiểu Apple), cluster nền
  // gần trắng, chữ đậm màu mực, đầu mũi tên xám. Chỉ ghi đè những màu nhóm đã
  // biết (so khớp dạng rgb() mà trình duyệt chuẩn hoá trong style inline);
  // sơ đồ của dự án lạ giữ nguyên màu classDef của nó. ----
  // fill gốc -> [tint nền, viền mềm cùng hue]. Ba cặp cùng độ sáng/độ bão hoà
  // nên ba nhóm nhìn như một gia đình màu thay vì ba mảng màu rực rỡ cạnh nhau.
  var GROUP_PALETTE = {
    'rgb(220, 252, 231)': ['#ecf6ef', '#cfe0d5'], // xanh lá nhóm core
    'rgb(219, 234, 254)': ['#eef2fb', '#d3dcf0'], // xanh dương nhóm cli
    'rgb(255, 237, 213)': ['#fbf2ea', '#ecdcc9']  // cam nhóm backend
  };
  var TEXT_COLORS = {
    'rgb(20, 83, 45)': '#1d1d1f',
    'rgb(30, 58, 138)': '#1d1d1f',
    'rgb(124, 45, 18)': '#1d1d1f'
  };
  function restyleDiagram(svg) {
    // Mermaid v12 biên dịch classDef của sơ đồ thành luật CSS có !important
    // nhúng ngay trong <style> của SVG (ví dụ ".core>*{...!important}").
    // Author !important ăn style inline thường nên mọi đổi màu bên dưới đều bị
    // luồn qua. Giải pháp: gỡ !important khỏi sheet đó (chỉ trong DOM sau khi
    // render — thân sơ đồ gốc trong dữ liệu vẫn giữ nguyên classDef). Sau đó
    // cascade trở lại bình thường: inline style thắng luật thường, còn luật
    // !important ở stylesheet tài liệu (trạng thái, node đang chọn) vẫn thắng tất.
    Array.prototype.forEach.call(svg.querySelectorAll('style'), function (sheet) {
      if (sheet.textContent && sheet.textContent.indexOf('!important') !== -1) {
        sheet.textContent = sheet.textContent.replace(/!important/g, '');
      }
      // Thống nhất font: sheet nhúng của mermaid khai báo font-family theo
      // selector có id (#aider-svg ...) nên thắng luật tài liệu ở #canvas svg.
      // Thay mọi khai báo font-family trong sheet bằng stack hệ thống của
      // trang (kể cả chuỗi quote "Recursive Variable", trebuchet...). Offline
      // hoàn toàn: chỉ font hệ thống, không nạp font ngoài.
      if (sheet.textContent && sheet.textContent.indexOf('font-family') !== -1) {
        sheet.textContent = sheet.textContent.replace(
          /font-family:[^;}]+/g,
          'font-family:var(--font-ui)'
        );
      }
    });
    // Nền + viền node: đổi fill sang tint nhạt và stroke sang tông mềm cùng hue.
    // Viền viết bằng style inline thường nên luật !important của CSS vẫn thắng
    // khi node mang trạng thái AMBIGUOUS/UNMAPPED hoặc đang được chọn; node OK
    // giữ nguyên viền mềm của nhóm.
    Array.prototype.forEach.call(
      svg.querySelectorAll('g.node rect, g.node polygon, g.node path, g.node circle, g.node ellipse'),
      function (shape) {
        var palette = GROUP_PALETTE[shape.style.fill];
        if (palette) {
          shape.style.fill = palette[0];
          shape.style.stroke = palette[1];
        }
      }
    );
    // Chữ node: classDef color -> màu mực #1d1d1f.
    Array.prototype.forEach.call(svg.querySelectorAll('g.node [style]'), function (el) {
      if (TEXT_COLORS[el.style.color]) el.style.color = '#1d1d1f';
    });
    // Cluster: nền gần trắng, viền tóc #e5e5ea (inline vì CSS không bắt được stroke cluster),
    // tiêu đề nhóm màu xám #6e6e73.
    Array.prototype.forEach.call(svg.querySelectorAll('g.cluster rect'), function (rect) {
      rect.style.fill = '#fbfbfd';
      rect.style.stroke = '#e5e5ea';
      rect.style.strokeWidth = '1px';
    });
    Array.prototype.forEach.call(svg.querySelectorAll('g.cluster [style]'), function (el) {
      if (el.style.color) el.style.color = '#6e6e73';
    });
    // Đầu mũi tên: ép màu xám nhạt khớp với đường nối.
    Array.prototype.forEach.call(svg.querySelectorAll('marker path'), function (p) {
      p.style.fill = '#c7c7cc';
    });
  }

  // ---- Panel chi tiết: mở/đóng bằng class (trượt CSS), chọn node sáng lên theo màu trạng thái ----
  var ICON_CLOSE = '<svg viewBox="0 0 14 14" width="12" height="12" fill="none" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="2.4" stroke-linecap="square"/></svg>';

  function clearSelected() {
    var sel = canvas.querySelector('g.node.aider-selected');
    if (sel) sel.classList.remove('aider-selected');
  }
  function hidePanel() {
    panel.classList.remove('open', 'p-ok', 'p-warn', 'p-bad');
    clearSelected();
  }
  function openPanel() {
    panel.classList.add('open');
    var btn = document.getElementById('panel-close');
    if (btn) btn.addEventListener('click', hidePanel);
  }
  function markSelected(id) {
    clearSelected();
    var sel = '[data-aider-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]';
    var el = canvas.querySelector('g.node' + sel);
    if (el) el.classList.add('aider-selected');
  }
  function showPanel(node) {
    var badgeClass = node.status === 'OK' ? 'badge-ok' : node.status === 'AMBIGUOUS' ? 'badge-warn' : 'badge-bad';
    var files = node.files.length
      ? node.files.map(function (f) { return '<li><code>' + esc(f) + '</code></li>'; }).join('')
      : '<li class="none">—</li>';
    panel.innerHTML =
      '<button id="panel-close" title="Đóng (Esc)" aria-label="Đóng bảng chi tiết">' + ICON_CLOSE + '</button>' +
      '<p class="micro">Node</p>' +
      '<h2><code>' + esc(node.id) + '</code></h2>' +
      '<p class="lbl">' + esc(node.label) + '</p>' +
      '<p class="status-row"><span class="badge ' + badgeClass + '">' + node.status + '</span></p>' +
      '<dl>' +
      '<dt>File ánh xạ</dt><dd><ul class="files">' + files + '</ul></dd>' +
      (node.path ? '<dt>path khai báo</dt><dd><code>' + esc(node.path) + '</code></dd>' : '') +
      '<dt>Dòng trong README</dt><dd>' + (node.line > 0 ? node.line : '—') + '</dd>' +
      '<dt>Ghi chú</dt><dd>' + esc(node.reason) + '</dd>' +
      '</dl>';
    panel.classList.remove('p-ok', 'p-warn', 'p-bad');
    panel.classList.add(badgeClass === 'badge-ok' ? 'p-ok' : badgeClass === 'badge-warn' ? 'p-warn' : 'p-bad');
    markSelected(node.id);
    openPanel();
  }
  function showUnknown(rawId) {
    panel.innerHTML =
      '<button id="panel-close" title="Đóng (Esc)" aria-label="Đóng bảng chi tiết">' + ICON_CLOSE + '</button>' +
      '<p class="micro">Node</p>' +
      '<h2>?</h2>' +
      '<p class="lbl">Không nhận diện được node này' + (rawId ? ' (id SVG: ' + esc(rawId) + ')' : '') + '.</p>';
    clearSelected();
    openPanel();
  }

  // ---- Kéo để di chuyển ----
  var drag = null;
  viewport.addEventListener('pointerdown', function (e) {
    fadeHint();
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
    flowchart: { useMaxWidth: false },
    // Font hệ thống cho mọi chữ trong sơ đồ (nhãn node, tiêu đề cluster...):
    // mermaid dùng biến này khi sinh sheet nhúng trong SVG.
    themeVariables: {
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, 'Helvetica Neue', Arial, sans-serif"
    }
  });

  mermaid.render('aider-svg', data.diagram).then(function (result) {
    canvas.innerHTML = result.svg;
    var svg = canvas.querySelector('svg');
    if (svg) { restyleDiagram(svg); applyStatus(svg); fit(); }
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
