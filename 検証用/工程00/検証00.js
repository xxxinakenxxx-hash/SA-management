// 工程00 技術検証用コード（本番実装ではない）。営業AI側は読み取りのみ。
// 営業AI DBのIDは配置時に差し替える（リポジトリには書かない）。
var SALES_DB_ID_ = '__SALES_DB_ID__';
var SA_PREFIX_ = 'SA依頼｜';
var KAGOSHIMA_ = '鹿児島';

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'whoami';
  var out;
  try {
    var who = identify_();
    if (action === 'whoami') {
      out = who;
    } else if (!who.allowed) {
      out = { ok: false, denied: true, reason: who.reason };
    } else if (who.role !== 'sysadmin') {
      out = { ok: false, denied: true, reason: 'role_not_permitted' };
    } else if (action === 'source') {
      out = { ok: true, result: sourceCheck_() };
    } else if (action === 'master') {
      out = { ok: true, result: masterCheck_() };
    } else {
      out = { ok: false, reason: 'unknown_action' };
    }
  } catch (err) {
    out = { ok: false, error: String(err && err.message ? err.message : err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out, null, 2))
    .setMimeType(ContentService.MimeType.JSON);
}

function open_(name) {
  var sh = SpreadsheetApp.openById(SALES_DB_ID_).getSheetByName(name);
  if (!sh) throw new Error('sheet_not_found:' + name);
  return sh.getDataRange().getValues();
}

function colIndex_(header) {
  var m = {};
  header.forEach(function (n, i) { m[String(n).trim()] = i; });
  return m;
}

function norm_(s) { return String(s || '').trim().toLowerCase(); }

function count_(map, key) { map[key] = (map[key] || 0) + 1; }

function identify_() {
  var active = Session.getActiveUser().getEmail() || '';
  var effective = Session.getEffectiveUser().getEmail() || '';
  var res = { activeUserEmailAvailable: !!active, effectiveUser: effective, activeUser: active,
    inMaster: false, allowed: false };
  if (!active) { res.reason = 'email_missing'; return res; }
  var v = open_('user_master');
  var c = colIndex_(v[0]);
  for (var i = 1; i < v.length; i++) {
    if (norm_(v[i][c.user_key]) === norm_(active)) {
      res.inMaster = true;
      res.role = String(v[i][c.role]).trim();
      res.branch = String(v[i][c.master_branch_name]).trim();
      res.active_flag = String(v[i][c.active_flag]).trim();
      res.allowed = res.active_flag === '有効';
      if (!res.allowed) res.reason = 'inactive';
      return res;
    }
  }
  res.reason = 'not_in_master';
  return res;
}

function masterCheck_() {
  var v = open_('user_master');
  var c = colIndex_(v[0]);
  var roles = {}, flags = {}, branches = {}, kRoles = {}, companies = {};
  var chatFilled = 0, seen = {}, dupKeys = 0, blankKeys = 0, kRows = 0;
  for (var i = 1; i < v.length; i++) {
    var k = norm_(v[i][c.user_key]);
    if (!k) { blankKeys++; continue; }
    if (seen[k]) dupKeys++;
    seen[k] = true;
    count_(roles, String(v[i][c.role]).trim());
    count_(flags, String(v[i][c.active_flag]).trim());
    count_(branches, String(v[i][c.master_branch_name]).trim());
    count_(companies, String(v[i][c.company_name]).trim());
    if (String(v[i][c.chat_id]).trim()) chatFilled++;
    if (String(v[i][c.master_branch_name]).indexOf(KAGOSHIMA_) >= 0) {
      kRows++; count_(kRoles, String(v[i][c.role]).trim());
    }
  }
  return { header: v[0], dataRows: v.length - 1, blankUserKey: blankKeys, duplicateUserKey: dupKeys,
    roles: roles, activeFlags: flags, branches: branches, companies: companies,
    kagoshimaUsers: kRows, kagoshimaRoles: kRoles, chatIdFilled: chatFilled };
}

function sourceCheck_() {
  var v = open_('deal_records');
  var c = colIndex_(v[0]);
  var total = v.length - 1, sa = 0, saLoose = 0, blankId = 0, dupAll = 0, dupSa = 0;
  var seen = {}, seenSa = {}, saByBranch = {}, allByBranch = {}, saStatus = {};
  var saBlankUserKey = 0, saKagoshimaByBranch = 0, saKagoshimaByUser = 0, saBlankOriginal = 0;
  var minAt = '', maxAt = '';
  var um = open_('user_master'), uc = colIndex_(um[0]), branchOf = {};
  for (var j = 1; j < um.length; j++) branchOf[norm_(um[j][uc.user_key])] = String(um[j][uc.master_branch_name]);
  for (var i = 1; i < v.length; i++) {
    var r = v[i];
    var id = String(r[c.record_id]).trim();
    var theme = String(r[c.deal_theme]);
    var branch = String(r[c.branch_name]).trim();
    count_(allByBranch, branch);
    if (!id) blankId++; else { if (seen[id]) dupAll++; seen[id] = true; }
    if (theme.indexOf('SA依頼') === 0) saLoose++;
    if (theme.indexOf(SA_PREFIX_) !== 0) continue;
    sa++;
    count_(saByBranch, branch);
    count_(saStatus, String(r[c.extract_status]).trim() || '(blank)');
    if (id) { if (seenSa[id]) dupSa++; seenSa[id] = true; }
    var uk = norm_(r[c.user_key]);
    if (!uk) saBlankUserKey++;
    if (branch.indexOf(KAGOSHIMA_) >= 0) saKagoshimaByBranch++;
    if (uk && String(branchOf[uk] || '').indexOf(KAGOSHIMA_) >= 0) saKagoshimaByUser++;
    if (!String(r[c.original_text]).trim()) saBlankOriginal++;
    var at = String(r[c.created_at]);
    if (!minAt || at < minAt) minAt = at;
    if (!maxAt || at > maxAt) maxAt = at;
  }
  return { header: v[0], totalRows: total, saRows: sa, saPrefixLoose: saLoose,
    nonSaExcluded: total - sa, blankRecordId: blankId, duplicateRecordIdAll: dupAll,
    duplicateRecordIdSa: dupSa, saByBranchName: saByBranch, allByBranchName: allByBranch,
    saKagoshimaByBranchName: saKagoshimaByBranch, saKagoshimaByUserMaster: saKagoshimaByUser,
    saBlankUserKey: saBlankUserKey, saBlankOriginalText: saBlankOriginal,
    saExtractStatus: saStatus, saCreatedAtMin: minAt, saCreatedAtMax: maxAt };
}
