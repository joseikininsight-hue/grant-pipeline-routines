// WP-CLI ラッパー
const { execSync } = require('child_process');
const config = require('./config');

const WP_DIR = config.wordpress.publicHtmlPath;

function wp(args, opts = {}) {
  const cmd = `cd "${WP_DIR}" && wp ${args}`;
  return execSync(cmd, { encoding: 'utf8', maxBuffer: 100 * 1024 * 1024, ...opts });
}

// 投稿リスト取得 (grant 投稿)
function listGrants({ status = 'publish', limit = 50000, fields = 'ID,post_title,post_modified,post_date' } = {}) {
  const out = wp(`post list --post_type=grant --post_status=${status} --posts_per_page=${limit} --fields=${fields} --format=json`);
  return JSON.parse(out);
}

// メタ取得
function getMeta(postId, key) {
  try {
    return wp(`post meta get ${postId} ${key}`).trim();
  } catch (e) {
    return '';
  }
}

// 全 grant のメタ一括 (application_status等)
function getAllGrantsWithMeta(metaKeys = ['application_status', 'deadline_date', 'subsidy_max_amount']) {
  const grants = listGrants();
  const result = [];
  grants.forEach((g) => {
    const meta = {};
    metaKeys.forEach((k) => (meta[k] = getMeta(g.ID, k)));
    result.push({ ...g, meta });
  });
  return result;
}

// 投稿更新 (バックアップ付き)
function updatePost(postId, { title, content, status }) {
  const updates = [];
  if (title !== undefined) updates.push(`--post_title="${title.replace(/"/g, '\\"')}"`);
  if (status !== undefined) updates.push(`--post_status=${status}`);

  if (content !== undefined) {
    // 一時ファイル経由
    const tmpFile = `/tmp/wp-content-${postId}-${Date.now()}.html`;
    require('fs').writeFileSync(tmpFile, content);
    updates.push(`--post_content="$(cat ${tmpFile})"`);
    try {
      const cmd = `cd "${WP_DIR}" && wp post update ${postId} ${updates.join(' ')}`;
      return execSync(cmd, { encoding: 'utf8', shell: '/bin/bash' });
    } finally {
      try { require('fs').unlinkSync(tmpFile); } catch (e) {}
    }
  }

  return wp(`post update ${postId} ${updates.join(' ')}`);
}

// メタ更新 (バックアップキー付き)
function updateMeta(postId, key, value) {
  const tmpFile = `/tmp/wp-meta-${postId}-${Date.now()}.txt`;
  require('fs').writeFileSync(tmpFile, value);
  try {
    return execSync(`cd "${WP_DIR}" && wp post meta update ${postId} ${key} "$(cat ${tmpFile})"`, {
      encoding: 'utf8',
      shell: '/bin/bash',
    });
  } finally {
    try { require('fs').unlinkSync(tmpFile); } catch (e) {}
  }
}

// 既存記事のバックアップ作成
function backup(postId, suffix = 'auto') {
  const post = JSON.parse(wp(`post get ${postId} --fields=post_title,post_content --format=json`));
  updateMeta(postId, `_gi_backup_${suffix}_title`, post.post_title);
  updateMeta(postId, `_gi_backup_${suffix}_content`, post.post_content);
  return post;
}

// noindex 切替 (Yoast 互換)
function setNoIndex(postId, flag = true) {
  return updateMeta(postId, '_yoast_wpseo_meta-robots-noindex', flag ? '1' : '2');
}

module.exports = { wp, listGrants, getMeta, getAllGrantsWithMeta, updatePost, updateMeta, backup, setNoIndex };
