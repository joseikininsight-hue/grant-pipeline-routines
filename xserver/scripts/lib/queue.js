// キュー管理 (rewrite-queue.json / new-queue.json)
// 2026-05-15: defensive null handling + idempotent markItemDone
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

function defaultState() {
  return { date: config.todayJST, items: [], processedToday: 0 };
}

// Defensive load: file missing or items=null or broken JSON all return safe default.
// This fixes the "new-queue server internal error (items=null)" issue where
// add-new-candidate / cluster expansion crashed when items was null.
function load(name) {
  const p = path.join(QUEUE_DIR, `${name}.json`);
  if (!fs.existsSync(p)) return defaultState();
  let raw;
  try { raw = fs.readFileSync(p, 'utf8'); }
  catch (e) { return defaultState(); }
  let data;
  try { data = JSON.parse(raw); }
  catch (e) { return defaultState(); }
  if (!data || typeof data !== 'object') return defaultState();
  // Normalize fields that downstream code assumes are always present.
  if (!Array.isArray(data.items)) data.items = [];
  if (typeof data.processedToday !== 'number') data.processedToday = 0;
  if (!data.date) data.date = config.todayJST;
  return data;
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

// 個別 item の status を done に更新する。
// 2026-05-15: idempotent. If a matching item is already done, we still return
// { ok: true, alreadyDone: true } so the caller doesn't treat this as an error.
// (Previously returned "no-matching-pending-item" for already-done items,
// causing spurious warnings in Notion logs even though the publish succeeded.)
function markItemDone(name, opts) {
  const { postId, query, fallbackFifo } = opts || {};
  const data = load(name);

  // 1. Try to find a pending item to mark done.
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

  // 2. No pending match. Check if an already-done entry exists for this id/query.
  //    If so, return ok=true (idempotent) instead of misleading "no-matching".
  let alreadyDone = null;
  if (postId != null) {
    alreadyDone = data.items.find((i) => i.id === postId && i.status === 'done');
  }
  if (!alreadyDone && query) {
    alreadyDone = data.items.find((i) => i.query === query && i.status === 'done');
  }
  if (alreadyDone) {
    return { ok: true, item: alreadyDone, alreadyDone: true };
  }

  // 3. Truly not present.
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

// Add a new candidate to a queue. Used by `add-new-candidate` flow.
// Defensive: works even if the file was previously null-corrupted.
// (Previously the webhook handler crashed with "items=null" when the queue
// file was empty or had `items: null` -- load() now coerces to []).
function addCandidate(name, candidate) {
  const data = load(name);
  // Dedup: skip if same query / postId already exists.
  if (candidate.id && data.items.some(i => i.id === candidate.id)) {
    return { ok: true, skipped: 'dup-id' };
  }
  if (candidate.query && data.items.some(i => i.query === candidate.query)) {
    return { ok: true, skipped: 'dup-query' };
  }
  const item = Object.assign({
    status: 'pending',
    addedAt: new Date().toISOString(),
  }, candidate);
  data.items.push(item);
  save(name, data);
  return { ok: true, added: item };
}

module.exports = {
  load, save, archive, pop, commit,
  dailyLimitReached, incrementProcessed,
  markItemDone, resetDaily, addCandidate,
};
