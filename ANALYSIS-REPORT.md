# joseikin-insight.com ルーチン構造の完全分析

**作成日**: 2026-05-15
**契機**: 「天引きシミュレーター動かない」事故の根本原因を「ルーチン側に欠陥があるはず」と推定して分析開始
**結論**: **9 ルーチンと唯一のソース管理 repo (`grant-pipeline-bot`) に大規模な乖離あり**。これが widget 不整合などの構造的事故の温床

---

## 1. 全ルーチン棚卸し（9 件）

すべて `joseikininsight-hue/git` をリポジトリ表示しているが、**実在しない** (gh GraphQL 解決不能)。
存在する関連 repo は `joseikininsight-hue/grant-pipeline-bot` (24KB, last push 2026-04-29) のみ。

| # | Routine | スケジュール | 用途 | 指示文字数 | 状態 |
|---|---|---|---|---:|---|
| 1 | grant-pipeline-diagram-injector | 毎日 10:00 | Python 図解後付け | 〜2KB | アクティブ |
| 2 | grant-pipeline-quick-lane | 6h周期 | light-patch / revival | 6.6KB | アクティブ |
| 3 | **grant-pipeline-worker-v2** | 2h周期 | 1記事完結 rewrite/new (Phase1-4) | **23KB** | アクティブ |
| 4 | grant-pipeline-stuck-detector | 毎日 9:00 | stuck recovery | 5KB | アクティブ |
| 5 | grant-pipeline-step4-evaluate-publish | API のみ | Phase4 single (手動 trigger) | 5KB | API |
| 6 | grant-pipeline-step3-tailcontent | API のみ | Phase3 single | 3.5KB | API |
| 7 | grant-pipeline-step2-headcontent | API のみ | Phase2 single | 2.4KB | API |
| 8 | grant-pipeline-night-batch | 毎日 22:45 | RSS監視 + 日次サマリ | 2.7KB | アクティブ |
| 9 | grant-pipeline-morning-batch | 毎日 6:27 | データ取得 + キュー生成 | 4.4KB | アクティブ |

全ルーチン共通：
- リポジトリ表示: `joseikininsight-hue/git`（実在しない）
- コネクター: Notion（DB `58437f63-4e9d-4679-b029-e401efe1ebf8`）
- 通知ルール: 2026-05-13 incident 後 Slack 撤廃 → Notion 記録に統一

---

## 2. 🔥 構造的エラーの本質

### 2.1 ソース管理外で進化したプロンプト

**`grant-pipeline-bot/routines/worker.md`**（ソース管理されている版）:
- 2,922 字
- 評価項目: 100点満点（検索意図 / 独自性 / 信頼性 / 構造 / コピー / CTA / UX）
- **`data-gi-calc` 0 件**
- **`simulator` 0 件 / `checker` 0 件**
- シンプルな初版

**Claude Code 上で実際に動いている `worker-v2`**:
- 23,000+ 字（8 倍）
- 評価項目: 基礎 100点 + **独自軸 80点（軸1-7）**
- **5 種類の widget テンプレ T1-T5 が完全実装**
- axis-validator strict 連携 (HTTP 422 reject 含む)
- クラスター展開 (5 件投入)
- relatedGrants 並列 fetch
- 「最終更新 2026-05-13 incident 対応で Slack → Notion」

→ **誰か（人 or AI）が Claude Code 上で worker-v2 を 8 倍に拡張したが、その変更は repo にコミットされなかった**。

### 2.2 残り 6 ルーチンが repo に存在しない

`grant-pipeline-bot/routines/` ディレクトリの中身:
- ✅ `morning-batch.md`
- ✅ `night-batch.md`
- ✅ `worker.md` (= 旧 worker, worker-v2 ではない)
- ❌ `worker-v2.md` (存在しない)
- ❌ `quick-lane.md` (存在しない)
- ❌ `stuck-detector.md` (存在しない)
- ❌ `diagram-injector.md` (存在しない)
- ❌ `step2-headcontent.md` (存在しない)
- ❌ `step3-tailcontent.md` (存在しない)
- ❌ `step4-evaluate-publish.md` (存在しない)

**9 ルーチンのうち 6 ルーチン（67%）が完全に未管理。**

### 2.3 theme との断絶

| 役割 | 実体 |
|---|---|
| WordPress theme コード | `joseikininsight-hue/Grant-Insight-Perfect-new` |
| パイプライン scripts | `joseikininsight-hue/grant-pipeline-bot` |
| Anthropic Routines プロンプト | **どこにもコミットされていない** (Claude Code runtime のみ) |
| xserver runner.php / axis-validator | おそらく xserver 直置き（git 管理外） |

→ **theme JS と routine prompt が同じ前提（「init JS 常駐」）を共有しているのに、別 repo / 管理外** 。レビュー時にどちらかが嘘をついても気付かない。

---

## 3. 各 routine の主要分析

### 3-1. worker-v2 (要)

```
Phase 1: コンテキスト + 競合リサーチ (並列 WebSearch×2 + WebFetch×3)
Phase 1.5: 自サイト DB 横断検索 (relatedGrants A/B/C)
Phase 2: 本文前半 HTML (TL;DR + KPI + 概要 + ステップ + 背景)
Phase 3: 本文後半 HTML + 5 widget T1-T5 必須
Phase 4: 評価 (100+80=180点) + /grant-publish atomic + cluster 5件展開
```

**評価の独自軸**:
- 軸1 relatedGrants 引用 +20
- 軸2 横断比較表 +15
- 軸3 計算ツール埋込 +15 ← **過去 14 日間、HTML マークアップ数のみで満点判定**
- 軸4 失敗事例セクション +10
- 軸5 内部リンク +10
- 軸6 最終更新 + 施行日 +5
- 軸7 出典セクション +5（go.jp / lg.jp 必須）

### 3-2. quick-lane

- light-patch (3 件/回): title + meta description のみ更新（content 不変更）
- revival (2 件/回): noindex 解除 + content フル書換

### 3-3. morning-batch（朝のメインバッチ）

- fetch-data → GA4 / SC / WP データ取得
- build-queue → rewrite-queue + new-queue 生成
- AI 能動発掘（cluster expansion）
- 健全性チェック

### 3-4. night-batch

- RSS 監視（公式情報源）
- 日次サマリ
- 翌日候補仮生成

### 3-5. diagram-injector

- 直近 24h 公開記事に Python 図解 3 枚追加（matplotlib + japanize_matplotlib）
- 1 セッション最大 3 記事

### 3-6. stuck-detector

- step≤2 + 30 分以上 stale な job を recovery
- step3 で 60 分以上 → archive

### 3-7. step2 / step3 / step4 (API only)

- worker-v2 の各 Phase を個別 trigger できる recovery 用
- すべて jobId 入力で work-state を読み込む

---

## 4. 「現状リポジトリ不足」の正体

ユーザー指摘の通り、**リポジトリ構造が破綻している**：

```
✅ 存在する
   Grant-Insight-Perfect-new (WP theme, 私が編集中)
   grant-pipeline-bot (scripts + 旧 routine 3 本のみ)

❌ 存在しないが必要
   joseikininsight-hue/git (Claude Code の表示)
   ↑ どこにもないので、ルーチンの「変更を git push」できない

❌ 管理外
   worker-v2 / quick-lane / stuck-detector / diagram-injector / step2/3/4
   = 6 ルーチン分のプロンプト合計 ~50KB
```

つまり：
1. ルーチンが「変更したい」と思っても、push 先 repo が無い
2. レビューしたくてもプロンプトが取れない（Claude Code から手動コピペ）
3. 私が今やったように、「ルーチンが想定する theme JS」が存在しなくても気付けない

---

## 5. 推奨アクション（3 段階）

### 段階 1: 緊急（即時できる）

1. **本物の routine prompt 9 本をすべて git 管理に入れる**
   - `joseikininsight-hue/grant-pipeline-bot` の routines/ に
     `worker-v2.md` / `quick-lane.md` / `stuck-detector.md` / `diagram-injector.md`
     `step2-headcontent.md` / `step3-tailcontent.md` / `step4-evaluate-publish.md` 追加
   - 既存の `worker.md` は `worker.legacy.md` にリネーム

2. **Claude Code routine の「リポジトリ」設定を修正**
   - 9 ルーチン全てを `joseikininsight-hue/grant-pipeline-bot` を参照するように
   - 現在は `git`（存在しない）を指している

3. **routine ⇄ theme の契約書を両 repo に置く**
   - 既に `Grant-Insight-Perfect-new/docs/routine-widget-contract.md` を作成済み
   - `grant-pipeline-bot/docs/widget-contract.md` にコピー

### 段階 2: 中期（数日）

4. **ルーチン専用 monorepo の新設**
   - 例: `joseikininsight-hue/grant-pipeline-routines` (NEW)
   - 9 ルーチンを 9 ファイルで管理
   - PR 必須で変更履歴が残る
   - CI で「テンプレ kind がすべて theme 側に実装されているか」検証

5. **axis-validator のコードもどこかの repo に**
   - 現状 xserver の `wp-json/gisg/v1/grant-publish` 内（`inc/grant-pipeline-rest.php` あたり?）
   - `Grant-Insight-Perfect-new/inc/` に確認のうえ整理

### 段階 3: 長期（リファクタ）

6. **3 repo 統合 or モノレポ化**
   - 現状: theme + pipeline-bot + routine prompts = 3 つ別管理
   - 統合: 1 つに集約してデプロイで分岐

7. **「ルーチンを変えると theme 側にも JS / endpoint 追加」が必要なフローを CI で強制**
   - 上記契約書 + CI ガードで再発防止

---

## 6. 即実行できるサマリ

`~/Desktop/joseikin-routines/` に全 9 ルーチンの完全な内容を保存済み（このフォルダ）：

```
00-ANALYSIS-REPORT.md          ← この文書
01-diagram-injector.md
02-quick-lane.md
03-worker-v2.json              ← 23KB の本体
04-stuck-detector.json
05-step4-evaluate-publish.json
06-step3-tailcontent.json
07-step2-headcontent.json
08-night-batch.json
09-morning-batch.json
```

これらを git にコミットすれば、**プロンプトの差分レビューが可能になる**。

---

## 7. 次にやるべき優先順位（提案）

| 優先 | 作業 | 所要 | 効果 |
|:---:|---|---|---|
| ★★★ | grant-pipeline-bot に 9 routine prompt をコミット | 30 分 | 全プロンプトが版管理下に |
| ★★★ | Claude Code 側で routine の「リポジトリ」を grant-pipeline-bot に修正 | 5 分 | 「存在しない git repo」表示解消 |
| ★★ | routine ↔ theme の契約書を両 repo に置く | 15 分 | 契約の単一情報源化 |
| ★★ | axis-validator のソース所在を特定 → 整理 | 30 分 | 評価ロジックの透明化 |
| ★ | CI で widget kind ↔ theme JS の整合性チェック | 1-2 時間 | 再発防止の機械化 |
| ★ | 9 routine の prompt をプライベートで動作確認（sandbox） | 数時間 | 本番影響なくテスト |

最後の「プライベートで完全に動かす」は段階 2 にあたります。先に段階 1（プロンプトを版管理下に持ってくる）を完了させるのが必須前提です。
