// 公開前 vs 公開後 PV 比較データ取得 (GA4)
// 各対象 postId について、最大90日分の日次PVを取得
const fs = require('fs');
const path = require('path');
const os = require('os');

process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(os.homedir(), '.secrets', 'grants-sa.json');
const { BetaAnalyticsDataClient } = require('/home/keishi0804/grant-pipeline/node_modules/@google-analytics/data');

const PROPERTY_ID = '506915967';
const PROPERTY = `properties/${PROPERTY_ID}`;
const client = new BetaAnalyticsDataClient();

const OUT_DIR = __dirname;

async function fetchDailyPV() {
  // /grants/grant-XXX/ の全 pagePath × date を取得
  const rows = [];
  let offset = 0;
  const LIMIT = 100000;
  while (true) {
    const [r] = await client.runReport({
      property: PROPERTY,
      dateRanges: [{ startDate: '90daysAgo', endDate: 'today' }],
      dimensions: [{ name: 'pagePath' }, { name: 'date' }],
      metrics: [
        { name: 'screenPageViews' },
        { name: 'totalUsers' },
        { name: 'sessions' },
        { name: 'userEngagementDuration' },
      ],
      dimensionFilter: {
        filter: {
          fieldName: 'pagePath',
          stringFilter: { matchType: 'BEGINS_WITH', value: '/grants/grant-' },
        },
      },
      limit: LIMIT,
      offset,
    });
    const rs = r.rows || [];
    rows.push(...rs);
    if (rs.length < LIMIT) break;
    offset += LIMIT;
  }
  return rows.map((row) => ({
    pagePath: row.dimensionValues[0].value,
    date: row.dimensionValues[1].value, // YYYYMMDD
    pv: Number(row.metricValues[0].value),
    users: Number(row.metricValues[1].value),
    sessions: Number(row.metricValues[2].value),
    engagementSec: Number(row.metricValues[3].value),
  }));
}

(async () => {
  console.log('[effect] fetching daily PV (90d)...');
  const daily = await fetchDailyPV();
  console.log(`[effect] ${daily.length} (pagePath × date) rows`);
  fs.writeFileSync(path.join(OUT_DIR, 'ga4-daily.json'), JSON.stringify(daily));
  console.log('[effect] saved -> ga4-daily.json');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
