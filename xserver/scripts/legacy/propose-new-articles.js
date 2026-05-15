#!/usr/bin/env node
// Search Console データを分析し、新規記事として作成すべきキーワードを提案
//
// ロジック:
//   1. 順位上位（1〜30位）かつ表示回数の多いキーワードを抽出
//   2. 既存grant記事のタイトルと突合し、専用記事の有無を判定
//   3. 補助金関連キーワード（補助金/助成金/給付金/奨励金）に絞る
//   4. 機会スコアでランキング
//        opportunity = impressions × CTR_gap × (1 - title_coverage)
//        CTR_gap = (期待CTR_at_position) - 実CTR
//   5. 上位を「新規記事候補」として出力

const fs = require('fs');
const path = require('path');

const SC_QUERIES = path.join(__dirname, 'sc-queries.csv');
const SC_PAGES = path.join(__dirname, 'sc-page-query.csv');
const TSV = path.join(__dirname, 'grants-base.tsv');
const JGRANTS = path.join(__dirname, 'jgrants-all.json');
const OUT_CSV = path.join(__dirname, 'new-article-proposals.csv');
const OUT_MD = path.join(__dirname, 'NEW-ARTICLE-PROPOSALS.md');

// 順位別の期待CTR（業界一般値）
const EXPECTED_CTR = {
  1: 0.30, 2: 0.16, 3: 0.10, 4: 0.07, 5: 0.05,
  6: 0.04, 7: 0.03, 8: 0.025, 9: 0.022, 10: 0.020,
  11: 0.015, 12: 0.013, 13: 0.011, 14: 0.010, 15: 0.009,
  16: 0.008, 17: 0.007, 18: 0.006, 19: 0.005, 20: 0.005,
  21: 0.004, 22: 0.004, 23: 0.003, 24: 0.003, 25: 0.003,
  26: 0.003, 27: 0.002, 28: 0.002, 29: 0.002, 30: 0.002,
};
function expectedCTR(pos) {
  const k = Math.round(pos);
  if (k <= 30) return EXPECTED_CTR[k] || 0.002;
  return 0.001;
}

function parseCSV(file) {
  const text = fs.readFileSync(file, 'utf-8');
  const lines = text.split('\n').filter(Boolean);
  const header = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const cols = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQ = !inQ; continue; }
      if (c === ',' && !inQ) { cols.push(cur); cur = ''; continue; }
      cur += c;
    }
    cols.push(cur);
    const obj = {};
    header.forEach((h, i) => obj[h] = cols[i] || '');
    return obj;
  });
}

// クエリの正規化（補助金共通の語尾を削る）
function tokenizeQuery(q) {
  return q
    .replace(/[\s　]+/g, ' ')
    .replace(/[,、。！!?？|｜・]/g, ' ')
    .toLowerCase()
    .trim()
    .split(' ')
    .filter(Boolean);
}

// 補助金関連キーワードフィルタ
const GRANT_KEYWORDS = ['補助金', '助成金', '給付金', '奨励金', '補助', '支援金', '報奨金'];
function isGrantQuery(q) {
  return GRANT_KEYWORDS.some(kw => q.includes(kw));
}

// 既存記事タイトルとクエリの一致度（0.0-1.0）
function titleCoverage(query, title) {
  if (!query || !title) return 0;
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return 0;
  const titleLower = title.toLowerCase();
  const matched = tokens.filter(t => titleLower.includes(t)).length;
  return matched / tokens.length;
}

console.log('[1/5] データ読み込み...');
if (!fs.existsSync(SC_QUERIES)) {
  console.error(`Search Console データがまだありません: ${SC_QUERIES}`);
  console.error(`先に node fetch-sc.js を完了させてください`);
  process.exit(1);
}
const queries = parseCSV(SC_QUERIES);
console.log(`  クエリ: ${queries.length}件`);

const pageQueries = fs.existsSync(SC_PAGES) ? parseCSV(SC_PAGES) : [];
console.log(`  ページ×クエリ: ${pageQueries.length}件`);

const tsvLines = fs.readFileSync(TSV, 'utf-8').split('\n').filter(Boolean);
const tsvHeader = tsvLines[0].split('\t');
const grants = tsvLines.slice(1).map(line => {
  const cols = line.split('\t');
  const obj = {};
  tsvHeader.forEach((h, i) => obj[h] = cols[i] || '');
  return obj;
});
console.log(`  既存grants: ${grants.length}件`);

const jgrants = fs.existsSync(JGRANTS) ? JSON.parse(fs.readFileSync(JGRANTS, 'utf-8')) : [];
console.log(`  jGrants公式: ${jgrants.length}件`);

console.log('[2/5] 補助金関連クエリ抽出...');
const grantQueries = queries.filter(q => isGrantQuery(q.query)).map(q => ({
  query: q.query,
  impressions: parseInt(q.impressions) || 0,
  clicks: parseInt(q.clicks) || 0,
  ctr: parseFloat(q.ctr) || 0,
  position: parseFloat(q.position) || 999,
}));
console.log(`  → ${grantQueries.length}件`);

console.log('[3/5] フィルタリング (順位1-30位 × impressions≥30)...');
const candidates = grantQueries.filter(q =>
  q.position <= 30 && q.impressions >= 30
);
console.log(`  → ${candidates.length}件`);

console.log('[4/5] 既存記事との突合・スコア計算...');

// クエリ→ページマップ（page-queryから）
const queryToPage = new Map();
pageQueries.forEach(pq => {
  if (!queryToPage.has(pq.query)) queryToPage.set(pq.query, []);
  queryToPage.get(pq.query).push({
    page: pq.page,
    impressions: parseInt(pq.impressions) || 0,
    clicks: parseInt(pq.clicks) || 0,
    position: parseFloat(pq.position) || 999,
  });
});

candidates.forEach(c => {
  // タイトル一致度の最大値
  let maxCov = 0;
  let bestTitle = '';
  let bestId = '';
  for (const g of grants) {
    const cov = titleCoverage(c.query, g.post_title);
    if (cov > maxCov) {
      maxCov = cov;
      bestTitle = g.post_title;
      bestId = g.ID;
    }
  }
  c.titleCoverage = maxCov;
  c.bestExistingId = bestId;
  c.bestExistingTitle = bestTitle;

  // ランディングページ情報
  const lps = queryToPage.get(c.query) || [];
  c.topLandingPage = lps.length > 0 ? lps.sort((a, b) => b.impressions - a.impressions)[0].page : '';

  // jGrants公式の該当制度
  const jgMatch = jgrants.find(j => {
    const jt = (j.title || '').toLowerCase();
    const tokens = tokenizeQuery(c.query);
    return tokens.filter(t => t.length >= 2 && jt.includes(t)).length >= Math.max(1, Math.floor(tokens.length / 2));
  });
  c.jgrantsTitle = jgMatch ? jgMatch.title : '';
  c.jgrantsRegion = jgMatch ? jgMatch.target_area_search : '';
  c.jgrantsAmount = jgMatch ? jgMatch.subsidy_max_limit : '';
  c.jgrantsAcceptance = jgMatch ? jgMatch._acceptance : '';

  // 機会スコア計算
  const expCTR = expectedCTR(c.position);
  const ctrGap = Math.max(0, expCTR - c.ctr);
  const noCoverage = 1 - c.titleCoverage;
  // 30日換算の機会クリック数
  c.opportunityClicks = Math.round(c.impressions * ctrGap);
  c.opportunityScore = Math.round(c.impressions * ctrGap * noCoverage * 100) / 100;
  c.expectedCTR = expCTR;
});

// titleCoverageが0.7以上は「既に専用記事あり」とみなして除外
const proposals = candidates.filter(c => c.titleCoverage < 0.7);
console.log(`  既存記事カバー除外後: ${proposals.length}件`);

// スコアでソート
proposals.sort((a, b) => b.opportunityScore - a.opportunityScore);

console.log('[5/5] 出力...');
// CSV
const csvHeader = ['rank','query','position','impressions','clicks','ctr','expectedCTR','opportunityClicks','opportunityScore','titleCoverage','bestExistingId','bestExistingTitle','topLandingPage','jgrantsTitle','jgrantsRegion','jgrantsAmount','jgrantsAcceptance'];
const csvLines = [csvHeader.join(',')];
proposals.forEach((p, i) => {
  const row = csvHeader.map(k => {
    const v = k === 'rank' ? (i + 1) : (p[k] ?? '');
    return /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v;
  });
  csvLines.push(row.join(','));
});
fs.writeFileSync(OUT_CSV, csvLines.join('\n'), 'utf-8');

// Markdown
const md = [];
const today = new Date().toISOString().slice(0, 10);
md.push(`# 新規記事提案レポート（Search Console + GA4 + jGrants 統合）`);
md.push('');
md.push(`**生成日**: ${today}`);
md.push(`**対象**: joseikin-insight.com`);
md.push(`**期間**: 直近90日`);
md.push('');
md.push(`---`);
md.push('');
md.push(`## エグゼクティブサマリ`);
md.push('');
md.push(`- Search Console から **${queries.length.toLocaleString()}件** のクエリを取得`);
md.push(`- うち補助金関連: **${grantQueries.length.toLocaleString()}件**`);
md.push(`- 順位1-30位 × impressions≥30: **${candidates.length.toLocaleString()}件**`);
md.push(`- 既存記事カバー外（新規候補）: **${proposals.length.toLocaleString()}件**`);
md.push('');

const totalOpp = proposals.reduce((s, p) => s + (p.opportunityClicks || 0), 0);
md.push(`### 推定機会`);
md.push(`- 総機会クリック数（90日）: **${totalOpp.toLocaleString()}回**`);
md.push(`- 月間換算: 約 **${Math.round(totalOpp / 3).toLocaleString()}クリック/月**`);
md.push(`- これらをすべて記事化すれば、月間 ${Math.round(totalOpp / 3).toLocaleString()} 件の追加流入見込み`);
md.push('');
md.push(`---`);
md.push('');

md.push(`## TOP 50 新規記事候補`);
md.push('');
md.push(`順位上位 × 表示回数多 × 既存記事なし のキーワード。\`opportunityScore\` が高いものから記事化。`);
md.push('');
md.push(`| # | キーワード | 順位 | 表示回数 | 実CTR | 期待CTR | 機会クリック | スコア | 公式制度（jGrants） |`);
md.push(`|---|---|---:|---:|---:|---:|---:|---:|---|`);
proposals.slice(0, 50).forEach((p, i) => {
  const jg = p.jgrantsTitle ? `${p.jgrantsAcceptance === 1 ? '🟢公募中' : '⚫終了'} ${p.jgrantsTitle.slice(0, 30)}` : '-';
  md.push(`| ${i+1} | ${p.query} | ${p.position.toFixed(1)} | ${p.impressions.toLocaleString()} | ${(p.ctr*100).toFixed(1)}% | ${(p.expectedCTR*100).toFixed(1)}% | ${p.opportunityClicks} | ${p.opportunityScore} | ${jg} |`);
});
md.push('');

md.push(`---`);
md.push('');
md.push(`## 戦略カテゴリ別の TOP 候補`);
md.push('');

// カテゴリ分類
const cat = {
  '🟢 公募中（速報価値高）': proposals.filter(p => p.jgrantsAcceptance === 1).slice(0, 20),
  '🔵 未掲載で順位1-10位（即書き）': proposals.filter(p => p.position <= 10 && !p.jgrantsTitle).slice(0, 20),
  '🟡 順位11-30位の改善余地': proposals.filter(p => p.position > 10 && p.position <= 30).slice(0, 20),
  '🟣 高インプレッション（>=300）': proposals.filter(p => p.impressions >= 300).slice(0, 20),
};

for (const [name, items] of Object.entries(cat)) {
  md.push(`### ${name} (${items.length}件)`);
  md.push('');
  if (items.length === 0) {
    md.push('該当なし');
  } else {
    md.push(`| キーワード | 順位 | 表示 | 機会 | 公式制度 |`);
    md.push(`|---|---:|---:|---:|---|`);
    items.forEach(p => {
      const jg = p.jgrantsTitle ? p.jgrantsTitle.slice(0, 35) : '-';
      md.push(`| ${p.query} | ${p.position.toFixed(1)} | ${p.impressions} | ${p.opportunityClicks} | ${jg} |`);
    });
  }
  md.push('');
}

md.push(`---`);
md.push('');
md.push(`## 推奨アクション`);
md.push('');
md.push(`### Step 1: 即記事化候補（Top 20 × 公募中）`);
md.push(`- 最優先で書く. jGrants公式情報を出典として、速報性のある記事を作る.`);
md.push(`- テンプレート: \`/grant-rewrite\` Phase 4 の V5版装飾クラス活用`);
md.push('');
md.push(`### Step 2: 既存記事の最適化`);
md.push(`- 順位11-30位は既存記事のメタ・H1見直しで改善可能なケース多い`);
md.push(`- \`bestExistingId\` がある場合はそちらを強化、ないものを新規記事化`);
md.push('');
md.push(`### Step 3: 横断的なまとめ記事`);
md.push(`- 高インプレッションキーワードは「○○補助金まとめ」のようなハブ記事候補`);
md.push('');

md.push(`## 関連ファイル`);
md.push(`- [新規記事候補CSV](./new-article-proposals.csv) (${proposals.length}件)`);
md.push(`- [Search Console全クエリ](./sc-queries.csv) (${queries.length}件)`);
md.push(`- [ページ×クエリ](./sc-page-query.csv) (${pageQueries.length}件)`);

fs.writeFileSync(OUT_MD, md.join('\n'), 'utf-8');

console.log(`\n=== Summary ===`);
console.log(`新規記事候補: ${proposals.length}件`);
console.log(`総機会クリック: ${totalOpp.toLocaleString()}/90日`);
console.log(`\n出力:`);
console.log(`  CSV: ${OUT_CSV}`);
console.log(`  MD: ${OUT_MD}`);
