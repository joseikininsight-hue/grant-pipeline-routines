// 8316の流入チャネル別データ + PV TOP30のエンゲージメント詳細
const { BetaAnalyticsDataClient } = require('@google-analytics/data');
const path = require('path');

const PROPERTY_ID = '506915967';
process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(
  process.env.USERPROFILE || process.env.HOME,
  '.secrets',
  'grants-sa.json'
);

(async () => {
  const client = new BetaAnalyticsDataClient();

  // === 1. ID=8316 の流入チャネル別 ===
  console.log('=== [1] ID=8316 (LPガス第4弾) の流入チャネル別データ ===');
  const [r1] = await client.runReport({
    property: `properties/${PROPERTY_ID}`,
    dateRanges: [{ startDate: '2025-09-30', endDate: 'today' }],
    dimensions: [
      { name: 'pagePath' },
      { name: 'sessionDefaultChannelGroup' },
    ],
    metrics: [
      { name: 'screenPageViews' },
      { name: 'totalUsers' },
      { name: 'sessions' },
      { name: 'engagementRate' },
      { name: 'userEngagementDuration' },
    ],
    dimensionFilter: {
      orGroup: {
        expressions: [
          { filter: { fieldName: 'pagePath', stringFilter: { value: '/grants/grant-8316/', matchType: 'EXACT' }}},
          { filter: { fieldName: 'pagePath', stringFilter: { value: '/grants/【熊本県】lpガス料金高騰対策事業者支援金（第4/', matchType: 'EXACT' }}},
        ]
      }
    },
    orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
  });
  if (r1.rows) {
    r1.rows.forEach(r => {
      const ch = r.dimensionValues[1].value;
      const pv = r.metricValues[0].value;
      const u = r.metricValues[1].value;
      const er = (Number(r.metricValues[3].value) * 100).toFixed(1);
      const dur = Math.round(Number(r.metricValues[4].value) / Number(r.metricValues[1].value || 1));
      console.log(`  ${ch.padEnd(20)} PV=${pv.padStart(4)} U=${u.padStart(4)} Eng=${er}% 平均滞在=${dur}秒`);
    });
  }

  // === 2. PV TOP30 のページ別エンゲージメント ===
  console.log('');
  console.log('=== [2] PV TOP30 のページ別エンゲージメント ===');
  const [r2] = await client.runReport({
    property: `properties/${PROPERTY_ID}`,
    dateRanges: [{ startDate: '2025-09-30', endDate: 'today' }],
    dimensions: [{ name: 'pagePath' }],
    metrics: [
      { name: 'screenPageViews' },
      { name: 'totalUsers' },
      { name: 'engagementRate' },
      { name: 'userEngagementDuration' },
      { name: 'bounceRate' },
    ],
    dimensionFilter: {
      filter: {
        fieldName: 'pagePath',
        stringFilter: { matchType: 'BEGINS_WITH', value: '/grants/grant-' },
      },
    },
    orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
    limit: 30,
  });
  console.log('Path                                              PV    Eng%   滞在  Bounce%');
  if (r2.rows) {
    r2.rows.forEach(r => {
      const p = r.dimensionValues[0].value;
      const pv = Number(r.metricValues[0].value);
      const u = Number(r.metricValues[1].value);
      const er = (Number(r.metricValues[2].value) * 100).toFixed(1);
      const dur = Math.round(Number(r.metricValues[3].value) / (u || 1));
      const br = (Number(r.metricValues[4].value) * 100).toFixed(1);
      console.log(`${p.padEnd(48).substring(0, 48)} ${String(pv).padStart(4)} ${er.padStart(5)}% ${String(dur).padStart(4)}s ${br.padStart(5)}%`);
    });
  }

  // === 3. サイト全体の主要流入チャネル ===
  console.log('');
  console.log('=== [3] サイト全体の流入チャネル分布 ===');
  const [r3] = await client.runReport({
    property: `properties/${PROPERTY_ID}`,
    dateRanges: [{ startDate: '2025-09-30', endDate: 'today' }],
    dimensions: [{ name: 'sessionDefaultChannelGroup' }],
    metrics: [
      { name: 'screenPageViews' },
      { name: 'totalUsers' },
      { name: 'sessions' },
      { name: 'engagementRate' },
    ],
    orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
  });
  if (r3.rows) {
    r3.rows.forEach(r => {
      const ch = r.dimensionValues[0].value;
      const pv = r.metricValues[0].value;
      const u = r.metricValues[1].value;
      const s = r.metricValues[2].value;
      const er = (Number(r.metricValues[3].value) * 100).toFixed(1);
      console.log(`  ${ch.padEnd(20)} PV=${pv.padStart(5)} U=${u.padStart(5)} S=${s.padStart(5)} Eng=${er}%`);
    });
  }

  // === 4. Search Console連携: googleAdsKeyword/manualTermで検索語が取れるか ===
  console.log('');
  console.log('=== [4] サイト全体: 検索語ヒント (利用可能なら) ===');
  try {
    const [r4] = await client.runReport({
      property: `properties/${PROPERTY_ID}`,
      dateRanges: [{ startDate: '2025-09-30', endDate: 'today' }],
      dimensions: [{ name: 'manualTerm' }, { name: 'sessionSource' }],
      metrics: [{ name: 'screenPageViews' }, { name: 'sessions' }],
      orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
      limit: 15,
    });
    if (r4.rows && r4.rows.length > 0) {
      r4.rows.forEach(r => {
        console.log(`  term="${r.dimensionValues[0].value}" src=${r.dimensionValues[1].value} PV=${r.metricValues[0].value}`);
      });
    } else {
      console.log('  (no manualTerm data — Search Console連携が必要)');
    }
  } catch(e) {
    console.log('  ERROR:', e.message);
  }
})();
