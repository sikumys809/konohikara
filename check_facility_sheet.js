function checkFacilitySheet() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('M_施設');

  if (!sheet) {
    Logger.log('M_施設シートが見つかりません');
    return;
  }

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();

  Logger.log('========== M_施設シートの構造 ==========');
  Logger.log('行数: ' + lastRow + ', 列数: ' + lastCol);

  // ヘッダ行
  const header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  Logger.log('--- ヘッダ ---');
  header.forEach((h, i) => {
    const colLetter = String.fromCharCode(65 + i);
    Logger.log('  ' + colLetter + ' (' + i + '): ' + JSON.stringify(h));
  });

  // 上位5行のデータ
  Logger.log('');
  Logger.log('--- 上位5行のデータ ---');
  const sampleRows = Math.min(5, lastRow - 1);
  if (sampleRows > 0) {
    const data = sheet.getRange(2, 1, sampleRows, lastCol).getValues();
    data.forEach((row, idx) => {
      Logger.log('行 ' + (idx + 2) + ':');
      row.forEach((v, i) => {
        const colLetter = String.fromCharCode(65 + i);
        Logger.log('  ' + colLetter + ' (' + header[i] + '): ' + JSON.stringify(v));
      });
    });
  }
}
