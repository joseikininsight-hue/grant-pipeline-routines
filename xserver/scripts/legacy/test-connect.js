// GA4 Data API 疎通テスト
const { BetaAnalyticsDataClient } = require('@google-analytics/data');
const path = require('path');

const PROPERTY_ID = '506915967';
const KEY_PATH = path.join(
  process.env.USERPROFILE || process.env.HOME,
  '.secrets',
  'grants-sa.json'
);

process.env.GOOGLE_APPLICATION_CREDENTIALS = KEY_PATH;

(async () => {
  console.log('=== GA4 Data API 疎通テスト ===');
  console.log('Property:', PROPERTY_ID);
  console.log('Key:', KEY_PATH);
  console.log('');

  const client = new BetaAnalyticsDataClient();

  try {
    const [response] = await client.runReport({
      property: `properties/${PROPERTY_ID}`,
      dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
      metrics: [
        { name: 'activeUsers' },
        { name: 'screenPageViews' },
        { name: 'sessions' },
      ],
    });

    console.log('✅ SUCCESS: API connected');
    console.log('rowCount:', response.rowCount);
    if (response.rows && response.rows.length > 0) {
      const m = response.rows[0].metricValues.map((v) => v.value);
      console.log('Past 7 days totals:');
      console.log('  activeUsers:    ', m[0]);
      console.log('  screenPageViews:', m[1]);
      console.log('  sessions:       ', m[2]);
    }
    console.log('');
    console.log('=== Done ===');
  } catch (err) {
    console.error('❌ ERROR:');
    console.error('  code:   ', err.code || 'unknown');
    console.error('  message:', err.message);
    if (
      err.message &&
      (err.message.includes('does not have sufficient permissions') ||
        err.message.includes('User does not have'))
    ) {
      console.error('');
      console.error('--> サービスアカウントにGA4プロパティへのアクセス権が無い');
      console.error('    対処: GA4管理画面 > プロパティのアクセス管理で以下を追加');
      console.error('    Email: spreadsheet-updater@grants-473813.iam.gserviceaccount.com');
      console.error('    Role:  閲覧者 (Viewer)');
    }
    process.exit(1);
  }
})();
