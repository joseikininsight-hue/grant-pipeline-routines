# grant-pipeline-diagram-injector

**取得日時**: 2026-05-15
**URL**: https://claude.ai/code/routines/trig_017tBphraMR8zXWrhJ6NsG7T
**ステータス**: アクティブ
**次回実行**: 明日の10:00
**リポジトリ**: `joseikininsight-hue/git`
**繰り返し**: Runs daily at 10:00 JST (毎日10:00)
**コネクター**: Notion

---

## 指示（プロンプト本文）

Diagram Injector v1: 直近24h以内に公開された grant 記事に Python図解を後付けするルーチン。worker-v2 が高速公開した記事を翌朝までに図解強化する。1セッション最大3記事まで処理。

## 0. 対象記事を取得

ssh xserver 経由で直近24h以内に公開された grant 記事を取得:

```bash
wp post list --post_type=grant --post_status=publish --fields=ID,post_title,post_name,post_date --date_query_after='24 hours ago' --posts_per_page=20 --format=json
```

図解済みチェック: `wp post meta get {ID} _gi_has_diagram`
値が 1 の記事はスキップ。未設定 or 0 が処理対象。

- 対象0件なら Slack に「図解対象なし」を通知して終了（※下記の通知ルール変更により Notion 記録に変わっている）
- 対象4件以上なら公開が新しい順に3件に絞る

## 1. 各記事の情報取得

対象記事ごとに wp post get / wp post meta get で以下を取得:
- post_content, max_amount_numeric, organization, grant_target
- deadline_date, subsidy_rate_detailed

## 2. Python 図解3枚生成（記事ごと）

`slug = post_name` を使用。
ssh xserver で `/home/keishi0804/{slug}-diagrams/diagrams.py` を作成して実行:

- import matplotlib + japanize_matplotlib (setuptools 経由で distutils 互換あり)
- 1枚目 (1485x810px): 金額・対象別グラフ → `/tmp/{slug}_amount.png`
- 2枚目 (1635x660px): 申請〜支給タイムライン → `/tmp/{slug}_timeline.png`
- 3枚目 (1485x809px): 類似制度との補助額比較棒グラフ → `/tmp/{slug}_compare.png`

グラフのデータは ACF メタ（max_amount_numeric, organization, grant_target 等）と本文から読み取る。
数値が取れない場合は合理的な推定値を使う（0や空グラフにしない）。

pip install エラー時: `pip3 install japanize-matplotlib setuptools --user --quiet`

## 3. 画像アップロード

```bash
wp media import /tmp/{slug}_amount.png --porcelain   → media_id + URL を記録
wp media import /tmp/{slug}_timeline.png --porcelain
wp media import /tmp/{slug}_compare.png --porcelain
```

URL形式: `https://joseikin-insight.com/wp-content/uploads/YYYY/MM/filename.png`

## 4. 本文に図解を挿入

挿入位置のルール:
- `amount.png` → 「概要」「詳細」「金額」「支給」を含む最初の h2 直後
- `timeline.png` → 「流れ」「ステップ」「手順」「申請から」を含む h2 直後
- `compare.png` → 「比較」「関連」「類似」「他の」を含む h2 直後、なければ出典 h2 直前

挿入 HTML:
```html
<figure class="gi-diagram"><img src="{URL}" alt="{タイトル} - {グラフ説明}" loading="lazy" width="1485" height="810"><figcaption>{グラフ説明20字以内}</figcaption></figure>
```

## 5. /grant-publish で更新

TOKEN を `wp-config.php` の `GISG_PIPELINE_SHARED_SECRET` から取得。

patch.json:
```json
{ "type": "rewrite", "post_id": {ID}, "content": "{図解挿入済みHTML}", "qualityScore": 95 }
```

`curl -sS -X POST https://joseikin-insight.com/wp-json/gisg/v1/grant-publish`
`ok=true` を確認。

## 6. 図解済みフラグ

`wp post meta update {ID} _gi_has_diagram 1`

## 7. Slack 通知 (#joseikin-insight C0B0LAZH518)

- 成功: `[diagram-injector] 図解追加完了 N件 / post_id・タイトル・URL 一覧`
- 一部失敗: `成功N件 / 失敗M件 / 失敗 post_id 一覧`

## 完了報告 (JSON)

```json
{
  "type": "diagram-injector",
  "processed": N,
  "results": [{"post_id":id,"title":"...","diagrams":["url1","url2","url3"],"ok":true}],
  "slackNotified": true
}
```

## 重要原則

- 1セッション最大3記事（時間オーバー防止）
- `_gi_has_diagram=1` の記事は絶対スキップ（二重処理防止）
- 1記事失敗しても他記事は続行
- japanize_matplotlib + setuptools 必須
- /grant-publish が LiteSpeed キャッシュを自動パージ
- 数値不明な項目は推定値で埋める（空グラフNG）

---

## 🔔 通知ルール変更 (2026-05-13 incident 対応)

**Slack 連携は削除済み**。本プロンプト内の「Slack」関連記述は全て無効。代わりに **Notion DB に記録** すること。

### Notion DB 仕様

- Database ID: `58437f634e9d4679b029e401efe1ebf8`
- Data Source ID: `c02b0fb7-9b15-4780-bbb8-9f320e9fee82`
- 投稿方法: Notion connector を使い 1 ページ作成

### 記録項目 (必須)

- Name (TITLE): `"diagram-injector YYYY-MM-DD HH:MM JST"`
- Routine (SELECT): `"diagram-injector"` を必ずセット
- Status (SELECT): `success / skipped / error / idle`
- Lane (SELECT): `rewrite / new / revival / light-patch / idle / recovery`
- Summary (TEXT): 1 行要約 (postId, 図解枚数等)
- Post IDs (TEXT): カンマ区切り
- Job ID (TEXT): `job-XXX` (該当なしなら空欄)
- Details JSON (TEXT): 完了レポート JSON 全文

### 注意

- セッション最後に必ず 1 ページ作成
- 失敗時はリトライせずセッション完了
