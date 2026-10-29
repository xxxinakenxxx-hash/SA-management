// 定期実行（5分ごとの時間主導トリガー）。
// 設置する関数は用意するが、工程01では設置しない（本物の依頼文が自動でOpenAIへ送られるのを防ぐため）。
// 設置時期は管理側が決める。設置には script.scriptapp の権限が必要で、設置時に appsscript.json へ追加する。

// トリガーから呼ばれる処理：対象営業所の取込 → 抽出状態が pending の依頼の抽出。
function runScheduledImport() {
  var imported = importSaRequests_(getImportBranch_());
  var extracted = extractPendingRequests_(10);
  return { imported: imported, extracted: extracted };
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
