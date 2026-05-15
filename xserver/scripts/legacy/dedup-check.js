#!/usr/bin/env node
// 重複チェック: grants-base.tsv 全件のタイトル類似度・地域・年度パターン分析
// 出力: dedup-report.csv (重複候補ペア), dedup-summary.json

const fs = require('fs');
const path = require('path');

const TSV = path.join(__dirname, 'grants-base.tsv');
const OUT_CSV = path.join(__dirname, 'dedup-report.csv');
const OUT_JSON = path.join(__dirname, 'dedup-summary.json');

// --- 文字列正規化 ---
function normalize(s) {
  if (!s) return '';
  return s
    .replace(/【[^】]*】/g, '')                // 【...】除去
    .replace(/\([^)]*\)/g, '')                 // (...)除去
    .replace(/[（][^）]*[）]/g, '')              // （...）除去
    .replace(/\d{4}年(度)?版?/g, '')           // 「YYYY年」「YYYY年度」「YYYY年版」
    .replace(/令和\d+年(度)?/g, '')             // 令和X年(度)
    .replace(/平成\d+年(度)?/g, '')
    .replace(/[最新版完全ガイド徹底解説]/g, '')   // 装飾語
    .replace(/[第\d+次次補正]/g, '')
    .replace(/[\s　・,、。！!?？|｜\-ー]/g, '') // 記号
    .replace(/[A-Za-zＡ-Ｚａ-ｚ]/g, c => c.toLowerCase())
    .toLowerCase();
}

// 都道府県・主要市町村抽出
const PREFS = ['北海道','青森','岩手','宮城','秋田','山形','福島','茨城','栃木','群馬','埼玉','千葉','東京','神奈川','新潟','富山','石川','福井','山梨','長野','岐阜','静岡','愛知','三重','滋賀','京都','大阪','兵庫','奈良','和歌山','鳥取','島根','岡山','広島','山口','徳島','香川','愛媛','高知','福岡','佐賀','長崎','熊本','大分','宮崎','鹿児島','沖縄'];

function extractRegion(s) {
  if (!s) return null;
  for (const p of PREFS) {
    if (s.includes(p)) return p;
  }
  return null;
}

function extractYear(s) {
  if (!s) return null;
  const m = s.match(/(20\d{2})年/);
  if (m) return parseInt(m[1]);
  const r = s.match(/令和(\d+)年/);
  if (r) return 2018 + parseInt(r[1]);
  return null;
}

// Levenshtein 距離（差分が大きすぎる場合は早期リターン）
function lev(a, b, maxDist) {
  if (Math.abs(a.length - b.length) > maxDist) return maxDist + 1;
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i-1] === b[j-1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+cost);
      rowMin = Math.min(rowMin, dp[i][j]);
    }
    if (rowMin > maxDist) return maxDist + 1;
  }
  return dp[a.length][b.length];
}

function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1.0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 0;
  const maxDist = Math.floor(maxLen * 0.35);
  const d = lev(a, b, maxDist);
  if (d > maxDist) return 0;
  return 1 - d / maxLen;
}

// --- ロード ---
console.log('[1/5] grants-base.tsv 読み込み中...');
const lines = fs.readFileSync(TSV, 'utf-8').split('\n').filter(Boolean);
const header = lines[0].split('\t');
const rows = lines.slice(1).map(line => {
  const cols = line.split('\t');
  const obj = {};
  header.forEach((h, i) => obj[h] = cols[i] || '');
  return obj;
});
console.log(`  → ${rows.length}件`);

// --- 前処理 ---
console.log('[2/5] 正規化中...');
rows.forEach(r => {
  r._norm = normalize(r.post_title);
  r._region = extractRegion(r.post_title);
  r._year = extractYear(r.post_title);
  r._pv = parseInt(r.gi_pv_total || r.views_count || '0', 10);
});

// --- バケット化（先頭4文字でグループ化して比較数を削減） ---
console.log('[3/5] バケット化（先頭4文字）...');
const buckets = new Map();
rows.forEach(r => {
  const key = r._norm.slice(0, 4);
  if (!key) return;
  if (!buckets.has(key)) buckets.set(key, []);
  buckets.get(key).push(r);
});
console.log(`  → ${buckets.size} バケット`);

// --- 類似ペア検出 ---
console.log('[4/5] 類似ペア検出中...');
const pairs = [];
let compared = 0;
let bucketIdx = 0;
for (const [key, bucket] of buckets) {
  bucketIdx++;
  if (bucket.length < 2) continue;
  // 大きすぎるバケットはランダムサンプリング（過剰計算回避）
  const target = bucket.length > 200 ? bucket.slice(0, 200) : bucket;
  for (let i = 0; i < target.length; i++) {
    for (let j = i + 1; j < target.length; j++) {
      const a = target[i], b = target[j];
      compared++;
      const sim = similarity(a._norm, b._norm);
      if (sim >= 0.85) {
        // 重複種別判定
        let type = 'similar';
        if (sim >= 0.95) type = 'exact';
        else if (a._year && b._year && a._year !== b._year && sim >= 0.85) type = 'year_variant';
        else if (a._region && b._region && a._region !== b._region && sim >= 0.85) type = 'region_variant';
        pairs.push({
          id_a: a.ID, title_a: a.post_title, status_a: a.app_status, pv_a: a._pv,
          id_b: b.ID, title_b: b.post_title, status_b: b.app_status, pv_b: b._pv,
          year_a: a._year, year_b: b._year,
          region_a: a._region, region_b: b._region,
          similarity: sim.toFixed(3),
          type,
        });
      }
    }
  }
  if (bucketIdx % 100 === 0) {
    process.stdout.write(`\r  バケット ${bucketIdx}/${buckets.size}  比較: ${compared}  ペア検出: ${pairs.length}`);
  }
}
console.log(`\n  → 比較: ${compared}  類似ペア: ${pairs.length}`);

// --- 集計・出力 ---
console.log('[5/5] レポート出力中...');
const summary = {
  total_grants: rows.length,
  total_compared: compared,
  total_pairs: pairs.length,
  by_type: {
    exact: pairs.filter(p => p.type === 'exact').length,
    year_variant: pairs.filter(p => p.type === 'year_variant').length,
    region_variant: pairs.filter(p => p.type === 'region_variant').length,
    similar: pairs.filter(p => p.type === 'similar').length,
  },
  pv_impact: {
    exact_total_pv: pairs.filter(p => p.type === 'exact').reduce((s, p) => s + p.pv_a + p.pv_b, 0),
    year_variant_total_pv: pairs.filter(p => p.type === 'year_variant').reduce((s, p) => s + p.pv_a + p.pv_b, 0),
  },
};

// CSV出力（PV合計順）
pairs.sort((a, b) => (b.pv_a + b.pv_b) - (a.pv_a + a.pv_b));
const csvHeader = ['type','similarity','id_a','pv_a','status_a','title_a','id_b','pv_b','status_b','title_b','year_a','year_b','region_a','region_b'];
const csvLines = [csvHeader.join(',')];
pairs.forEach(p => {
  const row = csvHeader.map(k => {
    const v = p[k] ?? '';
    return /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v;
  });
  csvLines.push(row.join(','));
});
fs.writeFileSync(OUT_CSV, csvLines.join('\n'), 'utf-8');
fs.writeFileSync(OUT_JSON, JSON.stringify(summary, null, 2), 'utf-8');

console.log('\n=== Summary ===');
console.log(JSON.stringify(summary, null, 2));
console.log(`\n出力: ${OUT_CSV}`);
console.log(`出力: ${OUT_JSON}`);
