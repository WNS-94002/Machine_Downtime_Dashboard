/* ============================================================================
   charts.js — จัดการวงจรชีวิตของ Chart.js (สร้าง/ทำลาย) + theme ของกราฟ
   เปิดให้เข้าถึงผ่าน global object `DashCharts`
   ----------------------------------------------------------------------------
   วิธีใช้:  DashCharts.make('bar', canvasEl, chartConfig)
            จะ destroy กราฟเดิม id เดียวกันก่อนสร้างใหม่ทุกครั้ง
   ========================================================================== */
(function (global) {
  'use strict';

  const registry = {};
  const isDark = global.matchMedia('(prefers-color-scheme: dark)').matches;
  const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)';
  const tickColor = '#888780';

  function destroy(id) {
    if (registry[id]) { registry[id].destroy(); delete registry[id]; }
  }

  function destroyMany(ids) { ids.forEach(destroy); }

  /* สร้างกราฟใหม่ (destroy id เดิมก่อน) แล้วลงทะเบียนไว้ */
  function make(id, canvasEl, config) {
    destroy(id);
    registry[id] = new Chart(canvasEl, config);
    return registry[id];
  }

  global.DashCharts = { make, destroy, destroyMany, gridColor, tickColor, isDark };
})(window);
