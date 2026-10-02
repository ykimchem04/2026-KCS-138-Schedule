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

/* ------------------------------------------------------------------ plan */
// Kept in this browser. localStorage is per-device, so the share link below is
// the only way a plan reaches a phone; it carries the ids, not a reference.
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
function planLink() {
  return `${location.origin}${location.pathname}#p=${[...plan].map(id => id.replace('kcs138_', '')).join(',')}`;
}
function readLink() {
  const m = /[#&]p=([^&]*)/.exec(location.hash);
  if (!m) return null;
  let added = 0;
  decodeURIComponent(m[1]).split(',').filter(Boolean).forEach(n => {
    const id = 'kcs138_' + n;
    if (BY_ID.has(id) && !plan.has(id)) { plan.add(id); added++; }
  });
  savePlan();
  try { history.replaceState(null, '', location.pathname + location.search); }
  catch (e) { /* file:// in some browsers */ }
  return added;
}
const planItems = () => [...plan].map(id => BY_ID.get(id)).filter(Boolean)
  .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));

// Two picks overlapping in different halls cannot both happen.
function clashes() {
  const list = planItems(), bad = new Set();
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (a.date !== b.date || a.hall === b.hall) continue;
      if (mins(a.start) < mins(b.end) && mins(b.start) < mins(a.end)) {
        bad.add(a.id); bad.add(b.id);
      }
    }
  return bad;
}

/* ------------------------------------------------------------------ clock */
// Out of conference week the live clock is useless, so Now pins to the first
// day instead of showing an empty screen for the three weeks before it.
const FIRST = DATA.days[0].date, LAST = DATA.days[DATA.days.length - 1].date;
function nowRef() {
  const d = new Date();
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (iso >= FIRST && iso <= LAST) {
    return { date: iso, m: d.getHours() * 60 + d.getMinutes(), live: true };
  }
  return { date: FIRST, m: 9 * 60, live: false };
}

/* ------------------------------------------------------------------ cards */
let query = '';
function hi(text) {
  const t = esc(text);
  if (!query) return t;
  return t.replace(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig'), '<mark>$1</mark>');
}

function card(it, opts = {}) {
  const on = plan.has(it.id);
  const when = opts.showDate ? `${shortDay(it.date)} ${it.start}–${it.end}` : `${it.start}–${it.end}`;
  const pills = (opts.pills || []).map(p => `<span class="pill ${p.k}">${esc(p.t)}</span>`).join('');
  return `<div class="card" style="--dc:var(--${esc(it.div)})">
    <div class="rail"></div>
    <div class="body">
      <div class="top-row">
        <div class="meta">${pills}<span class="code">${esc(it.code)}</span>
          <span>${esc(when)}</span><span class="hall">${esc(it.hall)}</span></div>
        <button class="star" data-pick="${esc(it.id)}" data-on="${on ? 1 : 0}"
          aria-label="${on ? '내 일정에서 빼기' : '내 일정에 담기'}">${on ? '★' : '☆'}</button>
      </div>
      <button class="open" data-open="${esc(it.id)}"
        style="all:unset;cursor:pointer;display:block;width:100%">
        <div class="ttl">${hi(it.title)}</div>
        <div class="who">${hi(it.presenter)}${it.affiliation ? ' · ' + hi(it.affiliation) : ''}</div>
      </button>
    </div>
  </div>`;
}

/* ------------------------------------------------------------------ now */
function renderNow() {
  const ref = nowRef();
  const today = ITEMS.filter(i => i.date === ref.date);
  const live = today.filter(i => mins(i.start) <= ref.m && ref.m < mins(i.end));
  const soon = today.filter(i => mins(i.start) > ref.m)
    .sort((a, b) => mins(a.start) - mins(b.start));
  const nextStart = soon.length ? mins(soon[0].start) : null;
  const upcoming = soon.filter(i => mins(i.start) === nextStart).slice(0, 8);

  const mine = planItems().filter(i => i.date > ref.date ||
    (i.date === ref.date && mins(i.end) > ref.m));
  const head = mine.length ? (() => {
    const n = mine[0], away = n.date === ref.date ? mins(n.start) - ref.m : null;
    const label = away === null ? dayName(n.date)
      : away <= 0 ? '진행 중' : away < 60 ? `${away}분 뒤` : `${Math.floor(away / 60)}시간 ${away % 60}분 뒤`;
    return `<div class="nowhead">
      <div class="lab">내 다음 일정</div>
      <div class="big">${esc(n.title)}</div>
      <div class="sub">${esc(n.code)} · ${esc(n.hall)} · ${esc(n.start)}–${esc(n.end)} · ${esc(label)}</div>
    </div>`;
  })() : '';

  const live9 = live.filter(i => !i.poster).slice(0, 10);
  const posterNow = live.filter(i => i.poster);

  $('#s-now').innerHTML = `
    ${ref.live ? '' : `<p class="sec-note">학회는 ${dayName(FIRST)}에 시작합니다. 첫날 오전 기준으로 보여 드립니다.</p>`}
    ${head}
    <h2 class="sec">진행 중 ${live.length ? `· ${live.length}건` : ''}</h2>
    ${posterNow.length ? `<p class="sec-note">포스터 ${posterNow.length}건이 Exhibition Hall에서 진행 중입니다.</p>` : ''}
    <div class="stack">${live9.length
      ? live9.map(i => card(i, { pills: [{ k: 'now', t: '진행 중' }] })).join('')
      : '<p class="empty">이 시간에 진행 중인 발표가 없습니다.</p>'}</div>
    <h2 class="sec">곧 시작</h2>
    <div class="stack">${upcoming.length
      ? upcoming.map(i => card(i, { pills: [{ k: 'soon', t: i.start }] })).join('')
      : '<p class="empty">남은 일정이 없습니다.</p>'}</div>`;
  setSub(`${live.length}건 진행 중 · ${upcoming.length}건 곧 시작`);
}

/* ------------------------------------------------------------------ schedule */
let schedDay = 0;
function renderSched() {
  const date = DATA.days[schedDay].date;
  const sess = DATA.sessions.filter(s => s.date === date);
  const posters = DATA.posterSessions.filter(p => p.date === date);
  const rows = [...sess.map(s => ({ ...s, kind: 'session' })),
  ...posters.map(p => ({
    ...p, kind: 'poster', track: `Poster Presentation ${p.n}`,
    hall: 'Exhibition Hall', div: 'KCS', n: p.count,
  }))].sort((a, b) => a.start.localeCompare(b.start));

  let last = '', out = '';
  rows.forEach(r => {
    if (r.start !== last) { last = r.start; out += `<div class="slot">${esc(r.start)}</div><div class="stack">`; }
    out += `<div class="card" style="--dc:var(--${esc(r.div)})">
      <div class="rail"></div>
      <button class="open" data-session="${esc(r.kind === 'poster' ? 'P' + r.n : r.track + '|' + r.date + '|' + r.hall)}"
        style="all:unset;cursor:pointer;display:block;width:100%">
        <div class="body">
          <div class="meta">${r.kind === 'poster' ? '<span class="pill">포스터</span>' : ''}
            <span class="code">${esc(r.trackCode || r.divisions?.join(' · ') || '')}</span>
            <span>${esc(r.start)}–${esc(r.end)}</span><span class="hall">${esc(r.hall)}</span></div>
          <div class="ttl">${esc(r.track)}</div>
          <div class="who">발표 ${r.n}건</div>
        </div>
      </button></div>`;
    const next = rows[rows.indexOf(r) + 1];
    if (!next || next.start !== last) out += '</div>';
  });

  $('#s-sched').innerHTML = `
    <div class="days">${DATA.days.map((d, i) =>
    `<button data-day="${i}" aria-pressed="${i === schedDay}">${shortDay(d.date)}<i>${d.weekday}</i></button>`).join('')}</div>
    ${out || '<p class="empty">일정이 없습니다.</p>'}`;
  setSub(`${dayName(date)} · 세션 ${rows.length}개`);
}

/* ------------------------------------------------------------------ search */
let findType = 'all';
function matches(i) {
  if (findType === 'oral' && i.poster) return false;
  if (findType === 'poster' && !i.poster) return false;
  if (!query) return false;
  const q = query.toLowerCase();
  // divKo and typeKo are here so 고분자 and 포스터 find something; the rest of
  // the record is English.
  return (i.title + ' ' + i.presenter + ' ' + i.affiliation + ' ' + i.code + ' ' +
    i.track + ' ' + i.division + ' ' + (i.divKo || '') + ' ' + (i.typeKo || '') +
    ' ' + i.authors.join(' ')).toLowerCase().includes(q);
}
// The input is built once and never replaced. Re-rendering it under a typing
// thumb loses the caret, and re-focusing it afterwards reopens the phone
// keyboard every time someone stars a result.
function renderFind() {
  $('#s-find').innerHTML = `
    <div class="searchbox">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
      <input id="q" value="${esc(query)}" placeholder="제목, 발표자, 소속, 코드" aria-label="검색">
    </div>
    <div class="filters">
      ${[['all', '전체'], ['oral', '구두·심포지엄'], ['poster', '포스터']].map(([k, t]) =>
      `<button class="chip" data-ft="${k}" aria-pressed="${findType === k}">${t}</button>`).join('')}
    </div>
    <div id="findOut"></div>`;
  renderFindResults();
  setSub(`발표 ${ITEMS.length.toLocaleString()}건에서 찾기`);
}

function renderFindResults() {
  const hits = query ? ITEMS.filter(matches) : [];
  const shown = hits.slice(0, 60);
  $('#findOut').innerHTML = `
    ${query ? `<p class="hits">${hits.length}건${hits.length > shown.length ? ` · 상위 ${shown.length}건 표시` : ''}</p>` : ''}
    <div class="stack">${shown.length ? shown.map(i => card(i, { showDate: true })).join('')
      : `<p class="empty">${query ? `“${esc(query)}”에 맞는 발표가 없습니다.` : `발표 ${ITEMS.length.toLocaleString()}건에서 찾습니다.`}</p>`}</div>`;
}

/* ------------------------------------------------------------------ plan */
function renderPlan() {
  const list = planItems(), bad = clashes();
  let out = '', last = '';
  list.forEach(i => {
    if (i.date !== last) { if (last) out += '</div>'; last = i.date; out += `<div class="slot">${dayName(i.date)}</div><div class="stack">`; }
    out += card(i, { pills: bad.has(i.id) ? [{ k: 'clash', t: '겹침' }] : [] });
  });
  if (last) out += '</div>';

  $('#s-plan').innerHTML = `
    <div class="planbar">
      <span>담은 발표 <b>${list.length}</b></span>
      ${list.length ? `<span style="display:flex;gap:6px">
        <button class="btn" id="copyLink">링크 복사</button>
        <button class="btn" id="clearPlan">비우기</button></span>` : ''}
    </div>
    ${arrived !== null ? `<div class="warnbox" style="border-color:var(--accent);background:var(--accent-soft)">
      ${arrived ? `링크에서 ${arrived}건을 가져왔습니다.` : '링크에 이미 담겨 있던 것뿐이었습니다.'}</div>` : ''}
    ${bad.size ? `<div class="warnbox"><b>${bad.size / 2 | 0}건이 겹칩니다.</b>
      같은 시간에 두 곳에 있을 수 없습니다 — 한쪽을 빼 주세요.</div>` : ''}
    ${list.length ? out : `<p class="empty">아직 담은 발표가 없습니다.<br>검색이나 일정에서 ☆ 를 눌러 담아 보세요.</p>`}
    ${list.length ? `<h2 class="sec" style="margin-top:24px">폰으로 보내기</h2>
      <p class="sec-note">일정은 이 브라우저에만 저장됩니다. 아래 링크가 일정 자체를 담고 있어서, 다른 기기에서 열면 합쳐집니다.</p>
      <div class="sharebox"><input id="linkField" readonly value="${esc(planLink())}"></div>` : ''}`;
  setSub(list.length ? `담은 발표 ${list.length}건${bad.size ? ` · 겹침 ${bad.size / 2 | 0}건` : ''}` : '아직 비어 있음');
}

/* ------------------------------------------------------------------ posters */
let pSess = 1;
function renderPoster() {
  const sess = DATA.posterSessions;
  const cur = sess.find(p => p.n === pSess) || sess[0];
  const list = ITEMS.filter(i => i.poster === cur.n)
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  $('#s-poster').innerHTML = `
    <h2 class="sec">포스터 세션</h2>
    <p class="sec-note">전체 ${ITEMS.filter(i => i.poster).length}건 — 발표의 ${Math.round(ITEMS.filter(i => i.poster).length / ITEMS.length * 100)}%가 포스터입니다.</p>
    <div class="psess">${sess.map(p => `
      <button data-ps="${p.n}" aria-pressed="${p.n === cur.n}">
        <span class="n">Poster ${p.n}</span>
        <span class="t">${shortDay(p.date)} ${p.start}–${p.end}</span>
        <span class="divs">${p.divisions.map(d => `<span class="pill" style="color:var(--${d})">${d}</span>`).join('')}
          <span class="pill">${p.count}건</span></span>
      </button>`).join('')}</div>
    <h2 class="sec">Poster ${cur.n} · 보드 번호순</h2>
    <div class="stack">${list.slice(0, 80).map(i => card(i)).join('')}</div>
    ${list.length > 80 ? `<p class="hits" style="margin-top:12px">${list.length}건 중 80건 표시 — 검색 탭에서 좁혀 보세요.</p>` : ''}`;
  setSub(`Poster ${cur.n} · ${cur.count}건`);
}

/* ------------------------------------------------------------------ sheet */
function openSheet(html) {
  $('#sheetIn').innerHTML = `<div class="grab"></div>${html}`;
  const d = $('#sheet');
  if (d.showModal) d.showModal(); else d.setAttribute('open', '');
}
function showItem(id) {
  const i = BY_ID.get(id);
  if (!i) return;
  const on = plan.has(i.id);
  openSheet(`
    <h3>${esc(i.title)}</h3>
    <div class="acts">
      <button class="btn ${on ? '' : 'primary'}" data-pick="${esc(i.id)}" data-on="${on ? 1 : 0}">
        ${on ? '내 일정에서 빼기' : '내 일정에 담기'}</button>
    </div>
    <dl>
      <dt>발표자</dt><dd>${esc(i.presenter)}${i.affiliation ? ` · ${esc(i.affiliation)}` : ''}</dd>
      ${i.authors.length > 1 ? `<dt>저자</dt><dd>${esc(i.authors.join(', '))}</dd>` : ''}
      <dt>시간</dt><dd>${dayName(i.date)} ${esc(i.start)}–${esc(i.end)}</dd>
      <dt>장소</dt><dd>${esc(i.hall)}</dd>
      <dt>세션</dt><dd>${esc(i.track)}</dd>
      <dt>분과</dt><dd>${esc(i.division)}</dd>
      <dt>코드</dt><dd>${esc(i.code)} · ${esc(i.typeKo || i.type)}</dd>
    </dl>
    ${i.abstract ? `<p class="abs">${esc(i.abstract.trim())}</p>` : ''}`);
}
function showSession(key) {
  let list, title, sub;
  if (key[0] === 'P' && /^\d+$/.test(key.slice(1))) {
    const n = +key.slice(1), p = DATA.posterSessions.find(x => x.n === n);
    list = ITEMS.filter(i => i.poster === n)
      .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
    title = `Poster Presentation ${n}`;
    sub = `${dayName(p.date)} ${p.start}–${p.end} · Exhibition Hall · ${list.length}건`;
  } else {
    const [track, date, hall] = key.split('|');
    list = ITEMS.filter(i => i.track === track && i.date === date && i.hall === hall)
      .sort((a, b) => a.start.localeCompare(b.start));
    title = track;
    sub = `${dayName(date)} · ${hall} · ${list.length}건`;
  }
  openSheet(`<h3>${esc(title)}</h3><p class="sec-note">${esc(sub)}</p>
    <div class="stack" style="margin-top:12px">${list.slice(0, 60).map(i => card(i)).join('')}</div>`);
}

/* ------------------------------------------------------------------ shell */
let view = 'now';
const TITLES = { now: '지금', sched: '일정', find: '검색', plan: '내 일정', poster: '포스터' };
const setSub = t => { $('#scrSub').textContent = t; };
const RENDER = { now: renderNow, sched: renderSched, find: renderFind, plan: renderPlan, poster: renderPoster };
function render() { RENDER[view](); }
function show(v) {
  view = v;
  $('#scrTitle').textContent = TITLES[v];
  $$('nav.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.s === v)));
  $$('.screen').forEach(s => { s.hidden = s.id !== 's-' + v; });
  render();
  scrollTo({ top: 0 });
}

document.addEventListener('click', ev => {
  const pick = ev.target.closest('[data-pick]');
  if (pick) {
    const id = pick.dataset.pick;
    plan.has(id) ? plan.delete(id) : plan.add(id);
    savePlan();
    if ($('#sheet').open) $('#sheet').close();
    // Repaint the stars in place. A full re-render here would throw away the
    // scroll position someone just spent a thumb-swipe earning.
    const on = plan.has(id);
    $$(`[data-pick="${CSS.escape(id)}"]`).forEach(b => {
      b.dataset.on = on ? 1 : 0;
      if (b.classList.contains('star')) b.textContent = on ? '★' : '☆';
    });
    if (view === 'plan' || view === 'now') render(); else setSub($('#scrSub').textContent);
    return;
  }
  const open = ev.target.closest('[data-open]');
  if (open) { showItem(open.dataset.open); return; }
  const sess = ev.target.closest('[data-session]');
  if (sess) { showSession(sess.dataset.session); return; }
  const tab = ev.target.closest('nav.tabs button');
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

function tickClock() {
  const r = nowRef();
  $('#clock').textContent = r.live
    ? new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
    : `D-${Math.max(0, Math.round((new Date(FIRST + 'T09:00') - Date.now()) / 86400000))}`;
}

loadPlan();
arrived = readLink();
tickClock();
setInterval(tickClock, 30000);
show(arrived !== null ? 'plan' : 'now');
