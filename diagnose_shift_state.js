function diagnoseShiftConfirmState() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('T_シフト確定');
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 19).getValues();
  
  const dayShiftSet = new Set(['早出8h', '早出4h', '遅出8h', '遅出4h']);
  const nightShiftSet = new Set(['夜勤A', '夜勤B', '夜勤C']);
  
  const stats = { 
    夜勤: { 仮: 0, 確定: 0, その他: 0 }, 
    日勤: { 仮: 0, 確定: 0, その他: 0 },
    その他シフト: { 仮: 0, 確定: 0, その他: 0 }
  };
  
  data.forEach(row => {
    const rowYm = row[1] instanceof Date
      ? Utilities.formatDate(row[1], 'Asia/Tokyo', 'yyyy-MM')
      : String(row[1]).substring(0, 7);
    if (rowYm !== '2026-05') return;
    
    const shift = String(row[8]).trim();
    const status = String(row[13]).trim();
    
    let bucket;
    if (nightShiftSet.has(shift)) bucket = '夜勤';
    else if (dayShiftSet.has(shift)) bucket = '日勤';
    else bucket = 'その他シフト';
    
    if (status === '仮') stats[bucket].仮++;
    else if (status === '確定') stats[bucket].確定++;
    else stats[bucket].その他++;
  });
  
  Logger.log('========== 2026-05 シフト別ステータス ==========');
  Logger.log(`夜勤: 仮=${stats.夜勤.仮} / 確定=${stats.夜勤.確定} / その他=${stats.夜勤.その他}`);
  Logger.log(`日勤: 仮=${stats.日勤.仮} / 確定=${stats.日勤.確定} / その他=${stats.日勤.その他}`);
  Logger.log(`その他: 仮=${stats.その他シフト.仮} / 確定=${stats.その他シフト.確定} / その他=${stats.その他シフト.その他}`);
  Logger.log(`合計仮: ${stats.夜勤.仮 + stats.日勤.仮 + stats.その他シフト.仮}件`);
  Logger.log(`画面表示の「仮: 669」との差分を確認`);
}
function diagnoseStatusValues() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('T_シフト確定');
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 19).getValues();
  
  const nightShiftSet = new Set(['夜勤A', '夜勤B', '夜勤C']);
  const statusValues = {};
  
  data.forEach(row => {
    const rowYm = row[1] instanceof Date
      ? Utilities.formatDate(row[1], 'Asia/Tokyo', 'yyyy-MM')
      : String(row[1]).substring(0, 7);
    if (rowYm !== '2026-05') return;
    
    const shift = String(row[8]).trim();
    if (!nightShiftSet.has(shift)) return;
    
    const rawStatus = row[13];
    const key = `"${String(rawStatus)}" (type:${typeof rawStatus}, len:${String(rawStatus).length})`;
    statusValues[key] = (statusValues[key] || 0) + 1;
  });
  
  Logger.log('========== 2026-05 夜勤のステータス値の分布 ==========');
  Object.keys(statusValues).sort().forEach(k => {
    Logger.log(`  ${k}: ${statusValues[k]}件`);
  });
  
  // 先頭5行の詳細
  Logger.log('\n========== 夜勤先頭5行のN列生データ ==========');
  let shown = 0;
  for (const row of data) {
    const shift = String(row[8]).trim();
    if (!nightShiftSet.has(shift)) continue;
    const rowYm = row[1] instanceof Date
      ? Utilities.formatDate(row[1], 'Asia/Tokyo', 'yyyy-MM')
      : String(row[1]).substring(0, 7);
    if (rowYm !== '2026-05') continue;
    Logger.log(`  ${shift} / 氏名=${row[7]} / N列="${row[13]}" (${typeof row[13]})`);
    shown++;
    if (shown >= 5) break;
  }
}
function showShiftSheetHeaders() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('T_シフト確定');
  const headers = sh.getRange(1, 1, 1, 19).getValues()[0];
  Logger.log('========== T_シフト確定 のヘッダ行 ==========');
  headers.forEach((h, i) => {
    const col = String.fromCharCode(65 + i);  // A, B, C...
    Logger.log(`  ${col}列 (index ${i}): "${h}"`);
  });
}