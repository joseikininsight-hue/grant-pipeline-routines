// キュー管理 (rewrite-queue.json / new-queue.json)
const fs = require('fs');
const path = require('path');
const config = require('./config');

const QUEUE_DIR = config.paths.queue;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
ensureDir(QUEUE_DIR);
ensureDir(path.join(QUEUE_DIR, 'archive'));
ensureDir(path.join(QUEUE_DIR, 'inbox'));

function load(name) {
  const p = path.join(QUEUE_DIR, `${name}.json`);
  if (!fs.existsSync(p)) return { date: config.todayJST, items: [], processedToday: 0 };
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function save(name, data) {
  const p = path.join(QUEUE_DIR, `${name}.json`);
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

function archive(name, item) {
  const date = item.processedAt ? item.processedAt.slice(0, 10) : config.todayJST;
  const archDir = path.join(QUEUE_DIR, 'archive', date);
  ensureDir(archDir);
  const p = path.join(archDir, `${name}-${item.id || item.postId || Date.now()}.json`);
  fs.writeFileSync(p, JSON.stringify(item, null, 2));
}

function pop(name) {
  const data = load(name);
  if (!data.items.length) return { item: null, data };
  const item = data.items.shift();
  return { item, data };
}

function commit(name, data) {
  save(name, data);
}

function dailyLimitReached(name) {
  const limit = name === 'rewrite-queue' ? config.limits.rewritePerDay : config.limits.newArticlesPerDay;
  const data = load(name);
  return (data.processedToday || 0) >= limit;
}

function incrementProcessed(name) {
  const data = load(name);
  data.processedToday = (data.processedToday || 0) + 1;
  data.lastProcessedAt = new Date().toISOString();
  save(name, data);
}

// 個別 item の status を done に更新する
// rewrite-queue: postId で照合 / new-queue: postId か順序ベース (FIFO で先頭の pending)
function markItemDone(name, opts) {
  const { postId, query, fallbackFifo } = opts || {};
  const data = load(name);
  let target = null;

  if (postId != null) {
    target = data.items.find((i) => i.id === postId && i.status !== 'done');
  }
  if (!target && query) {
    target = data.items.find((i) => i.query === query && i.status !== 'done');
  }
  if (!target && fallbackFifo) {
    target = data.items.find((i) => i.status === 'pending');
  }

  if (target) {
    target.status = 'done';
    target.publishedAt = new Date().toISOString();
    save(name, data);
    return { ok: true, item: target };
  }
  return { ok: false, reason: 'no-matching-pending-item' };
}

function resetDaily(name) {
  const data = load(name);
  if (data.date !== config.todayJST) {
    data.date = config.todayJST;
    data.processedToday = 0;
    save(name, data);
  }
}

module.exports = { load, save, archive, pop, commit, dailyLimitReached, incrementProcessed, markItemDone, resetDaily };
