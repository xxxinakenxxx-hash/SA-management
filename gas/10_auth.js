// FN-01 resolveAuthenticatedUser_／FN-02 authorizeRequestAccess_：本人確認と権限（営業AIと同じ方式）。
// 本人は Session.getActiveUser().getEmail() と user_master.user_key の照合で判定し、active_flag が「有効」のみ許可する。
// SA＝role が sales_support、営業＝sales。営業AIの表は Sheets API の読み取り専用で参照する。
var SA_ROLE_MAP_ = { sales_support: 'sa', sales: 'sales' };
var SA_ROLE_LABELS_ = { sa: 'SA', sales: '営業', sales_support: 'SA', manager: '管理職', president: '社長', sysadmin: 'システム管理者' };

var SA_ERROR_MESSAGES_ = {
  AUTH_REQUIRED: '本人を確認できませんでした。会社のGoogleアカウントでログインし直してください。',
  FORBIDDEN: 'この操作を行う権限がありません。',
  NOT_FOUND: '依頼が見つかりません。',
  VALIDATION_ERROR: '入力内容を確認してください。',
  CONFLICT: '他の人が先に更新しました。最新の状態を読み込み直してください。',
  STORAGE_ERROR: '保存に失敗しました。時間をおいてやり直してください。'
};

function saError_(code, details) {
  var e = new Error(code);
  e.saCode = code;
  e.details = details || null;
  return e;
}

var SA_MASTER_MEMO_ = null; // 1回の実行の中だけ有効(実行ごとに作り直される)

function readUserMasterRows_() {
  if (SA_MASTER_MEMO_) return SA_MASTER_MEMO_;
  var res = Sheets.Spreadsheets.Values.get(getSalesDbId_(), "'user_master'");
  var v = res.values || [];
  if (!v.length) throw new Error('MASTER_EMPTY');
  var idx = {};
  v[0].forEach(function (n, i) { idx[String(n).trim()] = i; });
  ['user_key', 'user_fullname', 'master_branch_name', 'active_flag', 'role'].forEach(function (n) {
    if (idx[n] === undefined) throw new Error('MASTER_COLUMN_MISSING:' + n);
  });
  function cell(row, n) { var x = row[idx[n]]; return x === undefined || x === null ? '' : String(x).trim(); }
  var rows = [];
  for (var i = 1; i < v.length; i++) {
    var key = cell(v[i], 'user_key');
    if (!key) continue; // メールアドレスが無い行は本人判定に使えない
    rows.push({ userKey: key, name: cell(v[i], 'user_fullname'), branch: cell(v[i], 'master_branch_name'), active: cell(v[i], 'active_flag'), masterRole: cell(v[i], 'role') });
  }
  SA_MASTER_MEMO_ = rows;
  return rows;
}

// メールアドレスとマスターの行から、本人の判定結果を作る。
function classifyUserByEmail_(email, rows) {
  var e = String(email == null ? '' : email).trim().toLowerCase();
  if (!e) return { ok: false, code: 'AUTH_REQUIRED', reason: 'email_missing' };
  var hit = null;
  for (var i = 0; i < rows.length; i++) { if (rows[i].userKey.toLowerCase() === e) { hit = rows[i]; break; } }
  if (!hit) return { ok: false, code: 'AUTH_REQUIRED', reason: 'not_in_master' };
  var base = { userId: hit.userKey, name: hit.name || hit.userKey, branch: hit.branch, masterRole: hit.masterRole };
  function fail(reason) { base.ok = false; base.code = 'FORBIDDEN'; base.reason = reason; return base; }
  if (hit.active !== '有効') return fail('inactive');
  var role = SA_ROLE_MAP_[hit.masterRole];
  if (!role) return fail('role_not_permitted');
  if (!hit.branch) return fail('branch_missing');
  base.ok = true;
  base.role = role;
  return base;
}

// FN-01：呼び出し中の利用者を確定する。
function resolveAuthenticatedUser_() {
  return classifyUserByEmail_(Session.getActiveUser().getEmail(), readUserMasterRows_());
}

// 同じ営業所の、有効なSA（sales_support）の一覧。担当変更の候補に使う。
function listBranchSas_(branch, rows) {
  return rows.filter(function (r) { return r.masterRole === 'sales_support' && r.active === '有効' && r.branch === branch; })
    .map(function (r) { return { userId: r.userKey, name: r.name || r.userKey }; });
}

function userNameMap_(rows) {
  var m = {};
  rows.forEach(function (r) { m[r.userKey.toLowerCase()] = r.name || r.userKey; });
  return m;
}

function displayName_(map, userId) {
  var id = String(userId || '').trim().toLowerCase();
  return id ? (map[id] || '（登録なし）') : '';
}

// FN-02：依頼への権限を確認する。operation：'read'（SA・営業）／'sa_write'（SAのみ）。
// 他の営業所の依頼・存在しない依頼は、どちらも NOT_FOUND とし、存在を漏らさない。
function authorizeRequestAccess_(ctx, requestObj, operation) {
  if (!ctx || !ctx.ok) throw saError_((ctx && ctx.code) || 'AUTH_REQUIRED');
  if (operation === 'sa_write' && ctx.role !== 'sa') throw saError_('FORBIDDEN');
  if (!requestObj || String(requestObj.branch_id) !== String(ctx.branch)) throw saError_('NOT_FOUND');
  return true;
}

function requireSa_(ctx) {
  if (!ctx || !ctx.ok) throw saError_((ctx && ctx.code) || 'AUTH_REQUIRED');
  if (ctx.role !== 'sa') throw saError_('FORBIDDEN');
}
