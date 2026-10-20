# TASK_CURRENT

実装側（Claude Code）の現在地・変更履歴・確認結果です。仕様の正本ではありません。

## 現在地

| 項目 | 状態 |
| --- | --- |
| HTMLモック | 作成済み・採用済み（`index.html`、`app.js`、`styles.css`、`design-qa.md`） |
| 共通規約2文書 | mainへ反映済み（PR #1、マージコミット `b8a821f`） |
| 管理ファイル | README.md、AGENTS.md、CLAUDE.md、本ファイルを作成（2026-10-20） |
| `tasks/CHAT_CURRENT.md` | 未作成（ChatGPT担当） |
| `docs/正本/` | 未作成 |
| 基本設計 | 未着手 |
| 業務機能実装 | 未着手 |

## 変更履歴

### 2026-10-20 リポジトリ初期整備

- ブランチ：`claude/sleepy-gauss-pki7qr`
- Git操作：`git fetch origin` → `git merge --ff-only origin/main`（`9a94061` → `b8a821f`）
- 確認した共通規約（main `b8a821f` 時点、本文全文）
  - `ルールブック.md`（blob `c46f605`）
  - `GitHubリポジトリ標準規約.md`（blob `9bd1de8`）
- 新規作成：`README.md`、`AGENTS.md`、`CLAUDE.md`、`tasks/TASK_CURRENT.md`
- 変更しない範囲：HTMLモック4ファイル、共通規約2文書、GitHub Pages設定、外部サービス
- 確認結果
  - 作成した4ファイルの内容・参照先・差分を確認
  - HTMLモック4ファイルと共通規約2文書に差分がないことを `git diff` で確認
  - CLAUDE.mdの `@` 参照（日本語ファイル名）が実際に読み込まれるか：未検証
  - GitHub Pagesの公開表示：未確認（作業環境から公開URLへ接続できないため）

## 残件

- CLAUDE.mdの `@` 参照の読込確認（新しいセッションで `/context` を確認）
- 公開URLでのHTMLモック表示確認
- `tasks/CHAT_CURRENT.md` の作成（ChatGPT担当）
- `docs/正本/` の作成と未確定事項（認証・接続方式・通知・DB詳細・API・本番公開方法）の決定

## 次工程

指示側（ChatGPT・ユーザー）の判断待ち。
