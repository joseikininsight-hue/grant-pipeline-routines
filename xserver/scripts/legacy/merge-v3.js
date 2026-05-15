// 最終統合: slug match + redirect resolved 両方を merged.csv に加算
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');

const merged = parse(
  fs.readFileSync(path.join(__dirname, 'merged.csv'), 'utf-8'),
  { columns: true }
);
const slugResolved = parse(
  fs.readFileSync(path.join(__dirname, 'old-resolved.csv'), 'utf-8'),
  { columns: true }
);
const redirectResolved = parse(
  fs.readFileSync(path.join(__dirname, 'redirect-resolved.csv'), 'utf-8'),
  { columns: true }
);

const oldByID = {};
function add(id, pv, source) {
  if (!oldByID[id]) oldByID[id] = { pv: 0, count: 0, sources: { slug: 0, redirect: 0 } };
  oldByID[id].pv += pv;
  oldByID[id].count++;
  oldByID[id].sources[source]++;
}
slugResolved.forEach((r) => {
  if (r.target_id) add(r.target_id, Number(r.screenPageViews || 0), 'slug');
});
redirectResolved.forEach((r) => {
  if (r.targetID) add(r.targetID, Number(r.screenPageViews || 0), 'redirect');
});

merged.forEach((r) => {
  const old = oldByID[r.ID];
  r.pv_new_only = r.screenPageViews;
  r.pv_old_url = old ? String(old.pv) : '0';
  r.old_url_count = old ? String(old.count) : '0';
  if (old) {
    r.screenPageViews = String(Number(r.screenPageViews || 0) + old.pv);
  }
});

merged.sort(
  (a, b) => Number(b.screenPageViews || 0) - Number(a.screenPageViews || 0)
);

const headers = Object.keys(merged[0]);
fs.writeFileSync(
  path.join(__dirname, 'merged-v3.csv'),
  stringify([headers, ...merged.map((r) => headers.map((h) => r[h] || ''))])
);

const enrichedCount = merged.filter((r) => Number(r.pv_old_url) > 0).length;
const totalAddedPV = Object.values(oldByID).reduce((s, v) => s + v.pv, 0);

console.log('=== merged-v3 (slug + redirect) ===');
console.log(`Total grant: ${merged.length}`);
console.log(`Enriched:    ${enrichedCount}`);
console.log(`Added PV:    ${totalAddedPV.toLocaleString()}`);
console.log('✅ Saved: merged-v3.csv');
