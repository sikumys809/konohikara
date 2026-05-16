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
  COL_REQ_FREQ_TYPE: 11,   // L列: 希望頻度タイプ ('月次合計' | '週次')
  COL_REQ_FREQ_COUNT: 12,  // M列: 希望頻度数 (整数)
  
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
    QUALIFIED: 1000, FULL_TIME: 5,  // 看護師優先のため大幅加点 (2026-05-06更新)
    MONTH_X: 2, SKILL_X: 3,
    PROTECTED_ZERO: 50, PROTECTED_OTHER: 15,
    NEWBIE1: -30, NEWBIE2: -10,
    CONCENTRATION_X: -5, VIP: 10000,
    ROLE_SHORT_SABIKAN: 20,  // サビ管不足時の加点
    ROLE_SHORT_NURSE: 15,    // 看護師不足時の加点
    ROLE_SHORT_SEWA: 15,     // 世話人不足時の加点
    // ★Day11: E-st 事業所バランス加点
    EST_BALANCE_BONUS: 12,      // 前回と逆事業所への配置を促す
    EST_BALANCE_PENALTY: -8,    // 前回と同事業所連続を抑制
    EST_INITIAL_BONUS: 3,       // 履歴なし時 staff_id偶奇方向への弱い誘導
    EST_FACILITY: 'ルーデンス上板橋E-st',
    EST_JIGYOSHOS: ['GHコノヒカラ板橋北区', 'GHコノヒカラ板橋北区セカンド'],
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
    facilityToJigyoshos: {},  // 1施設→複数事業所対応 (E-st特殊ケース)
    staffMap: {},
    facilityBasis: {},  // {jigyosho: {capacity, sewa, seikatsu, tokutei, sabikan, nurse, kanrisha, needSewaH, needSeikatsuH, needTokuteiH, needSabikanH, needKanrishaH, nurseRequired}}
    wishes: [],
    wishesByStaff: {},
    wishesByStaffDay: {},
    wishesByDayShift: {},
    staffFreq: {},          // ★Phase 5.1: staff_id → {type, count}
    staffMonthlyCount: {},  // ★Phase 5.1: staff_id → 当月配置数
    staffWeeklyCount: {},   // ★Phase 5.1: staff_id_weekKey → 週単位配置数
    history3m: {},
    historyCount: 0,
    monthlyAssign: {},
    staffAssignedDates: {},  // {staffId: {dateKey: [{shift, jigyosho, facility, unit, workHours, role}]}}
    slots: [],
    slotsByKey: {},
    estLastJigyoshoByStaff: {},  // ★Day11: E-st最新配置事業所キャッシュ
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
    if (!ctx.facilityToJigyoshos[unit.facility]) ctx.facilityToJigyoshos[unit.facility] = [];
    if (ctx.facilityToJigyoshos[unit.facility].indexOf(unit.jigyosho) === -1) {
      ctx.facilityToJigyoshos[unit.facility].push(unit.jigyosho);
    }
  }
  
  // ★Day11 Phase4: E-st仮想キー追加 (M_スタッフのカッコ無し表記対応)
  if (typeof _injectEstVirtualKey === 'function') {
    _injectEstVirtualKey(ctx.facilityToJigyoshos);
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
        freqType: String(row[DSE_V2.COL_REQ_FREQ_TYPE] || '').trim(),
        freqCount: parseInt(row[DSE_V2.COL_REQ_FREQ_COUNT]) || 0,
      };
      // ★Phase 5.1: ctx.staffFreq にスタッフ単位で保存
      if (!ctx.staffFreq[staffId] && wish.freqType && wish.freqCount > 0) {
        ctx.staffFreq[staffId] = { type: wish.freqType, count: wish.freqCount };
      }
      
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
          assignedRole: String(row[18] || '').trim(),  // ★Day 13 fix: シート18列目から読込
        });
        ctx.monthlyAssign[staffId] = (ctx.monthlyAssign[staffId] || 0) + 1;
        if (typeof _v_incrementFreqCounters === 'function') _v_incrementFreqCounters(ctx, staffId, dateKey);
      }
      
      // 5c. ★Day11: E-st配置履歴 (対象月内、最新で上書き)
      // ★Day11 Phase4修正: E列は実体施設(カッコ付き)なので前方一致で判定
      if (date >= monthStart && date < monthEnd
          && _isEstRealFacility(facility)
          && DSE_V2.SCORE.EST_JIGYOSHOS.indexOf(jigyosho) !== -1) {
        ctx.estLastJigyoshoByStaff[staffId] = jigyosho;
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
          // ★Phase 6 修正: assignedRole ベース集計 (calcRoleHoursV2と一致させる)
          // 旧: staff.isSewa/isSeikatsu/isSabikan で両方カウント → 兼任者で seikatsuH 過大計上
          if (a.assignedRole === 'サビ管') sabikanH += a.workHours;
          else if (a.assignedRole === '世話人') sewaH += a.workHours;
          else if (a.assignedRole === '生活支援員') seikatsuH += a.workHours;
          else {
            // フォールバック: assignedRole無し (古いレコード or 既存配置ロード時)
            // _v2d_pickPrimaryRole の優先順 (サビ管 > 世話人 > 生活支援員) で1つに振り分け
            if (staff.isSabikan) sabikanH += a.workHours;
            else if (staff.isSewa) sewaH += a.workHours;
            else if (staff.isSeikatsu) seikatsuH += a.workHours;
          }
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
// ★Day10改修: priorityLevel 引数追加 (1=メイン, 2=セカンド, 3=サブ, 0/未指定=全部)
//   メイン優先バグ修正のための2パス方式 (実は3パス) で使用
// ============================================================
function findCandidatesV2(ctx, slot, priorityLevel) {
  const dsKey = slot.dateKey + '_' + slot.shift;
  const wishes = ctx.wishesByDayShift[dsKey] || [];
  if (wishes.length === 0) return [];
  
  const candidates = [];
  
  for (const wish of wishes) {
    const staff = ctx.staffMap[wish.staff_id];
    if (!staff) continue;
    
    // ★Day 14: H9 許可シフト外NG (共通関数化)
    if (typeof checkH9_allowedShift === 'function') {
      if (checkH9_allowedShift(staff, slot.shift) !== null) continue;
    }
    
    // ★Day 14: H10 配置許可施設外NG (共通関数化)
    // wish.mainFac/secondFac/subFacs を staff 形式に組み立て、priorityLevel を渡す
    if (typeof checkH10_allowedFacility_dayShift === 'function') {
      const _staffForCheck = {
        mainFac: wish.mainFac,
        secondFac: wish.secondFac,
        subFacs: wish.subFacs || []
      };
      if (checkH10_allowedFacility_dayShift(_staffForCheck, slot.jigyosho, ctx.facilityToJigyoshos, priorityLevel) !== null) continue;
    }
    
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
      // ★Phase 5.3: freqCount 上限チェック (自動配置の上限)
      if (_v_isFreqLimitExceeded(ctx, staff.staff_id, slot.dateKey)) continue;
      
      const weekly = checkWeeklyHours(staff.staff_id, slot.dateKey, addedH, ctx);
      if (weekly.exceeded) continue;
    }
    
    // ★ H14: 1日8時間上限超NG (労基法準拠、Day10新規)
    // 障害福祉法では配置基準時間カウントは労基法上の1日8h内のみ有効
    if (typeof checkDailyHours === 'function') {
      const daily = checkDailyHours(staff.staff_id, slot.dateKey, addedH, ctx);
      if (daily.exceeded) continue;
    }
    
    // H2/H3/H4/H5: 兼務NG = 同時刻に異なる役割で配置されるのを防ぐ仕様。
    // 仕様書: 「1人のスタッフが同時刻に世話人と生活支援員の両方の役割は不可。時間帯が違えばOK」
    // 主職種を複数持つこと自体は問題ないため、ここでは候補から弾かない。
    // 配置時に1役割を選ぶ実装（Step C）で仕様準拠を担保する。
    
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
  
  // 施設マッチング (日勤は事業所単位slot, 施設→事業所マップ経由で判定)
  const _mainJigs = ctx.facilityToJigyoshos[staff.mainFac] || [];
  const _secondJigs = ctx.facilityToJigyoshos[staff.secondFac] || [];
  const _subJigs = staff.subFacs.reduce(function(acc, f) {
    return acc.concat(ctx.facilityToJigyoshos[f] || []);
  }, []);
  if (_mainJigs.indexOf(fac) !== -1) score += DSE_V2.SCORE.MAIN_FAC;
  else if (_secondJigs.indexOf(fac) !== -1) score += DSE_V2.SCORE.SECOND_FAC;
  else if (_subJigs.indexOf(fac) !== -1) score += DSE_V2.SCORE.SUB_FAC;
  
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
  
  // ★Day11: E-st 事業所バランス加点
  if (DSE_V2.SCORE.EST_JIGYOSHOS.indexOf(fac) !== -1) {
    const isEstStaff = (staff.mainFac === DSE_V2.SCORE.EST_FACILITY)
                    || (staff.secondFac === DSE_V2.SCORE.EST_FACILITY)
                    || ((staff.subFacs || []).indexOf(DSE_V2.SCORE.EST_FACILITY) !== -1);
    if (isEstStaff) {
      const last = ctx.estLastJigyoshoByStaff[staff.staff_id];
      if (last) {
        score += (last === fac)
          ? DSE_V2.SCORE.EST_BALANCE_PENALTY
          : DSE_V2.SCORE.EST_BALANCE_BONUS;
      } else {
        const idNum = parseInt(staff.staff_id, 10) || 0;
        const preferred = (idNum % 2 === 0)
          ? 'GHコノヒカラ板橋北区'
          : 'GHコノヒカラ板橋北区セカンド';
        if (preferred === fac) score += DSE_V2.SCORE.EST_INITIAL_BONUS;
      }
    }
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

// ============================================================
// Step 4.3: W2 / N2 警告チェック関数
// ============================================================

// ============================================================
// W2: 当日 遅出8h → 当日 夜勤A/B/C
// 夜勤とは逆方向 (夜勤側のR2は遅出8h→夜勤、日勤側のW2は遅出8h→夜勤)
// ただしこれは日勤エンジンの判定なので、配置中のシフトが「遅出8h」のとき、
// 同日に既に夜勤A/B/Cが配置されていたら警告
// ============================================================
function checkW2WarningV2(staff, slot, ctx) {
  // W2は「当日が遅出8h」の場合のみ判定
  if (slot.shift !== '遅出8h') return null;
  
  const sameDayAssigns = (ctx.staffAssignedDates[staff.staff_id] || {})[slot.dateKey] || [];
  
  for (const a of sameDayAssigns) {
    if (DSE_V2.NIGHT_SHIFTS.indexOf(a.shift) !== -1) {
      return {
        ruleId: 'W2',
        level: WARNING_LEVEL.BLOCK,
        message: '同日(' + slot.dateKey + ')の遅出8h(〜22:00) → 同日' + a.shift + ' は連続勤務NG'
      };
    }
  }
  return null;
}

// ============================================================
// N2: 同一施設・同一日 通常スタッフ0人で新人のみ
// 仕様書: 日勤は配置充足優先のため、警告のみで自動除外しない
// ============================================================
function checkN2WarningV2(staff, slot, ctx) {
  const isCandidateNewbie = staff.isNewbie1 || staff.isNewbie2;
  if (!isCandidateNewbie) return null;
  
  // その日その事業所に配置済みの全スタッフを確認 (注: 日勤は事業所単位)
  const dateKey = slot.dateKey;
  const targetJigyosho = slot.jigyosho;
  
  for (const sid of Object.keys(ctx.staffAssignedDates)) {
    const assigns = ctx.staffAssignedDates[sid][dateKey] || [];
    for (const a of assigns) {
      if (a.jigyosho !== targetJigyosho) continue;
      const otherStaff = ctx.staffMap[sid];
      if (!otherStaff) continue;
      if (!otherStaff.isNewbie1 && !otherStaff.isNewbie2) {
        return null;  // 通常>=1人 確保
      }
    }
  }
  
  return {
    ruleId: 'N2',
    level: WARNING_LEVEL.ONLY,  // 警告のみ (自動除外しない)
    message: '同一事業所(' + targetJigyosho + ')・同一日(' + dateKey + ') に通常スタッフ0人で新人(' + staff.kubun + ')のみ配置'
  };
}

// ============================================================
// 統合: 配置候補に対して全警告チェック
// ============================================================
// ============================================================
// Phase 5.7: R4 警告 (自動配置上限超過)
// 手動配置で freqCount を超過しようとした時の警告
// 対象: スタッフのfreqType=月次合計 で、当月のmonthlyCount >= freqCount
// レベル: warning_block (最終承認者の承認が必要)
// ============================================================
function checkR4WarningV2(staff, slot, ctx) {
  if (!staff || !ctx) return null;
  const sid = String(staff.staff_id);
  const freq = (ctx.staffFreq && ctx.staffFreq[sid]) || null;
  if (!freq || !freq.count || freq.count <= 0) return null;
  
  const monthlyCount = (ctx.staffMonthlyCount && ctx.staffMonthlyCount[sid]) || 0;
  const weeklyCount = (ctx.staffWeeklyCount && ctx.staffWeeklyCount[sid]) || {};
  
  if (freq.type === '月次合計') {
    if (monthlyCount >= freq.count) {
      return {
        ruleId: 'R4',
        level: WARNING_LEVEL.BLOCK,
        message: '自動配置上限(月' + freq.count + '件)を超過する手動配置です。現在' + monthlyCount + '件配置済み。'
      };
    }
  } else if (freq.type === '週次') {
    const weekKey = (typeof _v_weekKey === 'function') ? _v_weekKey(slot.dateKey) : '';
    const wCount = weekKey ? (weeklyCount[weekKey] || 0) : 0;
    if (wCount >= freq.count) {
      return {
        ruleId: 'R4',
        level: WARNING_LEVEL.BLOCK,
        message: '自動配置上限(週' + freq.count + '件)を超過する手動配置です。現在' + wCount + '件配置済み(' + weekKey + ')。'
      };
    }
  }
  return null;
}

function checkAllWarningsV2(staff, slot, ctx) {
  const warnings = [];
  const w2 = checkW2WarningV2(staff, slot, ctx);
  if (w2) warnings.push(w2);
  const n2 = checkN2WarningV2(staff, slot, ctx);
  if (n2) warnings.push(n2);
  // ★Phase 5.7: R4警告 (freqCount超過)
  const r4 = checkR4WarningV2(staff, slot, ctx);
  if (r4) warnings.push(r4);
  return warnings;
}

// ============================================================
// テスト関数: W2 / N2 警告チェック
// ============================================================
function testWarningsV2() {
  Logger.log('=== Step 4.3 W2/N2 警告チェック ===');
  
  // mock ctx
  const ctx = {
    staffMap: {
      '13': { staff_id: '13', name: '水野永吉', kubun: '通常', isNewbie1: false, isNewbie2: false },
      '14': { staff_id: '14', name: '新人花子', kubun: '新人1ヶ月', isNewbie1: true, isNewbie2: false },
      '15': { staff_id: '15', name: '新人次郎', kubun: '新人2ヶ月', isNewbie1: false, isNewbie2: true },
      '99': { staff_id: '99', name: '通常太郎', kubun: '通常', isNewbie1: false, isNewbie2: false }
    },
    staffAssignedDates: {
      '13': {
        '2026-05-15': [{ shift: '夜勤A', jigyosho: 'GHコノヒカラ', facility: 'リフレ要町', workHours: 8 }]
      },
      '99': {
        '2026-05-15': [{ shift: '早出8h', jigyosho: 'GHコノヒカラ', facility: 'リフレ要町', workHours: 8 }]
      },
      '15': {
        '2026-05-16': [{ shift: '早出8h', jigyosho: 'GHコノヒカラ', facility: 'リフレ要町', workHours: 8 }]
      }
    }
  };
  
  // === W2 テスト ===
  Logger.log('\n--- W2 (同日 遅出8h ← 同日に夜勤あり) ---');
  // 13: 5/15 夜勤A済 → 5/15 遅出8h 配置 → W2警告
  let r = checkW2WarningV2(ctx.staffMap['13'], { dateKey: '2026-05-15', jigyosho: 'GHコノヒカラ', shift: '遅出8h' }, ctx);
  Logger.log('staff=13 / 5/15 / 遅出8h (夜勤A済) → ' + (r ? 'W2警告: ' + r.message : '警告なし') + ' (期待:W2警告)');
  // 13: 5/15 夜勤A済 → 5/15 遅出4h 配置 → W2対象外 (4hは対象外)
  r = checkW2WarningV2(ctx.staffMap['13'], { dateKey: '2026-05-15', jigyosho: 'GHコノヒカラ', shift: '遅出4h' }, ctx);
  Logger.log('staff=13 / 5/15 / 遅出4h (夜勤A済) → ' + (r ? 'W2警告' : '警告なし') + ' (期待:なし W2対象外)');
  // 13: 5/15 夜勤A済 → 5/15 早出8h 配置 → W2対象外 (早出は対象外)
  r = checkW2WarningV2(ctx.staffMap['13'], { dateKey: '2026-05-15', jigyosho: 'GHコノヒカラ', shift: '早出8h' }, ctx);
  Logger.log('staff=13 / 5/15 / 早出8h (夜勤A済) → ' + (r ? 'W2警告' : '警告なし') + ' (期待:なし 早出対象外)');
  // 14: 配置なし → 5/15 遅出8h 配置 → 警告なし
  r = checkW2WarningV2(ctx.staffMap['14'], { dateKey: '2026-05-15', jigyosho: 'GHコノヒカラ', shift: '遅出8h' }, ctx);
  Logger.log('staff=14 / 5/15 / 遅出8h (配置なし) → ' + (r ? 'W2警告' : '警告なし') + ' (期待:なし)');
  
  // === N2 テスト ===
  Logger.log('\n--- N2 (同一事業所・同一日 新人のみ) ---');
  // 14 (新人) を 5/15 GHコノヒカラ → 通常99がいるので警告なし
  r = checkN2WarningV2(ctx.staffMap['14'], { dateKey: '2026-05-15', jigyosho: 'GHコノヒカラ' }, ctx);
  Logger.log('staff=14(新人1) / 5/15 / GHコノヒカラ (通常99あり) → ' + (r ? 'N2警告' : '警告なし') + ' (期待:なし)');
  // 13 (通常) を 5/15 GHコノヒカラ → 候補が通常なので警告なし
  r = checkN2WarningV2(ctx.staffMap['13'], { dateKey: '2026-05-15', jigyosho: 'GHコノヒカラ' }, ctx);
  Logger.log('staff=13(通常) / 5/15 / GHコノヒカラ → ' + (r ? 'N2警告' : '警告なし') + ' (期待:なし 通常)');
  // 14 (新人) を 5/16 GHコノヒカラ → 既存は新人15のみ → N2警告
  r = checkN2WarningV2(ctx.staffMap['14'], { dateKey: '2026-05-16', jigyosho: 'GHコノヒカラ' }, ctx);
  Logger.log('staff=14(新人1) / 5/16 / GHコノヒカラ (新人15のみ) → ' + (r ? 'N2警告: ' + r.message : '警告なし') + ' (期待:N2警告 level=ONLY)');
  // 14 (新人) を 5/17 GHコノヒカラ → 配置なし → N2警告
  r = checkN2WarningV2(ctx.staffMap['14'], { dateKey: '2026-05-17', jigyosho: 'GHコノヒカラ' }, ctx);
  Logger.log('staff=14(新人1) / 5/17 / GHコノヒカラ (配置なし) → ' + (r ? 'N2警告: ' + r.message : '警告なし') + ' (期待:N2警告)');
  
  // === 統合テスト ===
  Logger.log('\n--- checkAllWarningsV2 統合 ---');
  // 13: 5/15 夜勤A済 → 5/15 遅出8h → W2のみ
  let all = checkAllWarningsV2(ctx.staffMap['13'], { dateKey: '2026-05-15', jigyosho: 'GHコノヒカラ', shift: '遅出8h' }, ctx);
  Logger.log('staff=13 / 5/15 / 遅出8h → 警告 ' + all.length + '件');
  all.forEach(function(w) { Logger.log('  - ' + w.ruleId + ' (' + w.level + '): ' + w.message); });
  
  // 14 (新人): 5/17 GHコノヒカラ 早出8h → N2のみ
  all = checkAllWarningsV2(ctx.staffMap['14'], { dateKey: '2026-05-17', jigyosho: 'GHコノヒカラ', shift: '早出8h' }, ctx);
  Logger.log('staff=14 / 5/17 / 早出8h → 警告 ' + all.length + '件');
  all.forEach(function(w) { Logger.log('  - ' + w.ruleId + ' (' + w.level + '): ' + w.message); });
  
  Logger.log('\n=== 完了 ===');
}

// ============================================================
// Step 4.4: 役割別時間集計 + 管理者の二重計上
// ============================================================

// ============================================================


// ============================================================
// Phase 6: shortage を動的更新 (配置確定後に呼ぶ)
// 配置されたスタッフの assignedRole に応じて該当の累積hを増やし、
// 不足フラグを再計算する
// ============================================================
function _v2d_updateShortageAfterAssign(shortage, jigyosho, assignedRole, staff, addedH, basis) {
  if (!shortage[jigyosho]) return;
  const s = shortage[jigyosho];
  
  // 役割別に累積h増やす
  if (assignedRole === 'サビ管') s.sabikanH += addedH;
  else if (assignedRole === '世話人') s.sewaH += addedH;
  else if (assignedRole === '生活支援員') s.seikatsuH += addedH;
  // 管理者は別途 (二重計上で別カウンタ)
  
  // 看護師は人数判定
  if (staff && staff.isNurse) {
    if (!s.nurseSet) s.nurseSet = {};
    s.nurseSet[staff.staff_id] = true;
    s.nurseCount = Object.keys(s.nurseSet).length;
  }
  
  // 不足フラグ再計算
  s.sewa = s.sewaH < basis.needSewaH;
  s.seikatsu = s.seikatsuH < basis.needSeikatsuH;
  s.sabikan = s.sabikanH < basis.needSabikanH;
  s.nurse = (s.nurseCount || 0) < basis.nurseRequired;
}

// _v2d_pickPrimaryRole: スタッフの主役割を1つ選ぶ (ヒエラルキー優先)
// 兼任時は配置文脈で1つに絞る (※管理者は別計上、看護師は人数判定のため除外)
// 優先順: サビ管 > 世話人 > 生活支援員
// 注意: 看護師は単独配置不可 (マスタ登録時バリデーション必須)
//       看護師の人数判定は calcRoleHoursV2 で staff.isNurse から別途集計
// ============================================================
function _v2d_pickPrimaryRole(staff) {
  if (!staff || !Array.isArray(staff.mainRoles)) return '';
  const roles = staff.mainRoles;
  if (roles.indexOf('サビ管') !== -1) return 'サビ管';
  if (roles.indexOf('世話人') !== -1) return '世話人';
  if (roles.indexOf('生活支援員') !== -1) return '生活支援員';
  return '';
}

// ============================================================
// calcRoleHoursV2: 各事業所の役割別時間を集計
// ★管理者の二重計上ルール:
//   管理者として勤務した時間 → 管理者h + 兼任先(世話人/生活支援員/サビ管)h に同時加算
// ============================================================
function calcRoleHoursV2(ctx) {
  const result = {};
  
  // 各事業所を初期化
  Object.keys(ctx.facilityBasis).forEach(function(jig) {
    const basis = ctx.facilityBasis[jig];
    result[jig] = {
      jigyosho: jig,
      sewaH: 0,
      seikatsuH: 0,
      sabikanH: 0,
      kanrishaH: 0,
      tokuteiH: 0,  // 世話人h + 生活支援員h
      nurseStaffSet: {},  // ユニーク看護師ID
      nurseCount: 0,
      // 必要時間 (基準値コピー)
      needSewaH: basis.needSewaH,
      needSeikatsuH: basis.needSeikatsuH,
      needTokuteiH: basis.needTokuteiH,
      needSabikanH: basis.needSabikanH,
      needKanrishaH: basis.needKanrishaH,
      nurseRequired: basis.nurseRequired,
      // 充足率 (後から計算)
      sewaRate: 0,
      seikatsuRate: 0,
      tokuteiRate: 0,
      sabikanRate: 0,
      kanrishaRate: 0,
      nurseRate: 0,
    };
  });
  
  // 全配置を走査
  Object.keys(ctx.staffAssignedDates).forEach(function(sid) {
    const staff = ctx.staffMap[sid];
    if (!staff) return;
    
    Object.keys(ctx.staffAssignedDates[sid]).forEach(function(d) {
      ctx.staffAssignedDates[sid][d].forEach(function(a) {
        const jig = a.jigyosho;
        if (!result[jig]) return;
        const r = result[jig];
        const h = a.workHours || 0;
        const isNight = a.isNight || (DSE_V2.NIGHT_SHIFTS.indexOf(a.shift) !== -1);
        
        // 夜勤の日勤カウント加算 (B/Cのみ、各2h)
        let dayH = h;
        if (isNight) {
          // 夜勤は基本日勤カウントしない、ただし夜勤B/Cは早朝日勤として2h加算
          if (typeof SHIFT_PATTERNS !== 'undefined' && SHIFT_PATTERNS[a.shift]) {
            dayH = SHIFT_PATTERNS[a.shift].dayHours;  // A/B/C すべて 2h (Day10 訂正済)
          } else {
            dayH = 0;
          }
        }
        
        if (dayH === 0) return;  // 日勤カウントなし
        
        // ★管理者の二重計上
        if (staff.isKanrisha) {
          r.kanrishaH += dayH;
        }
        
        // ★ Day10改修: 役割別カウントは assignedRole ベース
        // 配置時に pickAssignedRole で決定された役割を使う
        // (旧: _v2d_pickPrimaryRole で主職種優先順位から自動選択)
        // フォールバック: assignedRole が無い場合 (古い配置レコード) は旧ロジック
        const role = a.assignedRole || _v2d_pickPrimaryRole(staff);
        if (role === 'サビ管') r.sabikanH += dayH;
        else if (role === '生活支援員') r.seikatsuH += dayH;
        else if (role === '世話人') r.sewaH += dayH;
        // 看護師は時間ではなく人数判定
        if (staff.isNurse) r.nurseStaffSet[sid] = true;
      });
    });
  });
  
  // 集計後処理: tokuteiH = sewaH + seikatsuH、看護師人数、充足率
  Object.keys(result).forEach(function(jig) {
    const r = result[jig];
    r.tokuteiH = r.sewaH + r.seikatsuH;
    r.nurseCount = Object.keys(r.nurseStaffSet).length;
    r.sewaRate = r.needSewaH > 0 ? (r.sewaH / r.needSewaH * 100) : 0;
    r.seikatsuRate = r.needSeikatsuH > 0 ? (r.seikatsuH / r.needSeikatsuH * 100) : 0;
    r.tokuteiRate = r.needTokuteiH > 0 ? (r.tokuteiH / r.needTokuteiH * 100) : 0;
    r.sabikanRate = r.needSabikanH > 0 ? (r.sabikanH / r.needSabikanH * 100) : 0;
    r.kanrishaRate = r.needKanrishaH > 0 ? (r.kanrishaH / r.needKanrishaH * 100) : 0;
    r.nurseRate = r.nurseRequired > 0 ? (r.nurseCount / r.nurseRequired * 100) : 0;
  });
  
  return result;
}

// ============================================================
// テスト関数: 役割別時間集計 (管理者二重計上を含む)
// ============================================================
function testRoleHoursV2() {
  Logger.log('=== Step 4.4 役割別時間集計 + 管理者二重計上 ===');
  
  // mock ctx
  const ctx = {
    facilityBasis: {
      'GHコノヒカラ': {
        needSewaH: 814.86,
        needSeikatsuH: 248.00,
        needTokuteiH: 1470.29,
        needSabikanH: 177.14,
        needKanrishaH: 177.14,
        nurseRequired: 2,
      }
    },
    staffMap: {
      // 管理者+世話人兼任
      '1': {
        staff_id: '1', name: '水野恵子', mainRoles: ['管理者', '世話人'],
        isKanrisha: true, isSabikan: false, isSewa: true, isSeikatsu: false, isNurse: false
      },
      // 通常世話人 (160h月勤務)
      '2': {
        staff_id: '2', name: '世話人A', mainRoles: ['世話人'],
        isKanrisha: false, isSabikan: false, isSewa: true, isSeikatsu: false, isNurse: false
      },
      // 生活支援員
      '3': {
        staff_id: '3', name: '生活支援員A', mainRoles: ['生活支援員'],
        isKanrisha: false, isSabikan: false, isSewa: false, isSeikatsu: true, isNurse: false
      },
      // サビ管 (80h)
      '4': {
        staff_id: '4', name: 'サビ管A', mainRoles: ['サビ管'],
        isKanrisha: false, isSabikan: true, isSewa: false, isSeikatsu: false, isNurse: false
      },
      // 看護師 (32h)
      '5': {
        staff_id: '5', name: '看護師A', mainRoles: ['看護師'],
        isKanrisha: false, isSabikan: false, isSewa: false, isSeikatsu: false, isNurse: true
      },
      // 看護師B
      '6': {
        staff_id: '6', name: '看護師B', mainRoles: ['看護師'],
        isKanrisha: false, isSabikan: false, isSewa: false, isSeikatsu: false, isNurse: true
      }
    },
    staffAssignedDates: {
      // 管理者(兼世話人) staff=1: 早出8h × 20日 = 160h
      '1': {},
      // 世話人 staff=2: 早出8h × 20日 = 160h
      '2': {},
      // 生活支援員 staff=3: 遅出8h × 30日 = 240h
      '3': {},
      // サビ管 staff=4: 早出8h × 10日 = 80h
      '4': {},
      // 看護師 staff=5: 遅出4h × 8日 = 32h
      '5': {},
      // 看護師 staff=6: 早出4h × 8日 = 32h
      '6': {}
    }
  };
  
  // 配置データ生成 (mock)
  const generateAssigns = function(sid, shift, count, hours) {
    for (let i = 1; i <= count; i++) {
      const dateKey = '2026-05-' + String(i).padStart(2, '0');
      ctx.staffAssignedDates[sid][dateKey] = [{
        shift: shift, jigyosho: 'GHコノヒカラ',
        facility: 'リフレ要町', unit: '', workHours: hours,
        isNight: false, isDay: true
      }];
    }
  };
  generateAssigns('1', '早出8h', 20, 8);   // 管理者+世話人 = 160h
  generateAssigns('2', '早出8h', 20, 8);   // 世話人 = 160h
  generateAssigns('3', '遅出8h', 30, 8);   // 生活支援員 = 240h
  generateAssigns('4', '早出8h', 10, 8);   // サビ管 = 80h
  generateAssigns('5', '遅出4h', 8, 4);    // 看護師 = 32h
  generateAssigns('6', '早出4h', 8, 4);    // 看護師 = 32h
  
  Logger.log('--- 配置内容 ---');
  Logger.log('staff=1 管理者+世話人: 早出8h × 20日 = 160h');
  Logger.log('staff=2 世話人: 早出8h × 20日 = 160h');
  Logger.log('staff=3 生活支援員: 遅出8h × 30日 = 240h');
  Logger.log('staff=4 サビ管: 早出8h × 10日 = 80h');
  Logger.log('staff=5 看護師: 遅出4h × 8日 = 32h');
  Logger.log('staff=6 看護師: 早出4h × 8日 = 32h');
  
  Logger.log('');
  Logger.log('--- calcRoleHoursV2 実行 ---');
  const result = calcRoleHoursV2(ctx);
  
  const r = result['GHコノヒカラ'];
  Logger.log('');
  Logger.log('=== GHコノヒカラ 集計結果 ===');
  Logger.log('世話人h: ' + r.sewaH + 'h (期待:320h ← 管理者160 + 世話人160)');
  Logger.log('生活支援員h: ' + r.seikatsuH + 'h (期待:240h)');
  Logger.log('特定加配h: ' + r.tokuteiH + 'h (期待:560h ← 世話人320 + 生活支援員240)');
  Logger.log('サビ管h: ' + r.sabikanH + 'h (期待:80h)');
  Logger.log('管理者h: ' + r.kanrishaH + 'h (期待:160h ← 管理者は二重計上)');
  Logger.log('看護師人数: ' + r.nurseCount + ' (期待:2)');
  Logger.log('');
  Logger.log('=== 充足率 ===');
  Logger.log('世話人: ' + r.sewaRate.toFixed(1) + '% (320 / ' + r.needSewaH + ')');
  Logger.log('生活支援員: ' + r.seikatsuRate.toFixed(1) + '% (240 / ' + r.needSeikatsuH + ')');
  Logger.log('特定加配: ' + r.tokuteiRate.toFixed(1) + '% (560 / ' + r.needTokuteiH + ')');
  Logger.log('サビ管: ' + r.sabikanRate.toFixed(1) + '% (80 / ' + r.needSabikanH + ')');
  Logger.log('管理者: ' + r.kanrishaRate.toFixed(1) + '% (160 / ' + r.needKanrishaH + ')');
  Logger.log('看護師: ' + r.nurseRate.toFixed(1) + '% (2 / ' + r.nurseRequired + ')');
  
  Logger.log('');
  Logger.log('=== 完了 ===');
}

// ============================================================
// pickFacilityForSlot: 配置時にスタッフの希望施設から1つ選ぶ
//   優先順位: メイン > セカンド > サブ
//   slot.jigyosho 配下の施設のみ対象
function pickFacilityForSlot(staff, slot, ctx) {
  const candidates = [staff.mainFac, staff.secondFac].concat(staff.subFacs || []).filter(Boolean);
  for (let i = 0; i < candidates.length; i++) {
    const f = candidates[i];
    const jigs = ctx.facilityToJigyoshos[f] || [];
    if (jigs.indexOf(slot.jigyosho) !== -1) return f;
  }
  return '';
}

// ============================================================
// _v2d_processSlotsForPriority: 1パス分のslot処理 (内部関数)
// priorityLevel = 1(メイン), 2(セカンド), 3(サブ)
// 戻り値: { assigned, warningBlock, warningOnly }
// ★Day10新規: メイン優先バグ修正のための3パス方式の中核
// ============================================================
function _v2d_processSlotsForPriority(ctx, priorityLevel, counters) {
  for (let si = 0; si < ctx.slots.length; si++) {
    const slot = ctx.slots[si];
    if (slot.assignment) continue;  // 前のパスで配置済みは飛ばす
    
    // 不足職種を毎回再計算 (動的加点)
    const shortage = calcRoleShortage(ctx);
    
    // 候補抽出 (priorityLevel に応じてフィルタ)
    const candidates = findCandidatesV2(ctx, slot, priorityLevel);
    if (candidates.length === 0) continue;
    
    // 各候補のスコア + 警告判定
    candidates.forEach(function(c) {
      c.score = calcScoreV2(ctx, c.staff, c.wish, slot, shortage);
      c.warnings = checkAllWarningsV2(c.staff, slot, ctx);
    });
    
    // ソート: VIP > 警告blockなし > スコア降順
    candidates.sort(function(a, b) {
      const aVIP = a.staff.isVIP ? 1 : 0;
      const bVIP = b.staff.isVIP ? 1 : 0;
      if (aVIP !== bVIP) return bVIP - aVIP;
      const aBlock = a.warnings.some(function(w) { return w.level === WARNING_LEVEL.BLOCK; }) ? 1 : 0;
      const bBlock = b.warnings.some(function(w) { return w.level === WARNING_LEVEL.BLOCK; }) ? 1 : 0;
      if (aBlock !== bBlock) return aBlock - bBlock;
      return b.score - a.score;
    });
    
    // 最優先候補を採用
    const top = candidates[0];
    const wh = (typeof SHIFT_PATTERNS !== 'undefined' && SHIFT_PATTERNS[slot.shift])
      ? (SHIFT_PATTERNS[slot.shift].dayHours + SHIFT_PATTERNS[slot.shift].nightHours)
      : 8;
    
    const hasBlock = top.warnings.some(function(w) { return w.level === WARNING_LEVEL.BLOCK; });
    const reason = hasBlock ? '警告あり配置(承認待ち)' : '通常配置';
    
    const pickedFac = pickFacilityForSlot(top.staff, slot, ctx);
    
    // 配置時に役割を自動選択 (Phase 6: shortage動的更新版)
    // shortageは配置毎に更新されてるので、最新の不足状態に基づいて選択
    const assignedRole = (typeof pickAssignedRole === 'function')
      ? pickAssignedRole(top.staff, shortage[slot.jigyosho])
      : '';
    
    slot.assignment = {
      staff_id: top.staff.staff_id,
      staff_name: top.staff.name,
      shift: slot.shift,
      facility: pickedFac,
      score: top.score,
      warnings: top.warnings,
      reason: reason,
      assignedRole: assignedRole,
      priorityLevel: priorityLevel  // ★Day10: どのパスで配置されたか記録
    };
    // ★Day11: E-st配置時はバランスキャッシュ更新
    // ★Day11 Phase4修正: facilityは実体施設(カッコ付き)なので前方一致で判定
    if (_isEstRealFacility(slot.assignment.facility)
        && DSE_V2.SCORE.EST_JIGYOSHOS.indexOf(slot.jigyosho) !== -1) {
      ctx.estLastJigyoshoByStaff[slot.assignment.staff_id] = slot.jigyosho;
    }
    
    // ctx.staffAssignedDates に反映
    if (!ctx.staffAssignedDates[top.staff.staff_id][slot.dateKey]) {
      ctx.staffAssignedDates[top.staff.staff_id][slot.dateKey] = [];
    }
    ctx.staffAssignedDates[top.staff.staff_id][slot.dateKey].push({
      shift: slot.shift,
      jigyosho: slot.jigyosho,
      facility: pickedFac,
      unit: '',
      workHours: wh,
      isNight: false,
      isDay: true,
      assignedRole: assignedRole
    });
    ctx.monthlyAssign[top.staff.staff_id] = (ctx.monthlyAssign[top.staff.staff_id] || 0) + 1;
    if (typeof _v_incrementFreqCounters === 'function') _v_incrementFreqCounters(ctx, top.staff.staff_id, slot.dateKey);
    
    // ★Phase 6: shortage は毎ループ calcRoleShortage(ctx) で再計算されるので動的更新不要
    // calcRoleShortage が ctx.staffAssignedDates + assignedRole を参照する形に修正済み
    
    counters.assigned++;
    
    // 警告レコードをバッファ
    top.warnings.forEach(function(w) {
      ctx.pendingWarnings.push({
        shiftKind: 'day',
        targetYm: ctx.targetYM,
        date: slot.dateKey,
        jigyosho: slot.jigyosho,
        facility: '',
        unit: '',
        staffId: top.staff.staff_id,
        staffName: top.staff.name,
        ruleId: w.ruleId,
        level: w.level,
        message: w.message
      });
      if (w.level === WARNING_LEVEL.BLOCK) counters.warningBlock++;
      else counters.warningOnly++;
    });
  }
}

// ============================================================
// Step 4.5: assignByScoreV2 配置メインロジック
// ★Day10改修: 3パス方式 (メイン > セカンド > サブ の優先順位を保証)
// ============================================================
function assignByScoreV2(ctx) {
  Logger.log('assignByScoreV2: 配置開始 (' + ctx.slots.length + 'スロット, 3パス方式)');
  
  ctx.pendingWarnings = [];
  const counters = {
    assigned: 0,
    warningBlock: 0,
    warningOnly: 0
  };
  
  // Pass 1: メイン施設マッチのスタッフのみ配置
  Logger.log('  [Pass 1] メイン優先パス開始');
  const beforeP1 = counters.assigned;
  _v2d_processSlotsForPriority(ctx, 1, counters);
  Logger.log('  [Pass 1] 配置: ' + (counters.assigned - beforeP1) + 'スロット');
  
  // Pass 2: セカンド施設マッチのスタッフのみ配置 (Pass 1で未配置のslot)
  Logger.log('  [Pass 2] セカンド優先パス開始');
  const beforeP2 = counters.assigned;
  _v2d_processSlotsForPriority(ctx, 2, counters);
  Logger.log('  [Pass 2] 配置: ' + (counters.assigned - beforeP2) + 'スロット');
  
  // Pass 3: サブ施設マッチのスタッフのみ配置 (Pass 1/2で未配置のslot)
  Logger.log('  [Pass 3] サブ優先パス開始');
  const beforeP3 = counters.assigned;
  _v2d_processSlotsForPriority(ctx, 3, counters);
  Logger.log('  [Pass 3] 配置: ' + (counters.assigned - beforeP3) + 'スロット');
  
  // 集計
  let assignedCount = counters.assigned;
  let warningBlockCount = counters.warningBlock;
  let warningOnlyCount = counters.warningOnly;
  let unassignedCount = ctx.slots.length - assignedCount;
  
  Logger.log('assignByScoreV2: 配置完了');
  Logger.log('  配置済み: ' + assignedCount + 'スロット');
  Logger.log('  警告(block): ' + warningBlockCount + '件');
  Logger.log('  警告(only): ' + warningOnlyCount + '件');
  Logger.log('  未配置: ' + unassignedCount + 'スロット');
  
  return {
    assignedCount: assignedCount,
    warningBlockCount: warningBlockCount,
    warningOnlyCount: warningOnlyCount,
    unassignedCount: unassignedCount
  };
}

// ============================================================
// テスト関数: ダミー希望投入で動作確認
// ============================================================
function testAssignByScoreV2() {
  Logger.log('=== Step 4.5 assignByScoreV2 動作確認 ===');
  const ym = '2026-05';
  const ctx = loadEngineContextV2(ym);
  generateSlotsV2(ctx);
  
  // ダミー希望: 既存スタッフの先頭10名に 5/1〜5/5 の早出8h希望を投入
  const staffIds = Object.keys(ctx.staffMap).slice(0, 10);
  Logger.log('ダミー希望投入対象スタッフ: ' + staffIds.length + '名');
  
  let dummyWishCount = 0;
  for (let day = 1; day <= 5; day++) {
    const dateKey = '2026-05-' + String(day).padStart(2, '0');
    const date = new Date(dateKey + 'T00:00:00');
    
    staffIds.forEach(function(sid) {
      const staff = ctx.staffMap[sid];
      
      // ★テスト用: allowedShifts と mainFac を強制設定
      if (staff.allowedShifts.indexOf('早出8h') === -1) {
        staff.allowedShifts.push('早出8h');
      }
      const targetJig = (staff.mainFac && staff.mainFac.indexOf('GH') === 0) ? staff.mainFac : 'GHコノヒカラ';
      staff.mainFac = targetJig;
      
      const wish = {
        requestId: 'DUMMY-' + sid + '-' + dateKey,
        staff_id: sid,
        name: staff.name,
        date: date,
        dateKey: dateKey,
        shift: '早出8h',
        isNight: false,
        isDay: true,
        mainFac: targetJig,
        secondFac: staff.secondFac,
        subFacs: staff.subFacs,
        comment: '',
      };
      ctx.wishes.push(wish);
      if (!ctx.wishesByStaff[sid]) ctx.wishesByStaff[sid] = [];
      ctx.wishesByStaff[sid].push(wish);
      const sdKey = sid + '_' + dateKey;
      if (!ctx.wishesByStaffDay[sdKey]) ctx.wishesByStaffDay[sdKey] = [];
      ctx.wishesByStaffDay[sdKey].push(wish);
      const dsKey = dateKey + '_早出8h';
      if (!ctx.wishesByDayShift[dsKey]) ctx.wishesByDayShift[dsKey] = [];
      ctx.wishesByDayShift[dsKey].push(wish);
      dummyWishCount++;
    });
  }
  Logger.log('ダミー希望投入: ' + dummyWishCount + '件');
  
  if (dummyWishCount === 0) {
    Logger.log('⚠ 投入できる希望がない (allowedShifts未設定の可能性)');
    Logger.log('=== 中断 ===');
    return;
  }
  
  // 配置実行
  Logger.log('');
  Logger.log('--- 配置実行 ---');
  const startTs = Date.now();
  const result = assignByScoreV2(ctx);
  const elapsed = ((Date.now() - startTs) / 1000).toFixed(2);
  Logger.log('処理時間: ' + elapsed + '秒');
  
  // 結果サマリー
  let withWarning = 0, withoutWarning = 0;
  ctx.slots.forEach(function(s) {
    if (s.assignment) {
      if (s.assignment.warnings.length > 0) withWarning++;
      else withoutWarning++;
    }
  });
  Logger.log('警告なし配置: ' + withoutWarning);
  Logger.log('警告あり配置: ' + withWarning);
  
  // 配置サンプル (5件)
  Logger.log('');
  Logger.log('--- 配置サンプル ---');
  let shown = 0;
  for (const slot of ctx.slots) {
    if (slot.assignment && shown < 5) {
      const a = slot.assignment;
      Logger.log(slot.dateKey + ' / ' + slot.jigyosho + ' / ' + slot.shift +
                 ' → ' + a.staff_name + ' (score=' + a.score + ', warnings=' + a.warnings.length + ')');
      shown++;
    }
  }
  
  // 警告サンプル
  if (ctx.pendingWarnings.length > 0) {
    Logger.log('');
    Logger.log('--- 警告サンプル (先頭3件) ---');
    ctx.pendingWarnings.slice(0, 3).forEach(function(w) {
      Logger.log(w.rule_id + ' (' + w.level + ') / ' + w.date + ' / ' + w.staff_name + ': ' + w.message);
    });
  }
  
  Logger.log('');
  Logger.log('=== 完了 ===');
}

// ============================================================
// Step 4.6: writeShiftResultsV2 + メインエントリ
// ============================================================

// ============================================================
// writeShiftResultsV2: T_シフト確定 + V_警告チェック への書き込み
// インクリメンタル: 対象月の既存日勤レコード(早出/遅出)を削除→新規挿入
// 夜勤レコードは保持
// ============================================================
function writeShiftResultsV2(ctx) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(DSE_V2.SHEET_NAME_CONF);
  if (!sheet) throw new Error('T_シフト確定シートが見つからない');
  
  Logger.log('writeShiftResultsV2: 書き込み開始');
  
  // 1. 対象月の既存日勤レコードを削除 (夜勤データは残す)
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const allData = sheet.getRange(2, 1, lastRow - 1, 19).getValues();
    const rowsToDelete = [];
    for (let i = 0; i < allData.length; i++) {
      // ymは日付列(B列=index 1)から取得 (C列はunit_idでyear_monthではない)
      const dateVal = allData[i][1];
      let ym = '';
      if (dateVal instanceof Date) {
        ym = Utilities.formatDate(dateVal, 'Asia/Tokyo', 'yyyy-MM');
      } else {
        ym = _v2d_normYm(allData[i][DSE_V2.COL_CONF_YM]);  // フォールバック
      }
      const shift = String(allData[i][DSE_V2.COL_CONF_SHIFT] || '').trim();
      const shiftId = String(allData[i][0] || '');
      // 対象月 かつ 日勤シフト かつ 固定配置でない (★Phase 7: 固定配置は保護)
      if (ym === ctx.targetYM && DSE_V2.DAY_SHIFTS.indexOf(shift) !== -1 && shiftId.indexOf('FIXED_') !== 0) {
        rowsToDelete.push(i + 2);
      }
    }
    rowsToDelete.reverse().forEach(function(rowNum) {
      sheet.deleteRow(rowNum);
    });
    Logger.log('  既存日勤レコード削除: ' + rowsToDelete.length + '件');
  }
  
  // 2. 配置結果を T_シフト確定 に書き込み
  const newRows = [];
  const now = new Date();
  let placedCount = 0;
  
  for (const slot of ctx.slots) {
    if (!slot.assignment) continue;
    const a = slot.assignment;
    const shiftPat = (typeof SHIFT_PATTERNS !== 'undefined' && SHIFT_PATTERNS[slot.shift])
      ? SHIFT_PATTERNS[slot.shift]
      : { start: '', end: '', dayHours: 8, nightHours: 0 };
    
    const requestId = 'DSE-V2-' + ctx.targetYM + '-' + slot.jigyosho + '-' + slot.dateKey + '-' + slot.shift;
    const hasBlock = a.warnings.some(function(w) { return w.level === WARNING_LEVEL.BLOCK; });
    const status = hasBlock ? '警告承認待ち' : '仮';
    
    // T_シフト確定 19列構造 (シート実体に合わせる、夜勤と統一)
    // ヘッダー: shift_id / 日付 / unit_id / 事業所名 / 施設名 / ユニット名 / staff_id / 氏名
    //          / シフト種別 / 開始時刻 / 終了時刻 / 配置カウント / ステータス / 更新日時
    //          / 実開始時刻 / 実終了時刻 / 夜勤換算時間 / 日勤換算時間 / 割当役割
    // 日勤はユニット単位ではなく事業所単位なので unit_id/ユニット名は空
    const row = [
      requestId,                  // [0] shift_id
      slot.date,                  // [1] 日付
      '',                         // [2] unit_id (日勤は空)
      slot.jigyosho,              // [3] 事業所名
      a.facility || '',           // [4] 施設名 (pickFacilityForSlotで決定済)
      '',                         // [5] ユニット名 (日勤は空)
      a.staff_id,                 // [6] staff_id
      a.staff_name,               // [7] 氏名
      slot.shift,                 // [8] シフト種別
      shiftPat.start,             // [9] 開始時刻
      shiftPat.end,               // [10] 終了時刻
      a.reason,                   // [11] 配置カウント
      status,                     // [12] ステータス
      now,                        // [13] 更新日時
      shiftPat.start,             // [14] 実開始時刻
      shiftPat.end,               // [15] 実終了時刻
      shiftPat.nightHours,        // [16] 夜勤換算時間
      shiftPat.dayHours,          // [17] 日勤換算時間
      a.assignedRole || '',       // [18] 割当役割 ★Day10新規
    ];
    newRows.push(row);
    placedCount++;
  }
  
  if (newRows.length > 0) {
    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, newRows.length, 19).setValues(newRows);
    Logger.log('  新規日勤レコード書き込み: ' + newRows.length + '件');
  }
  
  // 3. 既存の警告レコード (対象月+日勤) を削除
  if (typeof deleteWarningsForMonth === 'function') {
    const deletedCount = deleteWarningsForMonth(ctx.targetYM, 'day');
    Logger.log('  既存日勤警告レコード削除: ' + deletedCount + '件');
  }
  
  // 4. 新規警告レコードを書き込み
  let warningCount = 0;
  if (ctx.pendingWarnings && ctx.pendingWarnings.length > 0) {
    if (typeof addWarning !== 'function') {
      throw new Error('addWarning 関数が見つからない (warning_system.js が必要)');
    }
    for (const w of ctx.pendingWarnings) {
      addWarning(w);
      warningCount++;
    }
    Logger.log('  新規警告レコード書き込み: ' + warningCount + '件');
  }
  
  return {
    placedCount: placedCount,
    warningCount: warningCount
  };
}

// ============================================================
// runDayShiftEngineV2: メインエントリ
// 引数: targetYM (e.g. "2026-05")
// ============================================================
function runDayShiftEngineV2(targetYM) {
  const overallStart = Date.now();
  Logger.log('===== runDayShiftEngineV2 開始: ' + targetYM + ' =====');
  
  // ★Phase 7: 固定配置を先取り書込 (自動配置エンジンより前)
  if (typeof preplaceFixedAssignments === 'function') {
    try {
      const fixedResult = preplaceFixedAssignments(targetYM);
      Logger.log('[Phase 7] 固定配置先取り: ' + JSON.stringify(fixedResult));
    } catch (e) {
      Logger.log('[Phase 7] 固定配置先取りエラー: ' + e + ' (続行)');
    }
  }
  
  // 1. ctx 構築
  Logger.log('[1/5] ctx構築...');
  const ctx = loadEngineContextV2(targetYM);
  Logger.log('  ユニット: ' + ctx.units.length + ' / スタッフ: ' + Object.keys(ctx.staffMap).length + ' / 希望: ' + ctx.wishes.length);
  Logger.log('  事業所配置基準: ' + Object.keys(ctx.facilityBasis).length + '事業所');
  
  // 2. スロット生成
  Logger.log('[2/5] スロット生成...');
  generateSlotsV2(ctx);
  Logger.log('  スロット: ' + ctx.slots.length);
  
  // 3. 配置実行
  Logger.log('[3/5] 配置実行...');
  const result = assignByScoreV2(ctx);
  
  // 4. 役割別時間集計 (確認用)
  Logger.log('[4/5] 充足率計算...');
  const roleHours = calcRoleHoursV2(ctx);
  Object.keys(roleHours).forEach(function(jig) {
    const r = roleHours[jig];
    Logger.log('  ' + jig + ': 世話人=' + r.sewaRate.toFixed(0) + '% / 生活=' + r.seikatsuRate.toFixed(0) + '% / 特定=' + r.tokuteiRate.toFixed(0) + '% / サビ管=' + r.sabikanRate.toFixed(0) + '% / 管理者=' + r.kanrishaRate.toFixed(0) + '% / 看護師=' + r.nurseRate.toFixed(0) + '%');
  });
  
  // 5. 書き込み
  Logger.log('[5/5] 書き込み...');
  const writeResult = writeShiftResultsV2(ctx);
  
  const elapsed = ((Date.now() - overallStart) / 1000).toFixed(2);
  Logger.log('===== 完了: ' + elapsed + '秒 =====');
  Logger.log('配置: ' + writeResult.placedCount + '件 / 警告: ' + writeResult.warningCount + '件 / 未配置: ' + result.unassignedCount + 'スロット');
  
  return {
    targetYM: targetYM,
    elapsed: elapsed,
    placedCount: writeResult.placedCount,
    warningBlockCount: result.warningBlockCount,
    warningOnlyCount: result.warningOnlyCount,
    unassignedCount: result.unassignedCount,
    roleHours: roleHours
  };
}

// ============================================================
// テスト用エントリ (実データ書き込みあり)
// ============================================================
function testRunDayShiftEngineV2() {
  Logger.log('=== Step 4.6 メインエントリ動作確認 ===');
  Logger.log('注意: T_シフト確定 + V_警告チェック に実データ書き込みします (対象月=2026-05)');
  Logger.log('');
  const result = runDayShiftEngineV2('2026-05');
  Logger.log('');
  Logger.log('結果: ' + JSON.stringify(result, null, 2));
}

function debug_inspect_staff_template() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('M_スタッフ');
  const data = sheet.getDataRange().getValues();
  
  Logger.log('=== M_スタッフ ヘッダー (1行目) ===');
  Logger.log(JSON.stringify(data[0]));
  
  Logger.log('');
  Logger.log('=== 列番号と内容 ===');
  data[0].forEach(function(h, i) {
    Logger.log('  col[' + i + '] (' + String.fromCharCode(65+i) + '列): ' + h);
  });
  
  Logger.log('');
  Logger.log('=== staff_id=312 のレコード (テンプレ) ===');
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === '312') {
      data[i].forEach(function(v, idx) {
        Logger.log('  ' + String.fromCharCode(65+idx) + '列: ' + JSON.stringify(v));
      });
      break;
    }
  }
  
  Logger.log('');
  Logger.log('=== 最終行番号 ===');
  Logger.log('  最終行: ' + sheet.getLastRow());
  Logger.log('  列数: ' + data[0].length);
}
function debug_real_assign_with_log() {
  const ctx = loadEngineContextV2('2026-06');
  generateSlotsV2(ctx);
  
  let traceCount = 0;
  let errCount = 0;
  
  for (let si = 0; si < ctx.slots.length; si++) {
    const slot = ctx.slots[si];
    if (slot.assignment) continue;
    
    let shortage, candidates;
    try {
      shortage = calcRoleShortage(ctx);
    } catch (e) {
      Logger.log('!!! calcRoleShortage error si=' + si + ': ' + e);
      errCount++;
      if (errCount > 3) break;
      continue;
    }
    
    try {
      candidates = findCandidatesV2(ctx, slot);
    } catch (e) {
      Logger.log('!!! findCandidatesV2 error si=' + si + ': ' + e);
      errCount++;
      if (errCount > 3) break;
      continue;
    }
    
    if (candidates.length === 0) continue;
    
    if (traceCount < 3) {
      Logger.log('si=' + si + ' ' + slot.dateKey + '/' + slot.jigyosho + '/' + slot.shift + ' 候補=' + candidates.length);
    }
    
    try {
      candidates.forEach(function(c) {
        c.score = calcScoreV2(ctx, c.staff, c.wish, slot, shortage);
      });
      if (traceCount < 3) Logger.log('  calcScoreV2 OK');
    } catch (e) {
      Logger.log('!!! calcScoreV2 error si=' + si + ': ' + e);
      errCount++;
      if (errCount > 3) break;
      continue;
    }
    
    try {
      candidates.forEach(function(c) {
        c.warnings = checkAllWarningsV2(c.staff, slot, ctx);
      });
      if (traceCount < 3) Logger.log('  checkAllWarningsV2 OK');
    } catch (e) {
      Logger.log('!!! checkAllWarningsV2 error si=' + si + ': ' + e);
      errCount++;
      if (errCount > 3) break;
      continue;
    }
    
    traceCount++;
    if (traceCount > 5) break;
  }
  
  Logger.log('=== 結果 ===');
  Logger.log('処理スロット: ' + traceCount);
  Logger.log('エラー回数: ' + errCount);
}
function debug_call_run_full() {
  Logger.log('=== runDayShiftEngineV2 直接呼び出し ===');
  const result = runDayShiftEngineV2('2026-06');
  Logger.log('');
  Logger.log('=== 結果 ===');
  Logger.log(JSON.stringify(result, null, 2));
}
function debug_check_t_shift_2026_06_v2() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('T_シフト確定');
  const data = sheet.getDataRange().getValues();
  
  let dayCount = 0;
  let nightCount = 0;
  const byStaff = {};
  const byShift = {};
  
  for (let i = 1; i < data.length; i++) {
    const date = data[i][1];
    if (!(date instanceof Date)) continue;
    const ym = Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy-MM');
    if (ym !== '2026-06') continue;
    
    const staffId = String(data[i][6] || '');
    const shift = String(data[i][8] || '');
    
    if (shift.indexOf('夜勤') !== -1) nightCount++;
    else dayCount++;
    
    byStaff[staffId] = (byStaff[staffId] || 0) + 1;
    byShift[shift] = (byShift[shift] || 0) + 1;
  }
  
  Logger.log('=== 2026-06 集計 ===');
  Logger.log('日勤: ' + dayCount + '件 / 夜勤: ' + nightCount + '件 / 合計: ' + (dayCount + nightCount));
  
  Logger.log('');
  Logger.log('=== シフト別 ===');
  Object.keys(byShift).sort().forEach(function(s) {
    Logger.log('  ' + s + ': ' + byShift[s] + '件');
  });
  
  Logger.log('');
  Logger.log('=== スタッフ別 ===');
  Object.keys(byStaff).sort(function(a, b) { return byStaff[b] - byStaff[a]; }).forEach(function(sid) {
    Logger.log('  staff_id=' + sid + ': ' + byStaff[sid] + '件');
  });
  
  Logger.log('');
  Logger.log('=== 901の配置詳細 ===');
  for (let i = 1; i < data.length; i++) {
    const date = data[i][1];
    if (!(date instanceof Date)) continue;
    const ym = Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy-MM');
    if (ym !== '2026-06') continue;
    if (String(data[i][6]) !== '901') continue;
    const dateStr = Utilities.formatDate(date, 'Asia/Tokyo', 'MM/dd');
    Logger.log('  ' + dateStr + ' ' + data[i][8] + ' @' + data[i][3] + '/' + data[i][4]);
  }
}
function debug_call_calendar_api() {
  const result = getDayShiftCalendarData('13', '2026-06');
  Logger.log('=== getDayShiftCalendarData 結果 ===');
  Logger.log('success: ' + result.success);
  if (!result.success) {
    Logger.log('エラー: ' + result.message);
    return;
  }
  
  Logger.log('yearMonth: ' + result.yearMonth);
  Logger.log('days: ' + result.days.length);
  Logger.log('calendar 事業所数: ' + result.calendar.length);
  Logger.log('warnings: ' + result.warnings.length);
  
  Logger.log('');
  result.calendar.forEach(function(jig) {
    Logger.log('--- ' + jig.jigyosho + ' (定員' + jig.capacity + ') ---');
    Logger.log('  施設数: ' + jig.buildings.length);
    jig.buildings.forEach(function(b) {
      let total = 0;
      b.cells.forEach(function(c) { total += c.count; });
      Logger.log('    ' + b.facility + ': 配置総数=' + total);
    });
  });
}
function debug_score_step_by_step() {
  const ctx = loadEngineContextV2('2026-06');
  generateSlotsV2(ctx);
  const shortage = calcRoleShortage(ctx);
  
  const slot = ctx.slotsByKey['2026-06-08_GHコノヒカラ_早出8h'];
  const dsKey = '2026-06-08_早出8h';
  const wish = ctx.wishesByDayShift[dsKey].filter(function(w) { return w.staff_id === '901'; })[0];
  const staff = ctx.staffMap['901'];
  
  let score = 0;
  const fac = slot.jigyosho;
  Logger.log('slot.jigyosho=' + fac);
  Logger.log('staff.mainFac=' + staff.mainFac);
  
  const _mainJigs = ctx.facilityToJigyoshos[staff.mainFac] || [];
  Logger.log('_mainJigs=' + JSON.stringify(_mainJigs));
  Logger.log('_mainJigs.indexOf(fac)=' + _mainJigs.indexOf(fac));
  
  if (_mainJigs.indexOf(fac) !== -1) {
    score += DSE_V2.SCORE.MAIN_FAC;
    Logger.log('+MAIN_FAC=' + DSE_V2.SCORE.MAIN_FAC + ' → score=' + score);
  } else {
    Logger.log('MAIN_FAC 加点なし');
  }
  
  if (staff.qualification) {
    score += DSE_V2.SCORE.QUALIFIED;
    Logger.log('+QUALIFIED → score=' + score);
  }
  
  if (staff.employment === '正社員') {
    score += DSE_V2.SCORE.FULL_TIME;
    Logger.log('+FULL_TIME=' + DSE_V2.SCORE.FULL_TIME + ' → score=' + score);
  }
  
  const monthScore = (staff.hireMonths || 0) * DSE_V2.SCORE.MONTH_X;
  score += monthScore;
  Logger.log('+MONTH (' + staff.hireMonths + '×' + DSE_V2.SCORE.MONTH_X + '=' + monthScore + ') → score=' + score);
  
  Logger.log('shortage[fac]=' + JSON.stringify(shortage[fac]));
  if (shortage && shortage[fac]) {
    const sh = shortage[fac];
    if (sh.sewa && staff.isSewa) {
      score += DSE_V2.SCORE.ROLE_SHORT_SEWA;
      Logger.log('+ROLE_SHORT_SEWA=' + DSE_V2.SCORE.ROLE_SHORT_SEWA + ' → score=' + score);
    }
  }
  
  Logger.log('');
  Logger.log('最終: ' + score);
  Logger.log('calcScoreV2()=' + calcScoreV2(ctx, staff, wish, slot, shortage));
}

function debug_check_night_e_col() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('T_シフト確定');
  const data = sheet.getDataRange().getValues();
  
  let nightCount = 0;
  let withFac = 0;
  let withoutFac = 0;
  let withUnit = 0;
  let withoutUnit = 0;
  const samples = [];
  
  for (let i = 1; i < data.length; i++) {
    const date = data[i][1];
    if (!(date instanceof Date)) continue;
    const ym = Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy-MM');
    if (ym !== '2026-06') continue;
    
    const shift = String(data[i][8] || '');
    if (shift.indexOf('夜勤') === -1) continue;
    
    nightCount++;
    const fac = String(data[i][4] || '').trim();
    const unit = String(data[i][5] || '').trim();
    if (fac) withFac++; else withoutFac++;
    if (unit) withUnit++; else withoutUnit++;
    
    if (samples.length < 5) {
      samples.push({
        date: Utilities.formatDate(date, 'Asia/Tokyo', 'MM/dd'),
        jig: data[i][3],
        fac: fac,
        unit: unit,
        shift: shift,
        staff: data[i][7]
      });
    }
  }
  
  Logger.log('=== 2026-06 夜勤レコードの E/F列 ===');
  Logger.log('合計: ' + nightCount);
  Logger.log('施設名(E列)あり: ' + withFac + ' / なし: ' + withoutFac);
  Logger.log('ユニット名(F列)あり: ' + withUnit + ' / なし: ' + withoutUnit);
  Logger.log('');
  Logger.log('=== サンプル ===');
  samples.forEach(function(s) {
    Logger.log('  ' + s.date + ' ' + s.shift + ' @' + s.jig + ' / 施設="' + s.fac + '" / ユニット="' + s.unit + '" / ' + s.staff);
  });
}

function debug_scan_nurse_in_t_column() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('M_スタッフ');
  if (!sheet) { Logger.log('M_スタッフ シートが見つからない'); return; }
  
  const data = sheet.getDataRange().getValues();
  const violators = [];
  
  for (let i = 1; i < data.length; i++) {
    const staffId = data[i][0];
    const name = data[i][1];
    const qualification = String(data[i][5] || '');  // F列(0-indexed=5)
    const mainRolesRaw = String(data[i][19] || '');  // T列(0-indexed=19)
    const mainRoles = mainRolesRaw.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
    
    if (mainRoles.indexOf('看護師') !== -1) {
      violators.push({
        row: i + 1,
        staffId: staffId,
        name: name,
        qualification: qualification,
        mainRolesRaw: mainRolesRaw,
        otherRoles: mainRoles.filter(function(r) { return r !== '看護師'; })
      });
    }
  }
  
  Logger.log('=== T列に「看護師」が入ってるスタッフ ===');
  Logger.log('該当: ' + violators.length + '件');
  Logger.log('');
  violators.forEach(function(v) {
    Logger.log('行' + v.row + ': ' + v.staffId + '(' + v.name + ')');
    Logger.log('  T列現状: ' + v.mainRolesRaw);
    Logger.log('  F列(資格): ' + v.qualification);
    if (v.otherRoles.length === 0) {
      Logger.log('  → ⚠️ 看護師のみ。世話人 or 生活支援員 に変更必要');
    } else {
      Logger.log('  → 「看護師」削除すれば: ' + v.otherRoles.join(','));
    }
    Logger.log('');
  });
}
