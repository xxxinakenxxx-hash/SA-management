// FN-04 readSourceSaRecords_：営業AIの表をSheets API読み取り専用（spreadsheets.readonly）で読み、
// 営業所名と deal_theme「SA依頼｜」で絞る。営業AIの表には書き込まない。
var SA_SOURCE_COLUMNS_ = ['record_id', 'created_at', 'branch_name', 'user_key', 'deal_theme', 'original_text', 'deal_content'];

function readSourceSaRecords_(branchName) {
  var branch = String(branchName == null ? '' : branchName).trim();
  if (!branch) throw new Error('BRANCH_REQUIRED');
  var res = Sheets.Spreadsheets.Values.get(getSalesDbId_(), "'deal_records'");
  var v = res.values || [];
  if (!v.length) throw new Error('SOURCE_EMPTY');
  var idx = {};
  v[0].forEach(function (n, i) { idx[String(n).trim()] = i; });
  SA_SOURCE_COLUMNS_.forEach(function (n) {
    if (idx[n] === undefined) throw new Error('SOURCE_COLUMN_MISSING:' + n);
  });
  function cell(row, name) {
    var x = row[idx[name]];
    return x === undefined || x === null ? '' : String(x);
  }
  var out = [];
  for (var i = 1; i < v.length; i++) {
    var row = v[i];
    var id = cell(row, 'record_id').trim();
    if (!id) continue;
    if (cell(row, 'deal_theme').indexOf(SA_PREFIX_) !== 0) continue;
    if (cell(row, 'branch_name').trim() !== branch) continue;
    out.push({
      record_id: id,
      created_at: cell(row, 'created_at'),
      branch_name: cell(row, 'branch_name').trim(),
      user_key: cell(row, 'user_key'),
      deal_theme: cell(row, 'deal_theme'),
      original_text: cell(row, 'original_text'),
      deal_content: cell(row, 'deal_content')
    });
  }
  return out;
}
