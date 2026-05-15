#!/usr/bin/env node
// Search Console API でクエリ × ページ × メトリクスを取得
// 事前準備:
//   1. Search Console プロパティに spreadsheet-updater@grants-473813.iam.gserviceaccount.com を「制限付きユーザー」で追加
//   2. Cloud Console で Search Console API を有効化

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const SITE_URL = 'sc-domain:joseikin-insight.com';
const KEY_FILE = path.join(process.env.HOME || process.env.USERPROFILE, '.secrets/grants-sa.json');
const OUT_QUERIES = path.join(__dirname, 'sc-queries.csv');
const OUT_PAGES = path.join(__dirname, 'sc-page-query.csv');

async function main() {
  const auth = new google.auth.GoogleAuth({
    keyFile: KEY_FILE,
    scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
  });
  const sc = google.searchconsole({ version: 'v1', auth });

  // 直近90日
  const today = new Date();
  const start = new Date(today.getTime() - 90 * 24 * 3600 * 1000);
  const fmt = d => d.toISOString().slice(0, 10);

  console.log(`[1/2] クエリ単位データ取得 (${fmt(start)} 〜 ${fmt(today)})`);
  // クエリ単位（ページ無視）
  const allQueries = [];
  let startRow = 0;
  while (true) {
    const res = await sc.searchanalytics.query({
      siteUrl: SITE_URL,
      requestBody: {
        startDate: fmt(start),
        endDate: fmt(today),
        dimensions: ['query'],
        rowLimit: 25000,
        startRow,
      },
    });
    const rows = res.data.rows || [];
    allQueries.push(...rows);
    console.log(`  バッチ${startRow / 25000 + 1}: ${rows.length}件取得 (累計${allQueries.length})`);
    if (rows.length < 25000) break;
    startRow += 25000;
    await new Promise(r => setTimeout(r, 1000));
  }

  // CSV出力
  const queryCsv = ['query,impressions,clicks,ctr,position'];
  allQueries.forEach(r => {
    const q = r.keys[0].replace(/"/g, '""');
    queryCsv.push(`"${q}",${r.impressions},${r.clicks},${r.ctr.toFixed(4)},${r.position.toFixed(2)}`);
  });
  fs.writeFileSync(OUT_QUERIES, queryCsv.join('\n'), 'utf-8');
  console.log(`  → ${OUT_QUERIES} (${allQueries.length}件)`);

  console.log(`[2/2] ページ × クエリ取得`);
  const pageQueries = [];
  startRow = 0;
  while (true) {
    const res = await sc.searchanalytics.query({
      siteUrl: SITE_URL,
      requestBody: {
        startDate: fmt(start),
        endDate: fmt(today),
        dimensions: ['page', 'query'],
        rowLimit: 25000,
        startRow,
      },
    });
    const rows = res.data.rows || [];
    pageQueries.push(...rows);
    console.log(`  バッチ${startRow / 25000 + 1}: ${rows.length}件取得 (累計${pageQueries.length})`);
    if (rows.length < 25000) break;
    startRow += 25000;
    await new Promise(r => setTimeout(r, 1000));
  }

  const pqCsv = ['page,query,impressions,clicks,ctr,position'];
  pageQueries.forEach(r => {
    const page = r.keys[0].replace(/"/g, '""');
    const q = r.keys[1].replace(/"/g, '""');
    pqCsv.push(`"${page}","${q}",${r.impressions},${r.clicks},${r.ctr.toFixed(4)},${r.position.toFixed(2)}`);
  });
  fs.writeFileSync(OUT_PAGES, pqCsv.join('\n'), 'utf-8');
  console.log(`  → ${OUT_PAGES} (${pageQueries.length}件)`);

  console.log('\n=== Summary ===');
  console.log(`クエリ単位: ${allQueries.length}`);
  console.log(`ページ×クエリ: ${pageQueries.length}`);
}

main().catch(e => {
  console.error('\n!!! エラー !!!');
  console.error(e.message);
  if (e.message.includes('does not have permission')) {
    console.error('\n対処:');
    console.error('  Search Console プロパティ管理画面で以下のサービスアカウントを「制限付きユーザー」で追加してください:');
    console.error('  spreadsheet-updater@grants-473813.iam.gserviceaccount.com');
  }
  if (e.message.includes('has not been used') || e.message.includes('disabled')) {
    console.error('\n対処:');
    console.error('  Cloud Console で Search Console API を有効化してください:');
    console.error('  https://console.cloud.google.com/apis/library/searchconsole.googleapis.com?project=grants-473813');
  }
  process.exit(1);
});
