const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const ITEMS = DATA.items;
const BY_ID = new Map(ITEMS.map(i => [i.id, i]));
const mins = hm => (+hm.slice(0, 2)) * 60 + (+hm.slice(3, 5));
const dayName = d => {
  const m = DATA.days.find(x => x.date === d);
  return m ? `${+d.slice(5, 7)}월 ${+d.slice(8, 10)}일 (${m.weekday})` : d;
};
const shortDay = d => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;
const POSTERS = ITEMS.filter(i => i.poster).length;

// A phone and a desktop get different layouts rather than one stretched to fit:
// below this the schedule is a list under a bottom bar, above it the hall grid
// the printed programme uses.
const WIDE = '(min-width: 1024px)';
const isWide = () => !!(window.matchMedia && window.matchMedia(WIDE).matches);

/* ------------------------------------------------------------------ plan */
const KEY = 'kcs138.plan.v1';
const plan = new Set();
let arrived = null;

function loadPlan() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) JSON.parse(raw).forEach(id => BY_ID.has(id) && plan.add(id));
  } catch (e) { console.warn('plan not restored:', e.message); }
}
function savePlan() {
  try { localStorage.setItem(KEY, JSON.stringify([...plan])); }
  catch (e) { console.warn('plan not saved:', e.message); }
}
const planLink = () =>
  `${location.origin}${location.pathname}#p=${[...plan].map(id => id.replace('kcs138_', '')).join(',')}`;

function readLink() {
  const m = /[#&]p=([^&]*)/.exec(location.hash);
  if (!m) return null;
  let added = 0;
  decodeURIComponent(m[1]).split(',').filter(Boolean).forEach(n => {
    const id = 'kcs138_' + n;
    if (BY_ID.has(id) && !plan.has(id)) { plan.add(id); added++; }
  });
  savePlan();
  try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { }
  return added;
}
const planItems = () => [...plan].map(id => BY_ID.get(id)).filter(Boolean)
  .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));

function clashes() {
  const list = planItems(), bad = new Set();
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (a.date !== b.date || a.hall === b.hall) continue;
      if (mins(a.start) < mins(b.end) && mins(b.start) < mins(a.end)) { bad.add(a.id); bad.add(b.id); }
    }
  return bad;
}

/* ------------------------------------------------------------------ clock */
const FIRST = DATA.days[0].date, LAST = DATA.days[DATA.days.length - 1].date;
function nowRef() {
  const d = new Date();
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (iso >= FIRST && iso <= LAST) return { date: iso, m: d.getHours() * 60 + d.getMinutes(), live: true };
  return { date: FIRST, m: 9 * 60, live: false };
}

/* ------------------------------------------------------------------ shared */
let query = '';
function hi(text) {
  const t = esc(text);
  if (!query) return t;
  return t.replace(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig'), '<mark>$1</mark>');
}
const starBtn = it => {
  const on = plan.has(it.id);
  return `<button class="star" data-pick="${esc(it.id)}" data-on="${on ? 1 : 0}"
    aria-label="${on ? '내 일정에서 빼기' : '내 일정에 담기'}">${on ? '★' : '☆'}</button>`;
};

// Phone row.
function row(it, opts = {}) {
  const when = opts.showDate ? `${shortDay(it.date)} ${it.start}–${it.end}` : `${it.start}–${it.end}`;
  const tags = (opts.tags || []).map(t => `<span class="tag ${t.k || ''}">${esc(t.t)}</span>`).join('');
  return `<div class="row${plan.has(it.id) ? ' on' : ''}">
    <span class="bar"></span>
    <button class="open main" data-open="${esc(it.id)}">
      <span class="line1">${tags}<span class="code">${esc(it.code)}</span>
        <span>${esc(when)}</span><span class="hall">${esc(it.hall)}</span></span>
      <span class="ttl">${hi(it.title)}</span>
      <span class="who">${hi(it.presenter)}${it.affiliation ? ' · ' + hi(it.affiliation) : ''}</span>
    </button>
    ${starBtn(it)}
  </div>`;
}
const rowsOf = (list, opts) => `<div class="rows">${list.map(i => row(i, opts)).join('')}</div>`;

// Desktop table.
function table(list, opts = {}) {
  return `<div class="tablewrap"><table class="list"><thead><tr>
      <th>시간</th><th>코드</th><th>발표</th><th>장소</th><th></th>
    </tr></thead><tbody>${list.map(it => `<tr${plan.has(it.id) ? ' class="on"' : ''}>
      <td class="c-time">${opts.showDate ? shortDay(it.date) + ' ' : ''}${esc(it.start)}–${esc(it.end)}</td>
      <td class="c-code">${esc(it.code)}</td>
      <td><button class="open" data-open="${esc(it.id)}">
        <span class="t">${hi(it.title)}</span>
        <span class="a">${hi(it.presenter)}${it.affiliation ? ' · ' + hi(it.affiliation) : ''}</span>
      </button></td>
      <td class="c-hall">${esc(it.hall)}</td>
      <td class="c-star">${starBtn(it)}</td>
    </tr>`).join('')}</tbody></table></div>`;
}
const listing = (list, opts) => isWide() ? table(list, opts) : rowsOf(list, opts);

/* ------------------------------------------------------------------ now */
function renderNow() {
  const ref = nowRef();
  const today = ITEMS.filter(i => i.date === ref.date);
  const live = today.filter(i => mins(i.start) <= ref.m && ref.m < mins(i.end));
  const later = today.filter(i => mins(i.start) > ref.m).sort((a, b) => mins(a.start) - mins(b.start));
  const nextAt = later.length ? mins(later[0].start) : null;
  const soon = later.filter(i => mins(i.start) === nextAt).slice(0, 12);

  const mine = planItems().filter(i => i.date > ref.date || (i.date === ref.date && mins(i.end) > ref.m));
  let head = '';
  if (mine.length) {
    const n = mine[0];
    const away = n.date === ref.date ? mins(n.start) - ref.m : null;
    const label = away === null ? dayName(n.date)
      : away <= 0 ? '진행 중'
        : away < 60 ? `${away}분 뒤`
          : `${Math.floor(away / 60)}시간 ${away % 60}분 뒤`;
    head = `<div class="next"><div class="k">내 다음 일정</div>
      <div class="v">${esc(n.title)}</div>
      <div class="m">${esc(n.code)} · ${esc(n.hall)} · ${esc(n.start)}–${esc(n.end)} · ${esc(label)}</div></div>`;
  }
  const liveTalks = live.filter(i => !i.poster).slice(0, isWide() ? 40 : 12);
  const livePoster = live.filter(i => i.poster).length;

  $('#s-now').innerHTML = `
    <div class="page-h"><h2>지금</h2>
      <span class="count">${ref.live ? dayName(ref.date) + ' 기준' : '학회 시작 전'}</span></div>
    <p class="lede">${ref.live
      ? '진행 중인 발표와 다음 순서입니다.'
      : `학회는 ${dayName(FIRST)}에 시작합니다. 첫날 오전 기준으로 보여 드립니다.`}</p>
    ${head}
    <h3 class="sub">진행 중${live.length ? ` (${live.length}건)` : ''}</h3>
    ${livePoster ? `<p class="lede">포스터 ${livePoster}건이 Exhibition Hall에서 진행 중입니다.</p>` : ''}
    ${liveTalks.length ? listing(liveTalks) : '<p class="empty">이 시간에 진행 중인 발표가 없습니다.</p>'}
    <h3 class="sub">곧 시작${nextAt !== null ? ` (${soon[0].start})` : ''}</h3>
    ${soon.length ? listing(soon) : '<p class="empty">남은 일정이 없습니다.</p>'}`;
  setMeta(`${live.length}건 진행 중 · ${soon.length}건 대기`);
}

/* ------------------------------------------------------------------ schedule */
let schedDay = 0;

const dayBlocks = date => [
  ...DATA.sessions.filter(s => s.date === date),
  ...DATA.posterSessions.filter(p => p.date === date).map(p => ({
    track: `Poster Presentation ${p.n}`, trackCode: p.divisions.join(' · '),
    date: p.date, hall: 'Exhibition Hall', start: p.start, end: p.end,
    n: p.count, poster: p.n,
  })),
];
const blockKey = s => s.poster ? 'P' + s.poster : `${s.track}|${s.date}|${s.hall}`;

// Desktop: halls across, time down, a session spanning the rows it occupies.
function gridFor(date) {
  const sess = dayBlocks(date);
  if (!sess.length) return '<p class="empty">일정이 없습니다.</p>';

  const halls = [...new Set(sess.map(s => s.hall))].sort((a, b) => {
    if (a === 'Exhibition Hall') return 1;
    if (b === 'Exhibition Hall') return -1;
    return a.localeCompare(b, undefined, { numeric: true });
  });
  const bounds = [...new Set(sess.flatMap(s => [s.start, s.end]))].sort();
  const taken = new Set();
  let body = '';

  for (let r = 0; r < bounds.length - 1; r++) {
    body += `<tr><td class="time">${esc(bounds[r])}</td>`;
    halls.forEach((h, c) => {
      if (taken.has(r + ':' + c)) return;
      const s = sess.find(x => x.hall === h && x.start === bounds[r]);
      if (!s) { body += '<td class="free"></td>'; return; }
      const span = Math.max(1, bounds.indexOf(s.end) - bounds.indexOf(s.start));
      for (let k = 1; k < span; k++) taken.add((r + k) + ':' + c);
      body += `<td class="slotcell" rowspan="${span}">
        <button class="block" data-session="${esc(blockKey(s))}">
          <span class="bc">${esc(s.trackCode || '')} ${esc(s.start)}–${esc(s.end)}</span>
          <span class="bt">${esc(s.track)}</span>
          <span class="bm">발표 ${s.n}건</span>
        </button></td>`;
    });
    body += '</tr>';
  }
  return `<div class="tablewrap"><table class="grid"><thead><tr><th>시간</th>
    ${halls.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${body}</tbody></table></div>
    <p class="lede" style="margin-top:10px">회장이 많은 날은 표를 가로로 넘겨 보세요. 블록을 누르면 그 세션의 발표 목록이 열립니다.</p>`;
}

// Phone: one column, grouped by start time.
function listFor(date) {
  const sess = dayBlocks(date)
    .sort((a, b) => a.start.localeCompare(b.start) || a.hall.localeCompare(b.hall));
  if (!sess.length) return '<p class="empty">일정이 없습니다.</p>';

  let out = '', last = '';
  sess.forEach(s => {
    if (s.start !== last) {
      if (last) out += '</div>';
      last = s.start;
      out += `<h3 class="sub">${esc(s.start)}</h3><div class="rows">`;
    }
    out += `<div class="row"><span class="bar"></span>
      <button class="open main" data-session="${esc(blockKey(s))}">
        <span class="line1">${s.poster ? '<span class="tag">포스터</span>' : ''}
          <span class="code">${esc(s.trackCode || '')}</span>
          <span>${esc(s.start)}–${esc(s.end)}</span><span class="hall">${esc(s.hall)}</span></span>
        <span class="ttl">${esc(s.track)}</span>
        <span class="who">발표 ${s.n}건</span>
      </button><span></span></div>`;
  });
  return out + (last ? '</div>' : '');
}

function renderSched() {
  const date = DATA.days[schedDay].date;
  $('#s-sched').innerHTML = `
    <div class="page-h"><h2>일정</h2><span class="count">세션 ${dayBlocks(date).length}개</span></div>
    <div class="pills">${DATA.days.map((d, i) =>
      `<button data-day="${i}" aria-pressed="${i === schedDay}">${shortDay(d.date)} (${d.weekday})</button>`).join('')}</div>
    ${isWide() ? gridFor(date) : listFor(date)}`;
  setMeta(dayName(date));
}

/* ------------------------------------------------------------------ search */
let findType = 'all';
function matches(i) {
  if (findType === 'oral' && i.poster) return false;
  if (findType === 'poster' && !i.poster) return false;
  if (!query) return false;
  const q = query.toLowerCase();
  // divKo and typeKo are indexed so 고분자 and 포스터 find something; the rest
  // of the record is English.
  return (i.title + ' ' + i.presenter + ' ' + i.affiliation + ' ' + i.code + ' ' +
    i.track + ' ' + i.division + ' ' + (i.divKo || '') + ' ' + (i.typeKo || '') +
    ' ' + i.authors.join(' ')).toLowerCase().includes(q);
}
// The input is built once and never replaced: re-rendering it under a typing
// thumb loses the caret, and refocusing it reopens the phone keyboard.
function renderFind() {
  $('#s-find').innerHTML = `
    <div class="page-h"><h2>검색</h2><span class="count">발표 ${ITEMS.length.toLocaleString()}건</span></div>
    <div class="searchrow">
      <label class="searchbox">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
        <input id="q" value="${esc(query)}" placeholder="제목, 발표자, 소속, 분과, 코드" aria-label="검색">
      </label>
    </div>
    <div class="pills">${[['all', '전체'], ['oral', '구두·심포지엄'], ['poster', '포스터']].map(([k, t]) =>
      `<button data-ft="${k}" aria-pressed="${findType === k}">${t}</button>`).join('')}</div>
    <div id="findOut"></div>`;
  renderFindResults();
  setMeta('고분자, KAIST, perovskite …');
}
function renderFindResults() {
  const hits = query ? ITEMS.filter(matches) : [];
  const cap = isWide() ? 150 : 60;
  const shown = hits.slice(0, cap);
  $('#findOut').innerHTML = `
    ${query ? `<p class="hits">${hits.length}건${hits.length > shown.length ? ` · 상위 ${shown.length}건 표시` : ''}</p>` : ''}
    ${shown.length ? listing(shown, { showDate: true })
      : `<p class="empty">${query ? `“${esc(query)}”에 맞는 발표가 없습니다.` : '제목, 발표자, 소속, 분과로 찾을 수 있습니다.'}</p>`}`;
}

/* ------------------------------------------------------------------ plan */
function renderPlan() {
  const list = planItems(), bad = clashes();
  const chunks = [];
  list.forEach(i => {
    if (!chunks.length || chunks[chunks.length - 1].date !== i.date) chunks.push({ date: i.date, items: [] });
    chunks[chunks.length - 1].items.push(i);
  });
  const body = chunks.map(c =>
    `<h3 class="sub">${esc(dayName(c.date))}</h3>` +
    listing(c.items, {})).join('');

  $('#s-plan').innerHTML = `
    <div class="page-h"><h2>내 일정</h2><span class="count">${list.length}건</span></div>
    <div class="planbar">
      <span>담은 발표 <b>${list.length}</b>건${bad.size ? ` · 겹침 ${bad.size / 2 | 0}건` : ''}</span>
      ${list.length ? `<span style="display:flex;gap:8px">
        <button class="btn" id="copyLink">링크 복사</button>
        <button class="btn" id="clearPlan">비우기</button></span>` : ''}
    </div>
    ${arrived !== null ? `<div class="notice">${arrived
      ? `링크에서 ${arrived}건을 가져왔습니다.` : '링크에 이미 담겨 있던 것뿐이었습니다.'}</div>` : ''}
    ${bad.size ? `<div class="notice bad"><b>${bad.size / 2 | 0}건이 겹칩니다.</b>
      같은 시간에 서로 다른 회장의 발표를 담았습니다. 한쪽을 빼 주세요.</div>` : ''}
    ${list.length ? body
      : '<p class="empty">아직 담은 발표가 없습니다.<br>검색이나 일정에서 ☆ 를 눌러 담아 보세요.</p>'}
    ${list.length ? `<h3 class="sub">다른 기기로 보내기</h3>
      <p class="lede">일정은 이 브라우저에만 저장됩니다. 아래 링크가 일정 자체를 담고 있어서,
        폰에서 열면 그 기기에 있던 것과 합쳐집니다.</p>
      <div class="linkrow"><input id="linkField" readonly value="${esc(planLink())}"></div>` : ''}`;
  setMeta(list.length ? `담은 발표 ${list.length}건` : '아직 비어 있음');
}

/* ------------------------------------------------------------------ posters */
let pSess = 1;
function renderPoster() {
  const cur = DATA.posterSessions.find(p => p.n === pSess) || DATA.posterSessions[0];
  const list = ITEMS.filter(i => i.poster === cur.n)
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  const cap = isWide() ? 200 : 80;
  $('#s-poster').innerHTML = `
    <div class="page-h"><h2>포스터</h2>
      <span class="count">${POSTERS}건 · 전체 발표의 ${Math.round(POSTERS / ITEMS.length * 100)}%</span></div>
    <div class="pills">${DATA.posterSessions.map(p =>
      `<button data-ps="${p.n}" aria-pressed="${p.n === cur.n}">Poster ${p.n} · ${shortDay(p.date)} ${p.start}</button>`).join('')}</div>
    <h3 class="sub">Poster ${cur.n} · ${esc(dayName(cur.date))} ${esc(cur.start)}–${esc(cur.end)} · ${esc(cur.divisions.join(' · '))} · ${cur.count}건</h3>
    ${listing(list.slice(0, cap))}
    ${list.length > cap ? `<p class="hits" style="margin-top:10px">${list.length}건 중 ${cap}건 표시 — 검색에서 좁혀 보세요.</p>` : ''}`;
  setMeta(`Poster ${cur.n} · ${cur.count}건`);
}

/* ------------------------------------------------------------------ detail */
function openSheet(html) {
  $('#sheetIn').innerHTML = html;
  const d = $('#sheet');
  if (d.showModal) d.showModal(); else d.setAttribute('open', '');
}
function showItem(id) {
  const i = BY_ID.get(id);
  if (!i) return;
  const on = plan.has(i.id);
  openSheet(`
    <h3>${esc(i.title)}</h3>
    <div class="acts"><button class="btn ${on ? '' : 'primary'}" data-pick="${esc(i.id)}" data-on="${on ? 1 : 0}">
      ${on ? '내 일정에서 빼기' : '내 일정에 담기'}</button></div>
    <dl>
      <dt>발표자</dt><dd>${esc(i.presenter)}${i.affiliation ? ` · ${esc(i.affiliation)}` : ''}</dd>
      ${i.authors.length > 1 ? `<dt>저자</dt><dd>${esc(i.authors.join(', '))}</dd>` : ''}
      <dt>시간</dt><dd>${esc(dayName(i.date))} ${esc(i.start)}–${esc(i.end)}</dd>
      <dt>장소</dt><dd>${esc(i.hall)}</dd>
      <dt>세션</dt><dd>${esc(i.track)}</dd>
      <dt>분과</dt><dd>${esc(i.division)}${i.divKo ? ` (${esc(i.divKo)})` : ''}</dd>
      <dt>코드</dt><dd>${esc(i.code)} · ${esc(i.typeKo || i.type)}</dd>
    </dl>
    ${i.abstract ? `<p class="abs">${esc(i.abstract.trim())}</p>` : ''}`);
}
function showSession(key) {
  let list, title, sub;
  if (/^P\d+$/.test(key)) {
    const n = +key.slice(1), p = DATA.posterSessions.find(x => x.n === n);
    list = ITEMS.filter(i => i.poster === n).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
    title = `Poster Presentation ${n}`;
    sub = `${dayName(p.date)} ${p.start}–${p.end} · Exhibition Hall · ${list.length}건`;
  } else {
    const [track, date, hall] = key.split('|');
    list = ITEMS.filter(i => i.track === track && i.date === date && i.hall === hall)
      .sort((a, b) => a.start.localeCompare(b.start));
    title = track;
    sub = `${dayName(date)} · ${hall} · ${list.length}건`;
  }
  openSheet(`<h3>${esc(title)}</h3><p class="lede">${esc(sub)}</p>${listing(list.slice(0, 80))}`);
}

/* ------------------------------------------------------------------ shell */
let view = 'now';
const TABS = [['now', '지금'], ['sched', '일정'], ['find', '검색'], ['plan', '내 일정'], ['poster', '포스터']];
const RENDER = { now: renderNow, sched: renderSched, find: renderFind, plan: renderPlan, poster: renderPoster };
const setMeta = t => { $('#meta').textContent = t; };
function render() { RENDER[view](); }
function show(v) {
  view = v;
  $$('nav.tabs button, .topnav button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.s === v)));
  $$('.screen').forEach(s => { s.hidden = s.id !== 's-' + v; });
  render();
  scrollTo({ top: 0 });
}

$('.topnav').innerHTML = TABS.map(([s, t]) =>
  `<button role="tab" data-s="${s}" aria-selected="${s === 'now'}">${t}</button>`).join('');

document.addEventListener('click', ev => {
  const pick = ev.target.closest('[data-pick]');
  if (pick) {
    const id = pick.dataset.pick;
    plan.has(id) ? plan.delete(id) : plan.add(id);
    savePlan();
    if ($('#sheet').open) $('#sheet').close();
    // Repaint the stars in place; a full re-render would throw away the scroll
    // position someone just spent a swipe earning.
    const on = plan.has(id);
    $$(`[data-pick="${CSS.escape(id)}"]`).forEach(b => {
      b.dataset.on = on ? 1 : 0;
      if (b.classList.contains('star')) b.textContent = on ? '★' : '☆';
      const r = b.closest('.row, tr');
      if (r) r.classList.toggle('on', on);
    });
    if (view === 'plan' || view === 'now') render();
    return;
  }
  const open = ev.target.closest('[data-open]');
  if (open) { showItem(open.dataset.open); return; }
  const sess = ev.target.closest('[data-session]');
  if (sess) { showSession(sess.dataset.session); return; }
  const tab = ev.target.closest('nav.tabs button, .topnav button');
  if (tab) { show(tab.dataset.s); return; }
  const day = ev.target.closest('[data-day]');
  if (day) { schedDay = +day.dataset.day; renderSched(); return; }
  const ft = ev.target.closest('[data-ft]');
  if (ft) { findType = ft.dataset.ft; renderFind(); return; }
  const ps = ev.target.closest('[data-ps]');
  if (ps) { pSess = +ps.dataset.ps; renderPoster(); scrollTo({ top: 0 }); return; }
  if (ev.target.id === 'clearPlan') { plan.clear(); savePlan(); arrived = null; render(); return; }
  if (ev.target.id === 'copyLink') {
    const f = $('#linkField');
    f.select();
    const done = () => { ev.target.textContent = '복사됨'; setTimeout(() => { ev.target.textContent = '링크 복사'; }, 1600); };
    if (navigator.clipboard) navigator.clipboard.writeText(f.value).then(done, done);
    else { try { document.execCommand('copy'); } catch (e) { } done(); }
    return;
  }
  if (ev.target === $('#sheet')) $('#sheet').close();
});

document.addEventListener('input', ev => {
  if (ev.target.id !== 'q') return;
  clearTimeout(window.__deb);
  const v = ev.target.value;
  window.__deb = setTimeout(() => { query = v.trim(); renderFindResults(); }, 160);
});

loadPlan();
arrived = readLink();
$('#brandTtl').textContent = DATA.event.name;
show(arrived !== null ? 'plan' : 'now');
setInterval(() => { if (view === 'now') renderNow(); }, 60000);

// Crossing the breakpoint swaps the layout, not just the spacing, so re-render.
// matchMedia's change event is the cheap signal but it does not always arrive -
// it stayed silent through a 1440 -> 375 resize in testing, leaving the hall
// grid on a phone - so resize is the one actually relied on, and it only fires
// a render when the breakpoint truly flipped.
let wasWide = isWide();
function onViewportChange() {
  if (isWide() === wasWide) return;
  wasWide = isWide();
  render();
}
if (window.matchMedia) {
  const mq = window.matchMedia(WIDE);
  mq.addEventListener ? mq.addEventListener('change', onViewportChange)
    : mq.addListener(onViewportChange);
}
let rsz;
addEventListener('resize', () => {
  clearTimeout(rsz);
  rsz = setTimeout(onViewportChange, 150);
});
