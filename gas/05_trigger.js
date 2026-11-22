// 定期実行（5分ごとの時間主導トリガー）。
// 設置する関数は用意するが、工程01では設置しない（本物の依頼文が自動でOpenAIへ送られるのを防ぐため）。
// 設置時期は管理側が決める。設置には script.scriptapp の権限が必要で、設置時に appsscript.json へ追加する。

// トリガーから呼ばれる処理：取込設定シート sa_import_targets で TRUE の営業所ごとに、取込 → 抽出状態が pending の依頼の抽出。
// ・設定に誤り（シートなし・重複・TRUE／FALSE 以外など）があれば、どの営業所も処理せずに失敗で終える（対象を推測しない）。
// ・ある営業所が失敗しても、残りの営業所は処理する。1つでも失敗があれば、全部を処理した後に、この実行を失敗として終える。
// ・結果は営業所別に実行ログへ残す（営業所名・件数・失敗の識別コードだけ。依頼の中身や個人情報は出さない）。
function runScheduledImport() {
  ensureRequestArchiveColumns_();
  ensureImportTargetsSheet_();
  var targets;
  try {
    targets = readImportTargets_();
  } catch (e) {
    console.error(JSON.stringify({ fn: 'runScheduledImport', configError: errorCode_(e), detail: String(e && e.message || '') }));
    throw e;
  }
  var results = [];
  targets.enabled.forEach(function (branch) {
    var r = { branch: branch, ok: true, failedStep: '', errorCode: '', imported: null, extracted: null };
    try {
      r.imported = importSaRequests_(branch);
      r.extracted = extractPendingRequests_(10, branch);
    } catch (e) {
      r.ok = false;
      r.failedStep = r.imported ? 'extract' : 'import';
      r.errorCode = errorCode_(e);
    }
    results.push(r);
  });
  var failed = results.filter(function (r) { return !r.ok; }).map(function (r) { return r.branch; });
  console.log(JSON.stringify({ fn: 'runScheduledImport', targets: targets.enabled, failed: failed, results: results }));
  if (failed.length) throw new Error('IMPORT_BRANCH_FAILED:' + failed.join(','));
  return { targets: targets.enabled, results: results };
}

function removeImportTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runScheduledImport') ScriptApp.deleteTrigger(t);
  });
}

function installImportTrigger() {
  removeImportTrigger();
  ScriptApp.newTrigger('runScheduledImport').timeBased().everyMinutes(5).create();
}
