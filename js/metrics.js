/* ============================================================================
   metrics.js — การคำนวณทั้งหมด: date helpers, filter, MTTR/MTBF/MA%
   เปิดให้เข้าถึงผ่าน global object `Metrics`
   ----------------------------------------------------------------------------
   นิยาม (Base = 24 ชม./วัน):
     MTTR = Failure DT ÷ จำนวนครั้ง
     MTBF = Uptime ÷ จำนวนครั้ง
     MA%  = Uptime ÷ (วันทั้งหมด × 24) × 100   [เทียบเท่า MTBF ÷ (MTBF+MTTR) × 100]

   หัวใจของความถูกต้อง (breakdown ยาวข้ามวัน):
     1) splitHours — กระจายชั่วโมง Downtime ลง "วันจริง" ตาม Start + SMU
        (ไม่พึ่ง Finish ที่อาจเพี้ยนหลังการรวมกะ) → วันที่ดับทั้งวัน Uptime = 0
     2) detectIncidents — รวม Downtime ต่อเนื่องที่ "detail เหมือนกัน" เป็น 1 ครั้ง
        → MTTR/MTBF สะท้อนเหตุการณ์จริง ไม่ใช่จำนวนแถว/กะ
   ========================================================================== */
(function (global) {
  'use strict';

  const cfg = global.DASH_CONFIG;
  const HRS = cfg.HRS;
  const MIN = 60000;        /* 1 นาที (ms) */
  const DAY_MS = 86400000;  /* 1 วัน (ms) */
  /* ช่องว่างสูงสุด (นาที) ที่ยังถือว่า Downtime ต่อเนื่องเป็น breakdown เดียวกัน */
  const GAP_MIN = (cfg.BREAKDOWN_GAP_HRS != null ? cfg.BREAKDOWN_GAP_HRS : 24) * 60;

  /* ── escape ข้อความก่อน inject ลง innerHTML (กัน markup เพี้ยน/XSS) ──────── */
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  /* ── Date helpers ───────────────────────────────────────────────────────── */
  const pad = n => String(n).padStart(2, '0');
  function dateKey(d)    { return d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : '?'; }
  function monthKey(d)   { return d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}` : '?'; }
  function monthLabel(k) { if (k === '?') return '?'; const [y, m] = k.split('-'); return `${cfg.TH_M[+m - 1]} ${y}`; }
  function fmtDate(d)    { return d ? `${d.getDate()} ${cfg.TH_M[d.getMonth()]} ${d.getFullYear()}` : ''; }
  function shortDate(d)  { return d ? `${d.getDate()}/${d.getMonth() + 1}` : ''; }
  function toISO(d)      { return d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : ''; }
  /* "YYYY-MM-DD" → Date (local, ไม่ใช่ UTC) */
  function parseDateKey(dk) { const [y, m, d] = dk.split('-').map(Number); return new Date(y, m - 1, d); }

  /* ── Filter helpers ─────────────────────────────────────────────────────── */
  function inRange(r, from, to) {
    if (!r.date) return false;
    if (from && r.date < from) return false;
    if (to && r.date > to) return false;
    return true;
  }
  function filterByRange(data, from, to) { return data.filter(r => inRange(r, from, to)); }
  function filterD(data, from, to, mo, ty) {
    return data.filter(r => inRange(r, from, to)
      && (mo === 'all' || monthKey(r.date) === mo)
      && (ty === 'all' || r.type === ty));
  }
  function sumS(arr) { return arr.reduce((s, r) => s + r.smu, 0); }
  function isFailure(machine, type) { return (cfg.FAILURE_TYPES[machine] || ['ME', 'EE']).includes(type); }

  /* ── Color helpers ──────────────────────────────────────────────────────── */
  function avC(a)   { return a >= 95 ? '#0f6e56' : a >= 80 ? '#854f0b' : '#a32d2d'; }
  function mttrC(v) { return v <= 2 ? '#0f6e56' : v <= 6 ? '#854f0b' : '#a32d2d'; }
  function mtbfC(v) { return v >= 18 ? '#0f6e56' : v >= 10 ? '#854f0b' : '#a32d2d'; }

  /* รายการวัน (dateKey) ทั้งหมดในช่วง [from, to] — ว่างถ้าไม่ได้กำหนดช่วง */
  function allDaysInRange(from, to) {
    const days = [];
    if (!from || !to) return days;
    const cur = new Date(from); cur.setHours(0, 0, 0, 0);
    const end = new Date(to);   end.setHours(23, 59, 59, 999);
    while (cur <= end) { days.push(dateKey(cur)); cur.setDate(cur.getDate() + 1); }
    return days;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     BREAKDOWN HELPERS
  ══════════════════════════════════════════════════════════════════════════ */

  /* normalize detail สำหรับเทียบความเหมือน:
     - ตัด dash/ช่องว่าง/จุด นำหน้า
     - ย่อช่องว่างซ้ำ + lowercase
     - ตัดอักขระที่ไม่ใช่ตัวอักษร/ตัวเลขออก (กัน typo จากเว้นวรรค/เครื่องหมาย)
     แล้วเทียบด้วย "คำนำ" เพื่อให้ทนต่อ typo/encoding ที่ปลายข้อความ
     (ข้อมูลจริงพบ detail เดียวกันพิมพ์ต่างกันที่ตัวท้าย เช่น "เนื่องจาก" vs "เนื่องจากเ") */
  function normDetail(s) {
    const norm = (s || '').toLowerCase()
      .replace(/^[\s\-–—.]+/, '')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    /* ใช้ 20 อักขระแรกเป็น signature — typo ปลายประโยคจะไม่ทำให้แตกเหตุการณ์ */
    return norm.slice(0, 20);
  }

  /* กระจาย Downtime → ชั่วโมงต่อวัน { 'YYYY-MM-DD': hrs }
     นับจาก absStart ไล่ข้ามวันด้วยจำนวนชั่วโมงจริง (smu) — ไม่พึ่ง absFinish */
  function splitHours(asMin, hours) {
    const out = {};
    let cur = asMin * MIN;
    let remain = hours * 3600000; /* ms ที่เหลือต้องกระจาย */
    let guard = 0;
    while (remain > 1e-6 && guard++ < 2000) {
      const d = new Date(cur);
      const nextDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() + DAY_MS;
      const segEnd = Math.min(cur + remain, nextDay);
      out[dateKey(d)] = (out[dateKey(d)] || 0) + (segEnd - cur) / 3600000;
      remain -= (segEnd - cur);
      cur = segEnd;
    }
    return out;
  }

  /* รวม failure records → incidents
     ต่อเนื่องเป็นครั้งเดียวกันเมื่อ: detail เหมือนกัน  และ  เริ่มภายใน GAP_MIN
     นาที หลังก้อนเดียวกันสิ้นสุด (effEnd = absStart + smu ชั่วโมง)
     ── group ตาม detail ก่อน แล้วค่อย chain ตามเวลา เพื่อไม่ให้ record detail อื่น
        ที่แทรกกลาง (เช่นงานซ่อมย่อยระหว่าง breakdown ใหญ่) มาตัดการนับครั้ง */
  function detectIncidents(failRecs) {
    const withTime = failRecs.filter(r => r.absStart != null);
    const noTime = failRecs.filter(r => r.absStart == null);

    /* group by normalized detail */
    const groups = {};
    withTime.forEach(r => {
      const det = normDetail(r.detail);
      (groups[det] || (groups[det] = [])).push(r);
    });

    const incidents = [];
    for (const det in groups) {
      const recs = groups[det].sort((a, b) => a.absStart - b.absStart);
      let cur = null;
      for (const r of recs) {
        const start = r.absStart;
        const end = r.absStart + r.smu * 60; /* นาที (wall-clock โดยประมาณจาก smu) */
        if (cur && start <= cur.end + GAP_MIN) {
          cur.end = Math.max(cur.end, end);
          cur.hours += r.smu;
        } else {
          cur = { absStart: start, end, hours: r.smu, date: r.date, detail: det };
          incidents.push(cur);
        }
      }
    }
    /* แถวที่ไม่มีเวลาเริ่ม → นับเป็น incident ละ 1 (อิงวันที่) */
    for (const r of noTime) incidents.push({ absStart: null, end: null, hours: r.smu, date: r.date, detail: normDetail(r.detail) });

    /* เรียงตามเวลาเริ่มเพื่อความเป็นระเบียบของผลลัพธ์ */
    return incidents.sort((a, b) => (a.absStart || 0) - (b.absStart || 0));
  }

  /* สรุปสถิติ failure ของชุด record เทียบช่วงวัน
     → { perDayFail:{dk:hrs}, perDayEvents:{dk:n}, incidents, totalFailDT, totalEvents } */
  function aggregateFailures(failRecs, rangeDays) {
    const perDayFail = {};
    failRecs.forEach(r => {
      if (r.absStart != null) {
        const seg = splitHours(r.absStart, r.smu);
        for (const dk in seg) perDayFail[dk] = (perDayFail[dk] || 0) + seg[dk];
      } else {
        const dk = dateKey(r.date);
        perDayFail[dk] = (perDayFail[dk] || 0) + r.smu;
      }
    });

    const incidents = detectIncidents(failRecs);
    const perDayEvents = {};
    incidents.forEach(inc => {
      const dk = inc.absStart != null ? dateKey(new Date(inc.absStart * MIN)) : dateKey(inc.date);
      perDayEvents[dk] = (perDayEvents[dk] || 0) + 1;
    });

    /* รวม Downtime: cap ที่ 24 ชม./วัน (วันที่ดับเต็มวัน = 24 พอดี) */
    const days = rangeDays.length > 0 ? rangeDays : Object.keys(perDayFail);
    const totalFailDT = days.reduce((s, dk) => s + Math.min(perDayFail[dk] || 0, HRS), 0);

    return { perDayFail, perDayEvents, incidents, totalFailDT, totalEvents: incidents.length };
  }

  /* กระจาย Downtime ทุกประเภท (ไม่เฉพาะ failure) → ชั่วโมงต่อวัน */
  function distributeAll(recs) {
    const perDay = {};
    recs.forEach(r => {
      if (r.absStart != null) {
        const seg = splitHours(r.absStart, r.smu);
        for (const dk in seg) perDay[dk] = (perDay[dk] || 0) + seg[dk];
      } else {
        const dk = dateKey(r.date);
        perDay[dk] = (perDay[dk] || 0) + r.smu;
      }
    });
    return perDay;
  }

  /* ── MTTR / MTBF / MA% รายเครื่อง ───────────────────────────────────────── */
  function calcMTTRMTBF(data, from, to) {
    const MACHINES = cfg.MACHINES;
    const rangeDays = allDaysInRange(from, to);
    const daily = {};
    const summary = {};

    MACHINES.forEach(m => {
      const mRecs = data.filter(r => r.machine === m);
      const failRecs = mRecs.filter(r => isFailure(r.machine, r.type));
      const perDayAll = distributeAll(mRecs);
      const agg = aggregateFailures(failRecs, rangeDays);

      const buildRow = (dk) => {
        const failSMU = Math.min(agg.perDayFail[dk] || 0, HRS);
        const events = agg.perDayEvents[dk] || 0;
        const uptime = Math.max(HRS - failSMU, 0);
        let mttr, mtbf;
        if (events > 0) {          /* วันที่มี incident เริ่มใหม่ */
          mttr = failSMU / events;
          mtbf = uptime / events;
        } else if (failSMU > 0) {  /* วันกลาง breakdown ที่ลากต่อมา (ไม่มีครั้งใหม่) */
          mttr = 0; mtbf = 0;
        } else {                   /* วันปกติ ไม่มี failure */
          mttr = 0; mtbf = HRS;
        }
        const ma = (uptime / HRS) * 100;
        return { dk, date: parseDateKey(dk), allSMU: perDayAll[dk] || 0, failSMU, events, uptime, mttr, mtbf, ma, hasData: (perDayAll[dk] || 0) > 0 };
      };

      const dks = rangeDays.length > 0 ? rangeDays : Object.keys(perDayAll).sort();
      daily[m] = dks.map(buildRow);

      const daysAll = rangeDays.length > 0 ? rangeDays.length : dks.length;
      const tDT = agg.totalFailDT;
      const tEv = agg.totalEvents;
      const tUp = Math.max(daysAll * HRS - tDT, 0);
      summary[m] = {
        totalFailDT: tDT,
        totalUptime: tUp,
        totalEvents: tEv,
        totalDays: daily[m].filter(r => r.failSMU > 0).length,
        mttr: tEv > 0 ? tDT / tEv : 0,
        mtbf: tEv > 0 ? tUp / tEv : HRS,
        ma: daysAll > 0 ? (tUp / (daysAll * HRS)) * 100 : 100,
      };
    });

    return { daily, summary };
  }

  /* ── MA% รวมของกลุ่มเครื่องจักร ─────────────────────────────────────────── */
  function calcGroupMA(data, machines, failTypes, from, to) {
    const rangeDays = allDaysInRange(from, to);
    const failRecs = data.filter(r => machines.includes(r.machine) && failTypes.includes(r.type));
    const agg = aggregateFailures(failRecs, rangeDays);

    const tAllDays = rangeDays.length > 0 ? rangeDays.length : Object.keys(agg.perDayFail).length;
    const tDT = agg.totalFailDT;
    const tEv = agg.totalEvents;
    const tUp = Math.max(tAllDays * HRS - tDT, 0);
    return {
      mttr: tEv > 0 ? tDT / tEv : 0,
      mtbf: tEv > 0 ? tUp / tEv : HRS,
      ma: tAllDays > 0 ? (tUp / (tAllDays * HRS)) * 100 : 100,
      totalDays: tAllDays,
      totalEvents: tEv,
      totalFailDT: tDT,
      totalUptime: tUp,
    };
  }

  global.Metrics = {
    esc,
    dateKey, monthKey, monthLabel, fmtDate, shortDate, toISO, parseDateKey,
    inRange, filterByRange, filterD, sumS, isFailure,
    avC, mttrC, mtbfC, allDaysInRange,
    calcMTTRMTBF, calcGroupMA,
  };
})(window);
