// FN-03 validateRequestInput_：入力値の検証。クライアントから来た値は信用しない。
var SA_ID_PATTERN_ = /^SR-\d{8}-[0-9A-F]{8}$/;
var SA_OP_ID_PATTERN_ = /^[A-Za-z0-9_-]{8,64}$/;
var SA_STATUS_CODES_ = ['unassigned', 'in_progress', 'waiting_sales', 'completed'];
var SA_STATUS_LABELS_ = { unassigned: '未担当', in_progress: '対応中', waiting_sales: '営業回答待ち', completed: '完了' };

function isInt_(n) { return typeof n === 'number' && isFinite(n) && Math.floor(n) === n; }

// operation ごとに必要な項目を検証し、正規化した値を返す。{ ok, values, errors:[{field, message}] }
function validateRequestInput_(operation, params) {
  var p = params || {};
  var errors = [], values = {};
  function bad(field, message) { errors.push({ field: field, message: message }); }
  function needRequestId() {
    var s = typeof p.requestId === 'string' ? p.requestId.trim() : '';
    if (!SA_ID_PATTERN_.test(s)) bad('requestId', '依頼IDの形式が正しくありません。'); else values.requestId = s;
  }
  function needOpId() {
    var s = typeof p.clientOperationId === 'string' ? p.clientOperationId.trim() : '';
    if (!SA_OP_ID_PATTERN_.test(s)) bad('clientOperationId', '操作IDの形式が正しくありません。'); else values.clientOperationId = s;
  }
  function needVersion(required) {
    if (p.expectedRowVersion === undefined || p.expectedRowVersion === null) {
      if (required) bad('expectedRowVersion', '更新前の版番号が必要です。'); else values.expectedRowVersion = null;
    } else if (!isInt_(p.expectedRowVersion) || p.expectedRowVersion < 1) bad('expectedRowVersion', '版番号が正しくありません。');
    else values.expectedRowVersion = p.expectedRowVersion;
  }
  switch (operation) {
    case 'getRequestDetail': case 'getActivityHistory':
      needRequestId();
      if (operation === 'getActivityHistory') {
        var pg = p.page === undefined ? 1 : p.page;
        if (!isInt_(pg) || pg < 1) bad('page', 'ページ番号が正しくありません。'); else values.page = pg;
      }
      break;
    case 'claimRequest':
      needRequestId(); needOpId(); needVersion(false);
      break;
    case 'reassignRequest': {
      needRequestId(); needOpId(); needVersion(true);
      var a = typeof p.newAssigneeId === 'string' ? p.newAssigneeId.trim() : '';
      if (!a || a.length > 120) bad('newAssigneeId', '変更先の担当者を選んでください。'); else values.newAssigneeId = a;
      var reason = p.reason === undefined || p.reason === null ? '' : p.reason;
      if (typeof reason !== 'string' || reason.length > 200) bad('reason', '理由は200文字以内で入力してください。'); else values.reason = reason.trim();
      break;
    }
    case 'changeRequestStatus':
      needRequestId(); needOpId(); needVersion(true);
      if (SA_STATUS_CODES_.indexOf(p.newStatus) < 0) bad('newStatus', '状態の指定が正しくありません。'); else values.newStatus = p.newStatus;
      break;
    case 'updateSaNote': {
      needRequestId(); needOpId(); needVersion(true);
      if (typeof p.saNote !== 'string' || p.saNote.length > 2000) bad('saNote', '備考は2000文字以内で入力してください。'); else values.saNote = p.saNote;
      break;
    }
    case 'correctRequestDueDate': {
      needRequestId(); needOpId(); needVersion(true);
      var t = p.saDueDateText === undefined || p.saDueDateText === null ? '' : p.saDueDateText;
      if (typeof t !== 'string' || t.length > 200) bad('saDueDateText', '期限の表現は200文字以内で入力してください。'); else values.saDueDateText = t.trim();
      var d = p.saDueDate === undefined || p.saDueDate === null ? '' : p.saDueDate;
      if (typeof d !== 'string' || (d !== '' && !validIsoDate_(d))) bad('saDueDate', '期限の日付は yyyy-MM-dd の実在する日付で入力してください。'); else values.saDueDate = d;
      if (typeof p.saDueUrgent !== 'boolean') bad('saDueUrgent', '急ぎかどうかを指定してください。'); else values.saDueUrgent = p.saDueUrgent;
      if (values.saDueDate && values.saDueUrgent === true) bad('saDueUrgent', '日付を入れる場合は「急ぎ」にできません（急ぎは日付なしです）。');
      break;
    }
    case 'saveMyRequestOrder': {
      needOpId();
      var ids = p.orderedRequestIds;
      if (!Array.isArray(ids) || ids.length < 1 || ids.length > 500) bad('orderedRequestIds', '並び順の指定が正しくありません。');
      else {
        var seen = {}, okIds = true;
        ids.forEach(function (id) { if (typeof id !== 'string' || !SA_ID_PATTERN_.test(id) || seen[id]) okIds = false; seen[id] = true; });
        if (!okIds) bad('orderedRequestIds', '依頼IDが重複または不正です。'); else values.orderedRequestIds = ids.slice();
      }
      var ev = p.expectedSortVersions;
      if (ev === undefined || ev === null) values.expectedSortVersions = {};
      else if (typeof ev !== 'object' || Array.isArray(ev)) bad('expectedSortVersions', '並び順の版の指定が正しくありません。');
      else {
        var evOk = true;
        Object.keys(ev).forEach(function (k) { if (!SA_ID_PATTERN_.test(k) || !isInt_(ev[k]) || ev[k] < 1) evOk = false; });
        if (!evOk) bad('expectedSortVersions', '並び順の版の指定が正しくありません。'); else values.expectedSortVersions = ev;
      }
      break;
    }
    case 'postMessage': {
      needRequestId(); needOpId();
      if (SA_MESSAGE_TYPES_.indexOf(p.messageType) < 0) bad('messageType', '投稿の種類が正しくありません。'); else values.messageType = p.messageType;
      var body = typeof p.body === 'string' ? p.body.trim() : '';
      if (!body) bad('body', '本文を入力してください。'); else if (body.length > SA_MESSAGE_MAX_) bad('body', '本文は' + SA_MESSAGE_MAX_ + '文字以内で入力してください。'); else values.body = body;
      var cm = p.correctsMessageId === undefined || p.correctsMessageId === null ? '' : p.correctsMessageId;
      if (typeof cm !== 'string' || (cm !== '' && !SA_MSG_ID_PATTERN_.test(cm))) bad('correctsMessageId', '訂正する投稿の指定が正しくありません。');
      else if (values.messageType === 'correction' && !cm) bad('correctsMessageId', '訂正する投稿を指定してください。');
      else if (values.messageType !== 'correction' && cm) bad('correctsMessageId', '訂正以外の投稿に、訂正先は指定できません。');
      else values.correctsMessageId = cm;
      if (p.attachmentId !== undefined && p.attachmentId !== null && p.attachmentId !== '') bad('attachmentId', '添付は、まだ使えません。');
      break;
    }
    case 'markThreadRead': {
      needRequestId();
      var lr = p.lastReadMessageId === undefined || p.lastReadMessageId === null ? '' : p.lastReadMessageId;
      if (typeof lr !== 'string' || (lr !== '' && !SA_MSG_ID_PATTERN_.test(lr))) bad('lastReadMessageId', '既読の位置の指定が正しくありません。'); else values.lastReadMessageId = lr;
      break;
    }
    case 'registerAttachment': {
      needRequestId(); needOpId();
      var fn = typeof p.fileName === 'string' ? sanitizeFileName_(p.fileName) : '';
      if (!fn) bad('fileName', 'ファイル名を指定してください。'); else values.fileName = fn;
      values.mimeType = sanitizeMimeType_(p.mimeType);
      if (typeof p.contentBase64 !== 'string' || !p.contentBase64) bad('file', 'ファイルを選んでください。');
      else if (p.contentBase64.length > SA_ATTACH_BASE64_MAX_) bad('file', 'ファイルが大きすぎます（上限は' + Math.floor(SA_ATTACH_MAX_BYTES_ / 1048576) + 'MBです）。');
      else if (!/^[A-Za-z0-9+\/]*={0,2}$/.test(p.contentBase64)) bad('file', 'ファイルの内容を読み取れませんでした。');
      else values.contentBase64 = p.contentBase64;
      break;
    }
    case 'getAttachmentAccess': {
      needRequestId();
      var aid = typeof p.attachmentId === 'string' ? p.attachmentId.trim() : '';
      if (!SA_ATTACH_ID_PATTERN_.test(aid)) bad('attachmentId', '成果物の指定が正しくありません。'); else values.attachmentId = aid;
      break;
    }
    case 'completeRequest': {
      needRequestId(); needOpId(); needVersion(true);
      var cc = typeof p.completionComment === 'string' ? p.completionComment.trim() : '';
      if (!cc) bad('completionComment', '完了コメントを入力してください。'); else if (cc.length > 2000) bad('completionComment', '完了コメントは2000文字以内で入力してください。'); else values.completionComment = cc;
      var rids = p.returnAttachmentIds === undefined || p.returnAttachmentIds === null ? [] : p.returnAttachmentIds;
      if (!Array.isArray(rids) || rids.length > 50) bad('returnAttachmentIds', '返却する成果物の指定が正しくありません。');
      else {
        var seenA = {}, okA = true;
        rids.forEach(function (id) { if (typeof id !== 'string' || !SA_ATTACH_ID_PATTERN_.test(id) || seenA[id]) okA = false; seenA[id] = true; });
        if (!okA) bad('returnAttachmentIds', '返却する成果物の指定が重複または不正です。'); else values.returnAttachmentIds = rids.slice();
      }
      break;
    }
    case 'listRequests': {
      var st = p.status === undefined || p.status === null ? [] : p.status;
      if (!Array.isArray(st) || st.some(function (x) { return SA_STATUS_CODES_.indexOf(x) < 0; })) bad('status', '状態の絞り込みが正しくありません。'); else values.status = st;
      var asg = p.assignee === undefined || p.assignee === null ? '' : p.assignee;
      if (typeof asg !== 'string' || asg.length > 120) bad('assignee', '担当者の絞り込みが正しくありません。'); else values.assignee = asg;
      var due = p.dueFilter === undefined || p.dueFilter === null ? '' : p.dueFilter;
      if (['', 'overdue', 'today', 'within3', 'urgent'].indexOf(due) < 0) bad('dueFilter', '期限の絞り込みが正しくありません。'); else values.dueFilter = due;
      var kw = p.keyword === undefined || p.keyword === null ? '' : p.keyword;
      if (typeof kw !== 'string' || kw.length > 100) bad('keyword', '検索語は100文字以内で入力してください。'); else values.keyword = kw.trim();
      values.mineOnly = p.mineOnly === true;
      values.unreadOnly = p.unreadOnly === true;
      var pageNo = p.page === undefined ? 1 : p.page, size = p.pageSize === undefined ? 100 : p.pageSize;
      if (!isInt_(pageNo) || pageNo < 1) bad('page', 'ページ番号が正しくありません。'); else values.page = pageNo;
      if (!isInt_(size) || size < 1 || size > 200) bad('pageSize', '1ページの件数は1〜200です。'); else values.pageSize = size;
      break;
    }
    default:
      bad('operation', '未対応の操作です。');
  }
  return { ok: errors.length === 0, values: values, errors: errors };
}
