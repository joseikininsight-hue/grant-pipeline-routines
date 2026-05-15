// RSS監視: 公式情報源を巡回して新規制度・更新を検知
// 出力: data/rss-new-items.json (前回からの差分)
const fs = require('fs');
const path = require('path');
const https = require('https');
const config = require('./lib/config');

const SEEN_PATH = path.join(config.paths.data, 'rss-seen.json');
const OUT_PATH = path.join(config.paths.data, 'rss-new-items.json');

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 30000, headers: { 'User-Agent': 'grant-pipeline-bot/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve, reject);
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
  });
}

// 簡易RSS/Atomパーサ (依存追加せず正規表現で十分な精度)
function parseRSS(xml) {
  const items = [];
  const itemBlocks = xml.match(/<item[\s\S]*?<\/item>/g) || xml.match(/<entry[\s\S]*?<\/entry>/g) || [];
  itemBlocks.forEach((block) => {
    const get = (tag) => {
      const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
      if (!m) return '';
      return m[1].replace(/<!\[CDATA\[(.*?)\]\]>/s, '$1').trim();
    };
    const link = get('link') || (block.match(/<link[^>]*href="([^"]+)"/) || [])[1] || '';
    items.push({
      title: get('title'),
      link,
      pubDate: get('pubDate') || get('published') || get('updated') || get('dc:date'),
      description: get('description') || get('summary') || get('content'),
    });
  });
  return items;
}

function loadSeen() {
  if (!fs.existsSync(SEEN_PATH)) return {};
  return JSON.parse(fs.readFileSync(SEEN_PATH, 'utf8'));
}

function saveSeen(seen) {
  fs.writeFileSync(SEEN_PATH, JSON.stringify(seen, null, 2));
}

(async () => {
  console.log('=== 04-rss-monitor START ===');
  const seen = loadSeen();
  const newItems = [];
  const now = new Date().toISOString();

  for (const url of config.rss.feeds) {
    try {
      console.log(`Fetching: ${url}`);
      const xml = await fetchUrl(url);
      const items = parseRSS(xml);
      console.log(`  parsed: ${items.length} items`);

      const feedSeen = seen[url] || {};
      items.forEach((it) => {
        const key = it.link || it.title;
        if (!key || feedSeen[key]) return;
        // 補助金/助成金/給付/支援金関連だけフィルタ
        const text = `${it.title} ${it.description}`.toLowerCase();
        const keywords = ['補助金', '助成金', '給付', '支援金', '交付金', '応援金', '奨励金', '報奨金'];
        if (!keywords.some((k) => text.includes(k))) return;

        feedSeen[key] = now;
        newItems.push({ source: url, ...it, detectedAt: now });
      });
      seen[url] = feedSeen;
    } catch (e) {
      console.log(`  ERROR: ${e.message}`);
    }
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify({ generatedAt: now, count: newItems.length, items: newItems }, null, 2));
  saveSeen(seen);
  console.log(`=== 04-rss-monitor DONE: ${newItems.length} new grant items ===`);
  newItems.slice(0, 10).forEach((it) => console.log(`  + ${it.title} (${it.source})`));
})().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
