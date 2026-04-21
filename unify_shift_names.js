// ============================================================
// Step 3-4: シフト種別の名称統一 + N列一括拡張
// - 旧名称「日勤早出/日勤遅出」→ 新名称「早出8h/遅出8h」に統一
// - M_スタッフ N列「許可シフト種別」を在籍者全員に7種類許可に更新
// - 退職者(Q列=TRUE)は既存値を維持
// - T_希望提出 G列「シフト種別」の旧名称データもリネーム
// ============================================================

/**
 * メイン関数: 一括実行
 */
function unifyShiftNamesAndExpandAllowed() {
  const logs = [];

  Logger.log('========== シフト種別統一 & 許可拡張 開始 ==========');

  // ① M_スタッフ N列の許可シフト種別を在籍者全員に7種類許可
  const r1 = _expandAllowedShiftsForAll();
  logs.push(r1);

  // ② T_希望提出 G列のシフト種別名をリネーム
  const r2 = _renameShiftTypesInRequests();
  logs.push(r2);

  // ③ T_シフト確定 I列のシフト種別名をリネーム（念のため）
  const r3 = _renameShiftTypesInConfirmed();
  logs.push(r3);

  Logger.log('========== 完了 ==========');
  Logger.log(JSON.stringify(logs, null, 2));
  return logs;
}

/**
 * ① M_スタッフ N列を在籍者全員に7種類許可で更新
 * 退職者(Q列=TRUE)は既存値を維持してスキップ
 */
function _expandAllowedShiftsForAll() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('M_スタッフ');
  if (!sheet) throw new Error('M_スタッフが見つからない');

  const lastRow = sheet.getLastRow();
  const nCol = 14; // N列: 許可シフト種別
  const qCol = 17; // Q列: 退職フラグ

  // validation削除（プルダウン制約があると書込失敗する）
  sheet.getRange(1, nCol, lastRow, 1).setDataValidation(null);

  // ヘッダー確認
  const header = sheet.getRange(1, nCol).getValue();
  if (header !== '許可シフト種別') {
    Logger.log(`⚠ N列ヘッダーが想定と違う: "${header}" → 上書き`);
    sheet.getRange(1, nCol).setValue('許可シフト種別');
  }

  // 全員のN列値とQ列値を取得
  const range = sheet.getRange(2, 1, lastRow - 1, qCol).getValues();
  const allShifts = '夜勤A,夜勤B,夜勤C,早出8h,早出4h,遅出8h,遅出4h';

  const updates = [];
  let activeCount = 0;
  let retiredSkipped = 0;

  range.forEach((row) => {
    const retired = String(row[qCol - 1] || '').toUpperCase() === 'TRUE';
    if (retired) {
      // 退職者: 既存値を維持
      updates.push([row[nCol - 1] || '']);
      retiredSkipped++;
    } else {
      // 在籍者: 全7種類許可に上書き
      updates.push([allShifts]);
      activeCount++;
    }
  });

  sheet.getRange(2, nCol, updates.length, 1).setValues(updates);

  const msg = `M_スタッフ N列: 在籍${activeCount}名に全7種類許可 / 退職者${retiredSkipped}名はスキップ`;
  Logger.log(msg);
  return msg;
}

/**
 * ② T_希望提出 G列のシフト種別をリネーム
 */
function _renameShiftTypesInRequests() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('T_希望提出');
  if (!sheet) return 'T_希望提出が見つからない → スキップ';

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 'T_希望提出 は空 → スキップ';

  const gCol = 7; // G列: シフト種別
  const data = sheet.getRange(2, gCol, lastRow - 1, 1).getValues();

  const renameMap = {
    '日勤早出': '早出8h',
    '日勤遅出': '遅出8h',
    '早出': '早出8h',
    '遅出': '遅出8h'
  };

  let changed = 0;
  const newValues = data.map(row => {
    const cur = String(row[0] || '').trim();
    if (renameMap[cur]) {
      changed++;
      return [renameMap[cur]];
    }
    return [cur];
  });

  if (changed > 0) {
    sheet.getRange(2, gCol, newValues.length, 1).setValues(newValues);
  }

  const msg = `T_希望提出 G列: ${changed}件のシフト名リネーム完了`;
  Logger.log(msg);
  return msg;
}

/**
 * ③ T_シフト確定 I列のシフト種別をリネーム（念のため）
 */
function _renameShiftTypesInConfirmed() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('T_シフト確定');
  if (!sheet) return 'T_シフト確定が見つからない → スキップ';

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 'T_シフト確定 は空 → スキップ';

  const iCol = 9; // I列: シフト種別
  const data = sheet.getRange(2, iCol, lastRow - 1, 1).getValues();

  const renameMap = {
    '日勤早出': '早出8h',
    '日勤遅出': '遅出8h',
    '早出': '早出8h',
    '遅出': '遅出8h'
  };

  let changed = 0;
  const newValues = data.map(row => {
    const cur = String(row[0] || '').trim();
    if (renameMap[cur]) {
      changed++;
      return [renameMap[cur]];
    }
    return [cur];
  });

  if (changed > 0) {
    sheet.getRange(2, iCol, newValues.length, 1).setValues(newValues);
  }

  const msg = `T_シフト確定 I列: ${changed}件のシフト名リネーム完了`;
  Logger.log(msg);
  return msg;
}

/**
 * 検証: 現状確認（実行前にこれで確認すると安全）
 */
function checkShiftNamesStatus() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  Logger.log('=== 現状確認 ===\n');

  // M_スタッフ N列
  const staffSheet = ss.getSheetByName('M_スタッフ');
  const nData = staffSheet.getRange(2, 14, staffSheet.getLastRow() - 1, 1).getValues();
  const nCounts = {};
  nData.forEach(r => {
    const v = String(r[0] || '').trim();
    nCounts[v] = (nCounts[v] || 0) + 1;
  });
  Logger.log('【M_スタッフ N列(許可シフト種別)の分布】');
  Object.keys(nCounts).sort((a, b) => nCounts[b] - nCounts[a]).forEach(k => {
    Logger.log(`  "${k}" : ${nCounts[k]}名`);
  });

  // T_希望提出 G列
  const reqSheet = ss.getSheetByName('T_希望提出');
  if (reqSheet && reqSheet.getLastRow() > 1) {
    const gData = reqSheet.getRange(2, 7, reqSheet.getLastRow() - 1, 1).getValues();
    const gCounts = {};
    gData.forEach(r => {
      const v = String(r[0] || '').trim();
      gCounts[v] = (gCounts[v] || 0) + 1;
    });
    Logger.log('\n【T_希望提出 G列(シフト種別)の分布】');
    Object.keys(gCounts).sort((a, b) => gCounts[b] - gCounts[a]).forEach(k => {
      Logger.log(`  "${k}" : ${gCounts[k]}件`);
    });
  } else {
    Logger.log('\n【T_希望提出】 データなし');
  }

  // T_シフト確定 I列
  const conSheet = ss.getSheetByName('T_シフト確定');
  if (conSheet && conSheet.getLastRow() > 1) {
    const iData = conSheet.getRange(2, 9, conSheet.getLastRow() - 1, 1).getValues();
    const iCounts = {};
    iData.forEach(r => {
      const v = String(r[0] || '').trim();
      iCounts[v] = (iCounts[v] || 0) + 1;
    });
    Logger.log('\n【T_シフト確定 I列(シフト種別)の分布】');
    Object.keys(iCounts).sort((a, b) => iCounts[b] - iCounts[a]).forEach(k => {
      Logger.log(`  "${k}" : ${iCounts[k]}件`);
    });
  } else {
    Logger.log('\n【T_シフト確定】 データなし');
  }
}