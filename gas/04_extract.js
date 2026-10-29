// FN-15 extractSaRequestFields_：OpenAI（営業AIと同じ gpt-4o-mini）でSA依頼の5項目を抽出する。
// 元の文章は書き換えない。抽出結果と抽出状態は別の列に保存する。
var SA_OPENAI_URL_ = 'https://api.openai.com/v1/chat/completions';
var SA_OPENAI_MODEL_ = 'gpt-4o-mini';
var SA_OPENAI_MAX_RETRY_ = 3;

var SA_EXTRACT_SCHEMA_ = {
  name: 'sa_request_fields',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['recipient', 'action', 'request_type', 'fixed_conditions', 'due_text', 'due_date', 'due_urgent'],
    properties: {
      recipient: { type: ['string', 'null'] },
      action: { type: ['string', 'null'] },
      request_type: { type: ['string', 'null'] },
      fixed_conditions: { type: ['string', 'null'] },
      due_text: { type: ['string', 'null'] },
      due_date: { type: ['string', 'null'] },
      due_urgent: { type: 'boolean' }
    }
  }
};

// OpenAIへの1回の送信（差し替え可能な薄い関数）。
function openAiRequest_(payload) {
  var key = String(PropertiesService.getScriptProperties().getProperty('AI_API_KEY') || '').trim();
  if (!key) throw new Error('AI_API_KEY_MISSING');
  var r = UrlFetchApp.fetch(SA_OPENAI_URL_, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + key },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  return { code: r.getResponseCode(), text: r.getContentText() };
}

// 4xxは再試行しない。429と5xxだけ、待ち時間を倍にして最大3回再試行する（1秒・2秒・4秒）。
function callOpenAiWithRetry_(payload) {
  var codes = [];
  for (var attempt = 0; attempt <= SA_OPENAI_MAX_RETRY_; attempt++) {
    var r;
    try {
      r = openAiRequest_(payload);
    } catch (e) {
      return { ok: false, code: -1, text: '', attempts: codes.length + 1, codes: codes, error: errorCode_(e) };
    }
    codes.push(r.code);
    if (r.code === 200) return { ok: true, code: 200, text: r.text, attempts: codes.length, codes: codes };
    var retryable = r.code === 429 || r.code >= 500;
    if (!retryable || attempt === SA_OPENAI_MAX_RETRY_) {
      return { ok: false, code: r.code, text: '', attempts: codes.length, codes: codes, error: 'AI_HTTP_' + r.code };
    }
    Utilities.sleep(1000 * Math.pow(2, attempt));
  }
  return { ok: false, code: -1, text: '', attempts: codes.length, codes: codes, error: 'AI_UNKNOWN' };
}

// 文字列「null」・空文字は null に直す（返りの「null」を取込時に正規化する）。
function normalizeNullText_(v) {
  if (v === null || v === undefined) return null;
  var t = String(v).trim();
  if (t === '' || t.toLowerCase() === 'null') return null;
  return t;
}

function validIsoDate_(s) {
  var m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  var d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

function buildCalendarTable_(baseDate) {
  if (!validIsoDate_(baseDate)) return [];
  var m = String(baseDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  var start = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  var sinceMonday = (new Date(start).getUTCDay() + 6) % 7;
  var weekNames = ['今週', '来週', '再来週'];
  function pad(n) { return ('0' + n).slice(-2); }
  var rows = [];
  for (var i = 0; i < 42; i++) {
    var d = new Date(start + i * 86400000);
    var iso = d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
    var weekIndex = Math.floor((i + sinceMonday) / 7);
    var tags = [];
    if (i === 0) tags.push('今日');
    if (i === 1) tags.push('明日');
    if (i === 2) tags.push('明後日');
    if (new Date(start + (i + 1) * 86400000).getUTCMonth() !== d.getUTCMonth()) tags.push('月末');
    rows.push({
      date: iso,
      line: iso + '(' + '日月火水木金土'.charAt(d.getUTCDay()) + ') ' + (weekIndex < 3 ? weekNames[weekIndex] : weekIndex + '週後') + (tags.length ? ' ' + tags.join('・') : '')
    });
  }
  return rows;
}

// 依頼文に固有の中身がない一般語（「SA」「依頼」「SA依頼」など）。値として採用しない。
function isGenericWord_(text) {
  var t = String(text).normalize('NFKC').replace(/[\s　「」『』()。、．.・:：]/g, '').toUpperCase();
  if (!t) return true;
  return /^(SA|SAさん|SA様|SA担当|SA担当者|SA依頼|依頼|ご依頼|お願い|営業支援|営業支援担当|営業支援担当者|担当者|担当|依頼内容|依頼先)$/.test(t);
}

// 文字列「null」・空文字・一般語は null に直す。
function normalizeFieldText_(v) {
  var t = normalizeNullText_(v);
  return t === null || isGenericWord_(t) ? null : t;
}

function buildExtractionPayload_(input, model) {
  var base = String(input.baseDate || '');
  var table = buildCalendarTable_(base);
  var system = 'あなたは、営業から営業支援担当（SA）への依頼文を整理する。依頼文から次の項目を取り出す。' +
    '依頼文に書かれていない項目は推測せず、文字列の "null" ではなく JSON の null にする。' +
    '「SA」「SAさん」「担当者」「依頼」「SA依頼」のような、依頼文に固有の中身がない一般語は、どの項目にも値として入れない（その場合は null）。' +
    'recipient=誰に：依頼文に書かれた具体的な相手（人名・部署名・取引先名など）だけ。依頼先がSAであることは自明なので入れない。書かれていなければ null。' +
    'action=何を：依頼内容。' +
    'request_type=依頼の種類：「見積」「資料作成」「サンプル手配」のように、依頼の種類が依頼文に明示されている場合だけ。内容から種類名を推測して作らない。明示されていなければ null。' +
    'fixed_conditions=決まっていること：依頼文に明記された条件・仕様・数量などだけ。なければ null。' +
    'due_text=いつまで：期限の表現を原文のまま。なければ null。' +
    'due_date=期限の日付（yyyy-MM-dd）：' + (table.length
      ? '下の早見表にある日付の中から選ぶ。期限の表現が早見表のどの日付を指すか特定できないとき、または表にない日付になるときは null。\n【早見表（依頼日 ' + base + '）】\n' + table.map(function (r) { return r.line; }).join('\n') + '\n'
      : '依頼日が分からないため、常に null。') +
    'due_urgent=「なるべく早く」「至急」等の急ぎ表現なら true（日付は付けない）、そうでなければ false。';
  var user = '依頼件名：' + String(input.dealTheme || '') + '\n依頼文：' + String(input.originalText || '') +
    (input.dealContent ? '\n補足：' + String(input.dealContent) : '');
  return {
    model: model || SA_OPENAI_MODEL_,
    temperature: 0,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    response_format: { type: 'json_schema', json_schema: SA_EXTRACT_SCHEMA_ }
  };
}

// 文章から5項目を取り出す（保存はしない）。
// input：{ dealTheme, originalText, dealContent, baseDate }。options：{ model }。
function extractFieldsFromText_(input, options) {
  var model = options && options.model;
  var r = callOpenAiWithRetry_(buildExtractionPayload_(input, model));
  var out = { ok: false, status: 'failed', attempts: r.attempts, codes: r.codes, fields: null, usage: null, error: r.error || '' };
  if (!r.ok) return out;
  var parsed;
  try {
    var body = JSON.parse(r.text);
    out.usage = body.usage || null;
    parsed = JSON.parse(body.choices[0].message.content);
  } catch (e) {
    out.error = 'AI_PARSE_ERROR';
    return out;
  }
  // 期限の日付は、早見表にある日付だけを採用する（表にない・形式が違う日付は null。期限の原文 dueText は保持する）。
  var inTable = {};
  buildCalendarTable_(String(input.baseDate || '')).forEach(function (r) { inTable[r.date] = true; });
  var due = normalizeNullText_(parsed.due_date);
  if (due !== null && (!validIsoDate_(due) || !inTable[due])) due = null;
  var fields = {
    recipient: normalizeFieldText_(parsed.recipient),
    action: normalizeFieldText_(parsed.action),
    requestType: normalizeFieldText_(parsed.request_type),
    fixedConditions: normalizeFieldText_(parsed.fixed_conditions),
    dueText: normalizeFieldText_(parsed.due_text),
    dueDate: due,
    dueUrgent: parsed.due_urgent === true
  };
  out.ok = true;
  out.fields = fields;
  // 5項目がすべて取れたら complete。1つでも空なら人の確認が要る（needs_review）。推測で埋めない。
  var five = [fields.recipient, fields.action, fields.requestType, fields.fixedConditions, fields.dueText];
  out.status = five.every(function (x) { return x !== null; }) ? 'complete' : 'needs_review';
  return out;
}

function findRequestRow_(requestId) {
  var sh = getTable_('sa_requests');
  var last = sh.getLastRow();
  if (last < 2) return null;
  var header = saHeader_('sa_requests');
  var ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(requestId)) {
      var rowNum = i + 2;
      return { sheet: sh, rowNum: rowNum, header: header, values: sh.getRange(rowNum, 1, 1, header.length).getValues()[0] };
    }
  }
  return null;
}

// FN-15：1件の依頼（抽出状態が pending）の5項目を抽出して保存する。
// OpenAIへの送信はロックの外で行い、保存は row_version を確認したうえでロック内で行う。
function extractSaRequestFields_(requestId) {
  var cur = findRequestRow_(requestId);
  if (!cur) return { requestId: requestId, skipped: 'NOT_FOUND' };
  var idx = saColumnIndex_('sa_requests');
  var v = cur.values;
  if (String(v[idx.extraction_status]) !== 'pending') return { requestId: requestId, skipped: 'NOT_PENDING' };
  var version = Number(v[idx.row_version]);
  var result = extractFieldsFromText_({
    dealTheme: v[idx.source_deal_theme],
    originalText: v[idx.source_original_text],
    dealContent: v[idx.source_deal_content],
    baseDate: String(v[idx.source_recorded_at]).slice(0, 10)
  });
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { requestId: requestId, skipped: 'LOCK_TIMEOUT' };
  try {
    var latest = findRequestRow_(requestId);
    if (!latest || Number(latest.values[idx.row_version]) !== version || String(latest.values[idx.extraction_status]) !== 'pending') {
      return { requestId: requestId, skipped: 'CONFLICT' };
    }
    var row = latest.values.slice();
    var now = nowIso_();
    if (result.ok) {
      var f = result.fields;
      row[idx.sa_recipient] = f.recipient === null ? '' : f.recipient;
      row[idx.sa_action] = f.action === null ? '' : f.action;
      row[idx.sa_request_type] = f.requestType === null ? '' : f.requestType;
      row[idx.sa_fixed_conditions] = f.fixedConditions === null ? '' : f.fixedConditions;
      row[idx.sa_due_date_text] = f.dueText === null ? '' : f.dueText;
      row[idx.sa_due_date] = f.dueDate === null ? '' : f.dueDate;
      row[idx.sa_due_urgent] = f.dueUrgent;
      row[idx.extracted_at] = now;
    }
    row[idx.extraction_status] = result.status;
    row[idx.updated_at] = now;
    row[idx.row_version] = version + 1;
    latest.sheet.getRange(latest.rowNum, 1, 1, row.length).setValues([row]);
    return { requestId: requestId, status: result.status, attempts: result.attempts, error: result.error };
  } finally {
    lock.releaseLock();
  }
}

// 抽出状態が pending の依頼を、古い順に最大 limit 件処理する（定期実行から呼ぶ）。
function extractPendingRequests_(limit) {
  var sh = getTable_('sa_requests');
  var last = sh.getLastRow();
  var summary = { processed: 0, complete: 0, needs_review: 0, failed: 0, skipped: 0 };
  if (last < 2) return summary;
  var idx = saColumnIndex_('sa_requests');
  var values = sh.getRange(2, 1, last - 1, saHeader_('sa_requests').length).getValues();
  var max = limit || 10;
  for (var i = 0; i < values.length && summary.processed < max; i++) {
    if (String(values[i][idx.extraction_status]) !== 'pending') continue;
    var r = extractSaRequestFields_(values[i][idx.request_id]);
    if (r.skipped) { summary.skipped++; continue; }
    summary.processed++;
    summary[r.status]++;
  }
  return summary;
}
