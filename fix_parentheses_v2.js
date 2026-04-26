// ============================================================
// 緊急修正v2: 文字列置換で機械的に半角括弧 → 全角括弧に変換
// JavaScriptリテラルで全角括弧を直接書くとトラブるので、
// String.fromCharCodeで全角括弧を動的に生成する
// ============================================================

function fixParenthesesHalfToFull_v2() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('M_スタッフ');
  const lastRow = sheet.getLastRow();
  const data = sheet.getRange(2, 1, lastRow - 1, 20).getValues();

  // 全角括弧を動的生成(U+FF08 / U+FF09)
  const zenLeft = String.fromCharCode(0xFF08);   // (
  const zenRight = String.fromCharCode(0xFF09);  // )
  const hanLeft = '(';
  const hanRight = ')';

  Logger.log('========== 半角括弧 → 全角括弧 修正(v2) ==========');
  Logger.log(`半角( の charCode: ${hanLeft.charCodeAt(0)}`);
  Logger.log(`全角( の charCode: ${zenLeft.charCodeAt(0)}`);

  let fixed = 0;
  const changes = [];

  data.forEach((row, idx) => {
    const rowNum = idx + 2;
    const mainFac = String(row[9] || '').trim();

    if (!mainFac) return;

    // 半角括弧が含まれているか
    if (mainFac.indexOf(hanLeft) === -1 && mainFac.indexOf(hanRight) === -1) return;

    // 半角を全角に置換
    const newName = mainFac.split(hanLeft).join(zenLeft).split(hanRight).join(zenRight);

    if (newName !== mainFac) {
      changes.push({
        rowNum,
        name: String(row[1]),
        from: mainFac,
        to: newName
      });
    }
  });

  Logger.log(`修正対象: ${changes.length}件`);

  changes.forEach(c => {
    sheet.getRange(c.rowNum, 10).setDataValidation(null).setValue(c.to);
    fixed++;
  });

  SpreadsheetApp.flush();

  Logger.log(`✅ 修正完了: ${fixed}件`);

  // 修正後の確認(U+FF08/FF09で検出)
  Logger.log(`\n=== 修正後: 上板橋E-st 関連の分布 ===`);
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
    const charCodes = [];
    for (let i = 0; i < k.length; i++) {
      const c = k.charCodeAt(i);
      if (c === 0xFF08 || c === 0xFF09 || c === 0x28 || c === 0x29) {
        charCodes.push(`[${c.toString(16).toUpperCase()}]`);
      }
    }
    Logger.log(`  ${k}: ${count[k]}人  括弧コード: ${charCodes.join(' ')}`);
  });
}

// 参考: 両方存在する場合の全量クリーンアップ
// (今回 本物全角8人 + ダミー半角32人 の状態から、全員全角に統一する)
function normalizeAllBuildingNames() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('M_スタッフ');
  const lastRow = sheet.getLastRow();
  const data = sheet.getRange(2, 1, lastRow - 1, 20).getValues();

  const zenLeft = String.fromCharCode(0xFF08);
  const zenRight = String.fromCharCode(0xFF09);

  Logger.log('========== 全建物名の括弧を全角に統一 ==========');

  let fixed = 0;
  data.forEach((row, idx) => {
    const rowNum = idx + 2;
    const mainFac = String(row[9] || '').trim();
    if (!mainFac) return;

    if (mainFac.indexOf('(') === -1 && mainFac.indexOf(')') === -1) return;

    const newName = mainFac.split('(').join(zenLeft).split(')').join(zenRight);
    if (newName !== mainFac) {
      sheet.getRange(rowNum, 10).setDataValidation(null).setValue(newName);
      fixed++;
    }
  });

  SpreadsheetApp.flush();
  Logger.log(`✅ ${fixed}件を全角に統一`);
}