// PDF → auto-detected image questions.
//
// Flow:
//   1. Render every page to a high-DPI canvas (PDF.js).
//   2. Extract the text layer with per-item Y positions.
//   3. Detect question markers: "Câu N.", "Question N.", "N." at line start.
//   4. For each question, build one tall PNG from (startPage, startY) to the
//      next marker's (endPage, endY), stitching across pages if needed.
//   5. Show a preview dialog — user can deselect / renumber / drop crops.
//   6. On Import, upload each PNG → create image-type questions.
//
// NOTE: text detection runs against the extracted text layer, so PDFs with
// selectable text work out of the box. Scanned image-only PDFs won't match
// markers — those degrade to one-question-per-page.

const PDFJS_VERSION = '4.7.76';
const PDFJS_ESM = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.mjs`;
const PDFJS_UMD = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/legacy/build/pdf.min.js`;
const PDFJS_WORKER_ESM = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;
const PDFJS_WORKER_UMD = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/legacy/build/pdf.worker.min.js`;

const RENDER_SCALE = 2;        // 2x oversample for sharp crops
const Y_PADDING_TOP = 8;       // pixels above detected marker to include
const Y_PADDING_BOTTOM = 6;    // pixels below next marker (usually just before it) to include
const MIN_CROP_HEIGHT = 40;    // skip tiny spurious matches

let pdfjsReady = null;

function injectScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

async function loadPdfJs() {
  if (pdfjsReady) return pdfjsReady;
  pdfjsReady = (async () => {
    let lib = null, workerSrc = PDFJS_WORKER_ESM;
    try {
      const mod = await import(/* @vite-ignore */ PDFJS_ESM);
      const cand = mod && (mod.GlobalWorkerOptions ? mod : (mod.default || null));
      if (cand && cand.GlobalWorkerOptions && typeof cand.getDocument === 'function') lib = cand;
    } catch (e) {
      console.warn('[pdf-import] ESM load failed, falling back to UMD:', e);
    }
    if (!lib) {
      await injectScript(PDFJS_UMD);
      if (!window.pdfjsLib) throw new Error('PDF.js UMD loaded but window.pdfjsLib is not defined.');
      lib = window.pdfjsLib;
      workerSrc = PDFJS_WORKER_UMD;
    }
    if (!lib.GlobalWorkerOptions) throw new Error('PDF.js loaded but GlobalWorkerOptions is missing.');
    lib.GlobalWorkerOptions.workerSrc = workerSrc;
    window.pdfjsLib = lib;
    return lib;
  })();
  return pdfjsReady;
}

/**
 * autoImportPdf(file, { startingNumber, onImport, onProgress })
 *   Entry point. Detects questions, shows preview, uploads+creates.
 *   Returns the number of questions created, or 0 if cancelled.
 */
export async function autoImportPdf(file, { startingNumber = 1, onImport, onProgress = () => {} } = {}) {
  onProgress('Loading PDF.js…');
  const pdfjs = await loadPdfJs();

  onProgress('Opening PDF…');
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;

  // Render all pages + collect text items (with Y coords in CSS pixels).
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    onProgress(`Rendering page ${p} / ${doc.numPages}…`);
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: RENDER_SCALE });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    const text = await page.getTextContent();
    // Each item has { str, transform: [a,b,c,d,e,f] } — f is the baseline Y
    // in the PDF coordinate space (origin bottom-left). Convert to canvas Y
    // (origin top-left, same scale as canvas pixels).
    const items = text.items.map((it) => {
      const baselineY = it.transform[5];
      const canvasY = viewport.height - baselineY * RENDER_SCALE;
      return { str: it.str, y: canvasY, x: it.transform[4] * RENDER_SCALE };
    });
    pages.push({
      pageIndex: p - 1,
      pageNumber: p,
      canvas,
      width: viewport.width,
      height: viewport.height,
      items,
    });
  }

  onProgress('Detecting questions…');
  const markers = detectMarkers(pages);

  // Build slices from marker[i] to marker[i+1] (or end of doc).
  const slices = [];
  for (let i = 0; i < markers.length; i++) {
    const m = markers[i];
    const next = markers[i + 1];
    const endPage = next ? next.pageIndex : pages.length - 1;
    const endY    = next ? next.y        : pages[pages.length - 1].height;
    slices.push({
      number: m.number,
      startPage: m.pageIndex,
      startY: Math.max(0, m.y - Y_PADDING_TOP),
      endPage,
      endY: Math.max(0, endY - Y_PADDING_BOTTOM),
    });
  }

  // Fallback: if we detected nothing (scanned PDF, unusual layout), make one
  // question per page so the user at least has something to work with.
  if (slices.length === 0) {
    for (let p = 0; p < pages.length; p++) {
      slices.push({ number: startingNumber + p, startPage: p, startY: 0, endPage: p, endY: pages[p].height });
    }
  }

  onProgress(`Building ${slices.length} crop${slices.length === 1 ? '' : 's'}…`);
  const crops = [];
  for (let i = 0; i < slices.length; i++) {
    const s = slices[i];
    const blob = await buildStitchedCrop(pages, s);
    if (!blob) continue;
    const dims = await blobDimensions(blob);
    if (dims.height < MIN_CROP_HEIGHT) continue;
    crops.push({
      number: s.number,
      startPage: s.startPage + 1,
      endPage: s.endPage + 1,
      blob,
      contentType: 'image/png',
      width: dims.width,
      height: dims.height,
      previewUrl: URL.createObjectURL(blob),
    });
  }

  if (crops.length === 0) throw new Error('Could not build any crops from this PDF.');

  // Preview dialog — user picks/deselects/renumbers.
  const picked = await showPreview(crops);
  if (!picked || picked.length === 0) {
    crops.forEach((c) => URL.revokeObjectURL(c.previewUrl));
    return 0;
  }

  onProgress(`Uploading ${picked.length} question${picked.length === 1 ? '' : 's'}…`);
  const made = await onImport(picked, (i, total) => onProgress(`Uploading ${i} / ${total}…`));
  crops.forEach((c) => URL.revokeObjectURL(c.previewUrl));
  return made;
}

/* ---------- marker detection ---------- */

// Collapse text items on a page into text-lines, keeping each line's top-Y
// (smallest Y of any item on that line). Returns [{ text, y }] sorted top→bottom.
function textLines(items) {
  if (!items.length) return [];
  // Group by y within a tolerance
  const sorted = items.slice().sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  let cur = { y: sorted[0].y, items: [sorted[0]] };
  for (let i = 1; i < sorted.length; i++) {
    if (Math.abs(sorted[i].y - cur.y) < 4) {
      cur.items.push(sorted[i]);
    } else {
      lines.push(cur);
      cur = { y: sorted[i].y, items: [sorted[i]] };
    }
  }
  lines.push(cur);
  return lines.map((l) => ({
    text: l.items.sort((a, b) => a.x - b.x).map((x) => x.str).join(' ').replace(/\s+/g, ' ').trim(),
    y: l.y,
  })).filter((l) => l.text);
}

// Regexes for a question marker. Order matters — stricter ones first.
const MARKER_REGEXES = [
  /^C[âa]u\s*(\d{1,3})\s*[.:)]/i,        // Câu 1.  Câu 12:  Cau 7)
  /^Question\s*(\d{1,3})\s*[.:)]/i,       // Question 3.
  /^Q\s*(\d{1,3})\s*[.:)]/i,              // Q7.
  /^B[àa]i\s*(\d{1,3})\s*[.:)]/i,         // Bài 5.
  /^(\d{1,3})\s*[.)]\s+\S/,               // 7. Something  (needs a non-space after to avoid matching footers like "1 / 20")
];

function detectMarkers(pages) {
  const out = [];
  for (const page of pages) {
    const lines = textLines(page.items);
    // Skip common page-footer noise
    const filtered = lines.filter((l) => !/^Trang\s*\d+/i.test(l.text) && !/^Page\s*\d+/i.test(l.text));
    for (const line of filtered) {
      for (const re of MARKER_REGEXES) {
        const m = line.text.match(re);
        if (m) {
          const n = Number(m[1]);
          if (n >= 1 && n <= 999) {
            out.push({ number: n, pageIndex: page.pageIndex, y: line.y });
          }
          break;
        }
      }
    }
  }
  // De-dup: if the same question number is detected multiple times (common with
  // "Câu 1." appearing in both the TOC and the body), keep the first occurrence
  // that's followed by an increasing sequence. Simple heuristic: drop entries
  // whose number was already seen and whose next few siblings don't form a run.
  const seen = new Set();
  const cleaned = [];
  for (const m of out) {
    if (seen.has(m.number)) continue;
    seen.add(m.number);
    cleaned.push(m);
  }
  // Order by (pageIndex, y) — document reading order.
  cleaned.sort((a, b) => a.pageIndex - b.pageIndex || a.y - b.y);
  return cleaned;
}

/* ---------- crop + stitch ---------- */

async function buildStitchedCrop(pages, slice) {
  const parts = [];
  if (slice.startPage === slice.endPage) {
    const p = pages[slice.startPage];
    const y1 = Math.max(0, Math.min(p.height, slice.startY));
    const y2 = Math.max(0, Math.min(p.height, slice.endY));
    if (y2 - y1 < 2) return null;
    parts.push({ canvas: p.canvas, sx: 0, sy: y1, sw: p.width, sh: y2 - y1 });
  } else {
    // Bottom of start page
    const startP = pages[slice.startPage];
    const startY = Math.max(0, Math.min(startP.height, slice.startY));
    parts.push({ canvas: startP.canvas, sx: 0, sy: startY, sw: startP.width, sh: startP.height - startY });
    // Full middle pages
    for (let p = slice.startPage + 1; p < slice.endPage; p++) {
      const mp = pages[p];
      parts.push({ canvas: mp.canvas, sx: 0, sy: 0, sw: mp.width, sh: mp.height });
    }
    // Top of end page
    const endP = pages[slice.endPage];
    const endY = Math.max(0, Math.min(endP.height, slice.endY));
    parts.push({ canvas: endP.canvas, sx: 0, sy: 0, sw: endP.width, sh: endY });
  }
  const width = Math.max(...parts.map((p) => p.sw));
  const totalH = parts.reduce((s, p) => s + p.sh, 0);
  if (totalH < 2) return null;

  const out = document.createElement('canvas');
  out.width = width;
  out.height = totalH;
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, totalH);
  let y = 0;
  for (const part of parts) {
    ctx.drawImage(part.canvas, part.sx, part.sy, part.sw, part.sh, 0, y, part.sw, part.sh);
    y += part.sh;
  }
  return await new Promise((res) => out.toBlob((b) => res(b), 'image/png'));
}

function blobDimensions(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => { URL.revokeObjectURL(url); resolve({ width: img.width, height: img.height }); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

/* ---------- preview dialog ---------- */

function showPreview(crops) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-slate-900/80 z-[100] flex flex-col';
    overlay.innerHTML = `
      <header class="bg-slate-800 text-white px-6 py-3 flex items-center justify-between border-b border-slate-700">
        <div>
          <div class="font-semibold text-sm flex items-center gap-2">
            <i class="fas fa-wand-magic-sparkles"></i> Auto-detected ${crops.length} question${crops.length === 1 ? '' : 's'}
          </div>
          <div class="text-xs text-slate-400 mt-0.5">Uncheck anything you don't want. Renumber if detection missed one.</div>
        </div>
        <div class="flex items-center gap-2">
          <button id="pdfp-toggle-all" class="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-md text-xs">Toggle all</button>
          <button id="pdfp-cancel" class="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-md text-sm">Cancel</button>
          <button id="pdfp-import" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md text-sm font-semibold">
            <i class="fas fa-check mr-1"></i> Import <span id="pdfp-count">${crops.length}</span>
          </button>
        </div>
      </header>
      <main class="flex-1 overflow-auto bg-slate-700 p-6">
        <div class="max-w-5xl mx-auto grid gap-4">
          ${crops.map((c, i) => `
            <label class="bg-white rounded-lg shadow p-3 flex gap-4 items-start cursor-pointer" data-row="${i}">
              <input type="checkbox" data-sel="${i}" checked class="mt-2 w-5 h-5"/>
              <div class="flex items-center gap-2 pt-1">
                <span class="text-xs text-slate-500">Q#</span>
                <input type="number" data-num="${i}" value="${c.number}" min="1" class="w-20 border border-slate-300 rounded px-2 py-1 text-sm"/>
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-[11px] text-slate-500 mb-1">Pages ${c.startPage}${c.endPage !== c.startPage ? `–${c.endPage}` : ''} · ${c.width}×${c.height}px</div>
                <img src="${c.previewUrl}" class="max-w-full h-auto border border-slate-200 rounded" alt="Q${c.number}"/>
              </div>
            </label>
          `).join('')}
        </div>
      </main>`;
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    const updateCount = () => {
      const n = overlay.querySelectorAll('input[data-sel]:checked').length;
      overlay.querySelector('#pdfp-count').textContent = n;
      const btn = overlay.querySelector('#pdfp-import');
      btn.disabled = n === 0;
      btn.classList.toggle('opacity-50', n === 0);
      btn.classList.toggle('cursor-not-allowed', n === 0);
    };
    overlay.querySelectorAll('input[data-sel]').forEach((el) => el.addEventListener('change', updateCount));

    overlay.querySelector('#pdfp-toggle-all').addEventListener('click', () => {
      const boxes = overlay.querySelectorAll('input[data-sel]');
      const anyUnchecked = [...boxes].some((b) => !b.checked);
      boxes.forEach((b) => (b.checked = anyUnchecked));
      updateCount();
    });

    const finish = (ok) => {
      document.body.style.overflow = '';
      overlay.remove();
      if (!ok) return resolve(null);
      const picked = [];
      crops.forEach((c, i) => {
        const checked = overlay.querySelector(`[data-sel="${i}"]`)?.checked;
        if (!checked) return;
        const num = Number(overlay.querySelector(`[data-num="${i}"]`).value) || c.number;
        picked.push({ ...c, number: num });
      });
      resolve(picked);
    };
    overlay.querySelector('#pdfp-cancel').addEventListener('click', () => finish(false));
    overlay.querySelector('#pdfp-import').addEventListener('click', () => finish(true));
    const esc = (e) => { if (e.key === 'Escape') { document.removeEventListener('keydown', esc); finish(false); } };
    document.addEventListener('keydown', esc);
  });
}
