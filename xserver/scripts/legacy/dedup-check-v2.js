#!/usr/bin/env node
// 重複チェック v2: 地域・金額を保持して、誤検出を排除
// - 同地域・同金額の重複のみを「真の重複」とする
// - 異なる地域・金額は「派生制度」として別分類

const fs = require('fs');
const path = require('path');

const TSV = path.join(__dirname, 'grants-base.tsv');
const OUT_CSV = path.join(__dirname, 'dedup-report-v2.csv');
const OUT_JSON = path.join(__dirname, 'dedup-summary-v2.json');

// 都道府県・主要市区町村
const PREFS = ['北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県','茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県','新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県','静岡県','愛知県','三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県','鳥取県','島根県','岡山県','広島県','山口県','徳島県','香川県','愛媛県','高知県','福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県',
  '青森','岩手','宮城','秋田','山形','福島','茨城','栃木','群馬','埼玉','千葉','東京','神奈川','新潟','富山','石川','福井','山梨','長野','岐阜','静岡','愛知','三重','滋賀','京都','大阪','兵庫','奈良','和歌山','鳥取','島根','岡山','広島','山口','徳島','香川','愛媛','高知','福岡','佐賀','長崎','熊本','大分','宮崎','鹿児島','沖縄'];

function extractRegion(s) {
  if (!s) return null;
  for (const p of PREFS) {
    if (s.includes(p)) return p.replace(/[県府都道]$/, '');
  }
  // 市区町村も抽出
  const m = s.match(/【\s*(?:\d{4}年\s*)?([^】]*?)([市区町村])\s*】/) || s.match(/(\S+?)([市区町村])(?:[】｜|・]|の)/);
  if (m) return m[1] + m[2];
  return null;
}

function extractAmount(s) {
  if (!s) return null;
  // 「最大X万円」「Y億円」「Z億X万円」を正規化
  const patterns = [
    /最大\s*([\d,\.]+)\s*億\s*([\d,]+)\s*万円/,
    /最大\s*([\d,\.]+)\s*億円/,
    /最大\s*([\d,]+)\s*万円/,
    /([\d,]+)\s*万円/,
    /([\d,\.]+)\s*億円/,
  ];
  for (const p of patterns) {
    const m = s.match(p);
    if (m) {
      // 万円換算で数値化
      if (p.source.includes('億') && p.source.includes('万円') && m[2]) {
        return parseFloat(m[1].replace(/,/g, '')) * 10000 + parseFloat(m[2].replace(/,/g, ''));
      }
      if (p.source.includes('億')) return parseFloat(m[1].replace(/,/g, '')) * 10000;
      return parseFloat(m[1].replace(/,/g, ''));
    }
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

// 制度名のコア部分を抽出（地域・年度・金額・装飾を除いた主題）
function extractCore(title) {
  if (!title) return '';
  return title
    .replace(/【[^】]*】/g, '')                    // 【...】まるごと除去
    .replace(/\([^)]*\)|（[^）]*）/g, '')           // 括弧除去
    .replace(/\d{4}年(度)?(版|最新)?/g, '')        // 年度除去
    .replace(/令和\d+年(度)?/g, '')
    .replace(/平成\d+年(度)?/g, '')
    .replace(/最大[\d,\.億万千円]+/g, '')           // 金額除去
    .replace(/[\d,\.]+\s*[億万千]円/g, '')
    .replace(/[最新版完全ガイド徹底解説申請方法条件]/g, '')
    .replace(/[\s　・,、。！!?？|｜\-ー：:]/g, '')
    .toLowerCase();
}

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

console.log('[2/5] 特徴量抽出中...');
rows.forEach(r => {
  r._core = extractCore(r.post_title);
  r._region = extractRegion(r.post_title);
  r._amount = extractAmount(r.post_title);
  r._year = extractYear(r.post_title);
  const pvNum = parseInt(r.gi_pv_total, 10);
  const viewNum = parseInt(r.views_count, 10);
  r._pv = (Number.isFinite(pvNum) ? pvNum : 0) || (Number.isFinite(viewNum) ? viewNum : 0);
});

console.log('[3/5] バケット化（コアキーの先頭4文字）...');
const buckets = new Map();
rows.forEach(r => {
  const key = r._core.slice(0, 4);
  if (!key) return;
  if (!buckets.has(key)) buckets.set(key, []);
  buckets.get(key).push(r);
});
console.log(`  → ${buckets.size} バケット`);

console.log('[4/5] 類似ペア検出中...');
const pairs = [];
let compared = 0;
let bucketIdx = 0;
for (const [key, bucket] of buckets) {
  bucketIdx++;
  if (bucket.length < 2) continue;
  const target = bucket.length > 200 ? bucket.slice(0, 200) : bucket;
  for (let i = 0; i < target.length; i++) {
    for (let j = i + 1; j < target.length; j++) {
      const a = target[i], b = target[j];
      compared++;
      const sim = similarity(a._core, b._core);
      if (sim < 0.85) continue;

      // 同地域・同金額・同制度の場合のみ「重複」と判定
      const sameRegion = a._region === b._region;
      const sameAmount = a._amount === b._amount;
      const sameYear = a._year === b._year;

      let type = 'similar';
      if (sim >= 0.95 && sameRegion && sameAmount) {
        type = 'exact';      // 完全重複（同地域・同金額・同制度）
      } else if (sim >= 0.90 && sameRegion && !sameYear && a._year && b._year) {
        type = 'year_variant'; // 年度違い派生
      } else if (sim >= 0.85 && !sameRegion && a._region && b._region) {
        type = 'region_variant'; // 地域違い派生（同制度の地方版）
      } else if (sim >= 0.85 && sameRegion && a._amount !== b._amount) {
        type = 'amount_variant'; // 金額違い（要確認）
      } else if (sim >= 0.85) {
        type = 'similar';
      }

      pairs.push({
        id_a: a.ID, title_a: a.post_title, status_a: a.app_status, pv_a: a._pv,
        id_b: b.ID, title_b: b.post_title, status_b: b.app_status, pv_b: b._pv,
        year_a: a._year || '', year_b: b._year || '',
        region_a: a._region || '', region_b: b._region || '',
        amount_a: a._amount || '', amount_b: b._amount || '',
        similarity: sim.toFixed(3),
        type,
      });
    }
  }
  if (bucketIdx % 200 === 0) {
    process.stdout.write(`\r  バケット ${bucketIdx}/${buckets.size}  比較: ${compared}  ペア: ${pairs.length}`);
  }
}
console.log(`\n  → 比較: ${compared}  類似ペア: ${pairs.length}`);

console.log('[5/5] レポート出力中...');
const byType = (t) => pairs.filter(p => p.type === t);
const sumPV = (arr) => arr.reduce((s, p) => s + (p.pv_a || 0) + (p.pv_b || 0), 0);

const summary = {
  total_grants: rows.length,
  total_compared: compared,
  total_pairs: pairs.length,
  by_type: {
    exact: byType('exact').length,
    year_variant: byType('year_variant').length,
    region_variant: byType('region_variant').length,
    amount_variant: byType('amount_variant').length,
    similar: byType('similar').length,
  },
  pv_impact: {
    exact: sumPV(byType('exact')),
    year_variant: sumPV(byType('year_variant')),
    amount_variant: sumPV(byType('amount_variant')),
  },
  high_priority: byType('exact').filter(p => (p.pv_a + p.pv_b) >= 10).length,
};

pairs.sort((a, b) => (b.pv_a + b.pv_b) - (a.pv_a + a.pv_b));
const csvHeader = ['type','similarity','id_a','pv_a','status_a','title_a','id_b','pv_b','status_b','title_b','year_a','year_b','region_a','region_b','amount_a','amount_b'];
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

console.log('\n=== Summary v2 ===');
console.log(JSON.stringify(summary, null, 2));
console.log(`\n出力: ${OUT_CSV}`);
console.log(`出力: ${OUT_JSON}`);
