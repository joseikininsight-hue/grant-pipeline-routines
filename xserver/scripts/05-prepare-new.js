// 新規記事生成のためのコンテキスト集約 → stdout (JSON)
// 使い方: node 05-prepare-new.js "<query>"
const fs = require('fs');
const path = require('path');
const config = require('./lib/config');
const wp = require('./lib/wp');

function load(name) {
  const p = path.join(config.paths.data, `${name}.json`);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

const query = process.argv[2];
if (!query) {
  console.error('Usage: node 05-prepare-new.js "<query>"');
  process.exit(1);
}

(async () => {
  const scQueries = load('sc-queries') || [];
  const grants = load('grants-base') || [];
  const rss = load('rss-new-items') || { items: [] };

  // 同じクエリで上位ヒットしている自サイトページ (=現状の漏れ先)
  const queryRows = scQueries.filter((r) => r.keys[1] && r.keys[1].toLowerCase().includes(query.toLowerCase()));

  // クエリのキーワード分解 (簡易)
  const keywords = query.split(/\s+/).filter((w) => w.length >= 2);

  // 既存類似記事 (タイトル部分一致) - リライト判定用
  const existingSimilar = grants
    .filter((g) => keywords.some((k) => g.post_title.includes(k)))
    .slice(0, 20);

  // RSS から関連
  const rssRelated = rss.items.filter((it) => keywords.some((k) => (it.title + ' ' + (it.description || '')).includes(k))).slice(0, 10);

  const result = {
    type: 'new',
    query,
    keywords,
    discoverySource: 'search-console-gap',
    analytics: {
      scQueryRows: queryRows.slice(0, 30).map((r) => ({
        page: r.keys[0],
        query: r.keys[1],
        clicks: r.clicks,
        impressions: r.impressions,
        ctr: r.ctr,
        position: r.position,
      })),
      totalImpressions: queryRows.reduce((s, r) => s + (r.impressions || 0), 0),
      totalClicks: queryRows.reduce((s, r) => s + (r.clicks || 0), 0),
    },
    existingSimilar: existingSimilar.map((g) => ({
      id: g.ID,
      title: g.post_title,
      slug: g.post_name,
      url: `${config.wordpress.siteUrl}/grants/${g.post_name}/`,
      modified: g.post_modified,
    })),
    rssRelated,
    instructions: {
      goal: '検索Gap (高impression × 低CTR)を埋める新規補助金記事',
      researchSteps: [
        '1. WebSearch でキーワードの公式制度名・所管庁を特定',
        '2. WebFetch で公式サイト3本以上から事実情報取得 (支給額・申請期間・必要書類)',
        '3. 競合TOP10をWebFetchで取得し、文字数・見出し構造・サジェストを分析',
        '4. 公式RSSの該当記事を確認 (rssRelated 参照)',
        '5. ハルシネーション防止: 出典必須、不明な数値は省略',
      ],
      mustSatisfy: [
        'タイトル 28-32文字 (検索意図にマッチ)',
        'meta_description 100-130文字',
        'TL;DR (5項目)',
        '一次ソース引用 3本以上',
        'grant-content.css クラスのみ装飾 (gi-*)',
        '<style> インライン禁止',
        '対象地域・業種・支援額を明示',
        '締切日 / 申請期間を必ず明記',
        'JSON-LD: Article + MonetaryGrant + FAQPage 必須',
      ],
      qualityFloor: config.limits.minQualityScore,
    },
  };

  console.log(JSON.stringify(result, null, 2));
})().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
