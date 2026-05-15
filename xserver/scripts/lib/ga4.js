// GA4 ラッパー
const { BetaAnalyticsDataClient } = require('@google-analytics/data');
const config = require('./config');

const PROPERTY = `properties/${config.ga4.propertyId}`;
let _client = null;
function client() {
  if (!_client) _client = new BetaAnalyticsDataClient();
  return _client;
}

async function runReport(opts) {
  const [response] = await client().runReport({ property: PROPERTY, ...opts });
  return response.rows || [];
}

function daysAgoStr(n) { return `${n}daysAgo`; }

// 全 grant ページ × 主要指標
async function fetchGrantPages({ days = 90 } = {}) {
  const rows = [];
  let offset = 0;
  while (true) {
    const r = await client().runReport({
      property: PROPERTY,
      dateRanges: [{ startDate: daysAgoStr(days), endDate: 'today' }],
      dimensions: [{ name: 'pagePath' }],
      metrics: [
        { name: 'screenPageViews' },
        { name: 'totalUsers' },
        { name: 'sessions' },
        { name: 'userEngagementDuration' },
        { name: 'engagementRate' },
        { name: 'bounceRate' },
      ],
      dimensionFilter: {
        filter: { fieldName: 'pagePath', stringFilter: { matchType: 'BEGINS_WITH', value: '/grants/' } },
      },
      limit: 100000,
      offset,
      orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
    });
    const rs = r[0].rows || [];
    rows.push(...rs);
    if (rs.length < 100000) break;
    offset += 100000;
  }
  return rows.map((row) => ({
    pagePath: row.dimensionValues[0].value,
    pv: Number(row.metricValues[0].value),
    users: Number(row.metricValues[1].value),
    sessions: Number(row.metricValues[2].value),
    engagementSec: Number(row.metricValues[3].value),
    engagementRate: Number(row.metricValues[4].value),
    bounceRate: Number(row.metricValues[5].value),
  }));
}

// 直近30日 vs 30〜60日 = 急落/急増検知
async function detectAnomalies() {
  const recent = await runReport({
    dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
    dimensions: [{ name: 'pagePath' }],
    metrics: [{ name: 'screenPageViews' }],
    dimensionFilter: { filter: { fieldName: 'pagePath', stringFilter: { matchType: 'BEGINS_WITH', value: '/grants/' } } },
    limit: 100000,
  });
  const prior = await runReport({
    dateRanges: [{ startDate: '60daysAgo', endDate: '30daysAgo' }],
    dimensions: [{ name: 'pagePath' }],
    metrics: [{ name: 'screenPageViews' }],
    dimensionFilter: { filter: { fieldName: 'pagePath', stringFilter: { matchType: 'BEGINS_WITH', value: '/grants/' } } },
    limit: 100000,
  });

  const priorMap = new Map();
  prior.forEach((r) => priorMap.set(r.dimensionValues[0].value, Number(r.metricValues[0].value)));

  const anomalies = { drops: [], surges: [] };
  recent.forEach((r) => {
    const path = r.dimensionValues[0].value;
    const recentPV = Number(r.metricValues[0].value);
    const priorPV = priorMap.get(path) || 0;
    if (priorPV >= 50 && recentPV < priorPV * 0.5) {
      anomalies.drops.push({ path, priorPV, recentPV });
    }
    if (priorPV >= 10 && recentPV >= priorPV * 2.0 && recentPV >= 20) {
      anomalies.surges.push({ path, priorPV, recentPV });
    }
  });
  return anomalies;
}

module.exports = { fetchGrantPages, detectAnomalies, runReport };
