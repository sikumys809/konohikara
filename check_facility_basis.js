function checkFacilityBasis() {
  const ss = SpreadsheetApp.openById('1IVRo8kj0lmaiuokomDlXVUn6E8XC8tktkwaXjtAAHHE');
  const sheet = ss.getSheetByName('M_事業所配置基準');
  if (!sheet) {
    Logger.log('シート存在しない');
    return;
  }
  const data = sheet.getDataRange().getValues();
  Logger.log('=== M_事業所配置基準 シート構造 ===');
  Logger.log('行数: ' + data.length + ' / 列数: ' + (data[0] || []).length);
  Logger.log('\n--- ヘッダー行 ---');
  Logger.log(JSON.stringify(data[0]));
  Logger.log('\n--- 全データ ---');
  data.forEach((row, i) => {
    Logger.log(`行${i}: ${JSON.stringify(row)}`);
  });
}
