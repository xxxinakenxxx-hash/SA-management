// API-11 completeRequest：完了登録の唯一の経路。完了コメント・返却する成果物・状態・時刻・履歴を保存し、営業への通知を別に登録する。
// 状態を「完了」にできるのは、この関数だけ（API-06 は完了への変更を受け付けない）。
// 通知（FN-11・FN-12）は業務保存の後に別処理で送る。送信に失敗しても、保存した完了は取り消さない。

// 返却対象のフラグを、この依頼の全添付について揃える（選んだものだけ true）。戻り値は取り消し用の元の値。
function setReturnFlags_(requestId, returnIds) {
  var sh = getTable_('sa_attachments'), idx = saColumnIndex_('sa_attachments'), undo = [];
  var want = {}; returnIds.forEach(function (id) { want[id] = true; });
  readAllAttachments_().forEach(function (a) {
    if (String(a.obj.request_id) !== requestId) return;
    var next = want[String(a.obj.attachment_id)] === true, before = a.obj.is_returned_to_sales === true;
    if (next !== before) { sh.getRange(a.rowNum, idx.is_returned_to_sales + 1, 1, 1).setValue(next); undo.push({ rowNum: a.rowNum, before: before }); }
  });
  return undo;
}
function undoReturnFlags_(undo) {
  var sh = getTable_('sa_attachments'), idx = saColumnIndex_('sa_attachments');
  undo.forEach(function (u) { sh.getRange(u.rowNum, idx.is_returned_to_sales + 1, 1, 1).setValue(u.before); });
}

function handleCompleteRequest_(ctx, params) {
  requireSa_(ctx);
  var v = parseInput_('completeRequest', params);
  var done = withScriptLock_(function () {
    var cur = findRequestById_(v.requestId);
    authorizeRequestAccess_(ctx, cur && cur.obj, 'sa_write');
    var names = userNameMap_(readUserMasterRows_());
    var evId = eventIdFor_(ctx.userId, 'completeRequest', v.clientOperationId);
    var returnedCount = function (id) { return readAllAttachments_().filter(function (a) { return String(a.obj.request_id) === id && a.obj.is_returned_to_sales === true; }).length; };
    if (activityEventExists_(evId)) return { duplicate: true, request: toListItem_(cur.obj, names, null), returnedCount: returnedCount(v.requestId), evId: evId, deliver: false };
    var mine = {};
    readAllAttachments_().forEach(function (a) { if (String(a.obj.request_id) === v.requestId) mine[String(a.obj.attachment_id)] = true; });
    v.returnAttachmentIds.forEach(function (id) { if (!mine[id]) throw validationError_('returnAttachmentIds', '返却する成果物が、この依頼のものではありません。', 'ATTACHMENT_INVALID'); });
    var status = String(cur.obj.status);
    if (status === 'completed') throw saError_('CONFLICT', { reason: 'already_completed' });
    if (status !== 'in_progress' && status !== 'waiting_sales') throw validationError_('request', '完了登録は、担当者がいる（対応中・営業回答待ち）依頼だけで行えます。先に担当してください。', 'STATUS_NOT_ALLOWED');
    var undo = [];
    var upd = updateRequestWithVersion_(v.requestId, v.expectedRowVersion, function () { return { status: 'completed', completed_at: nowIso_(), completion_comment: v.completionComment }; });
    try {
      undo = setReturnFlags_(v.requestId, v.returnAttachmentIds);
      appendActivityEvent_(ctx.userId, v.requestId, 'completed', status, 'completed', evId);
    } catch (e) {
      try { undoReturnFlags_(undo); } catch (e1) { /* 取り消せない分は、依頼の復元を優先する */ }
      restoreRequestRow_(upd.rowNum, upd.previousValues);
      throw saError_('STORAGE_ERROR');
    }
    var notify = null;
    if (String(upd.after.sales_user_id)) { try { notify = enqueueCompletionNotification_(evId, upd.after); } catch (e3) { notify = { error: true }; } }
    return { duplicate: false, request: toListItem_(upd.after, names, null), returnedCount: v.returnAttachmentIds.length, evId: evId, notify: notify, deliver: true };
  });
  var notification = { status: 'none', code: '' };
  if (done.deliver && done.notify) notification = done.notify.error ? { status: 'failed', code: 'ENQUEUE_FAILED' } : deliverNotification_(done.notify.notification_id);
  else if (done.duplicate) {
    var nt = findNotification_('NT-' + done.evId);
    if (nt) notification = { status: String(nt.obj.delivery_status), code: String(nt.obj.last_error_code || '') };
  }
  return { duplicate: done.duplicate, request: done.request, returnedCount: done.returnedCount, notification: notification };
}
function completeRequest(params) { return runApi_(function (ctx) { return handleCompleteRequest_(ctx, params); }); }
