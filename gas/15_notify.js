// FN-11 enqueueNotification_／FN-12 deliverPendingNotifications_：営業への通知（営業1人ずつの1対1チャットのWebhook）。
// 送り先はスクリプトプロパティ SA_CHAT_WEBHOOK_<営業のuser_key>。アドレスは記録・表示しない。全員向けの部屋への通知は行わない。
// 送信の成否は sa_notifications に残し、依頼の状態や投稿の保存結果は変えない。
// notification_id は 'NT-' + message_id（1つの発言につき通知は1件。再送しても増えない）。

var SA_CHAT_WEBHOOK_PREFIX_ = 'SA_CHAT_WEBHOOK_';
var SA_CHAT_HOST_PREFIX_ = 'https://chat.googleapis.com/';
var SA_NOTIFY_KINDS_ = { question: '質問', answer: '回答' };

function chatWebhookUrlFor_(userKey) {
  var props = PropertiesService.getScriptProperties();
  var key = String(userKey || '').trim();
  if (!key) return '';
  var v = props.getProperty(SA_CHAT_WEBHOOK_PREFIX_ + key) || props.getProperty(SA_CHAT_WEBHOOK_PREFIX_ + key.toLowerCase());
  return String(v || '').trim();
}

// 実際の送信。試験ではこの関数を差し替える。戻り値は { code: HTTPステータス }。
function postChatWebhook_(url, text) {
  var res = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json; charset=UTF-8', payload: JSON.stringify({ text: text }), muteHttpExceptions: true });
  return { code: res.getResponseCode() };
}

// 営業が開く画面（SL-02）のリンク。公開したWebアプリのアドレスを使う。取れないときは SA_APP_URL、それも無ければ空。
function appUrl_() {
  var u = '';
  try { u = String(ScriptApp.getService().getUrl() || ''); } catch (e) { u = ''; }
  if (!u) u = String(PropertiesService.getScriptProperties().getProperty('SA_APP_URL') || '');
  return u.trim();
}

function oneLine_(s, max) {
  var t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max) + '…' : t;
}

// 通知の文面。送るたびに、依頼名・得意先名・SA名・質問や回答の要旨・SL-02を開くリンクを入れる。
function buildNotificationText_(req, saName, eventType, body) {
  var kind = SA_NOTIFY_KINDS_[eventType] || '連絡';
  var lines = ['【SA依頼】' + kind + 'が届きました', '依頼：' + oneLine_(req.title, 60)];
  if (String(req.customer_ref || '').trim()) lines.push('得意先：' + oneLine_(req.customer_ref, 40));
  lines.push('SA：' + (saName || ''));
  lines.push(kind + '：' + oneLine_(body, 100));
  var base = appUrl_();
  lines.push('開く：' + (base ? base + (base.indexOf('?') >= 0 ? '&' : '?') + 'view=sl&requestId=' + encodeURIComponent(String(req.request_id)) : '（リンクを取得できませんでした）'));
  return lines.join('\n');
}

function notificationObjFromValues_(values) {
  var o = {};
  saHeader_('sa_notifications').forEach(function (n, i) { o[n] = values[i]; });
  return o;
}

function findNotification_(notificationId) {
  var sh = getTable_('sa_notifications'), last = sh.getLastRow();
  if (last < 2) return null;
  var n = saHeader_('sa_notifications').length, data = sh.getRange(2, 1, last - 1, n).getValues();
  for (var i = 0; i < data.length; i++) if (String(data[i][0]) === String(notificationId)) return { rowNum: i + 2, obj: notificationObjFromValues_(data[i]) };
  return null;
}

// FN-11：送信対象を登録する（まだ送らない）。呼び出し側がロックを持っていること。
// 発言1件につき1行。すでにあればそれを返す。
function enqueueNotification_(msgObj, reqObj, eventType) {
  var id = 'NT-' + String(msgObj.message_id);
  var ex = findNotification_(id);
  if (ex) return ex.obj;
  var obj = { notification_id: id, request_id: String(reqObj.request_id), recipient_user_id: String(reqObj.sales_user_id), event_type: eventType, channel: 'google_chat',
    delivery_status: 'pending', attempt_count: 0, created_at: nowIso_() };
  var sh = getTable_('sa_notifications'), row = rowFromObject_('sa_notifications', obj);
  sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setValues([row]);
  return obj;
}

function saveNotificationResult_(notificationId, status, code) {
  withScriptLock_(function () {
    var cur = findNotification_(notificationId);
    if (!cur) return;
    var idx = saColumnIndex_('sa_notifications'), sh = getTable_('sa_notifications'), now = nowIso_();
    sh.getRange(cur.rowNum, idx.delivery_status + 1, 1, 1).setValue(status);
    sh.getRange(cur.rowNum, idx.attempt_count + 1, 1, 1).setValue(Number(cur.obj.attempt_count || 0) + 1);
    sh.getRange(cur.rowNum, idx.last_error_code + 1, 1, 1).setValue(status === 'sent' ? '' : code);
    if (status === 'sent') sh.getRange(cur.rowNum, idx.sent_at + 1, 1, 1).setValue(now);
  });
}

// FN-12：通知1件を送る。pending／failed だけが対象（sent は再送しない）。ロックの外で呼ぶ。
// 戻り値：{ status: 'sent'|'failed'|'none', code }。投稿の保存結果は変えない。
function deliverNotification_(notificationId) {
  var cur = findNotification_(notificationId);
  if (!cur) return { status: 'none', code: 'NOT_FOUND' };
  if (String(cur.obj.delivery_status) === 'sent') return { status: 'sent', code: '' };
  var finish = function (status, code) { try { saveNotificationResult_(notificationId, status, code); } catch (e) { /* 記録に失敗しても投稿は保存済み */ } return { status: status, code: code }; };
  try {
    var url = chatWebhookUrlFor_(cur.obj.recipient_user_id);
    if (!url) return finish('failed', 'WEBHOOK_NOT_SET');
    if (url.indexOf(SA_CHAT_HOST_PREFIX_) !== 0) return finish('failed', 'WEBHOOK_INVALID');
    var msg = findMessageById_(String(notificationId).slice(3)), req = findRequestById_(String(cur.obj.request_id));
    if (!msg || !req) return finish('failed', 'SOURCE_MISSING');
    var names = userNameMap_(readUserMasterRows_());
    var text = buildNotificationText_(req.obj, displayName_(names, msg.obj.sender_user_id), String(cur.obj.event_type), String(msg.obj.body));
    var res = postChatWebhook_(url, text);
    if (res && res.code >= 200 && res.code < 300) return finish('sent', '');
    return finish('failed', 'HTTP_' + (res ? res.code : 'NONE'));
  } catch (e) {
    return finish('failed', 'SEND_ERROR');
  }
}

// FN-12：送っていない通知（pending／failed）を送る。手動実行用（時間を決めた自動再送は作らない）。
function deliverPendingNotifications_() {
  var sh = getTable_('sa_notifications'), last = sh.getLastRow(), out = { tried: 0, sent: 0, failed: 0 };
  if (last < 2) return out;
  var n = saHeader_('sa_notifications').length, ids = [];
  sh.getRange(2, 1, last - 1, n).getValues().forEach(function (r) {
    var st = String(r[saColumnIndex_('sa_notifications').delivery_status]);
    if (String(r[0]) && (st === 'pending' || st === 'failed')) ids.push(String(r[0]));
  });
  ids.forEach(function (id) { var r = deliverNotification_(id); out.tried++; if (r.status === 'sent') out.sent++; else out.failed++; });
  return out;
}

// GASの画面（スクリプトエディタ）から手動で実行する入口。
function resendFailedNotifications() {
  var a = Session.getActiveUser().getEmail(), b = Session.getEffectiveUser().getEmail();
  if (!a || a !== b) throw new Error('FORBIDDEN');
  return deliverPendingNotifications_();
}
