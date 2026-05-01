// ============================================================
// 日勤自動配置エンジン v2
// 仕様書: https://app.notion.com/p/353ec81ceecf81379cd2e6b3ffc2307d
//
// v1との違い:
// - 共通インフラ (warning_system + common_constraints) を全面活用
// - H1〜H9 ハード除外 (大半は common_constraints の関数で対応)
// - W2 警告 (block) + N2 警告 (only)
// - 管理者の時間二重計上ロジック
// - 必要時間の動的計算 (月の日数 × 40 ÷ 7)
// - 主職種マッチの動的加点 (不足職種優先)
// ============================================================

const DSE_V2 = {
  // M_スタッフ列 (夜勤と共通、20列)
  COL_STAFF_ID: 0,
  COL_STAFF_NAME: 1,
  COL_STAFF_EMAIL: 2,
  COL_STAFF_EMPLOYMENT: 4,
  COL_STAFF_QUALIFICATION: 5,
  COL_STAFF_HIRE_MONTHS: 7,
  COL_STAFF_KUBUN: 8,
  COL_STAFF_MAIN: 9,
  COL_STAFF_SECOND: 10,
  COL_STAFF_SUB: 11,
  COL_STAFF_SHIFT_KUBUN: 12,
  COL_STAFF_ALLOWED: 13,
  COL_STAFF_PROTECTED: 14,
  COL_STAFF_VIP: 15,
  COL_STAFF_RETIRED: 16,
  COL_STAFF_NOTE: 17,
  COL_STAFF_ROLE: 18,
  COL_STAFF_MAIN_ROLES: 19,  // T列: 主職種
  
  // M_ユニット列
  COL_UNIT_ID: 0,
  COL_UNIT_JIGYOSHO: 1,
  COL_UNIT_NAME: 2,
  COL_UNIT_FACILITY: 3,
  COL_UNIT_CAPACITY: 4,
  COL_UNIT_ROOM: 5,
  
  // M_事業所配置基準 (8列構造、確定版)
  // A:事業所名 B:定員 C:世話人 D:生活支援員 E:特定加配 F:サビ管 G:看護師 H:管理者氏名
  COL_BASIS_JIGYOSHO: 0,
  COL_BASIS_CAPACITY: 1,
  COL_BASIS_SEWA: 2,
  COL_BASIS_SEIKATSU: 3,
  COL_BASIS_TOKUTEI: 4,
  COL_BASIS_SABIKAN: 5,
  COL_BASIS_NURSE: 6,
  COL_BASIS_KANRISHA: 7,
  
  // T_希望提出列
  COL_REQ_ID: 0,
  COL_REQ_SUBMITTED: 1,
  COL_REQ_STAFF_ID: 2,
  COL_REQ_NAME: 3,
  COL_REQ_YM: 4,
  COL_REQ_DATE: 5,
  COL_REQ_SHIFT: 6,
  COL_REQ_MAIN: 7,
  COL_REQ_SECOND: 8,
  COL_REQ_SUB: 9,
  COL_REQ_COMMENT: 10,
  
  // T_シフト確定列 (18列構造)
  COL_CONF_REQUEST_ID: 0,
  COL_CONF_DATE: 1,
  COL_CONF_YM: 2,
  COL_CONF_JIGYOSHO: 3,
  COL_CONF_FACILITY: 4,
  COL_CONF_UNIT: 5,
  COL_CONF_STAFF_ID: 6,
  COL_CONF_STAFF_NAME: 7,
  COL_CONF_SHIFT: 8,
  COL_CONF_STATUS: 12,
  
  // シフト分類
  DAY_SHIFTS: ['早出8h', '早出4h', '遅出8h', '遅出4h'],
  NIGHT_SHIFTS: ['夜勤A', '夜勤B', '夜勤C'],
  ALL_SHIFTS: ['夜勤A', '夜勤B', '夜勤C', '早出8h', '早出4h', '遅出8h', '遅出4h'],
  
  // スコア係数 (夜勤と共通 + 主職種マッチ用係数)
  SCORE: {
    MAIN_FAC: 30, SECOND_FAC: 20, SUB_FAC: 10,
    QUALIFIED: 10, FULL_TIME: 5,
    MONTH_X: 2, SKILL_X: 3,
    PROTECTED_ZERO: 50, PROTECTED_OTHER: 15,
    NEWBIE1: -30, NEWBIE2: -10,
    CONCENTRATION_X: -5, VIP: 10000,
    ROLE_SHORT_SABIKAN: 20,  // サビ管不足時の加点
    ROLE_SHORT_NURSE: 15,    // 看護師不足時の加点
    ROLE_SHORT_SEWA: 15,     // 世話人不足時の加点
  },
  
  // エンジン挙動
  HISTORY_MONTHS: 3,
  MAX_CONSECUTIVE: 6,
  WEEKLY_HOUR_LIMIT: 40,
  
  // シート名
  SHEET_NAME_STAFF: 'M_スタッフ',
  SHEET_NAME_UNIT: 'M_ユニット',
  SHEET_NAME_BASIS: 'M_事業所配置基準',
  SHEET_NAME_REQ: 'T_希望提出',
  SHEET_NAME_CONF: 'T_シフト確定',
};

// ============================================================
// 内部ヘルパー: yyyy-MM 正規化
// ============================================================
function _v2d_normYm(val) {
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    return y + '-' + m;
  }
  return String(val || '').trim();
}

// ============================================================
// 内部ヘルパー: yyyy-MM-dd 正規化
// ============================================================
function _v2d_normDate(val) {
  if (val instanceof Date) {
    return Utilities.formatDate(val, 'Asia/Tokyo', 'yyyy-MM-dd');
  }
  return String(val || '').trim();
}

// ============================================================
// loadEngineContextV2: ctx 構築 (日勤v2)
// ============================================================
function loadEngineContextV2(targetYM) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const parts = targetYM.split('-').map(Number);
  const year = parts[0];
  const month = parts[1];
  const daysInMonth = new Date(year, month, 0).getDate();
  
  // 1人あたり月必要h = 月の日数 × 40 ÷ 7
  const hoursPerPerson = daysInMonth * 40 / 7;
  
  const ctx = {
    targetYM: targetYM,
    year: year,
    month: month,
    daysInMonth: daysInMonth,
    hoursPerPerson: hoursPerPerson,
    units: [],
    unitsByFacility: {},
    facilityToJigyosho: {},
    staffMap: {},
    facilityBasis: {},  // {jigyosho: {capacity, sewa, seikatsu, tokutei, sabikan, nurse, kanrisha, needSewaH, needSeikatsuH, needTokuteiH, needSabikanH, needKanrishaH, nurseRequired}}
    wishes: [],
    wishesByStaff: {},
    wishesByStaffDay: {},
    wishesByDayShift: {},
    history3m: {},
    historyCount: 0,
    monthlyAssign: {},
    staffAssignedDates: {},  // {staffId: {dateKey: [{shift, jigyosho, facility, unit, workHours, role}]}}
    slots: [],
    slotsByKey: {},
  };
  
  // 1. M_ユニット
  const unitSheet = ss.getSheetByName(DSE_V2.SHEET_NAME_UNIT);
  if (!unitSheet) throw new Error('M_ユニットシートが見つからない');
  const unitData = unitSheet.getDataRange().getValues();
  for (let i = 1; i < unitData.length; i++) {
    if (!unitData[i][DSE_V2.COL_UNIT_ID]) continue;
    const unit = {
      unit_id: unitData[i][DSE_V2.COL_UNIT_ID],
      jigyosho: String(unitData[i][DSE_V2.COL_UNIT_JIGYOSHO] || '').trim(),
      unit_name: String(unitData[i][DSE_V2.COL_UNIT_NAME] || '').trim(),
      facility: String(unitData[i][DSE_V2.COL_UNIT_FACILITY] || '').trim(),
      capacity: Number(unitData[i][DSE_V2.COL_UNIT_CAPACITY]) || 0,
      room: String(unitData[i][DSE_V2.COL_UNIT_ROOM] || '').trim(),
    };
    ctx.units.push(unit);
    if (!ctx.unitsByFacility[unit.facility]) ctx.unitsByFacility[unit.facility] = [];
    ctx.unitsByFacility[unit.facility].push(unit);
    ctx.facilityToJigyosho[unit.facility] = unit.jigyosho;
  }
  
  // 2. M_スタッフ
  const staffSheet = ss.getSheetByName(DSE_V2.SHEET_NAME_STAFF);
  if (!staffSheet) throw new Error('M_スタッフシートが見つからない');
  const staffData = staffSheet.getRange(2, 1, staffSheet.getLastRow() - 1, 20).getValues();
  staffData.forEach(function(row) {
    if (!row[DSE_V2.COL_STAFF_ID]) return;
    if (String(row[DSE_V2.COL_STAFF_RETIRED]).toUpperCase() === 'TRUE') return;
    
    const staffId = String(row[DSE_V2.COL_STAFF_ID]).trim();
    const allowedRaw = String(row[DSE_V2.COL_STAFF_ALLOWED] || '');
    const subRaw = String(row[DSE_V2.COL_STAFF_SUB] || '');
    const mainRolesRaw = String(row[DSE_V2.COL_STAFF_MAIN_ROLES] || '');
    const kubun = String(row[DSE_V2.COL_STAFF_KUBUN] || '').trim();
    
    ctx.staffMap[staffId] = {
      staff_id: staffId,
      name: row[DSE_V2.COL_STAFF_NAME],
      employment: String(row[DSE_V2.COL_STAFF_EMPLOYMENT] || '').trim(),
      qualification: String(row[DSE_V2.COL_STAFF_QUALIFICATION] || '').trim(),
      hireMonths: Number(row[DSE_V2.COL_STAFF_HIRE_MONTHS]) || 0,
      kubun: kubun,
      mainFac: String(row[DSE_V2.COL_STAFF_MAIN] || '').trim(),
      secondFac: String(row[DSE_V2.COL_STAFF_SECOND] || '').trim(),
      subFacs: subRaw ? subRaw.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [],
      shiftKubun: String(row[DSE_V2.COL_STAFF_SHIFT_KUBUN] || '').trim(),
      allowedShifts: allowedRaw ? allowedRaw.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [],
      isProtected: String(row[DSE_V2.COL_STAFF_PROTECTED]).toUpperCase() === 'TRUE',
      isVIP: String(row[DSE_V2.COL_STAFF_VIP]).toUpperCase() === 'TRUE',
      isNewbie1: kubun === '新人1ヶ月',
      isNewbie2: kubun === '新人2ヶ月',
      mainRoles: mainRolesRaw ? mainRolesRaw.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [],
      isNurse: String(row[DSE_V2.COL_STAFF_QUALIFICATION] || '').indexOf('看護師') !== -1,
      isKanrisha: mainRolesRaw.indexOf('管理者') !== -1,
      isSabikan: mainRolesRaw.indexOf('サビ管') !== -1,
      isSewa: mainRolesRaw.indexOf('世話人') !== -1,
      isSeikatsu: mainRolesRaw.indexOf('生活支援員') !== -1,
    };
    ctx.monthlyAssign[staffId] = 0;
    ctx.staffAssignedDates[staffId] = {};
  });
  
  // 3. M_事業所配置基準 (5事業所、8列構造)
  const basisSheet = ss.getSheetByName(DSE_V2.SHEET_NAME_BASIS);
  if (!basisSheet) throw new Error('M_事業所配置基準シートが見つからない');
  const basisData = basisSheet.getDataRange().getValues();
  for (let i = 1; i < basisData.length; i++) {
    const row = basisData[i];
    const jigyosho = String(row[DSE_V2.COL_BASIS_JIGYOSHO] || '').trim();
    if (!jigyosho) continue;
    
    const sewa = Number(row[DSE_V2.COL_BASIS_SEWA]) || 0;
    const seikatsu = Number(row[DSE_V2.COL_BASIS_SEIKATSU]) || 0;
    const tokutei = Number(row[DSE_V2.COL_BASIS_TOKUTEI]) || 0;
    const sabikan = Number(row[DSE_V2.COL_BASIS_SABIKAN]) || 0;
    const nurse = Number(row[DSE_V2.COL_BASIS_NURSE]) || 0;
    
    ctx.facilityBasis[jigyosho] = {
      jigyosho: jigyosho,
      capacity: Number(row[DSE_V2.COL_BASIS_CAPACITY]) || 0,
      sewa: sewa,
      seikatsu: seikatsu,
      tokutei: tokutei,
      sabikan: sabikan,
      nurseCount: nurse,  // 必要看護師人数
      kanrisha: String(row[DSE_V2.COL_BASIS_KANRISHA] || '').trim(),
      // 動的計算した必要時間
      needSewaH: sewa * hoursPerPerson,
      needSeikatsuH: seikatsu * hoursPerPerson,
      needTokuteiH: tokutei * hoursPerPerson,  // 世話人h+生活支援員h で充足
      needSabikanH: sabikan * hoursPerPerson,
      needKanrishaH: 1 * hoursPerPerson,  // 管理者は常勤1人固定
      nurseRequired: nurse,  // 人数判定 (ユニーク看護師数)
    };
  }
  
  // 4. T_希望提出 (対象月のみ、全シフトタイプ取り込み)
  const reqSheet = ss.getSheetByName(DSE_V2.SHEET_NAME_REQ);
  if (reqSheet && reqSheet.getLastRow() > 1) {
    const reqData = reqSheet.getDataRange().getValues();
    for (let i = 1; i < reqData.length; i++) {
      const row = reqData[i];
      if (!row[DSE_V2.COL_REQ_ID]) continue;
      
      const ym = _v2d_normYm(row[DSE_V2.COL_REQ_YM]);
      if (ym !== targetYM) continue;
      
      const staffId = String(row[DSE_V2.COL_REQ_STAFF_ID]).trim();
      if (!ctx.staffMap[staffId]) continue;
      
      const date = row[DSE_V2.COL_REQ_DATE];
      if (!(date instanceof Date)) continue;
      const dateKey = _v2d_normDate(date);
      
      const shift = String(row[DSE_V2.COL_REQ_SHIFT] || '').trim();
      if (DSE_V2.ALL_SHIFTS.indexOf(shift) === -1) continue;
      
      const subRaw = String(row[DSE_V2.COL_REQ_SUB] || '');
      const wish = {
        requestId: row[DSE_V2.COL_REQ_ID],
        staff_id: staffId,
        name: row[DSE_V2.COL_REQ_NAME],
        date: date,
        dateKey: dateKey,
        shift: shift,
        isNight: DSE_V2.NIGHT_SHIFTS.indexOf(shift) !== -1,
        isDay: DSE_V2.DAY_SHIFTS.indexOf(shift) !== -1,
        mainFac: String(row[DSE_V2.COL_REQ_MAIN] || '').trim(),
        secondFac: String(row[DSE_V2.COL_REQ_SECOND] || '').trim(),
        subFacs: subRaw ? subRaw.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [],
        comment: row[DSE_V2.COL_REQ_COMMENT] || '',
      };
      
      ctx.wishes.push(wish);
      if (!ctx.wishesByStaff[staffId]) ctx.wishesByStaff[staffId] = [];
      ctx.wishesByStaff[staffId].push(wish);
      const sdKey = staffId + '_' + dateKey;
      if (!ctx.wishesByStaffDay[sdKey]) ctx.wishesByStaffDay[sdKey] = [];
      ctx.wishesByStaffDay[sdKey].push(wish);
      const dsKey = dateKey + '_' + shift;
      if (!ctx.wishesByDayShift[dsKey]) ctx.wishesByDayShift[dsKey] = [];
      ctx.wishesByDayShift[dsKey].push(wish);
    }
  }
  
  // 5. T_シフト確定 (過去3ヶ月履歴 + 対象月既存配置 - 夜勤含む)
  const confSheet = ss.getSheetByName(DSE_V2.SHEET_NAME_CONF);
  if (confSheet && confSheet.getLastRow() > 1) {
    const now = new Date();
    const historyStart = new Date(now.getFullYear(), now.getMonth() - DSE_V2.HISTORY_MONTHS, 1);
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 1);
    
    const confData = confSheet.getDataRange().getValues();
    for (let i = 1; i < confData.length; i++) {
      const row = confData[i];
      const date = row[DSE_V2.COL_CONF_DATE];
      if (!(date instanceof Date)) continue;
      
      const staffId = String(row[DSE_V2.COL_CONF_STAFF_ID] || '').trim();
      const facility = String(row[DSE_V2.COL_CONF_FACILITY] || '').trim();
      const jigyosho = String(row[DSE_V2.COL_CONF_JIGYOSHO] || '').trim();
      const unit = String(row[DSE_V2.COL_CONF_UNIT] || '').trim();
      const shift = String(row[DSE_V2.COL_CONF_SHIFT] || '').trim();
      if (!staffId || !facility) continue;
      
      // 5a. 過去3ヶ月: 施設熟練度
      if (date >= historyStart && date < monthStart) {
        if (!ctx.history3m[staffId]) ctx.history3m[staffId] = {};
        ctx.history3m[staffId][facility] = (ctx.history3m[staffId][facility] || 0) + 1;
        ctx.historyCount++;
      }
      
      // 5b. 対象月既存配置 (夜勤含む全部) → staffAssignedDates
      if (date >= monthStart && date < monthEnd) {
        if (!ctx.staffMap[staffId]) continue;
        const dateKey = _v2d_normDate(date);
        if (!ctx.staffAssignedDates[staffId][dateKey]) {
          ctx.staffAssignedDates[staffId][dateKey] = [];
        }
        let workHours = 0;
        if (typeof SHIFT_PATTERNS !== 'undefined' && SHIFT_PATTERNS[shift]) {
          workHours = SHIFT_PATTERNS[shift].dayHours + SHIFT_PATTERNS[shift].nightHours;
        }
        ctx.staffAssignedDates[staffId][dateKey].push({
          shift: shift,
          jigyosho: jigyosho,
          facility: facility,
          unit: unit,
          workHours: workHours,
          isNight: DSE_V2.NIGHT_SHIFTS.indexOf(shift) !== -1,
          isDay: DSE_V2.DAY_SHIFTS.indexOf(shift) !== -1,
        });
        ctx.monthlyAssign[staffId] = (ctx.monthlyAssign[staffId] || 0) + 1;
      }
    }
  }
  
  return ctx;
}

// ============================================================
// テスト関数: ctx 構築の動作確認
// ============================================================
function testLoadContextV2() {
  Logger.log('=== loadEngineContextV2 動作確認 ===');
  const ym = '2026-05';
  const startTs = Date.now();
  const ctx = loadEngineContextV2(ym);
  const elapsed = ((Date.now() - startTs) / 1000).toFixed(2);
  
  Logger.log('対象月: ' + ctx.targetYM + ' (' + ctx.daysInMonth + '日)');
  Logger.log('1人あたり月必要h: ' + ctx.hoursPerPerson.toFixed(2));
  Logger.log('処理時間: ' + elapsed + '秒');
  Logger.log('');
  
  Logger.log('--- マスタ ---');
  Logger.log('ユニット数: ' + ctx.units.length);
  Logger.log('スタッフ数: ' + Object.keys(ctx.staffMap).length);
  Logger.log('事業所配置基準: ' + Object.keys(ctx.facilityBasis).length + '事業所');
  
  Logger.log('');
  Logger.log('--- 事業所配置基準 詳細 ---');
  Object.keys(ctx.facilityBasis).forEach(function(jig) {
    const b = ctx.facilityBasis[jig];
    Logger.log(jig + ':');
    Logger.log('  定員=' + b.capacity + ' / 管理者=' + b.kanrisha);
    Logger.log('  必要h: 世話人=' + b.needSewaH.toFixed(2) + ' / 生活支援員=' + b.needSeikatsuH.toFixed(2) + ' / 特定=' + b.needTokuteiH.toFixed(2) + ' / サビ管=' + b.needSabikanH.toFixed(2) + ' / 管理者=' + b.needKanrishaH.toFixed(2));
    Logger.log('  必要看護師: ' + b.nurseRequired + '人');
  });
  
  Logger.log('');
  Logger.log('--- データ ---');
  Logger.log('希望提出数: ' + ctx.wishes.length);
  Logger.log('  夜勤: ' + ctx.wishes.filter(function(w) { return w.isNight; }).length);
  Logger.log('  日勤: ' + ctx.wishes.filter(function(w) { return w.isDay; }).length);
  Logger.log('過去3ヶ月履歴件数: ' + ctx.historyCount);
  
  // 既存対象月配置
  let assignedStaffCount = 0;
  let totalAssigns = 0;
  let nightAssigns = 0;
  let dayAssigns = 0;
  Object.keys(ctx.staffAssignedDates).forEach(function(sid) {
    const dates = Object.keys(ctx.staffAssignedDates[sid]);
    if (dates.length > 0) {
      assignedStaffCount++;
      dates.forEach(function(d) {
        ctx.staffAssignedDates[sid][d].forEach(function(a) {
          totalAssigns++;
          if (a.isNight) nightAssigns++;
          if (a.isDay) dayAssigns++;
        });
      });
    }
  });
  Logger.log('対象月既存配置: ' + totalAssigns + '件 (夜勤=' + nightAssigns + ', 日勤=' + dayAssigns + ', スタッフ ' + assignedStaffCount + '名)');
  
  // サンプル: 主職種別カウント
  Logger.log('');
  Logger.log('--- スタッフ役割分布 ---');
  let kanCount = 0, sabiCount = 0, sewaCount = 0, seikatsuCount = 0, nurseCount = 0;
  Object.values(ctx.staffMap).forEach(function(s) {
    if (s.isKanrisha) kanCount++;
    if (s.isSabikan) sabiCount++;
    if (s.isSewa) sewaCount++;
    if (s.isSeikatsu) seikatsuCount++;
    if (s.isNurse) nurseCount++;
  });
  Logger.log('管理者: ' + kanCount + ' / サビ管: ' + sabiCount + ' / 世話人: ' + sewaCount + ' / 生活支援員: ' + seikatsuCount + ' / 看護師: ' + nurseCount);
  
  Logger.log('');
  Logger.log('=== 完了 ===');
}

// ============================================================
// Step 4.2: スロット生成 + 候補検索 + スコア計算 + 主職種加点
// ============================================================

// ============================================================
// generateSlotsV2: 月の各日 × 各事業所 × 各シフト = 空き枠
// 日勤は事業所単位 (ユニット単位ではない、必要時間ベースで配置)
// ============================================================
function generateSlotsV2(ctx) {
  for (let day = 1; day <= ctx.daysInMonth; day++) {
    const dateKey = ctx.year + '-' + String(ctx.month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    const date = new Date(dateKey + 'T00:00:00');
    
    Object.keys(ctx.facilityBasis).forEach(function(jigyosho) {
      DSE_V2.DAY_SHIFTS.forEach(function(shift) {
        const slot = {
          date: date,
          dateKey: dateKey,
          jigyosho: jigyosho,
          shift: shift,
          assignment: null,
        };
        ctx.slots.push(slot);
        const slotKey = dateKey + '_' + jigyosho + '_' + shift;
        ctx.slotsByKey[slotKey] = slot;
      });
    });
  }
  return ctx.slots.length;
}

// ============================================================
// calcRoleShortage: 各事業所の不足職種を動的計算
// 戻り値: {jigyosho: {sewa: bool, sabikan: bool, nurse: bool}}
// ============================================================
function calcRoleShortage(ctx) {
  const shortage = {};
  
  Object.keys(ctx.facilityBasis).forEach(function(jig) {
    const basis = ctx.facilityBasis[jig];
    
    // 配置済み時間を集計
    let sewaH = 0, seikatsuH = 0, sabikanH = 0;
    const nurseStaffSet = {};
    
    Object.keys(ctx.staffAssignedDates).forEach(function(sid) {
      const staff = ctx.staffMap[sid];
      if (!staff) return;
      Object.keys(ctx.staffAssignedDates[sid]).forEach(function(d) {
        ctx.staffAssignedDates[sid][d].forEach(function(a) {
          if (a.jigyosho !== jig) return;
          // 役割別に集計 (管理者は別計上)
          if (staff.isSewa) sewaH += a.workHours;
          if (staff.isSeikatsu) seikatsuH += a.workHours;
          if (staff.isSabikan) sabikanH += a.workHours;
          if (staff.isNurse) nurseStaffSet[sid] = true;
        });
      });
    });
    
    shortage[jig] = {
      sewa: sewaH < basis.needSewaH,
      seikatsu: seikatsuH < basis.needSeikatsuH,
      sabikan: sabikanH < basis.needSabikanH,
      nurse: Object.keys(nurseStaffSet).length < basis.nurseRequired,
      sewaH: sewaH,
      seikatsuH: seikatsuH,
      sabikanH: sabikanH,
      nurseCount: Object.keys(nurseStaffSet).length,
    };
  });
  
  return shortage;
}

// ============================================================
// findCandidatesV2: 候補スタッフ抽出 (ハード除外H1〜H9)
// ============================================================
function findCandidatesV2(ctx, slot) {
  const dsKey = slot.dateKey + '_' + slot.shift;
  const wishes = ctx.wishesByDayShift[dsKey] || [];
  if (wishes.length === 0) return [];
  
  const candidates = [];
  
  for (const wish of wishes) {
    const staff = ctx.staffMap[wish.staff_id];
    if (!staff) continue;
    
    // H9: 許可シフト外NG
    if (staff.allowedShifts.indexOf(slot.shift) === -1) continue;
    
    // 当該事業所と希望事業所の一致確認 (柔軟: メイン/セカンド/サブのいずれか)
    if (wish.mainFac !== slot.jigyosho && wish.secondFac !== slot.jigyosho && wish.subFacs.indexOf(slot.jigyosho) === -1) continue;
    
    // 同日同スタッフ既配置 (1日1配置のみ)
    const sameDayAssigns = ctx.staffAssignedDates[staff.staff_id][slot.dateKey] || [];
    
    // H8: 同日 早出+遅出 NG (時間衝突)
    let h8Violation = false;
    for (const a of sameDayAssigns) {
      if (a.shift && DSE_V2.DAY_SHIFTS.indexOf(a.shift) !== -1) {
        // 既存日勤あり → 時間衝突チェック
        if (typeof hasTimeOverlap === 'function' && hasTimeOverlap(a.shift, slot.shift)) {
          h8Violation = true;
          break;
        }
      }
    }
    if (h8Violation) continue;
    
    // 前日夜勤との衝突 (R1相当: 夜勤C → 早出のみNG)
    let prevDayConflict = false;
    const prevDay = _v2d_addDays(slot.dateKey, -1);
    const prevAssigns = ctx.staffAssignedDates[staff.staff_id][prevDay] || [];
    for (const a of prevAssigns) {
      if (DSE_V2.NIGHT_SHIFTS.indexOf(a.shift) !== -1) {
        if (typeof hasNextDayConflict === 'function' && hasNextDayConflict(a.shift, slot.shift)) {
          prevDayConflict = true;
          break;
        }
      }
    }
    if (prevDayConflict) continue;
    
    // H1: 同日他事業所配置NG
    if (typeof hasOtherFacilityAssignment === 'function') {
      const otherFac = hasOtherFacilityAssignment(staff.staff_id, slot.dateKey, slot.jigyosho, ctx);
      if (otherFac.exists) continue;
    }
    
    // H6: 連続勤務7日以上NG
    const tmpCtx = _v2d_makeTempCtx(ctx, staff.staff_id, slot.dateKey, slot.shift, slot);
    if (typeof checkConsecutiveDays === 'function') {
      const consec = checkConsecutiveDays(staff.staff_id, slot.dateKey, tmpCtx);
      if (consec.exceeded) continue;
    }
    
    // H7: 週40時間超NG
    const addedH = (typeof SHIFT_PATTERNS !== 'undefined' && SHIFT_PATTERNS[slot.shift])
      ? (SHIFT_PATTERNS[slot.shift].dayHours + SHIFT_PATTERNS[slot.shift].nightHours)
      : 8;
    if (typeof checkWeeklyHours === 'function') {
      const weekly = checkWeeklyHours(staff.staff_id, slot.dateKey, addedH, ctx);
      if (weekly.exceeded) continue;
    }
    
    // H2/H3/H4/H5: 兼務NG (同日に異なる役割で既配置がある場合)
    // 1人内の兼務NG: 候補スタッフが複数役割を持つ場合
    if (typeof hasInternalRoleConflict === 'function' && hasInternalRoleConflict(staff.mainRoles)) continue;
    
    candidates.push({ staff: staff, wish: wish });
  }
  
  return candidates;
}

// 内部: 仮想ctx
function _v2d_makeTempCtx(ctx, staffId, dateKey, shiftType, slot) {
  const orig = ctx.staffAssignedDates[staffId] || {};
  const tmpDates = {};
  for (const k of Object.keys(orig)) tmpDates[k] = orig[k];
  
  const workHours = (typeof SHIFT_PATTERNS !== 'undefined' && SHIFT_PATTERNS[shiftType])
    ? (SHIFT_PATTERNS[shiftType].dayHours + SHIFT_PATTERNS[shiftType].nightHours)
    : 8;
  tmpDates[dateKey] = (tmpDates[dateKey] || []).concat([{
    shift: shiftType,
    jigyosho: slot.jigyosho,
    workHours: workHours
  }]);
  
  const tmpStaffDates = {};
  for (const sid of Object.keys(ctx.staffAssignedDates)) tmpStaffDates[sid] = ctx.staffAssignedDates[sid];
  tmpStaffDates[staffId] = tmpDates;
  
  return { staffAssignedDates: tmpStaffDates };
}

// 内部: 日付加算
function _v2d_addDays(dateKey, delta) {
  const d = new Date(dateKey + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd');
}

// ============================================================
// calcScoreV2: 配置スコア (夜勤と共通 + 主職種マッチ加点)
// ============================================================
function calcScoreV2(ctx, staff, wish, slot, shortage) {
  let score = 0;
  const fac = slot.jigyosho;
  
  // 施設マッチング (※日勤は事業所単位)
  if (staff.mainFac === fac) score += DSE_V2.SCORE.MAIN_FAC;
  else if (staff.secondFac === fac) score += DSE_V2.SCORE.SECOND_FAC;
  else if (staff.subFacs.indexOf(fac) >= 0) score += DSE_V2.SCORE.SUB_FAC;
  
  // 国家資格
  if (staff.qualification) score += DSE_V2.SCORE.QUALIFIED;
  
  // 正社員
  if (staff.employment === '正社員') score += DSE_V2.SCORE.FULL_TIME;
  
  // 勤務歴
  score += (staff.hireMonths || 0) * DSE_V2.SCORE.MONTH_X;
  
  // 施設熟練度
  const skillCount = (ctx.history3m[staff.staff_id] || {})[fac] || 0;
  score += skillCount * DSE_V2.SCORE.SKILL_X;
  
  // 保護
  if (staff.isProtected) {
    if ((ctx.monthlyAssign[staff.staff_id] || 0) === 0) {
      score += DSE_V2.SCORE.PROTECTED_ZERO;
    } else {
      score += DSE_V2.SCORE.PROTECTED_OTHER;
    }
  }
  
  // 新人
  if (staff.isNewbie1) score += DSE_V2.SCORE.NEWBIE1;
  else if (staff.isNewbie2) score += DSE_V2.SCORE.NEWBIE2;
  
  // 集中度
  const concentration = ctx.monthlyAssign[staff.staff_id] || 0;
  score += concentration * DSE_V2.SCORE.CONCENTRATION_X;
  
  // VIP
  if (staff.isVIP) score += DSE_V2.SCORE.VIP;
  
  // ★日勤特有: 不足職種マッチ加点
  if (shortage && shortage[fac]) {
    const sh = shortage[fac];
    if (sh.sabikan && staff.isSabikan) score += DSE_V2.SCORE.ROLE_SHORT_SABIKAN;
    if (sh.nurse && staff.isNurse) score += DSE_V2.SCORE.ROLE_SHORT_NURSE;
    if (sh.sewa && staff.isSewa) score += DSE_V2.SCORE.ROLE_SHORT_SEWA;
  }
  
  return score;
}

// ============================================================
// テスト関数: スロット生成 + 不足計算 + 候補検索 + スコア
// ============================================================
function testSlotsAndCandidatesV2() {
  Logger.log('=== Step 4.2 動作確認 ===');
  const ym = '2026-05';
  const ctx = loadEngineContextV2(ym);
  
  Logger.log('--- generateSlotsV2 ---');
  const slotCount = generateSlotsV2(ctx);
  Logger.log('生成スロット数: ' + slotCount + ' (期待: 5事業所 × 4シフト × 31日 = 620)');
  
  if (ctx.slots.length > 0) {
    const s = ctx.slots[0];
    Logger.log('サンプル[0]: ' + s.dateKey + ' / ' + s.jigyosho + ' / ' + s.shift);
    const last = ctx.slots[ctx.slots.length - 1];
    Logger.log('サンプル[末]: ' + last.dateKey + ' / ' + last.jigyosho + ' / ' + last.shift);
  }
  
  Logger.log('');
  Logger.log('--- calcRoleShortage (現状の不足職種) ---');
  const shortage = calcRoleShortage(ctx);
  Object.keys(shortage).forEach(function(jig) {
    const sh = shortage[jig];
    const flags = [];
    if (sh.sewa) flags.push('世話人不足');
    if (sh.seikatsu) flags.push('生活支援員不足');
    if (sh.sabikan) flags.push('サビ管不足');
    if (sh.nurse) flags.push('看護師不足');
    Logger.log(jig + ': sewa=' + sh.sewaH.toFixed(1) + 'h / sabikan=' + sh.sabikanH.toFixed(1) + 'h / nurse=' + sh.nurseCount + '名 → ' + (flags.length > 0 ? flags.join(', ') : '充足'));
  });
  
  Logger.log('');
  Logger.log('--- findCandidatesV2 (希望0なので0件期待) ---');
  if (ctx.slots.length > 0) {
    const slot = ctx.slots[0];
    const cands = findCandidatesV2(ctx, slot);
    Logger.log(slot.dateKey + ' / ' + slot.jigyosho + ' / ' + slot.shift + ' → 候補: ' + cands.length + '件');
  }
  
  Logger.log('');
  Logger.log('--- calcScoreV2 (mockスタッフ) ---');
  const mockStaff = {
    staff_id: 'TEST',
    mainFac: 'GHコノヒカラ',
    secondFac: '',
    subFacs: [],
    qualification: '看護師',
    employment: '正社員',
    hireMonths: 36,
    isProtected: false,
    isVIP: false,
    isNewbie1: false,
    isNewbie2: false,
    isSabikan: false,
    isNurse: true,
    isSewa: false,
    isSeikatsu: false,
  };
  const mockSlot = { jigyosho: 'GHコノヒカラ' };
  ctx.history3m['TEST'] = {};
  ctx.monthlyAssign['TEST'] = 0;
  
  // 不足なし
  const score1 = calcScoreV2(ctx, mockStaff, {}, mockSlot, null);
  Logger.log('不足なし: ' + score1 + ' (期待: 30+10+5+72=117)');
  
  // 看護師不足あり
  const mockShortage = { 'GHコノヒカラ': { sabikan: false, nurse: true, sewa: false } };
  const score2 = calcScoreV2(ctx, mockStaff, {}, mockSlot, mockShortage);
  Logger.log('看護師不足: ' + score2 + ' (期待: 117 + 15 = 132)');
  
  Logger.log('');
  Logger.log('=== 完了 ===');
}
