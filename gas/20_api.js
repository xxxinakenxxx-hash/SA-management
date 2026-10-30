// 工程02：論理API（API-01〜06、API-12〜15）。画面（GAS内）から google.script.run で呼ぶ。
// 本人は resolveAuthenticatedUser_()（FN-01）で確定し、全操作でサーバー側が権限を検査する。
// 各 API は「公開関数（本人確定つき）」と「handleXxx_(ctx, params)（権限・処理の本体）」に分かれる。

function okResponse_(data, requestId) { return { success: true, data: data, error: null, requestId: requestId }; }
function errorResponse_(code, details, requestId) {
  return { success: false, data: null, error: { code: code, message: SA_ERROR_MESSAGES_[code] || SA_ERROR_MESSAGES_.STORAGE_ERROR, details: details || null }, requestId: requestId };
}

// ctx（本人の判定結果）で handler(ctx) を実行し、共通のレスポンス形式にする。内部の詳細・スタックは返さない。
function executeApi_(ctx, handler) {
  var rid = Utilities.getUuid();
  try {
    if (!ctx || !ctx.ok) return errorResponse_((ctx && ctx.code) || 'AUTH_REQUIRED', ctx && ctx.reason ? { reason: ctx.reason } : null, rid);
    return okResponse_(handler(ctx), rid);
  } catch (e) {
    if (e && e.saCode) return errorResponse_(e.saCode, e.details, rid);
    return errorResponse_('STORAGE_ERROR', null, rid);
  }
}

function runApi_(handler) {
  var ctx;
  try { ctx = resolveAuthenticatedUser_(); } catch (e) { return errorResponse_('STORAGE_ERROR', null, Utilities.getUuid()); }
  return executeApi_(ctx, handler);
}

function parseInput_(operation, params) {
  var v = validateRequestInput_(operation, params);
  if (!v.ok) throw saError_('VALIDATION_ERROR', { errors: v.errors });
  return v.values;
}

function validationError_(field, message, reason) {
  return saError_('VALIDATION_ERROR', { errors: [{ field: field, message: message, reason: reason || '' }] });
}

// ---- 表示用の整形 ----
function todayJst_() { return Utilities.formatDate(new Date(), SA_TZ_, 'yyyy-MM-dd'); }

function addDaysIso_(iso, days) {
  var m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return isoFromUtc_(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + days * 86400000);
}

function readCursorsFor_(userId) {
  var sh = getTable_('sa_read_cursors');
  var last = sh.getLastRow(), out = {};
  if (last < 2) return out;
  var idx = saColumnIndex_('sa_read_cursors');
  sh.getRange(2, 1, last - 1, saHeader_('sa_read_cursors').length).getValues().forEach(function (r) {
    if (String(r[idx.user_id]).toLowerCase() === String(userId).toLowerCase() && String(r[idx.request_id])) {
      var so = r[idx.sort_order];
      out[String(r[idx.request_id])] = { sortOrder: so === '' || so === null ? null : Number(so), sortVersion: Number(r[idx.sort_version] || 1) };
    }
  });
  return out;
}

function toListItem_(o, names, cursor) {
  return {
    requestId: String(o.request_id), title: String(o.title), status: String(o.status), statusLabel: SA_STATUS_LABELS_[o.status] || String(o.status),
    branch: String(o.branch_id), salesUserName: displayName_(names, o.sales_user_id),
    customerName: String(o.customer_ref || ''),
    assignedUserId: String(o.assigned_sa_user_id || ''), assignedName: displayName_(names, o.assigned_sa_user_id),
    receivedAt: String(o.source_recorded_at || o.created_at), createdAt: String(o.created_at),
    dueText: String(o.sa_due_date_text || ''), dueDate: String(o.sa_due_date || ''), dueUrgent: o.sa_due_urgent === true,
    extractionStatus: String(o.extraction_status), rowVersion: Number(o.row_version),
    myOrder: cursor && cursor.sortOrder !== null ? cursor.sortOrder : null, sortVersion: cursor ? cursor.sortVersion : null
  };
}

function allowedStatusTargets_(o) {
  var m = { in_progress: ['waiting_sales', 'unassigned'], waiting_sales: ['in_progress', 'unassigned'], completed: ['in_progress'], unassigned: [] };
  return m[String(o.status)] || [];
}

// ---- API-01 getMyProfile ----
function handleGetMyProfile_(ctx) {
  return {
    userId: ctx.userId, name: ctx.name, role: ctx.role, roleLabel: SA_ROLE_LABELS_[ctx.role], branch: ctx.branch,
    saCandidates: ctx.role === 'sa' ? listBranchSas_(ctx.branch, readUserMasterRows_()) : []
  };
}
function getMyProfile() { return runApi_(handleGetMyProfile_); }

// ---- API-02 listRequests ----
function handleListRequests_(ctx, params) {
  var v = parseInput_('listRequests', params);
  var names = userNameMap_(readUserMasterRows_());
  var cursors = ctx.role === 'sa' ? readCursorsFor_(ctx.userId) : {};
  var mine = readAllRequests_().filter(function (r) { return String(r.obj.branch_id) === String(ctx.branch); });
  var counts = { unassigned: 0, in_progress: 0, waiting_sales: 0, completed: 0, total: mine.length };
  mine.forEach(function (r) { if (counts[r.obj.status] !== undefined) counts[r.obj.status]++; });
  var today = todayJst_(), in3 = addDaysIso_(today, 3), me = String(ctx.userId).toLowerCase(), kw = v.keyword.toLowerCase();
  var items = mine.map(function (r) { return { o: r.obj, item: toListItem_(r.obj, names, cursors[String(r.obj.request_id)]) }; }).filter(function (x) {
    var o = x.o, it = x.item;
    if (v.status.length && v.status.indexOf(it.status) < 0) return false;
    if (v.assignee === 'me' && it.assignedUserId.toLowerCase() !== me) return false;
    if (v.assignee === 'unassigned' && it.assignedUserId !== '') return false;
    if (v.assignee && v.assignee !== 'me' && v.assignee !== 'unassigned' && it.assignedUserId.toLowerCase() !== v.assignee.toLowerCase()) return false;
    if (ctx.role === 'sales' && v.mineOnly && String(o.sales_user_id).toLowerCase() !== me) return false;
    if (v.dueFilter === 'overdue' && !(it.dueDate && it.dueDate < today && it.status !== 'completed')) return false;
    if (v.dueFilter === 'today' && it.dueDate !== today) return false;
    if (v.dueFilter === 'within3' && !(it.dueDate && it.dueDate >= today && it.dueDate <= in3)) return false;
    if (v.dueFilter === 'urgent' && !it.dueUrgent) return false;
    if (kw) {
      var hay = [it.title, o.source_original_text, o.sa_action, o.sa_recipient, it.salesUserName, it.assignedName, it.customerName].join('\n').toLowerCase();
      if (hay.indexOf(kw) < 0) return false;
    }
    return true;
  }).map(function (x) { return x.item; });
  items.sort(function (a, b) {
    var ao = a.myOrder !== null, bo = b.myOrder !== null;
    if (ao && bo && a.myOrder !== b.myOrder) return a.myOrder - b.myOrder;
    if (ao !== bo) return ao ? -1 : 1;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.requestId < b.requestId ? -1 : 1;
  });
  var start = (v.page - 1) * v.pageSize;
  return { items: items.slice(start, start + v.pageSize), total: items.length, page: v.page, pageSize: v.pageSize, counts: counts };
}
function listRequests(params) { return runApi_(function (ctx) { return handleListRequests_(ctx, params); }); }

// ---- API-03 getRequestDetail ----
function readMessagesFor_(requestId, names) {
  var sh = getTable_('sa_messages'), last = sh.getLastRow();
  if (last < 2) return [];
  var idx = saColumnIndex_('sa_messages');
  return sh.getRange(2, 1, last - 1, saHeader_('sa_messages').length).getValues().filter(function (r) { return String(r[idx.request_id]) === requestId; }).map(function (r) {
    return { messageId: String(r[idx.message_id]), senderName: displayName_(names, r[idx.sender_user_id]), senderRole: String(r[idx.sender_role]), messageType: String(r[idx.message_type]),
      body: String(r[idx.body]), createdAt: String(r[idx.created_at]), correctsMessageId: String(r[idx.corrects_message_id] || '') };
  }).sort(function (a, b) { return a.createdAt < b.createdAt ? -1 : 1; });
}

function readAttachmentsFor_(requestId, names) {
  var sh = getTable_('sa_attachments'), last = sh.getLastRow();
  if (last < 2) return [];
  var idx = saColumnIndex_('sa_attachments');
  return sh.getRange(2, 1, last - 1, saHeader_('sa_attachments').length).getValues().filter(function (r) { return String(r[idx.request_id]) === requestId; }).map(function (r) {
    return { attachmentId: String(r[idx.attachment_id]), fileName: String(r[idx.file_name]), mimeType: String(r[idx.mime_type]), fileSize: Number(r[idx.file_size] || 0),
      uploadedByName: displayName_(names, r[idx.uploaded_by_user_id]), isReturnedToSales: r[idx.is_returned_to_sales] === true, createdAt: String(r[idx.created_at]), fileVersion: Number(r[idx.file_version] || 1) };
  });
}

function handleGetRequestDetail_(ctx, params) {
  var v = parseInput_('getRequestDetail', params);
  var cur = findRequestById_(v.requestId);
  authorizeRequestAccess_(ctx, cur && cur.obj, 'read');
  var o = cur.obj;
  var names = userNameMap_(readUserMasterRows_());
  var cursor = ctx.role === 'sa' ? readCursorsFor_(ctx.userId)[v.requestId] : null;
  var item = toListItem_(o, names, cursor);
  var isSa = ctx.role === 'sa';
  var data = {
    request: item,
    dealTheme: String(o.source_deal_theme), originalText: String(o.source_original_text), dealContent: String(o.source_deal_content || ''),
    completionComment: String(o.completion_comment || ''), completedAt: String(o.completed_at || ''),
    extraction: { status: String(o.extraction_status), recipient: String(o.sa_recipient || ''), action: String(o.sa_action || ''), requestType: String(o.sa_request_type || ''),
      fixedConditions: String(o.sa_fixed_conditions || ''), dueText: String(o.sa_due_date_text || ''), extractedAt: String(o.extracted_at || '') },
    due: { text: item.dueText, date: item.dueDate, urgent: item.dueUrgent, correctedByName: displayName_(names, o.sa_due_date_updated_by), correctedAt: String(o.sa_due_date_updated_at || '') },
    messages: readMessagesFor_(v.requestId, names),
    attachments: readAttachmentsFor_(v.requestId, names),
    allowedActions: {
      canClaim: isSa && String(o.status) === 'unassigned' && !String(o.assigned_sa_user_id || ''),
      canReassign: isSa && !!String(o.assigned_sa_user_id || ''),
      statusTargets: isSa ? allowedStatusTargets_(o).filter(function (t) { return t !== 'in_progress' || String(o.status) !== 'completed' || !!String(o.assigned_sa_user_id || ''); }) : [],
      canEditNote: isSa, canEditDue: isSa
    }
  };
  if (isSa) data.saNote = String(o.sa_note || '');
  return data;
}
function getRequestDetail(params) { return runApi_(function (ctx) { return handleGetRequestDetail_(ctx, params); }); }

// ---- 依頼を更新する操作（API-04・05・06・13・15）の共通処理 ----
// ロックの中で「二重送信の確認 → 権限 → 版番号の確認 → 更新 → 履歴」を行う。履歴の追記に失敗したら更新を巻き戻す。
function runRequestWrite_(ctx, apiName, v, spec) {
  return withScriptLock_(function () {
    var eventId = eventIdFor_(ctx.userId, apiName, v.clientOperationId);
    var cur = findRequestById_(v.requestId);
    authorizeRequestAccess_(ctx, cur && cur.obj, 'sa_write');
    var names = userNameMap_(readUserMasterRows_());
    if (activityEventExists_(eventId)) return { duplicate: true, request: toListItem_(cur.obj, names, null), saNote: String(cur.obj.sa_note || '') };
    var upd = updateRequestWithVersion_(v.requestId, v.expectedRowVersion, function (obj) { return spec.apply(obj); });
    var d = spec.describe(upd.before, upd.after);
    try {
      appendActivityEvent_(ctx.userId, v.requestId, spec.eventType, d.before, d.after, eventId);
    } catch (e) {
      restoreRequestRow_(upd.rowNum, upd.previousValues);
      throw saError_('STORAGE_ERROR');
    }
    return { duplicate: false, request: toListItem_(upd.after, names, null), saNote: String(upd.after.sa_note || '') };
  });
}

// ---- API-04 claimRequest ----
function handleClaimRequest_(ctx, params) {
  requireSa_(ctx);
  var v = parseInput_('claimRequest', params);
  return runRequestWrite_(ctx, 'claimRequest', v, {
    eventType: 'claimed',
    apply: function (o) {
      if (String(o.status) !== 'unassigned' || String(o.assigned_sa_user_id || '')) throw saError_('CONFLICT', { reason: 'already_claimed' });
      return { assigned_sa_user_id: ctx.userId, status: 'in_progress' };
    },
    describe: function (before, after) { return { before: '', after: after.assigned_sa_user_id }; }
  });
}
function claimRequest(params) { return runApi_(function (ctx) { return handleClaimRequest_(ctx, params); }); }

// ---- API-05 reassignRequest ----
function handleReassignRequest_(ctx, params) {
  requireSa_(ctx);
  var v = parseInput_('reassignRequest', params);
  var candidates = listBranchSas_(ctx.branch, readUserMasterRows_());
  var target = null;
  candidates.forEach(function (c) { if (c.userId.toLowerCase() === v.newAssigneeId.toLowerCase()) target = c; });
  if (!target) throw validationError_('newAssigneeId', '変更先は、同じ営業所の有効なSA担当者から選んでください。', 'ASSIGNEE_NOT_ALLOWED');
  return runRequestWrite_(ctx, 'reassignRequest', v, {
    eventType: 'reassigned',
    apply: function (o) {
      if (!String(o.assigned_sa_user_id || '')) throw validationError_('request', '未担当の依頼は「担当する」で引き受けてください。', 'NOT_ASSIGNED');
      if (String(o.assigned_sa_user_id).toLowerCase() === target.userId.toLowerCase()) throw validationError_('newAssigneeId', '現在の担当者と同じです。', 'NO_CHANGE');
      return { assigned_sa_user_id: target.userId };
    },
    describe: function (before, after) { return { before: before.assigned_sa_user_id, after: after.assigned_sa_user_id + (v.reason ? ' / ' + v.reason : '') }; }
  });
}
function reassignRequest(params) { return runApi_(function (ctx) { return handleReassignRequest_(ctx, params); }); }

// ---- API-06 changeRequestStatus（完了への変更は受け付けない。完了登録は API-11 のみ）----
function handleChangeRequestStatus_(ctx, params) {
  requireSa_(ctx);
  var v = parseInput_('changeRequestStatus', params);
  if (v.newStatus === 'completed') throw validationError_('newStatus', '完了への変更は、完了登録から行います。', 'COMPLETED_NOT_ALLOWED');
  return runRequestWrite_(ctx, 'changeRequestStatus', v, {
    eventType: 'status_changed',
    apply: function (o) {
      if (String(o.status) === v.newStatus) throw validationError_('newStatus', '現在と同じ状態です。', 'NO_CHANGE');
      if (allowedStatusTargets_(o).indexOf(v.newStatus) < 0) throw validationError_('newStatus', 'この状態からは変更できません。', 'TRANSITION_NOT_ALLOWED');
      var ch = { status: v.newStatus };
      if (v.newStatus === 'unassigned') ch.assigned_sa_user_id = '';
      if (String(o.status) === 'completed') {
        if (!String(o.assigned_sa_user_id || '')) throw validationError_('newStatus', '担当者がいない依頼は再開できません。', 'NOT_ASSIGNED');
        ch.completed_at = '';
      }
      return ch;
    },
    describe: function (before, after) { return { before: before.status, after: after.status }; }
  });
}
function changeRequestStatus(params) { return runApi_(function (ctx) { return handleChangeRequestStatus_(ctx, params); }); }

// ---- API-13 updateSaNote（完了コメントとは別の備考）----
function handleUpdateSaNote_(ctx, params) {
  requireSa_(ctx);
  var v = parseInput_('updateSaNote', params);
  return runRequestWrite_(ctx, 'updateSaNote', v, {
    eventType: 'note_updated',
    apply: function () { return { sa_note: v.saNote }; },
    describe: function (before, after) { return { before: '(' + String(before.sa_note || '').length + '文字)', after: '(' + String(after.sa_note || '').length + '文字)' }; }
  });
}
function updateSaNote(params) { return runApi_(function (ctx) { return handleUpdateSaNote_(ctx, params); }); }

// ---- API-15 correctRequestDueDate（元の依頼文 source_original_text は変更しない）----
function handleCorrectRequestDueDate_(ctx, params) {
  requireSa_(ctx);
  var v = parseInput_('correctRequestDueDate', params);
  function pack(o) { return String(o.sa_due_date_text || '') + '|' + String(o.sa_due_date || '') + '|' + (o.sa_due_urgent === true ? '急ぎ' : ''); }
  return runRequestWrite_(ctx, 'correctRequestDueDate', v, {
    eventType: 'due_corrected',
    apply: function () {
      return { sa_due_date_text: v.saDueDateText, sa_due_date: v.saDueDate, sa_due_urgent: v.saDueUrgent, sa_due_date_updated_by: ctx.userId, sa_due_date_updated_at: nowIso_() };
    },
    describe: function (before, after) { return { before: pack(before), after: pack(after) }; }
  });
}
function correctRequestDueDate(params) { return runApi_(function (ctx) { return handleCorrectRequestDueDate_(ctx, params); }); }

// ---- API-14 saveMyRequestOrder（本人の sa_read_cursors.sort_order だけを更新）----
function cursorIdFor_(userId, requestId) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(userId).toLowerCase() + '|' + requestId, Utilities.Charset.UTF_8);
  return 'CU-' + bytes.map(function (b) { return ('0' + ((b < 0 ? b + 256 : b).toString(16))).slice(-2); }).join('').slice(0, 16).toUpperCase();
}

function handleSaveMyRequestOrder_(ctx, params) {
  requireSa_(ctx);
  var v = parseInput_('saveMyRequestOrder', params);
  return withScriptLock_(function () {
    var eventId = eventIdFor_(ctx.userId, 'saveMyRequestOrder', v.clientOperationId);
    if (activityEventExists_(eventId)) return { duplicate: true, order: readCursorsFor_(ctx.userId) };
    var reqs = {};
    readAllRequests_().forEach(function (r) { reqs[String(r.obj.request_id)] = r.obj; });
    v.orderedRequestIds.forEach(function (id) {
      if (!reqs[id] || String(reqs[id].branch_id) !== String(ctx.branch)) throw validationError_('orderedRequestIds', '並べ替えできない依頼が含まれています。', 'INVALID_ID');
    });
    var sh = getTable_('sa_read_cursors'), n = saHeader_('sa_read_cursors').length, last = sh.getLastRow();
    var data = last >= 2 ? sh.getRange(2, 1, last - 1, n).getValues() : [];
    var snapshot = data.map(function (r) { return r.slice(); });
    var idx = saColumnIndex_('sa_read_cursors'), mine = {}, me = String(ctx.userId).toLowerCase();
    data.forEach(function (r, i) { if (String(r[idx.user_id]).toLowerCase() === me) mine[String(r[idx.request_id])] = i; });
    v.orderedRequestIds.forEach(function (id) {
      var i = mine[id];
      if (i !== undefined && v.expectedSortVersions[id] !== undefined && Number(data[i][idx.sort_version]) !== v.expectedSortVersions[id]) throw saError_('CONFLICT', { reason: 'sort_version' });
    });
    v.orderedRequestIds.forEach(function (id, k) {
      if (mine[id] !== undefined) {
        var r = data[mine[id]];
        r[idx.sort_order] = k + 1;
        r[idx.sort_version] = Number(r[idx.sort_version] || 0) + 1;
      } else {
        var nr = new Array(n).fill('');
        nr[idx.cursor_id] = cursorIdFor_(ctx.userId, id);
        nr[idx.request_id] = id;
        nr[idx.user_id] = ctx.userId;
        nr[idx.sort_order] = k + 1;
        nr[idx.sort_version] = 1;
        data.push(nr);
        mine[id] = data.length - 1;
      }
    });
    sh.getRange(2, 1, data.length, n).setValues(data);
    try {
      appendActivityEvent_(ctx.userId, '(order)', 'order_changed', '', v.orderedRequestIds.length + '件', eventId);
    } catch (e) {
      if (snapshot.length) sh.getRange(2, 1, snapshot.length, n).setValues(snapshot);
      if (data.length > snapshot.length) sh.getRange(2 + snapshot.length, 1, data.length - snapshot.length, n).clearContent();
      throw saError_('STORAGE_ERROR');
    }
    return { duplicate: false, order: readCursorsFor_(ctx.userId) };
  });
}
function saveMyRequestOrder(params) { return runApi_(function (ctx) { return handleSaveMyRequestOrder_(ctx, params); }); }

// ---- API-12 getActivityHistory（営業には公開対象の種類だけ）----
var SA_EVENT_LABELS_ = { claimed: '担当を引き受け', reassigned: '担当を変更', status_changed: '状態を変更', note_updated: '備考を更新', due_corrected: '期限を訂正', order_changed: '並び順を保存' };
var SA_SALES_VISIBLE_EVENTS_ = ['claimed', 'reassigned', 'status_changed'];

function handleGetActivityHistory_(ctx, params) {
  var v = parseInput_('getActivityHistory', params);
  var cur = findRequestById_(v.requestId);
  authorizeRequestAccess_(ctx, cur && cur.obj, 'read');
  var names = userNameMap_(readUserMasterRows_());
  var sh = getTable_('sa_activity_log'), last = sh.getLastRow(), events = [];
  if (last >= 2) {
    var idx = saColumnIndex_('sa_activity_log');
    sh.getRange(2, 1, last - 1, saHeader_('sa_activity_log').length).getValues().forEach(function (r) {
      if (String(r[idx.request_id]) !== v.requestId) return;
      var type = String(r[idx.event_type]);
      if (ctx.role !== 'sa' && SA_SALES_VISIBLE_EVENTS_.indexOf(type) < 0) return;
      function show(x) {
        var s = String(x || '');
        if (type === 'status_changed') return SA_STATUS_LABELS_[s] || s;
        if (type === 'claimed' || type === 'reassigned') { var parts = s.split(' / '); return displayName_(names, parts[0]) + (parts[1] ? '（理由：' + parts.slice(1).join(' / ') + '）' : ''); }
        return s;
      }
      events.push({ eventId: String(r[idx.event_id]), eventType: type, label: SA_EVENT_LABELS_[type] || type, actorName: displayName_(names, r[idx.actor_user_id]),
        before: show(r[idx.before_value]), after: show(r[idx.after_value]), createdAt: String(r[idx.created_at]) });
    });
  }
  events.sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : (a.createdAt > b.createdAt ? -1 : 0); });
  var size = 50, start = (v.page - 1) * size;
  return { items: events.slice(start, start + size), total: events.length, page: v.page, pageSize: size };
}
function getActivityHistory(params) { return runApi_(function (ctx) { return handleGetActivityHistory_(ctx, params); }); }
