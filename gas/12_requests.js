// FN-06 findRequestById_／FN-07 updateRequestWithVersion_：依頼行の取得と、版番号つきの更新。
function requestObjectFromValues_(values) {
  var o = {};
  saHeader_('sa_requests').forEach(function (n, i) { o[n] = values[i]; });
  return o;
}

function readAllRequests_() {
  var sh = getTable_('sa_requests');
  var last = sh.getLastRow();
  if (last < 2) return [];
  var n = saHeader_('sa_requests').length;
  return sh.getRange(2, 1, last - 1, n).getValues().map(function (v, i) {
    return { rowNum: i + 2, values: v, obj: requestObjectFromValues_(v) };
  }).filter(function (r) { return String(r.obj.request_id) !== ''; });
}

// FN-06：依頼IDで1件を正確に取得する。無ければ null。
function findRequestById_(requestId) {
  var sh = getTable_('sa_requests');
  var last = sh.getLastRow();
  if (last < 2) return null;
  var ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(requestId)) {
      var rowNum = i + 2;
      var values = sh.getRange(rowNum, 1, 1, saHeader_('sa_requests').length).getValues()[0];
      return { rowNum: rowNum, values: values, obj: requestObjectFromValues_(values) };
    }
  }
  return null;
}

// ロックの中で fn を実行する。取れなければ保存失敗として扱う。
function withScriptLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw saError_('STORAGE_ERROR', { reason: 'lock_timeout' });
  try { return fn(); } finally { lock.releaseLock(); }
}

// FN-07：指定列だけを更新する。呼び出し側がロックを持っていること。
// expectedVersion が現在の row_version と違えば CONFLICT。apply(現在の依頼) が返した列だけを書き、版を+1する。
function updateRequestWithVersion_(requestId, expectedVersion, apply) {
  var cur = findRequestById_(requestId);
  if (!cur) throw saError_('NOT_FOUND');
  if (expectedVersion !== null && expectedVersion !== undefined && Number(cur.obj.row_version) !== Number(expectedVersion)) {
    throw saError_('CONFLICT', { reason: 'version' });
  }
  var changes = apply(cur.obj) || {};
  var next = {};
  Object.keys(cur.obj).forEach(function (k) { next[k] = cur.obj[k]; });
  Object.keys(changes).forEach(function (k) { next[k] = changes[k]; });
  next.updated_at = nowIso_();
  next.row_version = Number(cur.obj.row_version) + 1;
  var row = rowFromObject_('sa_requests', next);
  getTable_('sa_requests').getRange(cur.rowNum, 1, 1, row.length).setValues([row]);
  return { before: cur.obj, after: next, rowNum: cur.rowNum, previousValues: cur.values };
}

function restoreRequestRow_(rowNum, values) {
  getTable_('sa_requests').getRange(rowNum, 1, 1, values.length).setValues([values]);
}
