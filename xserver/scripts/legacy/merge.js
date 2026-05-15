// GA4 + WP grant メタ をマージして統合CSVを作る
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');

const GA4_PATH = path.join(__dirname, 'ga4-pages.csv');
const GRANTS_PATH = path.join(__dirname, 'grants-base.tsv');
const OUT_PATH = path.join(__dirname, 'merged.csv');
const UNMATCHED_PATH = path.join(__dirname, 'ga4-unmatched.csv');

const ga4Rows = parse(fs.readFileSync(GA4_PATH, 'utf-8'), { columns: true });
const grantsRows = parse(fs.readFileSync(GRANTS_PATH, 'utf-8'), {
  columns: true,
  delimiter: '\t',
  relax_quotes: true,
  relax_column_count: true,
});

// post_name でインデックス
const grantBySlug = new Map();
grantsRows.forEach((g) => grantBySlug.set(g.post_name, g));

// GA4 → grants マッチ
const merged = [];
const unmatched = [];

ga4Rows.forEach((ga) => {
  const p = ga.pagePath || '';
  const m = p.match(/^\/grants\/([^\/?]+)\/?$/);
  if (m) {
    let slug;
    try { slug = decodeURIComponent(m[1]); } catch { slug = m[1]; }
    const grant = grantBySlug.get(slug);
    if (grant) {
      merged.push({ ...grant, ...ga, pagePath: p });
      return;
    }
  }
  unmatched.push(ga);
});

// PV=0 のgrantも含める
const mergedSlugs = new Set(merged.map((m) => m.post_name));
const zeroPV = grantsRows
  .filter((g) => !mergedSlugs.has(g.post_name))
  .map((g) => ({
    ...g,
    pagePath: `/grants/${g.post_name}/`,
    screenPageViews: '0',
    totalUsers: '0',
    sessions: '0',
    userEngagementDuration: '0',
    engagementRate: '',
    bounceRate: '',
    eventCount: '0',
  }));

const all = [...merged, ...zeroPV];
all.sort((a, b) => Number(b.screenPageViews) - Number(a.screenPageViews));

const headers = [
  'ID', 'post_title', 'post_name', 'post_date', 'post_status',
  'max_amount', 'deadline_date', 'organization', 'org_type',
  'app_status', 'adoption_rate', 'difficulty',
  'gi_pv_total', 'gi_last_access', 'views_count',
  'pagePath', 'screenPageViews', 'totalUsers', 'sessions',
  'userEngagementDuration', 'engagementRate', 'bounceRate', 'eventCount',
];

fs.writeFileSync(
  OUT_PATH,
  stringify([headers, ...all.map((r) => headers.map((h) => r[h] || ''))])
);
fs.writeFileSync(
  UNMATCHED_PATH,
  stringify([
    Object.keys(unmatched[0] || { pagePath: '' }),
    ...unmatched.map((r) => Object.values(r)),
  ])
);

console.log('=== Merge 結果 ===');
console.log(`grant記事総数:       ${grantsRows.length}`);
console.log(`GA4 path総数:        ${ga4Rows.length}`);
console.log(`マッチ成功（PV>0）:  ${merged.length}`);
console.log(`PV=0のgrant:         ${zeroPV.length}`);
console.log(`未マッチGA4 path:    ${unmatched.length} (トップページ・古URL・他投稿等)`);
console.log(`✅ Saved: ${OUT_PATH}`);
console.log(`✅ Saved: ${UNMATCHED_PATH}`);
