// 残り未マッチ旧URLを HTTP リダイレクト実体確認で解決
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');
const https = require('https');

const unresolved = parse(
  fs.readFileSync(path.join(__dirname, 'old-unmatched.csv'), 'utf-8'),
  { columns: true }
).filter((r) => r.reason === 'no_match');

async function followRedirects(pagePath, maxHops = 5) {
  return new Promise((resolve) => {
    let hops = 0;
    function fetch(u) {
      if (hops++ > maxHops) return resolve({ final: u, status: 'max_redirects' });
      try {
        const parsed = new URL(u);
        const opts = {
          method: 'HEAD',
          hostname: parsed.hostname,
          path: parsed.pathname + (parsed.search || ''),
          headers: { 'User-Agent': 'Mozilla/5.0 RedirectResolver/1.0' },
          timeout: 10000,
        };
        const req = https.request(opts, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            const next = new URL(res.headers.location, u).href;
            res.resume();
            fetch(next);
          } else {
            res.resume();
            resolve({ final: u, status: res.statusCode });
          }
        });
        req.on('error', (e) => resolve({ final: u, status: 'error', err: e.message }));
        req.on('timeout', () => { req.destroy(); resolve({ final: u, status: 'timeout' }); });
        req.end();
      } catch (e) {
        resolve({ final: u, status: 'parse_error' });
      }
    }
    fetch(`https://joseikin-insight.com${pagePath}`);
  });
}

async function processInBatches(items, fn, concurrency = 10) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
    if (i % 200 === 0 || i + concurrency >= items.length) {
      console.log(`  progress: ${Math.min(i + concurrency, items.length)}/${items.length}`);
    }
  }
  return results;
}

(async () => {
  console.log(`=== Resolve via HTTP redirect ===`);
  console.log(`Target: ${unresolved.length} URLs (concurrency=10)`);
  const t0 = Date.now();

  const results = await processInBatches(unresolved, async (r) => {
    const res = await followRedirects(r.pagePath);
    let finalPath = res.final;
    try { finalPath = new URL(res.final).pathname; } catch {}
    const m = (finalPath || '').match(/\/grants\/grant-(\d+)\/?$/);
    return {
      pagePath: r.pagePath,
      screenPageViews: r.screenPageViews,
      finalPath,
      targetID: m ? m[1] : null,
      finalStatus: res.status,
    };
  }, 10);

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const matched = results.filter((r) => r.targetID);
  const unmatched = results.filter((r) => !r.targetID);
  const matchedPV = matched.reduce((s, r) => s + Number(r.screenPageViews || 0), 0);
  const unmatchedPV = unmatched.reduce((s, r) => s + Number(r.screenPageViews || 0), 0);

  console.log('');
  console.log(`=== Done in ${elapsed}s ===`);
  console.log(`Matched via redirect: ${matched.length} (${matchedPV} PV)`);
  console.log(`Still unmatched:      ${unmatched.length} (${unmatchedPV} PV)`);

  // 状態別集計
  const byStatus = {};
  unmatched.forEach((r) => {
    const s = r.finalStatus;
    byStatus[s] = (byStatus[s] || 0) + 1;
  });
  console.log('Unmatched final statuses:', byStatus);

  fs.writeFileSync(
    path.join(__dirname, 'redirect-resolved.csv'),
    stringify([
      ['pagePath', 'screenPageViews', 'finalPath', 'targetID', 'finalStatus'],
      ...results.map((r) => [r.pagePath, r.screenPageViews, r.finalPath, r.targetID || '', r.finalStatus]),
    ])
  );
  console.log('✅ Saved: redirect-resolved.csv');
})();
