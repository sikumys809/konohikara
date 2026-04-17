function migrateFacilityColumns() {
  const ss    = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('M_スタッフ');

  // 現在: I=メイン, J=セカンド, K=サード, L=シフト区分, M=許可シフト種別, N=保護, O=退職, P=デバイス, Q=備考
  // 目標: I=メイン, J=サブ施設候補(カンマ区切り), K=シフト区分, L=許可シフト種別, M=保護, N=退職, O=デバイス, P=備考

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  Logger.log('移行前: ' + headers.join(' | '));

  // J列ヘッダーを「サブ施設候補」に変更
  sheet.getRange(1, 10).setValue('サブ施設候補');

  // K列（サード施設名）を削除 → L以降が繰り上がる
  const sansColIdx = headers.indexOf('サード施設名') + 1;
  if (sansColIdx > 0) {
    sheet.deleteColumns(sansColIdx, 1);
  }

  const newHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  Logger.log('移行後: ' + newHeaders.join(' | '));
  Logger.log('✅ 列移行完了');
}