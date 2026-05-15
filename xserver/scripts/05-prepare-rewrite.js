// リライト対象の全コンテキストを集約 → stdout (JSON)
// 使い方: node 05-prepare-rewrite.js <postId>
// 出力: 1記事のリライトに必要な全情報をJSON1つにまとめる
const fs = require('fs');
const path = require('path');
const config = require('./lib/config');
const wp = require('./lib/wp');

function load(name) {
  const p = path.join(config.paths.data, `${name}.json`);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

const postId = Number(process.argv[2]);
if (!postId) {
  console.error('Usage: node 05-prepare-rewrite.js <postId>');
  process.exit(1);
}

(async () => {
  // 既存投稿
  const post = JSON.parse(wp.wp(`post get ${postId} --fields=ID,post_title,post_name,post_status,post_date,post_modified,post_content --format=json`));

  // メタ全件 (主要キーのみ)
  const metaKeys = [
    '_yoast_wpseo_title', '_yoast_wpseo_metadesc', '_yoast_wpseo_opengraph-image',
    'application_status', 'deadline_date', 'subsidy_max_amount', 'subsidy_rate',
    'organizer', 'eligibility_summary', 'application_summary',
    'faq_items', 'application_flow_steps', 'required_documents_list',
    'eligible_expenses_list', 'update_history', 'adoption_rate',
  ];
  const meta = {};
  metaKeys.forEach((k) => {
    try { meta[k] = wp.getMeta(postId, k); } catch (e) { meta[k] = ''; }
  });

  // GA4 / SC データから抽出
  const ga4 = load('ga4-pages') || [];
  const scQueries = load('sc-queries') || [];
  const oldSlugs = load('old-slugs') || [];
  const slug = post.post_name;
  const oldSlugsForThis = oldSlugs.filter((o) => o.post_id === postId).map((o) => o.old_slug);
  const possiblePaths = [`/grants/${slug}/`, ...oldSlugsForThis.map((s) => `/grants/${s}/`)];

  const ga4Match = ga4.filter((p) => possiblePaths.some((pp) => p.pagePath === pp || p.pagePath === pp.slice(0, -1)));
  const scMatch = scQueries
    .filter((row) => possiblePaths.some((pp) => row.keys[0].endsWith(pp) || row.keys[0].endsWith(pp.slice(0, -1))))
    .map((row) => ({ query: row.keys[1], clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position }))
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 50);

  const result = {
    type: 'rewrite',
    postId,
    url: `${config.wordpress.siteUrl}/grants/${post.post_name}/`,
    post: {
      title: post.post_title,
      slug: post.post_name,
      status: post.post_status,
      publishedAt: post.post_date,
      lastModified: post.post_modified,
      content: post.post_content,
    },
    meta,
    analytics: {
      ga4: ga4Match,
      searchConsoleQueries: scMatch,
      possiblePaths,
    },
    instructions: {
      goal: 'PV向上・E-E-A-T強化・grant-content.css準拠リライト',
      mustSatisfy: [
        'タイトル 28-32文字',
        'meta_description 100-130文字',
        'TL;DR (5項目以下のolリスト)',
        '黄色背景・絵文字・<style>・style="..."属性すべて禁止',
        'gi-callout / gi-stat / gi-link-card / gi-cta-btn / gi-steps クラスのみ装飾',
        'FAQ重複禁止 (本文 or ACFのどちらか1つ)',
        '出典・参考情報リスト 3本以上',
        '受付終了の場合は後継制度カード必須',
      ],
      qualityFloor: config.limits.minQualityScore,
    },
  };

  console.log(JSON.stringify(result, null, 2));
})().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
