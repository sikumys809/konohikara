// ============================================
// スキーマ移行 v2
// 実行方法：この関数を選択して「実行」
// ============================================
function migrateSchema_v2() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);

  // ---- T_希望提出 ----
  const reqSheet = ss.getSheetByName('T_希望提出');
  const reqH = reqSheet.getRange(1, 1, 1, reqSheet.getLastColumn()).getValues()[0];

  if (!reqH.includes('希望施設名2')) {
    // H列を「希望施設名1」に改名
    reqSheet.getRange(1, 8).setValue('希望施設名1');
    // H列の後ろに2列挿入（コメント列が K に移動）
    reqSheet.insertColumnAfter(8);
    reqSheet.insertColumnAfter(9);
    reqSheet.getRange(1, 9).setValue('希望施設名2');
    reqSheet.getRange(1, 10).setValue('希望施設名3');
    // 頻度列を末尾に追加（現在11列 → 12,13列目）
    reqSheet.getRange(1, 12).setValue('希望頻度タイプ');
    reqSheet.getRange(1, 13).setValue('希望頻度数');
    const freqRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(['週次', '月次合計'], true).build();
    reqSheet.getRange(2, 12, 10000, 1).setDataValidation(freqRule);
    Logger.log('T_希望提出: 移行完了');
  } else {
    Logger.log('T_希望提出: 移行済み');
  }

  // ---- M_スタッフ ----
  const staffSheet = ss.getSheetByName('M_スタッフ');
  const staffH = staffSheet.getRange(1, 1, 1, staffSheet.getLastColumn()).getValues()[0];

  // サブ施設候補 → セカンド施設名
  const subIdx = staffH.indexOf('サブ施設候補');
  if (subIdx !== -1) staffSheet.getRange(1, subIdx + 1).setValue('セカンド施設名');

  if (!staffH.includes('シフト区分')) {
    const lc = staffSheet.getLastColumn();
    staffSheet.getRange(1, lc + 1).setValue('シフト区分');
    staffSheet.getRange(1, lc + 2).setValue('許可シフト種別');
    staffSheet.getRange(1, lc + 3).setValue('サード施設名');
    // 既存スタッフのデフォルトを「両方」に設定
    staffSheet.getRange(2, lc + 1, 1000, 1).setValue('両方');
    const kubunRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(['夜勤のみ', '日勤のみ', '両方'], true).build();
    staffSheet.getRange(2, lc + 1, 1000, 1).setDataValidation(kubunRule);
    Logger.log('M_スタッフ: 移行完了');
  } else {
    Logger.log('M_スタッフ: 移行済み');
  }
}
