#!/usr/bin/env node
/**
 * 05-prepare-municipal.js
 * Routine worker から呼ばれ、次に書く自治体候補を JSON で stdout 出力する。
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DATA_PATH = path.join(__dirname, '../data/municipal-candidates.json');
const REFERENCE = {
  post_id: 168662,
  slug: 'itabashi-ku-ninsho-hoikuen-josei-2026',
  payload_template: '/home/keishi0804/itabashi-article/payload-v2.json',
};
const WP_DIR = '/home/keishi0804/joseikin-insight.com/public_html';

function wpQuerySlugsLike(pattern) {
  try {
    const sql = `SELECT post_name FROM wp_posts WHERE post_type='grant' AND post_status IN ('publish','draft') AND post_name LIKE '${pattern}'`;
    const out = execSync(`cd "${WP_DIR}" && /usr/bin/wp db query "${sql.replace(/"/g, '\\"')}" --skip-column-names`, { encoding: 'utf8' });
    return out.split('\n').map(s => s.trim()).filter(Boolean);
  } catch (e) {
    return [];
  }
}

function main() {
  if (!fs.existsSync(DATA_PATH)) {
    console.log(JSON.stringify({ ok: false, error: 'data file missing', path: DATA_PATH }));
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const completed = new Set(data.completed_slugs || []);
  const candidates = data.candidates || [];

  for (const c of candidates) {
    const matches = wpQuerySlugsLike(`${c.key}-%-2026`);
    if (matches.length > 0) continue;
    if (matches.some(s => completed.has(s))) continue;

    const ctx = {
      ok: true,
      candidate: c,
      reference: REFERENCE,
      axis_requirements: {
        axis1_internal_grant_links_3plus: 20,
        axis2_table_4rows_3cols: 15,
        axis3_data_gi_calc_widget: 15,
        axis4_h2_failure_keyword_and_3_hits: 10,
        axis5_5_grant_links: 10,
        axis6_last_updated_and_reiwa: 5,
        axis7_sources_section_3_external_urls: 5,
      },
      endpoint: 'https://joseikin-insight.com/wp-json/gisg/v1/grant-publish',
      hint: '板橋区 reference を流用する際は 「板橋」 「itabashi」 の文字を絶対に残さないこと',
    };
    console.log(JSON.stringify(ctx, null, 2));
    return;
  }
  console.log(JSON.stringify({ ok: false, exhausted: true, message: 'All candidates consumed; add more to municipal-candidates.json' }));
}

main();
