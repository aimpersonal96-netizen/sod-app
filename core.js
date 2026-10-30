(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SOD = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DAY_MS = 86400000;
  const THAI_DOW = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
  const THAI_MONTH = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  const SHORT_MONTH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const GENDER_LABEL = { M: 'ชาย', F: 'หญิง' };
  const GENDER_SHORT = { M: 'ชช', F: 'ญญ' };
  const opp = (g) => (g === 'M' ? 'F' : 'M');

  // ---------- วันที่ (ISO yyyy-mm-dd, คำนวณแบบ UTC) ----------
  const pad = (n) => String(n).padStart(2, '0');
  const parse = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  const fmt = (ms) => { const d = new Date(ms); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); };
  const addDays = (iso, n) => fmt(parse(iso) + n * DAY_MS);
  const diffDays = (a, b) => Math.round((parse(a) - parse(b)) / DAY_MS);
  const dow = (iso) => new Date(parse(iso)).getUTCDay();
  const isIso = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const monthOf = (iso) => iso.slice(0, 7);
  function range(start, end) {
    const out = [];
    if (!isIso(start) || !isIso(end) || start > end) return out;
    for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
    return out;
  }
  function monthRange(ym) {
    const [y, m] = ym.split('-').map(Number);
    return { start: ym + '-01', end: fmt(Date.UTC(y, m, 0)) };
  }
  function addMonth(ym, n) {
    const [y, m] = ym.split('-').map(Number);
    const t = y * 12 + (m - 1) + n;
    return Math.floor(t / 12) + '-' + pad((t % 12) + 1);
  }

  // ---------- ข้อมูลตั้งต้น ----------
  function defaultState() {
    return {
      version: 2,
      updatedAt: null,               // เวลาที่กดบันทึกล่าสุด (ISO) ใช้เทียบไฟล์สำรอง
      dormName: 'หอฟ้าทะลายโจร',
      staff: [
        { name: 'เก่ง', gender: 'M' }, { name: 'กาย', gender: 'M' }, { name: 'ทัย', gender: 'M' }, { name: 'เอ็ม', gender: 'M' },
        { name: 'ยา', gender: 'F' }, { name: 'ผึ้ง', gender: 'F' }, { name: 'จี', gender: 'F' }, { name: 'เมย์', gender: 'F' }
      ],
      // เวรกลางวัน: กลุ่ม 4 = 28 ต.ค. 2569 แล้วหมุน 1–6 ทุกวัน (กลุ่ม 3 ไม่มีครูหอ)
      dayGroups: {
        anchorDate: '2026-10-28', anchorGroup: 4,
        of: { กาย: 1, เก่ง: 2, ยา: 2, ผึ้ง: 2, เอ็ม: 4, เมย์: 4, ทัย: 5, จี: 6 }
      },
      firstNightDate: '2026-11-02',  // คืนแรกที่มีเวรนอน
      firstNightGender: 'F',         // คืนแรกเป็นชุดหญิง
      noDuty: [],                    // [{from,to,note}] ช่วงที่ไม่มีเวร เช่น ปิดเทอม
      unavailable: {},               // { ชื่อ: [วันที่] }
      schedule: {},                  // { วันที่เริ่มเวร: [ชื่อ, ชื่อ] }
      locked: {},                    // { วันที่: true } ตัวสร้างอัตโนมัติไม่แตะ
      payroll: {}                    // { 'yyyy-mm': ยอดการเงิน }
    };
  }

  const genderOf = (state, name) => { const s = state.staff.find((x) => x.name === name); return s ? s.gender : null; };
  function pairGender(state, names) {
    if (!names || names.length !== 2 || names[0] === names[1]) return null;
    const a = genderOf(state, names[0]), b = genderOf(state, names[1]);
    return a && a === b ? a : null;
  }
  const dayGroup = (state, date) => {
    const g = state.dayGroups;
    return (((diffDays(date, g.anchorDate) + g.anchorGroup - 1) % 6) + 6) % 6 + 1;
  };
  const dayMembers = (state, date) => state.staff.filter((s) => state.dayGroups.of[s.name] === dayGroup(state, date)).map((s) => s.name);
  const isDutyNight = (state, d) => d >= state.firstNightDate && !(state.noDuty || []).some((r) => d >= r.from && d <= r.to);

  // เหตุผลที่ครูคนหนึ่งจัดเวรคืนนี้ไม่ได้ (B4 และวันไม่ว่าง) ใช้ null ถ้าจัดได้
  function excludedReason(state, name, d, withUnavailable) {
    const grp = state.dayGroups.of[name];
    if (grp === dayGroup(state, d)) return 'เวรกลางวันกลุ่ม ' + grp + ' วันนี้';
    if (grp === dayGroup(state, addDays(d, 1))) return 'เวรกลางวันกลุ่ม ' + grp + ' เช้าวันถัดไป';
    if (withUnavailable !== false && ((state.unavailable || {})[name] || []).includes(d)) return 'แจ้งไม่ว่าง';
    return null;
  }
  const eligible = (state, d, g, withUnavailable) =>
    state.staff.filter((s) => s.gender === g && !excludedReason(state, s.name, d, withUnavailable)).map((s) => s.name);

  // ---------- ตัวตรวจกติกา B1–B4 ----------
  function validate(state, from, to) {
    const issues = [];
    const add = (rule, level, date, names, msg) => issues.push({ rule, level, date, names: names || [], msg });
    const sched = state.schedule || {};
    range(from, to).forEach((d) => {
      const names = sched[d] || [];
      const duty = isDutyNight(state, d);
      if (!names.length) { if (duty) add('P', 'warn', d, [], 'รอหัวหน้าหอ: ยังไม่มีครูเวรคืนนี้'); return; }
      if (!duty) add('P', 'warn', d, names, 'คืนนี้อยู่นอกช่วงที่มีเวร');
      names.forEach((n) => { if (!genderOf(state, n)) add('B1', 'error', d, [n], 'ชื่อ "' + n + '" ไม่อยู่ในรายชื่อครู'); });
      if (names.length !== 2) add('P', 'warn', d, names, 'มีครู ' + names.length + ' คน (ต้องการ 2 คน)');
      if (new Set(names).size !== names.length) add('B1', 'error', d, names, 'มีชื่อซ้ำในคืนเดียวกัน');
      const gs = new Set(names.map((n) => genderOf(state, n)).filter(Boolean));
      if (names.length >= 2 && gs.size > 1) add('B1', 'error', d, names, 'คู่เวรต่างเพศ (ต้องชช/ญญ)');
      const pg = pairGender(state, names), prev = sched[addDays(d, -1)];
      if (pg && prev) {
        const pp = pairGender(state, prev);
        if (pp && pp === pg) add(d.endsWith('-01') ? 'B3' : 'B2', 'error', d, names, 'คืนก่อนหน้าเป็นชุด' + GENDER_LABEL[pg] + 'เหมือนกัน ต้องสลับชุด');
      }
      names.forEach((n) => {
        const grp = state.dayGroups.of[n];
        if (grp === dayGroup(state, d)) add('B4', 'error', d, [n], 'ครู' + n + ' เวรกลางวันกลุ่ม ' + grp + ' วันนี้ ชนเวรนอน (รวม 24 ชม.)');
        if (grp === dayGroup(state, addDays(d, 1))) add('B4', 'error', d, [n], 'ครู' + n + ' เวรกลางวันกลุ่ม ' + grp + ' เช้าวันถัดไป ต่อจากเวรนอน (รวม 24 ชม.)');
        if (((state.unavailable || {})[n] || []).includes(d)) add('U', 'error', d, [n], 'ครู' + n + ' แจ้งไม่ว่างคืนนี้');
        if ((sched[addDays(d, -1)] || []).includes(n)) add('N', 'warn', d, [n], 'ครู' + n + ' ขึ้นเวรติดกัน (เมื่อคืนและคืนนี้)');
      });
    });
    return issues;
  }

  // ---------- สรุปรายเดือนและค่าตอบแทน ----------
  function monthStats(state, ym) {
    const { start, end } = monthRange(ym);
    const nightList = range(start, end).filter((d) => isDutyNight(state, d));
    const counts = {};
    state.staff.forEach((s) => { counts[s.name] = 0; });
    nightList.forEach((d) => (state.schedule[d] || []).forEach((n) => { if (n in counts) counts[n]++; }));
    const pending = nightList.filter((d) => (state.schedule[d] || []).length !== 2);
    return { ym, start, end, nights: nightList.length, nightList, counts, pending };
  }

  // N = ยอดการเงิน ÷ จำนวนคืนที่มีเวรจริงในเดือน · X = N ÷ 2 · ค่าตอบแทน = X × จำนวนเวร (ไม่ปัดเศษ)
  function payroll(state, ym) {
    const st = monthStats(state, ym);
    const raw = (state.payroll || {})[ym];
    const amount = raw === undefined || raw === '' || raw === null || isNaN(Number(raw)) ? null : Number(raw);
    const N = amount !== null && st.nights ? amount / st.nights : null;
    const X = N === null ? null : N / 2;
    const rows = state.staff.map((s) => ({ name: s.name, gender: s.gender, count: st.counts[s.name], pay: X === null ? null : X * st.counts[s.name] }));
    const total = X === null ? null : rows.reduce((a, r) => a + r.pay, 0);
    return { ym, amount, nights: st.nights, N, X, rows, total, pending: st.pending };
  }

  // ---------- ตัวสร้างตาราง ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ชุดของแต่ละคืน (B2/B3): ตรงข้ามกับคืนก่อนหน้า ถ้ายังไม่มีเลยใช้ firstNightGender
  function planGenders(state, nights) {
    const out = {};
    if (!nights.length) return out;
    const keys = Object.keys(state.schedule).filter((k) => (state.schedule[k] || []).length).sort();
    let prev = null;
    for (let i = keys.length - 1; i >= 0; i--) {
      if (keys[i] >= nights[0]) continue;
      const g = pairGender(state, state.schedule[keys[i]]);
      if (g) { prev = g; break; }
    }
    nights.forEach((d) => {
      const names = state.schedule[d];
      let g = names && names.length ? pairGender(state, names) : null;
      if (!g) g = prev ? opp(prev) : state.firstNightGender;
      out[d] = g; prev = g;
    });
    return out;
  }

  function generate(state, ym, opts) {
    opts = opts || {};
    const { start, end } = monthRange(ym);
    const nights = range(start, end).filter((d) => isDutyNight(state, d));
    const sched = Object.assign({}, state.schedule);
    nights.forEach((d) => { if (!state.locked[d]) delete sched[d]; });
    const tmp = Object.assign({}, state, { schedule: sched });
    const gender = planGenders(tmp, nights);
    const free = nights.filter((d) => !(sched[d] && sched[d].length));
    const pool = {}, pending = [], work = [];
    free.forEach((d) => {
      pool[d] = eligible(tmp, d, gender[d]);
      if (pool[d].length < 2) pending.push(d); else work.push(d);
    });

    const rng = mulberry32((opts.seed || 1) * 7919 + 13);
    const pairsOf = {};
    work.forEach((d) => {
      const p = pool[d], list = [];
      for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) list.push([p[i], p[j]]);
      if (opts.seed) list.sort(() => rng() - 0.5);
      pairsOf[d] = list;
    });

    const names = state.staff.map((s) => s.name);
    const cnt = {}; names.forEach((n) => { cnt[n] = 0; });
    nights.forEach((d) => { if (sched[d] && sched[d].length && !free.includes(d)) sched[d].forEach((n) => { if (n in cnt) cnt[n]++; }); });
    const size = { M: state.staff.filter((s) => s.gender === 'M').length, F: state.staff.filter((s) => s.gender === 'F').length };
    const slots = { M: 0, F: 0 };
    nights.forEach((d) => { if (!pending.includes(d)) slots[gender[d]] += 2; });
    const remain = work.map((d, i) => ({ M: work.slice(i).filter((x) => gender[x] === 'M').length, F: work.slice(i).filter((x) => gender[x] === 'F').length }));
    remain.push({ M: 0, F: 0 });

    const lastGap = (cur, n, d) => { for (let k = 1; k <= 12; k++) if ((cur[addDays(d, -k)] || []).includes(n)) return k; return 13; };
    const key = (cur, a, b, d) => {
      const neighbor = [-1, 1].some((k) => (cur[addDays(d, k)] || []).some((x) => x === a || x === b)) ? 1000 : 0;
      return (cnt[a] + cnt[b]) * 10 + neighbor - Math.min(lastGap(cur, a, d), lastGap(cur, b, d));
    };

    function solve(tol) {
      const cur = Object.assign({}, sched);
      const cap = {}, floor = {};
      ['M', 'F'].forEach((g) => { cap[g] = Math.ceil(slots[g] / size[g]) + tol; floor[g] = Math.max(0, Math.floor(slots[g] / size[g]) - tol); });
      let nodes = 0, aborted = false;
      const base = Object.assign({}, cnt);
      function rec(i) {
        if (aborted) return false;
        for (const s of state.staff) if (floor[s.gender] - cnt[s.name] > remain[i][s.gender]) return false;
        if (i === work.length) return true;
        if (++nodes > 150000) { aborted = true; return false; }
        const d = work[i], g = gender[d];
        const order = pairsOf[d].filter(([a, b]) => cnt[a] < cap[g] && cnt[b] < cap[g])
          .map((p) => ({ p, k: key(cur, p[0], p[1], d) })).sort((x, y) => x.k - y.k);
        for (const { p } of order) {
          cur[d] = p; cnt[p[0]]++; cnt[p[1]]++;
          if (rec(i + 1)) return true;
          cnt[p[0]]--; cnt[p[1]]--; delete cur[d];
        }
        return false;
      }
      const ok = rec(0);
      if (!ok) names.forEach((n) => { cnt[n] = base[n]; });
      return ok ? cur : null;
    }

    let result = null, tolUsed = null;
    if (work.length) {
      for (let tol = 0; tol <= 3 && !result; tol++) { result = solve(tol); tolUsed = tol; }
      if (!result) {
        // สำรอง: เลือกคู่ที่เหมาะที่สุดทีละคืน ไม่บังคับความสมดุล
        tolUsed = null; result = Object.assign({}, sched);
        names.forEach((n) => { cnt[n] = 0; });
        nights.forEach((d) => { if (result[d] && !free.includes(d)) result[d].forEach((n) => { cnt[n]++; }); });
        work.forEach((d) => {
          const best = pairsOf[d].map((p) => ({ p, k: key(result, p[0], p[1], d) })).sort((x, y) => x.k - y.k)[0];
          result[d] = best.p; cnt[best.p[0]]++; cnt[best.p[1]]++;
        });
      }
    } else result = sched;
    return { schedule: result, pending, gender, balanced: tolUsed === 0 || tolUsed === 1 };
  }

  // ---------- คำเตือนช่วงเสี่ยง (ใช้ตอนกรอกวันไม่ว่าง) ----------
  function capacityWarnings(state, ym) {
    const { start, end } = monthRange(ym);
    const nights = range(start, end).filter((d) => isDutyNight(state, d));
    const gender = planGenders(state, nights);
    const out = [];
    nights.forEach((d) => {
      const g = gender[d];
      const now = eligible(state, d, g, true), base = eligible(state, d, g, false);
      const lost = base.filter((n) => !now.includes(n));
      if (!lost.length) return;
      if (now.length < 2) out.push({ date: d, level: 'error', gender: g, eligible: now, lost, msg: 'ชุด' + GENDER_LABEL[g] + 'เหลือ ' + now.length + ' คน จัดเวรคืนนี้ไม่ได้ (ไม่ว่าง: ' + lost.join(', ') + ') หัวหน้าหอต้องพิจารณา' });
      else if (now.length === 2 && base.length > 2) out.push({ date: d, level: 'warn', gender: g, eligible: now, lost, msg: 'ชุด' + GENDER_LABEL[g] + 'เหลือคู่เดียว (' + now.join('/') + ') เพราะ ' + lost.join(', ') + ' ไม่ว่าง' });
    });
    return out;
  }

  function explainNight(state, d) {
    const g = planGenders(state, [d])[d];
    return { gender: g, eligible: eligible(state, d, g),
      excluded: state.staff.filter((s) => s.gender === g).map((s) => ({ name: s.name, reason: excludedReason(state, s.name, d) })).filter((x) => x.reason) };
  }

  // ---------- สลับครู ----------
  function swapTeachers(state, a, b) {
    if (a.date === b.date) return { ok: false, error: 'ต้องเลือกคนละคืน' };
    const sa = (state.schedule[a.date] || []).slice(), sb = (state.schedule[b.date] || []).slice();
    const ia = sa.indexOf(a.name), ib = sb.indexOf(b.name);
    if (ia < 0 || ib < 0) return { ok: false, error: 'ไม่พบครูในคืนที่เลือก' };
    if (sb.includes(a.name) || sa.includes(b.name)) return { ok: false, error: 'ครูคนนั้นอยู่เวรคืนนั้นอยู่แล้ว' };
    sa[ia] = b.name; sb[ib] = a.name;
    return { ok: true, schedule: Object.assign({}, state.schedule, { [a.date]: sa, [b.date]: sb }) };
  }


  // ---------- สำรองข้อมูล / ประวัติเวอร์ชัน (ฟังก์ชันล้วน ทดสอบได้) ----------
  function summarizeState(st) {
    const per = {};
    Object.keys(st.schedule || {}).forEach((d) => { if ((st.schedule[d] || []).length) per[d.slice(0, 7)] = (per[d.slice(0, 7)] || 0) + 1; });
    const months = Object.keys(per).sort().map((ym) => ({ ym, nights: per[ym] }));
    return { months, nights: months.reduce((a, m) => a + m.nights, 0), updatedAt: st.updatedAt || null,
      payrollMonths: Object.keys(st.payroll || {}).sort() };
  }
  // ชื่อไฟล์สำรอง: sod-backup-ปีค.ศ.-เดือน-วัน-ชั่วโมงนาที.json (เวลาท้องถิ่นของเครื่อง)
  // ใช้ตัวอักษร ASCII ล้วน เพราะเบราว์เซอร์บางตัวทำชื่อไฟล์ภาษาไทยหายเป็น "download" (พบใน Chromium)
  function backupFileName(d) {
    return 'sod-backup-' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + '.json';
  }
  // เทียบไฟล์สำรองกับข้อมูลบนเครื่อง: older = ไฟล์เก่ากว่า (ระวังทับของใหม่)
  function compareBackup(fileObj, current) {
    const fileTime = (fileObj && (fileObj.updatedAt || fileObj.exportedAt)) || null;
    const curTime = (current && current.updatedAt) || null;
    let relation = 'unknown';
    if (fileTime && curTime) relation = fileTime < curTime ? 'older' : fileTime > curTime ? 'newer' : 'same';
    return { fileTime, curTime, relation };
  }
  function hashString(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return String(h >>> 0);
  }
  // ประวัติเวอร์ชัน: เก็บล่าสุด max รายการ (ใหม่สุดอยู่หน้า)
  function pushHistory(list, entry, max) {
    return [entry].concat(list || []).slice(0, max || 10);
  }

  // ---------- ซิงก์กับ GitHub (Contents API) ----------
  // ฟังก์ชันรับ fetch เข้ามาเป็นพารามิเตอร์ เพื่อทดสอบด้วยตัวจำลองได้ ไม่มีโค้ดส่วนไหนอ่านหรือเก็บ token ไว้เอง
  function b64encodeUtf8(str) {
    if (typeof Buffer !== 'undefined') return Buffer.from(str, 'utf8').toString('base64');
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function b64decodeUtf8(b64) {
    const clean = String(b64).replace(/\s/g, '');
    if (typeof Buffer !== 'undefined') return Buffer.from(clean, 'base64').toString('utf8');
    return new TextDecoder().decode(Uint8Array.from(atob(clean), (c) => c.charCodeAt(0)));
  }
  class GhError extends Error {
    constructor(kind, status, message) { super(message); this.kind = kind; this.status = status; }
  }
  function ghValidate(cfg) {
    if (!cfg || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(cfg.repo || '')) return 'ชื่อ repo ต้องอยู่ในรูป เจ้าของ/ชื่อ-repo';
    if (!cfg.path || /^\/|\.\.|\/\/|\s/.test(cfg.path)) return 'ที่อยู่ไฟล์ไม่ถูกต้อง (เช่น data/latest.json)';
    if (!cfg.token) return 'ยังไม่ได้ใส่ token';
    return null;
  }
  const ghRepoUrl = (cfg) => 'https://api.github.com/repos/' + cfg.repo;
  const ghFileUrl = (cfg) => ghRepoUrl(cfg) + '/contents/' + cfg.path.split('/').map(encodeURIComponent).join('/');
  function ghHeaders(cfg, json) {
    const h = { Authorization: 'Bearer ' + cfg.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }
  function ghHttpError(status) {
    if (status === 401) return new GhError('auth', status, 'token ไม่ถูกต้องหรือหมดอายุ (สร้างใหม่ที่ GitHub)');
    if (status === 403) return new GhError('forbidden', status, 'ไม่มีสิทธิ์ หรือเรียกถี่เกินโควตาของ GitHub (ลองใหม่ภายหลัง)');
    if (status === 404) return new GhError('notfound', status, 'ไม่พบ repo หรือ token ไม่มีสิทธิ์กับ repo นี้');
    if (status === 409 || status === 422) return new GhError('conflict', status, 'ข้อมูลบน GitHub เปลี่ยนไประหว่างส่ง (ลองใหม่)');
    return new GhError('http', status, 'GitHub ตอบกลับผิดปกติ (รหัส ' + status + ')');
  }
  async function ghFetch(f, url, init) {
    try { return await f(url, init); } catch (e) { throw new GhError('network', 0, 'ติดต่อ GitHub ไม่ได้ (ตรวจอินเทอร์เน็ต)'); }
  }
  // อ่านไฟล์: {status:'ok', sha, text, obj} | {status:'missing'} หรือ throw GhError
  async function ghGet(cfg, f) {
    const bad = ghValidate(cfg);
    if (bad) throw new GhError('config', 0, bad);
    const res = await ghFetch(f, ghFileUrl(cfg), { headers: ghHeaders(cfg), cache: 'no-store' });
    if (res.status === 404) {
      // 404 แปลว่า "ไม่มีไฟล์" หรือ "เข้า repo ไม่ได้" ตรวจ repo เพื่อแยกสองกรณี
      const repo = await ghFetch(f, ghRepoUrl(cfg), { headers: ghHeaders(cfg), cache: 'no-store' });
      if (repo.status === 200) return { status: 'missing' };
      throw ghHttpError(repo.status === 404 ? 404 : repo.status);
    }
    if (res.status !== 200) throw ghHttpError(res.status);
    const json = await res.json();
    if (Array.isArray(json) || json.type === 'dir' || !json.content) throw new GhError('format', 200, 'ที่อยู่ไฟล์นี้ไม่ใช่ไฟล์ข้อมูล (หรือไฟล์ใหญ่เกินไป)');
    const text = b64decodeUtf8(json.content);
    let obj;
    try { obj = JSON.parse(text); } catch (e) { throw new GhError('format', 200, 'ไฟล์บน GitHub ไม่ใช่ข้อมูลของระบบนี้ (อ่านเป็น JSON ไม่ได้)'); }
    return { status: 'ok', sha: json.sha, text, obj };
  }
  // เขียนไฟล์ (สร้างใหม่เมื่อไม่ส่ง sha, อัปเดตเมื่อส่ง sha ของไฟล์เดิม) คืน {sha}
  async function ghPut(cfg, f, text, message, sha) {
    const bad = ghValidate(cfg);
    if (bad) throw new GhError('config', 0, bad);
    const body = { message, content: b64encodeUtf8(text) };
    if (sha) body.sha = sha;
    const res = await ghFetch(f, ghFileUrl(cfg), { method: 'PUT', headers: ghHeaders(cfg, true), body: JSON.stringify(body) });
    if (res.status !== 200 && res.status !== 201) throw ghHttpError(res.status);
    const json = await res.json();
    return { sha: json.content && json.content.sha };
  }

  return { THAI_DOW, THAI_MONTH, SHORT_MONTH, GENDER_LABEL, GENDER_SHORT,
    parse, fmt, addDays, diffDays, dow, range, isIso, monthOf, monthRange, addMonth,
    defaultState, genderOf, pairGender, dayGroup, dayMembers, isDutyNight, excludedReason, eligible,
    validate, monthStats, payroll, planGenders, generate, capacityWarnings, explainNight, swapTeachers,
    summarizeState, backupFileName, compareBackup, hashString, pushHistory,
    b64encodeUtf8, b64decodeUtf8, GhError, ghValidate, ghGet, ghPut };
});
