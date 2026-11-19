// SA画面の「更新履歴」（2026-11-19 利用者指示で追加）。
// スプレッドシート「SA管理」の「更新履歴」シート（A列＝日付、B列＝内容）を読むだけ。
// 行を書き足せば、デプロイなしで画面の表示が変わる。シートが無いときだけ、見出しと最初の行を作る。
var SA_CHANGELOG_SHEET_ = '更新履歴';
var SA_CHANGELOG_HEADER_ = ['日付', '内容'];
var SA_CHANGELOG_INITIAL_ = [
  ['2026-11-19', '依頼一覧：カードが縮んで営業・得意先・担当・期限が見えなくなる不具合を直しました。'],
  ['2026-11-19', '依頼一覧：「完了を隠す」ボタンを追加しました（もう一度押すと元に戻ります）。'],
  ['2026-11-19', '画面上部：「改善・不具合を報告する」ボタンを追加しました（営業AIメモの報告フォームが新しいタブで開きます）。']
];
var SA_CHANGELOG_MAX_ = 20;

function ensureChangeLogSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SA_CHANGELOG_SHEET_);
  if (sh) return sh;
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    sh = ss.getSheetByName(SA_CHANGELOG_SHEET_);
    if (sh) return sh;
    sh = ss.insertSheet(SA_CHANGELOG_SHEET_);
    sh.getRange(1, 1, 1, 2).setValues([SA_CHANGELOG_HEADER_]);
    sh.getRange(2, 1, SA_CHANGELOG_INITIAL_.length, 2).setNumberFormat('@').setValues(SA_CHANGELOG_INITIAL_);
    sh.setFrozenRows(1);
    return sh;
  } finally {
    lock.releaseLock();
  }
}

function changeLogDateText_(v) {
  if (v && typeof v.getTime === 'function' && !isNaN(v.getTime())) return Utilities.formatDate(v, SA_TZ_, 'yyyy-MM-dd');
  return String(v == null ? '' : v).trim();
}

function handleGetChangeLog_(ctx) {
  var sh = ensureChangeLogSheet_();
  var last = sh.getLastRow();
  if (last < 2) return { items: [] };
  var rows = sh.getRange(2, 1, last - 1, 2).getValues();
  var items = [];
  rows.forEach(function (r, i) {
    var text = String(r[1] == null ? '' : r[1]).trim();
    if (!text) return;
    items.push({ date: changeLogDateText_(r[0]), text: text, i: i });
  });
  // 日付の新しい順。同じ日付はシートの上の行を先にする。
  items.sort(function (a, b) { return a.date === b.date ? a.i - b.i : (a.date < b.date ? 1 : -1); });
  return { items: items.slice(0, SA_CHANGELOG_MAX_).map(function (x) { return { date: x.date, text: x.text }; }) };
}

function getChangeLog(params) { return runApi_(function (ctx) { return handleGetChangeLog_(ctx); }, params); }
