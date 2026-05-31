# Machine Downtime Dashboard

Dashboard วิเคราะห์ **Downtime เครื่องจักร** พร้อมตัวชี้วัด **MTTR · MTBF · Machine Availability (MA%)**
และระบบพิมพ์ **รายงาน PDF รายเครื่องจักร (A4, 1 เครื่อง = 1 หน้า)**
ดึงข้อมูลสดจาก Google Sheets (2 ปี: 2025 + 2026) แสดงผลด้วย Chart.js

---

## โครงสร้างโปรเจกต์

```
Machine_Downtime_Dashboard/
├── index.html          # โครงหน้า + loading overlay + โหลด library/โมดูล
├── css/
│   └── styles.css      # ธีม (design tokens) + สไตล์จอ + สไตล์พิมพ์ A4  รองรับ light/dark
├── js/
│   ├── config.js       # ค่าตั้งต้นทั้งหมด: Sheet ID/GID, เครื่องจักร, ประเภท, สี  ← แก้ที่นี่
│   ├── dataService.js  # โหลด CSV + parse + merge แถวต่อเนื่อง + cache (localStorage)
│   ├── metrics.js      # date helpers, filter, คำนวณ MTTR/MTBF/MA%
│   ├── charts.js       # จัดการวงจรชีวิต Chart.js (สร้าง/ทำลาย) + theme กราฟ
│   ├── report.js       # สร้าง HTML รายงาน PDF รายเครื่อง
│   └── app.js          # ควบคุมหลัก: state, render, filter, tab, print, bootstrap
└── README.md
```

แต่ละโมดูลสื่อสารผ่าน global object: `DASH_CONFIG`, `DataService`, `Metrics`, `DashCharts`, `DashReport`

---

## วิธีใช้งาน

เปิด `index.html` ผ่าน **local server** (จำเป็น เพราะ `fetch` Google Sheets ไม่ทำงานเมื่อเปิดแบบ `file://`):

```bash
# ในโฟลเดอร์ Machine_Downtime_Dashboard/
python -m http.server 8000
# เปิด http://localhost:8000
```

> ต้องเชื่อมต่ออินเทอร์เน็ต (โหลด Chart.js / PapaParse จาก CDN + ดึงข้อมูล Google Sheets)

### ฟีเจอร์
- **2 แท็บ:** ภาพรวม Downtime / MTTR · MTBF · MA%
- **ตัวกรอง:** ช่วงวันที่, เดือน, ประเภท
- **ตารางรายละเอียด:** กรองตามเครื่อง/ประเภท + เรียงตามวันที่หรือชั่วโมง
- **รายงาน PDF:** ปุ่มพิมพ์แยกกลุ่ม (Bucket Wheel / Crusher / System) — ใช้ Ctrl+P → Save as PDF
- **Cache 5 นาที:** โหลดซ้ำเร็วขึ้น (ปุ่ม "รีเฟรชข้อมูล" ล้าง cache แล้วโหลดใหม่)

---

## การตั้งค่า (`js/config.js`)

| ค่า | ความหมาย |
|-----|----------|
| `SHEET_ID`, `GID_2026`, `GID_2025` | ระบุชีต Google Sheets ต้นทาง |
| `HRS` | ชั่วโมงฐานต่อวัน (= 24) ใช้คำนวณ Uptime / MA% |
| `CACHE_TTL_MS` | อายุ cache (= 5 นาที) |
| `MACHINES`, `MSHORT`, `MALIAS` | เครื่องจักร, ชื่อย่อ, การจับคู่ชื่อจาก `Location` |
| `FAILURE_TYPES` | ประเภทที่นับเป็น Failure ต่อเครื่อง (ใช้คำนวณ MTTR/MTBF) |
| `PRINT_GROUPS` | กลุ่มเครื่องสำหรับพิมพ์รายงาน PDF |
| `TYPE_ORDER`, `TC`, `MC`, `DP` | ลำดับประเภท, สีประเภท, สีเครื่อง, รูปแบบเส้นประ |

---

## นิยามตัวชี้วัด (Base = 24 ชม./วัน)

```
MTTR = Failure Downtime ÷ จำนวนครั้ง Failure
MTBF = Uptime ÷ จำนวนครั้ง Failure
MA%  = MTBF ÷ (MTBF + MTTR) × 100
```

- **Failure DT** ถูก cap ที่ 24 ชม./วัน
- **Uptime** = (จำนวนวันทั้งหมดในช่วง × 24) − Failure DT
- เกณฑ์สี: MA% ≥95 เขียว / ≥80 เหลือง / ต่ำกว่านั้นแดง

### การจัดการ Breakdown ยาวข้ามวัน

Downtime ที่บันทึกเป็นกะ/แถวต่อเนื่องข้ามวัน (เช่น breakdown ใหญ่ลากหลายวัน) จะถูก:
1. **กระจายชั่วโมงลงวันจริงที่เกิด** (ตาม `Start`/`Finish`) — ไม่กองที่วันเริ่มวันเดียว
   → วันที่เครื่องดับทั้งวันจะได้ Failure DT = 24 ชม. และ **Uptime = 0** อย่างถูกต้อง
2. **นับเป็น 1 "ครั้ง" (incident)** เมื่อ Downtime ต่อเนื่องกันไม่ขาดช่วง (ช่องว่าง ≤ 1 นาที)
   → MTTR/MTBF สะท้อนจำนวนเหตุการณ์จริง ไม่ใช่จำนวนแถว/กะ

ในตารางรายวัน วันที่เป็น "วันกลาง" ของ breakdown ที่ลากต่อมา (ไม่มีเหตุการณ์ใหม่เริ่ม)
จะแสดงสัญลักษณ์ `↳` ในคอลัมน์จำนวนครั้ง และ MA% = 0%

---

## โครงข้อมูลที่ชีตต้องมี

| คอลัมน์ | ใช้ทำอะไร | จำเป็น |
|---------|-----------|--------|
| `Date` | วันที่ `DD/MM/YYYY` | ✔ |
| `Location` | ชื่อเครื่อง (ต้อง map ได้ใน `MALIAS`) | ✔ |
| `SMU` | ชั่วโมง Downtime (> 0) | ✔ |
| `Type` | ประเภท (Plan / ME / EE / OPT / Uncontrol) | ✔ |
| `Start`, `Finish` | เวลา `H:MM` (ใช้รวมแถวต่อเนื่อง + ข้ามเที่ยงคืน) | – |
| `Detail` | รายละเอียด | – |

> แถวที่ map เครื่องไม่ได้ หรือ `SMU` ไม่ใช่ตัวเลขบวก จะถูกข้ามอัตโนมัติ
> **สำคัญ:** ตั้งค่าแชร์ชีตเป็น *"Anyone with the link can view"*

---

## หมายเหตุการพัฒนา

Refactor จากไฟล์ single-file เดิม (`index.html` ~1,170 บรรทัด) เป็นโครงสร้างโมดูล พร้อม:
- **แก้บั๊ก** ใน `calcMTTRMTBF` (เดิมอ้างตัวแปร `failRows` / `tAllDays` ที่ไม่มีในขอบเขต → ทำให้แท็บ MTTR และการพิมพ์ PDF พังเมื่อมีข้อมูล Failure) ตอนนี้คำนวณสรุปรายเครื่องถูกต้องและสอดคล้องกับ MA% รวมกลุ่ม
- เพิ่มการ **escape ข้อความ** จากชีตก่อน inject ลง HTML (กัน markup เพี้ยน/XSS)
- ธีมรองรับ dark mode อัตโนมัติตาม `prefers-color-scheme`
