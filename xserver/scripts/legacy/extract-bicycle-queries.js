const fs = require('fs');
const path = require('path');
const lines = fs.readFileSync(path.join(__dirname, 'sc-page-query.csv'), 'utf-8').split('\n').filter(Boolean);
const header = lines[0].split(',');
const queries = lines.slice(1).map(line => {
  const cols = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; continue; }
    if (c === ',' && !inQ) { cols.push(cur); cur = ''; continue; }
    cur += c;
  }
  cols.push(cur);
  const obj = {};
  header.forEach((h, i) => obj[h] = cols[i] || '');
  return obj;
});

const ev = queries.filter(q => /電動.*自転車|自転車.*補助/.test(q.query) && /補助/.test(q.query));
ev.sort((a, b) => parseInt(b.impressions) - parseInt(a.impressions));
console.log('=== 電動自転車補助金関連クエリ ===');
console.log('imp\tCTR\tpos\tquery');
ev.forEach(q => {
  console.log(`${q.impressions}\t${(parseFloat(q.ctr)*100).toFixed(1)}%\t${parseFloat(q.position).toFixed(1)}\t${q.query.slice(0,60)}`);
});
console.log(`\n合計: ${ev.length}クエリ / 合計imp: ${ev.reduce((s,q) => s + parseInt(q.impressions), 0)}`);
