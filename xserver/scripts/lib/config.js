// 共通設定ローダ
const fs = require('fs');
const path = require('path');
const os = require('os');

const home = os.homedir();
const ROOT = path.resolve(__dirname, '..', '..');
const CONFIG_PATH = path.join(ROOT, 'config.json');

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

// パス展開
const expandHome = (p) => p.replace(/^~/, home);
const resolveRoot = (p) => path.resolve(ROOT, 'scripts', p);

config.ga4.saPath = expandHome(config.ga4.saPath);
config.paths = {
  root: ROOT,
  data: resolveRoot(config.paths.data),
  queue: resolveRoot(config.paths.queue),
  output: resolveRoot(config.paths.output),
  stats: resolveRoot(config.paths.stats),
  logs: resolveRoot(config.paths.logs),
};

process.env.GOOGLE_APPLICATION_CREDENTIALS = config.ga4.saPath;

// 当日キー
config.today = new Date().toISOString().slice(0, 10);
config.todayJST = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

// 曜日 (JST)
const jstNow = new Date(Date.now() + 9 * 3600 * 1000);
config.dowJST = jstNow.getUTCDay(); // 0=Sun, 1=Mon...
config.isWeekend = config.dowJST === 0 || config.dowJST === 6;

module.exports = config;
