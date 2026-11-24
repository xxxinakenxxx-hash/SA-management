// SA管理GAS 共通設定・補助関数（工程01）。
// スクリプトプロパティ（値はコードに書かない）：
//   SALES_DB_ID       営業AIメモDBスプレッドシートのID（Sheets API読み取り専用で参照する）
//   AI_API_KEY        OpenAIのAPIキー
//   SA_IMPORT_BRANCH  旧方式の定期取込の対象営業所名（未設定なら「鹿児島」）。切戻し用に残す。
//                     現在の定期取込の対象は、シート sa_import_targets（A列 branch_name／B列 import_enabled）で決める。
//                     この値は、sa_import_targets を最初に作るときに TRUE にする営業所の決定にだけ使う。

var SA_SOURCE_SYSTEM_ = 'eigyo_ai_memo';
var SA_PREFIX_ = 'SA依頼｜';
var SA_TZ_ = 'Asia/Tokyo';
var SA_DEFAULT_BRANCH_ = '鹿児島';

function getSalesDbId_() {
  var id = String(PropertiesService.getScriptProperties().getProperty('SALES_DB_ID') || '').trim();
  if (!id) throw new Error('SALES_DB_ID_MISSING');
  return id;
}

function getImportBranch_() {
  var b = String(PropertiesService.getScriptProperties().getProperty('SA_IMPORT_BRANCH') || '').trim();
  return b || SA_DEFAULT_BRANCH_;
}

// 定期取込の対象営業所を、シート sa_import_targets から読む（営業所の追加・停止は、シートの行と TRUE／FALSE だけで行う）。
// シートが無い・見出しが違う・行が無い・営業所名が空や重複・TRUE／FALSE 以外の値は、設定エラーとして止める（対象を推測で補わない）。
// 戻り値：{ all: [{ branchName, enabled }], enabled: [営業所名] }。この関数はシートを読むだけで、書き込まない。
var SA_IMPORT_TARGETS_SHEET_ = 'sa_import_targets';

function readImportTargets_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SA_IMPORT_TARGETS_SHEET_);
  if (!sh) throw new Error('IMPORT_TARGETS_SHEET_MISSING');
  var head = sh.getRange(1, 1, 1, 2).getValues()[0];
  if (String(head[0]).trim() !== 'branch_name' || String(head[1]).trim() !== 'import_enabled') throw new Error('IMPORT_TARGETS_HEADER_INVALID');
  var last = sh.getLastRow();
  if (last < 2) throw new Error('IMPORT_TARGETS_EMPTY');
  var values = sh.getRange(2, 1, last - 1, 2).getValues();
  var seen = {}, all = [], enabled = [];
  for (var i = 0; i < values.length; i++) {
    var name = String(values[i][0] == null ? '' : values[i][0]).trim();
    var raw = values[i][1];
    var flagText = String(raw == null ? '' : raw).trim().toUpperCase();
    if (!name && !flagText) continue; // 何も書かれていない行は飛ばす
    if (!name) throw new Error('IMPORT_TARGETS_BRANCH_BLANK:row' + (i + 2));
    if (seen[name]) throw new Error('IMPORT_TARGETS_DUPLICATE:row' + (i + 2));
    seen[name] = true;
    var on;
    if (raw === true || flagText === 'TRUE') on = true;
    else if (raw === false || flagText === 'FALSE') on = false;
    else throw new Error('IMPORT_TARGETS_VALUE_INVALID:row' + (i + 2));
    all.push({ branchName: name, enabled: on });
    if (on) enabled.push(name);
  }
  if (!all.length) throw new Error('IMPORT_TARGETS_EMPTY');
  return { all: all, enabled: enabled };
}

// ISO 8601（JSTの時差付き）。例：2026-10-29T09:00:00+09:00
function nowIso_() {
  return Utilities.formatDate(new Date(), SA_TZ_, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

// 営業AIの日時表記（例：2026/10/20 11:08:57）をISO 8601（JST）に直す。読み取れない値はそのまま返す。
function toIsoFromSource_(text) {
  var s = String(text == null ? '' : text).trim();
  var m = s.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return s;
  function p(n) { return ('0' + n).slice(-2); }
  return m[1] + '-' + p(m[2]) + '-' + p(m[3]) + 'T' + p(m[4]) + ':' + m[5] + ':' + p(m[6] || '0') + '+09:00';
}

function newId_(prefix) {
  return prefix + '-' + Utilities.formatDate(new Date(), SA_TZ_, 'yyyyMMdd') + '-' +
    Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase();
}

function getTable_(name) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('TABLE_MISSING:' + name);
  return sh;
}

// 失敗の識別コード。値や個人情報を含めない（例外の種類だけを残す）。
function errorCode_(e) {
  var m = String(e && e.message || e || '');
  var known = m.match(/^([A-Z][A-Z0-9_]{2,40})(?::|$)/);
  if (known) return known[1];
  return 'WRITE_ERROR';
}
