# grant-pipeline-quick-lane

**取得日時**: 2026-05-15
**URL**: https://claude.ai/code/routines/trig_01VguMGb9mzT12A5xn8J6Gi3
**ステータス**: アクティブ / 次回実行 今日の21:00
**リポジトリ**: `joseikininsight-hue/git`
**繰り返し**: 毎時 0 分過ぎ, 6 時間ごと、毎日
**コネクター**: Notion

---

## 指示（プロンプト本文）

Quick-lane routine: 2 つのサイドキューを軽量処理する補助 worker。所要時間目標 5-8 分 / セッション。Worker v2 (重リライト) を補完する位置付け。

## ★並行ジョブロック

```
~/bin/webhook-call work-state-list
active job で 30分以内 updatedAt + step<4 があれば skip (Worker v2 と競合回避)。
skip出力: { "skipped":true, "reason":"already-processing" }
```

## A. キュー選択

1. `~/bin/webhook-call read-queue '{"name":"light-patch-queue"}'` → items 配列
2. `~/bin/webhook-call read-queue '{"name":"revival-queue"}'`    → items 配列

優先順:
- light-patch-queue の pending item >=1 あれば lane=light-patch
- なければ revival-queue の pending item >=1 あれば lane=revival
- どちらも空なら `{"lane":"idle"}` を Slack に通知して終了

## B. Lane=light-patch (5 分/件・最大 3 件処理)

対象: rankingDrops 上位の post (positionDrop 大きい順)
やること: **meta description + title + h1 第一段落** だけ更新。本文 content は触らない。

### Phase 1: 軽リサーチ (1 件あたり 30 秒)
- 当該 post の **既存 title / meta description** を取得 (wp-meta-get)
- 現在の SC キーワード上位 5 個 + positionDrop 数値を確認
- WebSearch 「<post 主要キーワード> 2026 最新」TOP 5 で**直近の制度動向**を把握

### Phase 2: パッチ生成 (1 件あたり 1.5 分)
新 title (60-65 文字以内・最新年号・主要数値):
新 metaDescription (110-120 文字・検索意図 + 数値 + CTA):

### Phase 3: 公開 (1 件あたり 30 秒)
```bash
curl -s -X POST "https://joseikin-insight.com/wp-json/gisg/v1/grant-publish" \
  -H "Content-Type: application/json" \
  -H "X-Gisg-Token: $GISG_PIPELINE_SHARED_SECRET" \
  -d '{"mode":"light-patch","type":"rewrite","post_id":<id>,"title":"<new title>","metaDescription":"<new desc>","yoastTitle":"<new title>"}'
```

★ light-patch は axis-validator strict gate を bypass する (content 変更なしのため軸検証不要)。
★ content / ACF / カテゴリは触らない。
★ publish 成功後に `webhook-call mark-queue-done '{"type":"light-patch","postId":<id>}'` を呼ぶ (queue 更新)。

## C. Lane=revival (8 分/件・最大 2 件処理)

対象: revival-queue から 1 item: `{ id: <noindex post id>, oldTitle, newQuery, estImpressions }`
やること: **noindex 解除 + content フル書き換え + publish** で既存 URL 資産を再活性化

### Phase 1-3: Worker v2 と同じフロー (Phase 1 リサーチ + Phase 2-3 HTML 生成)
ただし type=rewrite, post_id=<id>, mode=revival を payload に必ず含める:

```bash
curl -s -X POST "https://joseikin-insight.com/wp-json/gisg/v1/grant-publish" \
  -H "Content-Type: application/json" \
  -H "X-Gisg-Token: $GISG_PIPELINE_SHARED_SECRET" \
  -d '{"mode":"revival","type":"rewrite","post_id":<id>,"strictAxis":true,"axisScore":<self-score>,"title":"<new title>","content":"<new HTML>",...}'
```

★ mode=revival で grant-publish が自動で `_yoast_wpseo_meta-robots-noindex=0` をセット (noindex 解除)。
★ Worker v2 と同じ axis 80/80 を目指す (strictAxis で gate 通過)。

## D. Slack 通知（旧・現在は Notion に変更）

- ✅ light-patch 完了 / postId / 旧タイトル → 新タイトル / 旧 desc 文字数 → 新文字数 / 件数 N
- 🔄 revival 完了 / postId / 旧 noindex タイトル → 新タイトル / axisAudit / cluster: 5 added
- 💤 idle / 両キューが空

## 完了報告

```json
{
  "lane": "light-patch|revival|idle",
  "processed": <件数>,
  "details": [...]
}
```

## 重要原則

- 1 セッション = 軽処理 5-8 分。重リライトは Worker v2 に任せる
- light-patch は content 不変更・パッチング Phase が短い
- revival は既存 noindex URL の再活性化 = SEO 資産の再利用
- Worker v2 と必ず排他 (work-state-list で active job check)

---

## 🔔 通知ルール変更 (2026-05-13 incident 対応)

**Slack 連携は削除済み**。本プロンプト内の「Slack」関連記述は全て無効。代わりに **Notion DB に記録** すること。

### Notion DB 仕様
- Database ID: `58437f634e9d4679b029e401efe1ebf8`
- Data Source ID: `c02b0fb7-9b15-4780-bbb8-9f320e9fee82`
- 投稿方法: Notion connector を使い 1 ページ作成

### 記録項目 (必須)
- Name (TITLE): `"<routine名> YYYY-MM-DD HH:MM JST"`
- Routine (SELECT): `"quick-lane"` を必ずセット
- Status (SELECT): success / skipped / error / idle
- Lane (SELECT): rewrite / new / revival / light-patch / idle / recovery
- Summary (TEXT): 1 行要約 (postId, タイトル, axisScore 等)
- Post IDs (TEXT): カンマ区切り
- Job ID (TEXT): job-XXX
- Details JSON (TEXT): 完了レポート JSON 全文 (旧 Slack 投稿内容に相当)

### 注意
- セッション最後に必ず 1 ページ作成 (success/skipped/idle/error 全ケース)
- 失敗時はリトライせずそのままセッション完了 (時間/トークン浪費防止)
