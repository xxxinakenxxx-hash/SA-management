// SA画面の「集計」（月間・SA別・営業別。2026-11-24 利用者指示で追加）。
// 自分の営業所の依頼を、アーカイブした依頼も含めて数える（アーカイブは一覧を片付けるためのもので、実際の仕事に含まれる）。
// 数え方：
//   受付＝その月に受け付けた依頼（受付日時＝営業AIメモの記録日時。無ければ取込日時）
//   完了＝その月に完了した依頼（今の状態が完了で、完了日時がその月）
//   対応中・営業回答待ち・未担当＝その月に受け付けた依頼のうち、今その状態のもの
//   平均日数＝その月に完了した依頼の、受付から完了までの日数の平均（小数1桁）
// どの数字も、数えた依頼の一覧（依頼ID）を一緒に返し、画面で数字を押すと依頼が出せるようにする。

var SA_MONTH_PATTERN_ = /^\d{4}-(0[1-9]|1[0-2])$/;

// 'yyyy-MM-dd…' や 'yyyy/M/d …' から 'yyyy-MM' を取り出す。読めなければ空文字。
function monthOf_(text) {
  var m = String(text == null ? '' : text).trim().match(/^(\d{4})[-\/](\d{1,2})/);
  return m ? m[1] + '-' + ('0' + m[2]).slice(-2) : '';
}

function receivedAtOf_(o) { return String(o.source_recorded_at || o.created_at || ''); }

// 日時の文字列（ISO 8601 か 'yyyy/MM/dd HH:mm:ss'）を時刻に直す。読めなければ null。
function timeOf_(text) {
  var s = String(text == null ? '' : text).trim();
  if (!s) return null;
  var iso = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!iso) return null;
  var t = Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), Number(iso[4]) - 9, Number(iso[5]), Number(iso[6] || 0));
  return isNaN(t) ? null : t;
}

function avgDays_(list) {
  var days = list.map(function (o) {
    var a = timeOf_(receivedAtOf_(o)), b = timeOf_(o.completed_at);
    return a === null || b === null || b < a ? null : (b - a) / 86400000;
  }).filter(function (d) { return d !== null; });
  if (!days.length) return null;
  return Math.round(days.reduce(function (x, y) { return x + y; }, 0) / days.length * 10) / 10;
}

function handleGetMonthlySummary_(ctx, params) {
  requireSa_(ctx);
  var p = params || {};
  var month = typeof p.month === 'string' ? p.month.trim() : '';
  if (month && !SA_MONTH_PATTERN_.test(month)) throw validationError_('month', '月の指定が正しくありません（yyyy-MM）。', 'BAD_MONTH');
  var names = userNameMap_(readUserMasterRows_());
  var rows = readAllRequests_().map(function (r) { return r.obj; }).filter(function (o) { return String(o.branch_id) === String(ctx.branch); });

  var monthSet = {};
  rows.forEach(function (o) {
    var a = monthOf_(receivedAtOf_(o)); if (a) monthSet[a] = true;
    if (String(o.status) === 'completed') { var c = monthOf_(o.completed_at); if (c) monthSet[c] = true; }
  });
  var thisMonth = Utilities.formatDate(new Date(), SA_TZ_, 'yyyy-MM');
  monthSet[thisMonth] = true;
  if (!month) month = thisMonth;
  monthSet[month] = true;
  var months = Object.keys(monthSet).sort().reverse();

  var received = rows.filter(function (o) { return monthOf_(receivedAtOf_(o)) === month; });
  var completed = rows.filter(function (o) { return String(o.status) === 'completed' && monthOf_(o.completed_at) === month; });
  var ids = function (list) { return list.map(function (o) { return String(o.request_id); }); };
  var byStatus = function (list, st) { return list.filter(function (o) { return String(o.status) === st; }); };
  var openList = function (list) { return list.filter(function (o) { return String(o.status) !== 'completed'; }); };

  var total = {
    received: ids(received), completed: ids(completed), open: ids(openList(received)),
    avgDays: avgDays_(completed)
  };

  // SA別：担当SA（今の担当）ごと。担当が無い依頼は「未担当」の行にまとめる。
  var saMap = {};
  var saRow = function (key) {
    return saMap[key] || (saMap[key] = { userId: key, name: key ? displayName_(names, key) : '未担当', received: [], completed: [], in_progress: [], waiting_sales: [], unassigned: [], doneList: [] });
  };
  received.forEach(function (o) {
    var r = saRow(String(o.assigned_sa_user_id || ''));
    r.received.push(o);
    if (r[String(o.status)]) r[String(o.status)].push(o);
  });
  completed.forEach(function (o) { var r = saRow(String(o.assigned_sa_user_id || '')); r.doneList.push(o); });
  var bySa = Object.keys(saMap).map(function (k) {
    var r = saMap[k];
    return { userId: r.userId, name: r.name, received: ids(r.received), completed: ids(r.doneList), in_progress: ids(r.in_progress), waiting_sales: ids(r.waiting_sales), unassigned: ids(r.unassigned), avgDays: avgDays_(r.doneList) };
  }).sort(function (a, b) { return (a.userId === '') - (b.userId === '') || b.received.length - a.received.length || (a.name < b.name ? -1 : 1); });

  // 営業別：依頼した営業ごと。
  var salesMap = {};
  var salesRow = function (key) { return salesMap[key] || (salesMap[key] = { userId: key, name: displayName_(names, key), received: [], completed: [], open: [] }); };
  received.forEach(function (o) { var r = salesRow(String(o.sales_user_id || '')); r.received.push(o); if (String(o.status) !== 'completed') r.open.push(o); });
  completed.forEach(function (o) { salesRow(String(o.sales_user_id || '')).completed.push(o); });
  var bySales = Object.keys(salesMap).map(function (k) {
    var r = salesMap[k];
    return { userId: r.userId, name: r.name, received: ids(r.received), completed: ids(r.completed), open: ids(r.open) };
  }).sort(function (a, b) { return b.received.length - a.received.length || (a.name < b.name ? -1 : 1); });

  // 数字を押したときに出す依頼の情報（この月に関係する依頼だけ）。
  var seen = {}, items = [];
  received.concat(completed).forEach(function (o) {
    var id = String(o.request_id);
    if (seen[id]) return; seen[id] = true;
    items.push(toListItem_(o, names, null));
  });
  return { month: month, months: months, total: total, bySa: bySa, bySales: bySales, items: items };
}
function getMonthlySummary(params) { return runApi_(function (ctx) { return handleGetMonthlySummary_(ctx, params); }, params); }
