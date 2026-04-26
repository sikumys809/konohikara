// ============================================================
// 日勤配置結果の診断
// - T_シフト確定の2026-05日勤データを確認
// - 事業所名・施設名の分布を集計
// ============================================================

function diagnoseDayShiftPlacement() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('T_シフト確定');
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 19).getValues();

  const dayShiftSet = new Set(['早出8h', '早出4h', '遅出8h', '遅出4h']);
  const targetYM = '2026-05';

  const dayRecords = data.filter(row => {
    const rowYm = row[1] instanceof Date
      ? Utilities.formatDate(row[1], 'Asia/Tokyo', 'yyyy-MM')
      : String(row[1]).substring(0, 7);
    const shift = String(row[8]).trim();
    return rowYm === targetYM && dayShiftSet.has(shift);
  });

  Logger.log(`========== 2026-05 日勤配置結果 診断 ==========`);
  Logger.log(`総件数: ${dayRecords.length}件`);

  // 事業所別(D列)
  const byJig = {};
  dayRecords.forEach(row => {
    const jig = String(row[3]).trim();
    byJig[jig] = (byJig[jig] || 0) + 1;
  });
  Logger.log(`\n【D列: 事業所名 別件数】`);
  Object.keys(byJig).sort().forEach(k => {
    Logger.log(`  "${k}": ${byJig[k]}件`);
  });

  // 施設別(E列)
  const byFac = {};
  dayRecords.forEach(row => {
    const fac = String(row[4]).trim();
    byFac[fac] = (byFac[fac] || 0) + 1;
  });
  Logger.log(`\n【E列: 施設名 別件数】`);
  Object.keys(byFac).sort().forEach(k => {
    Logger.log(`  "${k}": ${byFac[k]}件`);
  });

  // 事業所×施設のクロス
  const cross = {};
  dayRecords.forEach(row => {
    const jig = String(row[3]).trim();
    const fac = String(row[4]).trim();
    const key = `${jig} / ${fac}`;
    cross[key] = (cross[key] || 0) + 1;
  });
  Logger.log(`\n【事業所×施設 クロス集計】`);
  Object.keys(cross).sort().forEach(k => {
    Logger.log(`  ${k}: ${cross[k]}件`);
  });

  // サンプル先頭3件詳細
  Logger.log(`\n【先頭3件 詳細】`);
  dayRecords.slice(0, 3).forEach((row, i) => {
    Logger.log(`--- レコード${i+1} ---`);
    Logger.log(`  A shift_id: "${row[0]}"`);
    Logger.log(`  B 日付: "${row[1]}"`);
    Logger.log(`  D 事業所: "${row[3]}"`);
    Logger.log(`  E 施設: "${row[4]}"`);
    Logger.log(`  G staff_id: "${row[6]}"`);
    Logger.log(`  H 氏名: "${row[7]}"`);
    Logger.log(`  I シフト: "${row[8]}"`);
  });
}

/**
 * M_ユニットの施設→事業所マッピングを確認
 */
function checkFacilityToJigMap() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('M_ユニット');
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues();

  Logger.log('========== M_ユニット: 施設→事業所 マッピング ==========');
  data.forEach((row, i) => {
    Logger.log(`行${i+2}: A="${row[0]}" B="${row[1]}" C="${row[2]}" D="${row[3]}" E="${row[4]}" F="${row[5]}"`);
  });

  // D列=施設名 → B列=事業所名 のマップ
  Logger.log('\n=== 施設→事業所マップ(重複排除) ===');
  const map = {};
  data.forEach(row => {
    const fac = String(row[3] || '').trim();
    const jig = String(row[1] || '').trim();
    if (fac && jig && !map[fac]) map[fac] = jig;
  });
  Object.keys(map).sort().forEach(k => {
    Logger.log(`  ${k} → ${map[k]}`);
  });
}