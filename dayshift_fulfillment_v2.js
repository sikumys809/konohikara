// ============================================================
// 日勤充足率レポート v2
// 仕様書: https://app.notion.com/p/353ec81ceecf81379cd2e6b3ffc2307d
//
// v1との違い:
// - 必要時間: 177h固定 → 月の日数 × 40 ÷ 7 (動的計算)
// - 管理者列を追加 (二重計上の結果を表示)
// - データソース: 独自集計 → calcRoleHoursV2 (dayshift_engine_v2 のロジックを再利用)
// - DRY: dayshift_engine_v2 の関数群に依存
// ============================================================

const FULFILLMENT_SHEET_NAME_V2 = 'V_日勤充足';

// ============================================================
// generateDayShiftFulfillmentReportV2: メインエントリ
// 引数: yearMonth (e.g. "2026-05")
// ============================================================
function generateDayShiftFulfillmentReportV2(yearMonth) {
  const ym = yearMonth || '2026-05';
  Logger.log('========== 日勤充足レポート v2 (' + ym + ') ==========');
  const startTs = Date.now();
  
  // 1. dayshift_engine_v2 の ctx を構築
  if (typeof loadEngineContextV2 !== 'function') {
    throw new Error('loadEngineContextV2 が見つからない (dayshift_engine_v2.js が必要)');
  }
  const ctx = loadEngineContextV2(ym);
  Logger.log('事業所: ' + Object.keys(ctx.facilityBasis).length);
  Logger.log('スタッフ: ' + Object.keys(ctx.staffMap).length);
  Logger.log('1人あたり月必要h: ' + ctx.hoursPerPerson.toFixed(2) + ' (' + ctx.daysInMonth + '日)');
  
  // 2. 役割別時間集計 (calcRoleHoursV2 が管理者の二重計上を含めて全部やってくれる)
  if (typeof calcRoleHoursV2 !== 'function') {
    throw new Error('calcRoleHoursV2 が見つからない');
  }
  const roleHours = calcRoleHoursV2(ctx);
  
  // 3. 行データ生成 (事業所名でソート)
  const rows = [];
  Object.keys(roleHours).sort().forEach(function(jig) {
    const r = roleHours[jig];
    const basis = ctx.facilityBasis[jig];
    const nurseOK = r.nurseCount >= r.nurseRequired;
    
    rows.push([
      jig,                                  // 1. 事業所
      basis.capacity,                       // 2. 定員
      // 特定加配 (世+生)
      r.needTokuteiH.toFixed(0),            // 3. 必要h
      r.tokuteiH.toFixed(1),                // 4. 実績h
      r.tokuteiRate.toFixed(1) + '%',       // 5. 充足率
      // 世話人
      r.needSewaH.toFixed(0),               // 6
      r.sewaH.toFixed(1),                   // 7
      r.sewaRate.toFixed(1) + '%',          // 8
      // 生活支援員
      r.needSeikatsuH.toFixed(0),           // 9
      r.seikatsuH.toFixed(1),               // 10
      r.seikatsuRate.toFixed(1) + '%',      // 11
      // サビ管
      r.needSabikanH.toFixed(0),            // 12
      r.sabikanH.toFixed(1),                // 13
      r.sabikanRate.toFixed(1) + '%',       // 14
      // 管理者 (★v2 新規)
      r.needKanrishaH.toFixed(0),           // 15
      r.kanrishaH.toFixed(1),               // 16
      r.kanrishaRate.toFixed(1) + '%',      // 17
      // 看護師
      r.nurseRequired,                      // 18
      r.nurseCount,                         // 19
      nurseOK ? 'OK' : '不足'               // 20
    ]);
  });
  
  // 4. シートに書き込み
  _writeFulfillmentSheetV2(ym, rows);
  
  const elapsed = ((Date.now() - startTs) / 1000).toFixed(2);
  Logger.log('');
  Logger.log('========== 完了 (' + elapsed + '秒) ==========');
  Logger.log('V_日勤充足 シートに ' + rows.length + '事業所分を出力');
  
  // サマリログ
  Logger.log('');
  Logger.log('【事業所別 充足率サマリ】');
  rows.forEach(function(row) {
    Logger.log('  ' + row[0] + ': 特定=' + row[4] + ' / 世話=' + row[7] + ' / 生活=' + row[10] + ' / サビ管=' + row[13] + ' / 管理者=' + row[16] + ' / 看護=' + row[19]);
  });
  
  return {
    targetYM: ym,
    elapsed: elapsed,
    facilityCount: rows.length
  };
}

// ============================================================
// _writeFulfillmentSheetV2: V_日勤充足シートへの書き込み
// 20列構造 (v1の17列 + 管理者3列)
// ============================================================
function _writeFulfillmentSheetV2(ym, rows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(FULFILLMENT_SHEET_NAME_V2);
  if (!sheet) {
    sheet = ss.insertSheet(FULFILLMENT_SHEET_NAME_V2);
  } else {
    sheet.clear();
    // 既存の固定行/列を解除 (merge時のエラー防止)
    if (sheet.getFrozenRows() > 0) sheet.setFrozenRows(0);
    if (sheet.getFrozenColumns() > 0) sheet.setFrozenColumns(0);
    // 既存の merge も解除
    sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).breakApart();
  }
  
  // タイトル + 生成日時
  sheet.getRange(1, 1).setValue('日勤充足レポート v2 (' + ym + ')')
    .setFontWeight('bold').setFontSize(14);
  sheet.getRange(2, 1).setValue('生成日時: ' + new Date())
    .setFontSize(10).setFontColor('#6b7280');
  sheet.getRange(3, 1).setValue('※管理者h は二重計上 (兼任先のh にも加算済み)')
    .setFontSize(10).setFontColor('#6b7280').setFontStyle('italic');
  
  // ヘッダー (2行マージ構造、20列)
  const headerRow1 = [
    '事業所', '定員',
    '特定加配(世+生)', '', '',
    '世話人', '', '',
    '生活支援員', '', '',
    'サビ管', '', '',
    '管理者★', '', '',
    '看護師', '', ''
  ];
  const headerRow2 = [
    '', '',
    '必要h', '実績h', '充足率',
    '必要h', '実績h', '充足率',
    '必要h', '実績h', '充足率',
    '必要h', '実績h', '充足率',
    '必要h', '実績h', '充足率',
    '必要人数', '配置人数', '判定'
  ];
  
  sheet.getRange(5, 1, 1, headerRow1.length).setValues([headerRow1])
    .setFontWeight('bold').setBackground('#4a148c').setFontColor('#ffffff');
  sheet.getRange(6, 1, 1, headerRow2.length).setValues([headerRow2])
    .setFontWeight('bold').setBackground('#7c3aed').setFontColor('#ffffff');
  
  // セル結合 (各役割の3列 + 看護師の3列 + 事業所/定員の2行縦結合)
  sheet.getRange(5, 3, 1, 3).merge();   // 特定加配
  sheet.getRange(5, 6, 1, 3).merge();   // 世話人
  sheet.getRange(5, 9, 1, 3).merge();   // 生活支援員
  sheet.getRange(5, 12, 1, 3).merge();  // サビ管
  sheet.getRange(5, 15, 1, 3).merge();  // 管理者
  sheet.getRange(5, 18, 1, 3).merge();  // 看護師
  sheet.getRange(5, 1, 2, 1).merge();   // 事業所
  sheet.getRange(5, 2, 2, 1).merge();   // 定員
  
  if (rows.length > 0) {
    // 充足率列を文字列フォーマットに (% 含むので)
    const rateColumns = [5, 8, 11, 14, 17];
    rateColumns.forEach(function(col) {
      sheet.getRange(7, col, rows.length, 1).setNumberFormat('@');
    });
    
    // データ書き込み
    sheet.getRange(7, 1, rows.length, rows[0].length).setValues(rows);
    
    // 充足率の色付け
    rows.forEach(function(row, i) {
      const rowNum = 7 + i;
      _applyRateColorV2(sheet, rowNum, 5, row[4]);    // 特定加配
      _applyRateColorV2(sheet, rowNum, 8, row[7]);    // 世話人
      _applyRateColorV2(sheet, rowNum, 11, row[10]);  // 生活支援員
      _applyRateColorV2(sheet, rowNum, 14, row[13]);  // サビ管
      _applyRateColorV2(sheet, rowNum, 17, row[16]);  // 管理者
      // 看護師判定の背景色
      const nurseJudge = row[19];
      sheet.getRange(rowNum, 20).setBackground(nurseJudge === 'OK' ? '#d1fae5' : '#fee2e2');
    });
  }
  
  // 固定行 (ヘッダー6行まで) + 固定列 (事業所/定員の2列)
  sheet.setFrozenRows(6);
  sheet.setFrozenColumns(2);
  sheet.autoResizeColumns(1, 20);
}

// ============================================================
// _applyRateColorV2: 充足率の色分け
// 100%以上=緑 / 80%以上=黄 / 80%未満=赤
// ============================================================
function _applyRateColorV2(sheet, row, col, rateStr) {
  const rate = parseFloat(String(rateStr).replace('%', ''));
  if (isNaN(rate)) return;
  
  let bgColor;
  if (rate >= 100) bgColor = '#d1fae5';      // 緑 (充足)
  else if (rate >= 80) bgColor = '#fef3c7';  // 黄 (準充足)
  else bgColor = '#fee2e2';                   // 赤 (不足)
  
  sheet.getRange(row, col).setBackground(bgColor);
}

// ============================================================
// テスト関数
// ============================================================
function testGenerateDayShiftFulfillmentReportV2() {
  Logger.log('=== dayshift_fulfillment_v2 動作確認 ===');
  Logger.log('');
  const result = generateDayShiftFulfillmentReportV2('2026-05');
  Logger.log('');
  Logger.log('結果: ' + JSON.stringify(result));
}
