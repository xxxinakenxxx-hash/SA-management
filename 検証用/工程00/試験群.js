// 工程00 試験②〜⑥（検証用）。結果は戻り値と、SA管理表の「試験ログ」シートに残す。
// ID・キーは書かない（配置時に差し替え／スクリプトプロパティから読む）。
var SA_FOLDER_ID_ = '__SA_FOLDER_ID__';


// 試験用の関数は管理者（sysadmin）本人だけが呼べる。
function guard_() {
  var who = lookup_(Session.getActiveUser().getEmail() || '');
  if (!who.allowed || who.role !== 'sysadmin') throw new Error('denied:' + (who.reason || 'role_not_permitted'));
}

function getExecUrl() { guard_(); return ScriptApp.getService().getUrl(); }
function savePage(summary) {
  guard_();
  log_('page', summary);
  var sh = sheet_('結果', ['項目', '内容']);
  if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
  var keys = ['1_取込の冪等性', '2b_本人確認画面', '3A_画面内からの/exec呼び出し', '5_Drive', '7_新着表示', '9A_PWA条件'];
  var rows = keys.map(function (k) { return [k, JSON.stringify(summary[k] === undefined ? null : summary[k]).slice(0, 600)]; });
  sh.getRange(2, 1, rows.length, 2).setValues(rows);
  return true;
}

function ping() { return { ok: true, now: new Date().toISOString(), user: Session.getEffectiveUser().getEmail() ? 'ok' : 'none' }; }

function log_(test, obj) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('試験ログ') || ss.insertSheet('試験ログ');
  sh.appendRow([new Date().toISOString(), test, JSON.stringify(obj).slice(0, 45000)]);
}

function roleClass_(role) { return role === 'sales_support' ? 'SA' : (role === 'sales' ? '営業' : '対象外'); }

// 試験② 本人判定：user_master の全員のアドレスを判定関数に入れ、役割ごとの件数と結果だけを返す。
function t2Judge() {
  guard_();
  var master = open_('user_master');
  var c = colIndex_(master[0]);
  var byRole = {}, selfMismatch = 0, normOk = { sales: null, sales_support: null };
  for (var i = 1; i < master.length; i++) {
    var key = String(master[i][c.user_key]).trim();
    if (!key) continue;
    var r = lookup_(key, master);
    var role = String(master[i][c.role]).trim();
    if (r.role !== role) selfMismatch++;
    var label = roleClass_(r.role) + '/' + (r.allowed ? '許可' : '拒否(' + r.reason + ')');
    byRole[role] = byRole[role] || {};
    byRole[role][label] = (byRole[role][label] || 0) + 1;
    if ((role === 'sales' || role === 'sales_support') && r.allowed && normOk[role] === null) {
      normOk[role] = lookup_('  ' + key.toUpperCase() + ' ', master).role === role;
    }
  }
  var out = {
    byRole: byRole, selfMismatch: selfMismatch, caseAndSpaceTolerant: normOk,
    unknownAddress: lookup_('unknown.person@marubishi-group.co.jp', master).reason,
    emptyAddress: lookup_('', master).reason,
    outsideDomain: lookup_('someone@example.com', master).reason,
    executingUserIsSysadmin: lookup_(Session.getEffectiveUser().getEmail(), master).role === 'sysadmin',
    activeUserEmailAvailable: !!Session.getActiveUser().getEmail()
  };
  log_('t2', out);
  return out;
}

// 試験③ 拒否の判定（サーバー側の分岐）。呼び出し元のメールアドレスを差し替えて、門前払いの条件を確かめる。
function gate_(email, action, master) {
  var who = lookup_(email, master);
  if (!who.allowed) return { denied: true, reason: who.reason };
  if (action === 'source' && who.role !== 'sysadmin') return { denied: true, reason: 'role_not_permitted' };
  if (action === 'mySaList' && who.role !== 'sales_support' && who.role !== 'sysadmin') return { denied: true, reason: 'role_not_permitted' };
  return { denied: false, role: who.role };
}

function t3Gate() {
  guard_();
  var master = open_('user_master');
  var c = colIndex_(master[0]);
  var sample = {};
  for (var i = 1; i < master.length; i++) {
    var k = String(master[i][c.user_key]).trim();
    var role = String(master[i][c.role]).trim();
    var flag = String(master[i][c.active_flag]).trim();
    var tag = k ? (role + (flag === '有効' ? '/有効' : '/無効または空欄')) : '';
    if (tag && !sample[tag]) sample[tag] = k;
  }
  var out = { cases: {} };
  Object.keys(sample).forEach(function (t) {
    out.cases[t] = { source: gate_(sample[t], 'source', master), mySaList: gate_(sample[t], 'mySaList', master) };
  });
  out.cases['未登録'] = { source: gate_('unknown.person@marubishi-group.co.jp', 'source', master) };
  out.cases['外部ドメイン'] = { source: gate_('someone@example.com', 'source', master) };
  out.cases['アドレスなし'] = { source: gate_('', 'source', master) };
  log_('t3', out);
  return out;
}

// 試験④ 同時操作・更新版・途中失敗
function testSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('試験_引受') || ss.insertSheet('試験_引受');
  return sh;
}

function t4Reset() {
  guard_();
  var sh = testSheet_();
  sh.clear();
  sh.getRange(1, 1, 1, 5).setValues([['request_id', 'row_version', 'assignee', 'updated_at', 'note']]);
  sh.getRange(2, 1, 6, 5).setValues([['R1', 1, '', '', ''], ['R2', 1, '', '', ''], ['R3', 1, '', '', ''], ['R4', 1, '', '', ''], ['R5', 1, '', '', ''], ['R6', 1, '', '', '']]);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var lg = ss.getSheetByName('試験_履歴') || ss.insertSheet('試験_履歴');
  lg.clear();
  lg.getRange(1, 1, 1, 4).setValues([['request_id', 'event', 'by', 'at']]);
  return { ok: true };
}

function findRow_(sh, id) {
  var v = sh.getRange(1, 1, sh.getLastRow(), 5).getValues();
  for (var i = 1; i < v.length; i++) if (v[i][0] === id) return { row: i + 1, version: Number(v[i][1]), assignee: String(v[i][2]) };
  return null;
}

// 版番号つきの引受。ロックの中で「読む→版を確認→書く」を行う。
function claim(id, who, expectedVersion, holdMs, failAfterFirstWrite) {
  guard_();
  var lock = LockService.getScriptLock();
  var t0 = Date.now();
  if (!lock.tryLock(15000)) return { who: who, result: 'lock_timeout', waitedMs: Date.now() - t0 };
  var waited = Date.now() - t0;
  try {
    var sh = testSheet_();
    var cur = findRow_(sh, id);
    if (!cur) return { who: who, result: 'not_found' };
    if (cur.version !== expectedVersion || cur.assignee) {
      return { who: who, result: 'conflict', currentVersion: cur.version, assignee: cur.assignee ? '(担当あり)' : '', waitedMs: waited };
    }
    if (holdMs) Utilities.sleep(holdMs);
    sh.getRange(cur.row, 3).setValue(who);            // 1つ目の書き込み
    if (failAfterFirstWrite) throw new Error('injected_failure_after_first_write');
    sh.getRange(cur.row, 2).setValue(cur.version + 1); // 2つ目の書き込み（版番号）
    sh.getRange(cur.row, 4).setValue(new Date().toISOString());
    SpreadsheetApp.getActiveSpreadsheet().getSheetByName('試験_履歴').appendRow([id, 'claimed', who, new Date().toISOString()]);
    SpreadsheetApp.flush();
    return { who: who, result: 'claimed', newVersion: cur.version + 1, waitedMs: waited };
  } finally {
    lock.releaseLock();
  }
}

// 途中失敗：1つ目の書き込み後に失敗させ、巻き戻し（補償）で整合に戻せるかを見る。
function t4Failure() {
  guard_();
  var sh = testSheet_();
  var before = findRow_(sh, 'R3');
  var caught = '';
  try { claim('R3', 'failer', before.version, 0, true); } catch (e) { caught = String(e.message); }
  var mid = findRow_(sh, 'R3');
  var inconsistent = mid.assignee !== '' && mid.version === before.version;
  // 巻き戻し：版が進んでいないのに担当だけ入っている行を、元の値に戻す。
  var lock = LockService.getScriptLock();
  var rec = false;
  if (lock.tryLock(10000)) {
    try {
      var cur = findRow_(sh, 'R3');
      if (cur.assignee && cur.version === before.version) { sh.getRange(cur.row, 3).setValue(''); rec = true; }
    } finally { lock.releaseLock(); }
  }
  var after = findRow_(sh, 'R3');
  var again = claim('R3', 'retry-user', after.version, 0, false);
  var lockFree = LockService.getScriptLock().tryLock(2000);
  LockService.getScriptLock().releaseLock();
  return { caught: caught, inconsistentAfterFailure: inconsistent, recovered: rec,
    versionUnchangedAfterRecovery: after.version === before.version && after.assignee === '',
    retryResult: again, lockReleasedAfterException: lockFree };
}

function t4Serial() {
  guard_();
  t4Reset();
  var a = claim('R1', 'userA', 1, 0, false);
  var b = claim('R1', 'userB', 1, 0, false);          // 古い版番号での引受 → 衝突
  var c = claim('R2', 'userB', 1, 0, false);          // 別の依頼は成功
  var f = t4Failure();
  var out = { first: a, secondWithOldVersion: b, otherRequest: c, failure: f };
  log_('t4serial', out);
  return out;
}

function t4Read() {
  guard_();
  var sh = testSheet_();
  return sh.getRange(1, 1, sh.getLastRow(), 5).getValues().slice(1).map(function (r) { return { id: r[0], version: r[1], hasAssignee: !!r[2] }; });
}

// 試験⑤ Drive：drive.file（このスクリプトが作ったものだけ扱える）の範囲
function drv_(path, opts) {
  opts = opts || {};
  opts.muteHttpExceptions = true;
  opts.headers = { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() };
  var r = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/' + path, opts);
  return { code: r.getResponseCode(), text: r.getContentText() };
}

function t5Drive() {
  guard_();
  var out = { part1_driveFileFolder: {}, part2_existingFolder: {} };
  function tryDo(obj, key, fn) { try { obj[key] = fn(); } catch (e) { obj[key + '_error'] = String(e && e.message || e).slice(0, 160); } }
  // (1) drive.file で自分が作るフォルダ（マイドライブ直下）
  var p1 = out.part1_driveFileFolder, folder = null, f = null;
  tryDo(p1, 'folderCreated', function () { folder = Drive.Files.create({ name: '試験_drive.file', mimeType: 'application/vnd.google-apps.folder' }); return !!folder.id; });
  if (folder) {
    tryDo(p1, 'saved', function () { f = Drive.Files.create({ name: '試験_添付.txt', parents: [folder.id] }, Utilities.newBlob('工程00 試験ファイル(架空)', 'text/plain', '試験_添付.txt')); return !!f.id; });
    if (f) {
      tryDo(p1, 'readBack', function () { var g = drv_('files/' + f.id + '?alt=media'); return g.code === 200 && g.text.indexOf('工程00') >= 0; });
      tryDo(p1, 'permissions', function () { var r = drv_('files/' + f.id + '/permissions?fields=permissions(type,role)'); return JSON.parse(r.text).permissions.map(function (p) { return p.type + '/' + p.role; }); });
    }
  }
  // (2) ユーザーが作った既存フォルダ（SA管理フォルダ）
  var p2 = out.part2_existingFolder;
  tryDo(p2, 'seeCode', function () { return drv_('files/' + SA_FOLDER_ID_ + '?fields=id&supportsAllDrives=true').code; });
  tryDo(p2, 'saveInside', function () { var f2 = Drive.Files.create({ name: '試験_既存フォルダ内.txt', parents: [SA_FOLDER_ID_] }, Utilities.newBlob('x', 'text/plain', '試験_既存フォルダ内.txt')); return !!f2.id; });
  tryDo(out, 'salesDbCode', function () { return drv_('files/' + SALES_DB_ID_ + '?fields=id&supportsAllDrives=true').code; });
  log_('t5', out);
  return out;
}

// 試験⑥ OpenAI（架空の依頼文のみ）
function ai_(path, payload, method) {
  var key = PropertiesService.getScriptProperties().getProperty('AI_API_KEY');
  if (!key) throw new Error('AI_API_KEY_missing');
  var opt = { method: method || 'post', muteHttpExceptions: true, contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + key } };
  if (payload) opt.payload = JSON.stringify(payload);
  var r = UrlFetchApp.fetch('https://api.openai.com/v1/' + path, opt);
  return { code: r.getResponseCode(), text: r.getContentText(), headers: r.getHeaders() };
}

function t6Models() {
  guard_();
  var r = ai_('models', null, 'get');
  if (r.code !== 200) return { code: r.code, error: r.text.slice(0, 300) };
  var ids = JSON.parse(r.text).data.map(function (m) { return m.id; });
  var pick = ids.filter(function (id) { return /^(gpt-|o\d|chatgpt)/.test(id); }).sort();
  return { code: 200, count: ids.length, gptLike: pick.slice(0, 80) };
}

var AI_SCHEMA_ = {
  name: 'sa_request_fields', strict: true,
  schema: { type: 'object', additionalProperties: false,
    required: ['to_whom', 'what', 'request_type', 'decided', 'due'],
    properties: {
      to_whom: { type: ['string', 'null'] }, what: { type: ['string', 'null'] },
      request_type: { type: ['string', 'null'] }, decided: { type: ['string', 'null'] }, due: { type: ['string', 'null'] } } }
};

function extract_(model, text, maxTry, simulate503) {
  var sys = 'あなたはSA依頼の文章から5項目を取り出す。書かれていない項目はnullにする。推測で補わない。' +
    '項目：to_whom=誰に、what=何を、request_type=依頼の種類、decided=決まっていること、due=いつまで。';
  var tries = [], i;
  for (i = 0; i < (maxTry || 3); i++) {
    var r = (simulate503 && i < simulate503) ? { code: 503, text: 'simulated' } : ai_('chat/completions', { model: model, temperature: 0,
      messages: [{ role: 'system', content: sys }, { role: 'user', content: text }],
      response_format: { type: 'json_schema', json_schema: AI_SCHEMA_ } });
    tries.push(r.code);
    if (r.code === 200) {
      var j = JSON.parse(r.text);
      return { ok: true, tries: tries, fields: JSON.parse(j.choices[0].message.content), usage: j.usage };
    }
    if (r.code === 429 || r.code >= 500) { Utilities.sleep(1000 * Math.pow(2, i)); continue; }
    return { ok: false, tries: tries, error: r.text.slice(0, 300) };
  }
  return { ok: false, tries: tries, error: 'retry_exhausted' };
}

function t6Extract(model) {
  guard_();
  var samples = [
    '福岡の田中さんに、新商品Aの価格表を作ってほしい。依頼の種類は資料作成。税込で作ることは決まっている。来週金曜までにお願いします。',
    '山田課長へ見積書をお願いします。期限は未定です。',
    '商品Bのカタログを作りたいです。'
  ];
  var res = samples.map(function (t) { return extract_(model, t, 3); });
  var pt = 0, ct = 0;
  res.forEach(function (r) { if (r.usage) { pt += r.usage.prompt_tokens; ct += r.usage.completion_tokens; } });
  var out = { model: model, results: res.map(function (r) { return { ok: r.ok, tries: r.tries, fields: r.fields }; }),
    tokens: { prompt: pt, completion: ct, perRequestPrompt: Math.round(pt / samples.length), perRequestCompletion: Math.round(ct / samples.length) } };
  log_('t6', out);
  return out;
}

// 再試行の確認：存在しないモデル名で呼び、4xxは再試行せず即座に失敗として返すことを見る。
function t6BadRequest(model) {
  guard_();
  var r = extract_('no-such-model-xyz', '架空', 3);
  var sim = extract_(model, '福岡の田中さんに、新商品Aの価格表を作ってほしい。来週金曜まで。', 3, 2);
  var out = { badModel: { ok: r.ok, tries: r.tries, error: (r.error || '').slice(0, 120) },
    retryAfterTwoSimulated503: { ok: sim.ok, tries: sim.tries, usage: sim.usage } };
  log_('t6bad', out);
  return out;
}


// ---- 試験① 取込の冪等性（営業AIの表は読むだけ。SA管理表の試験用シートに record_id 単位で取り込む）
function sheet_(name, header) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.getRange(1, 1, 1, header.length).setValues([header]); }
  return sh;
}

function t1Import() {
  guard_();
  var v = open_('deal_records');
  var c = colIndex_(v[0]);
  var sh = sheet_('試験_取込', ['record_id', 'created_at', 'branch_name', 'text_length', 'imported_at']);
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { result: 'lock_timeout' };
  try {
    var have = {};
    var last = sh.getLastRow();
    if (last > 1) sh.getRange(2, 1, last - 1, 1).getValues().forEach(function (r) { have[String(r[0])] = true; });
    var src = 0, inserted = 0, skipped = 0, rows = [];
    for (var i = 1; i < v.length; i++) {
      var id = String(v[i][c.record_id]).trim();
      if (!id || String(v[i][c.deal_theme]).indexOf(SA_PREFIX_) !== 0) continue;
      src++;
      if (have[id]) { skipped++; continue; }
      have[id] = true;
      rows.push([id, String(v[i][c.created_at]), String(v[i][c.branch_name]).trim(), String(v[i][c.original_text]).length, new Date().toISOString()]);
      inserted++;
    }
    if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, 5).setValues(rows);
    SpreadsheetApp.flush();
    return { sourceSaRows: src, inserted: inserted, skippedAsDuplicate: skipped, totalRowsAfter: sh.getLastRow() - 1 };
  } finally { lock.releaseLock(); }
}

function t1Reset() { guard_(); var sh = sheet_('試験_取込', ['record_id', 'created_at', 'branch_name', 'text_length', 'imported_at']); if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1); return { ok: true }; }

// ---- 試験② 他営業所分離：営業所をまたぐ参照を拒否できるか
function branchAllowed_(who, requestBranch) {
  if (!who.allowed) return false;
  if (who.role === 'sysadmin') return true;
  return who.branch === requestBranch;
}

function t2Branch() {
  guard_();
  var master = open_('user_master');
  var c = colIndex_(master[0]);
  var firstByBranch = {};
  for (var i = 1; i < master.length; i++) {
    var k = String(master[i][c.user_key]).trim();
    if (!k || String(master[i][c.role]).trim() !== 'sales' || String(master[i][c.active_flag]).trim() !== '有効') continue;
    var b = String(master[i][c.master_branch_name]).trim();
    if (!firstByBranch[b]) firstByBranch[b] = k;
  }
  var branches = Object.keys(firstByBranch), ok = 0, ng = 0;
  branches.forEach(function (own) {
    var who = lookup_(firstByBranch[own], master);
    branches.forEach(function (target) {
      var allowed = branchAllowed_(who, target);
      if (own === target) { if (allowed) ok++; else ng++; } else { if (!allowed) ok++; else ng++; }
    });
  });
  var out = { branches: branches.length, checks: branches.length * branches.length, correct: ok, wrong: ng };
  log_('t2branch', out);
  return out;
}

// ---- 試験② (b)(c) 本人確認画面用（読み取りのみ）
function meInfo() {
  var who = lookup_(Session.getActiveUser().getEmail() || '');
  if (!who.allowed) throw new Error('denied:' + who.reason);
  var sh = sheet_('試験_取込', ['record_id', 'created_at', 'branch_name', 'text_length', 'imported_at']);
  var last = sh.getLastRow(), mine = 0, others = 0;
  if (last > 1) sh.getRange(2, 3, last - 1, 1).getValues().forEach(function (r) { if (String(r[0]) === who.branch) mine++; else others++; });
  var out = { role: who.role, roleClass: roleClass_(who.role), branch: who.branch, active_flag: who.active_flag,
    allowed: who.allowed, visibleRowsInOwnBranch: mine, rowsInOtherBranchesDenied: others,
    crossBranchRequest: branchAllowed_(who, '福岡本社') ? 'allowed' : 'denied' };
  log_('me', out);
  return out;
}

function savePhone(info) { var who = lookup_(Session.getActiveUser().getEmail() || ''); if (!who.allowed) throw new Error('denied'); log_('device', info); return true; }

// ---- 試験⑦ 新着表示
function t7Add() { guard_(); var sh = sheet_('試験_新着', ['at', 'note']); sh.appendRow([new Date().toISOString(), '試験の新着行']); SpreadsheetApp.flush(); return { rows: sh.getLastRow() - 1 }; }
function t7Count() { var who = lookup_(Session.getActiveUser().getEmail() || ''); if (!who.allowed) throw new Error('denied'); return sheet_('試験_新着', ['at', 'note']).getLastRow() - 1; }
function t7Reset() { guard_(); var sh = sheet_('試験_新着', ['at', 'note']); if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1); return { ok: true }; }
