#!/usr/bin/env node
// 統合Markdownレポート生成
// 入力: dedup-report-v2.csv, dedup-summary-v2.json, new-grant-candidates.csv, new-grant-summary.json
// 出力: GRANT-REWRITE-REPORT.md

const fs = require('fs');
const path = require('path');

const dedupSum = JSON.parse(fs.readFileSync(path.join(__dirname, 'dedup-summary-v2.json'), 'utf-8'));
const newSum = JSON.parse(fs.readFileSync(path.join(__dirname, 'new-grant-summary.json'), 'utf-8'));

function parseCSV(file) {
  const text = fs.readFileSync(file, 'utf-8');
  const lines = text.split('\n').filter(Boolean);
  const header = lines[0].split(',');
  return lines.slice(1).map(line => {
    // 簡易CSVパーサ（"..."引用対応）
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
    header.forEach((h, i) => obj[h.trim()] = cols[i] || '');
    return obj;
  });
}

const dedupRows = parseCSV(path.join(__dirname, 'dedup-report-v2.csv'));
const newRows = parseCSV(path.join(__dirname, 'new-grant-candidates.csv'));

// === 重複サマリ ===
const exactPairs = dedupRows.filter(r => r.type === 'exact').map(r => ({
  ...r,
  pv_total: (parseInt(r.pv_a) || 0) + (parseInt(r.pv_b) || 0),
}));
exactPairs.sort((a, b) => b.pv_total - a.pv_total);

const amountVariants = dedupRows.filter(r => r.type === 'amount_variant').map(r => ({
  ...r,
  pv_total: (parseInt(r.pv_a) || 0) + (parseInt(r.pv_b) || 0),
}));
amountVariants.sort((a, b) => b.pv_total - a.pv_total);

const yearVariants = dedupRows.filter(r => r.type === 'year_variant').map(r => ({
  ...r,
  pv_total: (parseInt(r.pv_a) || 0) + (parseInt(r.pv_b) || 0),
}));
yearVariants.sort((a, b) => b.pv_total - a.pv_total);

// === 新規候補 (公募中のみ) ===
const newOpen = newRows.filter(r => r.acceptance === '1');
// 締切順
newOpen.sort((a, b) => new Date(a.end || '9999-12-31') - new Date(b.end || '9999-12-31'));

// 地域別TOP（全国除く都道府県のみ）
const byRegion = {};
newOpen.forEach(r => {
  const reg = r.region || '不明';
  if (!byRegion[reg]) byRegion[reg] = [];
  byRegion[reg].push(r);
});

// 高額補助金 (1000万円以上)
const highAmount = newOpen.filter(r => parseInt(r.max_amount) >= 10000000);
highAmount.sort((a, b) => parseInt(b.max_amount) - parseInt(a.max_amount));

// === レポート生成 ===
const today = new Date().toISOString().slice(0, 10);
const md = [];

md.push(`# 補助金記事 統合レポート: 重複検出 + 新規候補`);
md.push('');
md.push(`**生成日**: ${today}`);
md.push(`**対象サイト**: joseikin-insight.com`);
md.push(`**スキル**: \`/grant-rewrite\` Phase 1-F + 重複検査拡張`);
md.push('');
md.push(`---`);
md.push('');

// === 1. エグゼクティブサマリ ===
md.push(`## エグゼクティブサマリ`);
md.push('');
md.push(`### 重複検査`);
md.push(`- 既存記事 **${dedupSum.total_grants.toLocaleString()}件** を解析`);
md.push(`- **完全重複** (同地域・同金額・同制度): **${dedupSum.by_type.exact}件のペア**, PV影響 **${dedupSum.pv_impact.exact.toLocaleString()}**`);
md.push(`- **金額違い** (要確認、第N回など同制度の派生): **${dedupSum.by_type.amount_variant}件**, PV影響 **${dedupSum.pv_impact.amount_variant.toLocaleString()}**`);
md.push(`- **年度違い** (旧年度記事の残存): **${dedupSum.by_type.year_variant}件**, PV影響 **${dedupSum.pv_impact.year_variant.toLocaleString()}**`);
md.push(`- **地域違い** (同制度の都道府県別記事、正常パターン): ${dedupSum.by_type.region_variant}件`);
md.push(`- **高優先** (完全重複でPV合計≥10): **${dedupSum.high_priority}件のペア** ← 即対応推奨`);
md.push('');
md.push(`### 新規候補（jGrants公式API突合）`);
md.push(`- jGrants 公式制度 **${newSum.jgrants_total.toLocaleString()}件** と既存 **${newSum.our_grants.toLocaleString()}件** を突合`);
md.push(`- 既存掲載: ${newSum.matched_existing}件のみ`);
md.push(`- **新規候補**: **${newSum.new_candidates.toLocaleString()}件**`);
md.push(`  - うち公募中: **${newSum.new_open}件** ← 即時記事化推奨`);
md.push(`  - うち終了済み: ${newSum.new_closed.toLocaleString()}件 (アーカイブ価値で再評価)`);
md.push('');
md.push(`### 推奨アクション`);
md.push(`1. **重複統合**: 完全重複205ペアのうち、PV影響が大きい高優先176件をマージ → canonical 設定 + 301リダイレクト`);
md.push(`2. **金額違い派生** 167件は同制度の「第N回」「コース別」が多い → 1記事に統合し回次セクションで管理`);
md.push(`3. **公募中の新規候補221件** から、PV見込みが高い「全国向け」「東京都」「高額補助金」を優先記事化`);
md.push(`4. 終了済み2,139件はアーカイブ記事として段階的に追加（受付終了バッジ＋出典明記）`);
md.push('');
md.push(`---`);
md.push('');

// === 2. 完全重複 TOP ===
md.push(`## 1. 完全重複ペア TOP 30 (PV合計順)`);
md.push('');
md.push(`同制度・同地域・同金額のため統合候補。PV合計が大きいものから順に対応。`);
md.push('');
md.push(`| # | 残す | 統合 | PV合計 | 制度 |`);
md.push(`|---|---|---|---:|---|`);
exactPairs.slice(0, 30).forEach((p, i) => {
  // PV高い方を残す候補とする
  const keep = (parseInt(p.pv_a) || 0) >= (parseInt(p.pv_b) || 0)
    ? { id: p.id_a, title: p.title_a, pv: p.pv_a }
    : { id: p.id_b, title: p.title_b, pv: p.pv_b };
  const merge = keep.id === p.id_a
    ? { id: p.id_b, title: p.title_b, pv: p.pv_b }
    : { id: p.id_a, title: p.title_a, pv: p.pv_a };
  md.push(`| ${i+1} | ID:${keep.id} (PV${keep.pv}) | ID:${merge.id} (PV${merge.pv}) | ${p.pv_total} | ${keep.title.slice(0, 50)}... |`);
});
md.push('');

// === 3. 金額違い ===
md.push(`## 2. 金額違い派生 TOP 20 (要レビュー)`);
md.push('');
md.push(`同制度の第N回・コース違い・年度違いが多いため、1記事に統合または別記事として明確化が必要。`);
md.push('');
md.push(`| # | ID-A | PV-A | 金額-A | ID-B | PV-B | 金額-B | 制度名 |`);
md.push(`|---|---|---:|---:|---|---:|---:|---|`);
amountVariants.slice(0, 20).forEach((p, i) => {
  md.push(`| ${i+1} | ${p.id_a} | ${p.pv_a} | ${p.amount_a}万 | ${p.id_b} | ${p.pv_b} | ${p.amount_b}万 | ${p.title_a.slice(0, 40)}... |`);
});
md.push('');

// === 4. 年度違い ===
md.push(`## 3. 年度違い派生 (旧年度の処遇)`);
md.push('');
md.push(`旧年度記事は、新年度記事への canonical 設定または noindex 化を推奨。`);
md.push('');
md.push(`| # | 旧年度 | 新年度 | PV合計 | 制度 |`);
md.push(`|---|---|---|---:|---|`);
yearVariants.slice(0, 20).forEach((p, i) => {
  const oldOne = parseInt(p.year_a) <= parseInt(p.year_b)
    ? { id: p.id_a, year: p.year_a, pv: p.pv_a, title: p.title_a }
    : { id: p.id_b, year: p.year_b, pv: p.pv_b, title: p.title_b };
  const newOne = oldOne.id === p.id_a
    ? { id: p.id_b, year: p.year_b, pv: p.pv_b, title: p.title_b }
    : { id: p.id_a, year: p.year_a, pv: p.pv_a, title: p.title_a };
  md.push(`| ${i+1} | ID:${oldOne.id} (${oldOne.year}, PV${oldOne.pv}) | ID:${newOne.id} (${newOne.year}, PV${newOne.pv}) | ${p.pv_total} | ${newOne.title.slice(0, 40)}... |`);
});
md.push('');
md.push(`---`);
md.push('');

// === 5. 新規候補・公募中 ===
md.push(`## 4. 新規記事候補・公募中 TOP 30 (締切早い順)`);
md.push('');
md.push(`現在 jGrants で公募中にもかかわらず、自社サイトに未掲載の制度。締切が近いものから順次記事化。`);
md.push('');
md.push(`| # | 締切 | 地域 | 最大金額 | 制度名 |`);
md.push(`|---|---|---|---:|---|`);
newOpen.slice(0, 30).forEach((r, i) => {
  const end = (r.end || '').slice(0, 10);
  const amount = r.max_amount ? `${(parseInt(r.max_amount) / 10000).toLocaleString()}万円` : '-';
  md.push(`| ${i+1} | ${end} | ${r.region} | ${amount} | ${r.title.slice(0, 50)} |`);
});
md.push('');

// === 6. 高額新規候補 ===
md.push(`## 5. 新規候補・高額補助金 TOP 20 (1000万円以上)`);
md.push('');
md.push(`PV見込みが高い高額補助金。優先記事化候補。`);
md.push('');
md.push(`| # | 最大金額 | 地域 | 締切 | 制度名 |`);
md.push(`|---|---:|---|---|---|`);
highAmount.slice(0, 20).forEach((r, i) => {
  const end = (r.end || '').slice(0, 10);
  const amount = `${(parseInt(r.max_amount) / 10000).toLocaleString()}万円`;
  md.push(`| ${i+1} | ${amount} | ${r.region} | ${end} | ${r.title.slice(0, 50)} |`);
});
md.push('');

// === 7. 地域別新規候補数 ===
md.push(`## 6. 新規候補・地域別件数 TOP 20`);
md.push('');
md.push(`| # | 地域 | 公募中 | 終了済み | 合計 |`);
md.push(`|---|---|---:|---:|---:|`);
const regionEntries = Object.entries(newSum.by_region)
  .filter(([reg]) => !reg.includes('/')) // 複合地域を除く
  .sort((a, b) => b[1] - a[1])
  .slice(0, 20);
regionEntries.forEach(([reg, total], i) => {
  const open = newOpen.filter(r => r.region === reg).length;
  md.push(`| ${i+1} | ${reg} | ${open} | ${total - open} | ${total} |`);
});
md.push('');
md.push(`---`);
md.push('');

// === 8. 次のアクション ===
md.push(`## 7. 次のアクション（具体的手順）`);
md.push('');
md.push(`### A. 重複統合（高優先176ペア）`);
md.push('');
md.push(`\`\`\`bash`);
md.push(`# Step 1: 統合対象IDのリストアップ`);
md.push(`grep "^exact" ~/analytics-tools/dedup-report-v2.csv | head -176 > /tmp/merge-targets.csv`);
md.push(``);
md.push(`# Step 2: 各ペアで PV低い側を「PV高い側」へ301リダイレクト`);
md.push(`# Yoast Premium のリダイレクト機能 or .htaccess に追加`);
md.push(``);
md.push(`# Step 3: 統合先の本文に「過去回情報」セクションを追加`);
md.push(`# 統合元のメタデータ・公式リンクは保持`);
md.push(``);
md.push(`# Step 4: 統合元を draft → 1か月後にゴミ箱`);
md.push(`ssh xserver 'wp post update <ID> --post_status=draft --skip-revisions'`);
md.push(`\`\`\``);
md.push('');
md.push(`### B. 新規記事化 (公募中221件)`);
md.push('');
md.push(`\`\`\`bash`);
md.push(`# Step 1: 高優先の新規候補を抽出（高額・全国・東京）`);
md.push(`grep "^1," ~/analytics-tools/new-grant-candidates.csv | head -50 > /tmp/new-priority.csv`);
md.push(``);
md.push(`# Step 2: 各制度の公式詳細をjGrants APIから取得`);
md.push(`# 詳細API: https://api.jgrants-portal.go.jp/exp/v1/public/subsidies/{subsidy_id}`);
md.push(``);
md.push(`# Step 3: 既存テンプレートで記事生成（grant-rewrite Phase 4 参照）`);
md.push(`# - V5版装飾クラス (.gi-callout / .gi-stat / .gi-cta-btn) 使用`);
md.push(`# - ACFメタフィールド埋め込み`);
md.push(`# - 出典: jGrants 公式リンク`);
md.push(``);
md.push(`# Step 4: 一括投稿（保存はサーバー負荷を考慮し0.25秒間隔）`);
md.push(`\`\`\``);
md.push('');
md.push(`### C. 検証`);
md.push('');
md.push(`- [ ] 統合後、Search Console で旧URLの404 / リダイレクト状況を確認（1週間後）`);
md.push(`- [ ] 新規記事の Schema 検証（Rich Results Test）`);
md.push(`- [ ] PageSpeed Insights スコア（Performance 90+, SEO 95+）`);
md.push(`- [ ] サイトマップの再送信（Search Console / Bing）`);
md.push('');
md.push(`---`);
md.push('');

md.push(`## 関連ファイル`);
md.push('');
md.push(`- 重複ペア詳細: \`~/analytics-tools/dedup-report-v2.csv\` (${dedupRows.length}行)`);
md.push(`- 新規候補詳細: \`~/analytics-tools/new-grant-candidates.csv\` (${newRows.length}行)`);
md.push(`- jGrants公式生データ: \`~/analytics-tools/jgrants-all.json\` (${newSum.jgrants_total}件)`);
md.push(`- 重複サマリJSON: \`~/analytics-tools/dedup-summary-v2.json\``);
md.push(`- 新規候補サマリJSON: \`~/analytics-tools/new-grant-summary.json\``);
md.push('');

const out = path.join(__dirname, 'GRANT-REWRITE-REPORT.md');
fs.writeFileSync(out, md.join('\n'), 'utf-8');
console.log(`✓ レポート生成: ${out}`);
console.log(`  行数: ${md.length}行`);
console.log(`  サイズ: ${Math.round(md.join('\n').length / 1024)}KB`);
