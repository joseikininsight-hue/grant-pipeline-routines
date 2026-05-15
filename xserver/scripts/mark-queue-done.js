#!/usr/bin/env node
// usage: node mark-queue-done.js <type:rewrite|new> <postId> [query]
// Atomic-publish flow companion: incrementProcessed + markItemDone.
// Skip increment if markItemDone fails to avoid burning daily quota count.
const queue = require('./lib/queue');
const type = process.argv[2] || '';
const postIdRaw = process.argv[3] || '';
const query = process.argv[4] || '';

if (type !== 'rewrite' && type !== 'new') {
  console.error(JSON.stringify({ ok: false, error: 'invalid-type', type }));
  process.exit(2);
}
const qName = type === 'new' ? 'new-queue' : 'rewrite-queue';
const postId = parseInt(postIdRaw, 10);

const result = queue.markItemDone(qName, {
  postId: Number.isFinite(postId) && postId > 0 ? postId : undefined,
  query: query || undefined,
  fallbackFifo: type === 'new'
});

let after = null;
if (result.ok) {
  queue.incrementProcessed(qName);
  after = queue.load(qName);
}

console.log(JSON.stringify({
  ok: true,
  queue: qName,
  postId: postId || null,
  query: query || null,
  marked: result.ok,
  matchedItem: result.item ? { id: result.item.id, title: (result.item.title || '').slice(0, 80), query: (result.item.query || '').slice(0, 80) } : null,
  reason: result.ok ? null : result.reason,
  processedToday: after ? after.processedToday : null
}));
