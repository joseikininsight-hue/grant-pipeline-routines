// GA4 時間帯×曜日×デバイス分析
// 目的: 補助金記事の読まれる時間帯を特定し、リライト/新規記事公開の最適時刻を決める
// 出力: time-analysis.json (生データ) + time-analysis-report.md (要約)

const { BetaAnalyticsDataClient } = require('@google-analytics/data');
const path = require('path');
const fs = require('fs');

const PROPERTY_ID = '506915967';
const KEY_PATH = path.join(
  process.env.USERPROFILE || process.env.HOME,
  '.secrets',
  'grants-sa.json'
);
const OUT_JSON = path.join(__dirname, 'time-analysis.json');
const OUT_MD = path.join(__dirname, 'time-analysis-report.md');

const START_DATE = '90daysAgo';
const END_DATE = 'today';

process.env.GOOGLE_APPLICATION_CREDENTIALS = KEY_PATH;

const DOW = ['日', '月', '火', '水', '木', '金', '土']; // GA4 dayOfWeek: 0=Sun

async function fetchTimeData(client, dimensions, label, extraFilter = null) {
  console.log(`Fetching: ${label}`);
  const reportConfig = {
    property: `properties/${PROPERTY_ID}`,
    dateRanges: [{ startDate: START_DATE, endDate: END_DATE }],
    dimensions: dimensions.map((name) => ({ name })),
    metrics: [
      { name: 'screenPageViews' },
      { name: 'totalUsers' },
      { name: 'userEngagementDuration' },
    ],
    limit: 100000,
  };
  if (extraFilter) reportConfig.dimensionFilter = extraFilter;

  const [response] = await client.runReport(reportConfig);
  return (response.rows || []).map((row) => {
    const dims = {};
    dimensions.forEach((d, i) => (dims[d] = row.dimensionValues[i].value));
    return {
      ...dims,
      pv: Number(row.metricValues[0].value),
      users: Number(row.metricValues[1].value),
      engagementSec: Number(row.metricValues[2].value),
    };
  });
}

const grantPathFilter = {
  filter: {
    fieldName: 'pagePath',
    stringFilter: { matchType: 'BEGINS_WITH', value: '/grants/' },
  },
};

(async () => {
  console.log('=== GA4 Time Analysis ===');
  console.log(`Property: ${PROPERTY_ID} / Period: ${START_DATE} -> ${END_DATE}\n`);

  const client = new BetaAnalyticsDataClient();

  // 1. 全grant記事の時間帯別 PV
  const hourly = await fetchTimeData(client, ['hour'], 'hourly /grants/', grantPathFilter);

  // 2. 曜日別 PV
  const daily = await fetchTimeData(client, ['dayOfWeek'], 'dayOfWeek /grants/', grantPathFilter);

  // 3. 時間帯×曜日 (ヒートマップ用)
  const heatmap = await fetchTimeData(
    client,
    ['dayOfWeek', 'hour'],
    'dayOfWeek x hour /grants/',
    grantPathFilter
  );

  // 4. デバイス別×時間帯
  const byDevice = await fetchTimeData(
    client,
    ['deviceCategory', 'hour'],
    'device x hour /grants/',
    grantPathFilter
  );

  // 5. 全体 (grant 以外も含む) との比較用
  const hourlyAll = await fetchTimeData(client, ['hour'], 'hourly all pages');

  // 集計
  const sortByPv = (a, b) => b.pv - a.pv;
  const totalPV = hourly.reduce((s, r) => s + r.pv, 0);

  const hourlyRanked = [...hourly].sort(sortByPv);
  const dailyRanked = [...daily].sort(sortByPv);

  // ピーク時間帯 TOP3
  const top3Hours = hourlyRanked.slice(0, 3).map((r) => Number(r.hour));
  const top3Days = dailyRanked.slice(0, 3).map((r) => Number(r.dayOfWeek));

  // 「公開最適時刻」= ピーク時間の 1〜2時間前 (キャッシュ温め時間)
  const publishOptimalHours = top3Hours.map((h) => (h - 1 + 24) % 24).sort((a, b) => a - b);

  // ヒートマップ整形 (7行×24列)
  const heatmapMatrix = Array.from({ length: 7 }, () => Array(24).fill(0));
  heatmap.forEach((r) => {
    heatmapMatrix[Number(r.dayOfWeek)][Number(r.hour)] = r.pv;
  });

  // デバイス比率 (ピーク時間帯)
  const deviceShare = {};
  byDevice.forEach((r) => {
    if (!deviceShare[r.deviceCategory]) deviceShare[r.deviceCategory] = 0;
    deviceShare[r.deviceCategory] += r.pv;
  });
  const deviceTotal = Object.values(deviceShare).reduce((s, v) => s + v, 0);
  const devicePct = {};
  Object.keys(deviceShare).forEach((k) => {
    devicePct[k] = ((deviceShare[k] / deviceTotal) * 100).toFixed(1);
  });

  // 出力
  const result = {
    period: { startDate: START_DATE, endDate: END_DATE, generatedAt: new Date().toISOString() },
    totalPV,
    hourly: hourly.sort((a, b) => Number(a.hour) - Number(b.hour)),
    daily: daily.sort((a, b) => Number(a.dayOfWeek) - Number(b.dayOfWeek)),
    heatmap: heatmapMatrix,
    deviceShare: devicePct,
    insights: {
      top3Hours,
      top3DaysOfWeek: top3Days.map((d) => DOW[d]),
      publishOptimalHours,
      grantPVRatio: ((totalPV / hourlyAll.reduce((s, r) => s + r.pv, 0)) * 100).toFixed(1) + '%',
    },
  };

  fs.writeFileSync(OUT_JSON, JSON.stringify(result, null, 2));
  console.log(`\n✅ JSON saved -> ${OUT_JSON}`);

  // Markdown レポート
  let md = `# GA4 時間帯分析レポート\n\n`;
  md += `- 期間: ${START_DATE} 〜 ${END_DATE}\n`;
  md += `- 生成日時: ${new Date().toLocaleString('ja-JP')}\n`;
  md += `- 対象: \`/grants/*\` 全PV: ${totalPV.toLocaleString()}\n`;
  md += `- 全サイトPVに占める /grants/ 比率: ${result.insights.grantPVRatio}\n\n`;

  md += `## ピーク時間帯 TOP3\n\n`;
  hourlyRanked.slice(0, 5).forEach((r, i) => {
    const pct = ((r.pv / totalPV) * 100).toFixed(1);
    md += `${i + 1}. **${r.hour}時**: ${r.pv.toLocaleString()} PV (${pct}%)\n`;
  });

  md += `\n## 曜日別 PV\n\n`;
  md += `| 曜日 | PV | 比率 |\n|---|---|---|\n`;
  result.daily.forEach((r) => {
    const pct = ((r.pv / totalPV) * 100).toFixed(1);
    md += `| ${DOW[Number(r.dayOfWeek)]} | ${r.pv.toLocaleString()} | ${pct}% |\n`;
  });

  md += `\n## デバイス比率\n\n`;
  Object.keys(devicePct).forEach((k) => {
    md += `- ${k}: ${devicePct[k]}%\n`;
  });

  md += `\n## 時間帯×曜日 ヒートマップ (PV)\n\n`;
  md += `| 曜日＼時 |`;
  for (let h = 0; h < 24; h++) md += ` ${h} |`;
  md += `\n|---|`;
  for (let h = 0; h < 24; h++) md += `---|`;
  md += `\n`;
  for (let d = 0; d < 7; d++) {
    md += `| ${DOW[d]} |`;
    for (let h = 0; h < 24; h++) {
      md += ` ${heatmapMatrix[d][h]} |`;
    }
    md += `\n`;
  }

  md += `\n## マーケティング推奨\n\n`;
  md += `### 公開最適時刻 (ピーク${top3Hours.map((h) => h + '時').join(', ')}の1〜2時間前)\n\n`;
  md += `推奨: **${publishOptimalHours.map((h) => `${h}:00`).join(' / ')}**\n\n`;
  md += `理由: GoogleがクロールしてSearch Consoleにインデックスされるまで30〜60分。\n`;
  md += `読者ピーク到達時に検索結果に並んでいる状態を作る。\n\n`;

  md += `### Routines スケジュール案\n\n`;
  md += `\`\`\`\n`;
  md += `06:00  日次データ取得・キュー生成 (朝バッチ)\n`;
  md += publishOptimalHours
    .slice(0, 5)
    .map((h) => `${String(h).padStart(2, '0')}:00  ワーカー起動 (1回2記事処理)`)
    .join('\n');
  md += `\n23:00  RSS監視・翌日候補仮生成\n`;
  md += `\`\`\`\n\n`;

  md += `### 曜日戦略\n\n`;
  md += `- 高PV曜日 (${result.insights.top3DaysOfWeek.join(', ')}) に新規記事の集中投下\n`;
  md += `- 低PV曜日はリライト中心 (検索上位回復狙い)\n\n`;

  fs.writeFileSync(OUT_MD, md);
  console.log(`✅ MD saved -> ${OUT_MD}`);
  console.log(`\n=== Top 3 publish hours: ${publishOptimalHours.join(', ')} ===`);
})();
