/* ============================================================================
   metrics.js — การคำนวณทั้งหมด: date helpers, filter, MTTR/MTBF/MA%
   เปิดให้เข้าถึงผ่าน global object `Metrics`
   ----------------------------------------------------------------------------
   นิยาม (Base = 24 ชม./วัน):
     MTTR = Failure DT ÷ จำนวนครั้ง
     MTBF = Uptime ÷ จำนวนครั้ง
     MA%  = MTBF ÷ (MTBF + MTTR) × 100
   ========================================================================== */
(function (global) {
  'use strict';

  const cfg = global.DASH_CONFIG;
  const HRS = cfg.HRS;

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

  /* ── Filter helpers (range = {from, to}) ────────────────────────────────── */
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

  /* ── MTTR / MTBF / MA% รายเครื่อง ───────────────────────────────────────── */
  function calcMTTRMTBF(data, from, to) {
    const MACHINES = cfg.MACHINES;

    /* Step 1: bucket ทุกแถวตาม machine + date */
    const bmd = {}; MACHINES.forEach(m => bmd[m] = {});
    data.forEach(r => {
      const dk = dateKey(r.date);
      if (!bmd[r.machine]) return;
      if (!bmd[r.machine][dk]) bmd[r.machine][dk] = { allSMU: 0, failSMU: 0, failEvents: 0, date: r.date };
      bmd[r.machine][dk].allSMU += r.smu;
      if (isFailure(r.machine, r.type)) {
        bmd[r.machine][dk].failSMU += r.smu;
        bmd[r.machine][dk].failEvents += 1;
      }
    });

    const rangeDays = allDaysInRange(from, to);

    /* Step 2: สร้างแถวรายวันต่อเครื่อง (เติมวันที่ไม่มี failure ด้วยค่า default) */
    const daily = {};
    MACHINES.forEach(m => {
      const dataRows = Object.entries(bmd[m]).map(([dk, v]) => {
        const dt = Math.min(v.failSMU, HRS), up = Math.max(HRS - dt, 0);
        const mttr = v.failEvents > 0 ? dt / v.failEvents : 0;
        const mtbf = v.failEvents > 0 ? up / v.failEvents : HRS;
        const ma = mttr + mtbf > 0 ? (mtbf / (mtbf + mttr)) * 100 : 100;
        return { dk, date: v.date, allSMU: v.allSMU, failSMU: dt, events: v.failEvents, uptime: up, mttr, mtbf, ma, hasData: true };
      });
      const dataMap = {}; dataRows.forEach(r => dataMap[r.dk] = r);

      if (rangeDays.length > 0) {
        daily[m] = rangeDays.map(dk => dataMap[dk] || {
          dk, date: parseDateKey(dk), allSMU: 0, failSMU: 0, events: 0,
          uptime: HRS, mttr: 0, mtbf: HRS, ma: 100, hasData: false,
        });
      } else {
        daily[m] = dataRows.sort((a, b) => a.dk.localeCompare(b.dk));
      }
    });

    /* Step 3: สรุปรวมต่อเครื่อง — Uptime อิงวันทั้งหมดในช่วง × 24 ชม.
       (สอดคล้องกับ calcGroupMA เพื่อให้ MA% รายเครื่องเทียบกับ MA% รวมกลุ่มได้) */
    const summary = {};
    const totalRangeDays = rangeDays.length;
    MACHINES.forEach(m => {
      const failRows = daily[m].filter(r => r.events > 0);
      if (!failRows.length) {
        summary[m] = { totalFailDT: 0, totalUptime: 0, totalEvents: 0, totalDays: 0, mttr: 0, mtbf: HRS, ma: 100 };
        return;
      }
      const daysAll = totalRangeDays > 0 ? totalRangeDays : daily[m].length;
      const tDT = failRows.reduce((s, r) => s + r.failSMU, 0);  /* failSMU ถูก cap ที่ 24 แล้ว */
      const tEv = failRows.reduce((s, r) => s + r.events, 0);
      const tUp = Math.max(daysAll * HRS - tDT, 0);
      const mttr = tEv > 0 ? tDT / tEv : 0;
      const mtbf = tEv > 0 ? tUp / tEv : HRS;
      const ma = mttr + mtbf > 0 ? (mtbf / (mtbf + mttr)) * 100 : 100;
      summary[m] = { totalFailDT: tDT, totalUptime: tUp, totalEvents: tEv, totalDays: failRows.length, mttr, mtbf, ma };
    });

    return { daily, summary };
  }

  /* ── MA% รวมของกลุ่มเครื่องจักร ─────────────────────────────────────────── */
  function calcGroupMA(data, machines, failTypes, from, to) {
    const byDay = {};
    data.filter(r => machines.includes(r.machine)).forEach(r => {
      const dk = dateKey(r.date);
      if (!byDay[dk]) byDay[dk] = { failSMU: 0, failEvents: 0 };
      if (failTypes.includes(r.type)) { byDay[dk].failSMU += r.smu; byDay[dk].failEvents += 1; }
    });

    const rangeDays = allDaysInRange(from, to);
    const tAllDays = rangeDays.length > 0 ? rangeDays.length : Object.keys(byDay).length;

    const failRows = Object.values(byDay).filter(v => v.failEvents > 0);
    if (!failRows.length) {
      const tUp = tAllDays * HRS;
      return { mttr: 0, mtbf: tAllDays > 0 ? tUp : HRS, ma: 100, totalDays: tAllDays, totalEvents: 0, totalFailDT: 0, totalUptime: tUp };
    }
    const tDT = failRows.reduce((s, r) => s + Math.min(r.failSMU, HRS), 0);
    const tEv = failRows.reduce((s, r) => s + r.failEvents, 0);
    const tUp = Math.max(tAllDays * HRS - tDT, 0);
    const mttr = tEv > 0 ? tDT / tEv : 0;
    const mtbf = tEv > 0 ? tUp / tEv : HRS;
    const ma = mttr + mtbf > 0 ? (mtbf / (mtbf + mttr)) * 100 : 100;
    return { mttr, mtbf, ma, totalDays: tAllDays, totalEvents: tEv, totalFailDT: tDT, totalUptime: tUp };
  }

  global.Metrics = {
    esc,
    dateKey, monthKey, monthLabel, fmtDate, shortDate, toISO, parseDateKey,
    inRange, filterByRange, filterD, sumS, isFailure,
    avC, mttrC, mtbfC, allDaysInRange,
    calcMTTRMTBF, calcGroupMA,
  };
})(window);
