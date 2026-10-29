// DB7表の定義と初期化（DB設計書§3〜4.6）。列名・順序は設計書どおり。
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
    ['extraction_status', 'String'], ['extracted_at', 'DateTime']
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
  ]
};

var SA_TABLE_NAMES_ = ['sa_requests', 'sa_messages', 'sa_attachments', 'sa_activity_log', 'sa_notifications', 'sa_read_cursors', 'sa_import_log'];

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

// DB7表を作る初期化関数。何度実行しても同じ結果（既にある表は作り直さない）。
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
