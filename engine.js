/* StockBot analysis engine — pure functions, no DOM */
const Engine = (() => {
  const isNum = v => v !== null && v !== undefined && !Number.isNaN(v);

  function sma(src, n) {
    const out = Array(src.length).fill(null); let sum = 0;
    for (let i = 0; i < src.length; i++) {
      sum += src[i]; if (i >= n) sum -= src[i - n];
      if (i >= n - 1) out[i] = sum / n;
    }
    return out;
  }
  function ema(src, n) {
    const out = Array(src.length).fill(null), k = 2 / (n + 1);
    let cnt = 0, sum = 0, prev = null;
    for (let i = 0; i < src.length; i++) {
      const v = src[i]; if (!isNum(v)) continue;
      if (prev === null) { sum += v; cnt++; if (cnt === n) { prev = sum / n; out[i] = prev; } }
      else { prev = v * k + prev * (1 - k); out[i] = prev; }
    }
    return out;
  }
  function rsi(c, n = 14) {
    const out = Array(c.length).fill(null); let g = 0, l = 0;
    for (let i = 1; i < c.length; i++) {
      const d = c[i] - c[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
      if (i <= n) { g += up; l += dn; if (i === n) { g /= n; l /= n; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } }
      else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); }
    }
    return out;
  }
  function macd(c) {
    const e12 = ema(c, 12), e26 = ema(c, 26);
    const m = c.map((_, i) => isNum(e12[i]) && isNum(e26[i]) ? e12[i] - e26[i] : null);
    const s = ema(m, 9);
    const h = m.map((v, i) => isNum(v) && isNum(s[i]) ? v - s[i] : null);
    return { m, s, h };
  }
  function bollinger(c, n = 20, k = 2) {
    const mid = sma(c, n), up = [], lo = [];
    for (let i = 0; i < c.length; i++) {
      if (!isNum(mid[i])) { up.push(null); lo.push(null); continue; }
      let s = 0; for (let j = i - n + 1; j <= i; j++) s += (c[j] - mid[i]) ** 2;
      const sd = Math.sqrt(s / n); up.push(mid[i] + k * sd); lo.push(mid[i] - k * sd);
    }
    return { mid, up, lo };
  }
  function atr(h, l, c, n = 14) {
    const out = Array(c.length).fill(null); let a = 0;
    for (let i = 1; i < c.length; i++) {
      const tr = Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
      if (i <= n) { a += tr; if (i === n) { a /= n; out[i] = a; } }
      else { a = (a * (n - 1) + tr) / n; out[i] = a; }
    }
    return out;
  }
  function histVol(c, n, ppy, end = c.length - 1) {
    if (end < n) return null;
    const r = []; for (let i = end - n + 1; i <= end; i++) r.push(Math.log(c[i] / c[i - 1]));
    const m = r.reduce((a, b) => a + b, 0) / r.length;
    const v = r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1);
    return Math.sqrt(v * ppy);
  }

  /* ---------- Candlestick patterns ---------- */
  function detectPatterns(B, ema20) {
    const res = B.map(() => []);
    const body = i => Math.abs(B[i].c - B[i].o);
    const rng = i => Math.max(B[i].h - B[i].l, 1e-9);
    const upW = i => B[i].h - Math.max(B[i].o, B[i].c);
    const loW = i => Math.min(B[i].o, B[i].c) - B[i].l;
    const bull = i => B[i].c > B[i].o, bear = i => B[i].c < B[i].o;
    const avgBody = i => { let s = 0, k = 0; for (let j = Math.max(0, i - 10); j < i; j++) { s += body(j); k++; } return k ? s / k : body(i); };
    const downT = i => i >= 6 && B[i - 1].c < B[i - 6].c && (!isNum(ema20[i - 1]) || B[i - 1].c < ema20[i - 1]);
    const upT = i => i >= 6 && B[i - 1].c > B[i - 6].c && (!isNum(ema20[i - 1]) || B[i - 1].c > ema20[i - 1]);
    const add = (i, name, bias, str, short) => res[i].push({ name, bias, str, short });

    for (let i = 2; i < B.length; i++) {
      const b = body(i), r = rng(i), ab = avgBody(i), p = i - 1, pp = i - 2;
      // single-bar
      if (b <= 0.1 * r) {
        if (downT(i) && loW(i) > 2 * upW(i)) add(i, 'Dragonfly Doji', 1, 1, 'Doji');
        else if (upT(i) && upW(i) > 2 * loW(i)) add(i, 'Gravestone Doji', -1, 1, 'Doji');
        else add(i, 'Doji (indecision)', 0, 0, 'Doji');
      } else {
        const hammerShape = loW(i) >= 2 * b && upW(i) <= Math.max(0.3 * b, 0.1 * r);
        const invShape = upW(i) >= 2 * b && loW(i) <= Math.max(0.3 * b, 0.1 * r);
        if (hammerShape && downT(i)) add(i, 'Hammer', 1, 2, 'Hammer');
        if (hammerShape && upT(i)) add(i, 'Hanging Man', -1, 1, 'HangMan');
        if (invShape && downT(i)) add(i, 'Inverted Hammer', 1, 1, 'InvHam');
        if (invShape && upT(i)) add(i, 'Shooting Star', -1, 2, 'ShStar');
        if (b >= 0.9 * r && b > 1.3 * ab) add(i, bull(i) ? 'Bullish Marubozu' : 'Bearish Marubozu', bull(i) ? 1 : -1, 1, 'Marubozu');
      }
      // two-bar
      if (bear(p) && bull(i) && B[i].c >= B[p].o && B[i].o <= B[p].c && b > body(p)) add(i, 'Bullish Engulfing', 1, 3, 'BullEngulf');
      if (bull(p) && bear(i) && B[i].c <= B[p].o && B[i].o >= B[p].c && b > body(p)) add(i, 'Bearish Engulfing', -1, 3, 'BearEngulf');
      const pMid = (B[p].o + B[p].c) / 2;
      if (bear(p) && body(p) > ab && bull(i) && B[i].o < B[p].c && B[i].c > pMid && B[i].c < B[p].o) add(i, 'Piercing Line', 1, 2, 'Piercing');
      if (bull(p) && body(p) > ab && bear(i) && B[i].o > B[p].c && B[i].c < pMid && B[i].c > B[p].o) add(i, 'Dark Cloud Cover', -1, 2, 'DarkCloud');
      if (bear(p) && body(p) > ab && bull(i) && b < 0.5 * body(p) && B[i].o > B[p].c && B[i].c < B[p].o && downT(i)) add(i, 'Bullish Harami', 1, 1, 'Harami');
      if (bull(p) && body(p) > ab && bear(i) && b < 0.5 * body(p) && B[i].o < B[p].c && B[i].c > B[p].o && upT(i)) add(i, 'Bearish Harami', -1, 1, 'Harami');
      // three-bar
      const ppMid = (B[pp].o + B[pp].c) / 2;
      if (bear(pp) && body(pp) > ab && body(p) < 0.4 * body(pp) && bull(i) && B[i].c > ppMid) add(i, 'Morning Star', 1, 3, 'MornStar');
      if (bull(pp) && body(pp) > ab && body(p) < 0.4 * body(pp) && bear(i) && B[i].c < ppMid) add(i, 'Evening Star', -1, 3, 'EveStar');
      if ([pp, p, i].every(bull) && B[i].c > B[p].c && B[p].c > B[pp].c && [pp, p, i].every(j => body(j) > 0.5 * rng(j))) add(i, 'Three White Soldiers', 1, 2, '3Soldiers');
      if ([pp, p, i].every(bear) && B[i].c < B[p].c && B[p].c < B[pp].c && [pp, p, i].every(j => body(j) > 0.5 * rng(j))) add(i, 'Three Black Crows', -1, 2, '3Crows');
    }
    return res;
  }

  /* ---------- Support / resistance ---------- */
  function levels(B, atrNow, k = 5, lookback = 200) {
    const start = Math.max(k, B.length - lookback), piv = [];
    for (let i = start; i < B.length - k; i++) {
      let hi = true, lo = true;
      for (let j = i - k; j <= i + k; j++) { if (B[j].h > B[i].h) hi = false; if (B[j].l < B[i].l) lo = false; }
      if (hi) piv.push(B[i].h); if (lo) piv.push(B[i].l);
    }
    piv.sort((a, b) => a - b);
    const tol = (atrNow || 0) * 0.6, clusters = [];
    for (const v of piv) {
      const last = clusters[clusters.length - 1];
      if (last && v - last.max <= tol) { last.vals.push(v); last.max = v; }
      else clusters.push({ vals: [v], max: v });
    }
    const lv = clusters.map(c => ({ price: c.vals.reduce((a, b) => a + b, 0) / c.vals.length, touches: c.vals.length }));
    const px = B[B.length - 1].c;
    const res = lv.filter(l => l.price > px).sort((a, b) => a.price - b.price).slice(0, 3);
    const sup = lv.filter(l => l.price < px).sort((a, b) => b.price - a.price).slice(0, 3);
    return { res, sup };
  }

  /* ---------- Indicators bundle ---------- */
  function compute(B) {
    const c = B.map(b => b.c), h = B.map(b => b.h), l = B.map(b => b.l), v = B.map(b => b.v || 0);
    const e20 = ema(c, 20), e50 = ema(c, 50), e200 = ema(c, 200);
    const ind = { c, h, l, v, e20, e50, e200, rsi: rsi(c), macd: macd(c), bb: bollinger(c), atr: atr(h, l, c), vavg: sma(v, 20) };
    ind.pat = detectPatterns(B, e20);
    return ind;
  }

  /* ---------- Signal score (-100..100) at bar i ---------- */
  function scoreAt(ind, i) {
    const R = []; let s = 0;
    const add = (w, txt) => { s += w; R.push({ w, txt }); };
    const c = ind.c[i];
    if (isNum(ind.e200[i])) add(c > ind.e200[i] ? 1.5 : -1.5, c > ind.e200[i] ? 'Above 200 EMA — long-term uptrend' : 'Below 200 EMA — long-term downtrend');
    if (isNum(ind.e50[i])) add(c > ind.e50[i] ? 1 : -1, c > ind.e50[i] ? 'Above 50 EMA' : 'Below 50 EMA');
    if (isNum(ind.e20[i]) && isNum(ind.e50[i])) add(ind.e20[i] > ind.e50[i] ? 1 : -1, ind.e20[i] > ind.e50[i] ? '20 EMA over 50 EMA (bullish alignment)' : '20 EMA under 50 EMA (bearish alignment)');
    const hst = ind.macd.h[i], hp = ind.macd.h[i - 1];
    if (isNum(hst) && isNum(hp)) {
      if (hst > 0 && hp <= 0) add(1.5, 'MACD bullish crossover');
      else if (hst < 0 && hp >= 0) add(-1.5, 'MACD bearish crossover');
      else add(hst > 0 ? 0.75 : -0.75, hst > 0 ? 'MACD above signal' : 'MACD below signal');
      if (hst > hp && hst < 0) add(0.5, 'Bearish momentum fading');
      if (hst < hp && hst > 0) add(-0.5, 'Bullish momentum fading');
    }
    const r = ind.rsi[i];
    if (isNum(r)) {
      if (r < 30) add(1.5, `RSI ${r.toFixed(0)} — oversold`);
      else if (r > 70) add(-1.5, `RSI ${r.toFixed(0)} — overbought`);
      else if (r >= 50) add(0.5, `RSI ${r.toFixed(0)} — bullish zone`);
      else add(-0.5, `RSI ${r.toFixed(0)} — bearish zone`);
    }
    const up = ind.bb.up[i], lo = ind.bb.lo[i];
    if (isNum(up) && isNum(lo)) {
      if (c < lo) add(0.75, 'Closed below lower Bollinger Band (stretched down)');
      else if (c > up) add(-0.75, 'Closed above upper Bollinger Band (stretched up)');
    }
    const volConf = isNum(ind.vavg[i]) && ind.vavg[i] > 0 && ind.v[i] > 1.2 * ind.vavg[i];
    for (let j = Math.max(0, i - 2); j <= i; j++) {
      for (const p of ind.pat[j]) {
        if (!p.bias) continue;
        const decay = j === i ? 1 : j === i - 1 ? 0.7 : 0.45;
        const w = p.bias * p.str * 0.6 * decay * (volConf && j === i ? 1.3 : 1);
        add(w, `${p.name}${j === i ? '' : ` (${i - j} bar${i - j > 1 ? 's' : ''} ago)`}${volConf && j === i ? ' on high volume' : ''}`);
      }
    }
    const MAX = 9.5;
    const score = Math.max(-100, Math.min(100, (s / MAX) * 100));
    return { score, reasons: R.sort((a, b) => Math.abs(b.w) - Math.abs(a.w)) };
  }
  function verdict(score) {
    if (score >= 40) return { label: 'STRONG BUY', dir: 1, cls: 'sbuy' };
    if (score >= 15) return { label: 'BUY', dir: 1, cls: 'buy' };
    if (score <= -40) return { label: 'STRONG SELL', dir: -1, cls: 'ssell' };
    if (score <= -15) return { label: 'SELL', dir: -1, cls: 'sell' };
    return { label: 'HOLD / WAIT', dir: 0, cls: 'hold' };
  }

  /* ---------- Backtest of the signal itself ---------- */
  function backtest(ind, H = 10) {
    const out = { long: { n: 0, win: 0, ret: 0 }, short: { n: 0, win: 0, ret: 0 } };
    const n = ind.c.length;
    for (let i = 60; i < n - H; i++) {
      const sc = scoreAt(ind, i).score, fwd = ind.c[i + H] / ind.c[i] - 1;
      if (sc >= 15) { out.long.n++; out.long.ret += fwd; if (fwd > 0) out.long.win++; }
      else if (sc <= -15) { out.short.n++; out.short.ret += -fwd; if (fwd < 0) out.short.win++; }
    }
    let bh = 0, bhn = 0; for (let i = 60; i < n - H; i++) { bh += ind.c[i + H] / ind.c[i] - 1; bhn++; }
    out.baseline = bhn ? bh / bhn : 0;
    out.H = H;
    return out;
  }

  /* ---------- Black-Scholes ---------- */
  function ncdf(x) {
    const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2);
    const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return x > 0 ? 1 - p : p;
  }
  function bs(S, K, T, r, sig, type) {
    T = Math.max(T, 1 / 365);
    if (!(sig > 0) || !(S > 0) || !(K > 0)) return { price: 0, delta: 0, theta: 0, vega: 0 };
    const sq = Math.sqrt(T), d1 = (Math.log(S / K) + (r + sig * sig / 2) * T) / (sig * sq), d2 = d1 - sig * sq;
    const pdf = Math.exp(-d1 * d1 / 2) / Math.sqrt(2 * Math.PI), disc = Math.exp(-r * T);
    let price, delta, theta;
    if (type === 'call') { price = S * ncdf(d1) - K * disc * ncdf(d2); delta = ncdf(d1); theta = (-S * pdf * sig / (2 * sq) - r * K * disc * ncdf(d2)) / 365; }
    else { price = K * disc * ncdf(-d2) - S * ncdf(-d1); delta = ncdf(d1) - 1; theta = (-S * pdf * sig / (2 * sq) + r * K * disc * ncdf(-d2)) / 365; }
    return { price: Math.max(price, 0), delta, theta, vega: S * pdf * sq / 100 };
  }
  function strikeInc(S) { return S < 25 ? 0.5 : S < 200 ? 1 : S < 1000 ? 5 : 10; }
  const roundTo = (x, inc) => Math.round(x / inc) * inc;

  function optionsPlan({ S, score, sigma, target, stop, intraday, ivPct }) {
    const v = verdict(score);
    if (!v.dir) return { none: true, reason: 'No directional edge. Buying calls or puts here means paying for time decay with no edge — wait for a BUY or SELL signal.' };
    const type = v.dir > 0 ? 'call' : 'put', strong = Math.abs(score) >= 40;
    const dte = intraday ? (strong ? 7 : 14) : (strong ? 30 : 45);
    const tDelta = strong ? 0.6 : 0.5, r = 0.04, T = dte / 365, inc = strikeInc(S);
    let best = null;
    for (let K = roundTo(S * 0.7, inc); K <= S * 1.3; K += inc) {
      const g = bs(S, K, T, r, sigma, type), d = Math.abs(Math.abs(g.delta) - tDelta);
      if (!best || d < best.d) best = { K: +K.toFixed(2), d, g };
    }
    const K = best.K, g = best.g, prem = g.price;
    const be = type === 'call' ? K + prem : K - prem;
    const atTarget = bs(target, K, (dte / 2) / 365, r, sigma, type).price;
    const atStop = bs(stop, K, (dte / 2) / 365, r, sigma, type).price;
    // debit spread: short leg near target
    let K2 = roundTo(target, inc);
    if (type === 'call' && K2 <= K) K2 = K + inc;
    if (type === 'put' && K2 >= K) K2 = K - inc;
    const short = bs(S, K2, T, r, sigma, type).price;
    const spreadCost = Math.max(prem - short, 0.01), spreadMax = Math.abs(K2 - K) - spreadCost;
    let volNote = '';
    if (ivPct != null) {
      if (ivPct >= 70) volNote = `Volatility is high (${ivPct.toFixed(0)}th pct of past year) — options are pricey; the debit spread is the better value.`;
      else if (ivPct <= 30) volNote = `Volatility is low (${ivPct.toFixed(0)}th pct of past year) — options are relatively cheap; single-leg is reasonable.`;
      else volNote = `Volatility is mid-range (${ivPct.toFixed(0)}th pct of past year).`;
    }
    return { type, dte, K, prem, delta: g.delta, theta: g.theta, vega: g.vega, be, atTarget, atStop, K2, spreadCost, spreadMax, volNote, strong };
  }


  /* ---------- Day-trade plan on 5-min bars ---------- */
  // Bars: t = unix seconds of the *exchange-local* (ET) time encoded as UTC.
  function dayPlan(B, acct) {
    const day = b => new Date(b.t * 1000).toISOString().slice(0, 10);
    const mins = b => { const d = new Date(b.t * 1000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
    const S = B.filter(b => { const m = mins(b); return m >= 570 && m < 960; });
    const days = [...new Set(S.map(day))];
    if (days.length < 2) return { err: 'Not enough intraday history' };
    const today = days[days.length - 1];
    const T = S.filter(b => day(b) === today), P = S.filter(b => day(b) === days[days.length - 2]);
    const prevClose = P[P.length - 1].c, pdh = Math.max(...P.map(b => b.h)), pdl = Math.min(...P.map(b => b.l));
    const open = T[0].o, last = T[T.length - 1].c;
    let pv = 0, vv = 0, ts = 0;
    T.forEach((b, k) => { const tp = (b.h + b.l + b.c) / 3; pv += tp * b.v; vv += b.v; ts += tp; });
    const vwap = vv > 0 ? pv / vv : ts / T.length;
    const orN = Math.min(3, T.length), OR = T.slice(0, orN);
    const orH = Math.max(...OR.map(b => b.h)), orL = Math.min(...OR.map(b => b.l)), orMid = (orH + orL) / 2, orDone = T.length >= 3;
    const cs = S.map(b => b.c), i = cs.length - 1;
    const e9 = ema(cs, 9)[i], e20 = ema(cs, 20)[i], r = rsi(cs)[i];
    const a5 = atr(S.map(b => b.h), S.map(b => b.l), cs)[i] || (orH - orL) / 2 || last * 0.003;
    // relative volume vs same time of day on prior sessions
    const k = T.length, todayVol = T.reduce((x, b) => x + b.v, 0);
    const prior = days.slice(-6, -1).map(d => S.filter(b => day(b) === d).slice(0, k).reduce((x, b) => x + b.v, 0)).filter(v => v > 0);
    const rvol = prior.length && todayVol > 0 ? todayVol / (prior.reduce((a, b) => a + b, 0) / prior.length) : null;
    const chg = last / prevClose - 1, gap = open / prevClose - 1;
    const nowM = mins(T[T.length - 1]) + 5;
    const notes = []; let side = 0, status = '', entry = null, stop = null, t1 = null, t2 = null, cls = 'hold';
    const bull = last > vwap && e9 > e20, bear = last < vwap && e9 < e20;

    if (!orDone) { status = 'WAIT — 9:45'; notes.push('Opening range (first 15 min) still forming. Levels lock in at 9:45 AM ET.'); }
    else if (nowM >= 960) { status = 'MARKET CLOSED'; notes.push('Session over. Re-scan after 9:45 AM ET next trading day.'); }
    else if (nowM >= 900) { status = 'NO NEW TRADES'; notes.push('After 3:00 PM ET — only manage open trades. Be flat by 3:50 PM.'); }
    else if (bull || bear) {
      side = bull ? 1 : -1; const orEdge = bull ? orH : orL, fast = e9;
      const beyond = side > 0 ? last > orH : last < orL;
      if (beyond) {
        const ext = Math.abs(last - (side > 0 ? Math.max(orEdge, fast) : Math.min(orEdge, fast)));
        const tooHot = (side > 0 && r > 78) || (side < 0 && r < 22);
        if (ext <= 0.6 * a5 && !tooHot) { status = side > 0 ? 'BUY NOW' : 'SHORT NOW'; entry = last; cls = side > 0 ? 'sbuy' : 'ssell'; }
        else { status = side > 0 ? 'BUY ON PULLBACK' : 'SHORT ON BOUNCE'; entry = side > 0 ? Math.max(orEdge, fast) : Math.min(orEdge, fast); cls = side > 0 ? 'buy' : 'sell';
          notes.push(tooHot ? `RSI ${r.toFixed(0)} — overextended, don't chase.` : 'Already ran away from the breakout — set a limit order at the entry and let it come to you.'); }
      } else {
        status = side > 0 ? 'WATCH — BUY ABOVE' : 'WATCH — SHORT BELOW'; entry = side > 0 ? orH + 0.01 : orL - 0.01; cls = 'hold';
        notes.push(`Trigger: ${side > 0 ? 'break above' : 'break below'} the opening-range ${side > 0 ? 'high' : 'low'}. Use a ${side > 0 ? 'buy-stop' : 'sell-stop'} order.`);
      }
      const anchor = side > 0 ? Math.max(vwap, orMid) : Math.min(vwap, orMid);
      stop = anchor - side * 0.15 * a5;
      if (side * (entry - stop) < 0.4 * a5) stop = entry - side * a5;
      const R = Math.abs(entry - stop);
      t1 = entry + side * R; t2 = entry + side * 2 * R;
      if (R / entry > 0.04) { notes.unshift(`Stop would be ${(R / entry * 100).toFixed(1)}% away — too wild for a day trade.`); status = 'TOO WILD — SKIP'; cls = 'hold'; }
      else if (R / entry > 0.02) notes.push(`Wide stop (${(R / entry * 100).toFixed(1)}%) — trade smaller.`);
      const lvl = side > 0 ? pdh : pdl;
      if (side * (lvl - entry) > 0 && side * (lvl - t2) < 0) notes.push(`Prior-day ${side > 0 ? 'high' : 'low'} $${lvl.toFixed(2)} sits before target 2 — expect a fight there.`);
      if (rvol !== null && rvol < 1) { notes.push(`Relative volume only ${rvol.toFixed(1)}× — weak interest, lower odds.`); if (cls === 'sbuy' || cls === 'ssell') cls = side > 0 ? 'buy' : 'sell'; }
      if (nowM >= 690 && nowM < 810) notes.push('Lunch hour (11:30–1:30) — moves often fizzle. Be pickier.');
    } else { status = 'CHOP — SKIP'; notes.push('Price is tangled around VWAP with no clear trend. No edge.'); }

    let shares = null;
    if (status === 'TOO WILD — SKIP') { entry = stop = t1 = t2 = null; side = 0; }
    if (acct > 0 && entry && stop) shares = Math.floor(acct * 0.01 / Math.abs(entry - stop));
    const hot = Math.abs(chg) * 100 * Math.min(rvol || 1, 6) + (side ? 4 : 0) + (cls === 'sbuy' || cls === 'ssell' ? 4 : 0);
    return { side, status, cls, entry, stop, t1, t2, notes, last, chg, gap, rvol, vwap, orH, orL, pdh, pdl, prevClose, r, e9, e20, a5, hot, shares, orDone, nowM };
  }


  /* ---------- Option idea for a day trade ---------- */
  function dayOption(p, closes5m, dte) {
    if (!p.entry || !p.side) return null;
    const type = p.side > 0 ? 'call' : 'put', r = 0.04, S = p.last;
    const sig = Math.min(Math.max(histVol(closes5m, 78, 252 * 78) || 0.4, 0.15), 2.5);
    const inc = strikeInc(S); let best = null;
    for (let K = roundTo(S * 0.85, inc); K <= S * 1.15; K += inc) {
      const g = bs(S, K, dte / 365, r, sig, type), d = Math.abs(Math.abs(g.delta) - 0.5);
      if (!best || d < best.d) best = { K: +K.toFixed(2), d, g };
    }
    const T2 = Math.max(dte - 0.25, 0.1) / 365, val = px => bs(px, best.K, T2, r, sig, type).price;
    return { type, K: best.K, dte, prem: best.g.price, delta: best.g.delta, sig, atEntry: val(p.entry), atT1: val(p.t1), atT2: val(p.t2), atStop: val(p.stop) };
  }

  return { dayOption, dayPlan, compute, scoreAt, verdict, backtest, levels, histVol, bs, optionsPlan, isNum };
})();
if (typeof module !== 'undefined') module.exports = Engine;
