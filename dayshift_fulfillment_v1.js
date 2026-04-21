// ============================================================
// Step 4-3 v2: 日勤充足率レポート
// 修正内容: V_日勤充足 シートの充足率セルを文字列フォーマット(@)に固定
//           → "67.0%" が数値 0.67 に自動変換されるバグを修正
// ============================================================

const FULFILLMENT_SHEET_NAME = 'V_日勤充足';

function generateDayShiftFulfillmentReport(yearMonth) {
  const ym = yearMonth || '2026-05';
  Logger.log(`========== 日勤充足レポート生成 (${ym}) ==========`);
  const startTs = Date.now();

  const ctx = _loadFulfillmentContext(ym);
  Logger.log(`事業所: ${ctx.facilities.length} / 配置レコード: ${ctx.records.length}`);

  const summary = {};
  ctx.facilities.forEach(f => {
    summary[f.name] = {
      name: f.name,
      capacity: f.capacity,
      basisSewa: f.sewa,
      basisSeikatsu: f.seikatsu,
      basisTokutei: f.tokutei,
      basisSabikan: f.sabikan,
      basisNurseHead: f.nurseHead,
      needSewaH: f.sewa * 177,
      needSeikatsuH: f.seikatsu * 177,
      needTokuteiH: f.tokutei * 177,
      needSabikanH: f.sabikan * 177,
      sewaH: 0,
      seikatsuH: 0,
      sabikanH: 0,
      nurseDayStaff: new Set()
    };
  });

  let skippedRec = 0;
  ctx.records.forEach(r => {
    const s = summary[r.jigyosho];
    if (!s) { skippedRec++; return; }
    const hours = (r.dayH || 0);
    const role = _pickPrimaryRole(ctx.staffMap[r.staff_id]);
    if (role === 'サビ管') s.sabikanH += hours;
    else if (role === '生活支援員') s.seikatsuH += hours;
    else s.sewaH += hours;
    const staff = ctx.staffMap[r.staff_id];
    if (staff && staff.isNurse) s.nurseDayStaff.add(r.staff_id);
  });
  if (skippedRec > 0) Logger.log(`⚠ 事業所マッチしないレコード: ${skippedRec}件`);

  ctx.nightRecords.forEach(n => {
    const s = summary[n.jigyosho];
    if (!s) return;
    const pat = SHIFT_PATTERNS[n.shiftType];
    if (!pat || pat.dayHours === 0) return;
    const role = _pickPrimaryRole(ctx.staffMap[n.staff_id]);
    if (role === 'サビ管') s.sabikanH += pat.dayHours;
    else if (role === '生活支援員') s.seikatsuH += pat.dayHours;
    else s.sewaH += pat.dayHours;
    const staff = ctx.staffMap[n.staff_id];
    if (staff && staff.isNurse) s.nurseDayStaff.add(n.staff_id);
  });

  const rows = [];
  Object.keys(summary).sort().forEach(key => {
    const s = summary[key];
    const totalCareH = s.sewaH + s.seikatsuH;
    const tokuteiRate = s.needTokuteiH > 0 ? (totalCareH / s.needTokuteiH * 100) : 0;
    const sewaRate = s.needSewaH > 0 ? (s.sewaH / s.needSewaH * 100) : 0;
    const seikatsuRate = s.needSeikatsuH > 0 ? (s.seikatsuH / s.needSeikatsuH * 100) : 0;
    const sabikanRate = s.needSabikanH > 0 ? (s.sabikanH / s.needSabikanH * 100) : 0;
    const nurseCount = s.nurseDayStaff.size;
    const nurseOK = nurseCount >= s.basisNurseHead;

    rows.push([
      s.name,
      s.capacity,
      s.needTokuteiH.toFixed(0),
      (s.sewaH + s.seikatsuH).toFixed(1),
      tokuteiRate.toFixed(1) + '%',
      s.needSewaH.toFixed(0),
      s.sewaH.toFixed(1),
      sewaRate.toFixed(1) + '%',
      s.needSeikatsuH.toFixed(0),
      s.seikatsuH.toFixed(1),
      seikatsuRate.toFixed(1) + '%',
      s.needSabikanH.toFixed(0),
      s.sabikanH.toFixed(1),
      sabikanRate.toFixed(1) + '%',
      s.basisNurseHead,
      nurseCount,
      nurseOK ? 'OK' : '不足'
    ]);
  });

  _writeFulfillmentSheet(ym, rows);

  const elapsed = ((Date.now() - startTs) / 1000).toFixed(1);
  Logger.log(`\n========== 完了 (${elapsed}秒) ==========`);
  Logger.log(`V_日勤充足 シートに ${rows.length}事業所分を出力`);

  Logger.log('\n【事業所別 充足率サマリ】');
  rows.forEach(r => {
    Logger.log(`  ${r[0]}: 特定${r[4]} / 世話${r[7]} / 生活${r[10]} / サビ管${r[13]} / 看護${r[16]}`);
  });
}

function _loadFulfillmentContext(ym) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const baseSheet = ss.getSheetByName('M_事業所配置基準');
  const baseData = baseSheet.getRange(2, 1, baseSheet.getLastRow() - 1, 8).getValues();
  const facilities = baseData.map(row => {
    const capacity = parseFloat(row[1]) || 0;
    return {
      name: String(row[0]).trim(),
      capacity: capacity,
      sewa: parseFloat(row[2]) || 0,
      seikatsu: parseFloat(row[3]) || 0,
      tokutei: parseFloat(row[4]) || 0,
      sabikan: parseFloat(row[5]) || 0,
      nurseHead: Math.ceil(capacity / 20)
    };
  }).filter(f => f.name);

  const staffSheet = ss.getSheetByName('M_スタッフ');
  const staffData = staffSheet.getRange(2, 1, staffSheet.getLastRow() - 1, 20).getValues();
  const staffMap = {};
  staffData.forEach(row => {
    const sid = String(row[0]).trim();
    staffMap[sid] = {
      staff_id: sid,
      name: row[1],
      certification: String(row[5] || ''),
      mainRoles: String(row[19] || '世話人').split(',').map(s => s.trim()).filter(Boolean),
      isNurse: String(row[5] || '').indexOf('看護師') !== -1
    };
  });

  const cfSheet = ss.getSheetByName('T_シフト確定');
  const cfLast = cfSheet.getLastRow();
  const cfData = cfLast > 1 ? cfSheet.getRange(2, 1, cfLast - 1, 19).getValues() : [];

  const dayShiftSet = new Set(['早出8h', '早出4h', '遅出8h', '遅出4h']);
  const nightShiftSet = new Set(['夜勤A', '夜勤B', '夜勤C']);

  const records = [];
  const nightRecords = [];

  cfData.forEach(row => {
    const rowYm = row[1] instanceof Date
      ? Utilities.formatDate(row[1], 'Asia/Tokyo', 'yyyy-MM')
      : String(row[1]).substring(0, 7);
    if (rowYm !== ym) return;

    const shift = String(row[8]).trim();
    const rec = {
      date: row[1] instanceof Date
        ? Utilities.formatDate(row[1], 'Asia/Tokyo', 'yyyy-MM-dd')
        : String(row[1]),
      jigyosho: String(row[3]).trim(),
      staff_id: String(row[6]).trim(),
      shiftType: shift,
      dayH: parseFloat(row[18]) || 0,
      nightH: parseFloat(row[17]) || 0
    };

    if (dayShiftSet.has(shift)) records.push(rec);
    else if (nightShiftSet.has(shift)) nightRecords.push(rec);
  });

  return { facilities, staffMap, records, nightRecords };
}

function _pickPrimaryRole(staff) {
  if (!staff) return '世話人';
  const roles = staff.mainRoles || [];
  if (roles.indexOf('サビ管') !== -1) return 'サビ管';
  if (roles.indexOf('生活支援員') !== -1) return '生活支援員';
  return '世話人';
}

function _writeFulfillmentSheet(ym, rows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(FULFILLMENT_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(FULFILLMENT_SHEET_NAME);
  } else {
    sheet.clear();
  }

  sheet.getRange(1, 1).setValue(`日勤充足レポート (${ym})`).setFontWeight('bold').setFontSize(14);
  sheet.getRange(2, 1).setValue(`生成日時: ${new Date()}`).setFontSize(10).setFontColor('#6b7280');

  const headerRow1 = [
    '事業所', '定員',
    '特定加配(世+生)', '', '',
    '世話人', '', '',
    '生活支援員', '', '',
    'サビ管', '', '',
    '看護師', '', ''
  ];
  const headerRow2 = [
    '', '',
    '必要h', '実績h', '充足率',
    '必要h', '実績h', '充足率',
    '必要h', '実績h', '充足率',
    '必要h', '実績h', '充足率',
    '必要人数', '配置人数', '判定'
  ];

  sheet.getRange(4, 1, 1, headerRow1.length).setValues([headerRow1])
    .setFontWeight('bold').setBackground('#4a148c').setFontColor('#ffffff');
  sheet.getRange(5, 1, 1, headerRow2.length).setValues([headerRow2])
    .setFontWeight('bold').setBackground('#7c3aed').setFontColor('#ffffff');

  sheet.getRange(4, 3, 1, 3).merge();
  sheet.getRange(4, 6, 1, 3).merge();
  sheet.getRange(4, 9, 1, 3).merge();
  sheet.getRange(4, 12, 1, 3).merge();
  sheet.getRange(4, 15, 1, 3).merge();
  sheet.getRange(4, 1, 2, 1).merge();
  sheet.getRange(4, 2, 2, 1).merge();

  if (rows.length > 0) {
    // ★★ 修正ポイント ★★
    // 充足率セル(E,H,K,N列)を文字列フォーマット(@)に固定してから書き込む
    // これをしないとGoogle Sheetsが "67.0%" を数値 0.67 に自動変換してしまう
    const rateColumns = [5, 8, 11, 14];  // E, H, K, N列
    rateColumns.forEach(col => {
      sheet.getRange(6, col, rows.length, 1).setNumberFormat('@');
    });

    sheet.getRange(6, 1, rows.length, rows[0].length).setValues(rows);

    rows.forEach((row, i) => {
      const rowNum = 6 + i;
      _applyRateColor(sheet, rowNum, 5, row[4]);
      _applyRateColor(sheet, rowNum, 8, row[7]);
      _applyRateColor(sheet, rowNum, 11, row[10]);
      _applyRateColor(sheet, rowNum, 14, row[13]);
      const nurseJudge = row[16];
      sheet.getRange(rowNum, 17).setBackground(nurseJudge === 'OK' ? '#d1fae5' : '#fee2e2');
    });
  }

  sheet.setFrozenRows(5);
  sheet.setFrozenColumns(2);
  sheet.autoResizeColumns(1, 17);
}

function _applyRateColor(sheet, row, col, rateStr) {
  const rate = parseFloat(String(rateStr).replace('%', '')) || 0;
  let bg;
  if (rate >= 100) bg = '#d1fae5';
  else if (rate >= 80) bg = '#fef9c3';
  else bg = '#fee2e2';
  sheet.getRange(row, col).setBackground(bg);
}