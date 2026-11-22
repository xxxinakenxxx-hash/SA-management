// DB9表の定義と初期化（DB設計書§3〜4.9）。列名・順序は設計書どおり。
// 型：String／DateTime／Date は文字列として保存（書式「@」）。Integer／Boolean は自動書式。
var SA_SCHEMA_ = {
  sa_requests: [
    ['request_id', 'String'], ['source_system', 'String'], ['source_record_id', 'String'], ['branch_id', 'String'],
    ['sales_user_id', 'String'], ['title', 'String'], ['body', 'String'], ['customer_ref', 'String'],
    ['assigned_sa_user_id', 'String'], ['status', 'String'], ['completion_comment', 'String'],
    ['source_recorded_at', 'DateTime'], ['created_at', 'DateTime'], ['updated_at', 'DateTime'], ['completed_at', 'DateTime'],
    ['row_version', 'Integer'], ['source_deal_theme', 'String'], ['source_original_text', 'String'],
    ['source_deal_content', 'String'], ['source_user_key', 'String'], ['source_branch_name', 'String'],
    ['sa_recipient', 'String'], ['sa_action', 'String'], ['sa_request_type', 'String'], ['sa_fixed_conditions', 'String'],
    ['sa_due_date_text', 'String'], ['sa_due_date', 'Date'], ['sa_due_urgent', 'Boolean'],
    ['sa_due_date_updated_by', 'String'], ['sa_due_date_updated_at', 'DateTime'], ['sa_note', 'String'],
    ['extraction_status', 'String'], ['extracted_at', 'DateTime'],
    ['archived_at', 'DateTime'], ['archived_by', 'String']
  ],
  sa_messages: [
    ['message_id', 'String'], ['request_id', 'String'], ['sender_user_id', 'String'], ['sender_role', 'String'],
    ['message_type', 'String'], ['body', 'String'], ['created_at', 'DateTime'], ['client_operation_id', 'String'],
    ['corrects_message_id', 'String'], ['attachment_id', 'String']
  ],
  sa_attachments: [
    ['attachment_id', 'String'], ['request_id', 'String'], ['drive_file_id', 'String'], ['file_name', 'String'],
    ['mime_type', 'String'], ['file_size', 'Integer'], ['uploaded_by_user_id', 'String'], ['is_returned_to_sales', 'Boolean'],
    ['created_at', 'DateTime'], ['file_version', 'Integer'], ['thread_message_id', 'String']
  ],
  sa_activity_log: [
    ['event_id', 'String'], ['request_id', 'String'], ['actor_user_id', 'String'], ['event_type', 'String'],
    ['before_value', 'String'], ['after_value', 'String'], ['created_at', 'DateTime']
  ],
  sa_notifications: [
    ['notification_id', 'String'], ['request_id', 'String'], ['recipient_user_id', 'String'], ['event_type', 'String'],
    ['channel', 'String'], ['delivery_status', 'String'], ['attempt_count', 'Integer'], ['next_retry_at', 'DateTime'],
    ['sent_at', 'DateTime'], ['last_error_code', 'String'], ['created_at', 'DateTime']
  ],
  sa_read_cursors: [
    ['cursor_id', 'String'], ['request_id', 'String'], ['user_id', 'String'], ['last_read_message_id', 'String'],
    ['read_at', 'DateTime'], ['sort_order', 'Integer'], ['sort_version', 'Integer']
  ],
  sa_import_log: [
    ['import_event_id', 'String'], ['source_record_id', 'String'], ['result', 'String'], ['error_code', 'String'],
    ['processed_at', 'DateTime']
  ],
  sa_branch_settings: [
    ['setting_id', 'String'], ['branch_id', 'String'], ['drive_folder_id', 'String'], ['setting_version', 'Integer'],
    ['set_by_user_id', 'String'], ['set_at', 'DateTime']
  ],
  sa_request_folders: [
    ['request_id', 'String'], ['branch_id', 'String'], ['drive_folder_id', 'String'], ['base_setting_id', 'String'],
    ['created_by_user_id', 'String'], ['created_at', 'DateTime']
  ],
  // 定期取込の対象営業所の設定（2026-11-23 追加）。DB9表とは別の設定シートで、initializeSaTables の対象には入れない。
  sa_import_targets: [
    ['branch_name', 'String'], ['import_enabled', 'Boolean']
  ]
};

var SA_TABLE_NAMES_ = ['sa_requests', 'sa_messages', 'sa_attachments', 'sa_activity_log', 'sa_notifications', 'sa_read_cursors', 'sa_import_log', 'sa_branch_settings', 'sa_request_folders'];

function saHeader_(name) {
  return SA_SCHEMA_[name].map(function (c) { return c[0]; });
}

function saColumnIndex_(name) {
  var m = {};
  saHeader_(name).forEach(function (n, i) { m[n] = i; });
  return m;
}

// 1表ぶんの初期化。無ければ作る。有れば見出しが設計書と一致することだけ確認し、中身には触れない。
function ensureTable_(ss, name) {
  var cols = SA_SCHEMA_[name];
  var header = saHeader_(name);
  var sh = ss.getSheetByName(name);
  if (sh) {
    var have = sh.getRange(1, 1, 1, header.length).getValues()[0].map(String);
    for (var i = 0; i < header.length; i++) {
      if (have[i] !== header[i]) throw new Error('SCHEMA_MISMATCH:' + name);
    }
    return 'exists';
  }
  sh = ss.insertSheet(name);
  if (sh.getMaxColumns() < header.length) sh.insertColumnsAfter(sh.getMaxColumns(), header.length - sh.getMaxColumns());
  for (var c = 0; c < cols.length; c++) {
    if (cols[c][1] === 'String' || cols[c][1] === 'DateTime' || cols[c][1] === 'Date') {
      sh.getRange(1, c + 1, sh.getMaxRows(), 1).setNumberFormat('@');
    }
  }
  sh.getRange(1, 1, 1, header.length).setValues([header]);
  return 'created';
}

// DB9表を作る初期化関数。何度実行しても同じ結果（既にある表は作り直さない）。
function initializeSaTables() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('LOCK_TIMEOUT');
  try {
    var created = [], existing = [];
    SA_TABLE_NAMES_.forEach(function (n) {
      (ensureTable_(ss, n) === 'created' ? created : existing).push(n);
    });
    return { created: created, existing: existing };
  } finally {
    lock.releaseLock();
  }
}

// 取込設定シート sa_import_targets の最初の1回だけの用意（定期取込の最初に呼ぶ）。
// シートが無ければ作り、営業AIの user_master にある所属名（master_branch_name）を1行ずつ登録する。
// TRUE にするのは、切替前の取込対象（getImportBranch_。未設定なら鹿児島）だけ。ほかは FALSE。
// 用意が済んだらスクリプトプロパティに印を付け、以後は何もしない（印の後にシートが無くなった場合は、作り直さず設定エラーにする）。
var SA_IMPORT_TARGETS_INIT_PROP_ = 'SA_IMPORT_TARGETS_INIT';

// 営業AIの user_master から、所属名を重複なく、表の上から出てきた順に読む（読み取り専用）。
function readMasterBranchNames_() {
  var res = Sheets.Spreadsheets.Values.get(getSalesDbId_(), "'user_master'");
  var v = res.values || [];
  if (!v.length) throw new Error('MASTER_EMPTY');
  var col = -1;
  v[0].forEach(function (n, i) { if (String(n).trim() === 'master_branch_name') col = i; });
  if (col < 0) throw new Error('MASTER_COLUMN_MISSING:master_branch_name');
  var seen = {}, names = [];
  for (var i = 1; i < v.length; i++) {
    var x = v[i][col];
    var name = String(x === undefined || x === null ? '' : x).trim();
    if (!name || seen[name]) continue;
    seen[name] = true;
    names.push(name);
  }
  return names;
}

function ensureImportTargetsSheet_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(SA_IMPORT_TARGETS_INIT_PROP_) === '1') return 'done';
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('LOCK_TIMEOUT');
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(SA_IMPORT_TARGETS_SHEET_);
    var result = 'exists';
    if (!sh || sh.getLastRow() < 2) {
      // 登録する行を先に決める（決められなければ、シートを作らずに止める）。
      var names = readMasterBranchNames_();
      var current = getImportBranch_();
      if (names.indexOf(current) < 0) throw new Error('IMPORT_TARGETS_SEED_INVALID');
      ensureTable_(ss, SA_IMPORT_TARGETS_SHEET_);
      sh = ss.getSheetByName(SA_IMPORT_TARGETS_SHEET_);
      var rows = names.map(function (n) { return [n, n === current]; });
      sh.getRange(2, 1, rows.length, 2).setValues(rows);
      result = 'created';
    } else {
      ensureTable_(ss, SA_IMPORT_TARGETS_SHEET_); // 見出しの確認だけ（中身には触れない）
    }
    SpreadsheetApp.flush();
    props.setProperty(SA_IMPORT_TARGETS_INIT_PROP_, '1');
    return result;
  } finally {
    lock.releaseLock();
  }
}
