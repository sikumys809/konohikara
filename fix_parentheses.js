// ============================================================
// 緊急修正: 半角括弧で書き込まれた建物名を全角括弧に修正
// - ルーデンス上板橋E-st(板橋北区)      → （板橋北区）に統一
// - ルーデンス上板橋E-st(板橋北区セカンド) → （板橋北区セカンド）に統一
// ============================================================

function fixParenthesesHalfToFull() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('M_スタッフ');
  const lastRow = sheet.getLastRow();
  const data = sheet.getRange(2, 1, lastRow - 1, 20).getValues();

  Logger.log('========== 半角括弧 → 全角括弧 修正 ==========');

  let fixed = 0;
  const targets = [];

  data.forEach((row, idx) => {
    const rowNum = idx + 2;
    const mainFac = String(row[9] || '').trim();

    if (mainFac === 'ルーデンス上板橋E-st(板橋北区)') {
      targets.push({
        rowNum,
        name: String(row[1]),
        from: mainFac,
        to: 'ルーデンス上板橋E-st(板橋北区)'  // 全角
      });
    } else if (mainFac === 'ルーデンス上板橋E-st(板橋北区セカンド)') {
      targets.push({
        rowNum,
        name: String(row[1]),
        from: mainFac,
        to: 'ルーデンス上板橋E-st(板橋北区セカンド)'  // 全角
      });
    }
  });

  Logger.log(`修正対象: ${targets.length}件`);

  targets.forEach(t => {
    sheet.getRange(t.rowNum, 10).setDataValidation(null).setValue(t.to);
    fixed++;
  });

  SpreadsheetApp.flush();

  Logger.log(`✅ 修正完了: ${fixed}件`);

  // 修正後の確認
  Logger.log(`\n=== 修正後の分布(上板橋E-st 関連のみ) ===`);
  const verify = sheet.getRange(2, 1, lastRow - 1, 20).getValues();
  const count = {};
  verify.forEach(row => {
    const retired = String(row[16] || '').toUpperCase() === 'TRUE';
    if (retired) return;
    const mainFac = String(row[9] || '').trim();
    if (mainFac.indexOf('E-st') !== -1) {
      count[mainFac] = (count[mainFac] || 0) + 1;
    }
  });
  Object.keys(count).sort().forEach(k => {
    Logger.log(`  ${k}: ${count[k]}人  raw=${JSON.stringify(k)}`);
  });
}