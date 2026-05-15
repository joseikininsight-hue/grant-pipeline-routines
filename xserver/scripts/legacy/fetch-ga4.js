// GA4 全期間データ取得 (pagePath × 主要指標)
const { BetaAnalyticsDataClient } = require('@google-analytics/data');
const path = require('path');
const fs = require('fs');
const { stringify } = require('csv-stringify/sync');

const PROPERTY_ID = '506915967';
const KEY_PATH = path.join(
  process.env.USERPROFILE || process.env.HOME,
  '.secrets',
  'grants-sa.json'
);
const OUT_PATH = path.join(__dirname, 'ga4-pages.csv');

const START_DATE = '2025-09-30';
const END_DATE = 'today';

process.env.GOOGLE_APPLICATION_CREDENTIALS = KEY_PATH;

(async () => {
  console.log('=== GA4 Fetch ===');
  console.log(`Property: ${PROPERTY_ID}`);
  console.log(`Period: ${START_DATE} to ${END_DATE}`);

  const client = new BetaAnalyticsDataClient();
  const allRows = [];
  let offset = 0;
  const limit = 100000;

  while (true) {
    const [response] = await client.runReport({
      property: `properties/${PROPERTY_ID}`,
      dateRanges: [{ startDate: START_DATE, endDate: END_DATE }],
      dimensions: [{ name: 'pagePath' }],
      metrics: [
        { name: 'screenPageViews' },
        { name: 'totalUsers' },
        { name: 'sessions' },
        { name: 'userEngagementDuration' },
        { name: 'engagementRate' },
        { name: 'bounceRate' },
        { name: 'eventCount' },
      ],
      limit,
      offset,
      orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
    });

    if (!response.rows || response.rows.length === 0) break;
    allRows.push(...response.rows);
    console.log(`  fetched: ${allRows.length} rows`);
    if (response.rows.length < limit) break;
    offset += limit;
  }

  const header = [
    'pagePath',
    'screenPageViews',
    'totalUsers',
    'sessions',
    'userEngagementDuration',
    'engagementRate',
    'bounceRate',
    'eventCount',
  ];
  const data = [header];
  allRows.forEach((row) => {
    const p = row.dimensionValues[0].value;
    const m = row.metricValues.map((v) => v.value);
    data.push([p, ...m]);
  });

  fs.writeFileSync(OUT_PATH, stringify(data));
  console.log(`✅ Saved ${allRows.length} rows -> ${OUT_PATH}`);
})();
