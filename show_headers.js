function showShiftSheetHeaders() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('T_シフト確定');
  const headers = sh.getRange(1, 1, 1, 19).getValues()[0];
  Logger.log('========== T_シフト確定 のヘッダ行 ==========');
  headers.forEach((h, i) => {
    const col = String.fromCharCode(65 + i);
    Logger.log(`  ${col}列 (index ${i}): "${h}"`);
  });
}