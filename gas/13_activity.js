// FN-09 appendActivityEvent_：操作の履歴を sa_activity_log に追記する。
// 二重送信（同じ利用者・同じAPI・同じ client_operation_id）は、同じ event_id になることで見分ける。
function eventIdFor_(actorId, apiName, clientOperationId) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
    String(actorId).toLowerCase() + '|' + apiName + '|' + clientOperationId, Utilities.Charset.UTF_8);
  var hex = bytes.map(function (b) { return ('0' + ((b < 0 ? b + 256 : b).toString(16))).slice(-2); }).join('');
  return 'EV-' + hex.slice(0, 20).toUpperCase();
}

function activityEventExists_(eventId) {
  var sh = getTable_('sa_activity_log');
  var last = sh.getLastRow();
  if (last < 2) return false;
  var ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(eventId)) return true;
  return false;
}

function appendActivityEvent_(actorId, requestId, eventType, beforeValue, afterValue, eventId) {
  var sh = getTable_('sa_activity_log');
  var row = [eventId || newId_('EV'), requestId, actorId, eventType,
    beforeValue === undefined || beforeValue === null ? '' : String(beforeValue),
    afterValue === undefined || afterValue === null ? '' : String(afterValue), nowIso_()];
  sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setValues([row]);
  return row[0];
}
