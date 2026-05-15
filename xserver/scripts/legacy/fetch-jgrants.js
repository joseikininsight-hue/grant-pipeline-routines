#!/usr/bin/env node
// jGrants公式API から全制度を取得
// API: https://api.jgrants-portal.go.jp/exp/v1/public/subsidies
//   acceptance: 0=終了済み 1=受付中
//   sort: created_date / acceptance_end_datetime
//   keyword: フリーキーワード（必須）

const fs = require('fs');
const https = require('https');
const path = require('path');

const OUT_OPEN = path.join(__dirname, 'jgrants-open.json');
const OUT_ALL = path.join(__dirname, 'jgrants-all.json');

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; grant-rewrite-bot/1.0)',
      },
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse failed: ${e.message}\n${data.slice(0, 200)}`)); }
      });
    }).on('error', reject);
  });
}

// keywordは必須なので「補助金」と「助成金」で取得
const keywords = ['補助金', '助成金', '給付金', '奨励金'];

async function main() {
  const allMap = new Map(); // id -> record（重複排除）

  for (const acceptance of [1, 0]) {
    for (const kw of keywords) {
      const url = `https://api.jgrants-portal.go.jp/exp/v1/public/subsidies?keyword=${encodeURIComponent(kw)}&sort=created_date&order=DESC&acceptance=${acceptance}`;
      console.log(`[fetch] keyword=${kw} acceptance=${acceptance}`);
      try {
        const json = await fetchJSON(url);
        const items = (json.result || []).map(it => ({ ...it, _acceptance: acceptance, _kw: kw }));
        items.forEach(it => {
          if (!allMap.has(it.id)) allMap.set(it.id, it);
        });
        console.log(`  → ${items.length}件 (累計 ${allMap.size})`);
      } catch (e) {
        console.error(`  ! エラー: ${e.message}`);
      }
      await new Promise(r => setTimeout(r, 500)); // レート制御
    }
  }

  const all = [...allMap.values()];
  const open = all.filter(it => it._acceptance === 1);

  fs.writeFileSync(OUT_OPEN, JSON.stringify(open, null, 2), 'utf-8');
  fs.writeFileSync(OUT_ALL, JSON.stringify(all, null, 2), 'utf-8');

  console.log('\n=== Summary ===');
  console.log(`公募中: ${open.length}件`);
  console.log(`全体: ${all.length}件`);
  console.log(`出力: ${OUT_OPEN}`);
  console.log(`出力: ${OUT_ALL}`);
}

main().catch(e => { console.error(e); process.exit(1); });
