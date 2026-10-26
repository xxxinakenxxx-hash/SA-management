# 【AIメモSA管理】DB設計書

作成日：2026-10-20  
文書状態：初稿・承認前（物理シート未作成）  
初期導入：鹿児島営業所、将来は複数営業所

## 1. 目的・参照資料・前提

本書はAIメモSA管理の依頼・担当・質疑・添付・通知・履歴に必要なデータ構造を定める**設計案**である。業務要件は「【AIメモSA管理】要件定義書.md」FR-01〜20、NFR-01〜12、技術的制約は「【AIメモSA管理】技術設計書.md」を参照。両者とも未承認。現行`deal_records`の実際の列と保存形式は2026-10-20に照合済みで、§4.1補足に反映した。新SA管理側の物理シートは未作成。

保存方針：業務データはGoogle Sheets、添付実体はGoogle Drive。既存の営業AIメモの商談記録を原則更新せず、SA管理側に必要な情報を別に管理する。以下の**物理シート名・列名・型は実装のための提案であり未承認**。実際の列追加・既存シート改修・初期化は本書作成の対象外。

## 2. 設計原則

- 全依頼を「営業所ID」と「依頼者ID」で分類。初期導入が鹿児島でも鹿児島固定値をコード・DB定義に埋め込まない。
- 営業担当者は鹿児島のSA依頼全件を閲覧し、自分の依頼で絞り込める。投稿は原則本人依頼のみとし、添付は別途認可する。SA担当者は共通一覧を利用し、担当変更に管理者承認を要しない。Sheetsの行取得・更新時にサーバー側で適切に認可する。
- IDは一意・不変。関連テーブルは内部`request_id`を参照する。既存元レコードIDは別に保持して重複取込を防止。
- SheetsにはDB固有の一意制約・トランザクションがないため、書込時の重複・排他・復旧設計をAPI側に置く。
- 監査履歴は追記型。記録済みの発言・担当変更・操作履歴を安易に破棄・置換しない。
- 個人情報・依頼本文・ファイルの実データ・利用者マスターを公開GitHubへ保存しない。

## 3. シート構成案

| 論理名 | 物理シート名（案） | 主キー（案） | 役割 |
| --- | --- | --- | --- |
| 依頼 | `sa_requests` | `request_id` | 元依頼、営業所、担当、状態、完了内容 |
| スレッド | `sa_messages` | `message_id` | 1依頼に紐づく質問・回答・通常連絡・訂正投稿・成果物リンク |
| 添付 | `sa_attachments` | `attachment_id` | Drive成果物の参照・返却対象 |
| 操作履歴 | `sa_activity_log` | `event_id` | 変更前後と操作時刻 |
| 通知 | `sa_notifications` | `notification_id` | 配信キューと再試行状態 |
| 既読位置 | `sa_read_cursors` | `cursor_id` | 利用者別・依頼別の閲覧位置（方式候補） |
| 取込実行履歴 | `sa_import_log` | `import_event_id` | 取込成否・失敗再試行（方式候補） |

ユーザー・営業所は既存マスター活用を優先。複製マスターの作成要否、参照方法、ID体系は現行実装照合後に決定する。

## 4. 列定義案

記法：文字列＝String、日時＝ISO8601表現またはSheets日時（統一方法未決定）、真偽＝Boolean、整数＝Integer。空欄可否・最大長は後続詳細設計で確定。「必須」は論理的に必要という意味であり、既存実装済みではない。

### 4.1 `sa_requests`

| 列名（案） | 型 | 意味・制約案 |
| --- | --- | --- |
| `request_id` | String | 主キー、不変 |
| `source_system` | String | 既存「営業AIメモ」を示す識別子 |
| `source_record_id` | String | 元依頼の一意識別子。重複判定キーの候補 |
| `branch_id` | String | 依頼の所属営業所。必須 |
| `sales_user_id` | String | 依頼した営業本人。必須 |
| `title` | String | 依頼タイトル。既存分類の「SA依頼｜内容」を想定 |
| `body` | String | 依頼本文 |
| `customer_ref` | String | 顧客参照。元データに存在する場合のみ、未確定 |
| `assigned_sa_user_id` | String | 現担当者。未担当なら空 |
| `status` | String | `unassigned/in_progress/waiting_sales/completed`の4値案 |
| `completion_comment` | String | 完了返却コメント |
| `source_recorded_at` | DateTime | 元記録日時 |
| `created_at` | DateTime | 取込・受付日時 |
| `updated_at` | DateTime | 最終更新日時 |
| `completed_at` | DateTime | 完了日時 |
| `row_version` | Integer | 排他・競合検知用バージョン候補 |

上記状態コードは**内部値の案**。表示名称は「未担当／対応中／営業回答待ち／完了」。元レコードIDの一意性が営業所・元システム内のどの範囲で保証されるかを調査して複合キーを確定する。

### 4.1補足 現行実DBとの列対応・AI構造化（2026-10-20改訂）

| 現行 `deal_records` 列 | 新 `sa_requests` 列（追加案を含む） | 用途 |
| --- | --- | --- |
| `record_id` | `source_record_id` | 元IDを保持して重複取込を防止 |
| `deal_theme` | `title`, `source_deal_theme` | 「SA依頼｜」で識別し原題を保持 |
| `original_text` | `source_original_text` | 元の文章を保持してAI構造化に利用 |
| `deal_content` | `source_deal_content` | 補助資料。原文を置き換えない |
| `user_key` | `sales_user_id`, `source_user_key` | 依頼者の対応 |
| `branch_name` | `branch_id`, `source_branch_name` | 鹿児島所属をマスター照合して判定 |
| `created_at` | `source_recorded_at` | 元記録日時 |

**新システム側で構造化して保存する追加列案**：`sa_recipient`（誰に）、`sa_action`（何を）、`sa_request_type`（依頼の種類）、`sa_fixed_conditions`（決まっていること）、`sa_due_date_text`（いつまで）、`extraction_status`、`extracted_at`。期限の原文表現は文字列で保持する。列順・型の最終承認は未了。

現行DBには`sa_case`・`record_type`の独立列やSA専用5項目の独立列はない。ただしSA依頼情報は`deal_theme`・`original_text`等に文章として残っており、独立列がないことを内容欠落と同一視しない。新システムがAIで5項目へ構造化し、抽出できない項目は未確認とする。元DBは変更しない。

初期取込対象は鹿児島の「SA依頼｜」レコード。旧「SA案件」の他拠点・過去データの移行は対象外。営業所の照合、読取権限、AI解析結果の実データ検証は未了。

### 4.1正式列への統合方針

§4.1補足の`source_deal_theme`、`source_original_text`、`source_deal_content`、`source_user_key`、`source_branch_name`と、`sa_recipient`、`sa_action`、`sa_request_type`、`sa_fixed_conditions`、`sa_due_date_text`、`extraction_status`、`extracted_at`は**同じ`sa_requests`に保持する設計対象列**であり、別表や既存元DBの列を意味しない。型は原文・抽出5項目・抽出状態をString、`extracted_at`をDateTimeとする。空欄・値長・期限正規化等はSA-U-02／SA-U-10に従って確定する。

### 4.2 `sa_messages`

| 列名（案） | 型 | 意味・制約案 |
| --- | --- | --- |
| `message_id` | String | 主キー |
| `request_id` | String | 所属依頼ID、必須 |
| `sender_user_id` | String | 投稿者ID、必須 |
| `sender_role` | String | 投稿時の役割（監査用） |
| `message_type` | String | 質問・回答・通常投稿・訂正投稿・添付リンク案。実際の列挙値はAPI設計で定義 |
| `body` | String | 投稿本文、必須 |
| `created_at` | DateTime | サーバー採番日時 |
| `client_operation_id` | String | 再送時の二重投稿防止候補 |

公開されるメッセージにユーザーが任意の`sender_user_id`を指定できないようにする。

### 4.3 `sa_attachments`

| 列名（案） | 型 | 意味・制約案 |
| --- | --- | --- |
| `attachment_id` | String | 主キー |
| `request_id` | String | 所属依頼ID、必須 |
| `drive_file_id` | String | Drive実ファイルID。外部公開URLではない |
| `file_name` | String | 表示名 |
| `mime_type` | String | ファイル形式 |
| `file_size` | Integer | ファイルバイト数 |
| `uploaded_by_user_id` | String | 登録したSA |
| `is_returned_to_sales` | Boolean | 営業への返却対象か |
| `created_at` | DateTime | 登録日時 |
| `file_version` | Integer | 差替え履歴の管理候補、詳細未決定 |

営業所ごとに管理設定されたGoogle Driveフォルダ（鹿児島は既存Drive配下）へ保存し、成功時に取得したファイルID・リンクを当該依頼スレッドと紐づける。添付がない依頼も完了可能。添付実体への権限はDriveとアプリ側で検証。返却対象フラグのみで無制限共有しない。

### 4.4 `sa_activity_log`

| 列名（案） | 型 | 意味・制約案 |
| --- | --- | --- |
| `event_id` | String | 主キー |
| `request_id` | String | 対象依頼 |
| `actor_user_id` | String | 操作者 |
| `event_type` | String | 受付・引受・担当変更・状態変更・質問・回答・成果物・完了等 |
| `before_value` | String | 変更前の必要最小限の値 |
| `after_value` | String | 変更後の必要最小限の値 |
| `created_at` | DateTime | 操作日時 |

機密情報を無制限にbefore/afterへ複写しない。履歴の訂正・削除は営業AIメモの既存基準を適用し、SA独自保存期限は設けない。

### 4.5 `sa_notifications`

| 列名（案） | 型 | 意味・制約案 |
| --- | --- | --- |
| `notification_id` | String | 主キー |
| `request_id` | String | 対象依頼 |
| `recipient_user_id` | String | 受信者 |
| `event_type` | String | 新規依頼・営業質問・営業回答・完了など |
| `channel` | String | メール、Push等。方式未確定 |
| `delivery_status` | String | `pending/sent/failed`等の候補 |
| `attempt_count` | Integer | 試行回数 |
| `next_retry_at` | DateTime | 次回試行予定 |
| `sent_at` | DateTime | 成功と判断した日時 |
| `last_error_code` | String | 個人情報を含まない失敗識別情報 |
| `created_at` | DateTime | 作成日時 |

業務データ保存の成否と通知送信の成否は分離する。配信方式確定前に`sent`の意味（受理・配送・開封）を決めない。

### 4.6 `sa_read_cursors`／`sa_import_log`（候補）

- `sa_read_cursors`：`cursor_id`、`request_id`、`user_id`、`last_read_message_id`、`read_at`。個人別未読表示を実現する設計候補。
- `sa_import_log`：`import_event_id`、`source_record_id`、`result`、`error_code`、`processed_at`。元依頼との二重取込防止と再試行監査用の候補。
- これらの採否、列の型・形式・対象行数はAPI設計と検証結果に合わせて確定する。

## 5. 論理関係

```text
[既存 営業AIメモ元依頼]
     source_record_id
          │（取込・重複排除）
          ▼
sa_requests (request_id, branch_id, sales_user_id, assigned_sa_user_id)
    ├─ 1:N sa_messages
    ├─ 1:N sa_attachments  ── drive_file_id → Google Drive
    ├─ 1:N sa_activity_log
    ├─ 1:N sa_notifications
    └─ 1:N sa_read_cursors（採用時）
```

`branch_id`と`sales_user_id`は既存マスターの信頼できる識別子へ結合する。利用者の所属変更に伴う過去依頼の扱いは要確認。

## 6. 作成・更新・削除ルール

| 対象 | 操作 | 基本ルール |
| --- | --- | --- |
| 元営業AIメモ | 参照 | 原則読取のみ。元シートの修正は禁止 |
| 依頼 | 新規登録 | 元IDを確認して冪等取込、初期状態「未担当」 |
| 依頼 | 更新 | 認証・権限・遷移・排他を確認後、指定列だけ更新 |
| メッセージ | 新規追記 | 送信済みの元投稿は保持し、訂正は別メッセージを追記。質問・回答・訂正の投稿はカード状態を変更しない。状態変更はカードの明示操作のみ |
| 添付 | 新規関連付け | Drive保存成功、権限確認、参照ID登録 |
| 操作履歴 | 追記 | 過去イベントを無断削除・書換しない |
| 通知 | キュー更新 | SA向け新着は画面起動中の表示。SA質問・完了の営業宛Google Chatは送信状態を別管理し、スレッド上の業務状態をChat配送結果に連動させない |
| 既存データ | 物理更新 | 承認済み移行計画なしに全件上書き、シート削除・作り直しをしない |

同時引受・担当変更はロックや行バージョン照合で整合性確保を検討。複数Sheetsへの処理が途中失敗した場合の検知・修復手順を実装設計で確定する。

## 7. 認証・個人情報・バックアップ

- APIは呼出者の認証済みIDから権限を決める。営業所をリクエスト値だけで信用しない。
- 業務データ・顧客名・営業担当者の個人情報をGitHub Pagesや公開リポジトリに格納しない。
- Sheetsの共有権限は最小化し、Drive成果物は承認された閲覧対象だけがアクセスできるようにする。営業の全案件閲覧と個別添付のアクセス権は区別する。
- Sheets・Driveのバックアップを営業AIメモと同じ基準で設計し、SA独自の保存期限・自動削除を新設しない。
- 開発・検証・本番のデータを分離する。テスト用ダミーデータと実顧客データを混用しない。

### 7.1 2026-10-23の連携設計・未承認条件

SA依頼の連携用ID列だけを新SA側へリンクする構成を優先検証する。新SAの業務レコードにはSA依頼だけを登録し、元`record_id`で重複を防ぎ、関連列は必要時に参照する。元DBへの列追加の必要性、関数連携速度、後続処理は実環境または隔離試験で確定する。**今回、元DBに列を追加したものではない。** 5項目のAI抽出については、外部送信範囲・使用AI・費用が承認されるまで外部通信・課金を行わない。

## 8. 未確定事項・確認事項

1. `deal_records`の対象列と「SA依頼｜」保存形式は確認済み。残件は読取権限・元IDの一意範囲・マスター照合（SA-U-01／SA-U-03）。
2. 利用者マスター・営業所マスターの物理名、キー、所属・権限照合方法。
3. 正式な各シート名、列順、必須/任意、型、文字数、採番規則。
4. 元IDの一意範囲、再取込時の更新許可範囲。
5. 状態遷移、担当変更、完了後再開、添付差替えの運用条件。
6. 既読管理方式、通知チャンネル、配信失敗時の回復方法。
7. ファイル形式・容量、保持期間、バックアップ、利用規模、性能。
8. 他営業所のデータ分離、拠点異動・兼務時の扱い。

## 9. 確認条件と変更管理

- 実シートは**未作成**、実データ移行・認可・同時実行試験は**未実施**。
- 正式なDB仕様として承認する前に、現行営業AIメモのDB/マスターと照合し、API・内部関数設計書とキー・状態・権限の整合を確認する。
- 本書の今後の修正は同一ファイルを編集し、変更履歴をコミットとCHAT_CURRENTに残す。既存ファイル削除・再作成・上書き保存は禁止。


## 2026-10-26 確定方針
- カードと連絡スレッドは別系統。スレッド投稿・返信・訂正・Google Chat通知ではカード進捗を自動変更しない。状態はカード側の明示的操作で変更する。
- 完了状態から再び対応中等へ戻れる。完了に不可逆制約を与えない。添付0件で完了可能。
- 「今週中」「今週末」「来週中」「○曜日まで」「今日中」「明日まで」は依頼基準日のカレンダー日付として解釈。「なるべく早く」は至急として扱い架空の日付は設定しない。原文保持・解釈結果の訂正を可能とする。
- 担当別は一覧の担当者選択で切替、営業所別Drive設定は営業所ごとの設定値で管理。独立した担当別・設定画面は新設しない。備考は完了コメントと別の業務メモとして保存・再表示。期限は一覧表示・絞込・注意表示とし、期限接近の自動通知を追加しない。独立したダッシュボードを新設せず既存KPIを利用する。
- 営業AIメモと同じ管理・保存基準を適用。SA専用の管理責任者制度・管理ロール・独自保存期限・自動削除を新設しない。バックアップや権限制御は既存基準に沿って設計する。
- 上記は仕様方針の確定であり、実装・実通信・実機試験の完了ではない。

## 2026-10-26 追加確定方針（SA-003・SA-020）
- **SA-003：既存社員・営業所マスターは営業AIメモ側を直接参照するB案を採用。** SA管理DBへマスターを複製・同期しない。既存マスターの参照権限・キー・安全な接続方法は実装前に技術確認する。
- **SA-020：AIによる5項目抽出にOpenAI APIを採用するB案を確定。** Gemini等との選定比較をユーザーに再要求しない。具体的なOpenAIモデル、送信対象の顧客情報、データ取扱い、料金見積り、認証と失敗時処理を設計・検証する。**OpenAI APIの採用決定は、実データの外部送信・課金開始・APIキー利用の許可ではない。**
