// ============================================================
// マイグレーション: T_シフト確定 を19列→18列に変換
// ============================================================

function backupShiftSheetAgain() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const original = ss.getSheetByName('T_シフト確定');
  if (!original) {
    Logger.log('シートがない');
    return;
  }
  const ts = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd_HHmmss');
  const backupName = `T_シフト確定_BAK_${ts}_pre18cols`;
  
  const existing = ss.getSheetByName(backupName);
  if (existing) ss.deleteSheet(existing);
  
  const copy = original.copyTo(ss);
  copy.setName(backupName);
  
  Logger.log(`✅ 直前バックアップ作成: ${backupName}`);
  Logger.log(`   行数: ${copy.getLastRow()} / 列数: ${copy.getLastColumn()}`);
}

function migrateShiftSheetTo18Cols() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('T_シフト確定');
  
  if (!sheet) {
    Logger.log('❌ T_シフト確定シートが見つかりません');
    return;
  }
  
  const lastCol = sheet.getLastColumn();
  Logger.log(`現在の列数: ${lastCol}`);
  
  if (lastCol === 18) {
    Logger.log('⚠️ すでに18列構造になっています。スキップ。');
    return;
  }
  
  if (lastCol !== 19) {
    Logger.log(`❌ 想定外の列数 (${lastCol})。手動確認が必要。`);
    return;
  }
  
  const mHeader = String(sheet.getRange(1, 13).getValue()).trim();
  Logger.log(`M列のヘッダ: "${mHeader}"`);
  
  if (mHeader !== 'アラート種別') {
    Logger.log(`❌ M列が「アラート種別」ではない: "${mHeader}"`);
    Logger.log('安全のため処理中止');
    return;
  }
  
  Logger.log('\n=== 削除前: 先頭3行のM,N,O列 ===');
  const beforeData = sheet.getRange(2, 13, 3, 3).getValues();
  beforeData.forEach((row, i) => {
    Logger.log(`  行${i+2}: M="${row[0]}" / N="${row[1]}" / O="${row[2]}"`);
  });
  
  sheet.deleteColumn(13);
  Logger.log('\n✅ M列「アラート種別」を削除しました');
  
  const newLastCol = sheet.getLastColumn();
  Logger.log(`新しい列数: ${newLastCol}`);
  
  Logger.log('\n=== 新しいヘッダ行 ===');
  const newHeaders = sheet.getRange(1, 1, 1, newLastCol).getValues()[0];
  newHeaders.forEach((h, i) => {
    const col = String.fromCharCode(65 + i);
    Logger.log(`  ${col}列 (index ${i}): "${h}"`);
  });
  
  Logger.log('\n=== 削除後: 先頭3行のM,N,O列 ===');
  const afterData = sheet.getRange(2, 13, 3, 3).getValues();
  afterData.forEach((row, i) => {
    Logger.log(`  行${i+2}: M="${row[0]}" / N="${row[1]}" / O="${row[2]}"`);
  });
  
  Logger.log('\n========== マイグレーション完了 ==========');
}

function diagnoseAfterMigration() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('T_シフト確定');
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 18).getValues();
  
  const dayShiftSet = new Set(['早出8h', '早出4h', '遅出8h', '遅出4h']);
  const nightShiftSet = new Set(['夜勤A', '夜勤B', '夜勤C']);
  
  const stats = { 
    夜勤: { 仮: 0, 確定: 0, 日時: 0, 空: 0, その他: 0 }, 
    日勤: { 仮: 0, 確定: 0, 日時: 0, 空: 0, その他: 0 }
  };
  
  data.forEach(row => {
    const rowYm = row[1] instanceof Date
      ? Utilities.formatDate(row[1], 'Asia/Tokyo', 'yyyy-MM')
      : String(row[1]).substring(0, 7);
    if (rowYm !== '2026-05') return;
    
    const shift = String(row[8]).trim();
    const status = row[12];  // M列(12) = ステータス
    
    let bucket;
    if (nightShiftSet.has(shift)) bucket = '夜勤';
    else if (dayShiftSet.has(shift)) bucket = '日勤';
    else return;
    
    if (status === null || status === '') stats[bucket].空++;
    else if (status === '仮') stats[bucket].仮++;
    else if (status === '確定') stats[bucket].確定++;
    else if (status instanceof Date) stats[bucket].日時++;
    else stats[bucket].その他++;
  });
  
  Logger.log('========== マイグレーション後 ステータス分布 ==========');
  Logger.log(`夜勤: 仮=${stats.夜勤.仮} / 確定=${stats.夜勤.確定} / 日時=${stats.夜勤.日時} / 空=${stats.夜勤.空} / その他=${stats.夜勤.その他}`);
  Logger.log(`日勤: 仮=${stats.日勤.仮} / 確定=${stats.日勤.確定} / 日時=${stats.日勤.日時} / 空=${stats.日勤.空} / その他=${stats.日勤.その他}`);
}
function fixNightShiftStatusToDraft() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('T_シフト確定');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    Logger.log('データなし');
    return;
  }

  const data = sheet.getRange(2, 1, lastRow - 1, 18).getValues();
  const nightShiftSet = new Set(['夜勤A', '夜勤B', '夜勤C']);
  
  Logger.log('========== 夜勤ステータス修正 ==========');
  
  const targetRows = [];
  data.forEach((row, idx) => {
    const shift = String(row[8]).trim();
    if (!nightShiftSet.has(shift)) return;
    
    const status = row[12];  // M列(12) = ステータス
    
    // 仮でも確定でもないものを修正対象に
    if (status !== '仮' && status !== '確定') {
      targetRows.push({
        rowNum: idx + 2,
        date: row[1] instanceof Date
          ? Utilities.formatDate(row[1], 'Asia/Tokyo', 'yyyy-MM-dd')
          : String(row[1]),
        name: String(row[7]),
        shift: shift,
        currentStatus: status
      });
    }
  });
  
  Logger.log(`修正対象: ${targetRows.length}件`);
  
  if (targetRows.length === 0) {
    Logger.log('対象なし。終了。');
    return;
  }
  
  Logger.log('\nサンプル(先頭3件):');
  targetRows.slice(0, 3).forEach(r => {
    Logger.log(`  行${r.rowNum}: ${r.date} ${r.name} ${r.shift} / 現状M列="${r.currentStatus}"`);
  });
  
  // M列(13番目、1-indexed)を「仮」に書き換え
  const rowNums = targetRows.map(r => r.rowNum);
  rowNums.sort((a, b) => a - b);
  
  // 連続行をまとめて処理
  let start = 0;
  while (start < rowNums.length) {
    let end = start;
    while (end + 1 < rowNums.length && rowNums[end + 1] === rowNums[end] + 1) {
      end++;
    }
    const count = end - start + 1;
    const values = [];
    for (let i = 0; i < count; i++) values.push(['仮']);
    sheet.getRange(rowNums[start], 13, count, 1).setValues(values);  // M列=13
    start = end + 1;
  }
  
  SpreadsheetApp.flush();
  Logger.log(`\n✅ ${targetRows.length}件のM列を「仮」に修正完了`);
  
  // 検証
  Logger.log('\n=== 検証: 修正後のステータス分布 ===');
  const verify = sheet.getRange(2, 1, lastRow - 1, 18).getValues();
  const stats = { 夜勤: { 仮: 0, 確定: 0, その他: 0 }, 日勤: { 仮: 0, 確定: 0, その他: 0 } };
  const dayShiftSet = new Set(['早出8h', '早出4h', '遅出8h', '遅出4h']);
  
  verify.forEach(row => {
    const rowYm = row[1] instanceof Date
      ? Utilities.formatDate(row[1], 'Asia/Tokyo', 'yyyy-MM')
      : String(row[1]).substring(0, 7);
    if (rowYm !== '2026-05') return;
    const shift = String(row[8]).trim();
    const status = String(row[12]).trim();
    let bucket;
    if (nightShiftSet.has(shift)) bucket = '夜勤';
    else if (dayShiftSet.has(shift)) bucket = '日勤';
    else return;
    if (status === '仮') stats[bucket].仮++;
    else if (status === '確定') stats[bucket].確定++;
    else stats[bucket].その他++;
  });
  
  Logger.log(`夜勤: 仮=${stats.夜勤.仮} / 確定=${stats.夜勤.確定} / その他=${stats.夜勤.その他}`);
  Logger.log(`日勤: 仮=${stats.日勤.仮} / 確定=${stats.日勤.確定} / その他=${stats.日勤.その他}`);
  Logger.log(`合計仮: ${stats.夜勤.仮 + stats.日勤.仮}件`);
}