// merged.csv に旧URL分のPVを統合
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');

const merged = parse(
  fs.readFileSync(path.join(__dirname, 'merged.csv'), 'utf-8'),
  { columns: true }
);
const resolved = parse(
  fs.readFileSync(path.join(__dirname, 'old-resolved.csv'), 'utf-8'),
  { columns: true }
);

// post_id => 旧URL集計
const oldByID = {};
resolved.forEach((r) => {
  const id = r.target_id;
  if (!oldByID[id]) {
    oldByID[id] = { pv: 0, users: 0, sessions: 0, events: 0, count: 0 };
  }
  oldByID[id].pv += Number(r.screenPageViews || 0);
  oldByID[id].users += Number(r.totalUsers || 0);
  oldByID[id].sessions += Number(r.sessions || 0);
  oldByID[id].events += Number(r.eventCount || 0);
  oldByID[id].count++;
});

// merged に加算
merged.forEach((r) => {
  const old = oldByID[r.ID];
  r.pv_new_only = r.screenPageViews;
  r.pv_old_url = old ? String(old.pv) : '0';
  r.old_url_count = old ? String(old.count) : '0';
  if (old) {
    r.screenPageViews = String(Number(r.screenPageViews || 0) + old.pv);
    r.totalUsers = String(Number(r.totalUsers || 0) + old.users);
    r.sessions = String(Number(r.sessions || 0) + old.sessions);
    r.eventCount = String(Number(r.eventCount || 0) + old.events);
  }
});

// 再ソート
merged.sort(
  (a, b) => Number(b.screenPageViews || 0) - Number(a.screenPageViews || 0)
);

const headers = Object.keys(merged[0]);
fs.writeFileSync(
  path.join(__dirname, 'merged-v2.csv'),
  stringify([headers, ...merged.map((r) => headers.map((h) => r[h] || ''))])
);

const enrichedCount = merged.filter((r) => Number(r.pv_old_url) > 0).length;
const totalAddedPV = Object.values(oldByID).reduce((s, v) => s + v.pv, 0);

console.log('=== merged-v2 生成 ===');
console.log(`総grant記事:           ${merged.length}`);
console.log(`旧URL PVが加算された:  ${enrichedCount}`);
console.log(`加算された総PV:        ${totalAddedPV.toLocaleString()}`);
console.log('✅ Saved: merged-v2.csv');
