#!/usr/bin/env node
// Search Console: 直近30日 vs 31-90日 の比較で急上昇クエリを抽出
// 出力: sc-queries-recent.csv（直近30日）, sc-queries-prior.csv（31-90日）, sc-trending.csv（成長率順）

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const SITE_URL = 'sc-domain:joseikin-insight.com';
const KEY_FILE = path.join(process.env.HOME || process.env.USERPROFILE, '.secrets/grants-sa.json');
const OUT_RECENT = path.join(__dirname, 'sc-queries-recent.csv');
const OUT_PRIOR = path.join(__dirname, 'sc-queries-prior.csv');
const OUT_TREND = path.join(__dirname, 'sc-trending.csv');

function fmt(d) { return d.toISOString().slice(0, 10); }

async function fetchAllQueries(sc, startDate, endDate) {
  const all = [];
  let startRow = 0;
  while (true) {
    const res = await sc.searchanalytics.query({
      siteUrl: SITE_URL,
      requestBody: {
        startDate, endDate,
        dimensions: ['query'],
        rowLimit: 25000,
        startRow,
      },
    });
    const rows = res.data.rows || [];
    all.push(...rows);
    if (rows.length < 25000) break;
    startRow += 25000;
    await new Promise(r => setTimeout(r, 1000));
  }
  return all;
}

(async () => {
  const auth = new google.auth.GoogleAuth({ keyFile: KEY_FILE, scopes: ['https://www.googleapis.com/auth/webmasters.readonly'] });
  const sc = google.searchconsole({ version: 'v1', auth });

  const today = new Date();
  const d30 = new Date(today.getTime() - 30 * 86400000);
  const d31 = new Date(today.getTime() - 31 * 86400000);
  const d90 = new Date(today.getTime() - 90 * 86400000);

  console.log(`[1/2] 直近30日 (${fmt(d30)} 〜 ${fmt(today)})`);
  const recent = await fetchAllQueries(sc, fmt(d30), fmt(today));
  console.log(`  → ${recent.length}件`);

  console.log(`[2/2] 31-90日前 (${fmt(d90)} 〜 ${fmt(d31)})`);
  const prior = await fetchAllQueries(sc, fmt(d90), fmt(d31));
  console.log(`  → ${prior.length}件`);

  // CSV保存
  function toCSV(rows) {
    const lines = ['query,impressions,clicks,ctr,position'];
    rows.forEach(r => {
      const q = r.keys[0].replace(/"/g, '""');
      lines.push(`"${q}",${r.impressions},${r.clicks},${r.ctr.toFixed(4)},${r.position.toFixed(2)}`);
    });
    return lines.join('\n');
  }
  fs.writeFileSync(OUT_RECENT, toCSV(recent), 'utf-8');
  fs.writeFileSync(OUT_PRIOR, toCSV(prior), 'utf-8');

  // 成長率計算: recent_imp / (prior_imp / 60 * 30) (60日平均→30日換算)
  const priorMap = new Map();
  prior.forEach(r => priorMap.set(r.keys[0], r));

  const trends = [];
  recent.forEach(r => {
    const q = r.keys[0];
    const p = priorMap.get(q);
    const recentImp = r.impressions;
    const priorImpNorm = p ? p.impressions / 2 : 0; // 60日 → 30日換算
    const growth = priorImpNorm > 0 ? (recentImp / priorImpNorm) : (recentImp >= 30 ? 999 : 0);

    // 急上昇判定: 直近impressions ≥ 30 かつ 成長率 ≥ 2.0
    if (recentImp >= 20 && (growth >= 2.0 || (priorImpNorm === 0 && recentImp >= 30))) {
      trends.push({
        query: q,
        recent_imp: recentImp,
        prior_imp_norm: Math.round(priorImpNorm),
        growth: growth === 999 ? 'NEW' : growth.toFixed(2),
        recent_clicks: r.clicks,
        recent_ctr: (r.ctr * 100).toFixed(1),
        recent_pos: r.position.toFixed(1),
      });
    }
  });

  trends.sort((a, b) => b.recent_imp - a.recent_imp);

  // CSV出力
  const csvHeader = ['query','recent_imp','prior_imp_norm','growth','recent_clicks','recent_ctr','recent_pos'];
  const csvLines = [csvHeader.join(',')];
  trends.forEach(t => {
    const row = csvHeader.map(k => {
      const v = t[k] ?? '';
      return /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v;
    });
    csvLines.push(row.join(','));
  });
  fs.writeFileSync(OUT_TREND, csvLines.join('\n'), 'utf-8');

  console.log('\n=== Summary ===');
  console.log(`急上昇クエリ: ${trends.length}件`);
  console.log(`  NEW (前期間ゼロ): ${trends.filter(t => t.growth === 'NEW').length}`);
  console.log(`  3倍以上: ${trends.filter(t => t.growth !== 'NEW' && parseFloat(t.growth) >= 3).length}`);
  console.log(`  2-3倍: ${trends.filter(t => t.growth !== 'NEW' && parseFloat(t.growth) >= 2 && parseFloat(t.growth) < 3).length}`);
  console.log(`\n出力:\n  ${OUT_TREND}`);
})();
