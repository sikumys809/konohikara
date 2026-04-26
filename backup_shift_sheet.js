function backupShiftSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const original = ss.getSheetByName('T_シフト確定');
  if (!original) {
    Logger.log('シートがない');
    return;
  }
  const ts = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd_HHmmss');
  const backupName = `T_シフト確定_BAK_${ts}`;
  
  // 既存のバックアップ削除（同名があれば）
  const existing = ss.getSheetByName(backupName);
  if (existing) ss.deleteSheet(existing);
  
  // コピー
  const copy = original.copyTo(ss);
  copy.setName(backupName);
  
  Logger.log(`✅ バックアップ作成: ${backupName}`);
  Logger.log(`   行数: ${copy.getLastRow()}`);
  Logger.log(`   列数: ${copy.getLastColumn()}`);
}
