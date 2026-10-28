# 【AIメモSA管理】DB設計書

作成日：2026-10-20  
文書状態：業務方針確定・技術検証済み（工程00、2026-10-28）・実装未着手（物理シート未作成）  
初期導入：鹿児島営業所、将来は複数営業所

## 1. 目的・参照資料・前提

本書はAIメモSA管理の確定済み業務方針に基づき依頼・担当・質疑・添付・通知・履歴に必要なデータ構造を定める設計正本である。業務要件は「【AIメモSA管理】要件定義書.md」FR-01〜25、NFR-01〜12、技術的制約は「【AIメモSA管理】技術設計書.md」を参照。業務方針は確定済み。実装と技術検証は未完了。現行`deal_records`の実際の列と保存形式は2026-10-20に照合済みで、§4.1補足に反映した。新SA管理側の物理シートは未作成。

保存方針：業務データはGoogle Sheets、添付実体はGoogle Drive。既存の営業AIメモの商談記録を原則更新せず、SA管理側に必要な情報を別に管理する。以下は確定済みの機能要件を実現する設計上の列・型。実シートへの反映・現行接続の検証は未実施。実際の列追加・既存シート改修・初期化は本書作成の対象外。

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

社員・営業所マスターは営業AIメモの既存マスターを直接参照する。SA管理DBへ複製・同期しない。参照キーは `user_master.user_key`（本人）と `master_branch_name`（所属。営業所名の文字列）。営業AIの表はSheets API読み取り専用（`spreadsheets.readonly`）で参照する。本人は `Session.getActiveUser().getEmail()` と `user_key` の照合で判定し、`active_flag` が「有効」の利用者だけを許可する（SA＝`sales_support`、営業＝`sales`）。

## 4. 列定義案

記法：String＝文字列、DateTime＝ISO 8601（JSTの時差付き文字列で保存）、Date＝`yyyy-MM-dd`、Boolean＝真偽値、Integer＝整数。列順は既存シート内の記載順を基本とし、実作成時の列位置を確定する。「必須」は論理的に必要という意味であり、既存実装済みではない。

### 4.1 `sa_requests`

| 列名（案） | 型 | 意味・制約案 |
| --- | --- | --- |
| `request_id` | String | 主キー、不変 |
| `source_system` | String | 既存「営業AIメモ」を示す識別子 |
| `source_record_id` | String | 元依頼ID。source_systemと複合で一意、重複取込防止に使用 |
| `branch_id` | String | 依頼の所属営業所。必須 |
| `sales_user_id` | String | 依頼した営業本人。必須 |
| `title` | String | 依頼タイトル。既存分類の「SA依頼｜内容」を想定 |
| `body` | String | 依頼本文 |
| `customer_ref` | String | 顧客参照。元データに存在する場合のみ、未確定 |
| `assigned_sa_user_id` | String | 現担当者。未担当なら空 |
| `status` | String | `unassigned/in_progress/waiting_sales/completed`の4値。完了はAPI-11のみ |
| `completion_comment` | String | 完了返却コメント |
| `source_recorded_at` | DateTime | 元記録日時 |
| `created_at` | DateTime | 取込・受付日時 |
| `updated_at` | DateTime | 最終更新日時 |
| `completed_at` | DateTime | 完了日時 |
| `row_version` | Integer | 必須。初期1、依頼更新ごとに+1。LockServiceによる排他中に期待版と一致する場合のみ更新 |
| `source_deal_theme` | String | 元のSA依頼件名（コピーは取込時の監査用スナップショット。元DBは参照元） |
| `source_original_text` | String | 元依頼原文の取込時スナップショット（保持）。元データはrecord_idで必要時参照 |
| `source_deal_content` | String/null | 元の補助テキスト。存在する場合のみ保持 |
| `source_user_key` | String | 元レコードの依頼者キー |
| `source_branch_name` | String | 元レコード所属名（`deal_records.branch_name`）。`branch_id` は営業所名の文字列 |
| `sa_recipient` | String/null | OpenAI抽出：誰に。判断不能はnull |
| `sa_action` | String/null | OpenAI抽出：何を。判断不能はnull |
| `sa_request_type` | String/null | OpenAI抽出：依頼の種類 |
| `sa_fixed_conditions` | String/null | OpenAI抽出：決まっていること |
| `sa_due_date_text` | String/null | OpenAI抽出の期限表現。上書き訂正後も元文章はsource_original_textに保持 |
| `sa_due_date` | Date/null | 依頼日時を基準に解析・訂正された期限の日付。解釈不能ならnull |
| `sa_due_urgent` | Boolean | `なるべく早く`等はtrue。根拠のない日付は付けない |
| `sa_due_date_updated_by` | String/null | 期限を手動訂正したSAのID |
| `sa_due_date_updated_at` | DateTime/null | 期限の手動訂正日時 |
| `sa_note` | String/null | SAの備考。完了コメントとは独立 |
| `extraction_status` | String | `pending/complete/needs_review/failed` |
| `extracted_at` | DateTime/null | 抽出完了時刻。外部API未許可の場合はnull |

上記状態コードは内部保存値として採用。表示名称は「未担当／対応中／営業回答待ち／完了」。元レコードIDの一意性が営業所・元システム内のどの範囲で保証されるかを調査して複合キーを確定する。

### 4.1補足 現行実DBとの列対応・AI構造化（2026-10-20改訂）

| 現行 `deal_records` 列 | 新 `sa_requests` 列（追加案を含む） | 用途 |
| --- | --- | --- |
| `record_id` | `source_record_id` | 元IDを保持して重複取込を防止 |
| `deal_theme` | `title`, `source_deal_theme` | 「SA依頼｜」で識別し原題を保持 |
| `original_text` | `source_original_text` | 元の文章を保持してAI構造化に利用 |
| `deal_content` | `source_deal_content` | 補助資料。原文を置き換えない |
| `user_key` | `sales_user_id`, `source_user_key` | 依頼者の対応 |
| `branch_name` | `branch_id`, `source_branch_name` | 営業所名の文字列で判定（`branch_id` は営業所名。利用者は `user_master.master_branch_name`、依頼は `deal_records.branch_name`） |
| `created_at` | `source_recorded_at` | 元記録日時 |

抽出5項目・期限の解釈値・抽出状態は§4.1の正式列へ統合済み。元文章を保持し、欠落した値はnullとする。抽出は営業AIと同じ gpt-4o-mini、キーはスクリプトプロパティ AI_API_KEY、UrlFetchApp で呼ぶ。5項目はJSONスキーマで受け取り、返りの文字列「null」は取込時に null へ正規化する。4xx は再試行せず、429・5xx のみ待ち時間を倍にして最大3回再試行する。本物の依頼文の送信は1件ずつユーザー許可を得る。

現行DBには`sa_case`・`record_type`の独立列やSA専用5項目の独立列はない。ただしSA依頼情報は`deal_theme`・`original_text`等に文章として残っており、独立列がないことを内容欠落と同一視しない。新システムがAIで5項目へ構造化し、抽出できない項目は未確認とする。元DBは変更しない。

初期取込対象は鹿児島の「SA依頼｜」レコード。旧「SA案件」の他拠点・過去データの移行は対象外。AI解析結果の実データ検証は工程05で確認する。

元データの取込では`source_record_id`のみを連携・重複識別の軸とし、元列は権限付き参照から必要分だけ取り込み時点のスナップショットとして保存する。新DBは非SA商談の全文コピーではなく、SA依頼のみを保存する。元データの更新・複製マスターは行わない。元ID読取の実通信は工程00で確認済み（Sheets API読み取り専用）。

### 4.2 `sa_messages`

| 列名（案） | 型 | 意味・制約案 |
| --- | --- | --- |
| `message_id` | String | 主キー |
| `request_id` | String | 所属依頼ID、必須 |
| `sender_user_id` | String | 投稿者ID、必須 |
| `sender_role` | String | 投稿時の役割（監査用） |
| `message_type` | String | `question/sales_reply/normal/correction/attachment_link`の列挙。カード状態は変えない |
| `body` | String | 投稿本文、必須 |
| `created_at` | DateTime | サーバー採番日時 |
| `client_operation_id` | String | 投稿者ごとに一意。再送は同じmessage_idを返す |
| `corrects_message_id` | String/null | 訂正対象。元投稿は残し同じrequest_idの範囲で検証 |
| `attachment_id` | String/null | 成果物リンク投稿の場合は同一依頼の添付IDを参照 |

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
| `file_version` | Integer | 初期1、差替えは旧行を残し新attachment_idに版を追加 |
| `thread_message_id` | String/null | 対応する添付リンク投稿のmessage_id。request_id一致を必須とする |

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
| `channel` | String | `google_chat`（SA質問・完了時の営業への通知。営業AIと同じWebhook＝部屋への通知で、本人宛ての個別送信は行わない）。SA新着は画面起動中の表示（3秒ごとの問い合わせ）で扱い、閉アプリPushやメール配送は行わない |
| `delivery_status` | String | `pending/sent/failed`。`sent`はGoogle Chat Webhookの受理（HTTP 2xx）を示し、営業の開封を意味しない |
| `attempt_count` | Integer | 試行回数 |
| `next_retry_at` | DateTime | 次回試行予定 |
| `sent_at` | DateTime | 成功と判断した日時 |
| `last_error_code` | String | 個人情報を含まない失敗識別情報 |
| `created_at` | DateTime | 作成日時 |

業務データ保存の成否と通知送信の成否は分離する。送信結果は`sa_notifications`に記録し、配送結果で依頼状態を変えない。`sent`はWebhookの受理を示し、配送・開封は意味しない。

### 4.6 `sa_read_cursors`／`sa_import_log`（候補）

- `sa_read_cursors`：`cursor_id`、`request_id`、`user_id`、`last_read_message_id`（null可）、`read_at`（null可）、`sort_order`（整数・null可）、`sort_version`（初期1）。同一`user_id × request_id`を一意にし、未読とSA本人別の並び順を同じ7シート内に保存する。他SAの順序を書き換えない。
- `sa_import_log`：`import_event_id`、`source_record_id`、`result`、`error_code`、`processed_at`。元依頼との二重取込防止と再試行監査用の候補。
- これらの採否、列の型・形式・対象行数はAPI設計と検証結果に合わせて確定する。

### 4.7 既定機能の保存先と更新規則

- **SA備考・期限**：`sa_requests.sa_note`、`sa_due_date_text`、`sa_due_date`、`sa_due_urgent`に保存。期限手動訂正は原文スナップショットを維持し、訂正者・日時・監査履歴を記録する。
- **本人別並び順**：7シート内の`sa_read_cursors`に`user_id × request_id`を一意キーとして`sort_order`を格納。新規依頼は末尾へ、並び順未設定なら受付日時とrequest_id順。操作した本人の行だけロック下で並べ直し、他のSAの設定は不変。担当・状態は`sa_requests`にある共有値を使う。
- **営業所別Drive保存先**：7シートの外に新しい管理シートを増やさず、**SA管理GASのScript Properties**へ`SA_DRIVE_FOLDER_<branch_id>`のキーで既存DriveフォルダIDを設定する。これは利用者マスターの複製ではなく、営業所別のアプリ設定値。既存の運用権限で設定・更新し、独立管理画面とSA管理者ロールは追加しない。未設定・到達不能・権限不足ならファイル登録を拒否し、既存の設定値を勝手に補完しない。設定変更は日時・変更者・対象営業所を運用記録に残す。設定・変更は管理者（ユーザー本人）がGASのスクリプトプロパティで行い、`tasks/CHAT_CURRENT.md` に記録する。
- **排他と復旧**：依頼更新は`LockService.getScriptLock`下で`row_version`を検証する。複数セルの書き込みの途中で失敗した場合は、巻き戻し（補償）で整合に戻す。メッセージと通知は操作IDで再実行を冪等化。Drive保存成功後にSheets登録が失敗した場合は対応するIDを失敗ログに記録し、孤立ファイルを追跡して復旧する。通知送信の成否で依頼状態は変更しない。

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

同時引受・担当変更は`LockService.getScriptLock`＋`row_version`で整合性を確保する。複数Sheetsへの処理や複数セルの書き込みが途中で失敗した場合は、巻き戻し（補償）で整合に戻す（§4.7）。

## 7. 認証・個人情報・バックアップ

- APIは呼出者の認証済みIDから権限を決める。営業所をリクエスト値だけで信用しない。
- 業務データ・顧客名・営業担当者の個人情報をGitHub Pagesや公開リポジトリに格納しない。
- Sheetsの共有権限は最小化し、Drive成果物は承認された閲覧対象だけがアクセスできるようにする。営業の全案件閲覧と個別添付のアクセス権は区別する。
- Sheets・Driveのバックアップを営業AIメモと同じ基準で設計し、SA独自の保存期限・自動削除を新設しない。
- 開発・検証・本番のデータを分離する。テスト用ダミーデータと実顧客データを混用しない。

### 7.1 2026-10-23の連携設計・未承認条件

取込は`record_id`を鍵に、ロック内で既存確認→追加する（冪等）。新SAの業務レコードにはSA依頼だけを登録し、元列は取込時のスナップショットとして`sa_requests`に保存する。実行は5分ごとの時間主導トリガー（設計側の初期値）。**元DBに列は追加しない。** 5項目のAI抽出は営業AIと同じ gpt-4o-mini、キーはスクリプトプロパティ AI_API_KEY、UrlFetchApp で呼ぶ。5項目はJSONスキーマで受け取り、返りの文字列「null」は取込時に null へ正規化する。4xx は再試行せず、429・5xx のみ待ち時間を倍にして最大3回再試行する。本物の依頼文の送信は1件ずつユーザー許可を得る。

## 8. 未確定事項・確認事項

1. 確認済み（工程00）：`deal_records`の対象列と「SA依頼｜」保存形式。読取はSheets API読み取り専用。`record_id`は全体・SA行とも重複0件。所属の照合は営業所名の文字列で行う。
2. 確定済み：`user_master`の列は`user_key`、`user_fullname`、`master_branch_name`、`active_flag`、`role`、`chat_id`、`company_name`。本人は`user_key`、所属は`master_branch_name`、権限は`role`（SA＝`sales_support`、営業＝`sales`）で判定し、`active_flag`が「有効」のみ許可する。`branch_master`は空のため使わない。
3. 7シートの名称・主要列は本文で定義済み。実シートの列順・文字数上限・初期データは実装前の照合対象。
4. 元IDの一意範囲、再取込時の更新許可範囲。
5. カード側の明示的な状態変更、担当変更時の競合、完了後再開、添付差替えの詳細処理。スレッド投稿からの自動状態変更はしない。
6. 既読・本人別表示順はsa_read_cursorsに保存する。営業通知はGoogle Chat Webhook方式で確定（本人宛ての個別送信は行わない）。未検証は実送信と配送失敗時の回復方法（工程03）。
7. ファイル形式・容量、既存営業AIメモ基準によるバックアップ、利用規模、性能。SA独自保存期限は設定しない。
8. 他営業所のデータ分離、拠点異動・兼務時の扱い。

## 9. 確認条件と変更管理

- 実シートは**未作成**、実データ移行・認可・同時実行試験は**未実施**。
- 正式なDB仕様として承認する前に、現行営業AIメモのDB/マスターと照合し、API・内部関数設計書とキー・状態・権限の整合を確認する。
- 本書の今後の修正は同一ファイルを編集し、変更履歴をコミットとCHAT_CURRENTに残す。既存ファイル削除・再作成・上書き保存は禁止。
