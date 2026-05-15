// ga4-unmatched.csv を分類して旧URLを抽出
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');

const um = parse(
  fs.readFileSync(path.join(__dirname, 'ga4-unmatched.csv'), 'utf-8'),
  { columns: true }
);

const num = (v) => Number(v || 0);

// 分類
const grantsOld = []; // /grants/... 旧URL（マッチしなかった）
const columnPaths = [];
const otherPaths = [];

um.forEach((r) => {
  const p = r.pagePath || '';
  if (p.startsWith('/grants/')) grantsOld.push(r);
  else if (p.startsWith('/column/')) columnPaths.push(r);
  else otherPaths.push(r);
});

const totalPV = (arr) => arr.reduce((s, r) => s + num(r.screenPageViews), 0);

console.log('=== 未マッチ分類 ===');
console.log(`grant旧URL:    ${grantsOld.length}件 / ${totalPV(grantsOld)}PV`);
console.log(`column記事:    ${columnPaths.length}件 / ${totalPV(columnPaths)}PV`);
console.log(`その他:        ${otherPaths.length}件 / ${totalPV(otherPaths)}PV`);
console.log('');

// grant旧URLを PV順にソートして出力
grantsOld.sort((a, b) => num(b.screenPageViews) - num(a.screenPageViews));
console.log('=== grant旧URL TOP 20 ===');
grantsOld.slice(0, 20).forEach((r, i) => {
  const p = (r.pagePath || '').substring(0, 70);
  console.log(`${String(i+1).padStart(2)}. [${String(r.screenPageViews).padStart(4)}PV] ${p}`);
});
console.log('');

console.log('=== その他 TOP 15 ===');
otherPaths.sort((a, b) => num(b.screenPageViews) - num(a.screenPageViews));
otherPaths.slice(0, 15).forEach((r, i) => {
  const p = (r.pagePath || '').substring(0, 70);
  console.log(`${String(i+1).padStart(2)}. [${String(r.screenPageViews).padStart(4)}PV] ${p}`);
});

// 旧URLだけCSVに保存
fs.writeFileSync(
  path.join(__dirname, 'grants-old-urls.csv'),
  stringify([Object.keys(grantsOld[0] || {}), ...grantsOld.map((r) => Object.values(r))])
);
console.log('');
console.log(`✅ Saved: grants-old-urls.csv (${grantsOld.length}件)`);
