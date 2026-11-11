(() => {
/* refuse to run inside another site's frame (clickjacking) */
if (window.top !== window.self && /\.github\.io$/.test(location.hostname)) { document.documentElement.innerHTML = ''; return; }
const $ = id => document.getElementById(id);
const escH = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TICK = /^[A-Z0-9][A-Z0-9.\/:-]{0,14}$/;
const store = {
  get(k, d) { try { const v = localStorage.getItem('sb_' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('sb_' + k, JSON.stringify(v)); } catch {} }
};
const PPY = { '5min': 252 * 78, '15min': 252 * 26, '1h': 252 * 7, '4h': 252 * 2, '1day': 252, '1week': 52 };
const fmt = (x, d = 2) => x == null || isNaN(x) ? '—' : Number(x).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
const money = x => '$' + fmt(x);
let state = { live: false, sym: store.get('sym', 'AAPL'), intv: store.get('intv', '1day'), B: null, ind: null, src: '', ivOverride: null };
let watch = (store.get('watch', null) || ['AAPL', 'NVDA', 'TSLA', 'SPY', 'QQQ', 'MSFT', 'AMD', 'BTC/USD']).filter(x => TICK.test(x));
let show = store.get('show', { e20: true, e50: true, e200: true, bb: false, pat: true, lv: true });


/* ---------- Accounts (Firebase Auth) + server API (Cloudflare Worker) ---------- */
const CFG = window.WICKD_CONFIG || {};
const CONFIGURED = !!(CFG.firebaseApiKey && CFG.workerUrl && !/PASTE|YOUR/i.test(CFG.firebaseApiKey + CFG.workerUrl));
['key', 'gem'].forEach(k => { try { localStorage.removeItem('sb_' + k); } catch {} }); // purge keys older versions stored in the browser
const AUTH = { id: null, exp: 0, rt: store.get('rt', ''), me: null };
const AUTH_ERR = { EMAIL_EXISTS: 'That email already has an account. Sign in instead.', INVALID_LOGIN_CREDENTIALS: 'Wrong email or password.', EMAIL_NOT_FOUND: 'Wrong email or password.',
  INVALID_PASSWORD: 'Wrong email or password.', USER_DISABLED: 'This account is disabled.', TOO_MANY_ATTEMPTS_TRY_LATER: 'Too many tries. Wait a few minutes.',
  WEAK_PASSWORD: 'Password too weak.', INVALID_EMAIL: 'That email looks wrong.', MISSING_PASSWORD: 'Enter your password.', OPERATION_NOT_ALLOWED: 'That sign-in method is not turned on yet (admin setup).', INVALID_IDP_RESPONSE: 'Google sign-in failed. Try again.', FEDERATED_USER_ID_ALREADY_LINKED: 'That Google account is linked to another user.' };
async function idt(path, body) {
  const r = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:' + path + '?key=' + encodeURIComponent(CFG.firebaseApiKey),
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const code = String((j.error && j.error.message) || '').split(/[ :]/)[0]; throw new Error(AUTH_ERR[code] || 'Sign-in problem. Try again.'); }
  return j;
}
function setSession(id, rt, exp) { AUTH.id = id; AUTH.exp = Date.now() + (+exp || 3600) * 1000; if (rt) { AUTH.rt = rt; store.set('rt', rt); } }
async function refreshSession() {
  if (!AUTH.rt) throw Object.assign(new Error('Please sign in.'), { status: 401 });
  const r = await fetch('https://securetoken.googleapis.com/v1/token?key=' + encodeURIComponent(CFG.firebaseApiKey),
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(AUTH.rt) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { clearSession(); throw Object.assign(new Error('Please sign in again.'), { status: 401 }); }
  setSession(j.id_token, j.refresh_token, j.expires_in);
}
async function idToken(force) { if (force || !AUTH.id || Date.now() > AUTH.exp - 60000) await refreshSession(); return AUTH.id; }
function clearSession() { try { window.google && google.accounts && google.accounts.id.disableAutoSelect(); } catch {} AUTH.id = null; AUTH.rt = ''; AUTH.me = null; store.set('rt', ''); state.live = false; }
async function api(path, opts = {}) {
  const t = await idToken();
  const r = await fetch(CFG.workerUrl.replace(/\/+$/, '') + path, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + t } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const m = j.error && (j.error.message || j.error); throw Object.assign(new Error(typeof m === 'string' ? m : 'Server error ' + r.status), { status: r.status, body: j }); }
  return j;
}

/* ---------- Data ---------- */
async function fetchTD(sym, intv) {
  const j = await api(`/td?symbol=${encodeURIComponent(sym)}&interval=${intv}&outputsize=500`);
  if (j.status === 'error' || !j.values) throw new Error(j.message || 'No data returned');
  const intraday = !['1day', '1week'].includes(intv);
  const B = j.values.slice().reverse().map(v => ({
    t: intraday ? Math.floor(Date.parse(v.datetime.replace(' ', 'T') + 'Z') / 1000) : v.datetime.slice(0, 10),
    o: +v.open, h: +v.high, l: +v.low, c: +v.close, v: +(v.volume || 0)
  })).filter(b => b.c > 0);
  return { B, name: j.meta && (j.meta.exchange || '') };
}
function demo(sym, intv) {
  let s = [...sym].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) % 2147483647 || 1;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const n = 500, intraday = !['1day', '1week'].includes(intv);
  const step = { '5min': 300, '15min': 900, '1h': 3600, '4h': 14400, '1day': 86400, '1week': 604800 }[intv];
  const vol = 0.022 * Math.sqrt(step / 86400), B = [];
  let p = 50 + (s % 400), drift = 0.0004, t = Math.floor(Date.now() / 1000 / step) * step - n * step;
  for (let i = 0; i < n; i++) {
    if (i % 60 === 0) drift = (rnd() - 0.45) * 0.004 * Math.sqrt(step / 86400);
    const o = p * (1 + gauss() * vol * 0.2), c = o * (1 + drift + gauss() * vol);
    const h = Math.max(o, c) * (1 + Math.abs(gauss()) * vol * 0.5), l = Math.min(o, c) * (1 - Math.abs(gauss()) * vol * 0.5);
    const d = new Date((t + i * step) * 1000);
    B.push({ t: intraday ? t + i * step : d.toISOString().slice(0, 10), o, h, l, c, v: Math.round(1e6 * (0.6 + rnd() + Math.abs(c - o) / o * 40)) });
    p = c;
  }
  return { B, name: 'demo' };
}

/* ---------- Charts ---------- */
const LW = window.LightweightCharts;
const base = { autoSize: true, layout: { background: { color: 'transparent' }, textColor: '#8b98a8', fontFamily: 'Inter' },
  grid: { vertLines: { color: '#1a222d' }, horzLines: { color: '#1a222d' } }, rightPriceScale: { borderColor: '#232d3a' },
  timeScale: { borderColor: '#232d3a', timeVisible: true, secondsVisible: false }, crosshair: { mode: 0 } };
let C = null;
function initCharts() {
  if (!LW) { banner('Chart library failed to load — check your connection.', true); return; }
  const main = LW.createChart($('main'), base);
  const candles = main.addCandlestickSeries({ upColor: '#22c55e', downColor: '#ef4444', borderVisible: false, wickUpColor: '#22c55e', wickDownColor: '#ef4444' });
  const vol = main.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
  main.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
  const line = (color, w = 1.5, ch = main) => ch.addLineSeries({ color, lineWidth: w, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
  const e20 = line('#f59e0b'), e50 = line('#3b82f6'), e200 = line('#a78bfa', 2);
  const bbU = line('#64748b', 1), bbL = line('#64748b', 1), bbM = line('#475569', 1);
  const sub = (el, h) => LW.createChart(el, { ...base, timeScale: { ...base.timeScale, visible: h } });
  const rsiC = sub($('rsiC'), false), macdC = sub($('macdC'), true);
  const rsiL = line('#a78bfa', 1.5, rsiC);
  rsiL.createPriceLine({ price: 70, color: '#ef444488', lineStyle: 2, lineWidth: 1, axisLabelVisible: false });
  rsiL.createPriceLine({ price: 30, color: '#22c55e88', lineStyle: 2, lineWidth: 1, axisLabelVisible: false });
  const mH = macdC.addHistogramSeries({ lastValueVisible: false, priceLineVisible: false });
  const mL = line('#3b82f6', 1.5, macdC), mS = line('#f59e0b', 1.5, macdC);
  const all = [main, rsiC, macdC]; let syncing = false;
  all.forEach(ch => ch.timeScale().subscribeVisibleLogicalRangeChange(r => {
    if (syncing || !r) return; syncing = true; all.forEach(o => o !== ch && o.timeScale().setVisibleLogicalRange(r)); syncing = false;
  }));
  C = { main, candles, vol, e20, e50, e200, bbU, bbL, bbM, rsiC, rsiL, macdC, mH, mL, mS, priceLines: [] };
}
const ser = (B, arr) => B.map((b, i) => Engine.isNum(arr[i]) ? { time: b.t, value: arr[i] } : { time: b.t });

function drawCharts(B, ind, lv) {
  if (!C) return;
  C.candles.setData(B.map(b => ({ time: b.t, open: b.o, high: b.h, low: b.l, close: b.c })));
  C.vol.setData(B.map(b => ({ time: b.t, value: b.v, color: b.c >= b.o ? '#22c55e40' : '#ef444440' })));
  const set = (s, arr, on) => s.setData(on ? ser(B, arr) : []);
  set(C.e20, ind.e20, show.e20); set(C.e50, ind.e50, show.e50); set(C.e200, ind.e200, show.e200);
  set(C.bbU, ind.bb.up, show.bb); set(C.bbL, ind.bb.lo, show.bb); set(C.bbM, ind.bb.mid, show.bb);
  C.rsiL.setData(ser(B, ind.rsi));
  C.mL.setData(ser(B, ind.macd.m)); C.mS.setData(ser(B, ind.macd.s));
  C.mH.setData(B.map((b, i) => Engine.isNum(ind.macd.h[i]) ? { time: b.t, value: ind.macd.h[i], color: ind.macd.h[i] >= 0 ? '#22c55e99' : '#ef444499' } : { time: b.t }));
  const mk = [];
  if (show.pat) for (let i = Math.max(0, B.length - 60); i < B.length; i++) {
    const p = ind.pat[i].filter(x => x.bias && x.str >= 2).sort((a, b) => b.str - a.str)[0];
    if (p) mk.push({ time: B[i].t, position: p.bias > 0 ? 'belowBar' : 'aboveBar', color: p.bias > 0 ? '#22c55e' : '#ef4444', shape: p.bias > 0 ? 'arrowUp' : 'arrowDown', text: (p.str >= 3 || i >= B.length - 5) ? p.short : '' });
  }
  C.candles.setMarkers(mk);
  C.priceLines.forEach(pl => C.candles.removePriceLine(pl)); C.priceLines = [];
  if (show.lv) {
    lv.res.forEach(l => C.priceLines.push(C.candles.createPriceLine({ price: l.price, color: '#ef444477', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'R' })));
    lv.sup.forEach(l => C.priceLines.push(C.candles.createPriceLine({ price: l.price, color: '#22c55e77', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'S' })));
  }
  const n = B.length; C.main.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - 120), to: n + 3 });
}

/* ---------- Render ---------- */
function banner(msg, err) { const b = $('banner'); b.style.display = msg ? 'block' : 'none'; b.className = 'banner' + (err ? ' err' : ''); b.innerHTML = msg || ''; }

function render() {
  const { B, ind } = state, i = B.length - 1, c = ind.c[i], prev = ind.c[i - 1];
  const intraday = !['1day', '1week'].includes(state.intv);
  const { score, reasons } = Engine.scoreAt(ind, i), v = Engine.verdict(score);
  const A = ind.atr[i], lv = Engine.levels(B, A);
  $('symLbl').textContent = `${state.sym} · ${$('intv').selectedOptions[0].text}`;
  $('srcLbl').textContent = state.src;
  $('badge').className = 'badge ' + v.cls; $('badge').textContent = v.label;
  $('px').textContent = money(c);
  const ch = c - prev, chp = ch / prev * 100;
  $('chg').innerHTML = `<span class="${ch >= 0 ? 'up' : 'dn'}">${ch >= 0 ? '+' : ''}${fmt(ch)} (${ch >= 0 ? '+' : ''}${fmt(chp)}%)</span> <span style="color:var(--mut);font-weight:500">last bar</span>`;
  $('needle').style.left = (50 + score / 2) + '%';
  $('scoreLbl').textContent = `score ${score >= 0 ? '+' : ''}${score.toFixed(0)}`;
  $('reasons').innerHTML = reasons.slice(0, 8).map(r => `<li><b class="${r.w > 0 ? 'up' : r.w < 0 ? 'dn' : ''}">${r.w > 0 ? '+' : ''}${r.w.toFixed(1)}</b><span>${r.txt}</span></li>`).join('');

  // trade plan
  const dir = v.dir || (score >= 0 ? 1 : -1);
  const stop = c - dir * 1.5 * A, target = c + dir * 2.5 * A;
  const plan = [
    ['Bias', v.dir ? (v.dir > 0 ? 'Long' : 'Short') : 'Neutral — wait'],
    ['Entry (last close)', money(c)],
    [`Stop (1.5× ATR)`, money(stop)],
    [`Target (2.5× ATR)`, money(target)],
    ['Reward : risk', '1.67 : 1'],
    ['ATR (14)', money(A) + ` (${fmt(A / c * 100, 1)}%)`],
  ];
  $('plan').innerHTML = plan.map(([k, val]) => `<span>${k}</span><b>${val}</b>`).join('');
  $('resL').innerHTML = lv.res.length ? lv.res.map(l => `<p>${money(l.price)} <small style="color:var(--mut)">×${l.touches}</small></p>`).join('') : '<p style="color:var(--mut)">none nearby</p>';
  $('supL').innerHTML = lv.sup.length ? lv.sup.map(l => `<p>${money(l.price)} <small style="color:var(--mut)">×${l.touches}</small></p>`).join('') : '<p style="color:var(--mut)">none nearby</p>';

  // volatility + options
  const ppy = PPY[state.intv];
  const hv = Engine.histVol(ind.c, 20, ppy) || 0.3;
  const hvs = []; for (let j = Math.max(21, i - 252); j <= i; j++) hvs.push(Engine.histVol(ind.c, 20, ppy, j));
  const ivPct = hvs.length > 30 ? hvs.filter(x => x <= hv).length / hvs.length * 100 : null;
  const sigma = state.ivOverride ? state.ivOverride / 100 : hv;
  if (document.activeElement !== $('ivIn')) $('ivIn').value = (sigma * 100).toFixed(1);
  $('ivSrc').textContent = state.ivOverride ? '(your IV)' : '(20-bar historical — paste real IV from your broker for better estimates)';
  const o = Engine.optionsPlan({ S: c, score, sigma, target, stop, intraday, ivPct });
  if (o.none) $('opt').innerHTML = `<div class="optbig" style="color:var(--amber)">No trade</div><div class="note" style="margin:0">${o.reason}</div>`;
  else {
    const col = o.type === 'call' ? 'var(--green)' : 'var(--red)';
    $('opt').innerHTML = `
      <div class="optbig" style="color:${col}">BUY ${state.sym} $${fmt(o.K, o.K % 1 ? 1 : 0)} ${o.type.toUpperCase()} · ~${o.dte} DTE</div>
      <div class="kv">
        <span>Est. premium</span><b>${money(o.prem)} <small style="color:var(--mut)">(${money(o.prem * 100)}/contract)</small></b>
        <span>Delta</span><b>${fmt(o.delta)}</b>
        <span>Time decay (per contract/day)</span><b class="dn">-${money(Math.abs(o.theta * 100))}</b>
        <span>Breakeven at expiry</span><b>${money(o.be)}</b>
        <span>If target hit (mid-life)</span><b class="up">${money(o.atTarget)} (${o.atTarget >= o.prem ? '+' : ''}${fmt((o.atTarget / o.prem - 1) * 100, 0)}%)</b>
        <span>If stop hit (mid-life)</span><b class="dn">${money(o.atStop)} (${fmt((o.atStop / o.prem - 1) * 100, 0)}%)</b>
      </div>
      <div class="note"><b style="color:var(--txt)">Cheaper alternative — debit spread:</b> buy $${fmt(o.K, o.K % 1 ? 1 : 0)} / sell $${fmt(o.K2, o.K2 % 1 ? 1 : 0)} ${o.type}s ≈ ${money(o.spreadCost * 100)} risk for up to ${money(o.spreadMax * 100)} profit per spread.</div>
      <div class="note">${o.volNote} Pick the listed expiration closest to ${o.dte} days. ${o.strong ? 'Strong signal → slightly in-the-money strike (Δ≈0.60).' : 'Moderate signal → at-the-money strike (Δ≈0.50), extra time for the move.'} Exit if the stock hits the stop, regardless of the option price.</div>`;
  }

  // patterns
  const rec = [];
  for (let j = i; j >= Math.max(0, i - 20) && rec.length < 8; j--) ind.pat[j].forEach(p => rec.length < 8 && rec.push({ p, ago: i - j }));
  $('pats').innerHTML = rec.length ? rec.map(({ p, ago }) => `<div><span class="${p.bias > 0 ? 'up' : p.bias < 0 ? 'dn' : ''}" style="font-weight:600">${p.bias > 0 ? '▲' : p.bias < 0 ? '▼' : '•'} ${p.name}</span><span style="color:var(--mut)">${ago === 0 ? 'last bar' : ago === 1 ? '1 bar ago' : ago + ' bars ago'} · ${'★'.repeat(p.str) || '—'}</span></div>`).join('') : '<div style="color:var(--mut)">No patterns in the last 20 bars.</div>';

  renderBacktest();
  drawCharts(B, ind, lv);
  const bt = Engine.backtest(ind, 10);
  state.ctx = { sym: state.sym, tf: $('intv').selectedOptions[0].text, src: state.src, price: c, chgPct: chp, verdict: v.label, score: Math.round(score),
    reasons: reasons.slice(0, 8).map(r => `${r.w > 0 ? '+' : ''}${r.w.toFixed(1)} ${r.txt}`), plan: { stop, target, atr: A },
    resistance: lv.res.map(l => +l.price.toFixed(2)), support: lv.sup.map(l => +l.price.toFixed(2)),
    rsi: ind.rsi[i], hv: sigma, volPctile: ivPct, options: o.none ? 'no trade' : `${o.type} K=${o.K} ~${o.dte}DTE est prem ${o.prem.toFixed(2)} delta ${o.delta.toFixed(2)}; debit spread ${o.K}/${o.K2}`,
    recentPatterns: rec.map(x => `${x.p.name} (${x.ago} bars ago)`), backtest10: { buyWin: bt.long.n ? Math.round(bt.long.win / bt.long.n * 100) + '% of ' + bt.long.n : 'n/a', sellWin: bt.short.n ? Math.round(bt.short.win / bt.short.n * 100) + '% of ' + bt.short.n : 'n/a' } };
}
function renderBacktest() {
  const H = +$('hz').value, bt = Engine.backtest(state.ind, H);
  const pct = (a, b) => b ? (a / b * 100).toFixed(0) + '%' : '—';
  const avg = (s, n) => n ? ((s / n) * 100 >= 0 ? '+' : '') + ((s / n) * 100).toFixed(2) + '%' : '—';
  $('bt').innerHTML = `
    <div><b class="up">${pct(bt.long.win, bt.long.n)}</b><small>BUY signals right<br>${bt.long.n} signals · avg ${avg(bt.long.ret, bt.long.n)}</small></div>
    <div><b class="dn">${pct(bt.short.win, bt.short.n)}</b><small>SELL signals right<br>${bt.short.n} signals · avg ${avg(bt.short.ret, bt.short.n)}</small></div>
    <div><b>${(bt.baseline * 100 >= 0 ? '+' : '') + (bt.baseline * 100).toFixed(2)}%</b><small>avg ${H}-bar move<br>(buy & hold baseline)</small></div>`;
  $('btNote').textContent = `Every past bar on this chart was scored with the same rules, then checked ${H} bars later. If BUY signals don't beat the baseline here, this ticker doesn't respond well to these rules — trust the signal less.`;
}


/* ---------- Hot Today (day-trade scanner) ---------- */
const DEFAULT_HOT = 'TSLA NVDA AMD PLTR SMCI COIN MSTR HOOD SOFI MARA RIVN META AMZN AAPL SPY QQQ';
$('hotList').value = store.get('hot', DEFAULT_HOT);
$('acct').value = store.get('acct', '') || '';
function etNow() {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date());
  const g = t => (p.find(x => x.type === t) || {}).value;
  const h = +g('hour') % 24, m = +g('minute');
  return { wd: g('weekday'), m: h * 60 + m, txt: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} ET` };
}
function clock() {
  const n = etNow(), wk = !['Sat', 'Sun'].includes(n.wd);
  let st, col;
  const hm = x => `${Math.floor(x / 60)}h ${x % 60}m`;
  if (!wk) { st = 'Weekend — market closed'; col = '#64748b'; }
  else if (n.m < 570) { st = `Pre-market · opens in ${hm(570 - n.m)}`; col = '#f59e0b'; }
  else if (n.m < 585) { st = 'Open · opening range forming (wait till 9:45)'; col = '#f59e0b'; }
  else if (n.m < 900) { st = `Open · prime trading · ${hm(960 - n.m)} to close`; col = '#22c55e'; }
  else if (n.m < 960) { st = 'Last hour · no new trades · exit by 3:50'; col = '#ef4444'; }
  else { st = 'After hours — market closed'; col = '#64748b'; }
  $('mState').textContent = st; $('mDot').style.background = col; $('mTime').textContent = n.txt;
}
clock(); setInterval(clock, 30000);

function demoDay(sym) {
  let s = [...sym].reduce((a, c) => a * 31 + c.charCodeAt(0), 11) % 2147483647 || 1;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const g = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const n = etNow(); let todayBars = Math.max(0, Math.min(78, Math.floor((n.m - 570) / 5)));
  if (n.m < 600 || n.m >= 960 || ['Sat', 'Sun'].includes(n.wd)) todayBars = 24 + Math.floor(rnd() * 30); // simulate mid-session outside hours
  const B = []; let p = 20 + (s % 300); const base = Math.floor(Date.now() / 86400000) * 86400 - 6 * 86400;
  const vol = 0.0015 + rnd() * 0.0025;
  for (let d = 0; d < 6; d++) {
    const nb = d === 5 ? todayBars : 78, dr = (rnd() - 0.5) * vol * 0.12, hotDay = d === 5 ? 1 + rnd() * 1.5 : 1;
    if (d === 5) p *= 1 + (rnd() - 0.5) * 0.04;
    for (let k = 0; k < nb; k++) {
      const o = p, c = o * (1 + dr * hotDay + g() * vol);
      B.push({ t: base + d * 86400 + 570 * 60 + k * 300, o, c, h: Math.max(o, c) * (1 + rnd() * vol / 2), l: Math.min(o, c) * (1 - rnd() * vol / 2), v: Math.round(2e5 * (0.5 + rnd()) * (k < 6 ? 3 : 1) * (d === 5 ? hotDay : 1)) });
      p = c;
    }
  }
  return B;
}
async function fetchBatch(syms) {
  const j = await api(`/td?symbol=${encodeURIComponent(syms.join(','))}&interval=5min&outputsize=400`);
  if (j.status === 'error') throw new Error(j.message);
  const map = syms.length === 1 ? { [syms[0]]: j } : j, out = {};
  for (const sym of syms) {
    const d = map[sym]; if (!d || d.status === 'error' || !d.values) { out[sym] = { err: (d && d.message) || 'no data' }; continue; }
    out[sym] = { B: d.values.slice().reverse().map(v => ({ t: Math.floor(Date.parse(v.datetime.replace(' ', 'T') + 'Z') / 1000), o: +v.open, h: +v.high, l: +v.low, c: +v.close, v: +(v.volume || 0) })) };
  }
  return out;
}
let hotRes = [], scanning = false;
function weeklyExp() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  let d = (5 - now.getDay() + 7) % 7; if (d < 2) d += 7;
  const ex = new Date(now); ex.setDate(now.getDate() + d);
  return { dte: d, label: ex.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) };
}
function renderHot() {
  const rows = hotRes.slice().sort((a, b) => (b.p.err ? -1 : b.p.hot) - (a.p.err ? -1 : a.p.hot));
  $('hlist').innerHTML = rows.map(({ sym, p }) => {
    if (p.err) return `<div class="hc"><div class="top"><span class="sy">${sym}</span><span class="st hold">ERROR</span></div><div class="meta">${escH(p.err)}</div></div>`;
    const lv = p.entry ? `<div class="lv4">
        <div><small>${p.side > 0 ? 'BUY' : 'SHORT'} AT</small><b>${fmt(p.entry)}</b></div>
        <div><small>STOP</small><b class="dn">${fmt(p.stop)}</b></div>
        <div><small>SELL T1</small><b class="up">${fmt(p.t1)}</b></div>
        <div><small>SELL T2</small><b class="up">${fmt(p.t2)}</b></div></div>` : '';
    const notes = [...p.notes];
    const o = p.opt, pc = (a) => `${money(a)} <span class="${a >= o.atEntry ? 'up' : 'dn'}">(${a >= o.atEntry ? '+' : ''}${fmt((a / o.atEntry - 1) * 100, 0)}%)</span>`;
    const optHtml = o ? `<div class="rule" style="margin-top:9px"><b style="color:${o.type === 'call' ? 'var(--green)' : 'var(--red)'}">OR BUY $${fmt(o.K, o.K % 1 ? 1 : 0)} ${o.type.toUpperCase()} · exp ${o.exp}</b><br>
      Est. ~${money(o.atEntry)}/sh (${money(o.atEntry * 100)}/contract) when stock hits ${fmt(p.entry)} · Δ ${fmt(o.delta)}<br>
      Sell T1 ≈ ${pc(o.atT1)} · T2 ≈ ${pc(o.atT2)} · Stop ≈ ${pc(o.atStop)}<br>
      <span style="font-size:11.5px">Estimate only — check the real bid/ask. Wide spreads eat day-trade profits.</span></div>` : '';
    if (p.entry) notes.push(`Sell by 3:50 PM ET no matter what.${p.shares ? ` Size: ~${p.shares} shares (1% risk).` : ''}`);
    return `<div class="hc" data-s="${sym}">
      <div class="top"><span class="sy">${sym} <span class="mono" style="font-size:15px">${money(p.last)}</span></span><span class="r"><button class="aibtn sm" data-ai="${sym}">✨ AI</button><span class="st ${p.cls}">${p.status}</span></span></div>
      <div class="meta"><span class="${p.chg >= 0 ? 'up' : 'dn'}" style="font-weight:700">${p.chg >= 0 ? '+' : ''}${fmt(p.chg * 100)}%</span> today · gap ${p.gap >= 0 ? '+' : ''}${fmt(p.gap * 100, 1)}% · rel vol ${p.rvol ? p.rvol.toFixed(1) + '×' : '—'} · VWAP ${fmt(p.vwap)} · RSI ${p.r ? p.r.toFixed(0) : '—'}</div>
      ${lv}${optHtml}${notes.length ? `<ul>${notes.map(n => `<li>${n}</li>`).join('')}</ul>` : ''}</div>`;
  }).join('');
}
$('hlist').addEventListener('click', e => { const ai = e.target.closest('[data-ai]'); if (ai) { e.stopPropagation(); askHot(ai.dataset.ai); return; } const c = e.target.closest('[data-s]'); if (!c) return; $('intv').value = '5min'; showTab('an', true); load(c.dataset.s); });
$('acct').addEventListener('change', () => { store.set('acct', +$('acct').value || 0); });
$('scanBtn').onclick = async () => {
  if (scanning) return; scanning = true;
  const syms = [...new Set($('hotList').value.toUpperCase().split(/[\s,]+/).filter(x => TICK.test(x)))].slice(0, 40);
  store.set('hot', syms.join(' '));
  const acct = +$('acct').value || 0;
  hotRes = []; renderHot(); $('prog').style.display = 'block'; $('scanBtn').innerHTML = '<span class="spin"></span> Scanning…';
  const setProg = (d) => $('prog').firstElementChild.style.width = (d / syms.length * 100) + '%';
  const live = state.live; let done = 0;
  for (let c = 0; c < syms.length; c += 8) {
    const chunk = syms.slice(c, c + 8);
    let data = null;
    if (live) {
      try { data = await fetchBatch(chunk); }
      catch (e) { data = Object.fromEntries(chunk.map(s => [s, { err: e instanceof TypeError ? 'Can\'t reach the WICKD server' : e.message }])); }
    }
    for (const sym of chunk) {
      const d = data ? data[sym] : { B: demoDay(sym) };
      let pl = d.err ? { err: d.err } : Engine.dayPlan(d.B, acct);
      if (!pl.err) { const ex = weeklyExp(), o = Engine.dayOption(pl, d.B.map(b => b.c), ex.dte); if (o) { o.exp = ex.label; pl.opt = o; } }
      hotRes.push({ sym, p: pl });
      done++; setProg(done);
    }
    renderHot();
    if (live && c + 8 < syms.length) {
      for (let w = 61; w > 0; w--) { $('scanBtn').textContent = `Next batch in ${w}s (data-plan limit)…`; await new Promise(r => setTimeout(r, 1000)); }
    }
  }
  if (!live) $('scanNote').innerHTML = '<b style="color:#fcd34d">Demo mode: simulated prices.</b> Sign in with an approved account for real prices.';
  scanning = false; $('scanBtn').textContent = 'Scan again'; setTimeout(() => $('prog').style.display = 'none', 800);
};
function showTab(t, noLoad) {
  $('tabHot').classList.toggle('on', t === 'hot'); $('tabAn').classList.toggle('on', t === 'an');
  $('vHot').classList.toggle('on', t === 'hot'); $('vAn').classList.toggle('on', t === 'an');
  if (t === 'an' && !state.B && !noLoad) load(state.sym);
}
$('tabHot').onclick = () => showTab('hot'); $('tabAn').onclick = () => showTab('an');


/* ---------- Gemini AI ---------- */
const AI_SYS = `You are WICKD's trading analyst. The app computes signals with fixed technical rules; you add judgment and context.
Write for a phone screen: short, plain English, no hype. Use these sections with short bullets:
**Read** (1-2 lines: what the chart is doing), **Agree or disagree** with the app's signal and why, **Risks** (earnings/news/events, market conditions, anything the rules can't see), **Invalidation** (the price that proves the idea wrong), **Bottom line** (one sentence).
If you don't know a fact (e.g. earnings date) and have no search results, say so — never invent news, dates or numbers. Use the numbers given. This is educational analysis, not financial advice — don't repeat that disclaimer more than once.`;
let aiHist = [], searchOff = false;
const esc = t => t.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
function md(t) {
  const lines = esc(t).split('\n'); let out = '', inList = false;
  for (let ln of lines) {
    ln = ln.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|\s)\*(\S.+?)\*(?=\s|$)/g, '$1<i>$2</i>');
    const li = ln.match(/^\s*[-*•]\s+(.*)/);
    if (li) { if (!inList) { out += '<ul>'; inList = true; } out += `<li>${li[1]}</li>`; continue; }
    if (inList) { out += '</ul>'; inList = false; }
    const h = ln.match(/^#{1,4}\s+(.*)/);
    if (h) out += `<h4>${h[1]}</h4>`; else if (ln.trim()) out += `<p>${ln}</p>`;
  }
  return out + (inList ? '</ul>' : '');
}
async function gemini(contents, useSearch) {
  const models = [store.get('gemModel', 'gemini-3.5-flash'), 'gemini-2.5-flash'].filter((m, i, a) => a.indexOf(m) === i);
  let lastErr;
  for (const model of models) {
    for (const search of useSearch ? [true, false] : [false]) {
      try {
        const j = await api('/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, system: AI_SYS, contents, search }) });
        const cand = j.candidates && j.candidates[0];
        const text = cand && cand.content && cand.content.parts ? cand.content.parts.map(p => p.text || '').join('') : '';
        const srcs = ((cand && cand.groundingMetadata && cand.groundingMetadata.groundingChunks) || []).map(g => g.web).filter(Boolean);
        return { text: text || '(no answer returned)', srcs, model, searched: search, searchFailed: useSearch && !search };
      } catch (e) {
        lastErr = e; if (e instanceof TypeError || e.status === 401 || e.status === 403) throw e;
        if (e.status === 404) break; if (search) continue; if (e.status === 429 || e.status >= 500) continue; throw e;
      }
    }
  }
  throw lastErr || new Error('AI request failed');
}
function aiRenderAll(pending) {
  $('aiOut').innerHTML = aiHist.map(m => m.role === 'user'
    ? (m.shown ? `<div class="msg me">${esc(m.shown)}</div>` : '')
    : `<div class="msg">${md(m.text)}${m.srcs && m.srcs.length ? `<div class="src">Sources:${m.srcs.filter(w => /^https:\/\//i.test(w.uri || '')).slice(0, 6).map(w => `<a href="${esc(w.uri)}" target="_blank" rel="noopener">${esc(w.title || w.uri)}</a>`).join('')}</div>` : ''}${m.note ? `<div class="src">${m.note}</div>` : ''}</div>`).join('') +
    (pending ? '<div class="msg" style="color:var(--mut)"><span class="spin"></span> Thinking…</div>' : '');
  $('aiOut').scrollTop = $('aiOut').scrollHeight;
}
async function aiSend(prompt, shown) {
  if (!state.live) { $('aiOut').innerHTML = '<p>AI needs a signed-in, approved account. Tap <b>🔑 Sign in</b>.</p>'; return; }
  aiHist.push({ role: 'user', text: prompt, shown }); aiRenderAll(true);
  const contents = aiHist.map(m => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.text }] }));
  try {
    const r = await gemini(contents, !!store.get('gemSearch', false) && !!(AUTH.me && AUTH.me.search) && !searchOff);
    if (r.searchFailed) searchOff = true;
    aiHist.push({ role: 'model', text: r.text, srcs: r.srcs, note: `${r.model}${r.searched ? ' · with Google Search' : ''}${r.searchFailed ? ' · live news is off on the server — answered from chart data only' : ''}` });
  } catch (e) {
    aiHist.push({ role: 'model', text: e instanceof TypeError ? "Couldn't reach the WICKD server." : `AI error: ${e.message}` });
  }
  aiRenderAll(false);
}
function aiOpen(title, prompt, shown) {
  aiHist = []; $('aiTitle').textContent = '✨ ' + title; $('aiSheet').classList.add('on'); aiSend(prompt, shown);
}
const today = () => new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
$('aiAn').onclick = () => {
  if (!state.ctx) return;
  aiOpen(`Gemini on ${state.ctx.sym}`, `Today is ${today()}. Analyze this ${state.ctx.tf} chart setup from WICKD. ${store.get('gemSearch', false) ? 'Search for today\'s news, upcoming earnings date and any catalyst for this ticker.' : ''}\nDATA:\n${JSON.stringify(state.ctx)}`, `Analyze ${state.ctx.sym} (${state.ctx.tf}) — app says ${state.ctx.verdict}`);
};
function askHot(sym) {
  const h = hotRes.find(x => x.sym === sym); if (!h || h.p.err) return;
  const p = h.p, ctx = { sym, status: p.status, last: p.last, changeTodayPct: +(p.chg * 100).toFixed(2), gapPct: +(p.gap * 100).toFixed(2), relVol: p.rvol && +p.rvol.toFixed(2), vwap: +p.vwap.toFixed(2),
    openingRange: [+p.orL.toFixed(2), +p.orH.toFixed(2)], prevDay: { high: p.pdh, low: p.pdl, close: p.prevClose }, rsi5m: p.r && +p.r.toFixed(0),
    plan: p.entry ? { side: p.side > 0 ? 'long' : 'short', entry: +p.entry.toFixed(2), stop: +p.stop.toFixed(2), t1: +p.t1.toFixed(2), t2: +p.t2.toFixed(2), exitBy: '3:50 PM ET' } : null, appNotes: p.notes, optionIdea: p.opt ? `${p.opt.type} strike ${p.opt.K} exp ${p.opt.exp}, est ${p.opt.atEntry.toFixed(2)} at entry, ${p.opt.atT1.toFixed(2)} at T1, ${p.opt.atStop.toFixed(2)} at stop (Black-Scholes estimate)` : null };
  aiOpen(`Gemini on ${sym} (day trade)`, `Today is ${today()}. This is a same-day (intraday) trade idea from WICKD's 5-minute scanner. Judge whether it's worth taking today. ${store.get('gemSearch', false) ? 'Search for why this stock is moving today (news, earnings, upgrades, offerings).' : ''}\nDATA:\n${JSON.stringify(ctx)}`, `Day-trade check: ${sym} — ${p.status}`);
}
function setAI(on) {
  store.set('aiOn', on); document.body.classList.toggle('noai', !on);
  $('aiToggle').classList.toggle('ai-on', on); $('aiToggle').textContent = on ? '✨ AI' : '✨ Off';
  if (!on) $('aiSheet').classList.remove('on');
}
setAI(store.get('aiOn', true));
$('aiToggle').onclick = () => setAI(!store.get('aiOn', true));
$('aiClose').onclick = () => $('aiSheet').classList.remove('on');
$('aiForm').addEventListener('submit', e => { e.preventDefault(); const q = $('aiQ').value.trim(); if (!q) return; $('aiQ').value = ''; aiSend(q, q); });



/* ---------- Sign in with Google (Google Identity Services → Firebase signInWithIdp) ---------- */
const GOOGLE_ON = !!(CFG.googleClientId && !/PASTE|YOUR/i.test(CFG.googleClientId));
let gsiLoading = null;
function loadGsi() {
  if (window.google && google.accounts && google.accounts.id) return Promise.resolve();
  if (!gsiLoading) gsiLoading = new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'https://accounts.google.com/gsi/client'; sc.async = true; sc.onload = res; sc.onerror = () => { gsiLoading = null; rej(new Error('Google sign-in could not load.')); }; document.head.appendChild(sc); });
  return gsiLoading;
}
async function googleButton() {
  const el = $('gGoogle'); if (!el) return;
  try {
    await loadGsi();
    google.accounts.id.initialize({ client_id: CFG.googleClientId, ux_mode: 'popup', auto_select: false, itp_support: true,
      callback: async r => {
        gmsg('Signing in…', true);
        try {
          const j = await idt('signInWithIdp', { postBody: 'id_token=' + encodeURIComponent(r.credential) + '&providerId=google.com', requestUri: location.origin, returnSecureToken: true, returnIdpCredential: true });
          setSession(j.idToken, j.refreshToken, j.expiresIn); store.set('email', j.email || '');
          gate();
        } catch (e) { gmsg(e.message); }
      } });
    google.accounts.id.renderButton(el, { type: 'standard', theme: 'filled_black', size: 'large', text: 'continue_with', shape: 'pill', width: Math.min(320, el.clientWidth || 300) });
  } catch (e) { el.innerHTML = `<span class="gmsg err">${escH(e.message)}</span>`; }
}

/* ---------- Sign-in gate ---------- */
const PW_MIN = 10;
function gmsg(t, ok) { const m = $('gmsg'); if (m) { m.textContent = t || ''; m.className = 'gmsg ' + (ok ? 'ok' : 'err'); } }
function busy(btn, on, label) { btn.disabled = on; btn.innerHTML = on ? '<span class="spin"></span>' : label; }
function view(name, msg) {
  $('gate').classList.add('on'); document.body.classList.add('locked');
  const demoBtn = '<button class="demo" id="gDemo">Look around in demo mode (fake prices)</button>';
  const em = escH(AUTH.me && AUTH.me.email || store.get('email', ''));
  const V = {
    setup: `<p>The admin hasn't finished connecting WICKD to its server yet.</p>${demoBtn}`,
    login: `${GOOGLE_ON ? '<div class="gsso" id="gGoogle"></div><div class="orline">or use email</div>' : ''}<form id="gForm" autocomplete="on"><label>Email</label><input id="gEmail" type="email" autocomplete="username" required value="${em}">
      <label>Password</label><input id="gPw" type="password" autocomplete="current-password" required>
      <button class="go" id="gGo">Sign in</button></form>
      <div class="links"><button class="lnk" id="gToSignup">Create account</button><button class="lnk" id="gForgot">Forgot password?</button></div><div class="gmsg" id="gmsg"></div>${demoBtn}`,
    signup: `${GOOGLE_ON ? '<div class="gsso" id="gGoogle"></div><div class="orline">or make a password</div>' : ''}<form id="gForm" autocomplete="on"><label>Email</label><input id="gEmail" type="email" autocomplete="username" required value="${em}">
      <label>Password (${PW_MIN}+ characters)</label><input id="gPw" type="password" autocomplete="new-password" minlength="${PW_MIN}" required>
      <label>Password again</label><input id="gPw2" type="password" autocomplete="new-password" minlength="${PW_MIN}" required>
      <button class="go" id="gGo">Create account</button></form>
      <div class="links"><button class="lnk" id="gToLogin">I already have an account</button></div><div class="gmsg" id="gmsg"></div>`,
    verify: `<p>We emailed a link to <b>${em}</b>.<br>Open it to confirm your email, then tap below.</p>
      <button class="go" id="gCheck">I clicked the link</button>
      <div class="links"><button class="lnk" id="gResend">Resend email</button><button class="lnk" id="gOut">Sign out</button></div><div class="gmsg" id="gmsg"></div>`,
    pending: `<p>Thanks, <b>${em}</b>.<br>Your account is waiting for the admin to approve it.</p>
      <button class="go" id="gCheck">Check again</button><div class="links"><span></span><button class="lnk" id="gOut">Sign out</button></div><div class="gmsg" id="gmsg"></div>${demoBtn}`,
    revoked: `<p>Access for <b>${em}</b> was turned off. Contact the admin.</p><div class="links"><span></span><button class="lnk" id="gOut">Sign out</button></div>`,
    error: `<p>Couldn't connect to the WICKD server.</p><button class="go" id="gCheck">Try again</button><div class="links"><span></span><button class="lnk" id="gOut">Sign out</button></div><div class="gmsg" id="gmsg"></div>${demoBtn}`,
  };
  $('gView').innerHTML = V[name]; if (msg) gmsg(msg);
  if (GOOGLE_ON && (name === 'login' || name === 'signup')) googleButton();
  const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
  on('gDemo', () => openApp(false));
  on('gToSignup', () => view('signup')); on('gToLogin', () => view('login'));
  on('gOut', () => { clearSession(); view('login'); });
  on('gCheck', async () => { busy($('gCheck'), true); try { await idToken(true); } catch {} gate(); });
  on('gResend', async () => { try { await idt('sendOobCode', { requestType: 'VERIFY_EMAIL', idToken: await idToken() }); gmsg('Sent. Check your inbox and spam folder.', true); } catch (e) { gmsg(e.message); } });
  on('gForgot', async () => {
    const email = $('gEmail').value.trim(); if (!email) return gmsg('Type your email first, then tap Forgot password.');
    try { await idt('sendOobCode', { requestType: 'PASSWORD_RESET', email }); } catch {}
    gmsg('If that email has an account, a reset link is on its way.', true);
  });
  const f = $('gForm');
  if (f) f.onsubmit = async e => {
    e.preventDefault();
    const email = $('gEmail').value.trim(), pw = $('gPw').value, btn = $('gGo'), label = btn.textContent;
    if (name === 'signup') {
      if (pw.length < PW_MIN) return gmsg(`Use at least ${PW_MIN} characters.`);
      if (pw !== $('gPw2').value) return gmsg("Passwords don't match.");
    }
    busy(btn, true);
    try {
      const j = await idt(name === 'signup' ? 'signUp' : 'signInWithPassword', { email, password: pw, returnSecureToken: true });
      setSession(j.idToken, j.refreshToken, j.expiresIn); store.set('email', email);
      if (name === 'signup') await idt('sendOobCode', { requestType: 'VERIFY_EMAIL', idToken: j.idToken });
      gate();
    } catch (err) { busy(btn, false, label); gmsg(err.message); }
  };
}
function openApp(live) {
  state.live = !!live; $('gate').classList.remove('on'); document.body.classList.remove('locked');
  $('setBtn').textContent = live ? '👤 Me' : '🔑 Sign in';
  state.B = null; hotRes = []; renderHot();
  if (!live) $('scanNote').innerHTML = '<b style="color:#fcd34d">Demo mode: simulated prices.</b> Sign in with an approved account for real prices.';
  else $('scanNote').textContent = 'Scans 5-minute charts, 8 tickers per minute (data-plan limit). Paste today\'s premarket gainers to scan them too.';
  if ($('vAn').classList.contains('on')) load(state.sym);
}
async function gate() {
  if (!CONFIGURED) return view('setup');
  if (!AUTH.rt) return view('login');
  try { AUTH.me = await api('/me'); }
  catch (e) {
    if (e.status === 403 && e.message === 'unverified') return view('verify');
    if (e.status === 401) { clearSession(); return view('login', e.message); }
    const why = e instanceof TypeError
      ? 'The server blocked this site. Check ALLOWED_ORIGINS is exactly https://pmpakula.github.io (no slash at the end), then Deploy.'
      : e.message === 'Server error' ? 'The server hit an error. Check the USERS storage binding and KEY_SECRET, then Deploy.'
      : e.message;
    return view('error', why);
  }
  store.set('email', AUTH.me.email);
  if (AUTH.me.status === 'approved') {
    openApp(true);
    if (!AUTH.me.keys.td && !AUTH.me.shared.td) { $('setBtn').click(); $('keysMsg').innerHTML = '<span style="color:#fcd34d">Welcome! Paste your Twelve Data key to get real prices.</span>'; }
    return;
  }
  view(AUTH.me.status === 'revoked' ? 'revoked' : 'pending');
}

/* ---------- Admin: approve / revoke users ---------- */
async function loadUsers() {
  $('adminList').innerHTML = '<p class="note"><span class="spin"></span> Loading…</p>';
  try {
    const { users } = await api('/admin/users');
    const when = t => t ? new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
    $('adminList').innerHTML = users.length ? users.map(u => `<div class="urow" data-em="${escH(u.email)}">
      <div class="em">${escH(u.email)}<small>${u.status === 'pending' ? 'asked ' + when(u.requested) : 'updated ' + when(u.updated)}</small></div>
      <span class="pill ${escH(u.status || 'pending')}">${escH(u.status || 'pending')}</span>
      ${u.status !== 'approved' ? '<button data-act="approved" style="border-color:#16a34a">Approve</button>' : ''}
      ${u.status !== 'revoked' ? '<button data-act="revoked">Revoke</button>' : ''}
      <button data-act="delete" style="color:#fca5a5">Delete</button></div>`).join('') : '<p class="note">No users yet. People appear here after they create an account and confirm their email.</p>';
  } catch (e) { $('adminList').innerHTML = `<p class="note" style="color:#fca5a5">${escH(e.message)}</p>`; }
}
$('adminBtn').onclick = () => { $('modal').classList.remove('on'); $('adminM').classList.add('on'); loadUsers(); };
$('adminClose').onclick = () => $('adminM').classList.remove('on');
$('adminList').addEventListener('click', async e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const email = b.closest('[data-em]').dataset.em, action = b.dataset.act;
  if (action === 'delete' && b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Tap again to delete'; return; }
  b.disabled = true;
  try { await api('/admin/set', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, action }) }); loadUsers(); }
  catch (err) { b.disabled = false; b.textContent = err.message; }
});

/* ---------- Flow ---------- */
let loading = false;
async function load(sym) {
  if (loading) return; loading = true;
  sym = (sym || $('sym').value || state.sym).trim().toUpperCase();
  if (!TICK.test(sym)) { banner('Invalid ticker. Use letters/numbers, e.g. AAPL or BTC/USD.', true); loading = false; return; }
  const intv = $('intv').value;
  state.sym = sym; state.intv = intv; $('sym').value = sym;
  store.set('sym', sym); store.set('intv', intv);
  $('goBtn').innerHTML = '<span class="spin"></span>';
  let res;
  if (state.live) {
    try { res = await fetchTD(sym, intv); state.src = 'Twelve Data · live'; banner(''); }
    catch (e) {
      banner(e instanceof TypeError ? 'Can\'t reach the WICKD server. Check your connection.' : `Data error: ${escH(e.message)}`, true);
      loading = false; $('goBtn').textContent = 'Analyze'; return;
    }
  } else {
    res = demo(sym, intv); state.src = 'DEMO data';
    banner('<b>Demo mode:</b> simulated prices. Sign in with an approved account for real prices.');
  }
  if (res.B.length < 60) { banner('Not enough history for this symbol/interval.', true); loading = false; $('goBtn').textContent = 'Analyze'; return; }
  state.B = res.B; state.ind = Engine.compute(res.B);
  render(); renderWatch();
  loading = false; $('goBtn').textContent = 'Analyze';
}
function renderWatch() {
  $('watch').innerHTML = watch.map(s => `<span class="chip ${s === state.sym ? 'on' : ''}" data-s="${escH(s)}">${escH(s)}<span class="x" data-x="${escH(s)}">✕</span></span>`).join('') +
    (watch.includes(state.sym) ? '' : `<span class="chip" data-add="1">+ ${escH(state.sym)}</span>`);
}
$('watch').addEventListener('click', e => {
  const x = e.target.dataset.x, add = e.target.closest('[data-add]'), chip = e.target.closest('[data-s]');
  if (x) { watch = watch.filter(s => s !== x); store.set('watch', watch); renderWatch(); return; }
  if (add) { watch.push(state.sym); store.set('watch', watch); renderWatch(); return; }
  if (chip) load(chip.dataset.s);
});
$('form').addEventListener('submit', e => { e.preventDefault(); state.ivOverride = null; load(); });
$('intv').addEventListener('change', () => load(state.sym));
$('hz').addEventListener('change', () => state.ind && renderBacktest());
$('ivIn').addEventListener('change', () => { const v = parseFloat($('ivIn').value); state.ivOverride = v > 0 ? v : null; state.B && render(); });
$('toggles').addEventListener('click', e => {
  const k = e.target.dataset.k; if (!k) return;
  show[k] = !show[k]; store.set('show', show); e.target.classList.toggle('on', show[k]); state.B && render();
});
document.querySelectorAll('#toggles .tg').forEach(b => b.classList.toggle('on', !!show[b.dataset.k]));
$('setBtn').onclick = () => {
  if (!state.live) { $('gate').classList.add('on'); document.body.classList.add('locked'); gate(); return; }
  $('acctWho').innerHTML = `Signed in as <b>${escH(AUTH.me.email)}</b>${AUTH.me.admin ? ' · <b style="color:#c4b5fd">Admin</b>' : ''}`;
  $('gemModel').value = store.get('gemModel', 'gemini-3.5-flash'); $('aiOnIn').checked = store.get('aiOn', true);
  $('gemSearch').checked = !!store.get('gemSearch', false); $('gemSearch').disabled = !AUTH.me.search;
  $('gemSearchLbl').textContent = AUTH.me.search ? 'Live news via Google Search' : 'Live news via Google Search (off on the server)';
  $('adminBtn').style.display = AUTH.me.admin ? '' : 'none';
  renderKeyHints(); $('keysMsg').textContent = ''; $('tdIn').value = ''; $('gemIn').value = '';
  $('modal').classList.add('on');
};
function renderKeyHints() {
  const k = (AUTH.me && AUTH.me.keys) || {}, sh = (AUTH.me && AUTH.me.shared) || {};
  const line = (kind, h, shared) => h ? `Saved ${escH(h)} · <button class="lnk" data-rm="${kind}" style="background:none;border:0;color:#fca5a5;cursor:pointer;font:600 12.5px Inter;padding:0">Remove</button>`
    : shared ? 'Not set — using the shared key from the admin.' : '<span style="color:#fcd34d">Not set yet.</span>';
  $('tdHint').innerHTML = line('td', k.td, sh.td); $('gemHint').innerHTML = line('gem', k.gem, sh.gem);
}
async function saveKeys(body) {
  $('keysMsg').textContent = 'Saving…';
  try { const r = await api('/keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    AUTH.me.keys = r.keys; renderKeyHints(); $('tdIn').value = ''; $('gemIn').value = ''; $('keysMsg').innerHTML = '<span style="color:#86efac">Saved ✓</span>';
    hotRes = []; renderHot(); state.B = null;
  } catch (e) { $('keysMsg').innerHTML = `<span style="color:#fca5a5">${escH(e.message)}</span>`; }
}
$('keysSave').onclick = () => {
  const body = {}; const td = $('tdIn').value.trim(), gem = $('gemIn').value.trim();
  if (td) body.td = td; if (gem) body.gem = gem;
  if (!td && !gem) { $('keysMsg').textContent = 'Paste a key first.'; return; }
  saveKeys(body);
};
$('modal').addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (b) saveKeys({ [b.dataset.rm]: null }); });
$('cancelBtn').onclick = () => $('modal').classList.remove('on');
$('saveBtn').onclick = () => { store.set('gemModel', $('gemModel').value); store.set('gemSearch', $('gemSearch').checked); searchOff = false; setAI($('aiOnIn').checked); $('modal').classList.remove('on'); };
$('outBtn').onclick = () => { $('modal').classList.remove('on'); clearSession(); hotRes = []; renderHot(); state.B = null; gate(); };
let timer = null;
$('autoBtn').onclick = () => {
  if (timer) { clearInterval(timer); timer = null; $('autoBtn').textContent = '⟳ Off'; }
  else { timer = setInterval(() => load(state.sym), 120000); $('autoBtn').textContent = '⟳ 2m'; }
};

$('sym').value = state.sym; $('intv').value = state.intv;
initCharts();
gate();
try { if ('serviceWorker' in navigator && location.protocol === 'https:' && window.top === window) navigator.serviceWorker.register('sw.js').catch(() => {}); } catch {}
})();
