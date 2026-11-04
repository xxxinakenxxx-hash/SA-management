// FN-10 storeAttachmentInDrive_／API-09 registerAttachment／API-10 getAttachmentAccess：成果物（添付）の保存と取得。
// 保存先は、営業所のSAがSA画面（SA-05）で設定したDriveフォルダの配下に作る依頼別フォルダ（FN-19）。設定は表 sa_branch_settings に持つ。
// Driveには drive.file（このアプリが作ったファイルだけ扱える）の範囲で保存し、共有設定は変えない。
// ファイルの取得は、依頼本文の閲覧権限とは別に、本人と返却対象を検査してからアプリが中身を返す（Driveの共有リンクは渡さない）。

var SA_ATTACH_MAX_BYTES_ = 10 * 1024 * 1024; // 暫定の上限（容量は正本で未確定。10MB）
var SA_ATTACH_BASE64_MAX_ = Math.ceil(SA_ATTACH_MAX_BYTES_ / 3) * 4 + 8;
var SA_ATTACH_ID_PATTERN_ = /^AT-\d{8}-[0-9A-F]{8}$/;
var SA_ATTACH_LINK_TYPE_ = 'attachment_link';
var SA_ATTACH_FILENAME_MAX_ = 200;

// ---- Driveとの実際のやり取り（試験ではこの4つを差し替える）----
function driveCreateFile_(folderId, fileName, mimeType, bytes) {
  var f = Drive.Files.create({ name: fileName, parents: [folderId], mimeType: mimeType }, Utilities.newBlob(bytes, mimeType, fileName), { supportsAllDrives: true, fields: 'id,name,size,mimeType' });
  return { id: String(f.id), size: f.size === undefined ? null : Number(f.size) };
}
function driveReadBytes_(fileId) {
  var r = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '?alt=media&supportsAllDrives=true', { method: 'get', headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error('DRIVE_READ_' + r.getResponseCode());
  return r.getContent();
}
function driveDelete_(fileId) {
  Drive.Files.remove(fileId, { supportsAllDrives: true });
}
function drivePermissionTypes_(fileId) {
  var r = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '/permissions?fields=permissions(type,role)&supportsAllDrives=true', { method: 'get', headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error('DRIVE_PERM_' + r.getResponseCode());
  return (JSON.parse(r.getContentText()).permissions || []).map(function (p) { return String(p.type); });
}

function storageError_(reason, message) {
  return saError_('STORAGE_ERROR', { reason: reason, errors: [{ field: 'file', message: message }] });
}

// FN-10：ファイルをDriveに保存し、メタデータと共有範囲を確かめる。失敗したら保存したファイルを消して STORAGE_ERROR。
// 戻り値：{ driveFileId, size }。呼び出し側は、成功した後にだけ sa_attachments へ登録する。
function storeAttachmentInDrive_(branchId, requestId, actorId, fileName, mimeType, bytes) {
  var folderId = resolveRequestFolder_(branchId, requestId, actorId); // 設定が無ければ folder_not_set で拒否。依頼別フォルダは無ければ作る
  var file = null;
  try { file = driveCreateFile_(folderId, fileName, mimeType, bytes); } catch (e) { file = null; }
  if (!file || !file.id) throw storageError_('drive_write_failed', '成果物を保存できませんでした。保存先フォルダを確認して、もう一度試してください。');
  var drop = function () { try { driveDelete_(file.id); } catch (e2) { /* 消せない場合は呼び出し側が孤立ファイルとして記録する */ } };
  if (file.size !== null && file.size !== undefined && Number(file.size) !== bytes.length) { drop(); throw storageError_('metadata_mismatch', '保存したファイルの大きさが一致しませんでした。もう一度試してください。'); }
  var types;
  try { types = drivePermissionTypes_(file.id); } catch (e3) { drop(); throw storageError_('permission_check_failed', '保存したファイルの共有範囲を確認できませんでした。もう一度試してください。'); }
  if (types.indexOf('anyone') >= 0 || types.indexOf('domain') >= 0) { drop(); throw storageError_('too_open', '保存先フォルダの共有範囲が広すぎるため、保存しませんでした。共有範囲の狭いフォルダを「保存先設定」で指定してください。'); }
  return { driveFileId: file.id, size: bytes.length };
}

// 保存に失敗した後始末：ファイルを消す。消せなければ孤立ファイルとして履歴に残す（Sheets側の失敗時の復旧用）。
function discardDriveFile_(actorId, requestId, fileId) {
  try { driveDelete_(fileId); return true; } catch (e) {
    try { appendActivityEvent_(actorId, requestId, 'attachment_orphan', '', fileId); } catch (e2) { /* 記録もできない場合は、運用で確認する */ }
    return false;
  }
}

// ---- 表 sa_attachments の読み書き ----
function attachmentObjFromValues_(values) {
  var o = {};
  saHeader_('sa_attachments').forEach(function (n, i) { o[n] = values[i]; });
  return o;
}
function readAllAttachments_() {
  var sh = getTable_('sa_attachments'), last = sh.getLastRow();
  if (last < 2) return [];
  var n = saHeader_('sa_attachments').length;
  return sh.getRange(2, 1, last - 1, n).getValues().map(function (v, i) { return { rowNum: i + 2, obj: attachmentObjFromValues_(v) }; })
    .filter(function (a) { return String(a.obj.attachment_id) !== ''; });
}
function findAttachmentById_(attachmentId) {
  var all = readAllAttachments_();
  for (var i = 0; i < all.length; i++) if (String(all[i].obj.attachment_id) === String(attachmentId)) return all[i];
  return null;
}
function appendAttachmentRow_(obj) {
  var sh = getTable_('sa_attachments'), row = rowFromObject_('sa_attachments', obj), rowNum = sh.getLastRow() + 1;
  sh.getRange(rowNum, 1, 1, row.length).setValues([row]);
  return rowNum;
}
function removeAttachmentRow_(rowNum) { getTable_('sa_attachments').deleteRow(rowNum); }

function attachmentView_(o, names) {
  return { attachmentId: String(o.attachment_id), fileName: String(o.file_name), mimeType: String(o.mime_type), fileSize: Number(o.file_size || 0),
    uploadedByName: displayName_(names, o.uploaded_by_user_id), isReturnedToSales: o.is_returned_to_sales === true, createdAt: String(o.created_at), fileVersion: Number(o.file_version || 1) };
}

function sanitizeFileName_(name) {
  var s = String(name == null ? '' : name).replace(/[\u0000-\u001f\u007f\\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
  if (s === '.' || s === '..') s = '';
  return s.length > SA_ATTACH_FILENAME_MAX_ ? s.slice(0, SA_ATTACH_FILENAME_MAX_) : s;
}
function sanitizeMimeType_(m) {
  var s = String(m == null ? '' : m).trim().toLowerCase();
  return /^[a-z0-9][a-z0-9.+-]{0,60}\/[a-z0-9][a-z0-9.+-]{0,100}$/.test(s) ? s : 'application/octet-stream';
}

// ---- API-09 registerAttachment（SAのみ）----
// 順序：入力検査 → 権限 → 二重実行の確認 → Drive保存（FN-10）→ ロック内で「添付行・スレッドのリンク・履歴」を登録。
// Drive保存の後にSheetsの登録が失敗したら、保存したファイルを消す（消せなければ孤立ファイルを履歴に残す）。
function handleRegisterAttachment_(ctx, params) {
  requireSa_(ctx);
  var v = parseInput_('registerAttachment', params);
  var cur = findRequestById_(v.requestId);
  authorizeRequestAccess_(ctx, cur && cur.obj, 'sa_write');
  var names = userNameMap_(readUserMasterRows_());
  var done = function (dupMsg) {
    var att = dupMsg && findAttachmentById_(String(dupMsg.obj.attachment_id));
    return { duplicate: true, attachment: att ? attachmentView_(att.obj, names) : null };
  };
  var dup = findMessageByOperation_(ctx.userId, v.clientOperationId);
  if (dup && String(dup.obj.message_type) === SA_ATTACH_LINK_TYPE_) return done(dup);
  var bytes;
  try { bytes = Utilities.base64Decode(v.contentBase64); } catch (e) { throw validationError_('file', 'ファイルの内容を読み取れませんでした。', 'BASE64_INVALID'); }
  if (!bytes || !bytes.length) throw validationError_('file', '空のファイルは登録できません。', 'EMPTY_FILE');
  if (bytes.length > SA_ATTACH_MAX_BYTES_) throw validationError_('file', 'ファイルが大きすぎます（上限は' + Math.floor(SA_ATTACH_MAX_BYTES_ / 1048576) + 'MBです）。', 'FILE_TOO_LARGE');
  var stored = storeAttachmentInDrive_(String(cur.obj.branch_id), v.requestId, ctx.userId, v.fileName, v.mimeType, bytes);
  var evId = eventIdFor_(ctx.userId, 'registerAttachment', v.clientOperationId);
  var out;
  try {
    out = withScriptLock_(function () {
      var again = findRequestById_(v.requestId);
      authorizeRequestAccess_(ctx, again && again.obj, 'sa_write');
      var dup2 = findMessageByOperation_(ctx.userId, v.clientOperationId);
      if (dup2 && String(dup2.obj.message_type) === SA_ATTACH_LINK_TYPE_) return { dupMsg: dup2 };
      var now = nowIso_(), attId = newId_('AT'), msgId = newId_('MSG');
      var att = { attachment_id: attId, request_id: v.requestId, drive_file_id: stored.driveFileId, file_name: v.fileName, mime_type: v.mimeType, file_size: stored.size,
        uploaded_by_user_id: ctx.userId, is_returned_to_sales: false, created_at: now, file_version: 1, thread_message_id: msgId };
      var msg = { message_id: msgId, request_id: v.requestId, sender_user_id: ctx.userId, sender_role: 'sa', message_type: SA_ATTACH_LINK_TYPE_, body: v.fileName,
        created_at: now, client_operation_id: v.clientOperationId, corrects_message_id: '', attachment_id: attId };
      var attRow = appendAttachmentRow_(att), msgRow = null;
      try {
        msgRow = appendMessage_(msg);
        appendActivityEvent_(ctx.userId, v.requestId, 'attachment_registered', '', v.fileName, evId);
      } catch (e) {
        try { if (msgRow !== null) removeMessageRow_(msgRow); } catch (e1) { /* 取り消せない場合は、保存失敗として返す */ }
        try { removeAttachmentRow_(attRow); } catch (e2) { /* 同上 */ }
        throw saError_('STORAGE_ERROR');
      }
      return { att: att };
    });
  } catch (e) {
    // 鍵を手放す前の確定に失敗しただけで、登録自体は保存されている場合は、保存したファイルを消さない（添付行がファイルを指したまま残るのを防ぐ）。
    var saved = null;
    try { var m = findMessageByOperation_(ctx.userId, v.clientOperationId); saved = m && String(m.obj.message_type) === SA_ATTACH_LINK_TYPE_ ? findAttachmentById_(String(m.obj.attachment_id)) : null; } catch (e3) { saved = null; }
    if (saved && String(saved.obj.drive_file_id) === stored.driveFileId) throw e;
    discardDriveFile_(ctx.userId, v.requestId, stored.driveFileId);
    throw e;
  }
  if (out.dupMsg) { discardDriveFile_(ctx.userId, v.requestId, stored.driveFileId); return done(out.dupMsg); }
  return { duplicate: false, attachment: attachmentView_(out.att, names) };
}
function registerAttachment(params) { return runApi_(function (ctx) { return handleRegisterAttachment_(ctx, params); }, params); }

// ---- 取得の認可：依頼の閲覧権限とは別に、本人と返却対象を検査する ----
// SA：同じ営業所の依頼の成果物。営業：自分の依頼で、返却対象にされたものだけ。それ以外は、存在を漏らさず NOT_FOUND。
function authorizeAttachmentAccess_(ctx, requestObj, attachmentObj) {
  authorizeRequestAccess_(ctx, requestObj, 'read');
  if (!attachmentObj || String(attachmentObj.request_id) !== String(requestObj.request_id)) throw saError_('NOT_FOUND');
  if (ctx.role === 'sa') return true;
  var isOwner = ctx.role === 'sales' && String(requestObj.sales_user_id).toLowerCase() === String(ctx.userId).toLowerCase();
  if (isOwner && attachmentObj.is_returned_to_sales === true) return true;
  throw saError_('NOT_FOUND');
}

// ---- API-10 getAttachmentAccess ----
// 認可を通った場合だけ、アプリがDriveから読み、中身を返す（Driveの共有リンクは返さない。ファイルの共有範囲も変えない）。
function handleGetAttachmentAccess_(ctx, params) {
  var v = parseInput_('getAttachmentAccess', params);
  var cur = findRequestById_(v.requestId);
  if (!cur) throw saError_('NOT_FOUND');
  var att = findAttachmentById_(v.attachmentId);
  authorizeAttachmentAccess_(ctx, cur.obj, att && att.obj);
  var bytes;
  try { bytes = driveReadBytes_(String(att.obj.drive_file_id)); } catch (e) { throw storageError_('drive_read_failed', 'ファイルを取得できませんでした。時間をおいてやり直してください。'); }
  return { attachmentId: String(att.obj.attachment_id), fileName: String(att.obj.file_name), mimeType: String(att.obj.mime_type), fileSize: bytes.length, contentBase64: Utilities.base64Encode(bytes) };
}
function getAttachmentAccess(params) { return runApi_(function (ctx) { return handleGetAttachmentAccess_(ctx, params); }, params); }
