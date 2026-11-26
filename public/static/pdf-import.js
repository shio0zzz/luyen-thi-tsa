// PDF → auto-detected image questions.
//
// Improvements in this version:
//  - Clips headers and footers from every crop (configurable margins).
//  - Respects SECTION markers ("PHẦN 1/2/3", "Tư duy Toán/Đọc hiểu/Khoa học"):
//    a question's crop never spills into the next section.
//  - Detects shared passages (Vietnamese TSA: "Ngữ liệu N. Câu A-B") and
//    attaches the passage ABOVE the first question's image. Follow-up
//    questions in the group are kept normal (no passage repeated).
//
// All detection runs on the extracted text layer. For scanned image-only PDFs
// the fallback is one question per page.

const PDFJS_VERSION = '4.7.76';
const PDFJS_ESM = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.mjs`;
const PDFJS_UMD = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/legacy/build/pdf.min.js`;
const PDFJS_WORKER_ESM = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;
const PDFJS_WORKER_UMD = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/legacy/build/pdf.worker.min.js`;

const RENDER_SCALE = 2;

// Fraction of page height to strip off the top (header) and bottom (footer).
// Tuned for TSA PDFs. User can override via UI later if needed.
const HEADER_FRAC = 0.055;   // ~5.5% of page height
const FOOTER_FRAC = 0.045;   // ~4.5% of page height

const Y_PADDING_TOP = 10;
const Y_PADDING_BOTTOM = 8;
const MIN_CROP_HEIGHT = 40;

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
    } catch (e) { console.warn('[pdf-import] ESM load failed, falling back to UMD:', e); }
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
 */
export async function autoImportPdf(file, { startingNumber = 1, onImport, onProgress = () => {} } = {}) {
  onProgress('Loading PDF.js…');
  const pdfjs = await loadPdfJs();

  onProgress('Opening PDF…');
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;

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
    const items = text.items.map((it) => {
      const baselineY = it.transform[5];
      const canvasY = viewport.height - baselineY * RENDER_SCALE;
      // Glyph "height" — item.height is in PDF units, multiply by RENDER_SCALE.
      // Fall back to item.transform[0] (font scale) if height is missing.
      const h = (it.height || Math.abs(it.transform[0]) || 10) * RENDER_SCALE;
      return { str: it.str, y: canvasY, x: it.transform[4] * RENDER_SCALE, h };
    });
    pages.push({
      pageIndex: p - 1,
      pageNumber: p,
      canvas,
      width: viewport.width,
      height: viewport.height,
      items,
      // Clip zone for this page
      headerY: viewport.height * HEADER_FRAC,
      footerY: viewport.height * (1 - FOOTER_FRAC),
    });
  }

  onProgress('Detecting questions and sections…');
  const { markers, sections, passages } = detectStructure(pages);

  // Any detected section or passage header acts as a hard upper bound for the
  // previous question's crop — we treat them as "boundary" entries in a
  // combined, sorted list, then slice between them.
  const boundaries = [...sections, ...passages].sort(byOrder);
  // Build slices: each Câu N marker → question
  const slices = [];
  for (let i = 0; i < markers.length; i++) {
    const m = markers[i];
    const next = markers[i + 1];

    // Natural end: the next question's y (or end of doc)
    let endPage = next ? next.pageIndex : pages.length - 1;
    let endY    = next ? next.y        : pages[pages.length - 1].height;

    // But cut short at the first boundary strictly between m and (endPage,endY)
    for (const b of boundaries) {
      if (isAfter(b, m) && isBefore(b, { pageIndex: endPage, y: endY })) {
        endPage = b.pageIndex;
        endY    = b.y;
        break; // boundaries are sorted; take the first one
      }
    }

    // Find a passage that belongs to THIS question (one that ends at this marker).
    // Convention: the passage header appears before Câu A, and we attach the
    // span (passageStart → markerStart) above the first question's crop only.
    let passagePrefix = null;
    for (const psg of passages) {
      // Match if this marker's number equals the passage's starting question
      if (psg.firstQuestion === m.number) {
        passagePrefix = {
          startPage: psg.pageIndex,
          startY: Math.max(0, psg.y - Y_PADDING_TOP),
          endPage: m.pageIndex,
          endY: Math.max(0, m.y - 2), // stop just above the "Câu N." line
        };
        break;
      }
    }

    // Top of crop = baseline - glyph height - padding (so full glyphs aren't clipped).
    const topY = Math.max(0, m.y - (m.h || 14) - Y_PADDING_TOP);
    slices.push({
      number: m.number,
      sectionTitle: findEnclosingSection(sections, m) || '',
      startPage: m.pageIndex,
      startY: topY,
      endPage,
      endY: Math.max(0, endY - Y_PADDING_BOTTOM),
      passagePrefix,
    });
  }

  if (slices.length === 0) {
    // Fallback: one crop per page (minus header/footer), using the starting number
    for (let p = 0; p < pages.length; p++) {
      slices.push({
        number: startingNumber + p,
        sectionTitle: '',
        startPage: p, startY: 0,
        endPage: p,   endY: pages[p].height,
        passagePrefix: null,
      });
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
      sectionTitle: s.sectionTitle,
      startPage: s.startPage + 1,
      endPage: s.endPage + 1,
      hasPassage: !!s.passagePrefix,
      blob,
      contentType: 'image/png',
      width: dims.width,
      height: dims.height,
      previewUrl: URL.createObjectURL(blob),
    });
  }

  if (crops.length === 0) throw new Error('Could not build any crops from this PDF.');

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

/* ---------- structure detection ---------- */

function byOrder(a, b) { return a.pageIndex - b.pageIndex || a.y - b.y; }
function isAfter(x, ref)  { return x.pageIndex > ref.pageIndex || (x.pageIndex === ref.pageIndex && x.y > ref.y); }
function isBefore(x, ref) { return x.pageIndex < ref.pageIndex || (x.pageIndex === ref.pageIndex && x.y < ref.y); }

function textLines(items) {
  if (!items.length) return [];
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
    y: l.y,  // baseline y of the line
    h: Math.max(...l.items.map((x) => x.h || 10)), // tallest glyph on the line
  })).filter((l) => l.text);
}

// --- GLOBAL regex versions for page-wide scanning ---
// These use /g so we can iterate every match on a page's concatenated text.
const PASSAGE_REGEX_G = /Ng[ữu]\s*li[ệe]u\s*\d+\s*[.\-:–]?\s*C[âa]u\s*(\d{1,3})\s*[–\-]\s*(\d{1,3})/gi;
const INFO_REGEX_G    = /Th[ôo]ng\s*tin\s*(?:cho|d[ùu]ng\s*cho)?.*?C[âa]u\s*(\d{1,3})\s*[–\-]\s*(\d{1,3})/gi;
// Only match question markers that start at a line boundary (start-of-page OR
// right after a newline). Prevents false positives like "... Hình 1. Mô tả ..."
// or "A. Nguồn nitrogen ..." being mis-read as "Câu 1." or a bare numeric.
// Also drops the bare-numeric form ("1. Something") — too risky for multi-column
// scientific text; we rely on the Vietnamese/English keyword prefix.
const QUESTION_RE_G   = /(?:^|\n)\s*(C[âa]u|Question|Q|B[àa]i)\s*(\d{1,3})\s*[.:)]/gi;
const SECTION_RE_G    = /(PH[ÂẦ]N\s*[123IVX]+|T[ưu]\s*duy\s*(?:To[áa]n\s*h[ọo]c|Đ[ọo]c\s*hi[ểe]u|Khoa\s*h[ọo]c))/gi;

function detectStructure(pages) {
  const markers = [];   // { number, pageIndex, y, h }
  const sections = [];  // { title, pageIndex, y, h }
  const passages = [];  // { pageIndex, y, h, firstQuestion, lastQuestion }
  const seenNumbers = new Set();

  for (const page of pages) {
    // Build ONE concatenated string for the page, remembering each item's
    // start position in the string → map match indices back to items (and y).
    // Items are read in top-to-bottom, left-to-right order.
    const items = page.items
      .slice()
      .filter((it) => it.y >= page.headerY && it.y <= page.footerY)
      .sort((a, b) => a.y - b.y || a.x - b.x);

    // Build string with a newline between items on DIFFERENT lines, single
    // space between items on the same line. Record each item's
    // [startIndex, endIndex) in the string so we can look up its y later.
    // The newline separator lets us anchor regexes with ^/\n reliably.
    let pageText = '';
    const itemSpans = []; // { start, end, item }
    let prevY = null;
    for (const it of items) {
      if (prevY !== null) {
        pageText += (Math.abs(it.y - prevY) < 4) ? ' ' : '\n';
      }
      const start = pageText.length;
      pageText += it.str;
      const end = pageText.length;
      itemSpans.push({ start, end, item: it });
      prevY = it.y;
    }

    const itemAtIndex = (idx) => {
      // Binary search for the item whose span contains idx
      let lo = 0, hi = itemSpans.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (idx < itemSpans[mid].start) hi = mid - 1;
        else if (idx >= itemSpans[mid].end) lo = mid + 1;
        else return itemSpans[mid].item;
      }
      // If the match landed in a space between items, fall back to the nearest preceding item
      return itemSpans[Math.max(0, hi)]?.item || null;
    };

    // 1) Passages — check these first so they take precedence over bare "Câu 41" matches.
    const passageRanges = [];
    for (const re of [PASSAGE_REGEX_G, INFO_REGEX_G]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(pageText))) {
        const it = itemAtIndex(m.index);
        if (!it) continue;
        passages.push({
          pageIndex: page.pageIndex, y: it.y, h: it.h || 14,
          firstQuestion: Number(m[1]), lastQuestion: Number(m[2]),
        });
        passageRanges.push([m.index, m.index + m[0].length]);
      }
    }
    const inPassage = (idx) => passageRanges.some(([s, e]) => idx >= s && idx < e);

    // 2) Sections (PHẦN N, TƯ DUY ...)
    SECTION_RE_G.lastIndex = 0;
    let sm;
    while ((sm = SECTION_RE_G.exec(pageText))) {
      const it = itemAtIndex(sm.index);
      if (!it) continue;
      sections.push({
        title: sm[0].slice(0, 80), pageIndex: page.pageIndex, y: it.y, h: it.h || 14,
      });
    }

    // 3) Question markers
    QUESTION_RE_G.lastIndex = 0;
    let qm;
    while ((qm = QUESTION_RE_G.exec(pageText))) {
      // Skip if this match was already consumed by a passage match (e.g. "Câu 41-50")
      if (inPassage(qm.index)) continue;
      const n = Number(qm[2]);
      if (n < 1 || n > 999) continue;
      if (seenNumbers.has(n)) continue;
      const it = itemAtIndex(qm.index);
      if (!it) continue;
      seenNumbers.add(n);
      markers.push({ number: n, pageIndex: page.pageIndex, y: it.y, h: it.h || 14 });
    }
  }

  markers.sort(byOrder);
  sections.sort(byOrder);
  passages.sort(byOrder);
  return { markers, sections, passages };
}

function findEnclosingSection(sections, marker) {
  let cur = null;
  for (const s of sections) {
    if (isBefore(s, marker) || (s.pageIndex === marker.pageIndex && s.y === marker.y)) cur = s;
    else break;
  }
  return cur ? cur.title : '';
}

/* ---------- crop + stitch ---------- */

async function buildStitchedCrop(pages, slice) {
  const parts = [];

  // Prepend the shared passage (if any) ABOVE the question
  if (slice.passagePrefix) {
    const pp = slice.passagePrefix;
    collectParts(parts, pages, pp.startPage, pp.startY, pp.endPage, pp.endY);
  }

  collectParts(parts, pages, slice.startPage, slice.startY, slice.endPage, slice.endY);

  if (parts.length === 0) return null;
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

/** Push rectangles into `parts`, clipping each to the page's header/footer zone. */
function collectParts(parts, pages, startPage, startY, endPage, endY) {
  if (startPage === endPage) {
    pushClippedPart(parts, pages[startPage], startY, endY);
  } else {
    pushClippedPart(parts, pages[startPage], startY, pages[startPage].height);
    for (let p = startPage + 1; p < endPage; p++) {
      pushClippedPart(parts, pages[p], 0, pages[p].height);
    }
    pushClippedPart(parts, pages[endPage], 0, endY);
  }
}

function pushClippedPart(parts, page, y1, y2) {
  const top = Math.max(page.headerY, 0, Math.min(page.height, y1));
  const bot = Math.min(page.footerY, page.height, Math.max(0, y2));
  if (bot - top < 2) return;
  parts.push({ canvas: page.canvas, sx: 0, sy: top, sw: page.width, sh: bot - top });
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
          <div class="text-xs text-slate-400 mt-0.5">
            Uncheck anything you don't want. Renumber if detection missed one.
            Header/footer are clipped; shared passages are glued above the first question of each group.
          </div>
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
              <div class="flex flex-col items-center gap-2 pt-1 min-w-[90px]">
                <div class="flex items-center gap-1">
                  <span class="text-xs text-slate-500">Q#</span>
                  <input type="number" data-num="${i}" value="${c.number}" min="1" class="w-16 border border-slate-300 rounded px-2 py-1 text-sm"/>
                </div>
                ${c.hasPassage ? `<span class="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded-full">+passage</span>` : ''}
                ${c.sectionTitle ? `<span class="text-[9px] text-slate-400 text-center leading-tight">${escapeHtml(c.sectionTitle)}</span>` : ''}
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

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
