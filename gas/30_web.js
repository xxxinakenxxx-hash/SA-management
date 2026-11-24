// 画面の入口。SA向け画面（SA-01）・営業向け画面（SL）を GAS の中から出す。画面は doGet の view で切り替える。
function cm01Output_(kind, message) {
  var t = HtmlService.createTemplateFromFile('cm01');
  t.kind = kind;
  t.message = message;
  return t.evaluate().setTitle('AIメモSA管理').addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

// 画面の入口。画面の枠（HTML）は、本人確認を待たずにすぐ返す（本人確認のために営業AIの表を読むと、その間ずっと白い画面になるため）。
// 本人確認と権限の検査は、画面が最初に呼ぶ getMyProfile（API-01）と、すべてのAPIでサーバー側が行う。権限がなければ、画面がCM-01（アクセス不可）を出す。
// 画面のHTMLに、業務データ・顧客情報は含まれない。
function doGet(e) {
  var view = String((e && e.parameter && e.parameter.view) || 'sa').trim();
  if (view === 'sa') {
    return HtmlService.createHtmlOutputFromFile('sa').setTitle('AIメモSA管理')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
  }
  if (view === 'sl') {
    var t = HtmlService.createTemplateFromFile('sl');
    var rid = String((e && e.parameter && e.parameter.requestId) || '');
    t.initialRequestId = SA_ID_PATTERN_.test(rid) ? rid : '';
    return t.evaluate().setTitle('SA依頼').addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
  }
  if (view === 'manual') {
    // SA依頼のマニュアル（2026-11-24 利用者指示で掲示。利用者から受け取ったHTMLをそのまま表示する）。
    return HtmlService.createHtmlOutputFromFile('manual').setTitle('AIメモSA管理｜基本作業・ヘルプマニュアル')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
  return cm01Output_('forbidden', 'この画面は、まだ使えません。');
}
