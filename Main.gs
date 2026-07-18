function doGet(event) {
  let setupMessage = '';
  if (event && event.parameter && event.parameter.setup === '1') {
    const authorization = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL);
    if (authorization.getAuthorizationStatus() === ScriptApp.AuthorizationStatus.REQUIRED) {
      return createAuthorizationPage_(authorization.getAuthorizationUrl());
    }
    try {
      const result = runSetupGuide();
      setupMessage = result.success ? '初期設定が完了しました。' : '初期設定を実行しましたが、診断エラーが残っています。管理・診断画面を確認してください。';
    } catch (error) {
      setupMessage = '初期設定に失敗しました: ' + (error.message || error);
    }
  }
  const template = HtmlService.createTemplateFromFile('Index');
  template.appName = APP_CONFIG.appName;
  template.setupMessage = setupMessage;
  return template.evaluate()
    .setTitle(APP_CONFIG.appName)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function createAuthorizationPage_(authorizationUrl) {
  const safeUrl = String(authorizationUrl || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return HtmlService.createHtmlOutput(
    '<!doctype html><html lang="ja"><head><base target="_top"><meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
    '<body style="max-width:680px;margin:64px auto;padding:24px;font-family:sans-serif;line-height:1.7">' +
    '<h1>初回の権限設定</h1><p>Drive・Googleドキュメント・スプレッドシートへ本人のデータを保存するため、Google の権限確認が必要です。</p>' +
    '<p><a target="_blank" rel="noopener" style="display:inline-block;padding:12px 18px;border-radius:8px;color:#fff;background:#176b5b;text-decoration:none" href="' + safeUrl + '">Google の権限画面を開く</a></p>' +
    '<p>許可後、このタブへ戻って再読み込みしてください。初期フォルダと管理シートが自動作成されます。</p>' +
    '<button onclick="location.reload()" style="padding:10px 16px">認証後に再読み込み</button></body></html>'
  ).setTitle('初回の権限設定');
}

function include(fileName) {
  return HtmlService.createHtmlOutputFromFile(fileName).getContent();
}
