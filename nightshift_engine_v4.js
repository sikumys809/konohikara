// ============================================================
// 夜勤自動配置エンジン v4
// 仕様書: https://app.notion.com/p/352ec81ceecf8179b40fddd3834a2dbc
//
// 旧 v3 / v3_part2 の問題点を全面解決:
// - 関数の二重定義 → 単一ファイル
// - シフト名不整合 (日勤早出 vs 早出8h/4h) → SHIFT_PATTERNS と整合
// - 既存日勤未取込 → T_シフト確定の対象月日勤を ctx に取り込む
// - workHours 未設定 → 配置レコードに含める
// - 警告システム未統合 → warning_system.js 連携
// - 共通制約未活用 → common_constraints.js 利用
// ============================================================

const NSE_V4 = {
  // M_スタッフ列 (0-indexed)
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
  COL_STAFF_MAIN_ROLES: 19,  // ★T列: 主職種 (新規追加)
  
  // M_ユニット列
  COL_UNIT_ID: 0,
  COL_UNIT_JIGYOSHO: 1,
  COL_UNIT_NAME: 2,
  COL_UNIT_FACILITY: 3,
  COL_UNIT_CAPACITY: 4,
  COL_UNIT_ROOM: 5,
  
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
  
  // T_シフト確定 列 (18列構造、setup_dayshift.js準拠)
  // A:request_id / B:date / C:year_month / D:jigyosho / E:facility / F:unit / G:staff_id
  // H:staff_name / I:shift_type / J:start / K:end / L:reason / M:status / N:updated_at
  // O:actual_start / P:actual_end / Q:night_hours / R:day_hours
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
  NIGHT_SHIFTS: ['夜勤A', '夜勤B', '夜勤C'],
  DAY_SHIFTS: ['早出8h', '早出4h', '遅出8h', '遅出4h'],
  ALL_SHIFTS: ['夜勤A', '夜勤B', '夜勤C', '早出8h', '早出4h', '遅出8h', '遅出4h'],
  
  // スコア係数
  SCORE: {
    MAIN_FAC: 30, SECOND_FAC: 20, SUB_FAC: 10,
    QUALIFIED: 10, FULL_TIME: 5,
    MONTH_X: 2, SKILL_X: 3,
    PROTECTED_ZERO: 50, PROTECTED_OTHER: 15,
    NEWBIE1: -30, NEWBIE2: -10,
    CONCENTRATION_X: -5, VIP: 10000,
  },
  
  // エンジン挙動
  HISTORY_MONTHS: 3,
  MAX_CONSECUTIVE: 6,
  WEEKLY_HOUR_LIMIT: 40,
  
  // スプレッドシートID (既存定数を使う前提だが念のため)
  SHEET_NAME_STAFF: 'M_スタッフ',
  SHEET_NAME_UNIT: 'M_ユニット',
  SHEET_NAME_REQ: 'T_希望提出',
  SHEET_NAME_CONF: 'T_シフト確定',
};

// ============================================================
// 内部ヘルパー: yyyy-MM 形式に正規化
// ============================================================
function _v4_normYm(val) {
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    return y + '-' + m;
  }
  return String(val || '').trim();
}

// ============================================================
// 内部ヘルパー: yyyy-MM-dd 形式に正規化
// ============================================================
function _v4_normDate(val) {
  if (val instanceof Date) {
    return Utilities.formatDate(val, 'Asia/Tokyo', 'yyyy-MM-dd');
  }
  return String(val || '').trim();
}

// ============================================================
// loadEngineContextV4: ctx 構築 (v4)
// ============================================================
function loadEngineContextV4(targetYM) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const parts = targetYM.split('-').map(Number);
  const year = parts[0];
  const month = parts[1];
  const daysInMonth = new Date(year, month, 0).getDate();
  
  const ctx = {
    targetYM: targetYM,
    year: year,
    month: month,
    daysInMonth: daysInMonth,
    units: [],
    unitsByFacility: {},
    staffMap: {},
    wishes: [],
    wishesByStaff: {},
    wishesByStaffDay: {},
    wishesByDayShift: {},
    history3m: {},
    historyCount: 0,
    monthlyAssign: {},
    staffAssignedDates: {},  // {staffId: {dateKey: [{shift, jigyosho, facility, unit, workHours}]}}
    slots: [],
    slotsByKey: {},
  };
  
  // 1. M_ユニット
  const unitSheet = ss.getSheetByName(NSE_V4.SHEET_NAME_UNIT);
  if (!unitSheet) throw new Error('M_ユニットシートが見つからない');
  const unitData = unitSheet.getDataRange().getValues();
  for (let i = 1; i < unitData.length; i++) {
    if (!unitData[i][NSE_V4.COL_UNIT_ID]) continue;
    const unit = {
      unit_id: unitData[i][NSE_V4.COL_UNIT_ID],
      jigyosho: String(unitData[i][NSE_V4.COL_UNIT_JIGYOSHO] || '').trim(),
      unit_name: String(unitData[i][NSE_V4.COL_UNIT_NAME] || '').trim(),
      facility: String(unitData[i][NSE_V4.COL_UNIT_FACILITY] || '').trim(),
      capacity: Number(unitData[i][NSE_V4.COL_UNIT_CAPACITY]) || 0,
      room: String(unitData[i][NSE_V4.COL_UNIT_ROOM] || '').trim(),
    };
    ctx.units.push(unit);
    if (!ctx.unitsByFacility[unit.facility]) ctx.unitsByFacility[unit.facility] = [];
    ctx.unitsByFacility[unit.facility].push(unit);
  }
  
  // 2. M_スタッフ (T列の主職種を含む)
  const staffSheet = ss.getSheetByName(NSE_V4.SHEET_NAME_STAFF);
  if (!staffSheet) throw new Error('M_スタッフシートが見つからない');
  const staffData = staffSheet.getRange(2, 1, staffSheet.getLastRow() - 1, 20).getValues();
  staffData.forEach(function(row) {
    if (!row[NSE_V4.COL_STAFF_ID]) return;
    if (String(row[NSE_V4.COL_STAFF_RETIRED]).toUpperCase() === 'TRUE') return;
    
    const staffId = String(row[NSE_V4.COL_STAFF_ID]).trim();
    const allowedRaw = String(row[NSE_V4.COL_STAFF_ALLOWED] || '');
    const subRaw = String(row[NSE_V4.COL_STAFF_SUB] || '');
    const mainRolesRaw = String(row[NSE_V4.COL_STAFF_MAIN_ROLES] || '');
    const kubun = String(row[NSE_V4.COL_STAFF_KUBUN] || '').trim();
    
    ctx.staffMap[staffId] = {
      staff_id: staffId,
      name: row[NSE_V4.COL_STAFF_NAME],
      employment: String(row[NSE_V4.COL_STAFF_EMPLOYMENT] || '').trim(),
      qualification: String(row[NSE_V4.COL_STAFF_QUALIFICATION] || '').trim(),
      hireMonths: Number(row[NSE_V4.COL_STAFF_HIRE_MONTHS]) || 0,
      kubun: kubun,
      mainFac: String(row[NSE_V4.COL_STAFF_MAIN] || '').trim(),
      secondFac: String(row[NSE_V4.COL_STAFF_SECOND] || '').trim(),
      subFacs: subRaw ? subRaw.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [],
      shiftKubun: String(row[NSE_V4.COL_STAFF_SHIFT_KUBUN] || '').trim(),
      allowedShifts: allowedRaw ? allowedRaw.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [],
      isProtected: String(row[NSE_V4.COL_STAFF_PROTECTED]).toUpperCase() === 'TRUE',
      isVIP: String(row[NSE_V4.COL_STAFF_VIP]).toUpperCase() === 'TRUE',
      isNewbie1: kubun === '新人1ヶ月',
      isNewbie2: kubun === '新人2ヶ月',
      mainRoles: mainRolesRaw ? mainRolesRaw.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [],
      isNurse: String(row[NSE_V4.COL_STAFF_QUALIFICATION] || '').indexOf('看護師') !== -1,
    };
    ctx.monthlyAssign[staffId] = 0;
    ctx.staffAssignedDates[staffId] = {};
  });
  
  // 3. T_希望提出 (対象月のみ、全シフトタイプ取り込み)
  const reqSheet = ss.getSheetByName(NSE_V4.SHEET_NAME_REQ);
  if (reqSheet && reqSheet.getLastRow() > 1) {
    const reqData = reqSheet.getDataRange().getValues();
    for (let i = 1; i < reqData.length; i++) {
      const row = reqData[i];
      if (!row[NSE_V4.COL_REQ_ID]) continue;
      
      const ym = _v4_normYm(row[NSE_V4.COL_REQ_YM]);
      if (ym !== targetYM) continue;
      
      const staffId = String(row[NSE_V4.COL_REQ_STAFF_ID]).trim();
      if (!ctx.staffMap[staffId]) continue;
      
      const date = row[NSE_V4.COL_REQ_DATE];
      if (!(date instanceof Date)) continue;
      const dateKey = _v4_normDate(date);
      
      const shift = String(row[NSE_V4.COL_REQ_SHIFT] || '').trim();
      // ★ v4: 全シフトタイプ取り込み (旧v3は NSE.SHIFT_TIMES 未定義でスキップしてた)
      if (NSE_V4.ALL_SHIFTS.indexOf(shift) === -1) continue;
      
      const subRaw = String(row[NSE_V4.COL_REQ_SUB] || '');
      const wish = {
        requestId: row[NSE_V4.COL_REQ_ID],
        staff_id: staffId,
        name: row[NSE_V4.COL_REQ_NAME],
        date: date,
        dateKey: dateKey,
        shift: shift,
        isNight: NSE_V4.NIGHT_SHIFTS.indexOf(shift) !== -1,
        mainFac: String(row[NSE_V4.COL_REQ_MAIN] || '').trim(),
        secondFac: String(row[NSE_V4.COL_REQ_SECOND] || '').trim(),
        subFacs: subRaw ? subRaw.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [],
        comment: row[NSE_V4.COL_REQ_COMMENT] || '',
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
  
  // 4. T_シフト確定 (過去3ヶ月の履歴 + 対象月の既存配置)
  const confSheet = ss.getSheetByName(NSE_V4.SHEET_NAME_CONF);
  if (confSheet && confSheet.getLastRow() > 1) {
    const now = new Date();
    const historyStart = new Date(now.getFullYear(), now.getMonth() - NSE_V4.HISTORY_MONTHS, 1);
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 1);  // 翌月1日 (排他)
    
    const confData = confSheet.getDataRange().getValues();
    for (let i = 1; i < confData.length; i++) {
      const row = confData[i];
      const date = row[NSE_V4.COL_CONF_DATE];
      if (!(date instanceof Date)) continue;
      
      const staffId = String(row[NSE_V4.COL_CONF_STAFF_ID] || '').trim();
      const facility = String(row[NSE_V4.COL_CONF_FACILITY] || '').trim();
      const jigyosho = String(row[NSE_V4.COL_CONF_JIGYOSHO] || '').trim();
      const unit = String(row[NSE_V4.COL_CONF_UNIT] || '').trim();
      const shift = String(row[NSE_V4.COL_CONF_SHIFT] || '').trim();
      if (!staffId || !facility) continue;
      
      // 4a. 過去3ヶ月: 施設熟練度カウント
      if (date >= historyStart && date < monthStart) {
        if (!ctx.history3m[staffId]) ctx.history3m[staffId] = {};
        ctx.history3m[staffId][facility] = (ctx.history3m[staffId][facility] || 0) + 1;
        ctx.historyCount++;
      }
      
      // 4b. 対象月の既存配置 → staffAssignedDates に取り込み
      if (date >= monthStart && date < monthEnd) {
        if (!ctx.staffMap[staffId]) continue;
        const dateKey = _v4_normDate(date);
        if (!ctx.staffAssignedDates[staffId][dateKey]) {
          ctx.staffAssignedDates[staffId][dateKey] = [];
        }
        // workHours は SHIFT_PATTERNS から取得
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
function testLoadContextV4() {
  Logger.log('=== loadEngineContextV4 動作確認 ===');
  const ym = '2026-05';
  const startTs = Date.now();
  const ctx = loadEngineContextV4(ym);
  const elapsed = ((Date.now() - startTs) / 1000).toFixed(2);
  
  Logger.log('対象月: ' + ctx.targetYM + ' (' + ctx.daysInMonth + '日)');
  Logger.log('処理時間: ' + elapsed + '秒');
  Logger.log('ユニット数: ' + ctx.units.length);
  Logger.log('スタッフ数: ' + Object.keys(ctx.staffMap).length);
  Logger.log('希望提出数: ' + ctx.wishes.length);
  Logger.log('  夜勤希望: ' + ctx.wishes.filter(function(w) { return w.isNight; }).length);
  Logger.log('  日勤希望: ' + ctx.wishes.filter(function(w) { return !w.isNight; }).length);
  Logger.log('過去3ヶ月履歴件数: ' + ctx.historyCount);
  
  // 既存対象月配置のあるスタッフ数
  let assignedStaffCount = 0;
  let totalAssigns = 0;
  Object.keys(ctx.staffAssignedDates).forEach(function(sid) {
    const dates = Object.keys(ctx.staffAssignedDates[sid]);
    if (dates.length > 0) {
      assignedStaffCount++;
      dates.forEach(function(d) {
        totalAssigns += ctx.staffAssignedDates[sid][d].length;
      });
    }
  });
  Logger.log('対象月既存配置: ' + totalAssigns + '件 (スタッフ ' + assignedStaffCount + '名)');
  
  // サンプル: 最初のスタッフの主職種・看護師判定確認
  const firstStaffId = Object.keys(ctx.staffMap)[0];
  if (firstStaffId) {
    const s = ctx.staffMap[firstStaffId];
    Logger.log('サンプル staffId=' + firstStaffId + ':');
    Logger.log('  name=' + s.name + ' / employment=' + s.employment + ' / kubun=' + s.kubun);
    Logger.log('  mainRoles=' + JSON.stringify(s.mainRoles) + ' / isNurse=' + s.isNurse);
    Logger.log('  allowedShifts=' + JSON.stringify(s.allowedShifts));
  }
  
  Logger.log('=== 完了 ===');
}

// ============================================================
// generateSlotsV4: 月の各日×各ユニット = 空き枠生成
// ============================================================
function generateSlotsV4(ctx) {
  for (let day = 1; day <= ctx.daysInMonth; day++) {
    const dateKey = ctx.year + '-' + String(ctx.month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    const date = new Date(dateKey + 'T00:00:00');
    
    for (const unit of ctx.units) {
      const slot = {
        date: date,
        dateKey: dateKey,
        unit: unit,
        jigyosho: unit.jigyosho,
        facility: unit.facility,
        unit_name: unit.unit_name,
        assignment: null  // 後で {staff_id, shift, score, warnings: []} を設定
      };
      ctx.slots.push(slot);
      const slotKey = dateKey + '_' + unit.unit_id;
      ctx.slotsByKey[slotKey] = slot;
    }
  }
  return ctx.slots.length;
}

// ============================================================
// findCandidatesV4: スロット + シフトタイプに対する候補スタッフを抽出
// 物理ハード除外のみここで判定:
//   - 同日他事業所配置NG (H1)
//   - 連続勤務7日以上NG (H6)
//   - 週40時間超NG (H7)
//   - 既配置で当該スロット埋まってる場合NG
//   - 同日同スタッフ複数希望は1回のみ配置
// R1/R2/R3 警告は次ステップで判定 (候補から除外せず警告マーク)
// ============================================================
function findCandidatesV4(ctx, slot, shiftType) {
  // wishesByDayShift から候補抽出
  const dsKey = slot.dateKey + '_' + shiftType;
  const wishes = ctx.wishesByDayShift[dsKey] || [];
  if (wishes.length === 0) return [];
  
  const candidates = [];
  
  for (const wish of wishes) {
    const staff = ctx.staffMap[wish.staff_id];
    if (!staff) continue;
    
    // 許可シフトチェック (H8)
    if (staff.allowedShifts.indexOf(shiftType) === -1) continue;
    
    // 既配置チェック: 同日同スタッフ複数希望は1回のみ
    const sameDayAssigns = ctx.staffAssignedDates[staff.staff_id][slot.dateKey] || [];
    if (sameDayAssigns.length > 0) continue;
    
    // H1: 同日他事業所配置NG
    const otherFac = hasOtherFacilityAssignment(staff.staff_id, slot.dateKey, slot.jigyosho, ctx);
    if (otherFac.exists) continue;
    
    // H6: 連続勤務7日以上NG
    // この日に新規配置した場合の連続日数を仮想的に計算
    const tmpCtx = _v4_makeTempCtx(ctx, staff.staff_id, slot.dateKey, shiftType, slot);
    const consec = checkConsecutiveDays(staff.staff_id, slot.dateKey, tmpCtx);
    if (consec.exceeded) continue;
    
    // H7: 週40時間超NG
    const addedH = (typeof SHIFT_PATTERNS !== 'undefined' && SHIFT_PATTERNS[shiftType])
      ? (SHIFT_PATTERNS[shiftType].dayHours + SHIFT_PATTERNS[shiftType].nightHours)
      : 8;
    const weekly = checkWeeklyHours(staff.staff_id, slot.dateKey, addedH, ctx);
    if (weekly.exceeded) continue;
    
    candidates.push({ staff: staff, wish: wish });
  }
  
  return candidates;
}

// 内部: 仮想ctx (連続勤務判定で「この日に配置した場合」を再現)
function _v4_makeTempCtx(ctx, staffId, dateKey, shiftType, slot) {
  // 浅いコピー + staffAssignedDates の対象日のみ仮想配置
  const orig = ctx.staffAssignedDates[staffId] || {};
  const tmpDates = {};
  for (const k of Object.keys(orig)) tmpDates[k] = orig[k];
  
  const workHours = (typeof SHIFT_PATTERNS !== 'undefined' && SHIFT_PATTERNS[shiftType])
    ? (SHIFT_PATTERNS[shiftType].dayHours + SHIFT_PATTERNS[shiftType].nightHours)
    : 8;
  tmpDates[dateKey] = (tmpDates[dateKey] || []).concat([{
    shift: shiftType,
    jigyosho: slot.jigyosho,
    facility: slot.facility,
    unit: slot.unit_name,
    workHours: workHours
  }]);
  
  const tmpStaffDates = {};
  for (const sid of Object.keys(ctx.staffAssignedDates)) tmpStaffDates[sid] = ctx.staffAssignedDates[sid];
  tmpStaffDates[staffId] = tmpDates;
  
  return { staffAssignedDates: tmpStaffDates };
}

// ============================================================
// calcScoreV4: 配置スコア計算
// 旧 calcScore と同じ仕様、NSE_V4.SCORE 参照
// ============================================================
function calcScoreV4(ctx, staff, wish, slot) {
  let score = 0;
  const fac = slot.facility;
  
  // 施設マッチング
  if (staff.mainFac === fac) score += NSE_V4.SCORE.MAIN_FAC;
  else if (staff.secondFac === fac) score += NSE_V4.SCORE.SECOND_FAC;
  else if (staff.subFacs.indexOf(fac) >= 0) score += NSE_V4.SCORE.SUB_FAC;
  
  // 国家資格
  if (staff.qualification) score += NSE_V4.SCORE.QUALIFIED;
  
  // 正社員
  if (staff.employment === '正社員') score += NSE_V4.SCORE.FULL_TIME;
  
  // 勤務歴月数
  score += (staff.hireMonths || 0) * NSE_V4.SCORE.MONTH_X;
  
  // 施設熟練度
  const skillCount = (ctx.history3m[staff.staff_id] || {})[fac] || 0;
  score += skillCount * NSE_V4.SCORE.SKILL_X;
  
  // 保護フラグ
  if (staff.isProtected) {
    if ((ctx.monthlyAssign[staff.staff_id] || 0) === 0) {
      score += NSE_V4.SCORE.PROTECTED_ZERO;
    } else {
      score += NSE_V4.SCORE.PROTECTED_OTHER;
    }
  }
  
  // 新人
  if (staff.isNewbie1) score += NSE_V4.SCORE.NEWBIE1;
  else if (staff.isNewbie2) score += NSE_V4.SCORE.NEWBIE2;
  
  // 当月集中度
  const concentration = ctx.monthlyAssign[staff.staff_id] || 0;
  score += concentration * NSE_V4.SCORE.CONCENTRATION_X;
  
  // VIP
  if (staff.isVIP) score += NSE_V4.SCORE.VIP;
  
  return score;
}

// ============================================================
// テスト関数: スロット生成 + 候補検索の動作確認
// ============================================================
function testSlotsAndCandidatesV4() {
  Logger.log('=== Step 3.2.3 動作確認 ===');
  const ym = '2026-05';
  const ctx = loadEngineContextV4(ym);
  
  Logger.log('--- generateSlotsV4 ---');
  const slotCount = generateSlotsV4(ctx);
  Logger.log('生成スロット数: ' + slotCount + ' (期待: 22ユニット × 31日 = 682)');
  
  // サンプルスロット表示
  if (ctx.slots.length > 0) {
    const s = ctx.slots[0];
    Logger.log('サンプル[0]: ' + s.dateKey + ' / ' + s.jigyosho + ' / ' + s.facility + ' / ' + s.unit_name);
    const last = ctx.slots[ctx.slots.length - 1];
    Logger.log('サンプル[末]: ' + last.dateKey + ' / ' + last.jigyosho + ' / ' + last.facility + ' / ' + last.unit_name);
  }
  
  Logger.log('\n--- findCandidatesV4 (希望が0なので候補も0が期待値) ---');
  if (ctx.slots.length > 0) {
    const slot = ctx.slots[0];
    ['夜勤A', '夜勤B', '夜勤C'].forEach(function(shift) {
      const cands = findCandidatesV4(ctx, slot, shift);
      Logger.log(slot.dateKey + ' / ' + slot.unit_name + ' / ' + shift + ' → 候補: ' + cands.length + '件');
    });
  }
  
  Logger.log('\n--- calcScoreV4 (mockスタッフでスコア計算) ---');
  const mockStaff = {
    staff_id: 'TEST',
    mainFac: 'リフレ要町',
    secondFac: '',
    subFacs: [],
    qualification: '看護師',
    employment: '正社員',
    hireMonths: 36,
    isProtected: false,
    isVIP: false,
    isNewbie1: false,
    isNewbie2: false
  };
  const mockSlot = { facility: 'リフレ要町' };
  const mockWish = {};
  // history3m と monthlyAssign を空で
  ctx.history3m['TEST'] = {};
  ctx.monthlyAssign['TEST'] = 0;
  const score = calcScoreV4(ctx, mockStaff, mockWish, mockSlot);
  // 期待: 30(メイン) + 10(資格) + 5(正社員) + 36×2(月数) = 117
  Logger.log('スコア計算結果: ' + score + ' (期待: 117)');
  
  Logger.log('\n=== 完了 ===');
}

// ============================================================
// generateSlotsV4: 月の各日×各ユニット = 空き枠生成
// ============================================================
function generateSlotsV4(ctx) {
  for (let day = 1; day <= ctx.daysInMonth; day++) {
    const dateKey = ctx.year + '-' + String(ctx.month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    const date = new Date(dateKey + 'T00:00:00');
    
    for (const unit of ctx.units) {
      const slot = {
        date: date,
        dateKey: dateKey,
        unit: unit,
        jigyosho: unit.jigyosho,
        facility: unit.facility,
        unit_name: unit.unit_name,
        assignment: null  // 後で {staff_id, shift, score, warnings: []} を設定
      };
      ctx.slots.push(slot);
      const slotKey = dateKey + '_' + unit.unit_id;
      ctx.slotsByKey[slotKey] = slot;
    }
  }
  return ctx.slots.length;
}

// ============================================================
// findCandidatesV4: スロット + シフトタイプに対する候補スタッフを抽出
// 物理ハード除外のみここで判定:
//   - 同日他事業所配置NG (H1)
//   - 連続勤務7日以上NG (H6)
//   - 週40時間超NG (H7)
//   - 既配置で当該スロット埋まってる場合NG
//   - 同日同スタッフ複数希望は1回のみ配置
// R1/R2/R3 警告は次ステップで判定 (候補から除外せず警告マーク)
// ============================================================
function findCandidatesV4(ctx, slot, shiftType) {
  // wishesByDayShift から候補抽出
  const dsKey = slot.dateKey + '_' + shiftType;
  const wishes = ctx.wishesByDayShift[dsKey] || [];
  if (wishes.length === 0) return [];
  
  const candidates = [];
  
  for (const wish of wishes) {
    const staff = ctx.staffMap[wish.staff_id];
    if (!staff) continue;
    
    // 許可シフトチェック (H8)
    if (staff.allowedShifts.indexOf(shiftType) === -1) continue;
    
    // 既配置チェック: 同日同スタッフ複数希望は1回のみ
    const sameDayAssigns = ctx.staffAssignedDates[staff.staff_id][slot.dateKey] || [];
    if (sameDayAssigns.length > 0) continue;
    
    // H1: 同日他事業所配置NG
    const otherFac = hasOtherFacilityAssignment(staff.staff_id, slot.dateKey, slot.jigyosho, ctx);
    if (otherFac.exists) continue;
    
    // H6: 連続勤務7日以上NG
    // この日に新規配置した場合の連続日数を仮想的に計算
    const tmpCtx = _v4_makeTempCtx(ctx, staff.staff_id, slot.dateKey, shiftType, slot);
    const consec = checkConsecutiveDays(staff.staff_id, slot.dateKey, tmpCtx);
    if (consec.exceeded) continue;
    
    // H7: 週40時間超NG
    const addedH = (typeof SHIFT_PATTERNS !== 'undefined' && SHIFT_PATTERNS[shiftType])
      ? (SHIFT_PATTERNS[shiftType].dayHours + SHIFT_PATTERNS[shiftType].nightHours)
      : 8;
    const weekly = checkWeeklyHours(staff.staff_id, slot.dateKey, addedH, ctx);
    if (weekly.exceeded) continue;
    
    candidates.push({ staff: staff, wish: wish });
  }
  
  return candidates;
}

// 内部: 仮想ctx (連続勤務判定で「この日に配置した場合」を再現)
function _v4_makeTempCtx(ctx, staffId, dateKey, shiftType, slot) {
  // 浅いコピー + staffAssignedDates の対象日のみ仮想配置
  const orig = ctx.staffAssignedDates[staffId] || {};
  const tmpDates = {};
  for (const k of Object.keys(orig)) tmpDates[k] = orig[k];
  
  const workHours = (typeof SHIFT_PATTERNS !== 'undefined' && SHIFT_PATTERNS[shiftType])
    ? (SHIFT_PATTERNS[shiftType].dayHours + SHIFT_PATTERNS[shiftType].nightHours)
    : 8;
  tmpDates[dateKey] = (tmpDates[dateKey] || []).concat([{
    shift: shiftType,
    jigyosho: slot.jigyosho,
    facility: slot.facility,
    unit: slot.unit_name,
    workHours: workHours
  }]);
  
  const tmpStaffDates = {};
  for (const sid of Object.keys(ctx.staffAssignedDates)) tmpStaffDates[sid] = ctx.staffAssignedDates[sid];
  tmpStaffDates[staffId] = tmpDates;
  
  return { staffAssignedDates: tmpStaffDates };
}

// ============================================================
// calcScoreV4: 配置スコア計算
// 旧 calcScore と同じ仕様、NSE_V4.SCORE 参照
// ============================================================
function calcScoreV4(ctx, staff, wish, slot) {
  let score = 0;
  const fac = slot.facility;
  
  // 施設マッチング
  if (staff.mainFac === fac) score += NSE_V4.SCORE.MAIN_FAC;
  else if (staff.secondFac === fac) score += NSE_V4.SCORE.SECOND_FAC;
  else if (staff.subFacs.indexOf(fac) >= 0) score += NSE_V4.SCORE.SUB_FAC;
  
  // 国家資格
  if (staff.qualification) score += NSE_V4.SCORE.QUALIFIED;
  
  // 正社員
  if (staff.employment === '正社員') score += NSE_V4.SCORE.FULL_TIME;
  
  // 勤務歴月数
  score += (staff.hireMonths || 0) * NSE_V4.SCORE.MONTH_X;
  
  // 施設熟練度
  const skillCount = (ctx.history3m[staff.staff_id] || {})[fac] || 0;
  score += skillCount * NSE_V4.SCORE.SKILL_X;
  
  // 保護フラグ
  if (staff.isProtected) {
    if ((ctx.monthlyAssign[staff.staff_id] || 0) === 0) {
      score += NSE_V4.SCORE.PROTECTED_ZERO;
    } else {
      score += NSE_V4.SCORE.PROTECTED_OTHER;
    }
  }
  
  // 新人
  if (staff.isNewbie1) score += NSE_V4.SCORE.NEWBIE1;
  else if (staff.isNewbie2) score += NSE_V4.SCORE.NEWBIE2;
  
  // 当月集中度
  const concentration = ctx.monthlyAssign[staff.staff_id] || 0;
  score += concentration * NSE_V4.SCORE.CONCENTRATION_X;
  
  // VIP
  if (staff.isVIP) score += NSE_V4.SCORE.VIP;
  
  return score;
}

// ============================================================
// テスト関数: スロット生成 + 候補検索の動作確認
// ============================================================
function testSlotsAndCandidatesV4() {
  Logger.log('=== Step 3.2.3 動作確認 ===');
  const ym = '2026-05';
  const ctx = loadEngineContextV4(ym);
  
  Logger.log('--- generateSlotsV4 ---');
  const slotCount = generateSlotsV4(ctx);
  Logger.log('生成スロット数: ' + slotCount + ' (期待: 22ユニット × 31日 = 682)');
  
  // サンプルスロット表示
  if (ctx.slots.length > 0) {
    const s = ctx.slots[0];
    Logger.log('サンプル[0]: ' + s.dateKey + ' / ' + s.jigyosho + ' / ' + s.facility + ' / ' + s.unit_name);
    const last = ctx.slots[ctx.slots.length - 1];
    Logger.log('サンプル[末]: ' + last.dateKey + ' / ' + last.jigyosho + ' / ' + last.facility + ' / ' + last.unit_name);
  }
  
  Logger.log('\n--- findCandidatesV4 (希望が0なので候補も0が期待値) ---');
  if (ctx.slots.length > 0) {
    const slot = ctx.slots[0];
    ['夜勤A', '夜勤B', '夜勤C'].forEach(function(shift) {
      const cands = findCandidatesV4(ctx, slot, shift);
      Logger.log(slot.dateKey + ' / ' + slot.unit_name + ' / ' + shift + ' → 候補: ' + cands.length + '件');
    });
  }
  
  Logger.log('\n--- calcScoreV4 (mockスタッフでスコア計算) ---');
  const mockStaff = {
    staff_id: 'TEST',
    mainFac: 'リフレ要町',
    secondFac: '',
    subFacs: [],
    qualification: '看護師',
    employment: '正社員',
    hireMonths: 36,
    isProtected: false,
    isVIP: false,
    isNewbie1: false,
    isNewbie2: false
  };
  const mockSlot = { facility: 'リフレ要町' };
  const mockWish = {};
  // history3m と monthlyAssign を空で
  ctx.history3m['TEST'] = {};
  ctx.monthlyAssign['TEST'] = 0;
  const score = calcScoreV4(ctx, mockStaff, mockWish, mockSlot);
  // 期待: 30(メイン) + 10(資格) + 5(正社員) + 36×2(月数) = 117
  Logger.log('スコア計算結果: ' + score + ' (期待: 117)');
  
  Logger.log('\n=== 完了 ===');
}
