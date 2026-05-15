#!/usr/bin/env node
// 新規記事提案 v2: クラスタリング + jGrants 厳格突合
//
// 改善点:
//   1. クエリのクラスタリング (共通の地域名 + カテゴリでグループ化)
//      → 「板橋区 給付金 最新」「板橋区 給付金 3万円」「板橋区 給付金 いつ」 = 1クラスター
//      → 1記事でまとめれば全部の機会クリックを獲得できる
//   2. jGrants突合の厳格化 (制度名の特徴語が3文字以上一致した場合のみ)
//   3. ハブ記事 vs 個別記事 の判定
//   4. 機会スコアの再計算 (impressions×CTR_gap×coverage_gap)

const fs = require('fs');
const path = require('path');

const SC_QUERIES = path.join(__dirname, 'sc-queries.csv');
const SC_PAGES = path.join(__dirname, 'sc-page-query.csv');
const TSV = path.join(__dirname, 'grants-base.tsv');
const JGRANTS = path.join(__dirname, 'jgrants-all.json');
const OUT_CSV = path.join(__dirname, 'new-article-proposals-v2.csv');
const OUT_MD = path.join(__dirname, 'NEW-ARTICLE-PROPOSALS-V2.md');
const OUT_CLUSTER_CSV = path.join(__dirname, 'cluster-proposals.csv');

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

// 都道府県・市区郡町村の抽出
const PREFS = ['北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県','茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県','新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県','静岡県','愛知県','三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県','鳥取県','島根県','岡山県','広島県','山口県','徳島県','香川県','愛媛県','高知県','福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県',
  '北海道','青森','岩手','宮城','秋田','山形','福島','茨城','栃木','群馬','埼玉','千葉','東京','神奈川','新潟','富山','石川','福井','山梨','長野','岐阜','静岡','愛知','三重','滋賀','京都','大阪','兵庫','奈良','和歌山','鳥取','島根','岡山','広島','山口','徳島','香川','愛媛','高知','福岡','佐賀','長崎','熊本','大分','宮崎','鹿児島','沖縄'];

function extractGeo(q) {
  for (const p of PREFS) {
    if (q.includes(p)) return p.replace(/[県府都道]$/, '');
  }
  // 区・市・町・村パターン
  const m = q.match(/(\S{2,8}?)([市区町村郡])/);
  if (m) return m[1] + m[2];
  return null;
}

// カテゴリ抽出（補助金の主題）
const CATEGORIES = [
  { name: '給付金', re: /給付金/ },
  { name: '助成金', re: /助成金/ },
  { name: '奨励金', re: /奨励金/ },
  { name: '電動自転車', re: /電動.*自転車|自転車.*補助/ },
  { name: 'ヘルメット', re: /ヘルメット/ },
  { name: 'EV補助金', re: /ev|電気自動車|電動車/i },
  { name: '太陽光', re: /太陽光|蓄電池|ソーラー/ },
  { name: '空き家解体', re: /空き家|解体/ },
  { name: '耐震', re: /耐震/ },
  { name: '介護', re: /介護/ },
  { name: '住宅リフォーム', re: /リフォーム|改修|リノベ/ },
  { name: '保育', re: /保育|認可外|チャイルドシート|ベビーカー/ },
  { name: '感震・防災', re: /感震|防災|防犯|警報|地震/ },
  { name: '医療', re: /医療|不妊|卵子|妊婦/ },
  { name: '農業', re: /農業|スマート農業|獣害/ },
  { name: '事業者向け', re: /事業者|中小企業|創業|起業|個人事業/ },
];

function extractCategory(q) {
  for (const c of CATEGORIES) {
    if (c.re.test(q.toLowerCase())) return c.name;
  }
  if (q.includes('補助金')) return '補助金一般';
  return 'その他';
}

function tokenize(s) {
  return s.replace(/[\s　]+/g, ' ').replace(/[,、。！!?？|｜・]/g, ' ').toLowerCase().trim().split(' ').filter(Boolean);
}

const GRANT_KW = ['補助金', '助成金', '給付金', '奨励金', '補助', '支援金', '報奨金'];
function isGrantQuery(q) {
  return GRANT_KW.some(kw => q.includes(kw));
}

function titleCoverage(query, title) {
  const tokens = tokenize(query);
  if (tokens.length === 0 || !title) return 0;
  const titleLower = title.toLowerCase();
  const matched = tokens.filter(t => t.length >= 2 && titleLower.includes(t)).length;
  const meaningful = tokens.filter(t => t.length >= 2).length;
  return meaningful === 0 ? 0 : matched / meaningful;
}

console.log('[1/6] データ読み込み...');
const queries = parseCSV(SC_QUERIES);
const pageQueries = parseCSV(SC_PAGES);
const tsvLines = fs.readFileSync(TSV, 'utf-8').split('\n').filter(Boolean);
const tsvHeader = tsvLines[0].split('\t');
const grants = tsvLines.slice(1).map(line => {
  const cols = line.split('\t');
  const obj = {};
  tsvHeader.forEach((h, i) => obj[h] = cols[i] || '');
  return obj;
});
const jgrants = JSON.parse(fs.readFileSync(JGRANTS, 'utf-8'));
console.log(`  クエリ ${queries.length} / ページ×クエリ ${pageQueries.length} / 既存 ${grants.length} / jGrants ${jgrants.length}`);

console.log('[2/6] 補助金関連クエリ抽出 + 特徴量付与...');
const cands = [];
for (const q of queries) {
  if (!isGrantQuery(q.query)) continue;
  const pos = parseFloat(q.position) || 999;
  const imp = parseInt(q.impressions) || 0;
  if (imp < 20) continue;  // 微小ノイズ除去
  cands.push({
    query: q.query,
    impressions: imp,
    clicks: parseInt(q.clicks) || 0,
    ctr: parseFloat(q.ctr) || 0,
    position: pos,
    geo: extractGeo(q.query),
    category: extractCategory(q.query),
  });
}
console.log(`  → ${cands.length}件`);

console.log('[3/6] クラスタリング (geo + category)...');
const clusters = new Map();
for (const c of cands) {
  const key = `${c.geo || '全国'}__${c.category}`;
  if (!clusters.has(key)) {
    clusters.set(key, {
      key, geo: c.geo || '全国', category: c.category,
      queries: [], totalImpressions: 0, totalClicks: 0, weightedPosition: 0,
    });
  }
  const cl = clusters.get(key);
  cl.queries.push(c);
  cl.totalImpressions += c.impressions;
  cl.totalClicks += c.clicks;
  cl.weightedPosition += c.position * c.impressions;
}
for (const cl of clusters.values()) {
  cl.avgPosition = cl.totalImpressions > 0 ? cl.weightedPosition / cl.totalImpressions : 999;
  cl.queryCount = cl.queries.length;
  cl.actualCTR = cl.totalImpressions > 0 ? cl.totalClicks / cl.totalImpressions : 0;
  cl.expectedCTR = expectedCTR(cl.avgPosition);
  cl.opportunityClicks = Math.round(cl.totalImpressions * Math.max(0, cl.expectedCTR - cl.actualCTR));
}
console.log(`  → ${clusters.size}クラスター`);

console.log('[4/6] 既存記事マッチ（クラスター単位）...');
for (const cl of clusters.values()) {
  // クラスター代表クエリ = 最多imp
  const repQuery = cl.queries.sort((a, b) => b.impressions - a.impressions)[0].query;
  cl.representativeQuery = repQuery;

  let maxCov = 0, bestId = '', bestTitle = '';
  for (const g of grants) {
    const cov = titleCoverage(repQuery, g.post_title);
    if (cov > maxCov) { maxCov = cov; bestId = g.ID; bestTitle = g.post_title; }
  }
  cl.titleCoverage = maxCov;
  cl.bestExistingId = bestId;
  cl.bestExistingTitle = bestTitle;

  // jGrants 厳格突合: クエリの特徴語(3文字以上)を2つ以上含む
  const tokens = tokenize(repQuery).filter(t => t.length >= 3 && !GRANT_KW.includes(t));
  let jgMatch = null;
  if (tokens.length >= 1) {
    jgMatch = jgrants.find(j => {
      const jt = (j.title || '').toLowerCase();
      const matched = tokens.filter(t => jt.includes(t)).length;
      return matched >= Math.min(2, tokens.length);
    });
  }
  cl.jgrantsTitle = jgMatch ? jgMatch.title : '';
  cl.jgrantsRegion = jgMatch ? jgMatch.target_area_search : '';
  cl.jgrantsAcceptance = jgMatch ? jgMatch._acceptance : '';
  cl.jgrantsId = jgMatch ? jgMatch.id : '';

  // 推奨アクション
  if (cl.titleCoverage >= 0.7) {
    cl.action = 'optimize_existing';
    cl.actionDetail = `既存ID:${cl.bestExistingId} を最適化`;
  } else if (cl.queryCount >= 3) {
    cl.action = 'create_hub';
    cl.actionDetail = `${cl.queryCount}クエリを束ねるハブ記事作成`;
  } else if (cl.queryCount >= 1) {
    cl.action = 'create_individual';
    cl.actionDetail = '個別記事作成';
  }
}

console.log('[5/6] スコアリング・ソート...');
const proposals = [...clusters.values()]
  .filter(cl => cl.opportunityClicks >= 2 && cl.titleCoverage < 0.7)
  .sort((a, b) => b.opportunityClicks - a.opportunityClicks);

console.log(`  → 提案${proposals.length}件`);

console.log('[6/6] 出力...');

// クラスター単位 CSV
{
  const h = ['rank','geo','category','representativeQuery','queryCount','totalImpressions','avgPosition','actualCTR','expectedCTR','opportunityClicks','titleCoverage','action','actionDetail','bestExistingId','bestExistingTitle','jgrantsTitle','jgrantsAcceptance'];
  const lines = [h.join(',')];
  proposals.forEach((p, i) => {
    const row = h.map(k => {
      const v = k === 'rank' ? (i+1) : (p[k] ?? '');
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    });
    lines.push(row.join(','));
  });
  fs.writeFileSync(OUT_CLUSTER_CSV, lines.join('\n'), 'utf-8');
}

// 全候補CSV (クエリ単位)
{
  const all = [];
  for (const cl of clusters.values()) {
    if (cl.titleCoverage >= 0.7) continue;
    cl.queries.forEach(q => all.push({ ...q, cluster: cl.key, action: cl.action, jgrantsTitle: cl.jgrantsTitle }));
  }
  all.sort((a, b) => b.impressions - a.impressions);
  const h = ['cluster','query','impressions','clicks','ctr','position','geo','category','action','jgrantsTitle'];
  const lines = [h.join(',')];
  all.forEach(q => {
    const row = h.map(k => {
      const v = q[k] ?? '';
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    });
    lines.push(row.join(','));
  });
  fs.writeFileSync(OUT_CSV, lines.join('\n'), 'utf-8');
}

// Markdown
const md = [];
const today = new Date().toISOString().slice(0, 10);
md.push(`# 新規記事提案レポート v2 (クラスタリング統合版)`);
md.push('');
md.push(`**生成日**: ${today}  **対象**: joseikin-insight.com  **期間**: 直近90日`);
md.push('');
md.push(`---`);
md.push('');

// サマリ
const totalOpp = proposals.reduce((s, p) => s + p.opportunityClicks, 0);
const totalImp = proposals.reduce((s, p) => s + p.totalImpressions, 0);
md.push(`## エグゼクティブサマリ`);
md.push('');
md.push(`Search Console から **${queries.length.toLocaleString()}件** のクエリを取得。補助金関連 6,115件を **${clusters.size}クラスター** にまとめ、既存記事カバー率を計算した結果、**${proposals.length}クラスター** が新規記事化候補と判定されました。`);
md.push('');
md.push(`| 指標 | 値 |`);
md.push(`|---|---:|`);
md.push(`| 提案クラスター数 | ${proposals.length} |`);
md.push(`| 統合表示回数（90日） | ${totalImp.toLocaleString()} |`);
md.push(`| 機会クリック（90日） | **${totalOpp.toLocaleString()}** |`);
md.push(`| 月間換算機会 | **${Math.round(totalOpp/3).toLocaleString()}クリック/月** |`);
md.push('');

// アクション別集計
const byAction = { create_hub: [], create_individual: [], optimize_existing: [] };
proposals.forEach(p => byAction[p.action]?.push(p));
md.push(`### アクション別`);
md.push(`- 🆕 **ハブ記事作成** (3クエリ以上を束ねる): ${byAction.create_hub.length}件 / 機会${byAction.create_hub.reduce((s,p)=>s+p.opportunityClicks,0)}クリック`);
md.push(`- 📝 **個別記事作成** (1-2クエリ): ${byAction.create_individual.length}件 / 機会${byAction.create_individual.reduce((s,p)=>s+p.opportunityClicks,0)}クリック`);
md.push('');
md.push(`---`);
md.push('');

// ハブ記事候補TOP30
md.push(`## 🆕 ハブ記事 新規作成 TOP 30 (3クエリ以上をまとめる)`);
md.push('');
md.push(`複数の検索クエリが同じテーマに集中している → **1本のまとめ記事**で全部の流入を獲得できる。`);
md.push('');
md.push(`| # | 地域 | カテゴリ | 代表クエリ | クエリ数 | 統合imp | 平均順位 | 機会クリック | 公式制度 |`);
md.push(`|---|---|---|---|---:|---:|---:|---:|---|`);
byAction.create_hub.slice(0, 30).forEach((p, i) => {
  const jg = p.jgrantsTitle ? `${p.jgrantsAcceptance === 1 ? '🟢' : '⚫'}${p.jgrantsTitle.slice(0, 30)}` : '-';
  md.push(`| ${i+1} | ${p.geo} | ${p.category} | ${p.representativeQuery} | ${p.queryCount} | ${p.totalImpressions.toLocaleString()} | ${p.avgPosition.toFixed(1)} | ${p.opportunityClicks} | ${jg} |`);
});
md.push('');

// 各ハブ記事の詳細（TOP10）
md.push(`### ハブ記事 TOP 10 詳細`);
md.push('');
byAction.create_hub.slice(0, 10).forEach((p, i) => {
  md.push(`#### ${i+1}. ${p.geo} × ${p.category} (機会${p.opportunityClicks}クリック/90日)`);
  md.push('');
  md.push(`**含まれるクエリ ${p.queryCount}件** (impressions順):`);
  md.push('');
  md.push(`| クエリ | 順位 | 表示 | クリック | CTR |`);
  md.push(`|---|---:|---:|---:|---:|`);
  p.queries.sort((a,b) => b.impressions - a.impressions).slice(0, 15).forEach(q => {
    md.push(`| ${q.query} | ${q.position.toFixed(1)} | ${q.impressions} | ${q.clicks} | ${(q.ctr*100).toFixed(1)}% |`);
  });
  md.push('');
  if (p.bestExistingTitle) {
    md.push(`**既存類似記事**: [ID:${p.bestExistingId}] ${p.bestExistingTitle.slice(0, 60)} (一致度 ${(p.titleCoverage*100).toFixed(0)}%)`);
    md.push('');
  }
  if (p.jgrantsTitle) {
    md.push(`**対応する公式制度**: ${p.jgrantsAcceptance === 1 ? '🟢公募中' : '⚫終了'} ${p.jgrantsTitle}`);
    md.push('');
  }
  md.push(`**推奨タイトル案**:`);
  md.push(`- 【${today.slice(0,4)}年最新】${p.geo}の${p.category}まとめ｜申請方法・対象・金額を完全解説`);
  md.push(`- ${p.geo}で使える${p.category}一覧 | 個人・事業者向けに徹底解説`);
  md.push('');
});
md.push(`---`);
md.push('');

// 個別記事候補TOP20
md.push(`## 📝 個別記事 新規作成 TOP 20 (単一クエリ)`);
md.push('');
md.push(`単発クエリだが順位が高く機会大きいもの。`);
md.push('');
md.push(`| # | 地域 | カテゴリ | クエリ | 順位 | 表示 | 機会 | 公式制度 |`);
md.push(`|---|---|---|---|---:|---:|---:|---|`);
byAction.create_individual.slice(0, 20).forEach((p, i) => {
  const q = p.queries[0];
  const jg = p.jgrantsTitle ? `${p.jgrantsAcceptance === 1 ? '🟢' : '⚫'}${p.jgrantsTitle.slice(0, 30)}` : '-';
  md.push(`| ${i+1} | ${p.geo} | ${p.category} | ${q.query} | ${q.position.toFixed(1)} | ${q.impressions} | ${p.opportunityClicks} | ${jg} |`);
});
md.push('');

md.push(`---`);
md.push('');
md.push(`## 推奨次アクション`);
md.push('');
md.push(`### Phase 1: 即書きハブ記事 (TOP10、推定機会${byAction.create_hub.slice(0,10).reduce((s,p)=>s+p.opportunityClicks,0)}クリック/90日)`);
byAction.create_hub.slice(0, 10).forEach((p, i) => {
  md.push(`${i+1}. \`${p.geo} × ${p.category}\` - ${p.queryCount}クエリ統合 (機会${p.opportunityClicks})`);
});
md.push('');
md.push(`### Phase 2: 高機会個別記事 (TOP10)`);
byAction.create_individual.slice(0, 10).forEach((p, i) => {
  const q = p.queries[0];
  md.push(`${i+1}. \`${q.query}\` - 順位${q.position.toFixed(1)} / imp${q.impressions} (機会${p.opportunityClicks})`);
});
md.push('');
md.push(`### Phase 3: 既存記事最適化（titleCoverage 0.5-0.7）`);
md.push(`- ハブ化前の暫定対応として、既存記事のメタ・H1見直しでも改善可能`);
md.push('');
md.push(`---`);
md.push('');
md.push(`## 関連ファイル`);
md.push(`- [クラスター単位提案](./cluster-proposals.csv) (${proposals.length}件)`);
md.push(`- [全候補クエリ](./new-article-proposals-v2.csv)`);
md.push(`- [Search Console全クエリ](./sc-queries.csv) (${queries.length}件)`);

fs.writeFileSync(OUT_MD, md.join('\n'), 'utf-8');

console.log('\n=== Summary v2 ===');
console.log(`提案クラスター: ${proposals.length}`);
console.log(`  ハブ記事: ${byAction.create_hub.length}`);
console.log(`  個別記事: ${byAction.create_individual.length}`);
console.log(`総機会クリック: ${totalOpp}/90日 (月間${Math.round(totalOpp/3)})`);
console.log(`\n出力:`);
console.log(`  MD: ${OUT_MD}`);
console.log(`  CSV(クラスター): ${OUT_CLUSTER_CSV}`);
console.log(`  CSV(全クエリ): ${OUT_CSV}`);
