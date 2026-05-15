// データ取得 orchestrator
// GA4 / Search Console / WP-CLI から最新データを集める
// 出力: data/ga4-pages.json, data/sc-queries.json, data/grants-base.json, data/anomalies.json
const fs = require('fs');
const path = require('path');
const config = require('./lib/config');
const ga4 = require('./lib/ga4');
const sc = require('./lib/sc');
const wp = require('./lib/wp');

function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }
ensureDir(config.paths.data);
ensureDir(config.paths.logs);

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(path.join(config.paths.logs, `fetch-${config.todayJST}.log`), line + '\n');
}

(async () => {
  log('=== 01-fetch-data START ===');
  const out = {};

  // GA4
  log('GA4: fetching grant pages (90d)...');
  const pages = await ga4.fetchGrantPages({ days: config.ga4.lookbackDays });
  fs.writeFileSync(path.join(config.paths.data, 'ga4-pages.json'), JSON.stringify(pages, null, 2));
  log(`GA4: ${pages.length} pages saved`);
  out.ga4Count = pages.length;

  // GA4 異常検知
  log('GA4: detecting anomalies...');
  const anomalies = await ga4.detectAnomalies();
  fs.writeFileSync(path.join(config.paths.data, 'anomalies.json'), JSON.stringify(anomalies, null, 2));
  log(`GA4: ${anomalies.drops.length} drops / ${anomalies.surges.length} surges`);
  out.drops = anomalies.drops.length;
  out.surges = anomalies.surges.length;

  // Search Console (権限なしの場合はスキップ)
  log('SC: fetching queries (90d)...');
  try {
    const queries = await sc.fetchQueries({ startDate: sc.daysAgo(config.searchConsole.lookbackDays) });
    fs.writeFileSync(path.join(config.paths.data, 'sc-queries.json'), JSON.stringify(queries.slice(0, 100000), null, 2));
    log(`SC: ${queries.length} (page,query) rows saved`);
    out.scCount = queries.length;

    log('SC: detecting ranking changes (drops + rises)...');
    const { drops, rises } = await sc.detectRankingChanges();
    fs.writeFileSync(path.join(config.paths.data, 'ranking-drops.json'), JSON.stringify(drops, null, 2));
    fs.writeFileSync(path.join(config.paths.data, 'ranking-rises.json'), JSON.stringify(rises, null, 2));
    log(`SC: ${drops.length} drops / ${rises.length} rises`);
    out.rankingDrops = drops.length;
    out.rankingRises = rises.length;
  } catch (e) {
    log(`SC SKIPPED (permission?): ${e.message}`);
    fs.writeFileSync(path.join(config.paths.data, 'sc-queries.json'), '[]');
    fs.writeFileSync(path.join(config.paths.data, 'ranking-drops.json'), '[]');
    out.scCount = 0;
    out.rankingDrops = 0;
    out.scError = e.message;
  }

  // WP grant 一覧 (主要メタ込み)
  log('WP: fetching grant posts (with meta)...');
  // メタ全件は重いので、まず ID + 基本属性だけ
  const grants = wp.listGrants({ status: 'publish' });
  fs.writeFileSync(path.join(config.paths.data, 'grants-base.json'), JSON.stringify(grants, null, 2));
  log(`WP: ${grants.length} grants saved`);
  out.grantsCount = grants.length;

  // 旧 slug → 新 slug
  log('WP: fetching old-slug map...');
  try {
    const sql = `SELECT pm.post_id, pm.meta_value AS old_slug, p.post_name AS new_slug FROM wp_postmeta pm INNER JOIN wp_posts p ON pm.post_id=p.ID WHERE pm.meta_key='_wp_old_slug' AND p.post_type='grant'`;
    const tsv = wp.wp(`db query "${sql}" --skip-column-names`);
    const map = tsv.split('\n').filter(Boolean).map((line) => {
      const [post_id, old_slug, new_slug] = line.split('\t');
      return { post_id: Number(post_id), old_slug, new_slug };
    });
    fs.writeFileSync(path.join(config.paths.data, 'old-slugs.json'), JSON.stringify(map, null, 2));
    log(`WP: ${map.length} old slug mappings`);
    out.oldSlugCount = map.length;
  } catch (e) {
    log(`WP: old-slug fetch failed: ${e.message}`);
    out.oldSlugCount = 0;
  }

  fs.writeFileSync(path.join(config.paths.data, '_summary.json'), JSON.stringify({
    fetchedAt: new Date().toISOString(),
    ...out,
  }, null, 2));

  log(`=== 01-fetch-data DONE: ${JSON.stringify(out)} ===`);
})().catch((e) => {
  log(`FATAL: ${e.stack}`);
  process.exit(1);
});
