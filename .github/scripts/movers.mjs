// Fetch Alpha Vantage TOP_GAINERS_LOSERS and write a cleaned movers.json for the app.
// Runs in GitHub Actions; the key comes from the AV_KEY repository secret and is never written out.
import fs from 'node:fs';
const KEY = process.env.AV_KEY;
const src = process.argv[2];                       // optional: path to a saved response (for seeding/testing)
let j;
if (src) j = JSON.parse(fs.readFileSync(src, 'utf8'));
else {
  if (!KEY) { console.error('AV_KEY secret is missing'); process.exit(1); }
  const r = await fetch('https://www.alphavantage.co/query?function=TOP_GAINERS_LOSERS&apikey=' + encodeURIComponent(KEY));
  j = await r.json().catch(() => ({}));
}
if (!Array.isArray(j.top_gainers)) {
  console.error('Alpha Vantage did not return movers:', String(j.Information || j.Note || j['Error Message'] || 'unknown').replace(KEY || '\u0000', '[key]').slice(0, 200));
  process.exit(1);                                // keep the previous movers.json
}
const clean = arr => (arr || []).map(x => ({ symbol: String(x.ticker || '').toUpperCase(), price: +x.price, pct: parseFloat(x.change_percentage), volume: +x.volume }))
  .filter(x => /^[A-Z]{1,5}$/.test(x.symbol) && !(x.symbol.length === 5 && /[WURZ]$/.test(x.symbol)) && x.price >= 3 && x.volume >= 500000 && isFinite(x.pct))
  .slice(0, 15);
const out = { updated: String(j.last_updated || '').slice(0, 40), source: 'Alpha Vantage', gainers: clean(j.top_gainers), losers: clean(j.top_losers), active: clean(j.most_actively_traded) };
fs.writeFileSync('movers.json', JSON.stringify(out, null, 1) + '\n');
console.log(`movers.json: ${out.updated} · ${out.gainers.length} gainers, ${out.losers.length} losers, ${out.active.length} active`);
