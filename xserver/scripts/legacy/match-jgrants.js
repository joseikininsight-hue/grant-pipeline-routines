#!/usr/bin/env node
// jGrants公式制度を既存grant記事と突合
// jgrants-all.json (公式) vs grants-base.tsv (自社)
// 出力: 未掲載の新制度候補

const fs = require('fs');
const path = require('path');

const JGRANTS = path.join(__dirname, 'jgrants-all.json');
const TSV = path.join(__dirname, 'grants-base.tsv');
const OUT_NEW = path.join(__dirname, 'new-grant-candidates.csv');
const OUT_SUMMARY = path.join(__dirname, 'new-grant-summary.json');

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
  const maxDist = Math.floor(maxLen * 0.4);
  const d = lev(a, b, maxDist);
  if (d > maxDist) return 0;
  return 1 - d / maxLen;
}

function normalize(s) {
  if (!s) return '';
  return s
    .replace(/【[^】]*】/g, '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/\d{4}年(度)?(版)?/g, '')
    .replace(/令和\d+年(度)?/g, '')
    .replace(/平成\d+年(度)?/g, '')
    .replace(/最大[\d,\.億万千円]+/g, '')
    .replace(/[\s　・,、。！!?？|｜\-ー：:_]/g, '')
    .toLowerCase();
}

console.log('[1/4] データ読み込み...');
const jgrants = JSON.parse(fs.readFileSync(JGRANTS, 'utf-8'));
console.log(`  jGrants: ${jgrants.length}件`);

const lines = fs.readFileSync(TSV, 'utf-8').split('\n').filter(Boolean);
const header = lines[0].split('\t');
const ourGrants = lines.slice(1).map(line => {
  const cols = line.split('\t');
  const obj = {};
  header.forEach((h, i) => obj[h] = cols[i] || '');
  obj._norm = normalize(obj.post_title);
  return obj;
});
console.log(`  自社: ${ourGrants.length}件`);

console.log('[2/4] バケット化（自社側）...');
const ourBuckets = new Map();
ourGrants.forEach(r => {
  const key = r._norm.slice(0, 3);
  if (!key) return;
  if (!ourBuckets.has(key)) ourBuckets.set(key, []);
  ourBuckets.get(key).push(r);
});

console.log('[3/4] 突合処理...');
const newCandidates = [];
const existing = [];

for (const jg of jgrants) {
  const norm = normalize(jg.title);
  if (!norm) continue;
  const key = norm.slice(0, 3);
  const candidates = ourBuckets.get(key) || [];

  let bestMatch = null;
  let bestSim = 0;
  for (const our of candidates) {
    const sim = similarity(norm, our._norm);
    if (sim > bestSim) {
      bestSim = sim;
      bestMatch = our;
    }
  }

  if (bestSim >= 0.75) {
    existing.push({ jg_id: jg.id, jg_title: jg.title, our_id: bestMatch.ID, our_title: bestMatch.post_title, sim: bestSim.toFixed(3) });
  } else {
    newCandidates.push({
      id: jg.id,
      name: jg.name,
      title: jg.title,
      region: jg.target_area_search,
      max_amount: jg.subsidy_max_limit,
      start: jg.acceptance_start_datetime,
      end: jg.acceptance_end_datetime,
      target_employees: jg.target_number_of_employees,
      acceptance: jg._acceptance,
      best_local_sim: bestSim.toFixed(3),
      best_local_id: bestMatch ? bestMatch.ID : '',
      best_local_title: bestMatch ? bestMatch.post_title : '',
    });
  }
}

console.log(`  既存掲載: ${existing.length}件`);
console.log(`  新規候補: ${newCandidates.length}件`);

console.log('[4/4] 出力...');
// 公募中を上位、開始日新しい順
newCandidates.sort((a, b) => {
  if (a.acceptance !== b.acceptance) return b.acceptance - a.acceptance;
  return new Date(b.start || 0) - new Date(a.start || 0);
});

const csvHeader = ['acceptance','region','title','max_amount','start','end','target_employees','best_local_sim','best_local_id','best_local_title','jgrants_id'];
const csvLines = [csvHeader.join(',')];
newCandidates.forEach(c => {
  const row = csvHeader.map(k => {
    const map = { jgrants_id: 'id' };
    const v = c[map[k] || k] ?? '';
    return /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v;
  });
  csvLines.push(row.join(','));
});
fs.writeFileSync(OUT_NEW, csvLines.join('\n'), 'utf-8');

const summary = {
  jgrants_total: jgrants.length,
  jgrants_open: jgrants.filter(j => j._acceptance === 1).length,
  our_grants: ourGrants.length,
  matched_existing: existing.length,
  new_candidates: newCandidates.length,
  new_open: newCandidates.filter(c => c.acceptance === 1).length,
  new_closed: newCandidates.filter(c => c.acceptance === 0).length,
  by_region: {},
};
newCandidates.forEach(c => {
  const r = c.region || '不明';
  summary.by_region[r] = (summary.by_region[r] || 0) + 1;
});

fs.writeFileSync(OUT_SUMMARY, JSON.stringify(summary, null, 2), 'utf-8');

console.log('\n=== Summary ===');
console.log(JSON.stringify(summary, null, 2));
console.log(`\n出力: ${OUT_NEW}`);
console.log(`出力: ${OUT_SUMMARY}`);
