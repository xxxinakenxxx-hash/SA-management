// 画面の入口。SA向け画面（SA-01）と、アクセス不可などの共通表示（CM-01）を GAS の中から出す。
// 画面は doGet の view で切り替える。本人は resolveAuthenticatedUser_() で確定し、SA以外にはSA画面を出さない。
function authFailureMessage_(ctx) {
  var m = {
    email_missing: 'ログイン中のメールアドレスを取得できませんでした。会社のGoogleアカウントでログインし直してください。',
    not_in_master: '登録されていない担当者です。管理者に連絡してください。',
    inactive: 'このアカウントは現在、利用が停止されています。管理者に連絡してください。',
    role_not_permitted: '利用権限が設定されていません。管理者に連絡してください。',
    branch_missing: '所属営業所が設定されていません。管理者に連絡してください。'
  };
  if (ctx.reason === 'role_not_permitted' && ctx.masterRole) {
    return 'この画面はSA担当者（営業支援担当）用です。あなたの役割は「' + (SA_ROLE_LABELS_[ctx.masterRole] || ctx.masterRole) + '」のため、使えません。';
  }
  return m[ctx.reason] || SA_ERROR_MESSAGES_[ctx.code] || SA_ERROR_MESSAGES_.FORBIDDEN;
}

function cm01Output_(kind, message) {
  var t = HtmlService.createTemplateFromFile('cm01');
  t.kind = kind;
  t.message = message;
  return t.evaluate().setTitle('AIメモSA管理').addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

function doGet(e) {
  var view = String((e && e.parameter && e.parameter.view) || 'sa').trim();
  var ctx;
  try {
    ctx = resolveAuthenticatedUser_();
  } catch (err) {
    return cm01Output_('communication', '利用者の確認中に問題が起きました。時間をおいて開き直してください。');
  }
  if (!ctx.ok) return cm01Output_(ctx.code === 'AUTH_REQUIRED' ? 'auth' : 'forbidden', authFailureMessage_(ctx));
  if (view === 'sa') {
    if (ctx.role !== 'sa') {
      return cm01Output_('forbidden', 'この画面はSA担当者（営業支援担当）用です。あなたの役割は「' + (SA_ROLE_LABELS_[ctx.masterRole] || ctx.masterRole) + '」のため、使えません。');
    }
    return HtmlService.createHtmlOutputFromFile('sa').setTitle('AIメモSA管理')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
  }
  return cm01Output_('forbidden', 'この画面は、まだ使えません。');
}
