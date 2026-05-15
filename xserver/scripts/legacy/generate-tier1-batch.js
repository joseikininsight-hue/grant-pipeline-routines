// Tier1 残り11記事のV5 HTML + PHP更新スクリプトを一括生成
const fs = require('fs');
const path = require('path');

// 共通テンプレート関数
function tlDr(items) {
  return `<div style="border:1px solid #dde2e8;border-left:4px solid #1e5c8e;background:#f7f9fc;padding:24px 28px;margin:0 0 28px;border-radius:6px;">
<div style="font-size:11px;color:#1e5c8e;font-weight:700;letter-spacing:0.12em;margin:0 0 12px;">TL;DR｜30秒で分かる結論</div>
<ol style="margin:0;padding:0 0 0 22px;color:#1a202c;line-height:1.95;font-size:14.5px;">
${items.map(i => `<li>${i}</li>`).join('\n')}
</ol>
</div>`;
}

function contact(name, tel, hours = '平日 9:00〜17:00') {
  return tel ? `<div style="border:1px solid #dde2e8;border-left:4px solid #c0392b;background:#fff;padding:20px 24px;margin:0 0 32px;border-radius:6px;">
<div style="font-size:11px;color:#c0392b;font-weight:700;letter-spacing:0.12em;margin:0 0 10px;">CONTACT｜お問い合わせ</div>
<div style="font-size:15px;font-weight:700;color:#1a202c;margin:0 0 6px;">${name}</div>
<div style="font-size:14px;color:#2d3748;line-height:1.8;">
TEL: <strong style="color:#c0392b;font-size:16px;">${tel}</strong><br>
受付時間: ${hours}
</div>
</div>` : '';
}

function contents(items) {
  return `<div style="border:1px solid #e1e6ec;background:#fff;padding:24px 28px;margin:0 0 32px;border-radius:6px;">
<div style="font-size:11px;color:#5a6577;font-weight:700;letter-spacing:0.12em;margin:0 0 14px;">CONTENTS｜この記事で分かること</div>
<ul style="margin:0;padding:0 0 0 22px;color:#2d3748;line-height:2;font-size:14.5px;">
${items.map(i => `<li>${i}</li>`).join('\n')}
</ul>
</div>`;
}

function h2(title) {
  return `<h2 style="font-size:24px;font-weight:700;color:#1a202c;border-left:4px solid #1e5c8e;padding:12px 18px;margin:48px 0 20px;background:#f7f9fc;border-radius:0 4px 4px 0;">${title}</h2>`;
}

function actionCards(actions) {
  return `<div style="display:grid;grid-template-columns:1fr;gap:12px;margin:0 0 28px;">
${actions.map((a, i) => `<div style="background:#fff;border:1px solid #dde2e8;border-left:4px solid #1e5c8e;border-radius:6px;padding:22px 26px;">
<div style="display:flex;align-items:baseline;gap:14px;margin:0 0 8px;flex-wrap:wrap;">
<span style="background:#1e5c8e;color:#fff;font-size:11px;font-weight:700;letter-spacing:0.08em;padding:3px 10px;border-radius:2px;">ACTION 0${i+1}</span>
<span style="font-weight:700;color:#1a202c;font-size:16px;">${a.title}</span>
</div>
<div style="font-size:13.5px;color:#4a5568;line-height:1.85;">${a.desc}</div>
</div>`).join('')}
</div>`;
}

function comboCards(items) {
  return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px;margin:0 0 28px;">
${items.map((it, i) => `<div style="background:#fff;border:1px solid #dde2e8;border-radius:6px;padding:20px 22px;">
<div style="font-size:11px;color:#1e5c8e;font-weight:700;letter-spacing:0.1em;margin:0 0 8px;">CATEGORY 0${i+1}</div>
<div style="font-size:15px;font-weight:700;color:#1a202c;margin:0 0 8px;line-height:1.4;">${it.title}</div>
<div style="font-size:13px;color:#5a6577;line-height:1.7;">${it.desc}</div>
</div>`).join('')}
</div>`;
}

function sources(list) {
  return `${h2('参考情報・出典').replace('font-size:24px', 'font-size:20px').replace('font-weight:700', 'font-weight:600').replace('margin:48px 0 20px', 'margin:48px 0 18px')}
<div style="background:#f7f9fc;border:1px solid #dde2e8;border-radius:6px;padding:22px 26px;margin:0 0 32px;font-size:13px;color:#2d3748;line-height:1.95;">
<div><strong style="color:#1a202c;">参考にした主な情報源</strong>
<ul style="margin:10px 0 0;padding:0 0 0 22px;line-height:1.95;">
${list.map(s => `<li><a href="${s.url}" target="_blank" rel="nofollow noopener" style="color:#1e5c8e;text-decoration:underline;">${s.label}</a></li>`).join('')}
</ul>
</div>
</div>`;
}

function jsonLd(article) {
  const articleSchema = {
    "@context":"https://schema.org","@type":"Article",
    "headline": article.title,
    "description": article.desc,
    "datePublished": article.published || "2025-09-01",
    "dateModified": "2026-04-28",
    "author":{"@type":"Organization","name":"補助金図鑑 編集部","url":"https://joseikin-insight.com/"},
    "publisher":{"@type":"Organization","name":"補助金図鑑","url":"https://joseikin-insight.com/"},
    "mainEntityOfPage":{"@type":"WebPage","@id":`https://joseikin-insight.com/grants/grant-${article.id}/`}
  };
  const grantSchema = {
    "@context":"https://schema.org","@type":"MonetaryGrant",
    "name": article.title,
    "description": article.desc,
    "funder":{"@type":"GovernmentOrganization","name": article.organization || "行政機関"},
    "amount":{"@type":"MonetaryAmount","currency":"JPY","value": String(article.amount_value || 0)},
    "url":`https://joseikin-insight.com/grants/grant-${article.id}/`
  };
  if (article.contact_tel) grantSchema.provider = {"@type":"Organization","name":article.organization,"telephone":article.contact_tel};
  if (article.official_url) grantSchema.termsOfService = article.official_url;
  const faqSchema = {
    "@context":"https://schema.org","@type":"FAQPage",
    "mainEntity": article.faq.map(f => ({
      "@type":"Question","name":f.question,
      "acceptedAnswer":{"@type":"Answer","text":f.answer}
    }))
  };
  return `<script type="application/ld+json">${JSON.stringify(articleSchema)}</script>
<script type="application/ld+json">${JSON.stringify(grantSchema)}</script>
<script type="application/ld+json">${JSON.stringify(faqSchema)}</script>`;
}

// 11記事のデータ
const articles = require('./tier1-data.json');

// 共通の併用可能制度
const commonCombo = [
  {title: "電気・都市ガス料金支援", desc: "2026年1月〜3月分で全世帯・事業者に約7,000円相当の支援。電気・都市ガス会社経由で自動値引き。"},
  {title: "市町村独自の補助金", desc: "市町村が独自に実施する個人・事業者向け給付金。地域ごとに金額・対象が異なる。"},
  {title: "国の各種給付金", desc: "児童手当・年金生活者支援給付金等の国制度。所得制限を満たせば併用可能。"},
  {title: "都道府県の支援制度", desc: "都道府県が独自に実施する物価高騰対策・産業振興補助金。"},
];

// 各記事のHTML生成
articles.forEach(art => {
  const html = [
    tlDr(art.tldr),
    art.contact_tel ? contact(art.contact_name, art.contact_tel, art.contact_hours) : '',
    contents(art.contents),
    art.sections.map(s => h2(s.title) + s.html).join('\n\n'),
    h2('受付終了後、今すべき3つのこと'),
    actionCards(art.actions),
    h2('併用できる関連制度'),
    comboCards(art.combo || commonCombo),
    sources(art.sources),
    jsonLd(art),
  ].filter(Boolean).join('\n\n');

  const outPath = path.join(__dirname, `post-${art.id}-content-v5.html`);
  fs.writeFileSync(outPath, html);
  console.log(`✓ ID=${art.id} HTML生成 (${html.length} chars)`);
});
