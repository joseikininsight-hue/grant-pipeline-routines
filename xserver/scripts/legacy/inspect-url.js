#!/usr/bin/env node
// URL Inspection API: 公開URLのインデックス状態確認
// + sitemap 一覧確認・再送信

const { google } = require('googleapis');
const path = require('path');

const SITE_URL = 'sc-domain:joseikin-insight.com';
const TARGET_URL = process.env.TARGET_URL || 'https://joseikin-insight.com/grants/grant-128748/';
const KEY_FILE = path.join(process.env.HOME || process.env.USERPROFILE, '.secrets/grants-sa.json');

(async () => {
  const auth = new google.auth.GoogleAuth({
    keyFile: KEY_FILE,
    scopes: ['https://www.googleapis.com/auth/webmasters'],
  });
  const sc = google.searchconsole({ version: 'v1', auth });

  // === 1. URL Inspection ===
  console.log('=== URL Inspection ===');
  console.log('Target: ' + TARGET_URL);
  try {
    const res = await sc.urlInspection.index.inspect({
      requestBody: {
        inspectionUrl: TARGET_URL,
        siteUrl: SITE_URL,
        languageCode: 'ja-JP',
      },
    });
    const r = res.data.inspectionResult;
    console.log('検出状態:', r?.indexStatusResult?.verdict || '(未検出)');
    console.log('カバレッジ:', r?.indexStatusResult?.coverageState || '(なし)');
    console.log('クロール状態:', r?.indexStatusResult?.crawledAs || '(未クロール)');
    console.log('最終クロール:', r?.indexStatusResult?.lastCrawlTime || '(なし)');
    console.log('ロボット許可:', r?.indexStatusResult?.robotsTxtState || '(不明)');
    console.log('インデックス:', r?.indexStatusResult?.indexingState || '(不明)');
    console.log('ページ取得:', r?.indexStatusResult?.pageFetchState || '(不明)');
    if (r?.mobileUsabilityResult) {
      console.log('モバイル対応:', r.mobileUsabilityResult.verdict);
    }
    console.log('検査URL（ブラウザで開いて手動申請）:');
    console.log('  ' + res.data.inspectionResult?.inspectionResultLink);
  } catch (e) {
    console.error('Inspection error:', e.message);
  }

  // === 2. サイトマップ一覧 ===
  console.log('\n=== Sitemap List ===');
  try {
    const res = await sc.sitemaps.list({ siteUrl: SITE_URL });
    if (res.data.sitemap && res.data.sitemap.length > 0) {
      res.data.sitemap.forEach(sm => {
        console.log(`  ${sm.path}`);
        console.log(`    最終送信: ${sm.lastSubmitted}`);
        console.log(`    最終ダウンロード: ${sm.lastDownloaded || '(なし)'}`);
        console.log(`    エラー: ${sm.errors || 0} / 警告: ${sm.warnings || 0}`);
      });
    } else {
      console.log('登録済みサイトマップなし');
    }
  } catch (e) {
    console.error('Sitemaps list error:', e.message);
  }

  // === 3. sitemap.xml 再送信 ===
  console.log('\n=== Sitemap Re-submit ===');
  const sitemapsToSubmit = [
    'https://joseikin-insight.com/sitemap_index.xml',
    'https://joseikin-insight.com/grant-sitemap.xml',
  ];
  for (const sitemapUrl of sitemapsToSubmit) {
    try {
      await sc.sitemaps.submit({ siteUrl: SITE_URL, feedpath: sitemapUrl });
      console.log(`✓ 送信完了: ${sitemapUrl}`);
    } catch (e) {
      console.log(`× 送信失敗: ${sitemapUrl} - ${e.message}`);
    }
  }

  // === 4. 手動インデックス申請用URL ===
  const inspectUrl = `https://search.google.com/search-console/inspect?resource_id=${encodeURIComponent(SITE_URL)}&id=${encodeURIComponent(TARGET_URL)}`;
  console.log('\n=== 手動インデックス申請（ブラウザでクリック）===');
  console.log(inspectUrl);
})();
