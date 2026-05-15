// パイロット記事 ID=8316 の改良HTML生成
const fs = require('fs');
const path = require('path');

const original = fs.readFileSync(
  path.join(__dirname, 'post-8316-original.html'),
  'utf-8'
);

const banner = `<div style="background:linear-gradient(135deg,#fff5f5 0%,#ffe5e5 100%);border-left:6px solid #e53e3e;border-radius:8px;padding:20px 24px;margin:0 0 32px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<p style="margin:0 0 12px;font-size:20px;font-weight:700;color:#c53030;">⚠️ この支援金は受付を終了しました</p>
<p style="margin:0 0 12px;font-size:15px;color:#2d3748;line-height:1.7;"><strong>申請期間:</strong> 2025年10月1日 〜 2025年11月28日（終了済み）<br><strong>対象:</strong> 熊本県内のLPガス利用事業者（個人事業主・法人）<br><strong>支援額:</strong> 定額4,000円／事業者</p>
<p style="margin:0 0 8px;font-size:14px;color:#4a5568;line-height:1.7;">本記事は<strong>制度解説の資料</strong>として残しています。次回（第5弾）以降の発表があり次第、最新情報に更新します。最新情報は公式サイトをご確認ください。</p>
<p style="margin:0;font-size:14px;"><a href="https://www.kuma-lpg-shien.jp/" target="_blank" rel="nofollow noopener" style="color:#2b6cb0;text-decoration:underline;font-weight:600;">▶ 熊本県LPガス支援金 公式サイトで最新情報を確認</a></p>
</div>

`;

const footer = `

<div style="background:#f7fafc;border-radius:12px;padding:28px;margin:48px 0 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;border:1px solid #e2e8f0;">
<h3 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#1a202c;border-left:5px solid #3182ce;padding-left:14px;">📌 関連する最新の助成金情報</h3>
<p style="margin:0 0 16px;font-size:15px;color:#4a5568;line-height:1.8;">本記事の支援金は終了していますが、補助金図鑑では<strong>毎日最新の助成金・補助金情報</strong>を更新しています。今すぐ申請可能な制度をお探しの方は、以下からご確認ください。</p>
<ul style="margin:0;padding:0 0 0 0;list-style:none;line-height:1.6;color:#2d3748;font-size:15px;">
<li style="padding:10px 0;border-bottom:1px solid #e2e8f0;"><a href="/grants/" style="color:#2b6cb0;text-decoration:none;font-weight:600;">📋 補助金・助成金 一覧</a><br><span style="font-size:13px;color:#718096;">現在受付中の制度を地域・カテゴリ・金額で絞り込み</span></li>
<li style="padding:10px 0;border-bottom:1px solid #e2e8f0;"><a href="/subsidy-diagnosis/" style="color:#2b6cb0;text-decoration:none;font-weight:600;">🎯 補助金診断（無料）</a><br><span style="font-size:13px;color:#718096;">あなたに合う支援金を3分で診断</span></li>
<li style="padding:10px 0;border-bottom:1px solid #e2e8f0;"><a href="/column/" style="color:#2b6cb0;text-decoration:none;font-weight:600;">📚 コラム（解説記事）</a><br><span style="font-size:13px;color:#718096;">補助金活用のコツ・申請ノウハウ</span></li>
<li style="padding:10px 0;"><a href="/" style="color:#2b6cb0;text-decoration:none;font-weight:600;">🏠 補助金図鑑トップ</a><br><span style="font-size:13px;color:#718096;">最新の助成金・補助金情報を毎日更新中</span></li>
</ul>
</div>
`;

const improved = banner + original + footer;
fs.writeFileSync(
  path.join(__dirname, 'post-8316-improved.html'),
  improved
);

console.log('✅ Generated improved content');
console.log(`  original size:  ${original.length} bytes`);
console.log(`  improved size:  ${improved.length} bytes`);
console.log(`  banner size:    ${banner.length} bytes`);
console.log(`  footer size:    ${footer.length} bytes`);
