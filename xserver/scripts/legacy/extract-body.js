// preview-grant-8316-v2.html から本文＋JSON-LDを抽出
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'preview-grant-8316-v2.html'), 'utf-8');

// shell開始タグ後から、shell閉じ（最後の</div>と直後の改行が続く位置）まで抽出
const startMarker = '<div class="shell">';
const startIdx = src.indexOf(startMarker) + startMarker.length;
// </body>を見つけ、その手前の最後の</div>がshell閉じ
const bodyEnd = src.indexOf('</body>');
// その間の内容
const innerSection = src.substring(startIdx, bodyEnd);
// 末尾から最後の</div>を探して切る
const lastDivIdx = innerSection.lastIndexOf('</div>');
const body = innerSection.substring(0, lastDivIdx).trim();

// JSON-LD scripts (本文用にbody.htmlに埋め込み)
const jsonLdMatches = [...src.matchAll(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g)];
const jsonLdBlocks = jsonLdMatches.map((m) => m[0]).join('\n');

// 結合
const finalBody = body + '\n\n' + jsonLdBlocks;

fs.writeFileSync(path.join(__dirname, 'post-8316-content-v2.html'), finalBody);
console.log(`✅ Extracted: total ${finalBody.length} chars`);
console.log(`  body:           ${body.length} chars`);
console.log(`  json-ld blocks: ${jsonLdBlocks.length} chars (${jsonLdMatches.length} scripts)`);
