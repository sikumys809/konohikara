// ============================================================
// 在籍・メイン施設未登録スタッフに一括でダミー情報を割当てる
// - メイン施設: GHコノヒカラ
// - 主職種: 世話人
// - シフト区分: 両方
// - 許可シフト: 全7種
// ※ 後で本番情報で上書きする前提
// ============================================================

function bulkAssignDummyInfo() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('M_スタッフ');
  const lastRow = sheet.getLastRow();
  const data = sheet.getRange(2, 1, lastRow - 1, 20).getValues();

  // ダミー値
  const DUMMY_MAIN = 'GHコノヒカラ';
  const DUMMY_SHIFT_KUBUN = '両方';
  const DUMMY_ALLOWED_SHIFTS = '夜勤A,夜勤B,夜勤C,早出8h,早出4h,遅出8h,遅出4h';
  const DUMMY_MAIN_ROLE = '世話人';

  Logger.log(`========== ダミー情報一括割当 ==========`);

  const targets = [];

  data.forEach((row, idx) => {
    const rowNum = idx + 2;
    const mainFac = String(row[9] || '').trim();
    const retired = String(row[16] || '').toUpperCase() === 'TRUE';

    // 条件: メイン施設未登録 かつ 在籍
    if (mainFac !== '' || retired) return;

    targets.push({
      rowNum,
      staffId: row[0],
      name: String(row[1])
    });
  });

  Logger.log(`対象: 在籍・メイン施設未登録 ${targets.length}件`);

  if (targets.length === 0) {
    Logger.log('対象なし');
    return;
  }

  // バッチ処理(プルダウン制約回避のため一旦解除)
  targets.forEach(t => {
    // J列(10): メイン施設
    sheet.getRange(t.rowNum, 10).setDataValidation(null).setValue(DUMMY_MAIN);
    // M列(13): シフト区分
    sheet.getRange(t.rowNum, 13).setDataValidation(null).setValue(DUMMY_SHIFT_KUBUN);
    // N列(14): 許可シフト種別
    sheet.getRange(t.rowNum, 14).setDataValidation(null).setValue(DUMMY_ALLOWED_SHIFTS);
    // T列(20): 主職種
    sheet.getRange(t.rowNum, 20).setDataValidation(null).setValue(DUMMY_MAIN_ROLE);
  });

  SpreadsheetApp.flush();
  Logger.log(`✅ 完了: ${targets.length}件にダミー情報を割当てました`);

  // サンプル先頭10件をログ
  Logger.log('\n【割当例(先頭10件)】');
  targets.slice(0, 10).forEach(t => {
    Logger.log(`  行${t.rowNum} ID${t.staffId} ${t.name}`);
  });

  Logger.log(`\n割当内容:`);
  Logger.log(`  メイン施設: ${DUMMY_MAIN}`);
  Logger.log(`  シフト区分: ${DUMMY_SHIFT_KUBUN}`);
  Logger.log(`  許可シフト: ${DUMMY_ALLOWED_SHIFTS}`);
  Logger.log(`  主職種: ${DUMMY_MAIN_ROLE}`);
}

/**
 * 確認用: 現在のメイン施設未登録状況を確認
 */
function checkMainFacilityStatus() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('M_スタッフ');
  const lastRow = sheet.getLastRow();
  const data = sheet.getRange(2, 1, lastRow - 1, 20).getValues();

  let activeEmpty = 0;
  let retiredEmpty = 0;
  let active = 0;
  let retired = 0;

  data.forEach(row => {
    const mainFac = String(row[9] || '').trim();
    const retired_ = String(row[16] || '').toUpperCase() === 'TRUE';

    if (retired_) {
      retired++;
      if (mainFac === '') retiredEmpty++;
    } else {
      active++;
      if (mainFac === '') activeEmpty++;
    }
  });

  Logger.log(`========== 現状確認 ==========`);
  Logger.log(`在籍: ${active}件 (うちメイン施設未登録: ${activeEmpty}件)`);
  Logger.log(`退職: ${retired}件 (うちメイン施設未登録: ${retiredEmpty}件)`);
}
