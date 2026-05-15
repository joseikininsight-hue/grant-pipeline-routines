// 統合CSVを使ってクイック分析
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const merged = parse(
  fs.readFileSync(path.join(__dirname, 'merged.csv'), 'utf-8'),
  { columns: true }
);
const unmatched = parse(
  fs.readFileSync(path.join(__dirname, 'ga4-unmatched.csv'), 'utf-8'),
  { columns: true }
);

const num = (v) => Number(v || 0);
const total = merged.length;
const withPV = merged.filter((r) => num(r.screenPageViews) > 0);
const zeroPV = merged.filter((r) => num(r.screenPageViews) === 0);
const totalPV = merged.reduce((s, r) => s + num(r.screenPageViews), 0);
const totalUsers = merged.reduce((s, r) => s + num(r.totalUsers), 0);

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  補助金図鑑 × GA4 統合分析レポート');
console.log('  期間: 2025-09-30 ～ ' + new Date().toISOString().slice(0, 10));
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');

console.log('【1. 全体サマリ】');
console.log(`  grant記事総数:    ${total.toLocaleString()}件`);
console.log(`  PVあり:           ${withPV.length.toLocaleString()}件 (${((withPV.length/total)*100).toFixed(1)}%)`);
console.log(`  PV=0:             ${zeroPV.length.toLocaleString()}件 (${((zeroPV.length/total)*100).toFixed(1)}%) ← アーカイブ候補`);
console.log(`  総PV:             ${totalPV.toLocaleString()}`);
console.log(`  総ユーザー:       ${totalUsers.toLocaleString()}`);
console.log(`  記事平均PV:       ${(totalPV/total).toFixed(2)}`);
console.log(`  PVあり記事平均:   ${withPV.length ? (totalPV/withPV.length).toFixed(2) : 0}`);
console.log('');

console.log('【2. PV TOP 20 記事】');
withPV.slice(0, 20).forEach((r, i) => {
  const t = (r.post_title || '').substring(0, 45);
  const status = r.app_status === 'closed' ? '🔒' : r.app_status === 'open' ? '🟢' : '⏳';
  console.log(`  ${String(i+1).padStart(2)}. ${status}[${String(r.screenPageViews).padStart(4)}PV] ${t}`);
});
console.log('');

console.log('【3. 受付ステータス別】');
const byStatus = {};
merged.forEach((r) => {
  const s = r.app_status || '(未設定)';
  if (!byStatus[s]) byStatus[s] = { count: 0, pv: 0 };
  byStatus[s].count++;
  byStatus[s].pv += num(r.screenPageViews);
});
Object.entries(byStatus)
  .sort((a, b) => b[1].pv - a[1].pv)
  .forEach(([s, d]) => {
    const avg = (d.pv/d.count).toFixed(1);
    console.log(`  ${s.padEnd(10)} ${String(d.count).padStart(6)}件 / ${String(d.pv).padStart(6)}PV (平均${avg}PV)`);
  });
console.log('');

console.log('【4. 組織タイプ別】');
const byOrgType = {};
merged.forEach((r) => {
  const t = r.org_type || '(未設定)';
  if (!byOrgType[t]) byOrgType[t] = { count: 0, pv: 0 };
  byOrgType[t].count++;
  byOrgType[t].pv += num(r.screenPageViews);
});
Object.entries(byOrgType)
  .sort((a, b) => b[1].pv - a[1].pv)
  .forEach(([t, d]) => {
    const avg = (d.pv/d.count).toFixed(1);
    console.log(`  ${t.padEnd(15)} ${String(d.count).padStart(6)}件 / ${String(d.pv).padStart(6)}PV (平均${avg}PV)`);
  });
console.log('');

console.log('【5. 補助金額帯別（max_amount）】');
const ranges = [
  { name: '〜10万円',    min: 1,        max: 100000 },
  { name: '10〜50万',    min: 100001,   max: 500000 },
  { name: '50〜100万',   min: 500001,   max: 1000000 },
  { name: '100〜500万',  min: 1000001,  max: 5000000 },
  { name: '500万〜1000万', min: 5000001, max: 10000000 },
  { name: '1000万〜1億', min: 10000001, max: 100000000 },
  { name: '1億〜',       min: 100000001, max: Infinity },
];
ranges.forEach((r) => {
  const items = merged.filter((m) => {
    const v = num(m.max_amount);
    return v >= r.min && v <= r.max;
  });
  const pv = items.reduce((s, m) => s + num(m.screenPageViews), 0);
  if (items.length) {
    const avg = (pv/items.length).toFixed(1);
    console.log(`  ${r.name.padEnd(13)} ${String(items.length).padStart(6)}件 / ${String(pv).padStart(6)}PV (平均${avg}PV)`);
  }
});
console.log('');

console.log('【6. 受付終了 × PV高 (リプレイス候補) TOP 10】');
const closedHighPV = merged
  .filter((r) => r.app_status === 'closed' && num(r.screenPageViews) > 5)
  .sort((a, b) => num(b.screenPageViews) - num(a.screenPageViews));
console.log(`  該当: ${closedHighPV.length}件`);
closedHighPV.slice(0, 10).forEach((r, i) => {
  const t = (r.post_title || '').substring(0, 40);
  console.log(`  ${i+1}. [${r.screenPageViews}PV / 締切:${r.deadline_date}] ${t}`);
});
console.log('');

console.log('【7. 0PV × 募集中/予定 (露出強化候補)】');
const openZeroPV = zeroPV.filter(
  (r) => r.app_status === 'open' || r.app_status === 'upcoming'
);
console.log(`  該当: ${openZeroPV.length}件`);
openZeroPV.slice(0, 5).forEach((r, i) => {
  const t = (r.post_title || '').substring(0, 40);
  console.log(`  ${i+1}. [${r.app_status}/${r.organization}] ${t}`);
});
console.log('');

console.log('【8. 独自カウンタ vs GA4 PV の乖離 (上位差分)】');
const withBoth = merged
  .filter((r) => num(r.screenPageViews) > 0 && num(r.gi_pv_total) > 0)
  .map((r) => ({
    ...r,
    diff: num(r.screenPageViews) - num(r.gi_pv_total),
    ratio: num(r.screenPageViews) / Math.max(num(r.gi_pv_total), 1),
  }));
const overReporting = withBoth.filter((r) => r.ratio > 5).sort((a,b) => b.diff - a.diff);
const underReporting = withBoth.filter((r) => r.ratio < 0.2).sort((a,b) => a.diff - b.diff);
console.log(`  GA4 >> 独自(独自カウンタ過小): ${overReporting.length}件`);
console.log(`  GA4 << 独自(独自カウンタ過大): ${underReporting.length}件`);
console.log('');

console.log('【9. 未マッチGA4 path (TOP 15) - URL構造分析】');
console.log(`  未マッチ総数: ${unmatched.length}件`);
unmatched.slice(0, 15).forEach((r, i) => {
  const p = (r.pagePath || '').substring(0, 60);
  console.log(`  ${String(i+1).padStart(2)}. [${String(r.screenPageViews).padStart(4)}PV] ${p}`);
});
console.log('');

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  分析完了');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
