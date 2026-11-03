// FN-08 appendMessage_／FN-13 readThreadCursor_：スレッドの発言と、本人ごとの既読位置。
// 発言の保存・既読の更新では、依頼（sa_requests）の状態・版番号を変えない。

var SA_MSG_ID_PATTERN_ = /^MSG-\d{8}-[0-9A-F]{8}$/;
var SA_MESSAGE_TYPES_ = ['question', 'sales_reply', 'normal', 'correction'];
var SA_MESSAGE_MAX_ = 2000;
var SA_ROLE_NAMES_ = { sa: 'SA', sales: '営業' };

function messageObjFromValues_(values) {
  var o = {};
  saHeader_('sa_messages').forEach(function (n, i) { o[n] = values[i]; });
  return o;
}

// 発言を保存順（行の順）で全件読む。rowNum は1始まりの行番号。
function readAllMessages_() {
  var sh = getTable_('sa_messages'), last = sh.getLastRow();
  if (last < 2) return [];
  var n = saHeader_('sa_messages').length;
  return sh.getRange(2, 1, last - 1, n).getValues().map(function (v, i) { return { rowNum: i + 2, obj: messageObjFromValues_(v) }; })
    .filter(function (m) { return String(m.obj.message_id) !== ''; });
}

function findMessageById_(messageId) {
  var all = readAllMessages_();
  for (var i = 0; i < all.length; i++) if (String(all[i].obj.message_id) === String(messageId)) return all[i];
  return null;
}

// 同じ投稿者・同じ操作IDの発言があれば返す（二重送信の判定）。
function findMessageByOperation_(senderId, clientOperationId) {
  var all = readAllMessages_(), s = String(senderId).toLowerCase();
  for (var i = 0; i < all.length; i++) {
    if (String(all[i].obj.sender_user_id).toLowerCase() === s && String(all[i].obj.client_operation_id) === String(clientOperationId)) return all[i];
  }
  return null;
}

// FN-08：発言を1行追記する。呼び出し側がロックを持っていること。戻り値は追記した行番号。
function appendMessage_(obj) {
  var sh = getTable_('sa_messages');
  var row = rowFromObject_('sa_messages', obj);
  var rowNum = sh.getLastRow() + 1;
  sh.getRange(rowNum, 1, 1, row.length).setValues([row]);
  return rowNum;
}

// 追記した発言の取り消し（履歴の追記に失敗したときの巻き戻し）。ロックの中で呼ぶ。
function removeMessageRow_(rowNum) {
  getTable_('sa_messages').deleteRow(rowNum);
}

// ---- 既読位置（sa_read_cursors）。並び順（sort_order）の列には触れない ----
function readThreadCursor_(userId, requestId) {
  var sh = getTable_('sa_read_cursors'), last = sh.getLastRow();
  if (last < 2) return null;
  var idx = saColumnIndex_('sa_read_cursors'), n = saHeader_('sa_read_cursors').length, me = String(userId).toLowerCase();
  var data = sh.getRange(2, 1, last - 1, n).getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][idx.user_id]).toLowerCase() === me && String(data[i][idx.request_id]) === String(requestId)) {
      return { rowNum: i + 2, lastReadMessageId: String(data[i][idx.last_read_message_id] || ''), readAt: String(data[i][idx.read_at] || '') };
    }
  }
  return null;
}

// 既読位置を更新する（無ければ行を作る）。ロックの中で呼ぶ。
function updateThreadCursor_(userId, requestId, lastReadMessageId) {
  var sh = getTable_('sa_read_cursors'), idx = saColumnIndex_('sa_read_cursors'), n = saHeader_('sa_read_cursors').length;
  var cur = readThreadCursor_(userId, requestId), now = nowIso_();
  if (cur) {
    sh.getRange(cur.rowNum, idx.last_read_message_id + 1, 1, 1).setValue(lastReadMessageId);
    sh.getRange(cur.rowNum, idx.read_at + 1, 1, 1).setValue(now);
    return;
  }
  var row = new Array(n).fill('');
  row[idx.cursor_id] = cursorIdFor_(userId, requestId);
  row[idx.request_id] = requestId;
  row[idx.user_id] = userId;
  row[idx.last_read_message_id] = lastReadMessageId;
  row[idx.read_at] = now;
  row[idx.sort_version] = 1;
  sh.getRange(sh.getLastRow() + 1, 1, 1, n).setValues([row]);
}

// 依頼ごとの発言の一覧（保存順）。{ requestId: [{ id, sender }] }
function buildThreadIndex_() {
  var out = {};
  readAllMessages_().forEach(function (m) {
    var id = String(m.obj.request_id);
    (out[id] = out[id] || []).push({ id: String(m.obj.message_id), sender: String(m.obj.sender_user_id).toLowerCase(), at: String(m.obj.created_at) });
  });
  return out;
}

// 本人にとっての未読件数。最後に読んだ発言より後の、他の人の発言を数える。
function unreadCountFor_(thread, lastReadMessageId, userId) {
  if (!thread || !thread.length) return 0;
  var me = String(userId).toLowerCase(), start = 0;
  if (lastReadMessageId) {
    for (var i = 0; i < thread.length; i++) if (thread[i].id === lastReadMessageId) { start = i + 1; break; }
  }
  var n = 0;
  for (var j = start; j < thread.length; j++) if (thread[j].sender !== me) n++;
  return n;
}

// 本人の既読位置を依頼IDごとに読む。{ requestId: lastReadMessageId }
function readLastReadMapFor_(userId) {
  var sh = getTable_('sa_read_cursors'), last = sh.getLastRow(), out = {};
  if (last < 2) return out;
  var idx = saColumnIndex_('sa_read_cursors'), me = String(userId).toLowerCase();
  sh.getRange(2, 1, last - 1, saHeader_('sa_read_cursors').length).getValues().forEach(function (r) {
    if (String(r[idx.user_id]).toLowerCase() === me && String(r[idx.request_id])) out[String(r[idx.request_id])] = String(r[idx.last_read_message_id] || '');
  });
  return out;
}
