function cleanupForProduction() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const log = [];
  log.push('========== クリーンアップ開始: ' + new Date() + ' ==========');

  // 1. T_シフト確定 全削除
  try {
    const sheet1 = ss.getSheetByName('T_シフト確定');
    if (sheet1) {
      const lastRow = sheet1.getLastRow();
      if (lastRow > 1) {
        sheet1.getRange(2, 1, lastRow - 1, sheet1.getLastColumn()).clearContent();
        log.push('✅ T_シフト確定: ' + (lastRow - 1) + '件削除');
      } else {
        log.push('T_シフト確定: 削除対象なし');
      }
    }
  } catch (e) {
    log.push('❌ T_シフト確定 エラー: ' + e.message);
  }

  // 2. T_希望提出 全削除
  try {
    const sheet2 = ss.getSheetByName('T_希望提出');
    if (sheet2) {
      const lastRow = sheet2.getLastRow();
      if (lastRow > 1) {
        sheet2.getRange(2, 1, lastRow - 1, sheet2.getLastColumn()).clearContent();
        log.push('✅ T_希望提出: ' + (lastRow - 1) + '件削除');
      } else {
        log.push('T_希望提出: 削除対象なし');
      }
    }
  } catch (e) {
    log.push('❌ T_希望提出 エラー: ' + e.message);
  }

  // 3. M_スタッフ の設定値クリア
  try {
    const sheet3 = ss.getSheetByName('M_スタッフ');
    if (sheet3) {
      const data = sheet3.getDataRange().getValues();
      const header = data[0];

      const colMap = {};
      header.forEach((h, i) => {
        const name = String(h).trim();
        if (name === 'メイン施設名' || name === 'メイン施設' || name === 'main_fac') colMap.main = i;
        if (name === 'セカンド施設名' || name === 'セカンド施設' || name === 'second_fac') colMap.second = i;
        if (name === 'サブ施設候補' || name === 'サブ施設' || name === 'sub_facs') colMap.sub = i;
        if (name === 'シフト区分' || name === 'shift_kubun') colMap.kubun = i;
        if (name === '許可シフト種別' || name === '許可シフト' || name === 'allowed_shifts') colMap.allowed = i;
      });

      const targetCols = ['main', 'second', 'sub', 'kubun', 'allowed'].filter(k => colMap[k] !== undefined);
      log.push('M_スタッフ クリア対象列: ' + targetCols.join(', ') + ' (列インデックス: ' + targetCols.map(k => colMap[k]).join(', ') + ')');

      const numRows = data.length - 1;
      if (numRows > 0) {
        for (const k of targetCols) {
          const colIdx = colMap[k] + 1; // 1-based
          sheet3.getRange(2, colIdx, numRows, 1).clearContent();
        }
        log.push('✅ M_スタッフ: ' + numRows + '名 × ' + targetCols.length + '列を一括クリア');
      } else {
        log.push('M_スタッフ: クリア対象なし');
      }
    }
  } catch (e) {
    log.push('❌ M_スタッフ エラー: ' + e.message);
  }

  // 4. T_提出期間オーバーライド 全削除
  try {
    const sheet4 = ss.getSheetByName('T_提出期間オーバーライド');
    if (sheet4) {
      const lastRow = sheet4.getLastRow();
      if (lastRow > 1) {
        sheet4.getRange(2, 1, lastRow - 1, sheet4.getLastColumn()).clearContent();
        log.push('✅ T_提出期間オーバーライド: ' + (lastRow - 1) + '件削除');
      } else {
        log.push('T_提出期間オーバーライド: 削除対象なし');
      }
    }
  } catch (e) {
    log.push('❌ T_提出期間オーバーライド エラー: ' + e.message);
  }

  log.push('========== クリーンアップ完了: ' + new Date() + ' ==========');
  log.forEach(l => Logger.log(l));
}
