// PDF → crop-each-question-to-an-image flow.
//
// 1. Render each PDF page to a high-DPI canvas with PDF.js.
// 2. User drags a rectangle around each question → produces a crop (PNG blob).
// 3. User names each crop with a question number.
// 4. On Import, each crop is uploaded (POST /api/uploads) and becomes an
//    image-type question (data.image_url).
//
// PDF.js loading handles ESM-first with UMD fallback — see loadPdfJs().

const PDFJS_VERSION = '4.7.76';
const PDFJS_ESM = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.mjs`;
const PDFJS_UMD = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/legacy/build/pdf.min.js`;
const PDFJS_WORKER_ESM = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;
const PDFJS_WORKER_UMD = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/legacy/build/pdf.worker.min.js`;

const RENDER_SCALE = 2; // 2x device-independent pixels → sharp crops

let pdfjsReady = null;

function injectScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

async function loadPdfJs() {
  if (pdfjsReady) return pdfjsReady;
  pdfjsReady = (async () => {
    let lib = null;
    let workerSrc = PDFJS_WORKER_ESM;

    try {
      const mod = await import(/* @vite-ignore */ PDFJS_ESM);
      const candidate = mod && (mod.GlobalWorkerOptions ? mod : (mod.default || null));
      if (candidate && candidate.GlobalWorkerOptions && typeof candidate.getDocument === 'function') {
        lib = candidate;
      }
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
 * openPdfCropper(file, { startingNumber, onImport })
 *   - startingNumber: first question number for new crops.
 *   - onImport(crops): async callback. Each crop = { blob, contentType, width, height, number }.
 * Returns: number of questions created, or 0 if cancelled.
 */
export async function openPdfCropper(file, { startingNumber = 1, onImport } = {}) {
  const overlay = buildOverlay();
  document.body.appendChild(overlay.root);
  document.body.style.overflow = 'hidden';
  const cleanup = () => { overlay.root.remove(); document.body.style.overflow = ''; };

  let created = 0;
  try {
    overlay.setStatus('Loading PDF.js…');
    const pdfjs = await loadPdfJs();

    overlay.setStatus('Opening PDF…');
    const buf = await file.arrayBuffer();
    const doc = await pdfjs.getDocument({ data: buf }).promise;

    // Render all pages up front so the scrollable preview feels instant.
    const pages = [];
    for (let p = 1; p <= doc.numPages; p++) {
      overlay.setStatus(`Rendering page ${p} / ${doc.numPages}…`);
      const page = await doc.getPage(p);
      const viewport = page.getViewport({ scale: RENDER_SCALE });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;
      pages.push({ pageNumber: p, canvas, width: viewport.width, height: viewport.height });
    }

    overlay.setStatus('');
    const crops = []; // { id, blob, contentType, width, height, number, previewUrl, pageNumber }
    overlay.showEditor({ pages, startingNumber, crops });

    // Wait for the user to click Import or Cancel.
    const result = await overlay.waitForResult();
    if (result.action === 'import' && result.crops.length) {
      overlay.setStatus(`Uploading ${result.crops.length} crop${result.crops.length === 1 ? '' : 's'}…`);
      created = await onImport(result.crops);
    }
  } finally {
    cleanup();
  }
  return created;
}

/* ---------- UI ---------- */

function buildOverlay() {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 bg-slate-900/90 z-[100] flex flex-col';
  root.innerHTML = `
    <header class="bg-slate-800 text-white px-6 py-3 flex items-center justify-between border-b border-slate-700">
      <div>
        <div class="font-semibold text-sm flex items-center gap-2">
          <i class="fas fa-crop"></i> PDF → crop questions
        </div>
        <div id="pdfc-status" class="text-xs text-slate-400 mt-0.5">Starting…</div>
      </div>
      <div class="flex items-center gap-2">
        <div class="text-xs text-slate-300 mr-3 hidden md:flex items-center gap-4" id="pdfc-help">
          <span><i class="fas fa-mouse-pointer mr-1"></i>Drag on a page to crop a question</span>
          <span><i class="fas fa-keyboard mr-1"></i>Number auto-increments</span>
        </div>
        <button id="pdfc-cancel" class="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-md text-sm">Cancel</button>
        <button id="pdfc-import" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md text-sm font-semibold">
          <i class="fas fa-check mr-1"></i> Import <span id="pdfc-count">0</span> question(s)
        </button>
      </div>
    </header>
    <div class="flex-1 grid grid-cols-[1fr_320px] min-h-0">
      <main id="pdfc-pages" class="overflow-auto bg-slate-700 p-6 space-y-6"></main>
      <aside id="pdfc-side" class="overflow-auto bg-slate-800 text-white border-l border-slate-700 p-3 space-y-2">
        <div class="text-xs text-slate-400 uppercase tracking-wide font-semibold px-1">Crops</div>
        <div id="pdfc-list" class="space-y-2"></div>
        <div id="pdfc-empty" class="text-xs text-slate-500 italic px-1">
          Click and drag a rectangle on any page to crop one question.
          Each crop becomes an image-type question.
        </div>
      </aside>
    </div>
  `;

  const statusEl = root.querySelector('#pdfc-status');
  const pagesEl  = root.querySelector('#pdfc-pages');
  const listEl   = root.querySelector('#pdfc-list');
  const emptyEl  = root.querySelector('#pdfc-empty');
  const countEl  = root.querySelector('#pdfc-count');
  const importBtn = root.querySelector('#pdfc-import');
  const cancelBtn = root.querySelector('#pdfc-cancel');

  let resolveResult = null;
  const resultPromise = new Promise((res) => { resolveResult = res; });

  // Disable Import until there's at least one crop
  importBtn.disabled = true;
  importBtn.classList.add('opacity-50', 'cursor-not-allowed');

  cancelBtn.addEventListener('click', () => resolveResult({ action: 'cancel', crops: [] }));
  // ESC = cancel
  const esc = (e) => { if (e.key === 'Escape') resolveResult({ action: 'cancel', crops: [] }); };
  document.addEventListener('keydown', esc);

  return {
    root,
    setStatus(s) { statusEl.textContent = s || ''; },
    showEditor({ pages, startingNumber, crops }) {
      let nextNumber = startingNumber;

      // Render each page with a crop overlay
      pages.forEach((p) => {
        const wrap = document.createElement('div');
        wrap.className = 'relative inline-block bg-white shadow-2xl mx-auto';
        wrap.style.display = 'block';
        // scale down to fit the viewport width; preserve aspect
        wrap.innerHTML = `
          <div class="absolute -top-6 left-0 text-xs text-slate-300">Page ${p.pageNumber}</div>
          <div class="relative" data-page-wrap style="width:min(100%, ${p.width}px);">
            <!-- actual canvas stays its natural size; we scale via CSS -->
          </div>
        `;
        const pageWrap = wrap.querySelector('[data-page-wrap]');
        // Inject the canvas; CSS scales its display size while we keep the internal
        // pixel buffer at render resolution — so crops stay sharp.
        p.canvas.style.width = '100%';
        p.canvas.style.height = 'auto';
        p.canvas.style.display = 'block';
        p.canvas.style.cursor = 'crosshair';
        pageWrap.appendChild(p.canvas);

        // The selection rectangle lives in a positioned overlay above the canvas
        const overlay = document.createElement('div');
        overlay.className = 'absolute inset-0';
        overlay.style.pointerEvents = 'none';
        pageWrap.appendChild(overlay);

        attachCropHandler(p.canvas, overlay, (rect) => {
          // rect is in CSS coords relative to the canvas element
          const scaleX = p.canvas.width  / p.canvas.clientWidth;
          const scaleY = p.canvas.height / p.canvas.clientHeight;
          const sx = Math.round(rect.x * scaleX);
          const sy = Math.round(rect.y * scaleY);
          const sw = Math.round(rect.w * scaleX);
          const sh = Math.round(rect.h * scaleY);
          if (sw < 10 || sh < 10) return;

          // Crop from the source canvas to a new canvas
          const cropCanvas = document.createElement('canvas');
          cropCanvas.width = sw;
          cropCanvas.height = sh;
          const ctx = cropCanvas.getContext('2d');
          ctx.drawImage(p.canvas, sx, sy, sw, sh, 0, 0, sw, sh);

          cropCanvas.toBlob((blob) => {
            if (!blob) return;
            const id = crypto.randomUUID();
            const previewUrl = URL.createObjectURL(blob);
            const crop = {
              id,
              blob,
              contentType: 'image/png',
              width: sw,
              height: sh,
              number: nextNumber++,
              previewUrl,
              pageNumber: p.pageNumber,
            };
            crops.push(crop);
            renderList();
          }, 'image/png');
        });

        pagesEl.appendChild(wrap);
      });

      function renderList() {
        if (crops.length === 0) {
          emptyEl.classList.remove('hidden');
          listEl.innerHTML = '';
        } else {
          emptyEl.classList.add('hidden');
          listEl.innerHTML = crops.map((c) => `
            <div class="bg-slate-700 rounded p-2 flex items-center gap-2" data-crop="${c.id}">
              <img src="${c.previewUrl}" class="w-16 h-16 object-contain bg-white rounded" alt="crop"/>
              <div class="flex-1 min-w-0">
                <div class="text-[10px] text-slate-400">Page ${c.pageNumber}</div>
                <label class="flex items-center gap-1 text-xs">
                  <span class="text-slate-400">Q#</span>
                  <input type="number" value="${c.number}" min="1" data-cn="${c.id}"
                    class="w-16 bg-slate-900 border border-slate-600 rounded px-1 py-0.5 text-white text-xs"/>
                </label>
              </div>
              <button data-del="${c.id}" class="text-slate-400 hover:text-red-400 px-1" title="Remove">
                <i class="fas fa-times"></i>
              </button>
            </div>
          `).join('');

          listEl.querySelectorAll('[data-del]').forEach((b) =>
            b.addEventListener('click', () => {
              const id = b.dataset.del;
              const idx = crops.findIndex((x) => x.id === id);
              if (idx >= 0) {
                URL.revokeObjectURL(crops[idx].previewUrl);
                crops.splice(idx, 1);
                renderList();
              }
            })
          );
          listEl.querySelectorAll('[data-cn]').forEach((inp) =>
            inp.addEventListener('input', () => {
              const id = inp.dataset.cn;
              const c = crops.find((x) => x.id === id);
              if (c) c.number = Number(inp.value) || 1;
            })
          );
        }

        countEl.textContent = crops.length;
        importBtn.disabled = crops.length === 0;
        importBtn.classList.toggle('opacity-50', crops.length === 0);
        importBtn.classList.toggle('cursor-not-allowed', crops.length === 0);
      }

      importBtn.addEventListener('click', () => {
        // Clean the crops before returning: strip the preview URL and id.
        const out = crops.map((c) => ({
          blob: c.blob,
          contentType: c.contentType,
          width: c.width,
          height: c.height,
          number: c.number,
        }));
        resolveResult({ action: 'import', crops: out });
      });

      renderList();
    },
    waitForResult() {
      return resultPromise.finally(() => document.removeEventListener('keydown', esc));
    },
  };
}

/** Attach mousedown/move/up handlers to let the user drag a crop rectangle. */
function attachCropHandler(canvas, overlay, onCommit) {
  let startX = 0, startY = 0;
  let box = null;

  function pointInCanvas(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const p = pointInCanvas(e);
    startX = p.x; startY = p.y;
    box = document.createElement('div');
    box.className = 'absolute border-2 border-blue-500 bg-blue-500/20';
    box.style.pointerEvents = 'none';
    box.style.left = `${startX}px`;
    box.style.top = `${startY}px`;
    box.style.width = '0px';
    box.style.height = '0px';
    overlay.appendChild(box);

    const move = (ev) => {
      const q = pointInCanvas(ev);
      const x = Math.min(q.x, startX);
      const y = Math.min(q.y, startY);
      const w = Math.abs(q.x - startX);
      const h = Math.abs(q.y - startY);
      box.style.left = `${x}px`;
      box.style.top = `${y}px`;
      box.style.width = `${w}px`;
      box.style.height = `${h}px`;
    };
    const up = (ev) => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      const q = pointInCanvas(ev);
      const x = Math.min(q.x, startX);
      const y = Math.min(q.y, startY);
      const w = Math.abs(q.x - startX);
      const h = Math.abs(q.y - startY);
      // Remove the visual box; the committed crop will be shown in the sidebar.
      box.remove();
      box = null;
      if (w >= 10 && h >= 10) onCommit({ x, y, w, h });
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
}
