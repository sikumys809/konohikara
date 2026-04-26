// ============================================================
// マイグレーション: 既存の日勤確定データを「仮」に戻す
// Step B-1 の一環として、既存データも仮→確定フローに統合する
// ============================================================

function migrateDayShiftStatusToDraft() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('T_シフト確定');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    Logger.log('データなし');
    return;
  }

  const data = sheet.getRange(2, 1, lastRow - 1, 19).getValues();
  const dayShiftSet = new Set(['早出8h', '早出4h', '遅出8h', '遅出4h']);

  Logger.log('========== 日勤ステータス仮戻し マイグレーション ==========');

  let targetRows = [];
  data.forEach((row, idx) => {
    const shift = String(row[8]).trim();      // I列 シフト種別
    const status = String(row[13]).trim();    // N列 ステータス
    if (dayShiftSet.has(shift) && status === '確定') {
      targetRows.push({
        rowNum: idx + 2,
        date: row[1] instanceof Date
          ? Utilities.formatDate(row[1], 'Asia/Tokyo', 'yyyy-MM-dd')
          : String(row[1]),
        name: String(row[7]),
        shift: shift
      });
    }
  });

  Logger.log(`対象: ${targetRows.length}件の日勤確定データを仮に戻す`);

  if (targetRows.length === 0) {
    Logger.log('対象なし。終了。');
    return;
  }

  // 先頭3件サンプル表示
  Logger.log('\nサンプル(先頭3件):');
  targetRows.slice(0, 3).forEach(r => {
    Logger.log(`  行${r.rowNum}: ${r.date} ${r.name} ${r.shift}`);
  });

  // 一括更新
  const updates = targetRows.map(r => ['仮']);
  const rowNums = targetRows.map(r => r.rowNum);

  // 連続行をまとめて処理
  let start = 0;
  while (start < rowNums.length) {
    let end = start;
    while (end + 1 < rowNums.length && rowNums[end + 1] === rowNums[end] + 1) {
      end++;
    }
    const batchRange = sheet.getRange(rowNums[start], 14, end - start + 1, 1);
    const batchValues = [];
    for (let i = start; i <= end; i++) batchValues.push(['仮']);
    batchRange.setValues(batchValues);
    start = end + 1;
  }

  SpreadsheetApp.flush();
  Logger.log(`\n✅ ${targetRows.length}件を「確定」→「仮」に変更完了`);

  // 検証
  Logger.log('\n=== 検証: 対象月ごとのステータス分布 ===');
  const verify = sheet.getRange(2, 1, lastRow - 1, 19).getValues();
  const byYM = {};
  verify.forEach(row => {
    const shift = String(row[8]).trim();
    if (!dayShiftSet.has(shift)) return;
    const ym = row[1] instanceof Date
      ? Utilities.formatDate(row[1], 'Asia/Tokyo', 'yyyy-MM')
      : String(row[1]).substring(0, 7);
    const status = String(row[13]).trim();
    if (!byYM[ym]) byYM[ym] = { 仮: 0, 確定: 0, その他: 0 };
    if (status === '仮') byYM[ym].仮++;
    else if (status === '確定') byYM[ym].確定++;
    else byYM[ym].その他++;
  });
  Object.keys(byYM).sort().forEach(ym => {
    const s = byYM[ym];
    Logger.log(`  ${ym}: 仮=${s.仮} / 確定=${s.確定} / その他=${s.その他}`);
  });
}