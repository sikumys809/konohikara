/**
 * M_スタッフシートに「退職フラグ TRUE で行をグレー化」する条件付き書式を設定
 * Q列(17列目)のチェックボックスがTRUEなら、A〜S列をグレー背景+グレー文字
 */
function setupRetiredRowFormat() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('M_スタッフ');
  if (!sheet) {
    SpreadsheetApp.getUi().alert('M_スタッフシートが見つかりません');
    return;
  }
  
  const lastRow = Math.max(sheet.getLastRow(), 1000);  // 余裕を持って1000行まで
  const lastCol = sheet.getLastColumn();
  
  // 既存の条件付き書式から「退職フラグ用」を削除 (再実行対応)
  const existingRules = sheet.getConditionalFormatRules();
  const filteredRules = existingRules.filter(rule => {
    const condition = rule.getBooleanCondition();
    if (!condition) return true;
    const formula = condition.getCriteriaValues()[0];
    if (typeof formula === 'string' && formula.indexOf('$Q') !== -1 && formula.indexOf('TRUE') !== -1) {
      return false;  // 退職フラグルールは削除
    }
    return true;
  });
  
  // 新規ルール: 行全体をグレー化 (Q列がTRUE)
  const range = sheet.getRange(2, 1, lastRow - 1, lastCol);
  const newRule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$Q2=TRUE')
    .setBackground('#e5e7eb')   // ライトグレー背景
    .setFontColor('#9ca3af')     // 文字グレー
    .setRanges([range])
    .build();
  
  filteredRules.push(newRule);
  sheet.setConditionalFormatRules(filteredRules);
  
  SpreadsheetApp.getUi().alert(
    '✓ 退職者の行グレー化設定 完了\n\n' +
    '対象シート: M_スタッフ\n' +
    '対象範囲: A2:' + sheet.getRange(1, lastCol).getA1Notation().replace(/\d+/, '') + (lastRow) + '\n' +
    '条件: Q列(退職フラグ) = TRUE\n' +
    '書式: 背景#e5e7eb / 文字#9ca3af'
  );
}
