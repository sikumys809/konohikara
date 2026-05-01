// ============================================================
// V_警告チェックシート 初期化スクリプト
// 実行: setupWarningSheet()
// ============================================================

function setupWarningSheet() {
  Logger.log('========== V_警告チェックシート 初期化 ==========');
  const result = initWarningSheet();
  Logger.log('完了: ' + JSON.stringify(result));
  return result;
}
