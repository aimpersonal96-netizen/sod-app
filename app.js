(function () {
  'use strict';
  const S = window.SOD;
  const KEY_SAVED = 'sod-v2-saved', KEY_DRAFT = 'sod-v2-draft';

  // ---------- สถานะ: แก้ไขได้ทันที แต่ต้องกด "บันทึก" จึงเป็นฉบับที่บันทึก ----------
  function normalize(obj) {
    const base = S.defaultState();
    const st = Object.assign(base, obj || {});
    st.dayGroups = Object.assign({}, base.dayGroups, (obj || {}).dayGroups);
    st.dayGroups.of = Object.assign({}, base.dayGroups.of, ((obj || {}).dayGroups || {}).of);
    ['unavailable', 'schedule', 'locked', 'payroll'].forEach((k) => { st[k] = st[k] || {}; });
    st.noDuty = st.noDuty || [];
    return st;
  }
  const read = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const write = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ไม่เป็นไร */ } };
  let savedJson, state;
  (function init() {
    let saved = null, draft = null;
    try { if (read(KEY_SAVED)) saved = normalize(JSON.parse(read(KEY_SAVED))); } catch (e) { saved = null; }
    try { if (read(KEY_DRAFT)) draft = normalize(JSON.parse(read(KEY_DRAFT))); } catch (e) { draft = null; }
    savedJson = JSON.stringify(saved || S.defaultState());
    state = draft || saved || S.defaultState();
  })();
  const isDirty = () => JSON.stringify(state) !== savedJson;
  function commit() { write(KEY_DRAFT, JSON.stringify(state)); render(); }

  // เมตาของเครื่องนี้ (ไม่อยู่ในไฟล์สำรอง): เวลาและลายนิ้วมือของการสำรองล่าสุด
  const KEY_META = 'sod-v2-meta', KEY_HISTORY = 'sod-v2-history';
  let meta = {};
  try { meta = JSON.parse(read(KEY_META) || '{}') || {}; } catch (e) { meta = {}; }
  const saveMeta = () => write(KEY_META, JSON.stringify(meta));
  const loadHistory = () => { try { return JSON.parse(read(KEY_HISTORY) || '[]') || []; } catch (e) { return []; } };
  // ประวัติเวอร์ชัน: เก็บ 10 รายการล่าสุด ถ้าพื้นที่เต็มให้ทิ้งรายการเก่าสุดแล้วลองใหม่
  function addHistory(label, st) {
    let list = S.pushHistory(loadHistory(), { at: new Date().toISOString(), label, json: JSON.stringify(st) }, 10);
    for (let i = 0; i < 6; i++) {
      try { localStorage.setItem(KEY_HISTORY, JSON.stringify(list)); return; } catch (e) { list = list.slice(0, Math.max(1, list.length - 1)); }
    }
  }
  const hasData = () => Object.keys(state.schedule).some((d) => (state.schedule[d] || []).length);
  const unbacked = () => hasData() && S.hashString(JSON.stringify(state)) !== meta.lastBackupHash;
  let pendingImport = null;

  // ซิงก์ GitHub: ปิดไว้เป็นค่าเริ่มต้น token เก็บเฉพาะที่นี่ (ไม่อยู่ใน state ไฟล์สำรอง หรือประวัติเวอร์ชัน)
  const KEY_SYNC = 'sod-v2-sync';
  const defaultLabel = () => (/iPhone|iPad/.test(navigator.userAgent) ? 'iPhone' : /Mac/.test(navigator.userAgent) ? 'Mac' : 'เครื่องนี้');
  let sync = { enabled: false, repo: 'aimpersonal96-netizen/Duty_roster-SSod-', path: 'data/latest.json', token: '', label: '', lastSyncAt: null, lastRemoteSha: null, pendingPush: false };
  try { sync = Object.assign(sync, JSON.parse(read(KEY_SYNC) || '{}')); } catch (e) { /* ใช้ค่าเริ่มต้น */ }
  const saveSync = () => write(KEY_SYNC, JSON.stringify(sync));
  const syncCfg = () => ({ repo: sync.repo, path: sync.path, token: sync.token });
  const syncReady = () => sync.enabled && !S.ghValidate(syncCfg());
  const syncInfo = { busy: false, remote: null, error: null };

  const today = new Date().toISOString().slice(0, 10);
  const view = { tab: 'schedule', ym: S.monthOf(today) < S.monthOf(state.firstNightDate) ? S.monthOf(state.firstNightDate) : S.monthOf(today), seed: 0 };

  // ---------- ตัวช่วย ----------
  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const be = (iso) => { const [y, m, d] = iso.split('-').map(Number); return d + ' ' + S.SHORT_MONTH[m - 1] + ' ' + (y + 543); };
  const ymLabel = (ym) => { const [y, m] = ym.split('-').map(Number); return S.THAI_MONTH[m - 1] + ' ' + (y + 543); };
  const money = (n) => (n === null || n === undefined ? '–' : n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const p2 = (n) => String(n).padStart(2, '0');
  const dt = (iso) => { if (!iso) return '–'; const d = new Date(iso); return d.getDate() + ' ' + S.SHORT_MONTH[d.getMonth()] + ' ' + (d.getFullYear() + 543) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()); };
  const names = () => state.staff.map((s) => s.name);
  // สีประจำตัวครู (พาเลตภาพ 4): ชาย = โทนเย็น (ฟ้า/ฟ้าอมเขียว/คราม) · หญิง = โทนชมพูหวาน
  const PALETTE = { M: ['#43A5F4', '#27C7DA', '#5C6AC1', '#26A69A'], F: ['#F48FB1', '#ED417A', '#CE92D9', '#EF9A9A'] };
  const color = (name) => {
    const s = state.staff.find((x) => x.name === name);
    if (!s) return '#B2B3B2';
    const idx = state.staff.filter((x) => x.gender === s.gender).findIndex((x) => x.name === name);
    return PALETTE[s.gender][idx % PALETTE[s.gender].length];
  };
  const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const textOn = (hex) => { const l = lum(hex); return (1.05) / (l + 0.05) >= (l + 0.05) / (lum('#1B2250') + 0.05) ? '#ffffff' : '#1B2250'; };
  const chipStyle = (name) => 'background:' + color(name) + ';color:' + textOn(color(name));
  const gtag = (g) => '<span class="gt gt-' + g + '">' + S.GENDER_SHORT[g] + '</span>';
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 3200); }
  function download(filename, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const csv = (rows) => '﻿' + rows.map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\r\n');
  const monthRange = () => S.monthRange(view.ym);

  // ---------- เรนเดอร์ ----------
  const TABS = [['schedule', 'ตารางเวร'], ['summary', 'สรุป/ค่าตอบแทน'], ['people', 'ครู/วันไม่ว่าง'], ['settings', 'ตั้งค่า']];
  function render() {
    $('#tabs').innerHTML = TABS.map(([id, label]) => '<button class="tab" role="tab" data-action="tab" data-tab="' + id + '" aria-selected="' + (view.tab === id) + '">' + label + '</button>').join('');
    const body = { schedule: renderSchedule, summary: renderSummary, people: renderPeople, settings: renderSettings }[view.tab]();
    $('#app').innerHTML = (view.tab === 'settings' ? '' : monthBar()) + saveBar() + body;
  }

  function monthBar() {
    return '<div class="bar noprint"><div class="month"><button class="btn" data-action="month" data-n="-1" aria-label="เดือนก่อน">‹</button><span>' + ymLabel(view.ym) +
      '</span><button class="btn" data-action="month" data-n="1" aria-label="เดือนถัดไป">›</button></div></div>';
  }
  function saveBar() {
    const dirty = isDirty(), stale = unbacked();
    const banner = dirty ? '<div class="banner warn noprint"><strong class="dirty">มีการแก้ไขที่ยังไม่ได้บันทึก</strong>' +
      '<button class="btn primary" data-action="save">บันทึก</button><button class="btn" data-action="discard">ยกเลิกการแก้ไข</button></div>' : '';
    const backupTxt = meta.lastBackupAt ? 'สำรองล่าสุด ' + dt(meta.lastBackupAt) : 'ยังไม่เคยสำรองข้อมูล';
    return banner + '<div class="statusline noprint">' + (dirty ? '' : '<span class="saved">✓ บันทึกแล้ว' + (state.updatedAt ? ' ' + dt(state.updatedAt) : '') + '</span>') +
      '<span class="' + (stale ? 'dirty' : 'muted') + '">' + (stale ? '⚠ ' : '') + backupTxt + (stale ? ' — มีการเปลี่ยนแปลงหลังจากนั้น' : '') + '</span>' +
      (stale ? '<button class="btn" data-action="export-json">สำรองข้อมูลตอนนี้</button>' : '') + syncLine() + '</div>';
  }

  function issuesByDate(issues) {
    const by = {};
    issues.forEach((i) => {
      if (!i.date) return;
      const b = by[i.date] || (by[i.date] = { level: 'warn', msgs: [] });
      if (i.level === 'error') b.level = 'error';
      b.msgs.push(i.rule + ': ' + i.msg);
    });
    return by;
  }

  function renderSchedule() {
    const { start, end } = monthRange();
    const issues = S.validate(state, start, end);
    const by = issuesByDate(issues);
    const errN = issues.filter((i) => i.level === 'error').length;
    const pendN = issues.filter((i) => i.rule === 'P' && i.level === 'warn' && !(state.schedule[i.date] || []).length).length;
    const risk = S.capacityWarnings(state, view.ym);
    const nights = S.range(start, end);
    const genders = S.planGenders(state, nights.filter((d) => S.isDutyNight(state, d)));

    const firstDuty = nights.find((d) => S.isDutyNight(state, d));
    let note = '';
    if (firstDuty) {
      const prev = S.addDays(firstDuty, -1);
      if (S.isDutyNight(state, prev) && !(state.schedule[prev] || []).length) note = '<p class="muted" style="margin:6px 0 0">⚠ ยังไม่มีตารางเวรของคืนก่อนหน้า (' + be(prev) + ') คืนแรกของเดือนนี้จึงใช้ชุดตามค่าตั้งต้น ควรจัดเดือนก่อนหน้าก่อน เพื่อให้ต่อรอยต่อเดือนถูกต้อง</p>';
    }

    let cells = S.THAI_DOW.map((n, i) => '<div class="dow' + (i === 0 || i === 6 ? ' we' : '') + '">' + n + '</div>').join('');
    for (let i = 0; i < S.dow(start); i++) cells += '<div class="cell blank"></div>';
    nights.forEach((d) => {
      const w = S.dow(d), cls = w === 6 ? ' sat' : w === 0 ? ' sun' : '';
      const head = '<span class="dn"><span class="num">' + Number(d.slice(8)) + '<span class="wk">' + S.THAI_DOW[w] + '</span></span><span class="meta"><span class="dg">กลุ่ม ' + S.dayGroup(state, d) + '</span>' + (state.locked[d] ? ' 🔒' : '') + '</span></span>';
      if (!S.isDutyNight(state, d)) { cells += '<div class="cell off' + cls + '">' + head + '<span class="body"><span class="muted">ไม่มีเวร</span></span></div>'; return; }
      const ns = state.schedule[d] || [];
      const g = ns.length ? (S.pairGender(state, ns) || genders[d]) : genders[d];
      const b = by[d];
      const flag = b ? (b.level === 'error' ? ' has-err' : ' has-warn') : '';
      const inner = ns.length ? '<span class="chips">' + ns.map((n) => '<span class="chip" style="' + chipStyle(n) + '">' + esc(n) + '</span>').join('') + '</span>' : '<span class="pend">รอหัวหน้าหอ</span>';
      cells += '<button class="cell' + cls + flag + '" data-action="edit" data-date="' + d + '"' + (b ? ' title="' + esc(b.msgs.join('\n')) + '"' : '') + '>' + head + '<span class="body">' + gtag(g) + inner + '</span></button>';
    });

    const riskHtml = risk.length ? '<div class="card"><h2>ช่วงเสี่ยง (ครูไม่ว่างทำให้ชุดเหลือน้อย)</h2><ul class="issues">' +
      risk.map((r) => '<li class="' + (r.level === 'error' ? 'error' : 'warn') + '" data-action="edit" data-date="' + r.date + '" tabindex="0"><span class="rule">' + (r.level === 'error' ? '✖' : '⚠') + '</span><span><strong>' + be(r.date) + '</strong> · ' + esc(r.msg) + '</span></li>').join('') + '</ul></div>' : '';
    const list = issues.filter((i) => i.level !== 'info');
    const issuesHtml = list.length ? '<div class="card"><h2>รายการที่ต้องดู (' + list.length + ')</h2><ul class="issues">' +
      list.map((i) => '<li class="' + i.level + '" data-action="edit" data-date="' + i.date + '" tabindex="0"><span class="rule">' + i.rule + '</span><span><strong>' + be(i.date) + '</strong> · ' + esc(i.msg) + '</span></li>').join('') + '</ul></div>' : '';

    const total = nights.filter((d) => S.isDutyNight(state, d)).length;
    const banner = !total ? '<div class="banner"><strong>เดือนนี้ไม่มีคืนที่มีเวร</strong><span class="muted">ตรวจ "วันเริ่มเวรแรก" และ "ช่วงงดเวร" ในแท็บตั้งค่า</span></div>'
      : errN ? '<div class="banner err"><strong>ผิดเงื่อนไข ' + errN + ' รายการ</strong>' + (pendN ? '<span>รอหัวหน้าหอ ' + pendN + ' คืน</span>' : '') + '</div>'
      : pendN ? '<div class="banner warn"><strong>รอหัวหน้าหอ ' + pendN + ' คืน</strong><span class="muted">ยังไม่มีครูเวร กดวันที่เพื่อจัดเอง</span></div>'
      : '<div class="banner ok"><strong>ผ่านเงื่อนไขพื้นฐานครบ</strong><span class="muted">คู่เพศเดียวกัน · สลับชุด · ไม่ชนเวรกลางวัน</span></div>';

    return '<div class="card noprint"><div class="row">' +
      '<button class="btn primary" data-action="generate">สร้างตารางเดือนนี้</button>' +
      '<button class="btn" data-action="swap-open">⇄ สลับครู</button>' +
      '<button class="btn" data-action="clear">ล้างที่ไม่ล็อก</button>' +
      '<button class="btn" data-action="print">พิมพ์ / PDF</button>' +
      '<button class="btn" data-action="export-csv">ส่งออก CSV</button></div>' +
      '<p class="muted" style="margin:8px 0 0">แตะที่วันเพื่อแก้ไขหรือล็อกคืน · ตัวสร้างอัตโนมัติจะไม่แตะคืนที่ล็อก และไม่ผ่อนเงื่อนไขเอง คืนที่จัดไม่ได้จะเป็น "รอหัวหน้าหอ"</p>' + note + '</div>' +
      banner + riskHtml +
      '<div class="card"><div class="print-title"><h2>ตารางเวรหอนอน หอฟ้าทะลายโจร · ' + ymLabel(view.ym) + '</h2></div><div class="grid">' + cells + '</div>' +
      '<div class="legend">' + gtag('M') + ' ชุดชาย ' + gtag('F') + ' ชุดหญิง · "กลุ่ม n" = เวรกลางวันของวันนั้น · ' + state.staff.map((s) => '<span class="chip" style="display:inline-block;' + chipStyle(s.name) + '">' + esc(s.name) + '</span>').join(' ') + '</div></div>' +
      issuesHtml;
  }

  function renderSummary() {
    const p = S.payroll(state, view.ym);
    const { start, end } = monthRange();
    const dutyDates = (n) => S.range(start, end).filter((d) => S.isDutyNight(state, d) && (state.schedule[d] || []).includes(n)).map((d) => Number(d.slice(8)));
    const rows = p.rows.map((r) => '<tr><td><span class="chip" style="display:inline-block;' + chipStyle(r.name) + '">' + esc(r.name) + '</span> ' + gtag(r.gender) + '</td>' +
      '<td class="num"><strong>' + r.count + '</strong></td><td class="muted">' + (dutyDates(r.name).join(', ') || '–') + '</td><td class="num">' + money(r.pay) + '</td></tr>').join('');
    const totalCount = p.rows.reduce((a, r) => a + r.count, 0);
    return '<div class="card"><h2>ค่าตอบแทนเดือน' + ymLabel(view.ym) + '</h2>' +
      '<div class="row"><label class="f">ยอดจากการเงิน (บาท)<input type="number" step="0.01" min="0" inputmode="decimal" data-payroll="' + view.ym + '" value="' + (state.payroll[view.ym] ?? '') + '" placeholder="เช่น 7000"></label></div>' +
      '<div class="kpis"><div><span>คืนที่มีเวรในเดือน</span><b class="big">' + p.nights + '</b></div>' +
      '<div><span>ต่อ 1 คืน (N = ยอด ÷ จำนวนคืน)</span><b class="big">' + money(p.N) + '</b></div>' +
      '<div><span>ต่อครู 1 คน 1 คืน (X = N ÷ 2)</span><b class="big">' + money(p.X) + '</b></div></div>' +
      (p.pending.length ? '<div class="banner warn"><strong>ยังมี ' + p.pending.length + ' คืนที่ไม่ครบ 2 คน</strong><span class="muted">ยอดรวมที่จ่ายจะน้อยกว่ายอดการเงิน ตรวจที่แท็บตารางเวร</span></div>' : '') +
      '<div class="tablewrap"><table><thead><tr><th>ครู</th><th class="num">จำนวนเวร</th><th>วันที่ขึ้นเวร</th><th class="num">ค่าตอบแทน (บาท)</th></tr></thead><tbody>' + rows + '</tbody>' +
      '<tfoot><tr><td>รวม</td><td class="num">' + totalCount + '</td><td></td><td class="num">' + money(p.total) + '</td></tr></tfoot></table></div>' +
      '<p class="muted">ค่าตอบแทน = X × จำนวนเวรของครู · ไม่ปัดเศษระหว่างคำนวณ แสดงเป็นสตางค์ (ผลรวมที่แสดงรายคนอาจต่างจากยอดรวม ±0.01) · นับเวรตามวันที่เริ่มเวร 18:00 · นับตามครูที่ขึ้นเวรจริงในตารางปัจจุบัน</p>' +
      '<div class="row noprint"><button class="btn" data-action="export-pay">ส่งออก CSV</button><button class="btn" data-action="print">พิมพ์ / PDF</button></div></div>';
  }

  function dateChips(name) {
    const list = ((state.unavailable || {})[name] || []).slice().sort();
    return '<div class="chips-inline">' + (list.length ? list.map((d) => '<span class="tag">' + be(d) + '<button data-action="del-date" data-name="' + esc(name) + '" data-date="' + d + '" aria-label="ลบ ' + be(d) + '">×</button></span>').join('') : '<span class="muted">ไม่มี</span>') + '</div>' +
      '<div class="row"><label class="f">จากวันที่<input type="date" data-role="from"></label><label class="f">ถึงวันที่ (ถ้าเป็นช่วง)<input type="date" data-role="to"></label>' +
      '<button class="btn" data-action="add-date" data-name="' + esc(name) + '">เพิ่ม</button></div>';
  }
  function renderPeople() {
    const risk = S.capacityWarnings(state, view.ym);
    return '<div class="card"><h2>ผลกระทบของวันไม่ว่าง · ' + ymLabel(view.ym) + '</h2>' +
      (risk.length ? '<ul class="issues">' + risk.map((r) => '<li class="' + (r.level === 'error' ? 'error' : 'warn') + '"><span class="rule">' + (r.level === 'error' ? '✖' : '⚠') + '</span><span><strong>' + be(r.date) + '</strong> · ' + esc(r.msg) + '</span></li>').join('') + '</ul>'
        : '<p class="muted" style="margin:0">ยังไม่พบคืนที่ครูไม่ว่างจนชุดเหลือน้อยกว่า 3 คน (ระบบเตือนทันทีที่เพิ่มวันไม่ว่าง) คืนที่เหลือไม่ถึง 2 คนจะเป็น "รอหัวหน้าหอ" ให้คุณพิจารณาเอง</p>') + '</div>' +
      '<div class="card"><h2>ครูและวันที่ไม่ว่าง (ภารกิจ / ธุระ)</h2><p class="muted">ครูแจ้งมา หัวหน้าหอกรอกที่นี่ ไม่ต้องมีใบ เก็บเท่าที่จำเป็น</p>' +
      state.staff.map((s) => '<div class="person"><h3><span class="chip" style="' + chipStyle(s.name) + '">' + esc(s.name) + '</span>' + gtag(s.gender) + '<span class="muted">เวรกลางวันกลุ่ม ' + (state.dayGroups.of[s.name] || '–') + '</span></h3>' + dateChips(s.name) + '</div>').join('') + '</div>';
  }

  function renderSettings() {
    const dg = state.dayGroups;
    const preview = S.range(dg.anchorDate, S.addDays(dg.anchorDate, 6)).map((d) => be(d) + ' = กลุ่ม ' + S.dayGroup(state, d)).join(' · ');
    const opt = (n, sel) => '<option value="' + n + '"' + (n === sel ? ' selected' : '') + '>' + n + '</option>';
    return '<div class="card"><h2>เวรนอน</h2><div class="row">' +
      '<label class="f">วันเริ่มเวรนอนแรก<input type="date" data-set="firstNightDate" value="' + state.firstNightDate + '"></label>' +
      '<label class="f">คืนแรกเป็นชุด<select data-set="firstNightGender"><option value="F"' + (state.firstNightGender === 'F' ? ' selected' : '') + '>หญิง (ญญ)</option><option value="M"' + (state.firstNightGender === 'M' ? ' selected' : '') + '>ชาย (ชช)</option></select></label></div>' +
      '<p class="muted">ชุดของคืนต่อๆ ไปสลับต่อจากคืนล่าสุดที่มีเวร ค่า "คืนแรกเป็นชุด" ใช้เฉพาะเมื่อยังไม่มีตารางก่อนหน้า</p></div>' +
      '<div class="card"><h2>เวรกลางวัน (กลุ่ม 1–6 หมุนทุกวัน)</h2><div class="row">' +
      '<label class="f">วันอ้างอิง<input type="date" data-set="anchorDate" value="' + dg.anchorDate + '"></label>' +
      '<label class="f">กลุ่มของวันนั้น<select data-set="anchorGroup">' + [1, 2, 3, 4, 5, 6].map((n) => opt(n, dg.anchorGroup)).join('') + '</select></label></div>' +
      '<p class="muted">ตรวจ 7 วัน: ' + preview + '</p>' +
      '<div class="tablewrap"><table><thead><tr><th>ครู</th><th>ชุด</th><th>เวรกลางวันกลุ่ม</th></tr></thead><tbody>' +
      state.staff.map((s) => '<tr><td>' + esc(s.name) + '</td><td>' + gtag(s.gender) + '</td><td><select data-daygroup="' + esc(s.name) + '">' + [1, 2, 3, 4, 5, 6].map((n) => opt(n, dg.of[s.name])).join('') + '</select></td></tr>').join('') + '</tbody></table></div></div>' +
      '<div class="card"><h2>ช่วงงดเวร (เช่น ปิดเทอม)</h2>' +
      '<div class="chips-inline">' + (state.noDuty.length ? state.noDuty.map((r, i) => '<span class="tag">' + be(r.from) + ' – ' + be(r.to) + '<button data-action="del-noduty" data-i="' + i + '" aria-label="ลบ">×</button></span>').join('') : '<span class="muted">ไม่มี</span>') + '</div>' +
      '<div class="row"><label class="f">จากวันที่<input type="date" id="ndFrom"></label><label class="f">ถึงวันที่<input type="date" id="ndTo"></label><button class="btn" data-action="add-noduty">เพิ่ม</button></div></div>' +
      '<div class="card"><h2>สำรอง / นำเข้าข้อมูล</h2><p class="muted">ข้อมูลเก็บในเบราว์เซอร์ของเครื่องนี้เท่านั้น · ' + (meta.lastBackupAt ? 'สำรองล่าสุด ' + dt(meta.lastBackupAt) : 'ยังไม่เคยสำรอง') + '</p>' +
      '<p class="muted">ก่อนสำรอง ควรกด "บันทึก" ก่อน ไฟล์ที่ได้ชื่อมีวันที่-เวลา เก็บไว้ในโฟลเดอร์ที่ซิงก์ข้ามเครื่อง (เช่น iCloud Drive) · การนำเข้า <strong>แทนที่ข้อมูลทั้งหมด ไม่ใช่รวมข้อมูล</strong></p><div class="row">' +
      '<button class="btn primary" data-action="export-json">สำรองข้อมูล</button><button class="btn" data-action="import-json">นำเข้าข้อมูล</button><button class="btn danger" data-action="reset">ล้างข้อมูลทั้งหมด</button></div></div>' +
      syncCard() +
      historyCard();
  }

  function historyCard() {
    const hist = loadHistory();
    const rows = hist.map((h, i) => {
      let sm = { nights: 0, months: [] };
      try { sm = S.summarizeState(JSON.parse(h.json)); } catch (e) { /* ข้าม */ }
      return '<tr><td>' + dt(h.at) + '</td><td>' + esc(h.label) + '</td><td class="muted">' + sm.nights + ' คืน' + (sm.months.length ? ' · ' + sm.months.map((m) => ymLabel(m.ym)).join(', ') : '') + '</td>' +
        '<td><button class="btn" data-action="restore-version" data-i="' + i + '">ย้อนกลับ</button></td></tr>';
    }).join('');
    return '<div class="card"><h2>ประวัติเวอร์ชัน (10 ครั้งล่าสุด)</h2><p class="muted">เก็บสำเนาทุกครั้งที่กดบันทึก และก่อนนำเข้า/ย้อนกลับ/ล้างข้อมูล ใช้แก้ความผิดพลาด · เก็บในเบราว์เซอร์นี้เท่านั้น <strong>ไม่ใช่ตัวแทนไฟล์สำรอง</strong> (ถ้าล้างข้อมูลเบราว์เซอร์ ประวัติหายด้วย)</p>' +
      (hist.length ? '<div class="tablewrap"><table><thead><tr><th>เมื่อ</th><th>เหตุการณ์</th><th>ข้อมูล</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<p class="muted" style="margin:0">ยังไม่มีประวัติ (จะเริ่มเก็บเมื่อกดบันทึก)</p>') + '</div>';
  }

  // ---------- ซิงก์ GitHub ----------
  function syncLine() {
    if (!syncReady()) return '';
    if (syncInfo.error) return '<span class="dirty">☁ ' + esc(syncInfo.error) + (sync.pendingPush ? ' · ยังไม่ได้ส่งขึ้น GitHub' : '') + '</span>' +
      (sync.pendingPush ? '<button class="btn" data-action="gh-push">ส่งตอนนี้</button>' : '<button class="btn" data-action="gh-check">ลองใหม่</button>');
    if (syncInfo.remote) {
      const r = syncInfo.remote.cmp.relation;
      return '<span class="dirty">☁ มีข้อมูลบน GitHub ที่เครื่องนี้ยังไม่ได้ดึง' + (r === 'newer' ? ' (ใหม่กว่า)' : r === 'older' ? ' (เก่ากว่า)' : '') + '</span><button class="btn" data-action="gh-pull">ดูตัวอย่างและดึงมา</button>';
    }
    if (sync.pendingPush) return '<span class="dirty">☁ ยังไม่ได้ส่งขึ้น GitHub</span><button class="btn" data-action="gh-push">ส่งตอนนี้</button>';
    return '<span class="muted">☁ ' + (sync.lastSyncAt ? 'ซิงก์ GitHub แล้ว ' + dt(sync.lastSyncAt) : 'เปิดซิงก์แล้ว ยังไม่เคยส่ง') + '</span>';
  }

  function syncCard() {
    const on = syncReady();
    return '<div class="card"><h2>ซิงก์กับ GitHub ' + (on ? '<span class="badge b-ok">เปิดอยู่</span>' : '<span class="badge b-na">ปิดอยู่</span>') + '</h2>' +
      '<p class="muted">เมื่อเปิด ทุกครั้งที่กด "บันทึก" ระบบส่งข้อมูลขึ้น repo ส่วนตัวของคุณบน GitHub และตอนเปิดแอปจะตรวจว่ามีข้อมูลใหม่กว่าจากเครื่องอื่นไหม <strong>โดยไม่ทับให้เอง</strong> · ข้อมูลชื่อเล่นครูและยอดเงินจะอยู่บนเซิร์ฟเวอร์ GitHub · token เก็บในเบราว์เซอร์เครื่องนี้เท่านั้น ไม่อยู่ในไฟล์สำรอง</p>' +
      '<div class="stack"><label class="f">repo (เจ้าของ/ชื่อ repo)<input type="text" data-sync="repo" value="' + esc(sync.repo) + '" autocapitalize="off" autocorrect="off" spellcheck="false" autocomplete="off"></label>' +
      '<label class="f">ที่อยู่ไฟล์ใน repo<input type="text" data-sync="path" value="' + esc(sync.path) + '" autocapitalize="off" autocorrect="off" spellcheck="false" autocomplete="off"></label>' +
      '<label class="f">Token (Fine-grained · สิทธิ์ Contents: Read and write)<input type="password" data-sync="token" value="" placeholder="' + (sync.token ? '•••••••• ตั้งไว้แล้ว (พิมพ์ใหม่เพื่อเปลี่ยน)' : 'วาง token ที่นี่') + '" autocapitalize="off" autocorrect="off" spellcheck="false" autocomplete="off"></label>' +
      '<label class="f">ชื่อเครื่องนี้ (ใช้ในข้อความ commit)<input type="text" data-sync="label" value="' + esc(sync.label) + '" placeholder="' + defaultLabel() + '" autocomplete="off"></label></div>' +
      '<div class="row" style="margin-top:10px"><button class="btn primary" data-action="gh-test">ทดสอบการเชื่อมต่อและเปิดซิงก์</button>' +
      (on ? '<button class="btn" data-action="gh-push">ส่งขึ้น GitHub ตอนนี้</button><button class="btn" data-action="gh-pull">ดึงข้อมูลจาก GitHub</button>' : '') +
      (sync.token || sync.enabled ? '<button class="btn danger" data-action="gh-disable">ปิดซิงก์และลบ token</button>' : '') + '</div>' +
      (on ? '<p class="muted" style="margin-bottom:0">' + (sync.lastSyncAt ? 'ซิงก์ล่าสุด ' + dt(sync.lastSyncAt) : 'ยังไม่เคยส่ง') + ' · ไฟล์: ' + esc(sync.path) + ' · ประวัติเวอร์ชันทั้งหมดดูได้ที่ Commits ของ repo บน GitHub</p>' : '') + '</div>';
  }

  async function withBusy(fn) {
    if (syncInfo.busy) { toast('กำลังติดต่อ GitHub อยู่ รอสักครู่'); return; }
    syncInfo.busy = true;
    try { return await fn(); } finally { syncInfo.busy = false; }
  }
  const validRemote = (o) => Array.isArray(o.staff) && o.schedule && o.version === 2;

  // ตรวจว่า GitHub มีข้อมูลที่เครื่องนี้ยังไม่ได้ดึงหรือไม่ (ไม่แก้ข้อมูลใดๆ)
  async function ghCheck(silent) {
    if (!syncReady()) return;
    await withBusy(async () => {
      try {
        const r = await S.ghGet(syncCfg(), fetch);
        syncInfo.error = null;
        syncInfo.remote = r.status === 'ok' && r.sha !== sync.lastRemoteSha ? { sha: r.sha, obj: r.obj, cmp: S.compareBackup(r.obj, state) } : null;
        if (!silent) toast(syncInfo.remote ? 'พบข้อมูลบน GitHub ที่ต่างจากเครื่องนี้' : 'ข้อมูลตรงกับ GitHub แล้ว');
      } catch (e) { syncInfo.error = e.message; if (!silent) toast(e.message); }
    });
    render();
  }

  // ส่งฉบับที่บันทึกแล้วขึ้น GitHub ถ้า GitHub เปลี่ยนไปจากที่เครื่องนี้ซิงก์ล่าสุด จะไม่ทับ แต่ถามก่อน
  async function ghPush(force) {
    if (!syncReady()) { toast('ยังไม่ได้เปิดซิงก์ GitHub'); return; }
    if (isDirty()) { toast('มีการแก้ไขที่ยังไม่ได้บันทึก กด "บันทึก" ก่อน แล้วระบบจะส่งขึ้น GitHub'); return; }
    await withBusy(async () => {
      try {
        const cur = await S.ghGet(syncCfg(), fetch);
        if (cur.status === 'ok' && !force) {
          if (cur.sha !== sync.lastRemoteSha) { sync.pendingPush = true; saveSync(); openConflict(cur); return; }
          if (!hasData() && Object.keys(cur.obj.schedule || {}).length && !confirm('เครื่องนี้ยังไม่มีตาราง แต่ GitHub มีข้อมูลอยู่ ส่งทับหรือไม่?')) { sync.pendingPush = true; saveSync(); return; }
        }
        const now = new Date().toISOString();
        const text = JSON.stringify(Object.assign({}, state, { exportedAt: now }), null, 2);
        const res = await S.ghPut(syncCfg(), fetch, text, 'บันทึกจาก ' + (sync.label || defaultLabel()) + ' ' + now, cur.status === 'ok' ? cur.sha : undefined);
        sync.lastRemoteSha = res.sha; sync.lastSyncAt = now; sync.pendingPush = false; saveSync();
        syncInfo.remote = null; syncInfo.error = null;
        toast('ส่งขึ้น GitHub แล้ว');
      } catch (e) {
        sync.pendingPush = true; saveSync(); syncInfo.error = e.message; toast('ส่งขึ้น GitHub ไม่สำเร็จ: ' + e.message);
      }
    });
    render();
  }

  // ดึงข้อมูลจาก GitHub: แสดงพรีวิวเดียวกับการนำเข้าไฟล์ ไม่ทับจนกว่าจะกดนำเข้า
  async function ghPull() {
    if (!syncReady()) { toast('ยังไม่ได้เปิดซิงก์ GitHub'); return; }
    await withBusy(async () => {
      try {
        const r = await S.ghGet(syncCfg(), fetch);
        if (r.status === 'missing') { toast('ยังไม่มีไฟล์บน GitHub'); return; }
        if (!validRemote(r.obj)) throw new Error('ข้อมูลบน GitHub ไม่ใช่ของระบบนี้ (ต้องเป็นเวอร์ชัน 2)');
        pendingImport = { obj: r.obj, name: 'GitHub: ' + sync.path, sha: r.sha }; openImport();
      } catch (e) { syncInfo.error = e.message; toast(e.message); }
    });
    render();
  }

  async function ghTest() {
    const bad = S.ghValidate(syncCfg());
    if (bad) { toast(bad); return; }
    await withBusy(async () => {
      try {
        const r = await S.ghGet(syncCfg(), fetch);
        sync.enabled = true; saveSync(); syncInfo.error = null;
        syncInfo.remote = r.status === 'ok' && r.sha !== sync.lastRemoteSha ? { sha: r.sha, obj: r.obj, cmp: S.compareBackup(r.obj, state) } : null;
        toast(r.status === 'missing' ? 'เชื่อมต่อได้ ยังไม่มีไฟล์บน GitHub จะสร้างให้เมื่อกดบันทึก' : 'เชื่อมต่อได้ พบข้อมูลบน GitHub (ดูแถบสถานะ)');
      } catch (e) { sync.enabled = false; saveSync(); toast('เชื่อมต่อไม่ได้: ' + e.message); }
    });
    render();
  }

  function openConflict(remote) {
    pendingImport = { obj: remote.obj, name: 'GitHub: ' + sync.path, sha: remote.sha };
    const rel = S.compareBackup(remote.obj, state).relation;
    const msg = rel === 'newer' ? 'ข้อมูลบน GitHub ใหม่กว่าของเครื่องนี้' : rel === 'older' ? 'ข้อมูลบน GitHub ถูกส่งจากเครื่องอื่นหลังจากที่เครื่องนี้ซิงก์ล่าสุด (แม้เวลาแก้ไขเก่ากว่า)' : 'เทียบวันเวลาไม่ได้ ตรวจสองฝั่งให้ดี';
    dlg().innerHTML = '<form method="dialog" data-form="conflict"><h3>GitHub มีข้อมูลที่เครื่องนี้ยังไม่ได้ดึง</h3><p class="muted" style="margin:0">ระบบยังไม่ส่งทับ เพื่อกันงานของอีกเครื่องหาย</p>' +
      '<div class="cmp">' + summaryBlock('บน GitHub', S.summarizeState(remote.obj)) + summaryBlock('เครื่องนี้ (บันทึกแล้ว)', S.summarizeState(state)) + '</div>' +
      '<div class="preview"><div class="warn">' + msg + '</div></div>' +
      '<p class="muted">เลือก "ดูตัวอย่างและดึงมา" เพื่อนำของ GitHub มาใช้ (ของเครื่องนี้ถูกเก็บไว้ในประวัติเวอร์ชัน) หรือ "ส่งทับ GitHub" ถ้าแน่ใจว่าของเครื่องนี้ถูกต้อง (ฉบับเดิมบน GitHub ยังดูย้อนหลังได้ใน Commits)</p>' +
      '<div class="actions"><button class="btn" type="button" data-action="dlg-cancel">ยกเลิก</button><button class="btn" type="button" data-action="gh-pull-preview">ดูตัวอย่างและดึงมา</button><button class="btn danger" type="button" data-action="gh-force-push">ส่งทับ GitHub</button></div></form>';
    if (!dlg().open) dlg().showModal();
  }

  // ---------- หน้าต่างนำเข้าข้อมูล (ดูตัวอย่างก่อนทับ) ----------
  function summaryBlock(title, sm) {
    return '<div><strong>' + title + '</strong><div>แก้ไขล่าสุด: ' + dt(sm.updatedAt) + '</div><div>คืนที่จัดแล้ว: <strong>' + sm.nights + '</strong> คืน</div>' +
      '<div class="muted">' + (sm.months.map((m) => ymLabel(m.ym) + ' (' + m.nights + ')').join(', ') || 'ยังไม่มีตาราง') + '</div></div>';
  }
  function openImport() {
    const obj = pendingImport.obj, fileSm = S.summarizeState(obj), curSm = S.summarizeState(state), cmp = S.compareBackup(obj, state);
    const warns = [];
    if (cmp.relation === 'older') warns.push(['error', '⚠ ไฟล์นี้เก่ากว่าข้อมูลบนเครื่อง การนำเข้าจะทับข้อมูลที่ใหม่กว่า']);
    if (cmp.relation === 'unknown' && curSm.nights > 0) warns.push(['warn', 'เทียบวันเวลาไม่ได้ (ข้อมูลบนเครื่องยังไม่เคยกดบันทึก หรือไฟล์ไม่มีเวลา) ตรวจสองฝั่งด้านบนให้ดี']);
    if (isDirty()) warns.push(['error', '⚠ เครื่องนี้มีการแก้ไขที่ยังไม่ได้บันทึก ซึ่งจะหายไป']);
    if (unbacked()) warns.push(['warn', 'ข้อมูลบนเครื่องนี้ยังไม่ได้สำรอง (กด "สำรองเครื่องนี้ก่อน" ได้)']);
    dlg().innerHTML = '<form method="dialog" data-form="import"><h3>' + (pendingImport.sha ? 'ดึงข้อมูลจาก GitHub' : 'นำเข้าข้อมูลจากไฟล์') + '</h3><p class="muted" style="margin:0">' + esc(pendingImport.name) + '</p>' +
      '<div class="cmp">' + summaryBlock('ไฟล์ที่เลือก', fileSm) + summaryBlock('เครื่องนี้ (ตอนนี้)', curSm) + '</div>' +
      '<div class="preview">' + (warns.length ? warns.map((w) => '<div class="' + w[0] + '">' + w[1] + '</div>').join('') : '<div class="okmsg">ไม่พบข้อควรระวัง</div>') + '</div>' +
      '<p class="muted">ระบบจะเก็บสำเนาข้อมูลเครื่องนี้ไว้ในประวัติเวอร์ชันก่อนนำเข้า และข้อมูลที่นำเข้ายังไม่ถูกบันทึกจนกว่าจะกด "บันทึก" (กด "ยกเลิกการแก้ไข" เพื่อกลับ)</p>' +
      '<div class="actions"><button class="btn" type="button" data-action="dlg-cancel">ยกเลิก</button><button class="btn" type="button" data-action="export-json">สำรองเครื่องนี้ก่อน</button><button class="btn primary" type="button" data-action="import-confirm">นำเข้า</button></div></form>';
    if (!dlg().open) dlg().showModal();
  }

  // ---------- หน้าต่างแก้ไขคืนเวร ----------
  const dlg = () => $('#dlg');
  function previewHtml(tmp, from, to) {
    const list = S.validate(tmp, from, to).filter((i) => i.level !== 'info');
    return list.length ? list.map((i) => '<div class="' + i.level + '"><strong>' + be(i.date) + '</strong> ' + i.rule + ': ' + esc(i.msg) + '</div>').join('') : '<div class="okmsg">ผ่านเงื่อนไขพื้นฐาน</div>';
  }
  function openDay(date) {
    const ns = state.schedule[date] || [];
    const exp = S.explainNight(state, date);
    const order = state.staff.slice().sort((a, b) => (b.gender === exp.gender) - (a.gender === exp.gender));
    dlg().innerHTML = '<form method="dialog" data-form="day" data-date="' + date + '"><h3>คืนวัน' + S.THAI_DOW[S.dow(date)] + 'ที่ ' + be(date) + '</h3>' +
      '<p class="muted" style="margin:0">เวร 18:00 – 07:00 น. · เวรกลางวันวันนี้กลุ่ม ' + S.dayGroup(state, date) + ' · ชุดที่ควรเป็น ' + gtag(exp.gender) + '</p>' +
      '<div class="pick">' + order.map((s) => {
        const hints = [];
        const r = S.excludedReason(state, s.name, date); if (r) hints.push(r);
        if ((state.schedule[S.addDays(date, -1)] || []).includes(s.name)) hints.push('เวรเมื่อคืน');
        if ((state.schedule[S.addDays(date, 1)] || []).includes(s.name)) hints.push('เวรพรุ่งนี้');
        return '<label class="' + (s.gender === exp.gender ? '' : 'dim') + '"><input type="checkbox" name="n" value="' + esc(s.name) + '"' + (ns.includes(s.name) ? ' checked' : '') + '><span class="sw" style="background:' + color(s.name) + '"></span>ครู' + esc(s.name) + ' ' + gtag(s.gender) + (hints.length ? '<span class="hint">' + hints.join(' · ') + '</span>' : '') + '</label>';
      }).join('') + '</div><div class="preview" id="dlgPreview"></div>' +
      '<label><input type="checkbox" name="lock"' + (state.locked[date] ? ' checked' : '') + '> 🔒 ล็อกคืนนี้ (ตัวสร้างอัตโนมัติจะไม่แก้)</label>' +
      '<div class="actions"><button class="btn danger" type="button" data-action="day-clear" data-date="' + date + '">ล้างคืนนี้</button><button class="btn" type="button" data-action="dlg-cancel">ยกเลิก</button><button class="btn primary" type="submit" data-action="day-save">ตกลง</button></div></form>';
    dlg().showModal();
    refreshDayPreview();
  }
  function pickedNames(form) { return [...form.querySelectorAll('input[name=n]:checked')].map((i) => i.value); }
  function refreshDayPreview() {
    const f = $('#dlg form[data-form=day]'); if (!f) return;
    const d = f.dataset.date;
    const tmp = Object.assign({}, state, { schedule: Object.assign({}, state.schedule, { [d]: state.staff.map((s) => s.name).filter((n) => pickedNames(f).includes(n)) }) });
    if (!tmp.schedule[d].length) delete tmp.schedule[d];
    $('#dlgPreview').innerHTML = previewHtml(tmp, S.addDays(d, -1), S.addDays(d, 1));
  }

  function nightOptions(sel) {
    const { start, end } = monthRange();
    return S.range(start, end).filter((d) => (state.schedule[d] || []).length).map((d) => '<option value="' + d + '"' + (d === sel ? ' selected' : '') + '>' + Number(d.slice(8)) + ' ' + S.THAI_DOW[S.dow(d)] + ' · ' + state.schedule[d].join('/') + '</option>').join('');
  }
  function personOptions(date) { return (state.schedule[date] || []).map((n) => '<option>' + esc(n) + '</option>').join(''); }
  function openSwap() {
    const { start, end } = monthRange();
    const ds = S.range(start, end).filter((d) => (state.schedule[d] || []).length);
    if (ds.length < 2) { toast('ต้องมีตารางอย่างน้อย 2 คืนในเดือนนี้'); return; }
    dlg().innerHTML = '<form method="dialog" data-form="swap"><h3>สลับครูระหว่างสองคืน</h3><p class="muted" style="margin:0">เลือกครู 1 คนจากแต่ละคืน แล้วสลับที่กัน ระบบตรวจเงื่อนไขให้ก่อน คุณเป็นผู้ตัดสินใจ</p>' +
      '<div class="stack" style="margin-top:10px"><div class="row"><label class="f">คืนที่ 1<select id="swDa">' + nightOptions(ds[0]) + '</select></label><label class="f">ครู<select id="swNa">' + personOptions(ds[0]) + '</select></label></div>' +
      '<div class="row"><label class="f">คืนที่ 2<select id="swDb">' + nightOptions(ds[1]) + '</select></label><label class="f">ครู<select id="swNb">' + personOptions(ds[1]) + '</select></label></div></div>' +
      '<div class="preview" id="swPreview"></div><div class="actions"><button class="btn" type="button" data-action="dlg-cancel">ยกเลิก</button><button class="btn primary" type="submit" data-action="swap-do">สลับ</button></div></form>';
    dlg().showModal();
    refreshSwapPreview();
  }
  function swapSel() { return { a: { date: $('#swDa').value, name: $('#swNa').value }, b: { date: $('#swDb').value, name: $('#swNb').value } }; }
  function refreshSwapPreview() {
    const { a, b } = swapSel();
    const r = S.swapTeachers(state, a, b);
    if (!r.ok) { $('#swPreview').innerHTML = '<div class="error">' + esc(r.error) + '</div>'; return false; }
    const tmp = Object.assign({}, state, { schedule: r.schedule });
    const lo = a.date < b.date ? a.date : b.date, hi = a.date < b.date ? b.date : a.date;
    const dates = new Set([lo, hi, S.addDays(lo, -1), S.addDays(lo, 1), S.addDays(hi, -1), S.addDays(hi, 1)]);
    const list = S.validate(tmp, S.addDays(lo, -1), S.addDays(hi, 1)).filter((i) => i.level !== 'info' && dates.has(i.date) && (i.date === lo || i.date === hi || i.date === S.addDays(lo, 1) || i.date === S.addDays(hi, 1)));
    $('#swPreview').innerHTML = list.length ? list.map((i) => '<div class="' + i.level + '"><strong>' + be(i.date) + '</strong> ' + i.rule + ': ' + esc(i.msg) + '</div>').join('') : '<div class="okmsg">หลังสลับ ผ่านเงื่อนไขพื้นฐาน</div>';
    return list.some((i) => i.level === 'error');
  }

  // ---------- เหตุการณ์ ----------
  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-action]');
    if (!el) return;
    const a = el.dataset.action, name = el.dataset.name;
    switch (a) {
      case 'tab': view.tab = el.dataset.tab; render(); window.scrollTo(0, 0); break;
      case 'month': view.ym = S.addMonth(view.ym, Number(el.dataset.n)); view.seed = 0; render(); break;
      case 'save': state.updatedAt = new Date().toISOString(); savedJson = JSON.stringify(state); write(KEY_SAVED, savedJson); write(KEY_DRAFT, savedJson); addHistory('บันทึก', state); render(); toast('บันทึกแล้ว'); if (syncReady()) ghPush(false); break;
      case 'discard':
        if (confirm('ยกเลิกการแก้ไขทั้งหมดตั้งแต่บันทึกครั้งล่าสุดหรือไม่?')) { state = normalize(JSON.parse(savedJson)); commit(); }
        break;
      case 'edit': openDay(el.dataset.date); break;
      case 'dlg-cancel': dlg().close(); break;
      case 'day-clear': delete state.schedule[el.dataset.date]; delete state.locked[el.dataset.date]; dlg().close(); commit(); break;
      case 'day-save': {
        ev.preventDefault();
        const f = $('#dlg form'), date = f.dataset.date, picked = pickedNames(f);
        if (picked.length) state.schedule[date] = state.staff.map((s) => s.name).filter((n) => picked.includes(n)); else delete state.schedule[date];
        if (f.querySelector('input[name=lock]').checked) state.locked[date] = true; else delete state.locked[date];
        dlg().close(); commit(); break;
      }
      case 'swap-open': openSwap(); break;
      case 'swap-do': {
        ev.preventDefault();
        const { a: sa, b: sb } = swapSel(), r = S.swapTeachers(state, sa, sb);
        if (!r.ok) { toast(r.error); break; }
        if (refreshSwapPreview() && !confirm('การสลับนี้ทำให้ไม่ตรงเงื่อนไขพื้นฐาน ยืนยันสลับต่อหรือไม่?')) break;
        state.schedule = r.schedule; dlg().close(); commit(); toast('สลับครูแล้ว'); break;
      }
      case 'generate': {
        const { start, end } = monthRange();
        const hasData = S.range(start, end).some((d) => !state.locked[d] && (state.schedule[d] || []).length && S.isDutyNight(state, d));
        if (hasData && !confirm('การสร้างใหม่จะแทนที่ทุกคืนที่ไม่ได้ล็อกในเดือนนี้ ดำเนินการต่อหรือไม่?')) break;
        view.seed++;
        const r = S.generate(state, view.ym, { seed: view.seed === 1 ? undefined : view.seed });
        state.schedule = r.schedule; commit();
        toast(r.pending.length ? 'จัดไม่ได้ ' + r.pending.length + ' คืน (รอหัวหน้าหอ)' : view.seed === 1 ? 'สร้างตารางแล้ว กดอีกครั้งเพื่อลองแบบอื่น' : 'สร้างแบบใหม่แล้ว');
        break;
      }
      case 'clear':
        if (confirm('ล้างทุกคืนที่ไม่ได้ล็อกในเดือนนี้หรือไม่?')) { const { start, end } = monthRange(); S.range(start, end).forEach((d) => { if (!state.locked[d]) delete state.schedule[d]; }); commit(); }
        break;
      case 'print': window.print(); break;
      case 'export-csv': {
        const { start, end } = monthRange();
        const rows = [['วันที่', 'วัน', 'เวรกลางวันกลุ่ม', 'ชุด', 'ครูคนที่ 1', 'ครูคนที่ 2']].concat(S.range(start, end).filter((d) => S.isDutyNight(state, d)).map((d) => {
          const n = state.schedule[d] || [], g = S.pairGender(state, n);
          return [be(d), S.THAI_DOW[S.dow(d)], S.dayGroup(state, d), g ? S.GENDER_LABEL[g] : '', n[0] ? 'ครู' + n[0] : '', n[1] ? 'ครู' + n[1] : ''];
        }));
        download('sod-schedule-' + view.ym + '.csv', csv(rows), 'text/csv;charset=utf-8'); break;
      }
      case 'export-pay': {
        const p = S.payroll(state, view.ym);
        const rows = [['ครู', 'ชุด', 'จำนวนเวร', 'ค่าตอบแทน (บาท)']].concat(p.rows.map((r) => ['ครู' + r.name, S.GENDER_LABEL[r.gender], r.count, r.pay === null ? '' : r.pay.toFixed(2)]));
        rows.push(['รวม', '', p.rows.reduce((a, r) => a + r.count, 0), p.total === null ? '' : p.total.toFixed(2)]);
        rows.push(['ยอดการเงิน', '', 'จำนวนคืน ' + p.nights, p.amount === null ? '' : p.amount]);
        download('sod-payroll-' + view.ym + '.csv', csv(rows), 'text/csv;charset=utf-8'); break;
      }
      case 'export-json': {
        const now = new Date(), fname = S.backupFileName(now);
        download(fname, JSON.stringify(Object.assign({}, state, { exportedAt: now.toISOString() }), null, 2), 'application/json');
        meta.lastBackupAt = now.toISOString(); meta.lastBackupHash = S.hashString(JSON.stringify(state)); saveMeta();
        if ($('#dlg').open) { if (pendingImport) openImport(); } else render();
        toast(isDirty() ? 'สำรองแล้ว (รวมการแก้ไขที่ยังไม่ได้กดบันทึก): ' + fname : 'สำรองแล้ว: ' + fname); break;
      }
      case 'import-confirm': {
        if (!pendingImport) break;
        addHistory('ก่อนนำเข้า', state);
        const o = Object.assign({}, pendingImport.obj); const fileTime = o.exportedAt || o.updatedAt; delete o.exportedAt;
        state = normalize(o); meta.lastBackupAt = fileTime || meta.lastBackupAt; meta.lastBackupHash = S.hashString(JSON.stringify(state)); saveMeta();
        if (pendingImport.sha) { sync.lastRemoteSha = pendingImport.sha; syncInfo.remote = null; saveSync(); }
        pendingImport = null; dlg().close(); commit(); toast('นำเข้าข้อมูลแล้ว (ยังไม่ได้บันทึก กด "บันทึก" เพื่อยืนยัน)'); break;
      }
      case 'restore-version': {
        const h = loadHistory()[Number(el.dataset.i)];
        if (!h || !confirm('ย้อนกลับไปเวอร์ชันเมื่อ ' + dt(h.at) + ' (' + h.label + ') หรือไม่? ระบบจะเก็บสำเนาปัจจุบันไว้ในประวัติก่อน')) break;
        addHistory('ก่อนย้อนกลับ', state); state = normalize(JSON.parse(h.json)); commit(); toast('ย้อนกลับแล้ว (ยังไม่ได้บันทึก กด "บันทึก" เพื่อยืนยัน)'); break;
      }
      case 'import-json': $('#importFile').click(); break;
      case 'add-date': {
        const box = el.closest('.person'), from = box.querySelector('[data-role=from]').value, to = box.querySelector('[data-role=to]').value || from;
        if (!from || to < from) { toast('กรุณาเลือกวันที่ให้ถูกต้อง'); break; }
        state.unavailable[name] = [...new Set((state.unavailable[name] || []).concat(S.range(from, to)))].sort(); commit(); break;
      }
      case 'del-date': state.unavailable[name] = (state.unavailable[name] || []).filter((d) => d !== el.dataset.date); commit(); break;
      case 'add-noduty': {
        const f = $('#ndFrom').value, t = $('#ndTo').value || f;
        if (!f || t < f) { toast('กรุณาเลือกวันที่ให้ถูกต้อง'); break; }
        state.noDuty.push({ from: f, to: t }); commit(); break;
      }
      case 'del-noduty': state.noDuty.splice(Number(el.dataset.i), 1); commit(); break;
      case 'gh-test': ghTest(); break;
      case 'gh-push': ghPush(false); break;
      case 'gh-pull': ghPull(); break;
      case 'gh-check': ghCheck(false); break;
      case 'gh-pull-preview': openImport(); break;
      case 'gh-force-push': dlg().close(); ghPush(true); break;
      case 'gh-disable':
        if (confirm('ปิดซิงก์และลบ token ออกจากเครื่องนี้หรือไม่? (ข้อมูลบน GitHub ไม่ถูกลบ)')) { sync.enabled = false; sync.token = ''; sync.lastRemoteSha = null; sync.pendingPush = false; saveSync(); syncInfo.remote = null; syncInfo.error = null; render(); toast('ปิดซิงก์และลบ token แล้ว'); }
        break;
      case 'reset':
        if (confirm('ล้างข้อมูลทั้งหมดในเครื่องนี้และกลับเป็นค่าเริ่มต้นหรือไม่? (ย้อนกลับไม่ได้)')) { addHistory('ก่อนล้างข้อมูลทั้งหมด', state); state = S.defaultState(); savedJson = JSON.stringify(state); write(KEY_SAVED, savedJson); write(KEY_DRAFT, savedJson); meta = {}; saveMeta(); render(); }
        break;
    }
  });

  document.addEventListener('keydown', (ev) => {
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches && ev.target.matches('li[data-action]')) { ev.preventDefault(); ev.target.click(); }
  });

  document.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.closest && t.closest('form[data-form=day]') && t.name === 'n') { refreshDayPreview(); return; }
    if (t.closest && t.closest('form[data-form=swap]')) {
      if (t.id === 'swDa') $('#swNa').innerHTML = personOptions(t.value);
      if (t.id === 'swDb') $('#swNb').innerHTML = personOptions(t.value);
      refreshSwapPreview(); return;
    }
    if (t.dataset.payroll) { const v = t.value; if (v === '') delete state.payroll[t.dataset.payroll]; else state.payroll[t.dataset.payroll] = Number(v); commit(); }
    else if (t.dataset.set) {
      const k = t.dataset.set;
      if (k === 'anchorDate') state.dayGroups.anchorDate = t.value;
      else if (k === 'anchorGroup') state.dayGroups.anchorGroup = Number(t.value);
      else state[k] = t.value;
      commit();
    } else if (t.dataset.daygroup) { state.dayGroups.of[t.dataset.daygroup] = Number(t.value); commit(); }
    else if (t.dataset.sync) {
      const k = t.dataset.sync, v = t.value.trim();
      if (k === 'token' && !v) return;
      sync[k] = v; if (k === 'token') t.value = ''; if (k === 'repo' || k === 'path') sync.lastRemoteSha = null; saveSync();
    }
    else if (t.id === 'importFile' && t.files[0]) {
      const file = t.files[0], r = new FileReader();
      r.onload = () => {
        try {
          const obj = JSON.parse(r.result);
          if (!Array.isArray(obj.staff) || !obj.schedule || obj.version !== 2) throw new Error('ไม่ใช่ไฟล์สำรองของระบบนี้ (ต้องเป็นเวอร์ชัน 2)');
          pendingImport = { obj, name: file.name }; openImport();
        } catch (e) { toast('นำเข้าไม่ได้: ' + e.message); }
        t.value = '';
      };
      r.readAsText(file);
    }
  });

  dlg().addEventListener('click', (ev) => { if (ev.target === ev.currentTarget) ev.currentTarget.close(); });
  render();
  if (syncReady()) ghCheck(true);
})();
