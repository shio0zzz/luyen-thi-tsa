// Client-side PDF → questions parser using PDF.js
// Heuristic parser tuned for Vietnamese TSA-style exams but works broadly.

const PDFJS_SRC = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/pdf.worker.min.mjs';

async function loadPdfJs() {
  if (window.pdfjsLib) return window.pdfjsLib;
  const mod = await import(PDFJS_SRC);
  mod.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  window.pdfjsLib = mod;
  return mod;
}

export async function parsePdfToQuestions(file, progress = () => {}) {
  const pdfjs = await loadPdfJs();
  progress('Loading PDF document…');
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const pageTexts = [];
  for (let p = 1; p <= doc.numPages; p++) {
    progress(`Extracting page ${p} / ${doc.numPages}…`);
    const page = await doc.getPage(p);
    const txt = await page.getTextContent();
    const items = txt.items.map((i) => ({ str: i.str, y: i.transform[5], x: i.transform[4] }));
    // Sort by vertical then horizontal to get a flowing read order
    items.sort((a, b) => (b.y - a.y) || (a.x - b.x));
    let line = [], lines = [], lastY = null;
    for (const it of items) {
      if (lastY === null || Math.abs(it.y - lastY) < 2) {
        line.push(it.str);
      } else {
        lines.push(line.join(' '));
        line = [it.str];
      }
      lastY = it.y;
    }
    if (line.length) lines.push(line.join(' '));
    pageTexts.push(lines.join('\n'));
  }
  const fullText = pageTexts.join('\n');
  progress('Parsing questions…');
  return parseQuestions(fullText);
}

// --- Heuristic question splitter ---
// Supports Vietnamese "Câu 1.", "Câu 2.", "Question 1.", "1.", "Q1." markers
// Detects MCQ options "A.", "B.", "C.", "D." on their own lines
function parseQuestions(text) {
  // Normalize whitespace and remove page-footer noise ("Trang 1", "Đề số ...")
  const cleanLines = text.split(/\n+/).map((l) => l.trim()).filter((l) => {
    if (!l) return false;
    if (/^Trang\s*\d+/i.test(l)) return false;
    if (/^Page\s*\d+/i.test(l)) return false;
    return true;
  });
  const clean = cleanLines.join('\n');

  // Split on question markers, keeping the marker
  const markerRe = /(^|\n)\s*(?:C[âa]u|Question|Q|Bài)\s*(\d+)\s*[.:)]/gi;
  const matches = [...clean.matchAll(markerRe)];
  if (matches.length === 0) {
    // Fallback: split on "1.", "2." at line start
    return parseByNumeric(clean);
  }
  const chunks = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : clean.length;
    const number = Number(matches[i][2]);
    const body = clean.slice(start, end).trim();
    chunks.push({ number, raw: body });
  }
  return chunks.map((c) => toQuestion(c)).filter(Boolean);
}

function parseByNumeric(text) {
  const lines = text.split('\n');
  const chunks = [];
  let cur = null;
  for (const line of lines) {
    const m = line.match(/^(\d{1,3})[.)]\s+(.*)$/);
    if (m) {
      if (cur) chunks.push(cur);
      cur = { number: Number(m[1]), raw: m[2] };
    } else if (cur) {
      cur.raw += '\n' + line;
    }
  }
  if (cur) chunks.push(cur);
  return chunks.map(toQuestion).filter(Boolean);
}

function toQuestion({ number, raw }) {
  if (!raw) return null;
  // Detect MCQ options
  const optRe = /(?:^|\n)\s*([A-D])\s*[.)]\s+([^\n]+)/g;
  const options = [];
  let stem = raw;
  let m, firstIdx = -1;
  while ((m = optRe.exec(raw))) {
    if (firstIdx < 0) firstIdx = m.index;
    options.push({ key: m[1], text: m[2].trim() });
  }
  if (options.length >= 2) {
    stem = raw.slice(0, firstIdx).trim();
    // De-dup by key (sometimes PDF has A, A due to two-column layout)
    const seen = new Set();
    const unique = options.filter((o) => (seen.has(o.key) ? false : (seen.add(o.key), true)));
    return {
      number,
      type: 'mcq',
      body: stem,
      data: { options: unique },
      correct_answer: null,
      points: 1,
    };
  }
  // Detect True/False marker (Đúng / Sai table-style; Vietnamese TSA uses "mệnh đề a) ..."
  if (/(^|\n)\s*[abcd]\)/i.test(raw) && /(Đúng|Sai)/i.test(raw)) {
    const stmRe = /(?:^|\n)\s*([abcd])\)\s*([^\n]+)/gi;
    const statements = [];
    while ((m = stmRe.exec(raw))) statements.push({ key: m[1].toLowerCase(), text: m[2].trim() });
    if (statements.length) {
      stem = raw.slice(0, raw.indexOf(statements[0].text) - 3).trim();
      return {
        number, type: 'tf', body: stem,
        data: { statements }, correct_answer: null, points: statements.length,
      };
    }
  }
  // Fill-in-the-blank hint ("là ___" or "bằng ..." ending with "?" / "...")
  if (/(_{2,}|\[\s*\]|\.\.\.\.+)/.test(raw)) {
    return {
      number, type: 'fill', body: raw.trim(),
      data: { blanks: (raw.match(/_{2,}/g) || ['_']).length },
      correct_answer: null, points: 1,
    };
  }
  // Fallback: short-answer
  return {
    number, type: 'short', body: raw.trim(),
    data: {}, correct_answer: null, points: 1,
  };
}
