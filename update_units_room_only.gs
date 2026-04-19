// ============================================
// M_ユニットのF列に部屋番号を追加 (2026-04-19)
// 元データ: 2025年シフト提出希望.xlsx の「ユニット情報」シート (O列 交流室)
// ============================================

// [ユニット名, 部屋番号]
const UNIT_ROOM_DATA = [
  ["コノヒカラ板橋北区Ⅰ", 203],
  ["コノヒカラ板橋北区Ⅱ", 303],
  ["コノヒカラ板橋北区Ⅲ", 101],
  ["コノヒカラ板橋北区Ⅳ", 101],
  ["コノヒカラ板橋北区Ⅴ", 101],
  ["コノヒカラ板橋北区Ⅵ", 102],
  ["コノヒカラ板橋北区セカンドⅠ", 101],
  ["コノヒカラ板橋北区セカンドⅡ", 102],
  ["コノヒカラ板橋北区セカンドⅢ", 102],
  ["コノヒカラ板橋北区セカンドⅣ", 101],
  ["コノヒカラ板橋北区セカンドⅤ", 102],
  ["コノヒカラ練馬Ⅰ", 204],
  ["コノヒカラ練馬Ⅱ", 304],
  ["コノヒカラⅠ", 401],
  ["コノヒカラⅡ", 402],
  ["コノヒカラⅤ", 204],
  ["コノヒカラⅥ", 304],
  ["コノヒカラⅦ", 101],
  ["コノヒカラ品川Ⅲ", 101],
  ["コノヒカラ品川Ⅳ", 102],
  ["コノヒカラ品川Ⅷ", 101],
  ["コノヒカラ品川Ⅸ", 102],
];


function updateUnitsWithRoomNumber() {
  Logger.log('[START] M_ユニットに部屋番号追加');
  
  try {
    const ss = SpreadsheetApp.openById(STAFF_SS_ID);
    const sheet = ss.getSheetByName('M_ユニット');
    
    if (!sheet) {
      Logger.log('[ERROR] M_ユニットシートが見つかりません');
      return { success: false };
    }
    
    // Step 1: F列ヘッダー追加
    const currentCols = sheet.getLastColumn();
    if (currentCols < 6) {
      if (sheet.getMaxColumns() < 6) {
        sheet.insertColumnsAfter(currentCols, 6 - currentCols);
      }
    }
    sheet.getRange(1, 6).setValue('部屋番号');
    sheet.getRange(1, 6)
      .setFontWeight('bold').setBackground('#4a148c').setFontColor('#ffffff');
    Logger.log('[ADD] F列ヘッダー「部屋番号」追加');
    
    // Step 2: 既存データ取得
    const data = sheet.getDataRange().getValues();
    
    // ユニット名 -> 行番号 のマップ
    const unitNameToRow = {};
    for (let i = 1; i < data.length; i++) {
      const uname = String(data[i][2] || '').trim();
      if (uname) unitNameToRow[uname] = i + 1;
    }
    
    // Step 3: 各ユニットに部屋番号を設定
    let updated = 0;
    let notFound = [];
    
    for (const u of UNIT_ROOM_DATA) {
      const [unitName, room] = u;
      const rowIdx = unitNameToRow[unitName];
      if (!rowIdx) {
        notFound.push(unitName);
        continue;
      }
      sheet.getRange(rowIdx, 6).setValue(room);
      updated++;
    }
    
    // 列幅調整
    sheet.setColumnWidth(6, 100);
    
    SpreadsheetApp.flush();
    
    Logger.log('[DONE] 更新完了');
    Logger.log('  更新件数: ' + updated + '件');
    if (notFound.length > 0) {
      Logger.log('  見つからなかったユニット: ' + notFound.join(', '));
    }
    
    return { success: true, updated: updated, notFound: notFound };
    
  } catch (error) {
    Logger.log('[ERROR] ' + error.toString());
    return { success: false, error: error.toString() };
  }
}


function verifyUnitRooms() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('M_ユニット');
  const data = sheet.getDataRange().getValues();
  
  Logger.log('[CHECK] M_ユニット確認');
  Logger.log('  総行数: ' + (data.length - 1) + 'ユニット');
  Logger.log('  列数: ' + sheet.getLastColumn());
  
  let roomCount = 0;
  for (let i = 1; i < data.length; i++) {
    if (data[i][5]) roomCount++;
  }
  Logger.log('  部屋番号あり: ' + roomCount + 'ユニット');
  
  Logger.log('');
  Logger.log('[ALL] 全22ユニット:');
  for (let i = 1; i < data.length; i++) {
    Logger.log('  ' + data[i][0] + ' | ' + data[i][2] + ' | ' + data[i][3] + ' | 部屋' + data[i][5]);
  }
}
