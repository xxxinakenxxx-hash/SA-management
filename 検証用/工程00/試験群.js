// 工程00 試験②〜⑥（検証用）。結果は戻り値と、SA管理表の「試験ログ」シートに残す。
// ID・キーは書かない（配置時に差し替え／スクリプトプロパティから読む）。
var SA_FOLDER_ID_ = '__SA_FOLDER_ID__';


// 試験用の関数は管理者（sysadmin）本人だけが呼べる。
function guard_() {
  var who = lookup_(Session.getActiveUser().getEmail() || '');
  if (!who.allowed || who.role !== 'sysadmin') throw new Error('denied:' + (who.reason || 'role_not_permitted'));
}

function getExecUrl() { guard_(); return ScriptApp.getService().getUrl(); }
function savePage(summary) { guard_(); log_('page', summary); return true; }

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
  sh.getRange(1, 1, 1, 5).setValues([['request_id', 'version', 'assignee', 'updated_at', 'note']]);
  sh.getRange(2, 1, 4, 5).setValues([['R1', 1, '', '', ''], ['R2', 1, '', '', ''], ['R3', 1, '', '', ''], ['R4', 1, '', '', '']]);
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
  var out = {};
  // 既存フォルダ（ユーザーが作ったSA管理フォルダ）が扱えるか
  var ex = drv_('files/' + SA_FOLDER_ID_ + '?fields=id,name&supportsAllDrives=true');
  out.existingFolderVisible = ex.code === 200;
  out.existingFolderCode = ex.code;
  // 営業AIの表のファイルが扱えるか（書き込みにつながる経路がないことの確認）
  var sales = drv_('files/' + SALES_DB_ID_ + '?fields=id&supportsAllDrives=true');
  out.salesDbVisibleToDriveScope = sales.code === 200;
  out.salesDbCode = sales.code;
  // 既存フォルダの下に新規作成できるか
  var folder = null;
  try {
    folder = Drive.Files.create({ name: '試験_鹿児島', mimeType: 'application/vnd.google-apps.folder', parents: [SA_FOLDER_ID_] });
    out.createUnderExistingFolder = 'ok';
  } catch (e) {
    out.createUnderExistingFolder = 'ng: ' + String(e.message).slice(0, 200);
  }
  if (!folder) {
    folder = Drive.Files.create({ name: '試験_鹿児島(root)', mimeType: 'application/vnd.google-apps.folder' });
    out.createdAtRootInstead = true;
  }
  out.testFolderId = folder.id;
  // 保存（フォルダ内にテキストファイル）
  var blob = Utilities.newBlob('工程00 試験ファイル(架空)', 'text/plain', '試験_添付.txt');
  var f = Drive.Files.create({ name: '試験_添付.txt', parents: [folder.id] }, blob);
  out.saved = !!f.id;
  // 取り出し
  var got = drv_('files/' + f.id + '?alt=media');
  out.readBack = got.code === 200 && got.text.indexOf('工程00') >= 0;
  // 権限の種類（人数と種類だけ）
  var perm = drv_('files/' + f.id + '/permissions?fields=permissions(type,role)');
  try { out.permissions = JSON.parse(perm.text).permissions.map(function (p) { return p.type + '/' + p.role; }); } catch (e) { out.permissions = 'error:' + perm.code; }
  var fm = drv_('files/' + f.id + '?fields=parents,webViewLink');
  try { var j = JSON.parse(fm.text); out.parentIsExistingFolder = (j.parents || []).indexOf(SA_FOLDER_ID_) >= 0; } catch (e) {}
  // 権限外：リンクを知る全員に開く設定にはしない（変更しない）。
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

function extract_(model, text, maxTry) {
  var sys = 'あなたはSA依頼の文章から5項目を取り出す。書かれていない項目はnullにする。推測で補わない。' +
    '項目：to_whom=誰に、what=何を、request_type=依頼の種類、decided=決まっていること、due=いつまで。';
  var tries = [], i;
  for (i = 0; i < (maxTry || 3); i++) {
    var r = ai_('chat/completions', { model: model, temperature: 0,
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
function t6BadRequest() {
  guard_();
  var r = extract_('no-such-model-xyz', '架空', 3);
  var out = { ok: r.ok, tries: r.tries, error: (r.error || '').slice(0, 120) };
  log_('t6bad', out);
  return out;
}
