/* ============================================================================
   dataService.js — โหลด / parse / merge / cache ข้อมูลจาก Google Sheets
   เปิดให้เข้าถึงผ่าน global object `DataService`
   ========================================================================== */
(function (global) {
  'use strict';

  const cfg = global.DASH_CONFIG;

  /* ── Parse helpers ──────────────────────────────────────────────────────── */

  /* ชื่อ Location → ชื่อเครื่องจักรมาตรฐาน (null = ไม่อยู่ในเป้าหมาย) */
  function normM(loc) {
    return loc ? (cfg.MALIAS[loc.trim().toLowerCase()] || null) : null;
  }

  /* "H:MM" → จำนวนนาทีจากเที่ยงคืน (null = parse ไม่ได้) */
  function parseTStr(s) {
    if (!s) return null;
    const m = s.trim().match(/^(\d{1,2}):(\d{2})$/);
    return m ? (+m[1] * 60 + +m[2]) : null;
  }

  /* แปลง 1 row ดิบ → record มาตรฐาน (null = ข้ามแถวนี้) */
  function parseR(row) {
    const machine = normM(row['Location']);
    if (!machine) return null;
    const smu = parseFloat(row['SMU']);
    if (isNaN(smu) || smu <= 0) return null;

    const raw = row['Date'];
    let d = null;
    if (raw) { const p = raw.split('/'); if (p.length === 3) d = new Date(+p[2], +p[1] - 1, +p[0]); }

    const sm = parseTStr(row['Start']), fm = parseTStr(row['Finish']);
    let as = null, af = null;
    if (d && sm !== null && fm !== null) {
      const b = d.getTime() / 60000;
      as = b + sm;
      af = b + fm + (fm <= sm ? 1440 : 0); /* ข้ามเที่ยงคืน */
    }
    return {
      date: d, machine, smu,
      type: (row['Type'] || '').trim() || 'Other',
      detail: (row['Detail'] || '').trim(),
      absStart: as, absFinish: af, mergedCount: 1,
    };
  }

  /* normalize detail ไว้เทียบความเหมือน (ตัดช่องว่างซ้ำ + lowercase) */
  function normD(d) { return (d || '').toLowerCase().replace(/\s+/g, ' ').trim(); }

  /* รวมแถว Downtime ที่ต่อเนื่องกัน (เครื่อง+ประเภท+รายละเอียดเดียวกัน, เวลาติดกัน) */
  function mergeConsec(records) {
    const sorted = [...records].sort((a, b) => {
      if (a.machine !== b.machine) return a.machine.localeCompare(b.machine);
      return (a.absStart || 0) - (b.absStart || 0);
    });
    const merged = [];
    for (const rec of sorted) {
      if (!rec.absStart || !rec.absFinish) { merged.push({ ...rec }); continue; }
      let found = false;
      for (let i = merged.length - 1; i >= 0; i--) {
        const m = merged[i];
        if (m.machine !== rec.machine) break;
        if (!m.absFinish) continue;
        if (m.absFinish === rec.absStart && m.type === rec.type && normD(m.detail) === normD(rec.detail)) {
          m.absFinish = rec.absFinish;
          m.smu = parseFloat((m.smu + rec.smu).toFixed(4));
          m.mergedCount++;
          found = true;
          break;
        }
      }
      if (!found) merged.push({ ...rec });
    }
    return merged;
  }

  /* ── Cache (localStorage, key = URL) ────────────────────────────────────── */
  const cacheKey = url => 'dt_cache_' + url;

  function cacheGet(url) {
    try {
      const raw = localStorage.getItem(cacheKey(url));
      if (!raw) return null;
      const item = JSON.parse(raw);
      if (Date.now() - item.ts > cfg.CACHE_TTL_MS) { localStorage.removeItem(cacheKey(url)); return null; }
      return item.data;
    } catch (e) { return null; }
  }

  function cacheSet(url, data) {
    try { localStorage.setItem(cacheKey(url), JSON.stringify({ ts: Date.now(), data })); } catch (e) {}
  }

  function cacheClear() {
    try {
      localStorage.removeItem(cacheKey(cfg.CSV_2026));
      localStorage.removeItem(cacheKey(cfg.CSV_2025));
    } catch (e) {}
  }

  /* true เมื่อทั้งสองชีตยังมี cache ใช้ได้ */
  function hasCache() { return !!(cacheGet(cfg.CSV_2026) && cacheGet(cfg.CSV_2025)); }

  /* ── Fetch ──────────────────────────────────────────────────────────────── */
  async function fetchCSV(url) {
    const resp = await fetch(url, { cache: 'no-store' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const text = await resp.text();
    return Papa.parse(text, { header: true, skipEmptyLines: true, dynamicTyping: false, worker: false }).data;
  }

  async function fetchWithCache(url, label, pctStart, pctEnd, onProgress) {
    const cached = cacheGet(url);
    if (cached) { onProgress(pctEnd, `${label} (จาก cache) ✓`); return cached; }
    onProgress(pctStart, `กำลังโหลด ${label}...`);
    const data = await fetchCSV(url);
    onProgress(pctEnd, `${label} ✓`);
    cacheSet(url, data);
    return data;
  }

  /* โหลดทั้งสองชีต → คืน record ที่ parse + merge แล้ว
     onProgress(pct, msg) ใช้รายงานความคืบหน้า (อาจเป็น no-op) */
  async function loadAll(onProgress = () => {}) {
    onProgress(5, 'กำลังเชื่อมต่อ Google Sheets...');
    const rows2026 = await fetchWithCache(cfg.CSV_2026, 'Downtime 2026', 5, 45, onProgress);
    const rows2025 = await fetchWithCache(cfg.CSV_2025, 'Downtime 2025', 45, 80, onProgress);
    onProgress(85, 'กำลังประมวลผลข้อมูล...');
    return mergeConsec([...rows2026, ...rows2025].map(parseR).filter(Boolean));
  }

  global.DataService = { loadAll, cacheClear, hasCache, parseR, mergeConsec, normM };
})(window);
