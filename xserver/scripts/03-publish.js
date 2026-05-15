// 公開実行: queue/inbox/{id}.json を読み取って WordPress に反映
// inbox JSON 仕様:
// {
//   "type": "rewrite" | "new",
//   "postId": 12345,                  // rewrite の場合は既存ID
//   "title": "...",
//   "content": "...HTML...",          // post_content
//   "metaDescription": "...",         // _yoast_wpseo_metadesc
//   "yoastTitle": "%%title%%",        // _yoast_wpseo_title
//   "ogImage": "...",                 // _yoast_wpseo_opengraph-image (任意)
//   "acfFields": { ... },             // 任意
//   "qualityScore": 92,
//   "qualityReport": "...",
//   "category": "tokyo|chiba|...",    // new の場合
//   "applicationStatus": "open|closed|upcoming"
// }
const fs = require('fs');
const path = require('path');
const config = require('./lib/config');
const wp = require('./lib/wp');
const queue = require('./lib/queue');

const INBOX = path.join(config.paths.queue, 'inbox');
function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }
ensureDir(INBOX);

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(path.join(config.paths.logs, `publish-${config.todayJST}.log`), line + '\n');
}

// 組織名統一フェイルセーフ (Article schema 等の publisher / author を「補助金図鑑」に強制)
function normalizeOrgNames(content) {
  if (!content) return content;
  return content
    // 「joseikin-insight 編集部」(半角/全角スペース) → 「補助金図鑑　編集部」
    .replace(/joseikin-insight[\s　]+編集部/g, '補助金図鑑　編集部')
    // 助成金・補助金インサイト 編集部 → 補助金図鑑　編集部
    .replace(/助成金・補助金インサイト[\s　]*事務局/g, '補助金図鑑　編集部')
    .replace(/助成金・補助金インサイト[\s　]*編集部/g, '補助金図鑑　編集部')
    // JSON-LD 内の "name": "joseikin-insight" → "name": "補助金図鑑"
    .replace(/"name"\s*:\s*"joseikin-insight"/g, '"name": "補助金図鑑"')
    .replace(/"name"\s*:\s*"助成金・補助金インサイト"/g, '"name": "補助金図鑑"')
    // GovernmentService → Service / GovernmentOrganization → Organization (誤用防止)
    .replace(/"@type"\s*:\s*"GovernmentService"/g, '"@type": "Service"')
    .replace(/"@type"\s*:\s*"GovernmentOrganization"/g, '"@type": "Organization"');
}

// 必須 ACF フィールドチェック (足りなければ warning)
const REQUIRED_ACF = [
  'application_status', 'organization', 'official_url',
  'max_amount', 'max_amount_numeric', 'subsidy_rate_detailed',
  'grant_target', 'application_method', 'required_documents_detailed',
  'eligible_expenses_detailed', 'contact_info', 'deadline_date',
];

function checkRequiredAcf(item, file) {
  if (!item.acfFields || typeof item.acfFields !== 'object') {
    return ['acfFields キー全体が欠落'];
  }
  const missing = [];
  for (const key of REQUIRED_ACF) {
    const v = item.acfFields[key];
    if (v === undefined || v === null || v === '') {
      missing.push(key);
    }
  }
  return missing;
}

function processOne(file) {
  const fp = path.join(INBOX, file);
  const item = JSON.parse(fs.readFileSync(fp, 'utf8'));

  // フェイルセーフ1: 組織名統一
  if (item.content) {
    const before = item.content;
    item.content = normalizeOrgNames(item.content);
    if (before !== item.content) {
      log(`normalizeOrgNames: ${file} に組織名置換を適用`);
    }
  }

  // フェイルセーフ2: 必須 ACF チェック
  const missingAcf = checkRequiredAcf(item, file);
  if (missingAcf.length > 0) {
    log(`⚠ ACF 不足: ${file} → 欠落フィールド: ${missingAcf.join(', ')}`);
    // 6項目以上欠落 = 致命的 → manual-review に振り分け
    if (missingAcf.length >= 6) {
      log(`SKIP (acf-incomplete): ${file} (${missingAcf.length}/12 項目欠落)`);
      const reviewDir = require('path').join(config.paths.output, 'manual-review');
      if (!require('fs').existsSync(reviewDir)) require('fs').mkdirSync(reviewDir, { recursive: true });
      require('fs').renameSync(fp, require('path').join(reviewDir, file));
      return { ok: false, reason: 'acf-incomplete', file, missing: missingAcf };
    }
  }

  // フェイルセーフ3: faq_items / supervisor_* 追加 (デフォルト値で補完)
  item.acfFields = item.acfFields || {};
  if (!item.faqItems && !item.acfFields.faq_items) {
    log(`ℹ faq_items 未設定: ${file} (リッチリザルト機会損失)`);
  }
  if (!item.supervisorName) {
    item.supervisorName = '補助金図鑑　編集部';
    item.supervisorTitle = '補助金・助成金専門エディトリアルチーム';
    item.supervisorProfile = '中小企業診断士、行政書士。10年以上にわたり中小企業・個人事業主の補助金・助成金申請を支援。';
  }

  if (item.qualityScore !== undefined && item.qualityScore < config.limits.minQualityScore) {
    log(`SKIP: ${file} score=${item.qualityScore} < ${config.limits.minQualityScore}`);
    // 既存記事の場合は attempted メタを立てて重複処理を防ぐ
    // (公開はしないが、次回 02-build-queue が dedup 対象に含めるようにする)
    if (item.postId && item.type === 'rewrite') {
      try {
        wp.updateMeta(item.postId, '_gi_pipeline_attempted_at', new Date().toISOString());
        wp.updateMeta(item.postId, '_gi_pipeline_last_skip_reason', `low-score-${item.qualityScore}`);
        log(`Marked attempted: postId=${item.postId} (will be excluded from next queue build)`);
      } catch (e) {
        log(`Mark attempted failed: ${e.message}`);
      }
    }
    fs.renameSync(fp, path.join(config.paths.output, 'manual-review', file));
    return { ok: false, reason: 'low-score', file };
  }

  let postId = item.postId;
  const isNew = item.type === 'new' || !postId;

  if (isNew) {
    log(`Creating new post: "${item.title}"`);
    // タイトルとスラッグだけ先に作る → ID取得
    const tmpFile = `/tmp/wp-new-content-${Date.now()}.html`;
    fs.writeFileSync(tmpFile, item.content || '');
    try {
      const tmpSlug = item.slug || `grant-new-${Date.now()}`;
      const cmd = `cd "${config.wordpress.publicHtmlPath}" && wp post create --post_type=grant --post_status=draft --post_title="${item.title.replace(/"/g, '\\"')}" --post_name="${tmpSlug}" --post_content="$(cat ${tmpFile})" --porcelain`;
      const out = require('child_process').execSync(cmd, { encoding: 'utf8', shell: '/bin/bash' });
      postId = Number(out.trim());
      log(`Created postId=${postId}`);
      // ID確定後、slug を grant-<postId> にリネーム (Slack通知URL と一致させる)
      try {
        const finalSlug = `grant-${postId}`;
        wp.wp(`post update ${postId} --post_name=${finalSlug}`);
        log(`Slug renamed: ${tmpSlug} → ${finalSlug}`);
      } catch (e) {
        log(`Slug rename failed: ${e.message}`);
      }
    } finally {
      try { fs.unlinkSync(tmpFile); } catch (e) {}
    }
  } else {
    log(`Updating post: ${postId}`);
    // バックアップ
    wp.backup(postId, `auto-${config.todayJST}`);
    wp.updatePost(postId, { title: item.title, content: item.content });
  }

  // メタ更新
  if (item.metaDescription) wp.updateMeta(postId, '_yoast_wpseo_metadesc', item.metaDescription);
  if (item.yoastTitle) wp.updateMeta(postId, '_yoast_wpseo_title', item.yoastTitle);
  if (item.ogImage) wp.updateMeta(postId, '_yoast_wpseo_opengraph-image', item.ogImage);

  // ACFリピーター系 (簡易: JSON文字列で渡されたら set)
  if (item.acfFields) {
    Object.keys(item.acfFields).forEach((k) => {
      const val = typeof item.acfFields[k] === 'string' ? item.acfFields[k] : JSON.stringify(item.acfFields[k]);
      wp.updateMeta(postId, k, val);
    });
  }

  if (item.applicationStatus) wp.updateMeta(postId, 'application_status', item.applicationStatus);

  // 監修者情報 (E-E-A-T 強化)
  if (item.supervisorName) wp.updateMeta(postId, 'supervisor_name', item.supervisorName);
  if (item.supervisorTitle) wp.updateMeta(postId, 'supervisor_title', item.supervisorTitle);
  if (item.supervisorProfile) wp.updateMeta(postId, 'supervisor_profile', item.supervisorProfile);

  // FAQ items (ACF Repeater) - faqItems が array で渡された場合は ACF 形式に変換
  if (item.faqItems && Array.isArray(item.faqItems) && item.faqItems.length > 0) {
    // PHP one-liner で update_field を呼ぶ (ACF Repeater 専用)
    const phpFaq = JSON.stringify(item.faqItems).replace(/'/g, "'\\''");
    const cmd = `cd "${config.wordpress.publicHtmlPath}" && wp eval 'update_field("faq_items", json_decode(\\\\'${phpFaq}\\\\', true), ${postId});'`;
    try {
      require('child_process').execSync(cmd, { encoding: 'utf8', shell: '/bin/bash' });
      log(`  faq_items: ${item.faqItems.length}問 投入`);
    } catch (e) {
      log(`  faq_items 投入失敗: ${e.message}`);
    }
  }

  // === カテゴリ・タグの自動付与 (#7) ===
  // タイトル・本文・タグ指定から推定
  // WP-CLI の `wp post term set` は slug または term_id を要求するため slug ベース
  try {
    const titleAndContent = `${item.title || ''} ${item.content || ''}`.toLowerCase();
    const titleLower = (item.title || '').toLowerCase();

    // 都道府県判定 (検索キー → slug)
    // キーワード(短縮形・市区町村も対応) → 都道府県slug
    const prefectureBySlug = [
      // [検索key, slug]
      ['北海道',   'hokkaido'],
      ['青森',     'aomori'],   ['岩手',     'iwate'],   ['宮城',   'miyagi'],
      ['秋田',     'akita'],    ['山形',     'yamagata'],['福島',   'fukushima'],
      ['茨城',     'ibaraki'],  ['栃木',     'tochigi'], ['群馬',   'gunma'],
      ['埼玉',     'saitama'],  ['千葉',     'chiba'],   ['東京',   'tokyo'],
      ['神奈川',   'kanagawa'], ['新潟',     'niigata'], ['富山',   'toyama'],
      ['石川',     'ishikawa'], ['福井',     'fukui'],   ['山梨',   'yamanashi'],
      ['長野',     'nagano'],   ['岐阜',     'gifu'],    ['静岡',   'shizuoka'],
      ['愛知',     'aichi'],    ['三重',     'mie'],     ['滋賀',   'shiga'],
      ['京都',     'kyoto'],    ['大阪',     'osaka'],   ['兵庫',   'hyogo'],
      ['奈良',     'nara'],     ['和歌山',   'wakayama'],['鳥取',   'tottori'],
      ['島根',     'shimane'],  ['岡山',     'okayama'], ['広島',   'hiroshima'],
      ['山口',     'yamaguchi'],['徳島',     'tokushima'],['香川',  'kagawa'],
      ['愛媛',     'ehime'],    ['高知',     'kochi'],   ['福岡',   'fukuoka'],
      ['佐賀',     'saga'],     ['長崎',     'nagasaki'],['熊本',   'kumamoto'],
      ['大分',     'oita'],     ['宮崎',     'miyazaki'],['鹿児島', 'kagoshima'],
      ['沖縄',     'okinawa'],
    ];
    // 23特別区 → 東京都 自動マッピング (タイトルが「○○区」を含む場合)
    const tokyo23Wards = ['千代田区','中央区','港区','新宿区','文京区','台東区','墨田区','江東区',
      '品川区','目黒区','大田区','世田谷区','渋谷区','中野区','杉並区','豊島区',
      '北区','荒川区','板橋区','練馬区','足立区','葛飾区','江戸川区'];
    // 政令指定都市 → 都道府県マッピング
    const cityToPrefSlug = {
      '横浜市': 'kanagawa', '川崎市': 'kanagawa', '相模原市': 'kanagawa',
      '大阪市': 'osaka', '堺市': 'osaka',
      '名古屋市': 'aichi',
      '札幌市': 'hokkaido',
      '仙台市': 'miyagi',
      '京都市': 'kyoto',
      '神戸市': 'hyogo',
      '広島市': 'hiroshima',
      '北九州市': 'fukuoka', '福岡市': 'fukuoka',
      'さいたま市': 'saitama',
      '千葉市': 'chiba',
      '新潟市': 'niigata',
      '静岡市': 'shizuoka', '浜松市': 'shizuoka',
      '岡山市': 'okayama',
      '熊本市': 'kumamoto',
    };
    const matchedPrefSlugs = new Set();
    prefectureBySlug.forEach(([key, slug]) => {
      if (titleLower.includes(key.toLowerCase())) matchedPrefSlugs.add(slug);
    });
    if (tokyo23Wards.some((w) => titleLower.includes(w))) matchedPrefSlugs.add('tokyo');
    Object.keys(cityToPrefSlug).forEach((city) => {
      if (titleLower.includes(city)) matchedPrefSlugs.add(cityToPrefSlug[city]);
    });
    matchedPrefSlugs.forEach((slug) => {
      try { wp.wp(`post term add ${postId} grant_prefecture ${slug} 2>/dev/null`); } catch (e) {}
    });

    // カテゴリ判定 (キーワードベース) - 実存する slug にマッピング
    const categoryKeywords = [
      // [slug, キーワード配列]
      ['%e5%ad%90%e8%82%b2%e3%81%a6%e3%83%bb%e6%95%99%e8%82%b2', ['子育て', '保育', '幼児', '学校', '学費', '給食', 'こども', '出産', '育児']], // 子育て・教育
      ['%e4%b8%ad%e5%b0%8f%e4%bc%81%e6%a5%ad%e6%94%af%e6%8f%b4', ['中小企業', '個人事業', '起業', '創業', '法人', '事業者']],                       // 中小企業支援
      ['it%e3%83%bbdx%e5%8c%96', ['it', 'dx', 'デジタル化', 'システム', ' ec ', 'web', ' ai ']],                                                  // IT・DX化
      ['shouene', ['省エネ', 'ev', '電気自動車', 'v2h', 'エコ', '太陽光', '蓄電池', 'カーボン', '断熱']],                                          // 省エネ・脱炭素
      ['%e7%b5%a6%e4%bb%98%e9%87%91', ['物価高騰', '給付金', '商品券', 'ギフトカード', '応援']],                                                   // 給付金
      ['%e4%bd%8f%e5%ae%85%e3%83%aa%e3%83%95%e3%82%a9%e3%83%bc%e3%83%a0', ['住宅', 'リフォーム', '改修', '空き家', '耐震']],                       // 住宅リフォーム
      ['iryou-fukushi', ['医療', '介護', '高齢者', '障害', '福祉']],                                                                              // 医療・福祉
      ['%e8%be%b2%e6%a5%ad%e6%94%af%e6%8f%b4', ['農業', '農家', '畜産']],                                                                          // 農業支援
    ];
    const matchedCatSlugs = [];
    categoryKeywords.forEach(([slug, kws]) => {
      if (kws.some((kw) => titleAndContent.includes(kw))) matchedCatSlugs.push(slug);
    });
    matchedCatSlugs.forEach((slug) => {
      try { wp.wp(`post term add ${postId} grant_category ${slug} 2>/dev/null`); } catch (e) {}
    });

    // 受付状況タグは grant_status taxonomy が存在しないので grant_tag に統合
    if (item.applicationStatus) {
      const statusTag = { open: '受付中', closed: '受付終了', upcoming: '開始予定' }[item.applicationStatus];
      if (statusTag) {
        try { wp.wp(`post term add ${postId} grant_tag "${statusTag}" 2>/dev/null`); } catch (e) {}
      }
    }

    // ユーザー指定追加タグ
    if (Array.isArray(item.tags)) {
      item.tags.forEach((tag) => {
        try { wp.wp(`post term add ${postId} grant_tag "${tag.replace(/"/g, '')}" 2>/dev/null`); } catch (e) {}
      });
    }

    log(`Terms set: prefectures=${[...matchedPrefSlugs].join(',') || 'none'}, categories=${matchedCatSlugs.length || 0} cats`);
  } catch (e) {
    log(`Term set warning: ${e.message}`);
  }

  // 品質メタ
  wp.updateMeta(postId, '_gi_quality_score', String(item.qualityScore || ''));
  wp.updateMeta(postId, '_gi_pipeline_processed_at', new Date().toISOString());

  // 公開
  if (isNew && (item.qualityScore || 0) >= config.limits.minQualityScore) {
    wp.updatePost(postId, { status: 'publish' });
    log(`Published new post ${postId}: ${item.title}`);
  }

  // アーカイブへ
  const archDir = path.join(config.paths.queue, 'archive', config.todayJST);
  ensureDir(archDir);
  const archFile = path.join(archDir, `published-${postId}-${file}`);
  item.processedAt = new Date().toISOString();
  item.publishedPostId = postId;
  fs.writeFileSync(archFile, JSON.stringify(item, null, 2));
  fs.unlinkSync(fp);

  // キューカウンタ更新 + 個別 item を done に
  const qName = item.type === 'new' ? 'new-queue' : 'rewrite-queue';
  queue.incrementProcessed(qName);
  const markRes = queue.markItemDone(qName, {
    postId: postId,
    query: item.query || item.seedQuery,
    fallbackFifo: item.type === 'new', // new は title/id 紐付けが弱いので FIFO fallback
  });
  if (markRes.ok) {
    log(`Queue item marked done: ${qName} → id=${markRes.item.id || 'fifo'} (${markRes.item.title || markRes.item.query || ''}` + ')');
  } else {
    log(`⚠ Queue item not matched (${qName}): ${markRes.reason} — postId=${postId} query=${item.query || ''}`);
  }

  return { ok: true, postId, file };
}

(async () => {
  log('=== 03-publish START ===');
  ensureDir(path.join(config.paths.output, 'manual-review'));

  const files = fs.readdirSync(INBOX).filter((f) => f.endsWith('.json'));
  log(`Inbox: ${files.length} files`);

  const results = [];
  for (const f of files) {
    try {
      const r = processOne(f);
      results.push(r);
      log(`Result: ${JSON.stringify(r)}`);
    } catch (e) {
      log(`ERROR processing ${f}: ${e.message}`);
      results.push({ ok: false, reason: 'exception', file: f, error: e.message });
    }
  }

  log(`=== 03-publish DONE: ${results.filter((r) => r.ok).length}/${results.length} ===`);
  console.log(JSON.stringify(results, null, 2));
})().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
