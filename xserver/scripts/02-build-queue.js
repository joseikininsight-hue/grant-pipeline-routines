// リライトキュー＋新規記事キュー生成
// 入力: data/*.json
// 出力: queue/rewrite-queue.json (上限5), queue/new-queue.json (上限5)
const fs = require('fs');
const path = require('path');
const QUEUE_DIR = path.join(__dirname, '..', 'queue');
const config = require('./lib/config');
const queue = require('./lib/queue');
const wp = require('./lib/wp');

function load(name) {
  const p = path.join(config.paths.data, `${name}.json`);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// pagePath → 投稿ID解決
function resolvePagePathToId(pagePath, grants, oldSlugMap) {
  const m = pagePath.match(/^\/grants\/([^/]+)\/?$/);
  if (!m) return null;
  const slug = m[1];
  const direct = grants.find((g) => g.post_name === slug || g.ID == slug.replace(/^grant-/, ''));
  if (direct) return direct.ID;
  const old = oldSlugMap.find((o) => o.old_slug === slug);
  return old ? old.post_id : null;
}

// 古さスコア (修正日からの経過年)
function stalenessYears(post_modified) {
  if (!post_modified) return 0;
  const d = new Date(post_modified);
  return (Date.now() - d.getTime()) / (365.25 * 86400 * 1000);
}

// === メイン: リライト候補スコアリング ===
function buildRewriteCandidates({ ga4, scQueries, rankingDrops, rankingRises, anomalies, grants, oldSlugMap }) {
  const deadlineMap = loadDeadlineMap();
  const w = config.scoring.weights;
  const grantMap = new Map(grants.map((g) => [Number(g.ID), g]));

  // pagePath → SC データ集計
  const scByPage = new Map();
  scQueries.forEach((row) => {
    const page = row.keys[0];
    const cur = scByPage.get(page) || { impressions: 0, clicks: 0, position: [] };
    cur.impressions += row.impressions || 0;
    cur.clicks += row.clicks || 0;
    cur.position.push(row.position || 0);
    scByPage.set(page, cur);
  });

  // 順位下落マップ
  const dropsByPage = new Map();
  rankingDrops.forEach((d) => {
    const cur = dropsByPage.get(d.page) || 0;
    dropsByPage.set(d.page, cur + Math.max(d.newPosition - d.oldPosition, 0));
  });

  // 順位上昇マップ (上昇幅 + impression を集計 = 投資ROI高い記事の指標)
  const risesByPage = new Map();
  (rankingRises || []).forEach((r) => {
    const cur = risesByPage.get(r.page) || { totalRise: 0, totalImpressions: 0 };
    cur.totalRise += Math.max(r.oldPosition - r.newPosition, 0);
    cur.totalImpressions += r.impressions || 0;
    risesByPage.set(r.page, cur);
  });

  const dropPaths = new Set(anomalies.drops.map((a) => a.path));

  const candidates = [];
  ga4.forEach((row) => {
    const id = resolvePagePathToId(row.pagePath, grants, oldSlugMap);
    if (!id) return;
    const post = grantMap.get(Number(id));
    if (!post) return;

    const sc = scByPage.get(`https://joseikin-insight.com${row.pagePath}`) ||
               scByPage.get(row.pagePath) || { impressions: 0, clicks: 0 };
    const positionDrop = dropsByPage.get(row.pagePath) || 0;
    const riseInfo = risesByPage.get(row.pagePath) || risesByPage.get(`https://joseikin-insight.com${row.pagePath}`) || { totalRise: 0, totalImpressions: 0 };
    const isDrop = dropPaths.has(row.pagePath);
    const stale = stalenessYears(post.post_modified);

    // スコア計算
    // 上昇加点: 上昇幅×log(impression) で「伸び中の記事を強化」を評価
    const riseBonus = riseInfo.totalRise > 0
      ? (riseInfo.totalRise / 10) * Math.log10(riseInfo.totalImpressions + 1) * 1.5
      : 0;

    // 締切ボーナス: deadline_date が 14 日以内なら +10 (駆け込み流入)
    const deadlineDate = deadlineMap.get(Number(post.ID));
    const daysLeft = daysUntilDeadline(deadlineDate);
    const deadlineBoost = (daysLeft !== null && daysLeft >= 0 && daysLeft <= 14) ? 10 : 0;


    // CTR ギャップ加点: Google が見せているのにクリックされていない記事を最優先化
    // 期待 CTR は位置別: 1位=28%, 3位=11%, 5位=5%, 7位=3%, 10位=1.5%, 15位=0.7%
    const avgPosition = (sc.position && sc.position.length > 0)
      ? sc.position.reduce((acc, q) => acc + q, 0) / sc.position.length
      : 999;
    let ctrGapBonus = 0;
    if (sc.impressions >= 200 && avgPosition >= 4 && avgPosition <= 16) {
      const expectedCtr = avgPosition <= 5 ? 0.08
                        : avgPosition <= 8 ? 0.04
                        : avgPosition <= 11 ? 0.02
                        : 0.01;
      const actualCtr = sc.clicks / sc.impressions;
      const ctrGap = Math.max(0, expectedCtr - actualCtr);
      const missedClicks = ctrGap * sc.impressions;
      ctrGapBonus = Math.min(15, missedClicks * 0.3);
    }

    const score =
      (Math.log10(row.pv + 1) * w.pv30day) +
      (Math.log10(sc.impressions + 1) * w.scImpressions) +
      (stale * w.stalenessYears) +
      (positionDrop * w.rankingDrop / 10) +
      ((row.engagementRate < 0.5 ? 1 : 0) * w.lowEngagement) +
      (isDrop ? 5 : 0) + // PV急落は最優先
      deadlineBoost + // 締切 14d 以内は強制 top
      riseBonus + // 上昇中の記事を増やす投資価値
      ctrGapBonus; // CTR ギャップで損失している記事を強く優先

    candidates.push({
      id: Number(post.ID),
      title: post.post_title,
      pagePath: row.pagePath,
      pv: row.pv,
      scImpressions: sc.impressions,
      scClicks: sc.clicks,
      engagementRate: row.engagementRate,
      stalenessYears: Number(stale.toFixed(2)),
      hasDrop: isDrop,
      positionDrop,
      positionRise: riseInfo.totalRise,
      riseImpressions: riseInfo.totalImpressions,
      score: Number(score.toFixed(2)),
      deadlineDate: deadlineDate || null,
      daysUntilDeadline: daysLeft,
      lastModified: post.post_modified,
    });
  });

  return candidates.sort((a, b) => b.score - a.score);
}

// === 新規記事候補発掘 ===
function buildNewArticleCandidates({ scQueries, grants, oldSlugMap }) {
  const seeds = config.newArticleSeeds;

  // SC: page=自サイトでない、または impression高くCTR低いqueryを抽出
  const queryAgg = new Map();
  scQueries.forEach((row) => {
    const query = row.keys[1];
    if (!query) return;
    const cur = queryAgg.get(query) || { impressions: 0, clicks: 0, pages: new Set() };
    cur.impressions += row.impressions || 0;
    cur.clicks += row.clicks || 0;
    cur.pages.add(row.keys[0]);
    queryAgg.set(query, cur);
  });

  const grantTitles = grants.map((g) => g.post_title.toLowerCase());
  const candidates = [];

  queryAgg.forEach((agg, query) => {
    if (agg.impressions < seeds.scImpressionMin) return;
    const ctr = agg.clicks / agg.impressions;
    if (ctr > seeds.scCtrMax) return; // CTR が高すぎ = 既存記事で足りている

    const q = query.toLowerCase();
    // 既存タイトルとの類似度: 単純な部分一致
    const matched = grantTitles.some((t) => {
      const words = q.split(/\s+/).filter((w) => w.length >= 2);
      return words.length > 0 && words.every((w) => t.includes(w));
    });
    if (matched) return; // 既に近い記事がある = リライト対象

    candidates.push({
      query,
      impressions: agg.impressions,
      clicks: agg.clicks,
      ctr: Number((ctr * 100).toFixed(2)),
      gapScore: Number((agg.impressions * (1 - ctr)).toFixed(0)),
    });
  });

  return candidates.sort((a, b) => b.gapScore - a.gapScore);
}

// === 直近処理済み postId / slug を取得 (重複防止) ===
// _gi_pipeline_processed_at (公開済) または _gi_pipeline_attempted_at (品質未達でSKIP)
// が「直近 N 日以内」の post を返す
// - processed: 公開済みなので再リライト不要
// - attempted: 既に試して失敗したので連続リトライ防止 (短期: 7日)
function getRecentlyProcessedIds(daysWindow = 30, attemptedDaysWindow = 7) {
  try {
    const sql = `SELECT DISTINCT pm.post_id, p.post_name, p.post_title, pm.meta_key
                 FROM wp_postmeta pm
                 INNER JOIN wp_posts p ON pm.post_id = p.ID
                 WHERE (
                   (pm.meta_key = '_gi_pipeline_processed_at' AND pm.meta_value >= DATE_SUB(NOW(), INTERVAL ${Number(daysWindow)} DAY))
                   OR
                   (pm.meta_key = '_gi_pipeline_attempted_at'  AND pm.meta_value >= DATE_SUB(NOW(), INTERVAL ${Number(attemptedDaysWindow)} DAY))
                 )`;
    const tsv = wp.wp(`db query "${sql}" --skip-column-names`);
    const rows = tsv.split('\n').filter(Boolean).map((line) => {
      const [post_id, post_name, post_title, meta_key] = line.split('\t');
      return { post_id: Number(post_id), post_name, post_title, source: meta_key };
    });
    const processedCount = rows.filter((r) => r.source === '_gi_pipeline_processed_at').length;
    const attemptedCount = rows.filter((r) => r.source === '_gi_pipeline_attempted_at').length;
    log(`Recently processed: ${processedCount} (published, ${daysWindow}d) + ${attemptedCount} (attempted-skip, ${attemptedDaysWindow}d) = ${rows.length} excluded`);
    return rows;
  } catch (e) {
    log(`getRecentlyProcessedIds failed: ${e.message}`);
    return [];
  }
}

// === ACF deadline_date 一括取得 (締切優先化用) ===
function loadDeadlineMap() {
  try {
    const sql = `SELECT post_id, meta_value FROM wp_postmeta WHERE meta_key = 'deadline_date' AND meta_value REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`;
    const tsv = wp.wp(`db query "${sql}" --skip-column-names`);
    const map = new Map();
    tsv.split('\n').filter(Boolean).forEach((line) => {
      const [post_id, deadline] = line.split('\t');
      if (post_id && deadline) map.set(Number(post_id), deadline);
    });
    log(`loaded deadline_date for ${map.size} posts`);
    return map;
  } catch (e) {
    log(`loadDeadlineMap failed: ${e.message}`);
    return new Map();
  }
}

function daysUntilDeadline(deadlineStr) {
  if (!deadlineStr) return null;
  const dt = new Date(deadlineStr + 'T23:59:59+09:00');
  if (isNaN(dt.getTime())) return null;
  const diff = dt - new Date();
  return Math.ceil(diff / 86400000);
}

// === Light-patch queue: rankingDrops 上位を軽量パッチ対象に ===
function buildLightPatchQueue({ rankingDrops, grants, oldSlugMap, excludeIds }) {
  const grantMap = new Map(grants.map((g) => [Number(g.ID), g]));
  const exclude = new Set((excludeIds || []).map(Number));
  const seen = new Set();
  const items = [];
  (rankingDrops || [])
    .sort((a, b) => (b.newPosition - b.oldPosition) - (a.newPosition - a.oldPosition))
    .forEach((d) => {
      const id = resolvePagePathToId(d.page, grants, oldSlugMap);
      if (!id || exclude.has(Number(id)) || seen.has(Number(id))) return;
      const post = grantMap.get(Number(id));
      if (!post) return;
      seen.add(Number(id));
      items.push({
        id: Number(id),
        title: post.post_title,
        pagePath: d.page,
        oldPosition: d.oldPosition,
        newPosition: d.newPosition,
        positionDrop: d.newPosition - d.oldPosition,
        impressions: d.impressions || 0,
        status: 'pending',
      });
    });
  return items.slice(0, 15);
}

// === Revival queue: noindex 解除候補 (新規 AI 候補と被るタイトルを持つ noindex post) ===
function loadNoindexPosts() {
  try {
    const sql = `SELECT p.ID, p.post_title, p.post_modified FROM wp_posts p
                 INNER JOIN wp_postmeta pm ON pm.post_id = p.ID
                 WHERE p.post_type = 'grant'
                   AND pm.meta_key = '_yoast_wpseo_meta-robots-noindex'
                   AND pm.meta_value IN ('1', 'noindex')`;
    const tsv = wp.wp(`db query "${sql}" --skip-column-names`);
    return tsv.split('\n').filter(Boolean).map((line) => {
      const [id, title, modified] = line.split('\t');
      return { id: Number(id), title, modified };
    });
  } catch (e) {
    log(`loadNoindexPosts failed: ${e.message}`);
    return [];
  }
}

function buildRevivalQueue({ noindexPosts, newCandidates }) {
  if (!noindexPosts.length || !newCandidates.length) return [];
  const items = [];
  for (const cand of newCandidates) {
    const candWords = (cand.query || '').toLowerCase().match(/[一-龠ぁ-んァ-ヴa-z0-9]+/g) || [];
    if (candWords.length < 2) continue;
    let bestMatch = null;
    let bestScore = 0;
    for (const ni of noindexPosts) {
      const niTitle = (ni.title || '').toLowerCase();
      const hits = candWords.filter((w) => niTitle.includes(w)).length;
      if (hits >= 2 && hits > bestScore) { bestScore = hits; bestMatch = ni; }
    }
    if (bestMatch) {
      items.push({
        id: bestMatch.id,
        oldTitle: bestMatch.title,
        newQuery: cand.query,
        matchScore: bestScore,
        estImpressions: cand.estImpressions || cand.gapScore || 0,
        status: 'pending',
      });
    }
  }
  return items.slice(0, 10);
}

// === メイン実行 ===
(async () => {
  log('=== 02-build-queue START ===');

  const ga4 = load('ga4-pages') || [];
  const scQueries = load('sc-queries') || [];
  const rankingDrops = load('ranking-drops') || [];
  const rankingRises = load('ranking-rises') || [];
  const anomalies = load('anomalies') || { drops: [], surges: [] };
  const grants = load('grants-base') || [];
  const oldSlugMap = load('old-slugs') || [];

  log(`Loaded: GA4=${ga4.length}, SC=${scQueries.length}, drops=${rankingDrops.length}, rises=${rankingRises.length}, grants=${grants.length}`);

  // === 重複防止用: 直近30日に処理済みの postId / 関連クエリ語 を取得 ===
  const recentlyProcessed = getRecentlyProcessedIds(30);
  const recentIdSet = new Set(recentlyProcessed.map((r) => r.post_id));
  const recentTitleWords = new Set();
  recentlyProcessed.forEach((r) => {
    const t = (r.post_title || '').toLowerCase();
    // タイトルから2文字以上の単語を抽出
    t.split(/[\s|｜【】()「」、。 \-]+/).forEach((w) => {
      if (w.length >= 2) recentTitleWords.add(w);
    });
  });

  // === 地域分散用: 直近処理した地域キーワード抽出 ===
  // 同一地域連続 (例: 板橋区を24時間で2回) を防止
  const REGION_KEYWORDS = [
    // 47都道府県
    '北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県',
    '茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県',
    '新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県','静岡県','愛知県','三重県',
    '滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県',
    '鳥取県','島根県','岡山県','広島県','山口県','徳島県','香川県','愛媛県','高知県',
    '福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県',
    // 東京23特別区
    '千代田区','中央区','港区','新宿区','文京区','台東区','墨田区','江東区',
    '品川区','目黒区','大田区','世田谷区','渋谷区','中野区','杉並区','豊島区',
    '北区','荒川区','板橋区','練馬区','足立区','葛飾区','江戸川区',
    // 政令指定都市・主要中核市
    '札幌市','仙台市','さいたま市','千葉市','横浜市','川崎市','相模原市',
    '新潟市','静岡市','浜松市','名古屋市','京都市','大阪市','堺市','神戸市',
    '岡山市','広島市','北九州市','福岡市','熊本市',
    '松山市','金沢市','宇都宮市','那覇市','高松市','つくば市','松戸市','船橋市',
  ];
  const extractRegions = (text) => {
    if (!text) return [];
    return REGION_KEYWORDS.filter((kw) => text.includes(kw));
  };
  const recentRegions = new Set();
  recentlyProcessed.forEach((r) => {
    extractRegions(r.post_title || '').forEach((reg) => recentRegions.add(reg));
  });
  log(`Exclusion sets: postIds=${recentIdSet.size}, titleWords=${recentTitleWords.size}, regions=${recentRegions.size} (${[...recentRegions].slice(0,5).join(',')}${recentRegions.size>5?'...':''})`);

  // 地域分散ソート: 直近地域被りなしを優先、被るものは末尾へ降格
  const partitionByRegion = (items, getText) => {
    const safe = [];
    const overlap = [];
    items.forEach((it) => {
      const text = getText(it);
      const regions = extractRegions(text);
      const hasConflict = regions.some((r) => recentRegions.has(r));
      if (hasConflict) overlap.push(it);
      else safe.push(it);
    });
    return { items: [...safe, ...overlap], safeCount: safe.length, overlapCount: overlap.length };
  };

  // リライト候補 (直近処理除外 + 地域分散)
  const rewriteCandsRaw = buildRewriteCandidates({ ga4, scQueries, rankingDrops, rankingRises, anomalies, grants, oldSlugMap });
  const rewriteCandsAfterId = rewriteCandsRaw.filter((c) => !recentIdSet.has(c.id));
  const rewritePartition = partitionByRegion(rewriteCandsAfterId, (c) => c.title || '');
  const rewriteCands = rewritePartition.items;
  const rewriteFiltered = rewriteCandsRaw.length - rewriteCandsAfterId.length;
  log(`Rewrite candidates: ${rewriteCands.length} (${rewriteFiltered} ID-filtered, region: ${rewritePartition.safeCount} safe + ${rewritePartition.overlapCount} demoted)`);

  // 新規記事候補 (直近処理タイトルとの語彙被り除外 + 地域分散)
  const newCandsRaw = buildNewArticleCandidates({ scQueries, grants, oldSlugMap });
  const newCandsAfterWords = newCandsRaw.filter((c) => {
    const q = (c.query || '').toLowerCase();
    const words = q.split(/\s+/).filter((w) => w.length >= 2);
    if (words.length === 0) return true;
    const overlap = words.filter((w) => recentTitleWords.has(w)).length;
    return overlap / words.length < 0.6; // 60%以上被ったら除外
  });
  const newPartition = partitionByRegion(newCandsAfterWords, (c) => c.query || '');
  const newCands = newPartition.items;
  const newFiltered = newCandsRaw.length - newCandsAfterWords.length;
  log(`New article candidates: ${newCands.length} (${newFiltered} word-filtered, region: ${newPartition.safeCount} safe + ${newPartition.overlapCount} demoted)`);

  // 上位N件を当日キューへ
  const today = config.todayJST;
  const rewriteQueue = {
    date: today,
    items: rewriteCands.slice(0, config.limits.rewritePerDay).map((c) => ({
      ...c,
      type: 'rewrite',
      attempts: 0,
      status: 'pending',
    })),
    processedToday: 0,
    totalCandidates: rewriteCands.length,
    fullList: rewriteCands.slice(0, 50), // 予備
  };
  const newQueue = {
    date: today,
    items: newCands.slice(0, config.limits.newArticlesPerDay).map((c) => ({
      ...c,
      type: 'new',
      attempts: 0,
      status: 'pending',
    })),
    processedToday: 0,
    totalCandidates: newCands.length,
    fullList: newCands.slice(0, 50),
  };

  // === 既存の new-queue 内 AI 追加候補をマージ (重複削除) ===
  // morning-batch の Claude が「ai-discovered」として追加したクエリは保持・優先
  const existingNew = queue.load('new-queue');
  const aiDiscovered = (existingNew?.items || []).filter((it) => it.discoverySource === 'ai-research');
  if (aiDiscovered.length > 0) {
    log(`Merging ${aiDiscovered.length} AI-discovered candidates from previous run`);
    // AI 候補を先頭に、その後 SC Gap 候補を追加 (重複クエリ排除)
    const aiQueries = new Set(aiDiscovered.map((c) => c.query?.toLowerCase()));
    const filteredScCands = newCands.filter((c) => !aiQueries.has(c.query?.toLowerCase()));
    newQueue.items = [
      ...aiDiscovered.slice(0, config.limits.newArticlesPerDay),
      ...filteredScCands.slice(0, Math.max(0, config.limits.newArticlesPerDay - aiDiscovered.length)).map((c) => ({
        ...c,
        type: 'new',
        attempts: 0,
        status: 'pending',
        discoverySource: 'sc-gap',
      })),
    ].slice(0, config.limits.newArticlesPerDay);
  }

  queue.save('rewrite-queue', rewriteQueue);
  queue.save('new-queue', newQueue);

  // === Light-patch queue (rankingDrops top) ===
  const lightPatchItems = buildLightPatchQueue({ rankingDrops, grants, oldSlugMap, excludeIds: Array.from(recentIdSet) });
  const lightPatchPath = path.join(QUEUE_DIR, 'light-patch-queue.json');
  fs.writeFileSync(lightPatchPath, JSON.stringify({ date: config.todayJST, items: lightPatchItems, processedToday: 0 }, null, 2));
  log(`Light-patch queue saved: ${lightPatchItems.length} items`);

  // === Revival queue (noindex × 新規候補マッチ) ===
  const noindexPosts = loadNoindexPosts();
  const revivalItems = buildRevivalQueue({ noindexPosts, newCandidates: newQueue.items || [] });
  const revivalPath = path.join(QUEUE_DIR, 'revival-queue.json');
  fs.writeFileSync(revivalPath, JSON.stringify({ date: config.todayJST, items: revivalItems, processedToday: 0 }, null, 2));
  log(`Revival queue saved: ${revivalItems.length} items (from ${noindexPosts.length} noindex posts)`);

  log(`Queue saved: rewrite=${rewriteQueue.items.length} new=${newQueue.items.length}`);
  log('=== 02-build-queue DONE ===');

  console.log('\n[Rewrite Top 5]');
  rewriteQueue.items.forEach((it, i) => {
    console.log(`  ${i + 1}. [${it.id}] ${it.title} (score=${it.score}, pv=${it.pv})`);
  });
  console.log('\n[New Top 5]');
  newQueue.items.forEach((it, i) => {
    console.log(`  ${i + 1}. "${it.query}" (gapScore=${it.gapScore}, imp=${it.impressions}, ctr=${it.ctr}%)`);
  });
})().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
