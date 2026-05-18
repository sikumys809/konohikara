// ============================================================
// 固定配置機能 (Phase 7)
// M_固定配置 シートの管理 + 固定配置展開ロジック
// ============================================================

const FIXED_ASSIGNMENT_SHEET_NAME = 'M_固定配置';

const FIXED_ASSIGN_TYPE = {
  DATE: '日付指定',     // 月単位の日指定 (yyyy-MM の特定日)
  WEEKDAY: '曜日指定'   // 毎週繰り返し (月/火/水/木/金/土/日)
};

const FIXED_ASSIGN_HEADERS = [
  'fixed_id',         // A: 一意ID (例: FIXED_001)
  'staff_id',         // B: スタッフID
  'type',             // C: 日付指定 / 曜日指定
  'target_ym',        // D: 日付指定の場合のみ (yyyy-MM、曜日指定は空)
  'dates_or_weekdays',// E: カンマ区切り (例: "1,3,5,8" or "月,火,水,木,金")
  'shift_type',       // F: 既存7種類から (早出8h/早出4h/遅出8h/遅出4h/夜勤A/B/C)
  'unit_id',          // G: 配置ユニット
  'valid_from',       // H: 有効期間開始 (yyyy-MM)
  'valid_to',         // I: 有効期間終了 (yyyy-MM、永続は "9999-12")
  'is_active',        // J: 有効フラグ (TRUE/FALSE)
  'note',             // K: 備考 (任意)
  'created_at'        // L: 作成日時
];

const WEEKDAY_MAP = {
  '日': 0, '月': 1, '火': 2, '水': 3, '木': 4, '金': 5, '土': 6
};

// ============================================================
// シート初期化
// ============================================================
function initFixedAssignmentSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(FIXED_ASSIGNMENT_SHEET_NAME);
  
  if (sheet) {
    Logger.log('既存の ' + FIXED_ASSIGNMENT_SHEET_NAME + ' シートを使用');
  } else {
    sheet = ss.insertSheet(FIXED_ASSIGNMENT_SHEET_NAME);
    Logger.log(FIXED_ASSIGNMENT_SHEET_NAME + ' シートを新規作成');
  }
  
  // ヘッダー設定
  sheet.getRange(1, 1, 1, FIXED_ASSIGN_HEADERS.length).setValues([FIXED_ASSIGN_HEADERS]);
  sheet.getRange(1, 1, 1, FIXED_ASSIGN_HEADERS.length)
    .setFontWeight('bold')
    .setBackground('#10b981')
    .setFontColor('#ffffff');
  sheet.setFrozenRows(1);
  
  // 列フォーマット
  sheet.getRange('D:D').setNumberFormat('@');  // target_ym 文字列
  sheet.getRange('H:H').setNumberFormat('@');  // valid_from 文字列
  sheet.getRange('I:I').setNumberFormat('@');  // valid_to 文字列
  sheet.getRange('L:L').setNumberFormat('yyyy-MM-dd HH:mm:ss');
  
  // 列幅調整
  const widths = [110, 70, 90, 90, 200, 90, 70, 90, 90, 80, 200, 150];
  widths.forEach(function(w, i) { sheet.setColumnWidth(i + 1, w); });
  
  // 入力規則: type 列
  const typeRule = SpreadsheetApp.newDataValidation()
    .requireValueInList([FIXED_ASSIGN_TYPE.DATE, FIXED_ASSIGN_TYPE.WEEKDAY], true).build();
  sheet.getRange('C2:C').setDataValidation(typeRule);
  
  // 入力規則: shift_type 列
  const shiftRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['早出8h', '早出4h', '遅出8h', '遅出4h', '夜勤A', '夜勤B', '夜勤C'], true).build();
  sheet.getRange('F2:F').setDataValidation(shiftRule);
  
  // 入力規則: is_active 列
  const activeRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['TRUE', 'FALSE'], true).build();
  sheet.getRange('J2:J').setDataValidation(activeRule);
  
  Logger.log('M_固定配置 シート初期化完了');
  return { success: true };
}

// ============================================================
// fixed_id 生成
// ============================================================
function _generateFixedId() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName(FIXED_ASSIGNMENT_SHEET_NAME);
  if (!sheet) return 'FIXED_001';
  const data = sheet.getDataRange().getValues();
  let maxNum = 0;
  for (var i = 1; i < data.length; i++) {
    const id = String(data[i][0] || '');
    const m = id.match(/^FIXED_(\d+)$/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > maxNum) maxNum = n;
    }
  }
  return 'FIXED_' + String(maxNum + 1).padStart(3, '0');
}

// ============================================================
// 固定配置 追加
// ============================================================
function addFixedAssignment(params) {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  let sheet = ss.getSheetByName(FIXED_ASSIGNMENT_SHEET_NAME);
  if (!sheet) {
    initFixedAssignmentSheet();
    sheet = ss.getSheetByName(FIXED_ASSIGNMENT_SHEET_NAME);
  }
  
  // バリデーション (unit_id は夜勤時のみ必須、日勤は空文字でOK)
  if (!params.staff_id || !params.type || !params.dates_or_weekdays || !params.shift_type) {
    return { success: false, message: '必須項目不足: staff_id, type, dates_or_weekdays, shift_type' };
  }
  // 夜勤シフトの場合のみ unit_id 必須チェック
  if (params.shift_type && params.shift_type.indexOf('夜勤') === 0 && !params.unit_id) {
    return { success: false, message: '夜勤シフトの場合は unit_id が必須' };
  }
  if (params.type !== FIXED_ASSIGN_TYPE.DATE && params.type !== FIXED_ASSIGN_TYPE.WEEKDAY) {
    return { success: false, message: 'type は "日付指定" または "曜日指定" のみ' };
  }
  if (params.type === FIXED_ASSIGN_TYPE.DATE && !params.target_ym) {
    return { success: false, message: '日付指定の場合は target_ym 必須' };
  }
  
  const fixedId = _generateFixedId();
  const now = new Date();
  
  const newRow = [
    fixedId,
    String(params.staff_id),
    params.type,
    params.target_ym || '',
    params.dates_or_weekdays,
    params.shift_type,
    params.unit_id,
    params.valid_from || '2026-01',
    params.valid_to || '9999-12',
    params.is_active === false ? 'FALSE' : 'TRUE',
    params.note || '',
    now
  ];
  
  // ★Day15 P1-P4: H1-H14 違反チェック (登録前)
  // チェック対象月の決定:
  //   日付指定 → params.target_ym
  //   曜日指定 → params.target_ym があればそれ、無ければ次月
  let _checkYM = params.target_ym;
  if (!_checkYM) {
    const _now = new Date();
    _now.setMonth(_now.getMonth() + 1);
    _checkYM = _now.getFullYear() + '-' + String(_now.getMonth() + 1).padStart(2, '0');
  }
  
  try {
    const _violations = _validateFixedAssignmentH(params, _checkYM);
    if (_violations.length > 0) {
      // 違反あり: 登録拒否
      const _msgs = _violations.slice(0, 5).map(function(v) {
        return '[' + v.ruleId + '] ' + v.date + ': ' + v.message;
      }).join('\n');
      const _suffix = _violations.length > 5 ? '\n他' + (_violations.length - 5) + '件' : '';
      return {
        success: false,
        message: 'H制約違反のため登録できません (' + _violations.length + '件):\n' + _msgs + _suffix,
        violations: _violations
      };
    }
  } catch (e) {
    Logger.log('固定配置H違反チェックエラー: ' + e.message);
    // チェック自体がエラーの場合は登録を続行 (フェイルセーフ)
  }
  
  sheet.appendRow(newRow);
  Logger.log('固定配置追加: ' + fixedId + ' / staff=' + params.staff_id);
  return { success: true, fixed_id: fixedId };
}


// ★Day15 P1-P4: 固定配置の H1-H14 違反検証ヘルパー
// 戻り値: 違反一覧 [{ ruleId, date, message }, ...]
function _validateFixedAssignmentH(params, targetYM) {
  const violations = [];
  
  // 1. 展開日付の生成
  const [yearStr, monthStr] = targetYM.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const daysInMonth = new Date(year, month, 0).getDate();
  
  const expandedDates = [];
  if (params.type === FIXED_ASSIGN_TYPE.DATE) {
    // 日付指定: "1,5,15" → [1, 5, 15]
    const dayNums = String(params.dates_or_weekdays).split(',').map(function(s) { return parseInt(s.trim(), 10); }).filter(function(n) { return !isNaN(n) && n >= 1 && n <= daysInMonth; });
    dayNums.forEach(function(d) {
      expandedDates.push(targetYM + '-' + String(d).padStart(2, '0'));
    });
  } else if (params.type === FIXED_ASSIGN_TYPE.WEEKDAY) {
    // 曜日指定: "月,水" → 該当月の月曜・水曜全部
    const wdMap = { '日': 0, '月': 1, '火': 2, '水': 3, '木': 4, '金': 5, '土': 6 };
    const targetWds = String(params.dates_or_weekdays).split(',').map(function(s) { return wdMap[s.trim()]; }).filter(function(w) { return w !== undefined; });
    for (let d = 1; d <= daysInMonth; d++) {
      const dt = new Date(year, month - 1, d);
      if (targetWds.indexOf(dt.getDay()) !== -1) {
        expandedDates.push(targetYM + '-' + String(d).padStart(2, '0'));
      }
    }
  }
  
  if (expandedDates.length === 0) return violations;
  
  // 2. M_スタッフ 読込 (staff オブジェクト構築)
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const staffSheet = ss.getSheetByName('M_スタッフ');
  const staffData = staffSheet.getDataRange().getValues();
  let staffForCheck = null;
  const sid = String(params.staff_id).trim();
  for (let i = 1; i < staffData.length; i++) {
    if (String(staffData[i][0]).trim() === sid) {
      const _subRaw = String(staffData[i][11] || '').trim();
      const _allowedRaw = String(staffData[i][13] || '').trim();
      staffForCheck = {
        staff_id: sid,
        name: staffData[i][1],
        mainFac: String(staffData[i][9] || '').trim(),
        secondFac: String(staffData[i][10] || '').trim(),
        subFacs: _subRaw ? _subRaw.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [],
        allowedShifts: _allowedRaw ? _allowedRaw.split(',').map(function(s) { return s.trim(); }) : [],
        kubun: String(staffData[i][8] || '').trim(),
      };
      break;
    }
  }
  if (!staffForCheck) {
    violations.push({ ruleId: 'STAFF', date: '-', message: 'スタッフID見つからず: ' + sid });
    return violations;
  }
  
  // 3. T_シフト確定 読込 → staffAssignedDates 構築 (target月のみ)
  const cfSheet = ss.getSheetByName('T_シフト確定');
  const cfLast = cfSheet.getLastRow();
  const staffAssignedDates = {};
  if (cfLast > 1) {
    const cfData = cfSheet.getRange(2, 1, cfLast - 1, 19).getValues();
    cfData.forEach(function(row) {
      const rowDate = row[1] instanceof Date
        ? Utilities.formatDate(row[1], 'Asia/Tokyo', 'yyyy-MM-dd')
        : String(row[1]);
      if (rowDate.indexOf(targetYM) !== 0) return;
      const _sid = String(row[6]);
      if (!_sid) return;
      const _shift = String(row[8]);
      const _jig = String(row[3]);
      const _fac = String(row[4]);
      const _wh = (parseFloat(row[17]) || 0) + (parseFloat(row[16]) || 0);
      if (!staffAssignedDates[_sid]) staffAssignedDates[_sid] = {};
      if (!staffAssignedDates[_sid][rowDate]) staffAssignedDates[_sid][rowDate] = [];
      staffAssignedDates[_sid][rowDate].push({ shift: _shift, jigyosho: _jig, facility: _fac, workHours: _wh });
    });
  }
  
  // 4. facilityToJigyoshos 構築 + unit_id → facility/jigyosho 解決
  const unitSheet = ss.getSheetByName('M_ユニット');
  const unitData = unitSheet.getDataRange().getValues();
  const facilityToJigyoshos = {};
  const unitMap = {};
  for (let i = 1; i < unitData.length; i++) {
    const _unitId = String(unitData[i][0] || '').trim();
    const _jig = String(unitData[i][1] || '').trim();
    const _fac = String(unitData[i][3] || '').trim();
    if (_unitId) unitMap[_unitId] = { jigyosho: _jig, facility: _fac };
    if (_jig && _fac) {
      if (!facilityToJigyoshos[_fac]) facilityToJigyoshos[_fac] = [];
      if (facilityToJigyoshos[_fac].indexOf(_jig) === -1) facilityToJigyoshos[_fac].push(_jig);
    }
  }
  
  // 5. シフトの想定勤務時間
  const SHIFT_HOURS = { '早出8h': 8, '早出4h': 4, '遅出8h': 8, '遅出4h': 4, '夜勤A': 2, '夜勤B': 2, '夜勤C': 2 };
  
  // 6. 展開日ごとに runAllChecks
  // unit_id → facility/jigyosho を解決
  let resolvedFacility = '';
  let resolvedJigyosho = '';
  if (params.unit_id && unitMap[params.unit_id]) {
    resolvedFacility = unitMap[params.unit_id].facility;
    resolvedJigyosho = unitMap[params.unit_id].jigyosho;
  } else {
    // 日勤で unit_id 無し → スタッフのメイン施設を仮想で使う
    resolvedFacility = staffForCheck.mainFac || '';
    const _facJigs = facilityToJigyoshos[resolvedFacility] || [];
    resolvedJigyosho = _facJigs[0] || '';
  }
  
  const ctx = { staffAssignedDates: staffAssignedDates, facilityToJigyoshos: facilityToJigyoshos };
  
  // ★Day15 P1-P4: 展開日を順次 ctx.staffAssignedDates に追加していき、
  // 同月内の自身同士の累積チェック(週40h超など)も検出可能にする
  if (!ctx.staffAssignedDates[sid]) ctx.staffAssignedDates[sid] = {};
  
  expandedDates.forEach(function(dateKey) {
    const slot = {
      date: dateKey,
      shift: params.shift_type,
      facility: resolvedFacility,
      jigyosho: resolvedJigyosho,
      hours: SHIFT_HOURS[params.shift_type] || 0,
    };
    try {
      const checkResult = runAllChecks(staffForCheck, slot, ctx);
      (checkResult.violations || []).filter(function(v) { return v.level === 'block'; }).forEach(function(v) {
        violations.push({ ruleId: v.ruleId, date: dateKey, message: v.message });
      });
    } catch (e) {
      Logger.log('runAllChecks エラー date=' + dateKey + ': ' + e.message);
    }
    
    // ★この日の配置を ctx に追加 (次の日のチェック時に累積される)
    if (!ctx.staffAssignedDates[sid][dateKey]) ctx.staffAssignedDates[sid][dateKey] = [];
    ctx.staffAssignedDates[sid][dateKey].push({
      shift: params.shift_type,
      jigyosho: resolvedJigyosho,
      facility: resolvedFacility,
      workHours: SHIFT_HOURS[params.shift_type] || 0,
    });
  });
  
  return violations;
}

// ============================================================
// 固定配置 一覧取得
// ============================================================
function listFixedAssignments(filter) {
  filter = filter || {};
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName(FIXED_ASSIGNMENT_SHEET_NAME);
  if (!sheet) return { success: true, items: [] };
  
  const data = sheet.getDataRange().getValues();
  const items = [];
  
  for (var i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    
    // Date オブジェクトを yyyy-MM 文字列に変換するヘルパー
    const _toYm = function(v) {
      if (!v) return '';
      if (v instanceof Date) return Utilities.formatDate(v, 'JST', 'yyyy-MM');
      const s = String(v);
      // ISO形式や日時形式から年月だけ抽出
      const m = s.match(/^(\d{4}-\d{2})/);
      return m ? m[1] : s;
    };
    
    const item = {
      fixed_id: data[i][0],
      staff_id: String(data[i][1] || ''),
      type: data[i][2],
      target_ym: _toYm(data[i][3]),
      dates_or_weekdays: data[i][4],
      shift_type: data[i][5],
      unit_id: data[i][6],
      valid_from: _toYm(data[i][7]),
      valid_to: _toYm(data[i][8]),
      is_active: String(data[i][9]).toUpperCase() === 'TRUE',
      note: data[i][10],
      created_at: data[i][11] ? (data[i][11] instanceof Date ? Utilities.formatDate(data[i][11], 'JST', 'yyyy-MM-dd HH:mm:ss') : String(data[i][11])) : '',
      // ★ Phase 7.5: 拡張フィールド (note列に JSON 埋め込み or 専用列)
      dates_shifts_map: _parseDatesShiftsMap(data[i][10]),  // K列 noteから抽出 (後方互換)
      dates_config_map: _parseDatesShiftsMap(data[i][10]),  // ★ Phase 7.5.4: 同じJSON、UIから別名で読む用
      facility: ''  // 将来的に専用列に分離する場合
    };
    
    // フィルタ
    if (filter.staff_id && String(filter.staff_id) !== item.staff_id) continue;
    if (filter.is_active === true && !item.is_active) continue;
    if (filter.is_active === false && item.is_active) continue;
    if (filter.unit_id && filter.unit_id !== item.unit_id) continue;
    
    items.push(item);
  }
  
  return { success: true, items: items };
}

// ============================================================
// 固定配置 削除
// ============================================================
function deleteFixedAssignment(fixedId) {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName(FIXED_ASSIGNMENT_SHEET_NAME);
  if (!sheet) return { success: false, message: 'シート無し' };
  
  const data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === fixedId) {
      sheet.deleteRow(i + 1);
      Logger.log('固定配置削除: ' + fixedId);
      return { success: true };
    }
  }
  return { success: false, message: '対象が見つかりません: ' + fixedId };
}

// ============================================================
// 固定配置 有効/無効切替
// ============================================================
function toggleFixedAssignment(fixedId, isActive) {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName(FIXED_ASSIGNMENT_SHEET_NAME);
  if (!sheet) return { success: false, message: 'シート無し' };
  
  const data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === fixedId) {
      sheet.getRange(i + 1, 10).setValue(isActive ? 'TRUE' : 'FALSE');
      return { success: true };
    }
  }
  return { success: false, message: '対象が見つかりません: ' + fixedId };
}

// ============================================================
// テスト関数: 固定配置システム動作確認
// ============================================================
function testFixedAssignmentSystem() {
  Logger.log('=== 固定配置システム テスト ===');
  
  // Step 1: シート初期化
  initFixedAssignmentSheet();
  Logger.log('Step 1: シート初期化 OK');
  
  // Step 2: 追加テスト (曜日指定)
  const r1 = addFixedAssignment({
    staff_id: '5',  // 水野恵子 (管理者)
    type: FIXED_ASSIGN_TYPE.WEEKDAY,
    dates_or_weekdays: '月,火,水,木,金',
    shift_type: '早出8h',
    unit_id: 'U15',  // GHコノヒカラ / リフレ要町 402
    valid_from: '2026-01',
    valid_to: '9999-12',
    is_active: true,
    note: 'テスト: 管理者の固定配置'
  });
  Logger.log('Step 2: 曜日指定追加 ' + JSON.stringify(r1));
  
  // Step 3: 追加テスト (日付指定)
  const r2 = addFixedAssignment({
    staff_id: '13',  // 水野永吉 (オーナー)
    type: FIXED_ASSIGN_TYPE.DATE,
    target_ym: '2026-06',
    dates_or_weekdays: '1,8,15,22,29',
    shift_type: '遅出8h',
    unit_id: 'U14',
    valid_from: '2026-06',
    valid_to: '2026-06',
    is_active: true,
    note: 'テスト: 6月のみ毎週月曜固定'
  });
  Logger.log('Step 3: 日付指定追加 ' + JSON.stringify(r2));
  
  // Step 4: 一覧取得
  const list = listFixedAssignments({ is_active: true });
  Logger.log('Step 4: 一覧取得 ' + list.items.length + '件');
  list.items.forEach(function(item) {
    Logger.log('  ' + item.fixed_id + ' / sid=' + item.staff_id + ' / ' + item.type + ' / ' + item.shift_type + ' @ ' + item.unit_id);
  });
  
  Logger.log('=== テスト完了 ===');
}




// ============================================================
// Phase 7.5: dates_shifts_map JSONを noteフィールドから抽出
// 既存の note を破壊しないため、note内に JSON_MAP:{...} という形式で埋め込む
// ============================================================
function _parseDatesShiftsMap(noteStr) {
  if (!noteStr) return null;
  const s = String(noteStr);
  const m = s.match(/JSON_MAP:(\{.*?\})(?:\s|$)/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch (e) {
    return null;
  }
}

// noteフィールドに JSON_MAP を埋め込む
function _embedDatesShiftsMap(note, mapObj) {
  if (!mapObj) return note || '';
  const json = JSON.stringify(mapObj);
  const clean = String(note || '').replace(/JSON_MAP:\{.*?\}(?:\s|$)/g, '').trim();
  return (clean ? clean + ' ' : '') + 'JSON_MAP:' + json;
}

// ユニットIDが見つからない時にfacilityから探す (将来使用)
function _findUnitByFacility(item, unitMap) {
  if (!item.facility) return null;
  for (var k in unitMap) {
    if (unitMap[k].facility === item.facility) return unitMap[k];
  }
  return null;
}

// ============================================================
// 固定配置展開: M_固定配置 → 対象月の日付に展開
// 戻り値: [{staff_id, dateKey, shift, unit_id, jigyosho, facility, unit_name}, ...]
// ============================================================
function expandFixedAssignments(targetYM) {
  const result = listFixedAssignments({ is_active: true });
  if (!result.success || result.items.length === 0) return [];
  
  // ユニット情報マップ
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const unitSheet = ss.getSheetByName('M_ユニット');
  const unitData = unitSheet.getDataRange().getValues();
  const unitMap = {};
  for (var u = 1; u < unitData.length; u++) {
    if (!unitData[u][0]) continue;
    unitMap[String(unitData[u][0])] = {
      jigyosho: unitData[u][1],
      unit_name: unitData[u][2],
      facility: unitData[u][3]
    };
  }
  
  // スタッフ名マップ
  const staffSheet = ss.getSheetByName('M_スタッフ');
  const staffData = staffSheet.getDataRange().getValues();
  const staffNameMap = {};
  for (var s = 1; s < staffData.length; s++) {
    if (!staffData[s][0]) continue;
    staffNameMap[String(staffData[s][0])] = staffData[s][1];
  }
  
  // 対象月の日数
  const [yearStr, monthStr] = targetYM.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const daysInMonth = new Date(year, month, 0).getDate();
  
  const expanded = [];
  
  result.items.forEach(function(item) {
    // 有効期間チェック
    if (item.valid_from && targetYM < item.valid_from) return;
    if (item.valid_to && targetYM > item.valid_to) return;
    
    // ★ Phase 7.5: dates_shifts_map (JSON) があれば優先、無ければ既存形式 (item.shift_type を全日に適用)
    // 値は文字列 "早出8h" or オブジェクト {shift, facility, unit_id}
    var shiftMap = null;
    if (item.dates_shifts_map) {
      try {
        shiftMap = (typeof item.dates_shifts_map === 'string')
          ? JSON.parse(item.dates_shifts_map)
          : item.dates_shifts_map;
      } catch (e) {
        Logger.log('dates_shifts_map JSONパース失敗 (' + item.fixed_id + '): ' + e);
        shiftMap = null;
      }
    }
    
    // configMapから shift/facility/unit_id を取り出すヘルパー
    function _getConfig(key, defaultShift, defaultUnitId) {
      if (!shiftMap || !shiftMap[key]) return null;
      const v = shiftMap[key];
      if (typeof v === 'string') {
        // 旧形式: 値がシフト種別の文字列
        return { shift: v, unit_id: defaultUnitId, facility_override: null };
      } else if (typeof v === 'object' && v.shift) {
        // 新形式 (Phase 7.5.4): {shift, facility, unit_id}
        return {
          shift: v.shift,
          unit_id: v.unit_id || defaultUnitId,
          facility_override: v.facility || null
        };
      }
      return null;
    }
    
    // 日付指定の場合: target_ym 一致のみ
    if (item.type === FIXED_ASSIGN_TYPE.DATE) {
      if (item.target_ym !== targetYM) return;
      const dates = String(item.dates_or_weekdays).split(',').map(function(d){return parseInt(d.trim(), 10);}).filter(function(d){return d > 0 && d <= daysInMonth;});
      dates.forEach(function(d) {
        const dateKey = targetYM + '-' + String(d).padStart(2, '0');
        const cfg = _getConfig(String(d), item.shift_type, item.unit_id);
        const dayShift = cfg ? cfg.shift : item.shift_type;
        if (!dayShift) return;
        // facility override があればそれ、無ければ item.unit_id の施設
        let unit = null;
        if (cfg && cfg.facility_override) {
          // facility名から最初のユニットを探す
          for (var ukey in unitMap) {
            if (unitMap[ukey].facility === cfg.facility_override) {
              if (cfg.unit_id && unitMap[ukey].unit_id === cfg.unit_id) { unit = unitMap[ukey]; break; }
              if (!unit) unit = unitMap[ukey];
            }
          }
        } else {
          unit = unitMap[cfg && cfg.unit_id ? cfg.unit_id : item.unit_id];
        }
        if (!unit) return;
        expanded.push({
          fixed_id: item.fixed_id,
          staff_id: item.staff_id,
          staff_name: staffNameMap[item.staff_id] || '',
          dateKey: dateKey,
          shift: dayShift,
          unit_id: unit.unit_id,
          jigyosho: unit.jigyosho,
          facility: unit.facility,
          unit_name: unit.unit_name
        });
      });
    }
    // 曜日指定の場合: 対象月の全日を走査して曜日マッチ
    else if (item.type === FIXED_ASSIGN_TYPE.WEEKDAY) {
      const weekdays = String(item.dates_or_weekdays).split(',').map(function(w){return w.trim();}).filter(Boolean);
      const weekdayNums = weekdays.map(function(w){return WEEKDAY_MAP[w];}).filter(function(n){return n !== undefined;});
      
      for (var d = 1; d <= daysInMonth; d++) {
        const date = new Date(year, month - 1, d);
        const dayOfWeek = date.getDay();
        if (weekdayNums.indexOf(dayOfWeek) === -1) continue;
        const dateKey = targetYM + '-' + String(d).padStart(2, '0');
        const weekdayName = ['日','月','火','水','木','金','土'][dayOfWeek];
        const cfg = _getConfig(weekdayName, item.shift_type, item.unit_id);
        const dayShift = cfg ? cfg.shift : item.shift_type;
        if (!dayShift) continue;
        let unit = null;
        if (cfg && cfg.facility_override) {
          for (var ukey in unitMap) {
            if (unitMap[ukey].facility === cfg.facility_override) {
              if (cfg.unit_id && unitMap[ukey].unit_id === cfg.unit_id) { unit = unitMap[ukey]; break; }
              if (!unit) unit = unitMap[ukey];
            }
          }
        } else {
          unit = unitMap[cfg && cfg.unit_id ? cfg.unit_id : item.unit_id];
        }
        if (!unit) continue;
        expanded.push({
          fixed_id: item.fixed_id,
          staff_id: item.staff_id,
          staff_name: staffNameMap[item.staff_id] || '',
          dateKey: dateKey,
          shift: dayShift,
          unit_id: unit.unit_id,
          jigyosho: unit.jigyosho,
          facility: unit.facility,
          unit_name: unit.unit_name
        });
      }
    }
  });
  
  return expanded;
}

// ============================================================
// 固定配置 → T_シフト確定 に先取り書込
// 既存の固定配置レコ (shift_id が FIXED_* で始まる) を削除してから新規書込
// 通常のエンジン実行前に呼ぶ
// ============================================================
function preplaceFixedAssignments(targetYM) {
  // ★Day13: assignedRole 計算用にスタッフシート参照
  var staffSheet = SpreadsheetApp.openById(STAFF_SS_ID).getSheetByName('M_スタッフ');

  Logger.log('=== 固定配置 先取り書込 開始: ' + targetYM + ' ===');
  
  const expanded = expandFixedAssignments(targetYM);
  Logger.log('展開された固定配置: ' + expanded.length + '件');
  
  if (expanded.length === 0) {
    return { success: true, placedCount: 0, message: '対象月に固定配置なし' };
  }
  
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('T_シフト確定');
  
  // Step 1: 既存の固定配置レコ削除 (shift_id が FIXED_ で始まる)
  const data = sheet.getDataRange().getValues();
  const rowsToDelete = [];
  for (var i = 1; i < data.length; i++) {
    const shiftId = String(data[i][0] || '');
    if (shiftId.indexOf('FIXED_') === 0) {
      // 対象月の固定配置のみ削除
      const d = data[i][1];
      if (d instanceof Date) {
        const ymStr = Utilities.formatDate(d, 'JST', 'yyyy-MM');
        if (ymStr === targetYM) {
          rowsToDelete.push(i + 1);  // 行番号(1-indexed)
        }
      }
    }
  }
  // 後ろから削除 (インデックスズレ防止)
  rowsToDelete.reverse().forEach(function(rowNum) {
    sheet.deleteRow(rowNum);
  });
  Logger.log('既存固定配置削除: ' + rowsToDelete.length + '件');
  
  // Step 2: 新規固定配置レコを書込
  const shiftInfo = {
    '夜勤A': { start: '20:00', end: '05:00', nightH: 6, dayH: 2 },
    '夜勤B': { start: '22:00', end: '07:00', nightH: 6, dayH: 2 },
    '夜勤C': { start: '22:00', end: '08:00', nightH: 6, dayH: 2 },
    '早出8h': { start: '07:00', end: '16:00', nightH: 0, dayH: 8 },
    '早出4h': { start: '07:00', end: '11:00', nightH: 0, dayH: 4 },
    '遅出8h': { start: '13:00', end: '22:00', nightH: 0, dayH: 8 },
    '遅出4h': { start: '13:00', end: '17:00', nightH: 0, dayH: 4 }
  };
  
  const now = new Date();
  const newRows = [];
  
  expanded.forEach(function(item, idx) {
    const si = shiftInfo[item.shift] || { start: '', end: '', nightH: 0, dayH: 8 };
    const d = new Date(item.dateKey + 'T00:00:00');
    
    // 19列構造 (T_シフト確定):
    // [shift_id, 日付, unit_id, 事業所名, 施設名, ユニット名,
    //  staff_id, 氏名, シフト種別, 開始時刻, 終了時刻, 配置カウント,
    //  ステータス, 更新日時, 実開始時刻, 実終了時刻, 夜勤換算時間, 日勤換算時間, 割当役割]
    const shiftId = 'FIXED_' + item.fixed_id + '_' + item.dateKey;
    newRows.push([
      shiftId,                    // [0] shift_id
      d,                          // [1] 日付
      item.unit_id,               // [2] unit_id
      item.jigyosho,              // [3] 事業所名
      item.facility,              // [4] 施設名
      item.unit_name,             // [5] ユニット名
      item.staff_id,              // [6] staff_id
      item.staff_name,            // [7] 氏名
      item.shift,                 // [8] シフト種別
      si.start,                   // [9] 開始時刻
      si.end,                     // [10] 終了時刻
      1,                          // [11] 配置カウント
      '確定',                     // [12] ステータス (固定配置は最初から確定)
      now,                        // [13] 更新日時
      si.start,                   // [14] 実開始時刻
      si.end,                     // [15] 実終了時刻
      si.nightH,                  // [16] 夜勤換算時間
      si.dayH,                    // [17] 日勤換算時間
      _calcFixedAssignedRole(item.staff_id, staffSheet)  // [18] 割当役割 ★Day13 fix
    ]);
  });
  
  if (newRows.length > 0) {
    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, newRows.length, 19).setValues(newRows);
    // フォーマット
    sheet.getRange(startRow, 2, newRows.length, 1).setNumberFormat('yyyy-MM-dd');
    sheet.getRange(startRow, 14, newRows.length, 1).setNumberFormat('yyyy-MM-dd HH:mm:ss');
  }
  
  Logger.log('新規固定配置書込: ' + newRows.length + '件');
  Logger.log('=== 固定配置 先取り書込 完了 ===');
  
  return {
    success: true,
    placedCount: newRows.length,
    deletedCount: rowsToDelete.length
  };
}

// ============================================================
// テスト関数: 固定配置の展開 + 先取り書込
// ============================================================
function testPreplaceFixedAssignments() {
  const targetYM = '2026-06';
  
  Logger.log('=== 固定配置展開テスト: ' + targetYM + ' ===');
  
  // Step 1: 展開
  const expanded = expandFixedAssignments(targetYM);
  Logger.log('展開結果: ' + expanded.length + '件');
  expanded.slice(0, 10).forEach(function(item) {
    Logger.log('  ' + item.dateKey + ' / sid=' + item.staff_id + ' (' + item.staff_name + ') / ' + item.shift + ' @ ' + item.unit_id);
  });
  if (expanded.length > 10) Logger.log('  ... (残り ' + (expanded.length - 10) + '件)');
  
  // Step 2: 先取り書込
  const r = preplaceFixedAssignments(targetYM);
  Logger.log('書込結果: ' + JSON.stringify(r));
}


// ============================================================
// テスト用ラッパー: 2026-06 の固定配置を T_シフト確定 に先取り書込
// ============================================================
function debug_preplace_2026_06() {
  const r = preplaceFixedAssignments('2026-06');
  Logger.log('結果: ' + JSON.stringify(r));
}

// ============================================================
// テスト用ラッパー: 固定配置の動作確認 (削除→展開→書込→確認)
// ============================================================
function debug_test_fixed_assignment_full() {
  Logger.log('=== 固定配置 統合テスト ===');
  
  // Step 1: 既存固定配置を削除して再書込
  const r = preplaceFixedAssignments('2026-06');
  Logger.log('preplaceFixedAssignments: ' + JSON.stringify(r));
  
  // Step 2: T_シフト確定 で FIXED_* レコを数える
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('T_シフト確定');
  const data = sheet.getDataRange().getValues();
  
  let fixedCount = 0;
  let fixedByStaff = {};
  for (var i = 1; i < data.length; i++) {
    const shiftId = String(data[i][0] || '');
    if (shiftId.indexOf('FIXED_') === 0) {
      fixedCount++;
      const sid = String(data[i][6]);
      fixedByStaff[sid] = (fixedByStaff[sid] || 0) + 1;
    }
  }
  Logger.log('T_シフト確定 内の固定配置: ' + fixedCount + '件');
  Object.keys(fixedByStaff).forEach(function(sid) {
    Logger.log('  sid=' + sid + ': ' + fixedByStaff[sid] + '件');
  });
}


// 動作確認用クイックテスト
function quick_test_phase7_admin() {
  try {
    const r = getFixedAssignmentsForAdmin('13', {});
    Logger.log('OK: ' + JSON.stringify(r).substring(0, 500));
  } catch (e) {
    Logger.log('❌ エラー: ' + e + ' / line: ' + (e.lineNumber || '?') + ' / stack: ' + (e.stack || ''));
  }
}


// デバッグ: 返値の全フィールドの型を出力
function debug_check_response_types() {
  const r = getFixedAssignmentsForAdmin('13', {});
  if (!r.success || !r.items || r.items.length === 0) {
    Logger.log('No items');
    return;
  }
  const item = r.items[0];
  Logger.log('=== item[0] フィールド型 ===');
  Object.keys(item).forEach(function(k) {
    const v = item[k];
    const t = v === null ? 'null' : (v instanceof Date ? 'Date' : typeof v);
    Logger.log(k + ' = ' + t + ' / value: ' + (v instanceof Date ? v.toISOString() : JSON.stringify(v)).substring(0, 100));
  });
}


// ============================================================
// ★Day13: 固定配置の assignedRole を計算 (シート書込時)
// 水野さん仕様 (Day12確定):
//   サビ管持ち → サビ管
//   世話人だけ持ち → 世話人
//   生活支援員だけ持ち → 生活支援員
//   両方持ち → 世話人 (書込時点では世話人不足扱い)
// ============================================================
function _calcFixedAssignedRole(staffId, staffSheet) {
  if (!staffSheet) {
    const ss = SpreadsheetApp.openById(STAFF_SS_ID);
    staffSheet = ss.getSheetByName('M_スタッフ');
  }
  const data = staffSheet.getDataRange().getValues();
  let mainRoles = '';
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(staffId)) {
      mainRoles = String(data[i][19] || '').trim();
      break;
    }
  }
  if (!mainRoles) return '';
  
  const roles = mainRoles.split(',').map(function(s){return s.trim();});
  const isSabikan = roles.indexOf('サビ管') !== -1;
  const isSewa = roles.indexOf('世話人') !== -1;
  const isSeikatsu = roles.indexOf('生活支援員') !== -1;
  
  if (isSabikan) return 'サビ管';
  if (isSewa && !isSeikatsu) return '世話人';
  if (!isSewa && isSeikatsu) return '生活支援員';
  if (isSewa && isSeikatsu) return '世話人';  // 両方持ちは世話人(書込時点では不足扱い)
  return '';
}


// ★Day15 P1-P4 テスト: 固定配置のH違反検証
function debug_test_validateFixedAssignmentH() {
  // テストケース1: 水野惠子(ID:2) に 月曜遅出8h を仮想登録 → 既存配置と H1/H7 違反するはず
  Logger.log('=== テスト1: 水野惠子 月曜遅出8h固定 (2026-06) ===');
  const params1 = {
    staff_id: '2',
    type: '曜日指定',
    target_ym: '2026-06',
    dates_or_weekdays: '月',
    shift_type: '遅出8h',
    unit_id: '',
  };
  try {
    const violations1 = _validateFixedAssignmentH(params1, '2026-06');
    Logger.log('違反数: ' + violations1.length);
    violations1.slice(0, 10).forEach(function(v) {
      Logger.log('  [' + v.ruleId + '] ' + v.date + ': ' + v.message);
    });
  } catch (e) {
    Logger.log('エラー: ' + e.message);
  }
  
  // テストケース2: 阿部佳小里(ID:383) に リフレ要町の早出8h固定 → H10違反するはず
  Logger.log('=== テスト2: 阿部佳小里 リフレ要町 早出8h固定 (2026-06) ===');
  const params2 = {
    staff_id: '383',
    type: '日付指定',
    target_ym: '2026-06',
    dates_or_weekdays: '1,5,10',
    shift_type: '早出8h',
    unit_id: '',  // unit_id なしでスタッフメイン施設使用
  };
  try {
    const violations2 = _validateFixedAssignmentH(params2, '2026-06');
    Logger.log('違反数: ' + violations2.length);
    violations2.slice(0, 10).forEach(function(v) {
      Logger.log('  [' + v.ruleId + '] ' + v.date + ': ' + v.message);
    });
  } catch (e) {
    Logger.log('エラー: ' + e.message);
  }
  
  // テストケース3: 違反しないはずのパターン (水野惠子の遅出8hを月単位で既存と被らない日に)
  Logger.log('=== テスト3: 水野惠子 6/15日付固定 (既存と被らない) ===');
  const params3 = {
    staff_id: '2',
    type: '日付指定',
    target_ym: '2026-06',
    dates_or_weekdays: '15',  // 1日だけ
    shift_type: '遅出8h',
    unit_id: '',
  };
  try {
    const violations3 = _validateFixedAssignmentH(params3, '2026-06');
    Logger.log('違反数: ' + violations3.length);
    violations3.slice(0, 5).forEach(function(v) {
      Logger.log('  [' + v.ruleId + '] ' + v.date + ': ' + v.message);
    });
  } catch (e) {
    Logger.log('エラー: ' + e.message);
  }
}


// ★Day15 P1-P4 デバッグ: 高橋竜太(ID:12) 全曜日 早出8h リフレ要町 で違反検証
function debug_test_takahashi_ryuta_validation() {
  const params = {
    staff_id: '12',
    type: '曜日指定',
    target_ym: '',  // 空のまま (実際の登録と同じ条件)
    dates_or_weekdays: '日,月,火,水,木,金,土',
    shift_type: '早出8h',
    unit_id: '',  // 実際の登録に合わせる
  };
  
  Logger.log('=== params ===');
  Logger.log(JSON.stringify(params));
  
  // target_ym 計算ロジック (addFixedAssignmentと同じ)
  let _checkYM = params.target_ym;
  if (!_checkYM) {
    const _now = new Date();
    _now.setMonth(_now.getMonth() + 1);
    _checkYM = _now.getFullYear() + '-' + String(_now.getMonth() + 1).padStart(2, '0');
  }
  Logger.log('check月: ' + _checkYM);
  
  try {
    const violations = _validateFixedAssignmentH(params, _checkYM);
    Logger.log('違反数: ' + violations.length);
    violations.slice(0, 10).forEach(function(v) {
      Logger.log('  [' + v.ruleId + '] ' + v.date + ': ' + v.message);
    });
  } catch (e) {
    Logger.log('★エラー: ' + e.message);
    Logger.log('stack: ' + e.stack);
  }
}
