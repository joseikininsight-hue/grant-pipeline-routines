// Search Console API ラッパー
const { google } = require('googleapis');
const config = require('./config');

async function getClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: config.ga4.saPath,
    scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
  });
  return google.searchconsole({ version: 'v1', auth });
}

function daysAgo(n) {
  const d = new Date(Date.now() - n * 86400 * 1000);
  return d.toISOString().slice(0, 10);
}

async function fetchQueries({ startDate, endDate = 'today', dimensions = ['page', 'query'], rowLimit = 25000 } = {}) {
  if (!startDate) startDate = daysAgo(config.searchConsole.lookbackDays);
  if (endDate === 'today') endDate = new Date().toISOString().slice(0, 10);

  const sc = await getClient();
  const all = [];
  let startRow = 0;
  while (true) {
    const res = await sc.searchanalytics.query({
      siteUrl: config.searchConsole.siteUrl,
      requestBody: { startDate, endDate, dimensions, rowLimit, startRow },
    });
    const rows = res.data.rows || [];
    all.push(...rows);
    if (rows.length < rowLimit) break;
    startRow += rowLimit;
    if (startRow > 200000) break; // 安全弁
  }
  return all;
}

// page-only 集計 (CTR・順位重視)
async function fetchPagePerformance({ startDate, endDate = 'today' } = {}) {
  return fetchQueries({ startDate, endDate, dimensions: ['page'] });
}

// 直近vs過去 比較 (順位下落 + 上昇 同時検知)
async function detectRankingChanges() {
  const recent = await fetchQueries({
    startDate: daysAgo(28),
    dimensions: ['page', 'query'],
  });
  const prior = await fetchQueries({
    startDate: daysAgo(84),
    endDate: daysAgo(28),
    dimensions: ['page', 'query'],
  });

  const priorMap = new Map();
  prior.forEach((r) => {
    const k = r.keys.join('|');
    priorMap.set(k, r);
  });

  const drops = [];
  const rises = [];
  recent.forEach((r) => {
    const k = r.keys.join('|');
    const old = priorMap.get(k);
    if (!old) return;
    const positionDelta = r.position - old.position; // 正=下落、負=上昇
    const clicksDelta = r.clicks - old.clicks;

    // 下落: 5位以上下がってかつ元が30位以内
    if (positionDelta > 5 && old.position < 30) {
      drops.push({
        page: r.keys[0],
        query: r.keys[1],
        oldPosition: old.position,
        newPosition: r.position,
        clicksDelta,
      });
    }
    // 上昇: 5位以上上がってかつ現在30位以内、かつ impression あり
    if (positionDelta < -5 && r.position < 30 && r.impressions >= 50) {
      rises.push({
        page: r.keys[0],
        query: r.keys[1],
        oldPosition: old.position,
        newPosition: r.position,
        clicksDelta,
        impressions: r.impressions,
      });
    }
  });
  return { drops, rises };
}

// 後方互換 (既存呼び出し維持)
async function detectRankingDrops() {
  const { drops } = await detectRankingChanges();
  return drops;
}

module.exports = { fetchQueries, fetchPagePerformance, detectRankingDrops, detectRankingChanges, daysAgo };
