# Grant Pipeline (joseikin-insight.com 自動運用)

GA4/Search Console データドリブンで補助金記事のリライト・新規生成・公開を自動化するパイプライン。

## アーキテクチャ

```
[Anthropic Routines (cron, クラウド)]
   │
   │ SSH 経由で xserver にアクセス
   ▼
[xserver (実行エンジン)]
   ~/grant-pipeline/
     scripts/  ← データ取得・キュー生成・公開実行
     queue/    ← 当日タスクキュー
     data/     ← 取得した生データキャッシュ
     output/   ← 草稿・評価結果アーカイブ
     stats/    ← 日次ログ
     logs/     ← 実行ログ
```

## スケジュール (平日のみ)

| 時刻 (JST) | Routine | 役割 |
|---|---|---|
| 06:27 | morning-batch | データ取得・優先度算出・キュー生成 (5+5本) |
| 09:07 | worker | 1回目: リライト1+新規1 (10時公開・11時ピーク前) |
| 12:07 | worker | 2回目 (13時公開・14-15時ピーク) ★最重要 |
| 15:07 | worker | 3回目 (16時公開・17時セカンドピーク) |
| 18:07 | worker | 4回目 (19時公開・夕食後needs) |
| 21:07 | worker | 5回目 (上限未達分の予備) |
| 22:45 | night-batch | RSS監視・日次サマリ・翌日候補仮生成 |

## スクリプト

| ファイル | 役割 |
|---|---|
| `00-time-analysis.js` | GA4 時間帯×曜日分析 (スケジュール最適化用、初回のみ) |
| `01-fetch-data.js` | データ取得 orchestrator (GA4/SC/WP) |
| `02-build-queue.js` | 優先度算出・5+5本キュー生成 |
| `03-publish.js` | inbox → WordPress 公開実行 |
| `04-rss-monitor.js` | 公式RSS監視・新規制度検知 |
| `05-prepare-rewrite.js` | リライト用コンテキスト集約 (Routinesから呼ぶ) |
| `05-prepare-new.js` | 新規記事用コンテキスト集約 (同上) |
| `lib/config.js` | 設定ローダ |
| `lib/wp.js` | WP-CLI ラッパー |
| `lib/ga4.js` | GA4 ラッパー |
| `lib/sc.js` | Search Console ラッパー |
| `lib/queue.js` | キュー操作 |
| `legacy/*` | 既存資産 (analytics-tools/ からコピー) |

## 同期

ローカル開発 → xserver 反映:
```bash
bash sync-to-xserver.sh
```

## 設定 (`config.json`)

主要パラメータ:
- `limits.rewritePerDay` = 5
- `limits.newArticlesPerDay` = 5
- `limits.minQualityScore` = 90
- `schedule.weekendsActive` = false
- `scoring.weights.*` = 優先度スコアの重み

## 品質ゲート

- 90点以上: 自動公開
- 80-89点: 1回再生成 → ダメなら manual-review
- 80点未満: 即 manual-review

## バックアップ

リライト時は `_gi_backup_auto-{date}_title` / `_gi_backup_auto-{date}_content` メタにバックアップ。

---

## 自治体特化記事 lane (Phase 4-I) — 2026-05-11 追加

joseikin-insight サイトに「1自治体ずつ深掘り＋Python図解＋axis 80/80」の高品質記事を量産するための lane。

### データソース
- `data/municipal-candidates.json` — 候補リスト (key, municipality, themes[])。完了 slug は `completed_slugs` に追記
- 参考記事: 板橋区 認証保育所助成 post_id 168662 (slug: `itabashi-ku-ninsho-hoikuen-josei-2026`)
- 参考 payload: `/home/keishi0804/itabashi-article/payload-v2.json`

### スクリプト
- `scripts/05-prepare-municipal.js` — 次の自治体候補を JSON で stdout 出力 (consumed 自動判定)

### Routine 統合 (Worker prompt 追記サンプル)
worker routine のプロンプトに以下を追加すれば municipal-lane が動く:

```
## municipal-lane (1日1記事)
1. ssh xserver "node ~/grant-pipeline/scripts/05-prepare-municipal.js" を実行
2. 返ってきた candidate.themes から WebSearch + WebFetch でバズり度の高いテーマを1つ選定
3. ssh xserver "cat /home/keishi0804/itabashi-article/payload-v2.json" でテンプレ参照
4. Python matplotlib で図解3枚生成 (1485x810px) → /tmp/{slug}_*.png
5. /usr/bin/wp media import で画像アップロード
6. HTML本文構築 — axis 80/80 必達 (axis_requirements 参照)
7. payload.json を /home/keishi0804/{slug}-article/ に保存
8. TOKEN=$(grep GISG_PIPELINE_SHARED_SECRET ~/joseikin-insight.com/public_html/wp-config.php | grep -oE "'[a-f0-9]{64}'" | tr -d "'")
   curl -X POST 'https://joseikin-insight.com/wp-json/gisg/v1/grant-publish'      -H 'Content-Type: application/json' -H "X-Gisg-Token: $TOKEN"      --data-binary @/home/keishi0804/{slug}-article/payload.json
9. レスポンスの axisAudit.total が 80 であることを確認
10. 完了したら municipal-candidates.json の completed_slugs に追記 (jq などで)
```

### 拡張アイデア
- 全国対応: candidates に prefecture/municipality (47都道府県の市町村) を追加
- 自動拡張: jGrants API + Scrapling で各自治体から制度を自動収集 → candidates 自動補充
- 品質ゲート: axisAudit < 80 で再生成リトライ (最大2回)
