function checkValidationRules() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('M_スタッフ');
  const lastCol = sheet.getLastColumn();
  const lastRow = sheet.getLastRow();

  const header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

  Logger.log('========== M_スタッフ 入力規則チェック ==========');
  Logger.log('シート: ' + sheet.getName());
  Logger.log('列数: ' + lastCol + ', 行数: ' + lastRow);
  Logger.log('');

  for (let col = 1; col <= lastCol; col++) {
    const colName = header[col - 1];
    const colLetter = String.fromCharCode(64 + col); // A=1, B=2, ...

    // 列全体の規則を取得 (2行目から最終行まで)
    const rules = sheet.getRange(2, col, lastRow - 1, 1).getDataValidations();

    // 規則をパターンごとに分類
    const patternMap = {};
    rules.forEach((row, idx) => {
      const rule = row[0];
      let key = '(規則なし)';
      if (rule) {
        const criteria = rule.getCriteriaType();
        const args = rule.getCriteriaValues();
        key = String(criteria) + ':' + JSON.stringify(args).substring(0, 100);
      }
      if (!patternMap[key]) patternMap[key] = [];
      patternMap[key].push(idx + 2);  // 行番号
    });

    Logger.log('--- 列 ' + colLetter + ': ' + colName + ' ---');
    const patterns = Object.keys(patternMap);
    Logger.log('  規則パターン数: ' + patterns.length);

    patterns.forEach(p => {
      const rowList = patternMap[p];
      const sampleRows = rowList.slice(0, 5).join(',') + (rowList.length > 5 ? '...' : '');
      Logger.log('  [' + rowList.length + '行] ' + p);
      Logger.log('    対象行: ' + sampleRows);
    });
    Logger.log('');
  }

  Logger.log('========== 完了 ==========');
}
