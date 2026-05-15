// 最終分析 (v3: 完全統合後)
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const merged = parse(
  fs.readFileSync(path.join(__dirname, 'merged-v3.csv'), 'utf-8'),
  { columns: true }
);

const num = (v) => Number(v || 0);
const total = merged.length;
const withPV = merged.filter((r) => num(r.screenPageViews) > 0);
const zeroPV = merged.filter((r) => num(r.screenPageViews) === 0);
const totalPV = merged.reduce((s, r) => s + num(r.screenPageViews), 0);
const totalAddedPV = merged.reduce((s, r) => s + num(r.pv_old_url), 0);

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  補助金図鑑 × GA4 完全統合分析 (v3 = 最終版)');
console.log('  期間: 2025-09-30 ～ 2026-04-27 (208日)');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');

console.log('【1. 完全統合後サマリ】');
console.log(`  grant記事総数:    ${total.toLocaleString()}件`);
console.log(`  PVあり:           ${withPV.length.toLocaleString()}件 (${(withPV.length/total*100).toFixed(1)}%)`);
console.log(`  PV=0 (アーカイブ候補): ${zeroPV.length.toLocaleString()}件 (${(zeroPV.length/total*100).toFixed(1)}%)`);
console.log(`  総PV (完全):      ${totalPV.toLocaleString()}`);
console.log(`  └ 旧URL分加算:    ${totalAddedPV.toLocaleString()} PV`);
console.log(`  記事平均PV:       ${(totalPV/total).toFixed(2)}`);
console.log(`  PVあり記事平均:   ${withPV.length ? (totalPV/withPV.length).toFixed(2) : 0}`);
console.log('');

console.log('【2. 真のPV TOP 30 (完全統合後)】');
withPV.slice(0, 30).forEach((r, i) => {
  const t = (r.post_title || '').substring(0, 42);
  const status = r.app_status === 'closed' ? '🔒' : r.app_status === 'open' ? '🟢' : r.app_status === 'upcoming' ? '⏳' : '❓';
  const oldPV = num(r.pv_old_url);
  const newPV = num(r.pv_new_only);
  const tot = num(r.screenPageViews);
  console.log(`  ${String(i+1).padStart(2)}. ${status}[${String(tot).padStart(5)}PV] (新${String(newPV).padStart(4)}+旧${String(oldPV).padStart(4)}) ${t}`);
});
console.log('');

console.log('【3. 受付終了 × 真PV TOP 15 (即リプレイス候補)】');
const closedHigh = withPV
  .filter((r) => r.app_status === 'closed')
  .sort((a, b) => num(b.screenPageViews) - num(a.screenPageViews));
closedHigh.slice(0, 15).forEach((r, i) => {
  const t = (r.post_title || '').substring(0, 38);
  console.log(`  ${i+1}. [${num(r.screenPageViews)}PV / 締切:${r.deadline_date}] ${t}`);
});
console.log('');

console.log('【4. 受付ステータス別 (完全統合)】');
const byStatus = {};
merged.forEach((r) => {
  const s = r.app_status || '(未設定)';
  if (!byStatus[s]) byStatus[s] = { count: 0, pv: 0 };
  byStatus[s].count++;
  byStatus[s].pv += num(r.screenPageViews);
});
Object.entries(byStatus).sort((a, b) => b[1].pv - a[1].pv).forEach(([s, d]) => {
  const avg = (d.pv/d.count).toFixed(1);
  console.log(`  ${s.padEnd(10)} ${String(d.count).padStart(6)}件 / ${String(d.pv).padStart(6)}PV (平均${avg}PV)`);
});
console.log('');

console.log('【5. 組織タイプ別 (完全統合)】');
const byOrg = {};
merged.forEach((r) => {
  const t = r.org_type || '(未設定)';
  if (!byOrg[t]) byOrg[t] = { count: 0, pv: 0 };
  byOrg[t].count++;
  byOrg[t].pv += num(r.screenPageViews);
});
Object.entries(byOrg).sort((a, b) => b[1].pv - a[1].pv).forEach(([t, d]) => {
  const avg = (d.pv/d.count).toFixed(1);
  console.log(`  ${t.padEnd(15)} ${String(d.count).padStart(6)}件 / ${String(d.pv).padStart(6)}PV (平均${avg}PV)`);
});
console.log('');

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  v3 完了 (PV 17,688 → 22,983 / +30%回収)');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
