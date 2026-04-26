// ============================================================
// M_ユニット U09 の施設名を正しい表記に修正
// 修正前: ルーデンス上板橋E-st（セカンド）
// 修正後: ルーデンス上板橋E-st（板橋北区セカンド）
// ============================================================

function fixUnitFacilityName() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('M_ユニット');
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues();

  const zenLeft = String.fromCharCode(0xFF08);
  const zenRight = String.fromCharCode(0xFF09);
  const targetName = 'ルーデンス上板橋E-st' + zenLeft + '板橋北区セカンド' + zenRight;

  Logger.log('========== M_ユニット 施設名修正 ==========');

  let fixed = 0;
  data.forEach((row, idx) => {
    const rowNum = idx + 2;
    const unitId = String(row[0]);
    const currentFac = String(row[3] || '').trim();

    // U09 (コノヒカラ板橋北区セカンドⅢ) の修正
    if (unitId === 'U09') {
      Logger.log(`行${rowNum} ${unitId}: "${currentFac}" → "${targetName}"`);
      sheet.getRange(rowNum, 4).setValue(targetName);
      fixed++;
    }
  });

  SpreadsheetApp.flush();
  Logger.log(`✅ ${fixed}件を修正`);

  // 検証
  Logger.log('\n=== 修正後の確認 ===');
  const verify = sheet.getRange(10, 1, 1, 6).getValues()[0];
  Logger.log(`行10: A="${verify[0]}" B="${verify[1]}" C="${verify[2]}" D="${verify[3]}" E="${verify[4]}" F="${verify[5]}"`);
  Logger.log(`D列 charCodes (括弧): ${getParenCharCodes(String(verify[3]))}`);
}

function getParenCharCodes(str) {
  const codes = [];
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c === 0x28 || c === 0x29 || c === 0xFF08 || c === 0xFF09) {
      codes.push(`[${c.toString(16).toUpperCase()}]`);
    }
  }
  return codes.join(' ');
}
