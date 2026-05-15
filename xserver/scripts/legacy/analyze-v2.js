// 真のランキング (旧URL分 統合後)
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const merged = parse(
  fs.readFileSync(path.join(__dirname, 'merged-v2.csv'), 'utf-8'),
  { columns: true }
);

const num = (v) => Number(v || 0);

const total = merged.length;
const withPV = merged.filter((r) => num(r.screenPageViews) > 0);
const zeroPV = merged.filter((r) => num(r.screenPageViews) === 0);
const totalPV = merged.reduce((s, r) => s + num(r.screenPageViews), 0);
const totalAddedPV = merged.reduce((s, r) => s + num(r.pv_old_url), 0);

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  補助金図鑑 × GA4 真の統合分析 (v2)');
console.log('  期間: 2025-09-30 ～ 2026-04-27 (208日)');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');

console.log('【1. 統合後サマリ】');
console.log(`  grant記事総数:    ${total.toLocaleString()}件`);
console.log(`  PVあり:           ${withPV.length.toLocaleString()}件 (${(withPV.length/total*100).toFixed(1)}%)`);
console.log(`  PV=0:             ${zeroPV.length.toLocaleString()}件 (${(zeroPV.length/total*100).toFixed(1)}%)`);
console.log(`  総PV (統合):      ${totalPV.toLocaleString()}`);
console.log(`  └ 旧URL分加算:    ${totalAddedPV.toLocaleString()} PV`);
console.log(`  記事平均PV:       ${(totalPV/total).toFixed(2)}`);
console.log('');

console.log('【2. 真のPV TOP 30 (旧URL統合後)】');
withPV.slice(0, 30).forEach((r, i) => {
  const t = (r.post_title || '').substring(0, 42);
  const status = r.app_status === 'closed' ? '🔒' : r.app_status === 'open' ? '🟢' : r.app_status === 'upcoming' ? '⏳' : '❓';
  const oldPV = num(r.pv_old_url);
  const newPV = num(r.pv_new_only);
  const totalPV = num(r.screenPageViews);
  const flag = oldPV > 0 ? `🔄+${oldPV}` : '';
  console.log(`  ${String(i+1).padStart(2)}. ${status}[${String(totalPV).padStart(5)}PV] (${String(newPV).padStart(4)}+${String(oldPV).padStart(4)}) ${t} ${flag}`);
});
console.log('');

console.log('【3. 統合効果が大きい記事 TOP 20 (旧URLで眠っていたPV)】');
const enriched = merged
  .filter((r) => num(r.pv_old_url) > 0)
  .sort((a, b) => num(b.pv_old_url) - num(a.pv_old_url));
console.log(`  該当: ${enriched.length}件`);
enriched.slice(0, 20).forEach((r, i) => {
  const t = (r.post_title || '').substring(0, 40);
  console.log(`  ${String(i+1).padStart(2)}. [+${String(num(r.pv_old_url)).padStart(4)}PV / 旧URL:${String(r.old_url_count)}本] ${t}`);
});
console.log('');

console.log('【4. v1 vs v2 ランキング変動 (TOP 10)】');
console.log('  ※ 旧URL統合により「真のトップ記事」が判明');
withPV.slice(0, 10).forEach((r, i) => {
  const t = (r.post_title || '').substring(0, 40);
  const newPV = num(r.pv_new_only);
  const oldPV = num(r.pv_old_url);
  const total = num(r.screenPageViews);
  console.log(`  ${i+1}位: ${t}`);
  console.log(`       新URL ${newPV} + 旧URL ${oldPV} = 真の${total}PV`);
});
console.log('');

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  分析完了 (v2)');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
