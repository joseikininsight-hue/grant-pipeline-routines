// 旧URL → 新ID マッチング (DB マッピング + 前方一致)
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');

const slugRows = parse(
  fs.readFileSync(path.join(__dirname, 'old-slugs.tsv'), 'utf-8'),
  { columns: true, delimiter: '\t', relax_quotes: true, relax_column_count: true }
);
const oldUrls = parse(
  fs.readFileSync(path.join(__dirname, 'grants-old-urls.csv'), 'utf-8'),
  { columns: true }
);

// old_slug (decoded) -> { post_id, new_slug, post_title }
const oldToNew = new Map();
slugRows.forEach((row) => {
  let decoded;
  try { decoded = decodeURIComponent(row.old_slug); }
  catch { decoded = row.old_slug; }
  oldToNew.set(decoded, {
    post_id: row.post_id,
    new_slug: row.new_slug,
    post_title: row.post_title,
  });
});

// 前方一致用: 全 decoded keys
const allDecodedKeys = [...oldToNew.keys()];

const matched = [];
const unmatched = [];

oldUrls.forEach((r) => {
  const p = r.pagePath || '';
  const m = p.match(/^\/grants\/(.+?)\/?$/);
  if (!m) {
    unmatched.push({ ...r, reason: 'no_slug' });
    return;
  }
  const slug = m[1];
  if (!slug || slug === '') {
    unmatched.push({ ...r, reason: 'empty_slug' });
    return;
  }

  // Step 1: 完全一致
  let target = oldToNew.get(slug);
  let matchType = 'exact';

  // Step 2: 前方一致 (URL長制限で末尾切れたケース)
  if (!target) {
    // GA4側が短い (DBの旧slugがGA4 path より長い): k.startsWith(slug)
    // GA4側が長い (DBの旧slugがGA4 path より短い): slug.startsWith(k)
    let best = null;
    for (const k of allDecodedKeys) {
      if (k.startsWith(slug) || slug.startsWith(k)) {
        if (!best || Math.abs(k.length - slug.length) < Math.abs(best.length - slug.length)) {
          best = k;
        }
      }
    }
    if (best) {
      target = oldToNew.get(best);
      matchType = 'prefix';
    }
  }

  if (target) {
    matched.push({
      pagePath: r.pagePath,
      screenPageViews: r.screenPageViews,
      totalUsers: r.totalUsers,
      sessions: r.sessions,
      eventCount: r.eventCount,
      target_id: target.post_id,
      target_slug: target.new_slug,
      target_title: target.post_title,
      match_type: matchType,
    });
  } else {
    unmatched.push({ ...r, reason: 'no_match' });
  }
});

console.log('=== 旧URL マッチング結果 ===');
console.log(`Total old URLs:   ${oldUrls.length}`);
console.log(`  Matched (exact):  ${matched.filter(m => m.match_type === 'exact').length}`);
console.log(`  Matched (prefix): ${matched.filter(m => m.match_type === 'prefix').length}`);
console.log(`  Unmatched:        ${unmatched.length}`);

const matchedPV = matched.reduce((s, r) => s + Number(r.screenPageViews || 0), 0);
const unmatchedPV = unmatched.reduce((s, r) => s + Number(r.screenPageViews || 0), 0);
console.log(`  Matched PV:   ${matchedPV.toLocaleString()}`);
console.log(`  Unmatched PV: ${unmatchedPV.toLocaleString()}`);

const cols = ['pagePath', 'screenPageViews', 'totalUsers', 'sessions', 'eventCount',
              'target_id', 'target_slug', 'target_title', 'match_type'];
fs.writeFileSync(
  path.join(__dirname, 'old-resolved.csv'),
  stringify([cols, ...matched.map((m) => cols.map((c) => m[c] || ''))])
);
fs.writeFileSync(
  path.join(__dirname, 'old-unmatched.csv'),
  stringify([
    ['pagePath', 'screenPageViews', 'reason'],
    ...unmatched.map((m) => [m.pagePath, m.screenPageViews, m.reason]),
  ])
);
console.log('✅ Saved: old-resolved.csv / old-unmatched.csv');
