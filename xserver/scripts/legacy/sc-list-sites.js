// このサービスアカウントがアクセスできるSearch Consoleプロパティ一覧
const { google } = require('googleapis');
const path = require('path');

const KEY_FILE = path.join(process.env.HOME || process.env.USERPROFILE, '.secrets/grants-sa.json');

(async () => {
  const auth = new google.auth.GoogleAuth({
    keyFile: KEY_FILE,
    scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
  });
  const sc = google.searchconsole({ version: 'v1', auth });
  try {
    const res = await sc.sites.list();
    console.log('アクセス可能なプロパティ:');
    if (!res.data.siteEntry || res.data.siteEntry.length === 0) {
      console.log('  (なし) ← サービスアカウントが追加されていない');
    } else {
      res.data.siteEntry.forEach(s => {
        console.log(`  ${s.permissionLevel.padEnd(15)} | ${s.siteUrl}`);
      });
    }
  } catch (e) {
    console.error('エラー:', e.message);
  }
})();
