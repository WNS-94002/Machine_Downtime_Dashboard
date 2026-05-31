/* ============================================================================
   report.js — สร้างรายงาน PDF (1 เครื่องจักร = 1 หน้า A4) แล้วสั่งพิมพ์
   เปิดให้เข้าถึงผ่าน global object `DashReport`
   ----------------------------------------------------------------------------
   ใช้ผ่าน inline onclick:  printReport('bw' | 'cr' | 'sys')
   ========================================================================== */
(function (global) {
  'use strict';

  const cfg = global.DASH_CONFIG;
  const M = global.Metrics;

  /* ── grade → class สำหรับสีในตารางพิมพ์ ─────────────────────────────────── */
  function maClass(v) { return v >= 95 ? 'g' : v >= 80 ? 'y' : 'r'; }
  function mttrClass(v) { return v <= 2 ? 'g' : v <= 6 ? 'y' : 'r'; }
  function mtbfClass(v) { return v >= 18 ? 'g' : v >= 10 ? 'y' : 'r'; }

  /* บล็อกลายเซ็น (ใช้ซ้ำทุกหน้า) */
  const SIG_BLOCK = `
    <div class="rpt-sig-spacer"></div>
    <div class="rpt-sig-block">
      <div class="rpt-sig-box">
        <div class="rpt-sig-role">ผู้นำเสนอ / Prepared by</div>
        <div class="rpt-sig-line"></div>
        <div class="rpt-sig-detail">ชื่อ / Name: ........................................&nbsp;&nbsp; ตำแหน่ง: ........................&nbsp;&nbsp; วันที่: ..................</div>
      </div>
      <div class="rpt-sig-box">
        <div class="rpt-sig-role">ผู้รับรอง / Approved by</div>
        <div class="rpt-sig-line"></div>
        <div class="rpt-sig-detail">ชื่อ / Name: ........................................&nbsp;&nbsp; ตำแหน่ง: ........................&nbsp;&nbsp; วันที่: ..................</div>
      </div>
    </div>`;

  /* สร้าง HTML รายงานของกลุ่ม (data = record ที่กรองช่วงวันที่แล้ว) */
  function buildReport(data, groupKey, from, to) {
    const grp = cfg.PRINT_GROUPS[groupKey];
    const fromS = from ? M.fmtDate(from) : 'ทั้งหมด';
    const toS = to ? M.fmtDate(to) : 'ทั้งหมด';
    const today = M.fmtDate(new Date());
    const color = grp.color;

    const gma = M.calcGroupMA(data, grp.machines, grp.failTypes, from, to);
    const { daily, summary } = M.calcMTTRMTBF(data, from, to);

    const pages = grp.machines.map(m => {
      const s = summary[m] || { totalFailDT: 0, totalUptime: 0, totalEvents: 0, totalDays: 0, mttr: 0, mtbf: cfg.HRS, ma: 100 };
      const mData = data.filter(r => r.machine === m);
      const totalDT = M.sumS(mData);
      const dailyR = (daily[m] || []).filter(r => r.events > 0 || r.allSMU > 0);
      const showGroupMA = grp.machines.length > 1;
      const top3 = [...mData].sort((a, b) => b.smu - a.smu).slice(0, 3);

      const dailyTable = dailyR.length === 0
        ? `<p style="font-size:8pt;color:#999;padding:4pt 0">ไม่มีข้อมูล Failure ในช่วงที่เลือก</p>`
        : `<table class="rpt-table">
            <thead><tr>
              <th>วันที่</th><th class="num">ครั้ง Failure</th><th class="num">Failure DT (ชม.)</th>
              <th class="num">Uptime (ชม.)</th><th class="num">MTTR (ชม./ครั้ง)</th>
              <th class="num">MTBF (ชม./ครั้ง)</th><th class="num">MA%</th>
            </tr></thead>
            <tbody>
              ${dailyR.map(r => `<tr>
                <td style="white-space:nowrap">${M.fmtDate(r.date)}</td>
                <td class="num">${r.events}</td>
                <td class="num">${r.failSMU.toFixed(2)}</td>
                <td class="num">${r.uptime.toFixed(2)}</td>
                <td class="num bold ${r.events > 0 ? mttrClass(r.mttr) : ''}">${r.events > 0 ? r.mttr.toFixed(2) : '—'}</td>
                <td class="num bold ${r.events > 0 ? mtbfClass(r.mtbf) : ''}">${r.events > 0 ? r.mtbf.toFixed(2) : '—'}</td>
                <td class="num bold ${r.events > 0 ? maClass(r.ma) : ''}">${r.events > 0 ? r.ma.toFixed(1) + '%' : '—'}</td>
              </tr>`).join('')}
            </tbody>
          </table>`;

      const top3Table = top3.length === 0
        ? `<p style="font-size:8pt;color:#999;padding:4pt 0">ไม่มีข้อมูล</p>`
        : `<table class="rpt-table">
            <thead><tr>
              <th style="width:16pt">#</th><th>รายละเอียด</th>
              <th style="width:52pt">วันที่</th><th style="width:28pt">ประเภท</th>
              <th class="num" style="width:34pt">ชั่วโมง</th>
            </tr></thead>
            <tbody>
              ${top3.map((r, i) => `<tr>
                <td class="bold" style="color:${color}">${i + 1}</td>
                <td style="font-size:7pt">${M.esc(r.detail) || '—'}${r.mergedCount > 1 ? ` <span style="color:#534ab7;font-size:6.5pt">(รวม ${r.mergedCount} กะ)</span>` : ''}</td>
                <td style="white-space:nowrap;font-size:7pt">${M.fmtDate(r.date)}</td>
                <td style="font-size:7pt">${M.esc(r.type)}</td>
                <td class="num bold">${r.smu.toFixed(1)}</td>
              </tr>`).join('')}
            </tbody>
          </table>`;

      return `
      <div class="rpt-machine-page" style="--rpt-color:${color}">
        <div class="rpt-page-header">
          <div>
            <div class="rpt-page-header-title" style="color:${color}">${M.esc(grp.label)}</div>
            <div class="rpt-page-header-sub">${M.esc(m)} &nbsp;·&nbsp; Downtime Analysis Report</div>
          </div>
          <div class="rpt-page-header-meta">
            ช่วงวันที่: <strong>${fromS}</strong> — <strong>${toS}</strong><br>
            Failure Types: <strong>${grp.failTypes.join(', ')}</strong><br>
            พิมพ์: ${today}
          </div>
        </div>

        <div class="rpt-kpi-bar">
          <div class="rpt-kpi-box rpt-kpi-ma" style="border-left-color:${color} !important">
            <div class="rpt-kpi-box-label">MA% — ${M.esc(m)}</div>
            <div class="rpt-kpi-box-val ${maClass(s.ma)}" style="font-size:18pt">${s.ma.toFixed(1)}<span style="font-size:9pt;font-weight:400">%</span></div>
          </div>
          ${showGroupMA ? `<div class="rpt-kpi-box rpt-kpi-ma" style="border-left-color:#888 !important">
            <div class="rpt-kpi-box-label">MA% รวม ${M.esc(grp.label)}</div>
            <div class="rpt-kpi-box-val ${maClass(gma.ma)}" style="font-size:18pt">${gma.ma.toFixed(1)}<span style="font-size:9pt;font-weight:400">%</span></div>
          </div>` : ''}
          <div class="rpt-kpi-box"><div class="rpt-kpi-box-label">MTTR</div><div class="rpt-kpi-box-val ${mttrClass(s.mttr)}">${s.mttr.toFixed(2)}</div><div class="rpt-kpi-box-unit">ชม./ครั้ง</div></div>
          <div class="rpt-kpi-box"><div class="rpt-kpi-box-label">MTBF</div><div class="rpt-kpi-box-val ${mtbfClass(s.mtbf)}">${s.mtbf.toFixed(2)}</div><div class="rpt-kpi-box-unit">ชม./ครั้ง</div></div>
          <div class="rpt-kpi-box"><div class="rpt-kpi-box-label">จำนวนครั้ง Failure</div><div class="rpt-kpi-box-val">${s.totalEvents}</div><div class="rpt-kpi-box-unit">ครั้ง</div></div>
          <div class="rpt-kpi-box"><div class="rpt-kpi-box-label">รวม Failure DT</div><div class="rpt-kpi-box-val">${s.totalFailDT.toFixed(1)}</div><div class="rpt-kpi-box-unit">ชั่วโมง</div></div>
          <div class="rpt-kpi-box"><div class="rpt-kpi-box-label">รวม Downtime ทั้งหมด</div><div class="rpt-kpi-box-val">${totalDT.toFixed(1)}</div><div class="rpt-kpi-box-unit">ชั่วโมง</div></div>
        </div>

        <div class="rpt-sec-title accent">MTTR · MTBF · MA% รายวัน</div>
        <div class="rpt-table-wrap">${dailyTable}</div>

        <div class="rpt-sec-title accent">3 อันดับ Downtime สูงสุด</div>
        <div class="rpt-table-wrap">${top3Table}</div>

        ${SIG_BLOCK}
      </div>`;
    });

    return pages.join('\n');
  }

  global.DashReport = { buildReport };
})(window);
