// FN-05 importSaRequests_／FN-14 recordImportOutcome_：元依頼の冪等取込と取込ログ。
// 営業AIの表は読むだけ。SA管理の表への書き込みは LockService のロック内で行う。

function rowFromObject_(table, obj) {
  return saHeader_(table).map(function (n) {
    var v = obj[n];
    return v === undefined || v === null ? '' : v;
  });
}

function appendRequestRow_(obj) {
  var sh = getTable_('sa_requests');
  var row = rowFromObject_('sa_requests', obj);
  sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setValues([row]);
}

// 1表の1列を、値の集合（キー＝値、値＝true）として読む。
function readIdSet_(table, columnName) {
  var sh = getTable_(table);
  var last = sh.getLastRow();
  var set = {};
  if (last < 2) return set;
  var col = saColumnIndex_(table)[columnName] + 1;
  sh.getRange(2, col, last - 1, 1).getValues().forEach(function (r) {
    var s = String(r[0]).trim();
    if (s) set[s] = true;
  });
  return set;
}

// 取込ログに「重複」を記録済みの元IDの集合（同じ重複を5分ごとに書き足さないため）。
function readLoggedDuplicateIds_() {
  var sh = getTable_('sa_import_log');
  var last = sh.getLastRow();
  var set = {};
  if (last < 2) return set;
  sh.getRange(2, 2, last - 1, 2).getValues().forEach(function (r) {
    if (String(r[1]) === 'duplicate') set[String(r[0]).trim()] = true;
  });
  return set;
}

function buildRequestObject_(rec) {
  var now = nowIso_();
  return {
    request_id: newId_('SR'),
    source_system: SA_SOURCE_SYSTEM_,
    source_record_id: rec.record_id,
    branch_id: rec.branch_name,
    sales_user_id: rec.user_key,
    title: rec.deal_theme,
    body: rec.original_text,
    status: 'unassigned',
    source_recorded_at: toIsoFromSource_(rec.created_at),
    created_at: now,
    updated_at: now,
    row_version: 1,
    source_deal_theme: rec.deal_theme,
    source_original_text: rec.original_text,
    source_deal_content: rec.deal_content,
    source_user_key: rec.user_key,
    source_branch_name: rec.branch_name,
    sa_due_urgent: false,
    extraction_status: 'pending'
  };
}

// FN-14：取込の結果（success／duplicate／failed／partial）を sa_import_log に記録する。
// outcomes：[{ sourceRecordId, result, errorCode }]。戻り値は書いた行数。
function recordImportOutcome_(outcomes) {
  if (!outcomes || !outcomes.length) return 0;
  var sh = getTable_('sa_import_log');
  var rows = outcomes.map(function (o) {
    return [newId_('IM'), o.sourceRecordId || '', o.result, o.errorCode || '', nowIso_()];
  });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  return rows.length;
}

function safeRecordOutcome_(outcomes, summary) {
  try {
    recordImportOutcome_(outcomes);
  } catch (e) {
    summary.logged = false;
  }
}

// FN-05：指定した営業所の「SA依頼｜」だけを、record_id を鍵に冪等取込する。
// 1件ずつ書き、失敗した件は取込ログに failed で残して次へ進む（部分成功は partial）。再実行すると未取込の件だけが入る。
function importSaRequests_(branchName) {
  var branch = String(branchName == null ? '' : branchName).trim();
  var summary = { branch: branch, sourceRows: 0, imported: 0, duplicates: 0, failed: 0, partial: false, logged: true };
  var outcomes = [];
  try {
    var source = readSourceSaRecords_(branch);
    summary.sourceRows = source.length;
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) throw new Error('LOCK_TIMEOUT');
    try {
      var existing = readIdSet_('sa_requests', 'source_record_id');
      var duplicateLogged = readLoggedDuplicateIds_();
      source.forEach(function (rec) {
        if (existing[rec.record_id]) {
          summary.duplicates++;
          if (!duplicateLogged[rec.record_id]) {
            duplicateLogged[rec.record_id] = true;
            outcomes.push({ sourceRecordId: rec.record_id, result: 'duplicate' });
          }
          return;
        }
        try {
          appendRequestRow_(buildRequestObject_(rec));
          existing[rec.record_id] = true;
          summary.imported++;
          outcomes.push({ sourceRecordId: rec.record_id, result: 'success' });
        } catch (e) {
          summary.failed++;
          outcomes.push({ sourceRecordId: rec.record_id, result: 'failed', errorCode: errorCode_(e) });
        }
      });
    } finally {
      lock.releaseLock();
    }
    if (summary.imported > 0 && summary.failed > 0) {
      summary.partial = true;
      outcomes.push({ sourceRecordId: '(batch)', result: 'partial' });
    }
  } catch (e) {
    summary.failed++;
    outcomes.push({ sourceRecordId: '(batch)', result: 'failed', errorCode: errorCode_(e) });
    safeRecordOutcome_(outcomes, summary);
    throw e;
  }
  safeRecordOutcome_(outcomes, summary);
  return summary;
}
