/* ============================================================================
   app.js — ตัวควบคุมหลัก: state, render (overview / MTTR / detail table),
            build shell, filter, print trigger, bootstrap
   ========================================================================== */
(function (global) {
  'use strict';

  const cfg = global.DASH_CONFIG;
  const DS  = global.DataService;
  const M   = global.Metrics;
  const CH  = global.DashCharts;
  const RP  = global.DashReport;
  const esc = M.esc;

  /* ── App state ──────────────────────────────────────────────────────────── */
  const state = {
    allMerged: [],
    dateFrom: null,
    dateTo: null,
    curTab: 'overview',
    /* detail table */
    dtMachine: 'all',
    dtTypes: new Set(['Plan', 'ME', 'EE', 'OPT', 'Uncontrol']),
    dtSortCol: 'smu',   /* 'smu' | 'date' */
    dtSortDir: 'desc',  /* 'desc' | 'asc' */
  };
  const DT_TYPES = ['Plan', 'ME', 'EE', 'OPT', 'Uncontrol'];

  /* ── small accessors ────────────────────────────────────────────────────── */
  const rangeData = () => M.filterByRange(state.allMerged, state.dateFrom, state.dateTo);
  const getMo = () => document.getElementById('sel-mo')?.value || 'all';
  const getTy = () => document.getElementById('sel-ty')?.value || 'all';
  const filtered = (mo, ty) => M.filterD(state.allMerged, state.dateFrom, state.dateTo, mo, ty);

  /* ════════════════════════════════════════════════════════════════════════
     DETAIL TABLE
  ════════════════════════════════════════════════════════════════════════ */
  function renderDetailTable(fd) {
    const { MACHINES, MSHORT, MC, TC } = cfg;

    let rows = fd.filter(r => (state.dtMachine === 'all' || r.machine === state.dtMachine) && state.dtTypes.has(r.type));
    rows = rows.slice().sort((a, b) => {
      const diff = state.dtSortCol === 'smu'
        ? b.smu - a.smu
        : (b.date || new Date(0)) - (a.date || new Date(0));
      return state.dtSortDir === 'desc' ? diff : -diff;
    });
    const totalSMU = M.sumS(rows);

    /* machine buttons */
    const mbList = ['all'].concat(MACHINES);
    const machBtns = mbList.map((m, idx) => {
      const isAll = m === 'all';
      const color = isAll ? '#185fa5' : MC[idx - 1];
      const active = m === state.dtMachine;
      const lbl = isAll ? 'ทั้งหมด' : MSHORT[idx - 1];
      const cnt = isAll
        ? fd.filter(r => state.dtTypes.has(r.type)).length
        : fd.filter(r => r.machine === m && state.dtTypes.has(r.type)).length;
      const dot = isAll ? ''
        : `<span style="display:inline-block;width:7px;height:7px;border-radius:2px;background:${active ? 'rgba(255,255,255,.7)' : color};margin-right:5px;vertical-align:middle"></span>`;
      const styleStr = active ? `background:${color};color:#fff;border-color:transparent` : 'color:var(--text-secondary)';
      return `<button class="dt-mach-btn${active ? ' active' : ''}" style="${styleStr}" onclick="dtSetMachine('${m}')">${dot}${lbl} <span style="opacity:.65;font-size:10px">${cnt}</span></button>`;
    }).join('');

    /* type toggle buttons */
    const typeBtns = DT_TYPES.map(t => {
      const on = state.dtTypes.has(t);
      const c = TC[t] || '#888';
      const styleStr = on ? `background:${c};color:#fff;border-color:transparent` : `border-color:${c};color:${c}`;
      return `<button class="dt-type-btn${on ? ' active' : ''}" style="${styleStr}" onclick="dtToggleType('${t}')">${t}</button>`;
    }).join('');

    /* table body */
    let body;
    if (rows.length === 0) {
      body = '<tr><td colspan="5" class="no-data">ไม่มีข้อมูลที่ตรงกับตัวกรอง</td></tr>';
    } else {
      body = rows.map(r => {
        const color = MC[MACHINES.indexOf(r.machine)] || '#888';
        const tc = TC[r.type] || '#888';
        const badge = r.mergedCount > 1 ? ` <span class="merged-badge">รวม ${r.mergedCount} กะ</span>` : '';
        return `<tr>
          <td style="white-space:nowrap;font-size:11px">${M.fmtDate(r.date)}</td>
          <td><span style="display:inline-block;width:7px;height:7px;border-radius:2px;background:${color};margin-right:6px;vertical-align:middle"></span><span style="font-weight:500;font-size:12px">${esc(r.machine)}</span></td>
          <td><span class="pill" style="background:${tc}22;color:${tc}">${esc(r.type)}</span></td>
          <td class="dt-detail-col">${esc(r.detail) || '—'}${badge}</td>
          <td class="num-right" style="font-weight:500;color:${color};font-size:12px">${r.smu.toFixed(1)} <span style="font-size:10px;opacity:.6">ชม.</span></td>
        </tr>`;
      }).join('');
    }

    const arrow = (col) => state.dtSortCol === col
      ? (state.dtSortDir === 'desc' ? '&#9660;' : '&#9650;')
      : '<span style="opacity:.35">&#9660;</span>';

    const panel = document.getElementById('dt-panel');
    if (!panel) return;
    panel.innerHTML = `
      <div class="panel-hdr">
        <span class="panel-title">รายละเอียด Downtime</span>
        <span class="dt-count">${rows.length} รายการ · รวม ${totalSMU.toFixed(1)} ชม.</span>
      </div>
      <div class="dt-controls">
        <div class="dt-machine-btns">${machBtns}</div>
        <div class="dt-type-btns">${typeBtns}</div>
      </div>
      <div class="tbl-wrap">
        <table>
          <thead><tr>
            <th class="dt-sort-th" onclick="dtToggleSort('date')" style="cursor:pointer;user-select:none;white-space:nowrap">วันที่ ${arrow('date')}</th>
            <th>เครื่องจักร</th>
            <th>ประเภท</th>
            <th>รายละเอียด</th>
            <th class="num-right dt-sort-th" onclick="dtToggleSort('smu')" style="cursor:pointer;user-select:none;white-space:nowrap">ชั่วโมง ${arrow('smu')}</th>
          </tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>`;
  }

  function refreshDetailTable() { renderDetailTable(filtered(getMo(), getTy())); }

  function dtSetMachine(m) { state.dtMachine = m; refreshDetailTable(); }
  function dtToggleType(t) {
    if (state.dtTypes.has(t)) { if (state.dtTypes.size > 1) state.dtTypes.delete(t); }
    else state.dtTypes.add(t);
    refreshDetailTable();
  }
  function dtToggleSort(col) {
    if (state.dtSortCol === col) state.dtSortDir = state.dtSortDir === 'desc' ? 'asc' : 'desc';
    else { state.dtSortCol = col; state.dtSortDir = 'desc'; }
    refreshDetailTable();
  }

  /* ════════════════════════════════════════════════════════════════════════
     OVERVIEW TAB
  ════════════════════════════════════════════════════════════════════════ */
  function renderOverview(mo, ty) {
    const { MACHINES, MSHORT, MC, TC, TYPE_ORDER, DP } = cfg;
    const fd = filtered(mo, ty);
    const total = M.sumS(fd);

    const bySMU = {}; MACHINES.forEach(m => bySMU[m] = 0);
    fd.forEach(r => { if (bySMU[r.machine] !== undefined) bySMU[r.machine] += r.smu; });

    const byType = {}; TYPE_ORDER.forEach(t => byType[t] = 0);
    fd.forEach(r => { if (byType[r.type] !== undefined) byType[r.type] += r.smu; });

    const rd = rangeData();
    const months = [...new Set(rd.map(r => M.monthKey(r.date)).filter(k => k !== '?'))].sort();
    const maxVal = Math.max(...Object.values(bySMU), 1);

    const mmd = {}; MACHINES.forEach(m => { mmd[m] = {}; months.forEach(k => mmd[m][k] = 0); });
    rd.filter(r => ty === 'all' || r.type === ty).forEach(r => {
      const k = M.monthKey(r.date);
      if (mmd[r.machine] && k !== '?') mmd[r.machine][k] += r.smu;
    });

    const tl = TYPE_ORDER.filter(t => byType[t] > 0);
    const tv = tl.map(t => byType[t]);
    const tc2 = tl.map(t => TC[t] || '#888');

    document.getElementById('tab-content').innerHTML = `
      <div class="kpi-row">
        <div class="kpi"><div class="kpi-accent" style="background:#185fa5"></div><div class="kpi-label">รวมทั้งหมด</div><div class="kpi-val">${total.toFixed(1)}</div><div class="kpi-unit">ชั่วโมง</div></div>
        ${MACHINES.map((m, i) => `<div class="kpi"><div class="kpi-accent" style="background:${MC[i]}"></div><div class="kpi-label">${MSHORT[i]}</div><div class="kpi-val">${bySMU[m].toFixed(1)}</div><div class="kpi-unit">ชม.</div><div class="kpi-bar-wrap"><div class="kpi-bar" style="width:${maxVal > 0 ? (bySMU[m] / maxVal * 100).toFixed(1) : 0}%;background:${MC[i]}"></div></div></div>`).join('')}
      </div>
      <div class="grid2">
        <div class="panel"><div class="panel-hdr"><span class="panel-title">Downtime ต่อเครื่อง</span></div><div class="chart-wrap" style="height:240px"><canvas id="c-bar" role="img" aria-label="Downtime per machine"></canvas></div></div>
        <div class="panel"><div class="panel-hdr"><span class="panel-title">แยกตามประเภท</span></div><div class="leg" id="leg-type"></div><div class="chart-wrap" style="height:200px"><canvas id="c-donut" role="img" aria-label="Downtime by type"></canvas></div></div>
      </div>
      <div class="panel-full"><div class="panel-hdr"><span class="panel-title">แนวโน้มรายเดือน</span></div><div class="leg" id="leg-trend"></div><div class="chart-wrap" style="height:200px"><canvas id="c-line" role="img" aria-label="Monthly trend"></canvas></div></div>
      <div class="panel-full">
        <div class="panel-hdr"><span class="panel-title">สรุปแยกเครื่อง × ประเภท (ชั่วโมง)</span></div>
        <div class="tbl-wrap"><table>
          <thead><tr><th>เครื่องจักร</th>${TYPE_ORDER.map(t => `<th><span class="pill" style="background:${TC[t]}22;color:${TC[t]}">${t}</span></th>`).join('')}<th>รวม</th><th style="min-width:90px">%</th></tr></thead>
          <tbody>${MACHINES.map((m, i) => {
            const bt = {}; TYPE_ORDER.forEach(t => bt[t] = 0);
            fd.filter(r => r.machine === m).forEach(r => { if (bt[r.type] !== undefined) bt[r.type] += r.smu; });
            const tot = Object.values(bt).reduce((a, b) => a + b, 0), pct = total > 0 ? tot / total * 100 : 0;
            return `<tr><td><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${MC[i]};margin-right:6px;vertical-align:middle"></span><span style="font-weight:500">${esc(m)}</span></td>${TYPE_ORDER.map(t => `<td style="color:${bt[t] > 0 ? 'var(--text-primary)' : 'var(--text-secondary)'}">${bt[t] > 0 ? bt[t].toFixed(1) : '—'}</td>`).join('')}<td style="font-weight:500">${tot.toFixed(1)}</td><td><div style="font-size:11px;color:var(--text-secondary)">${pct.toFixed(1)}%</div><div class="bar-bg"><div class="bar-f" style="width:${pct.toFixed(1)}%;background:${MC[i]}"></div></div></td></tr>`;
          }).join('')}</tbody>
        </table></div>
      </div>
      <div id="dt-panel" class="panel-full"></div>
    `;

    renderDetailTable(fd);
    CH.destroyMany(['bar', 'donut', 'line']);

    /* Bar */
    CH.make('bar', document.getElementById('c-bar'), {
      type: 'bar',
      data: { labels: MSHORT, datasets: [{ label: 'ชม.', data: MACHINES.map(m => +bySMU[m].toFixed(2)), backgroundColor: MC.map(c => c + 'cc'), borderColor: MC, borderWidth: 1.5, borderRadius: 6, borderSkipped: false }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${c.parsed.y.toFixed(1)} ชม.`, title: c => [MACHINES[c[0].dataIndex]] } } }, scales: { x: { grid: { display: false }, ticks: { color: CH.tickColor, font: { size: 11 } } }, y: { grid: { color: CH.gridColor }, border: { display: false }, ticks: { color: CH.tickColor, font: { size: 11 }, callback: v => v.toFixed(0) } } } },
    });

    /* Donut */
    document.getElementById('leg-type').innerHTML = tl.map((t, i) => `<span class="leg-item"><span class="leg-sq" style="background:${tc2[i]}"></span>${t} ${((tv[i] / tv.reduce((a, b) => a + b, 1)) * 100).toFixed(0)}%</span>`).join('');
    CH.make('donut', document.getElementById('c-donut'), {
      type: 'doughnut',
      data: { labels: tl, datasets: [{ data: tv.map(v => +v.toFixed(2)), backgroundColor: tc2.map(c => c + 'cc'), borderColor: tc2, borderWidth: 1.5, hoverOffset: 6 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${c.parsed.toFixed(1)} ชม.` } } }, cutout: '62%' },
    });

    /* Line */
    document.getElementById('leg-trend').innerHTML = MACHINES.map((m, i) => `<span class="leg-item"><span class="leg-sq" style="background:${MC[i]}"></span>${MSHORT[i]}</span>`).join('');
    CH.make('line', document.getElementById('c-line'), {
      type: 'line',
      data: { labels: months.map(M.monthLabel), datasets: MACHINES.map((m, i) => ({ label: m, data: months.map(k => +(mmd[m][k] || 0).toFixed(2)), borderColor: MC[i], backgroundColor: MC[i] + '18', borderWidth: 2, borderDash: DP[i], pointRadius: 3, pointBackgroundColor: MC[i], tension: 0.35, fill: false })) },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false, callbacks: { label: c => ` ${c.dataset.label}: ${c.parsed.y.toFixed(1)} ชม.` } } }, scales: { x: { grid: { color: CH.gridColor }, border: { display: false }, ticks: { color: CH.tickColor, font: { size: 11 }, maxRotation: 45, autoSkip: months.length > 6 } }, y: { grid: { color: CH.gridColor }, border: { display: false }, ticks: { color: CH.tickColor, font: { size: 11 }, callback: v => v.toFixed(0) } } } },
    });
  }

  /* ════════════════════════════════════════════════════════════════════════
     MTTR / MTBF / MA% TAB
  ════════════════════════════════════════════════════════════════════════ */
  function renderMTTR(selMachine) {
    const { MACHINES, MSHORT, MC, FAILURE_TYPES } = cfg;
    const rd = rangeData();
    const { daily, summary } = M.calcMTTRMTBF(rd, state.dateFrom, state.dateTo);
    const dm = daily[selMachine] || [];
    const mColor = MC[MACHINES.indexOf(selMachine)] || '#185fa5';
    const failTypes = FAILURE_TYPES[selMachine] || ['ME', 'EE'];

    document.getElementById('tab-content').innerHTML = `
      <div class="info-box"><strong>สูตร:</strong> MTTR = Failure DT ÷ จำนวนครั้ง &nbsp;|&nbsp; MTBF = Uptime ÷ จำนวนครั้ง &nbsp;|&nbsp; <strong>MA% = MTBF ÷ (MTBF + MTTR) × 100</strong><br>
      Crusher / BW / Spreader = ME, EE &nbsp;|&nbsp; System = OPT, ME, EE &nbsp;|&nbsp; Base = 24 ชม./วัน</div>
      <div class="section-hdr" style="margin-top:0">Machine Availability % (สรุปรวม)</div>
      <div class="ma-grid">${MACHINES.map((m, i) => { const s = summary[m], ma = s ? s.ma : 100; return `<div class="ma-card"><div class="ma-card-label">${MSHORT[i]}</div><div class="ma-card-val" style="color:${M.avC(ma)}">${ma.toFixed(1)}<span style="font-size:13px;font-weight:400">%</span></div><div class="ma-card-sub">MA%</div></div>`; }).join('')}</div>
      <div class="panel-full"><div class="panel-hdr"><span class="panel-title">สรุปรวม MTTR · MTBF · MA%</span></div>
        <div class="tbl-wrap"><table><thead><tr><th>เครื่องจักร</th><th>Failure Types</th><th class="num-right">วันที่มี Failure</th><th class="num-right">จำนวนครั้ง</th><th class="num-right">Failure DT (ชม.)</th><th class="num-right">Uptime (ชม.)</th><th class="num-right">MTTR</th><th class="num-right">MTBF</th><th class="num-right">MA%</th></tr></thead>
        <tbody>${MACHINES.map((m, i) => {
          const s = summary[m], ft = (FAILURE_TYPES[m] || []).join(', ');
          if (!s || s.totalEvents === 0) return `<tr><td><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${MC[i]};margin-right:6px;vertical-align:middle"></span><span style="font-weight:500">${esc(m)}</span></td><td style="font-size:10px">${ft}</td><td colspan="7" style="text-align:center;color:var(--text-secondary);font-size:11px">ไม่มีข้อมูล</td></tr>`;
          return `<tr><td><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${MC[i]};margin-right:6px;vertical-align:middle"></span><span style="font-weight:500">${esc(m)}</span></td><td style="font-size:10px;color:var(--text-secondary)">${ft}</td><td class="num-right">${s.totalDays}</td><td class="num-right">${s.totalEvents}</td><td class="num-right">${s.totalFailDT.toFixed(1)}</td><td class="num-right">${s.totalUptime.toFixed(1)}</td><td class="num-right"><span style="color:${M.mttrC(s.mttr)};font-weight:500">${s.mttr.toFixed(2)}</span></td><td class="num-right"><span style="color:${M.mtbfC(s.mtbf)};font-weight:500">${s.mtbf.toFixed(2)}</span></td><td class="num-right"><span style="color:${M.avC(s.ma)};font-weight:500">${s.ma.toFixed(1)}%</span></td></tr>`;
        }).join('')}</tbody></table></div>
      </div>
      <div class="grid2">
        <div class="panel"><div class="panel-hdr"><span class="panel-title">MTTR เปรียบเทียบ</span></div><div class="chart-wrap" style="height:210px"><canvas id="c-mttr-all"></canvas></div></div>
        <div class="panel"><div class="panel-hdr"><span class="panel-title">MTBF เปรียบเทียบ</span></div><div class="chart-wrap" style="height:210px"><canvas id="c-mtbf-all"></canvas></div></div>
      </div>
      <div class="section-hdr">รายละเอียดรายวัน</div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:1rem;flex-wrap:wrap;">
        <span style="font-size:12px;color:var(--text-secondary);">เครื่องจักร:</span>
        <div class="filter-chip"><svg style="width:12px;height:12px;stroke:currentColor;fill:none;stroke-width:2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/></svg>
        <select id="sel-mach">${MACHINES.map(m => `<option value="${m}" ${selMachine === m ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
        <span style="font-size:11px;color:var(--text-secondary);">Failure: <strong style="color:var(--text-primary)">${failTypes.join(', ')}</strong></span>
      </div>
      <div class="grid2"><div class="panel"><div class="panel-hdr"><span class="panel-title">MTTR รายวัน — ${esc(selMachine)}</span></div><div class="chart-wrap" style="height:190px"><canvas id="c-mttr-d"></canvas></div></div><div class="panel"><div class="panel-hdr"><span class="panel-title">MTBF รายวัน — ${esc(selMachine)}</span></div><div class="chart-wrap" style="height:190px"><canvas id="c-mtbf-d"></canvas></div></div></div>
      <div class="panel-full"><div class="panel-hdr"><span class="panel-title">MA% รายวัน — ${esc(selMachine)}</span></div><div class="chart-wrap" style="height:155px"><canvas id="c-ma-d"></canvas></div></div>
      <div class="panel-full"><div class="panel-hdr"><span class="panel-title">ตารางรายวัน — ${esc(selMachine)}</span></div>
      <div class="tbl-wrap"><table><thead><tr><th>วันที่</th><th class="num-right">ครั้ง Failure</th><th class="num-right">Failure DT (ชม.)</th><th class="num-right">Uptime (ชม.)</th><th class="num-right">MTTR</th><th class="num-right">MTBF</th><th class="num-right">MA%</th></tr></thead><tbody>
      ${dm.map(r => {
        const noFail = r.events === 0;
        return `<tr style="${noFail ? 'opacity:.55' : ''}">
          <td style="font-weight:500;white-space:nowrap">${M.fmtDate(r.date)}</td>
          <td class="num-right">${noFail ? '<span style="color:var(--text-secondary)">—</span>' : r.events}</td>
          <td class="num-right">${noFail ? '<span style="color:var(--text-secondary)">—</span>' : r.failSMU.toFixed(2)}</td>
          <td class="num-right">${r.uptime.toFixed(2)}</td>
          <td class="num-right"><span style="color:${noFail ? 'var(--text-secondary)' : M.mttrC(r.mttr)};font-weight:${noFail ? '400' : '500'}">${noFail ? '0.00' : r.mttr.toFixed(2)}</span></td>
          <td class="num-right"><span style="color:${noFail ? '#0f6e56' : M.mtbfC(r.mtbf)};font-weight:${noFail ? '400' : '500'}">${r.mtbf.toFixed(2)}</span></td>
          <td class="num-right"><span style="color:${noFail ? '#0f6e56' : M.avC(r.ma)};font-weight:${noFail ? '400' : '500'}">${r.ma.toFixed(1)}%</span></td>
        </tr>`;
      }).join('')}
      </tbody></table></div>
      </div>
    `;

    document.getElementById('sel-mach').addEventListener('change', e => renderMTTR(e.target.value));
    CH.destroyMany(['mttr-all', 'mtbf-all', 'mttr-d', 'mtbf-d', 'ma-d']);

    const barAxis = (unit) => ({ x: { grid: { display: false }, ticks: { color: CH.tickColor, font: { size: 11 } } }, y: { grid: { color: CH.gridColor }, border: { display: false }, ticks: { color: CH.tickColor, font: { size: 10 } }, title: { display: true, text: unit, color: CH.tickColor, font: { size: 10 } } } });

    CH.make('mttr-all', document.getElementById('c-mttr-all'), {
      type: 'bar',
      data: { labels: MSHORT, datasets: [{ label: 'MTTR', data: MACHINES.map(m => +(summary[m]?.mttr || 0).toFixed(2)), backgroundColor: MC.map(c => c + 'cc'), borderColor: MC, borderWidth: 1.5, borderRadius: 5, borderSkipped: false }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` MTTR: ${c.parsed.y.toFixed(2)} ชม./ครั้ง`, title: c => [MACHINES[c[0].dataIndex]] } } }, scales: barAxis('ชม./ครั้ง') },
    });
    CH.make('mtbf-all', document.getElementById('c-mtbf-all'), {
      type: 'bar',
      data: { labels: MSHORT, datasets: [{ label: 'MTBF', data: MACHINES.map(m => +(summary[m]?.mtbf || 0).toFixed(2)), backgroundColor: MC.map(c => c + '88'), borderColor: MC, borderWidth: 1.5, borderRadius: 5, borderSkipped: false }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` MTBF: ${c.parsed.y.toFixed(2)} ชม./ครั้ง`, title: c => [MACHINES[c[0].dataIndex]] } } }, scales: barAxis('ชม./ครั้ง') },
    });

    const lbl = dm.map(r => M.shortDate(r.date));
    const dailyAxis = { x: { grid: { display: false }, ticks: { color: CH.tickColor, font: { size: 10 }, maxRotation: 45, autoSkip: dm.length > 20 } }, y: { grid: { color: CH.gridColor }, border: { display: false }, ticks: { color: CH.tickColor, font: { size: 10 } }, title: { display: true, text: 'ชม./ครั้ง', color: CH.tickColor, font: { size: 10 } } } };
    CH.make('mttr-d', document.getElementById('c-mttr-d'), {
      type: 'bar',
      data: { labels: lbl, datasets: [{ label: 'MTTR', data: dm.map(r => +r.mttr.toFixed(2)), backgroundColor: mColor + 'cc', borderColor: mColor, borderWidth: 1.5, borderRadius: 4 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${c.parsed.y.toFixed(2)} ชม.` } } }, scales: dailyAxis },
    });
    CH.make('mtbf-d', document.getElementById('c-mtbf-d'), {
      type: 'bar',
      data: { labels: lbl, datasets: [{ label: 'MTBF', data: dm.map(r => +r.mtbf.toFixed(2)), backgroundColor: '#0f6e5699', borderColor: '#0f6e56', borderWidth: 1.5, borderRadius: 4 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${c.parsed.y.toFixed(2)} ชม.` } } }, scales: dailyAxis },
    });
    CH.make('ma-d', document.getElementById('c-ma-d'), {
      type: 'line',
      data: { labels: lbl, datasets: [{ label: 'MA%', data: dm.map(r => +r.ma.toFixed(2)), borderColor: mColor, backgroundColor: mColor + '18', borderWidth: 2, pointRadius: 3, pointBackgroundColor: mColor, tension: 0.3, fill: true }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` MA: ${c.parsed.y.toFixed(1)}%` } } }, scales: { x: { grid: { display: false }, ticks: { color: CH.tickColor, font: { size: 10 }, maxRotation: 45, autoSkip: dm.length > 20 } }, y: { grid: { color: CH.gridColor }, border: { display: false }, min: 0, max: 100, ticks: { color: CH.tickColor, font: { size: 10 }, callback: v => `${v}%` } } } },
    });
  }

  /* ════════════════════════════════════════════════════════════════════════
     TAB / FILTER CONTROL
  ════════════════════════════════════════════════════════════════════════ */
  function renderCurrentTab() {
    if (state.curTab === 'overview') renderOverview(getMo(), getTy());
    else renderMTTR(document.getElementById('sel-mach')?.value || cfg.MACHINES[0]);
  }

  function applyDateRange() {
    const f = document.getElementById('date-from').value;
    const t = document.getElementById('date-to').value;
    state.dateFrom = f ? new Date(f) : null;
    state.dateTo = t ? new Date(t) : null;
    if (state.dateFrom) state.dateFrom.setHours(0, 0, 0, 0);
    if (state.dateTo) state.dateTo.setHours(23, 59, 59, 999);
    renderCurrentTab();
  }

  function switchTab(tab) {
    state.curTab = tab;
    document.getElementById('tab-ov').classList.toggle('active', tab === 'overview');
    document.getElementById('tab-mt').classList.toggle('active', tab === 'mttr');
    document.getElementById('ov-filters').style.display = tab === 'overview' ? 'flex' : 'none';
    if (tab === 'overview') renderOverview(getMo(), getTy());
    else renderMTTR(cfg.MACHINES[0]);
  }

  /* ── Print trigger (inline onclick) ─────────────────────────────────────── */
  function printReport(groupKey) {
    const el = document.getElementById('print-report');
    el.innerHTML = RP.buildReport(rangeData(), groupKey, state.dateFrom, state.dateTo);
    setTimeout(() => window.print(), 200);
  }

  /* ── Cache status text ──────────────────────────────────────────────────── */
  function updateCacheStatus() {
    const el = document.getElementById('cache-status');
    if (el) el.textContent = DS.hasCache() ? 'ข้อมูล Cache พร้อมใช้งาน (จะรีเฟรชอัตโนมัติในอีก 5 นาที)' : '';
  }

  /* ── Refresh (inline onclick) ───────────────────────────────────────────── */
  function refreshData() {
    DS.cacheClear();
    const ov = document.getElementById('load-overlay');
    if (ov) { ov.style.opacity = '1'; ov.style.transition = ''; ov.classList.remove('hidden'); }
    setProgress(0, 'กำลังเชื่อมต่อ Google Sheets...');
    init();
  }

  /* ════════════════════════════════════════════════════════════════════════
     BUILD SHELL
  ════════════════════════════════════════════════════════════════════════ */
  function buildShell() {
    const allDates = state.allMerged.map(r => r.date).filter(Boolean).sort((a, b) => a - b);
    const minD = allDates[0], maxD = allDates[allDates.length - 1];
    state.dateFrom = minD ? new Date(minD.getFullYear(), minD.getMonth(), minD.getDate()) : null;
    state.dateTo = maxD ? new Date(maxD.getFullYear(), maxD.getMonth(), maxD.getDate(), 23, 59, 59, 999) : null;

    const months = [...new Set(state.allMerged.map(r => M.monthKey(r.date)).filter(k => k !== '?'))].sort();
    const types = [...new Set(state.allMerged.map(r => r.type))].filter(Boolean).sort();

    const SVG_PRINT = `<svg viewBox="0 0 24 24"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>`;
    const SVG_CAL = `<svg style="width:12px;height:12px;stroke:currentColor;fill:none;stroke-width:2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;

    document.getElementById('app').innerHTML = `
      <div class="topbar">
        <div class="topbar-left">
          <div class="topbar-icon"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg></div>
          <div><div class="topbar-title">Machine Downtime Dashboard</div><div class="topbar-sub">Downtime · MTTR · MTBF · Machine Availability%</div></div>
        </div>
      </div>

      <div class="filter-bar">
        <span style="font-size:11px;color:var(--text-secondary);white-space:nowrap">ช่วงวันที่:</span>
        <div class="filter-chip">${SVG_CAL}<input type="date" id="date-from" value="${M.toISO(minD)}"></div>
        <span style="font-size:11px;color:var(--text-secondary)">—</span>
        <div class="filter-chip">${SVG_CAL}<input type="date" id="date-to" value="${M.toISO(maxD)}"></div>
        <div id="ov-filters" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <div class="filter-chip">${SVG_CAL}<select id="sel-mo"><option value="all">ทุกเดือน</option>${months.map(k => `<option value="${k}">${M.monthLabel(k)}</option>`).join('')}</select></div>
          <div class="filter-chip"><svg style="width:12px;height:12px;stroke:currentColor;fill:none;stroke-width:2" viewBox="0 0 24 24"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg><select id="sel-ty"><option value="all">ทุกประเภท</option>${types.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}</select></div>
        </div>
      </div>

      <div class="print-bar">
        <span class="print-bar-label">พิมพ์ Report PDF:</span>
        <button class="print-btn bw" onclick="printReport('bw')">${SVG_PRINT} Bucket Wheel Excavator</button>
        <button class="print-btn cr" onclick="printReport('cr')">${SVG_PRINT} Crusher (CR#1 + CR#2)</button>
        <button class="print-btn sys" onclick="printReport('sys')">${SVG_PRINT} System</button>
      </div>

      <div class="action-row">
        <button class="action-btn" onclick="refreshData()">
          <svg viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          รีเฟรชข้อมูล
        </button>
        <span id="cache-status" class="cache-status"></span>
      </div>

      <div class="tab-row">
        <button class="tab-btn active" id="tab-ov">ภาพรวม Downtime</button>
        <button class="tab-btn" id="tab-mt">MTTR / MTBF / MA%</button>
      </div>
      <div id="tab-content"></div>
    `;

    document.getElementById('date-from').addEventListener('change', applyDateRange);
    document.getElementById('date-to').addEventListener('change', applyDateRange);
    document.getElementById('sel-mo').addEventListener('change', () => { if (state.curTab === 'overview') renderOverview(getMo(), getTy()); });
    document.getElementById('sel-ty').addEventListener('change', () => { if (state.curTab === 'overview') renderOverview(getMo(), getTy()); });
    document.getElementById('tab-ov').addEventListener('click', () => switchTab('overview'));
    document.getElementById('tab-mt').addEventListener('click', () => switchTab('mttr'));

    renderOverview('all', 'all');
    updateCacheStatus();
  }

  /* ════════════════════════════════════════════════════════════════════════
     LOADING OVERLAY + BOOTSTRAP
  ════════════════════════════════════════════════════════════════════════ */
  function setProgress(pct, msg) {
    const bar = document.getElementById('load-bar');
    const step = document.getElementById('load-step');
    if (bar) bar.style.width = pct + '%';
    if (step && msg) step.textContent = msg;
  }
  function loadDone() {
    const ov = document.getElementById('load-overlay');
    if (ov) { ov.style.opacity = '0'; ov.style.transition = 'opacity .4s ease'; setTimeout(() => ov.classList.add('hidden'), 420); }
  }

  async function init() {
    setProgress(5, 'กำลังเชื่อมต่อ Google Sheets...');
    try {
      state.allMerged = await DS.loadAll(setProgress);
      setProgress(95, 'กำลังสร้าง Dashboard...');
      buildShell();
      setProgress(100, 'เสร็จสิ้น ✓');
      setTimeout(loadDone, 300);
    } catch (e) {
      loadDone();
      document.getElementById('app').innerHTML = `
        <div class="topbar"><div class="topbar-left"><div class="topbar-icon"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg></div><div><div class="topbar-title">Machine Downtime Dashboard</div></div></div></div>
        <div class="err"><strong>ไม่สามารถดึงข้อมูลได้:</strong> ${esc(e.message)}<br><br>กรุณาตรวจสอบว่า Google Sheet ถูกตั้งค่า <strong>"Anyone with the link can view"</strong></div>`;
    }
  }

  /* ── expose สำหรับ inline onclick ───────────────────────────────────────── */
  global.printReport = printReport;
  global.refreshData = refreshData;
  global.dtSetMachine = dtSetMachine;
  global.dtToggleType = dtToggleType;
  global.dtToggleSort = dtToggleSort;

  /* รอ DOM + library (โหลดด้วย defer) พร้อมก่อนเริ่ม */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
