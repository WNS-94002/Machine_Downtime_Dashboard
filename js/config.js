/* ============================================================================
   config.js — ค่าตั้งต้นทั้งหมดของ Dashboard (แก้ที่นี่ที่เดียว)
   เปิดให้เข้าถึงผ่าน global object `DASH_CONFIG`
   ========================================================================== */
(function (global) {
  'use strict';

  /* ── Google Sheets source ───────────────────────────────────────────────── */
  const SHEET_ID = '1ygTva5iEXjhi-LKMIJAF5909xux1wmSVKCWuZbFDrZA';
  const GID_2026 = '103270503';   /* Sheet: Downtime (ปี 2026) */
  const GID_2025 = '152214943';   /* Sheet: Downtime 2025       */
  const csv = gid => `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`;

  /* ── Operational constants ──────────────────────────────────────────────── */
  const HRS = 24;                       /* ชั่วโมงฐานต่อวัน (สำหรับ Uptime/MA%) */
  const CACHE_TTL_MS = 5 * 60 * 1000;   /* อายุ cache = 5 นาที */

  /* ── การรวม "ครั้ง" (incident) ของ Downtime ──────────────────────────────
     breakdown ยาวข้ามวัน/หลายกะ ที่ Downtime ต่อเนื่องกัน (ช่วงเครื่องเดินคั่น
     ไม่เกิน BREAKDOWN_GAP_HRS ชม.) จะถูกนับเป็น "1 ครั้ง" และรวมชั่วโมงเข้าด้วยกัน
     → ทำให้ MTTR สะท้อนเหตุการณ์จริง ไม่ใช่จำนวนแถว/กะ
     ปรับค่าได้: ค่ามาก = รวม breakdown เข้าด้วยกันง่ายขึ้น (แต่เสี่ยงรวม failure
     คนละเหตุการณ์), ค่าน้อย = แยกละเอียดขึ้น */
  const BREAKDOWN_GAP_HRS = 24;

  /* ── เครื่องจักร ─────────────────────────────────────────────────────────── */
  const MACHINES = ['System', 'Spreader', 'Crusher #1', 'Crusher #2', 'Crusher #3', 'Bucket Wheel #1', 'Bucket Wheel #2'];
  const MSHORT   = ['Sys', 'SPD', 'CR1', 'CR2', 'CR3', 'BW1', 'BW2'];
  const MALIAS = {
    'system': 'System', 'spreader': 'Spreader',
    'crusher #1': 'Crusher #1', 'crusher#1': 'Crusher #1',
    'crusher #2': 'Crusher #2', 'crusher#2': 'Crusher #2',
    'crusher #3': 'Crusher #3', 'crusher#3': 'Crusher #3',
    'bucket wheel #1': 'Bucket Wheel #1', 'bucket wheel#1': 'Bucket Wheel #1',
    'bucket wheel #2': 'Bucket Wheel #2', 'bucket wheel#2': 'Bucket Wheel #2',
  };

  /* ── ประเภท Downtime ที่นับเป็น "Failure" ต่อเครื่อง (ใช้คำนวณ MTTR/MTBF) ── */
  const FAILURE_TYPES = {
    'System'         : ['OPT', 'ME', 'EE'],
    'Spreader'       : ['ME', 'EE'],
    'Crusher #1'     : ['ME', 'EE'],
    'Crusher #2'     : ['ME', 'EE'],
    'Crusher #3'     : ['ME', 'EE'],
    'Bucket Wheel #1': ['ME', 'EE'],
    'Bucket Wheel #2': ['ME', 'EE'],
  };

  /* ── กลุ่มสำหรับพิมพ์รายงาน PDF ──────────────────────────────────────────── */
  const PRINT_GROUPS = {
    bw : { label: 'Bucket Wheel Excavator', machines: ['Bucket Wheel #1', 'Bucket Wheel #2'], color: '#534ab7', failTypes: ['ME', 'EE'] },
    cr : { label: 'Crusher',                machines: ['Crusher #1', 'Crusher #2'],           color: '#a32d2d', failTypes: ['ME', 'EE'] },
    sys: { label: 'System',                 machines: ['System'],                              color: '#185fa5', failTypes: ['OPT', 'ME', 'EE'] },
  };

  /* ── ประเภท + สี ─────────────────────────────────────────────────────────── */
  const TYPE_ORDER = ['Plan', 'ME', 'EE', 'OPT', 'Uncontrol'];
  const TC = { Plan: '#185fa5', ME: '#a32d2d', EE: '#854f0b', OPT: '#0f6e56', Uncontrol: '#534ab7' };
  const MC = ['#185fa5', '#a32d2d', '#854f0b', '#0f6e56', '#534ab7', '#993c1d', '#993556'];
  const DP = [[], [8, 4], [4, 4], [2, 4], [8, 4, 2, 4], [6, 2], [4, 2, 2, 2]]; /* dash patterns ของเส้นแนวโน้ม */

  /* ── ป้ายชื่อเดือนภาษาไทย ────────────────────────────────────────────────── */
  const TH_M = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

  global.DASH_CONFIG = {
    SHEET_ID, GID_2026, GID_2025,
    CSV_2026: csv(GID_2026),
    CSV_2025: csv(GID_2025),
    HRS, CACHE_TTL_MS, BREAKDOWN_GAP_HRS,
    MACHINES, MSHORT, MALIAS,
    FAILURE_TYPES, PRINT_GROUPS,
    TYPE_ORDER, TC, MC, DP, TH_M,
  };
})(window);
