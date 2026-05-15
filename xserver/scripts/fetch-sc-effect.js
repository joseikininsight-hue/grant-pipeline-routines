// Search Console から日次の page × clicks/impressions を取得
const fs = require('fs');
const path = require('path');
const os = require('os');

const { google } = require('/home/keishi0804/grant-pipeline/node_modules/googleapis');
const auth = new google.auth.GoogleAuth({
  keyFile: path.join(os.homedir(), '.secrets', 'grants-sa.json'),
  scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
});

const SITE_URL = 'sc-domain:joseikin-insight.com';
const OUT = path.join(__dirname, 'sc-daily.json');

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0,10);
}

(async () => {
  const sc = google.searchconsole({ version: 'v1', auth });
  const startDate = daysAgo(90);
  const endDate = daysAgo(2); // SC のデータ確定遅延
  console.log(`[sc] ${startDate} - ${endDate}`);

  // page × date のみ (query は省略して軽くする)
  const rows = [];
  let startRow = 0;
  const ROW_LIMIT = 25000;
  while (true) {
    const res = await sc.searchanalytics.query({
      siteUrl: SITE_URL,
      requestBody: {
        startDate, endDate,
        dimensions: ['page', 'date'],
        rowLimit: ROW_LIMIT,
        startRow,
      },
    });
    const data = res.data.rows || [];
    rows.push(...data);
    if (data.length < ROW_LIMIT) break;
    startRow += ROW_LIMIT;
    if (startRow > 200000) break; // 安全装置
  }

  const result = rows
    .filter((r) => (r.keys[0] || '').includes('/grants/grant-'))
    .map((r) => ({
      page: r.keys[0],
      date: r.keys[1],
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: r.ctr,
      position: r.position,
    }));

  fs.writeFileSync(OUT, JSON.stringify(result));
  console.log(`[sc] ${result.length} (page × date) rows saved`);
})().catch((e) => { console.error(e); process.exit(1); });
