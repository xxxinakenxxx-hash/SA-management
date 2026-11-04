// 工程04（追加改修）：営業所別Drive保存先設定（API-16/17）と、依頼別フォルダの管理（FN-16〜19）。
// 保存先は、営業所のSAがSA-01内の「保存先設定」（SA-05）で設定する。設定は表 sa_branch_settings に追記して持つ（過去の設定は残す）。
// 営業所は、サーバーが本人の所属から決める。画面から営業所IDが渡されても使わない（本人の所属と違えば拒否）。
// 成果物は、保存先の配下に作る依頼別フォルダ（フォルダ名は依頼ID）へ保存する。依頼別フォルダは表 sa_request_folders に対応付ける。
// Driveの共有設定は変更しない。Drive操作は drive.file の範囲（このアプリが作ったものだけ扱える。既存フォルダの存在確認はできず、その中への作成だけができる）。

var SA_FOLDER_MIME_ = 'application/vnd.google-apps.folder';
var SA_FOLDER_ID_PATTERN_ = /^[A-Za-z0-9_-]{10,100}$/;

// ---- Driveとの実際のやり取り（試験ではこの2つを差し替える。ファイルの削除・共有範囲の取得は16_attachments.jsの関数を使う）----
function driveCreateFolder_(parentId, name) {
  var r = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,parents', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify({ name: name, mimeType: SA_FOLDER_MIME_, parents: [parentId] })
  });
  if (r.getResponseCode() !== 200) throw new Error('DRIVE_FOLDER_' + r.getResponseCode());
  var j = JSON.parse(r.getContentText());
  return { id: String(j.id), parents: j.parents || [] };
}
function driveFindChildFolder_(parentId, name) {
  var q = "'" + parentId + "' in parents and name = '" + name + "' and mimeType = '" + SA_FOLDER_MIME_ + "' and trashed = false";
  var r = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&includeItemsFromAllDrives=true&pageSize=10&fields=files(id)&q=' + encodeURIComponent(q), {
    method: 'get', muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }
  });
  if (r.getResponseCode() !== 200) throw new Error('DRIVE_LIST_' + r.getResponseCode());
  var files = JSON.parse(r.getContentText()).files || [];
  return files.length ? String(files[0].id) : '';
}

// ---- 表（無ければ、鍵の中でだけ作る。既にある表には触れない）----
function optionalTable_(name, create) {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), sh = ss.getSheetByName(name);
  if (sh) return sh;
  if (!create) return null;
  ensureTable_(ss, name);
  return ss.getSheetByName(name);
}
function readOptionalRows_(name) {
  var sh = optionalTable_(name, false);
  if (!sh) return [];
  var last = sh.getLastRow();
  if (last < 2) return [];
  var header = saHeader_(name);
  return sh.getRange(2, 1, last - 1, header.length).getValues().map(function (v, i) {
    var o = { _row: i + 2 }; header.forEach(function (n, k) { o[n] = v[k]; }); return o;
  });
}

// FN-16：URLからDriveフォルダIDを取り出す。フォルダのURLの形でなければ空文字。
function parseDriveFolderUrl_(text) {
  var s = typeof text === 'string' ? text.trim() : '';
  if (!s || s.length > 500) return '';
  var m = s.match(/^https:\/\/drive\.google\.com\/drive\/(?:u\/\d{1,2}\/)?folders\/([A-Za-z0-9_-]+)\/?(?:[?#].*)?$/);
  if (!m) m = s.match(/^https:\/\/drive\.google\.com\/open\?(?:[^#]*&)?id=([A-Za-z0-9_-]+)(?:[&#].*)?$/);
  return m && SA_FOLDER_ID_PATTERN_.test(m[1]) ? m[1] : '';
}

// FN-17：営業所の現在の保存先設定（その営業所の最新の版）。無ければ null。
function readBranchStorageSetting_(branchId) {
  var b = String(branchId || '').trim(), best = null;
  readOptionalRows_('sa_branch_settings').forEach(function (r) {
    if (String(r.branch_id) !== b) return;
    if (!best || Number(r.setting_version) > Number(best.setting_version)) best = r;
  });
  return best;
}

// FN-18：保存先の中に確認用の一時フォルダを作って削除し、フォルダの存在と書込可否を確認する。共有設定は変更しない。
function verifyDriveFolderWritable_(folderId) {
  var probe = null;
  try { probe = driveCreateFolder_(folderId, '.sa-check-' + Utilities.getUuid().slice(0, 8)); } catch (e) { probe = null; }
  if (!probe || !probe.id) throw storageError_('folder_unreachable', 'このフォルダに保存できませんでした。URLと、フォルダの編集権限を確認してください。');
  var drop = function () { try { driveDelete_(probe.id); } catch (e2) { /* 消せなくても、保存先の確認結果には影響しない（空の確認用フォルダが残る） */ } };
  if (probe.parents && probe.parents.length && probe.parents.indexOf(folderId) < 0) { drop(); throw storageError_('folder_unreachable', 'このフォルダに保存できませんでした。URLと、フォルダの編集権限を確認してください。'); }
  var types;
  try { types = drivePermissionTypes_(probe.id); } catch (e3) { drop(); throw storageError_('permission_check_failed', 'フォルダの共有範囲を確認できませんでした。時間をおいてやり直してください。'); }
  drop();
  if (types.indexOf('anyone') >= 0 || types.indexOf('domain') >= 0) throw storageError_('too_open', 'このフォルダは共有範囲が広すぎるため、保存先にできません。共有範囲の狭いフォルダを指定してください。');
  return true;
}

// 依頼別フォルダ（無ければ null）
function findRequestFolder_(requestId) {
  var id = String(requestId), hit = null;
  readOptionalRows_('sa_request_folders').forEach(function (r) { if (String(r.request_id) === id) hit = r; });
  return hit;
}

// FN-19：依頼の依頼別フォルダIDを返す。無ければ、鍵の中で保存先の配下に作って sa_request_folders へ登録する（重複して作らない）。
function resolveRequestFolder_(branchId, requestId, actorId) {
  var have = findRequestFolder_(requestId);
  if (have) return String(have.drive_folder_id);
  return withScriptLock_(function () {
    var again = findRequestFolder_(requestId);
    if (again) return String(again.drive_folder_id);
    var setting = readBranchStorageSetting_(branchId);
    if (!setting) throw storageError_('folder_not_set', '成果物の保存先フォルダが設定されていません。画面の「保存先設定」から設定してください。');
    var base = String(setting.drive_folder_id), name = String(requestId), fid = '', created = false;
    try { fid = driveFindChildFolder_(base, name); } catch (e) { throw storageError_('drive_lookup_failed', '保存先フォルダを確認できませんでした。時間をおいてやり直してください。'); }
    if (!fid) {
      try { fid = driveCreateFolder_(base, name).id; created = true; } catch (e2) { throw storageError_('folder_create_failed', '依頼ごとのフォルダを作れませんでした。保存先フォルダの権限を確認してください。'); }
    }
    try {
      var sh = optionalTable_('sa_request_folders', true);
      var row = rowFromObject_('sa_request_folders', { request_id: requestId, branch_id: branchId, drive_folder_id: fid, base_setting_id: String(setting.setting_id), created_by_user_id: actorId, created_at: nowIso_() });
      sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setValues([row]);
    } catch (e3) {
      if (created) { try { driveDelete_(fid); } catch (e4) { /* 消せなければ、次の登録時に同名フォルダとして見つけて再利用する */ } }
      throw saError_('STORAGE_ERROR');
    }
    return fid;
  });
}

// ---- 認可と入力の検査 ----
// 画面から営業所IDが渡されても使わない。本人の所属と違う営業所IDは拒否する（存在を漏らさない）。
function assertOwnBranch_(ctx, branchId) {
  if (branchId && String(branchId) !== String(ctx.branch)) throw saError_('FORBIDDEN');
}
// 保存先にできないフォルダ：他の営業所の現在の保存先、または、どこかの依頼別フォルダ。理由は具体的に返さない。
function assertFolderAllowed_(folderId, branchId) {
  var latest = {};
  readOptionalRows_('sa_branch_settings').forEach(function (r) {
    var b = String(r.branch_id);
    if (!latest[b] || Number(r.setting_version) > Number(latest[b].setting_version)) latest[b] = r;
  });
  var bad = Object.keys(latest).some(function (b) { return b !== String(branchId) && String(latest[b].drive_folder_id) === folderId; })
    || readOptionalRows_('sa_request_folders').some(function (r) { return String(r.drive_folder_id) === folderId; });
  if (bad) throw validationError_('folderUrl', 'このフォルダは保存先に使えません。別のフォルダを指定してください。', 'FOLDER_NOT_ALLOWED');
}

function storageSettingView_(branchId, row, names) {
  if (!row) return { configured: false, branchId: String(branchId), folderUrl: '', settingVersion: 0, setByName: '', setAt: '' };
  return { configured: true, branchId: String(branchId), folderUrl: 'https://drive.google.com/drive/folders/' + String(row.drive_folder_id), settingVersion: Number(row.setting_version),
    setByName: displayName_(names, row.set_by_user_id), setAt: String(row.set_at) };
}

// API-16：本人の所属営業所の保存先設定
function handleGetBranchStorageSetting_(ctx, params) {
  requireSa_(ctx);
  var v = parseInput_('getBranchStorageSetting', params);
  assertOwnBranch_(ctx, v.branchId);
  return storageSettingView_(ctx.branch, readBranchStorageSetting_(ctx.branch), userNameMap_(readUserMasterRows_()));
}

// API-17：本人の所属営業所の保存先を登録・変更する
function handleSaveBranchStorageSetting_(ctx, params) {
  requireSa_(ctx);
  var v = parseInput_('saveBranchStorageSetting', params);
  assertOwnBranch_(ctx, v.branchId);
  var branch = String(ctx.branch), names = userNameMap_(readUserMasterRows_());
  var folderId = parseDriveFolderUrl_(v.folderUrl);
  if (!folderId) throw validationError_('folderUrl', 'Googleドライブのフォルダの共有URL（https://drive.google.com/drive/folders/…）を入力してください。', 'FOLDER_URL_INVALID');
  var cur0 = readBranchStorageSetting_(branch);
  if (cur0 && String(cur0.drive_folder_id) === folderId) return { unchanged: true, setting: storageSettingView_(branch, cur0, names) }; // 再送：同じ結果を返す
  assertFolderAllowed_(folderId, branch);
  verifyDriveFolderWritable_(folderId); // Drive操作は鍵の外で行う
  var out = withScriptLock_(function () {
    var cur = readBranchStorageSetting_(branch), ver = cur ? Number(cur.setting_version) : 0;
    if (cur && String(cur.drive_folder_id) === folderId) return { unchanged: true, row: cur };
    if (ver !== v.expectedSettingVersion) throw saError_('CONFLICT', { reason: 'version' });
    assertFolderAllowed_(folderId, branch);
    var sh = optionalTable_('sa_branch_settings', true);
    var obj = { setting_id: newId_('BS'), branch_id: branch, drive_folder_id: folderId, setting_version: ver + 1, set_by_user_id: ctx.userId, set_at: nowIso_() };
    var row = rowFromObject_('sa_branch_settings', obj);
    sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setValues([row]);
    return { unchanged: false, row: obj };
  });
  return { unchanged: out.unchanged, setting: storageSettingView_(branch, out.row, names) };
}

function getBranchStorageSetting(params) { return runApi_(function (ctx) { return handleGetBranchStorageSetting_(ctx, params); }, params); }
function saveBranchStorageSetting(params) { return runApi_(function (ctx) { return handleSaveBranchStorageSetting_(ctx, params); }, params); }
