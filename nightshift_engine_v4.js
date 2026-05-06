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
    QUALIFIED: 1000, FULL_TIME: 5,  // 看護師優先のため大幅加点 (2026-05-06更新)
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
    
    // 許可シフトチェック (H9)
    if (staff.allowedShifts.indexOf(shiftType) === -1) continue;
    
    // ★ H10: 希望施設マッチ必須NG (メイン/セカンド/サブ以外への配置不可)
    const slotFac = slot.facility;
    const isFacilityMatch = (
      staff.mainFac === slotFac ||
      staff.secondFac === slotFac ||
      (staff.subFacs && staff.subFacs.indexOf(slotFac) !== -1)
    );
    if (!isFacilityMatch) continue;
    
    // 既配置チェック: 同日同スタッフ複数希望は1回のみ (夜勤は1日1配置)
    const sameDayAssigns = ctx.staffAssignedDates[staff.staff_id][slot.dateKey] || [];
    if (sameDayAssigns.length > 0) continue;
    
    // H11 (旧H1): 同日他事業所配置NG (既存関数 hasOtherFacilityAssignment が同日全体で判定)
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
// Step 3.2.4: R1/R2/R3 警告チェック関数
// ============================================================

// ============================================================
// R1: 前日 夜勤A/B/C → 当日 日勤早出
// 仕様書: 連続勤務NGとみなす (物理衝突の有無は問わない)
// 引数: staff, slot, shiftType (これから配置しようとしてるシフト)
// 戻り値: null | {ruleId, level, message}
// ============================================================
function checkR1WarningV4(staff, slot, shiftType, ctx) {
  // R1は「当日が早出8h/4h」の場合のみ判定
  if (shiftType !== '早出8h' && shiftType !== '早出4h') return null;
  
  // 前日に夜勤A/B/Cが配置されているか
  const prevDay = _v4_addDays(slot.dateKey, -1);
  const prevAssigns = (ctx.staffAssignedDates[staff.staff_id] || {})[prevDay] || [];
  
  for (const a of prevAssigns) {
    if (NSE_V4.NIGHT_SHIFTS.indexOf(a.shift) !== -1) {
      return {
        ruleId: 'R1',
        level: WARNING_LEVEL.BLOCK,
        message: '前日(' + prevDay + ')の' + a.shift + ' → 当日' + shiftType + ' は連続勤務NG'
      };
    }
  }
  return null;
}

// ============================================================
// R2: 同日 日勤遅出8h → 同日 夜勤A/B/C
// 仕様書: 同日内チェック、遅出4h(〜17:00)は対象外
// 引数: staff, slot, shiftType (これから配置しようとしてるシフト)
// 戻り値: null | {ruleId, level, message}
// ============================================================
function checkR2WarningV4(staff, slot, shiftType, ctx) {
  // R2は「当日が夜勤A/B/C」の場合のみ判定
  if (NSE_V4.NIGHT_SHIFTS.indexOf(shiftType) === -1) return null;
  
  // 同日に遅出8hが配置されているか
  const sameDayAssigns = (ctx.staffAssignedDates[staff.staff_id] || {})[slot.dateKey] || [];
  
  for (const a of sameDayAssigns) {
    if (a.shift === '遅出8h') {
      return {
        ruleId: 'R2',
        level: WARNING_LEVEL.BLOCK,
        message: '同日(' + slot.dateKey + ')の遅出8h(〜22:00) → 同日' + shiftType + ' は連続勤務NG'
      };
    }
  }
  return null;
}

// ============================================================
// R3: 同一施設・同一日 新人同士のみ
// 仕様書: 「通常」スタッフ0人で「新人」のみだと警告
// スコープ: 施設単位 (slot.facility)
// 候補が「通常」なら配置後に通常>=1人になるので警告なし
// 候補が「新人」: その日その施設に通常スタッフがいるか確認
// 引数: staff, slot, shiftType, ctx
// 戻り値: null | {ruleId, level, message}
// ============================================================
function checkR3WarningV4(staff, slot, shiftType, ctx) {
  const isCandidateNewbie = staff.isNewbie1 || staff.isNewbie2;
  if (!isCandidateNewbie) return null;  // 通常スタッフなら警告なし
  
  // その日その施設に配置済みの全スタッフを確認
  const dateKey = slot.dateKey;
  const targetFacility = slot.facility;
  
  for (const sid of Object.keys(ctx.staffAssignedDates)) {
    const assigns = ctx.staffAssignedDates[sid][dateKey] || [];
    for (const a of assigns) {
      if (a.facility !== targetFacility) continue;
      // この配置の主はだれ?
      const otherStaff = ctx.staffMap[sid];
      if (!otherStaff) continue;
      // 通常スタッフがいる
      if (!otherStaff.isNewbie1 && !otherStaff.isNewbie2) {
        return null;  // 通常>=1人 確保されてる
      }
    }
  }
  
  // ここに来たら、その施設・その日に「通常」スタッフ0人
  return {
    ruleId: 'R3',
    level: WARNING_LEVEL.BLOCK,
    message: '同一施設(' + targetFacility + ')・同一日(' + dateKey + ') に通常スタッフ0人で新人(' + staff.kubun + ')のみ配置'
  };
}

// ============================================================
// 統合ヘルパー: 配置候補に対して全 R系警告をチェック
// 戻り値: 警告オブジェクトの配列 (空配列なら問題なし)
// ============================================================
function checkAllRWarningsV4(staff, slot, shiftType, ctx) {
  const warnings = [];
  const r1 = checkR1WarningV4(staff, slot, shiftType, ctx);
  if (r1) warnings.push(r1);
  const r2 = checkR2WarningV4(staff, slot, shiftType, ctx);
  if (r2) warnings.push(r2);
  const r3 = checkR3WarningV4(staff, slot, shiftType, ctx);
  if (r3) warnings.push(r3);
  return warnings;
}

// ============================================================
// 内部: 日付加算 (v4プレフィックス)
// ============================================================
function _v4_addDays(dateKey, delta) {
  const d = new Date(dateKey + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd');
}

// ============================================================
// テスト関数: R1/R2/R3 警告チェック
// ============================================================
function testRWarningsV4() {
  Logger.log('=== Step 3.2.4 R1/R2/R3 警告チェック ===');
  
  // mock ctx 作成
  const ctx = {
    staffMap: {
      '13': { staff_id: '13', name: '水野永吉', kubun: '通常', isNewbie1: false, isNewbie2: false },
      '14': { staff_id: '14', name: '新人花子', kubun: '新人1ヶ月', isNewbie1: true, isNewbie2: false },
      '15': { staff_id: '15', name: '新人次郎', kubun: '新人2ヶ月', isNewbie1: false, isNewbie2: true },
      '99': { staff_id: '99', name: '通常太郎', kubun: '通常', isNewbie1: false, isNewbie2: false }
    },
    staffAssignedDates: {
      '13': {
        '2026-05-14': [{ shift: '夜勤B', jigyosho: 'GHコノヒカラ', facility: 'リフレ要町', unit: 'コノヒカラⅠ', workHours: 8 }],
        '2026-05-15': [{ shift: '遅出8h', jigyosho: 'GHコノヒカラ', facility: 'リフレ要町', unit: '', workHours: 8 }]
      },
      '99': {
        '2026-05-15': [{ shift: '夜勤A', jigyosho: 'GHコノヒカラ', facility: 'リフレ要町', unit: 'コノヒカラⅠ', workHours: 8 }]
      }
    }
  };
  
  // === R1 テスト ===
  Logger.log('\n--- R1 (前日夜勤 → 当日早出) ---');
  // 13: 5/14 夜勤B → 5/15 早出8h を配置 → R1警告
  let r = checkR1WarningV4(ctx.staffMap['13'], { dateKey: '2026-05-15' }, '早出8h', ctx);
  Logger.log('staff=13 / 5/15 / 早出8h → ' + (r ? 'R1警告: ' + r.message : '警告なし') + ' (期待:R1警告)');
  // 13: 5/14 夜勤B → 5/15 早出4h を配置 → R1警告
  r = checkR1WarningV4(ctx.staffMap['13'], { dateKey: '2026-05-15' }, '早出4h', ctx);
  Logger.log('staff=13 / 5/15 / 早出4h → ' + (r ? 'R1警告: ' + r.message : '警告なし') + ' (期待:R1警告)');
  // 13: 5/14 夜勤B → 5/15 遅出8h を配置 → 警告なし
  r = checkR1WarningV4(ctx.staffMap['13'], { dateKey: '2026-05-15' }, '遅出8h', ctx);
  Logger.log('staff=13 / 5/15 / 遅出8h → ' + (r ? 'R1警告: ' + r.message : '警告なし') + ' (期待:なし)');
  // 14: 配置なし → 5/15 早出8h → 警告なし
  r = checkR1WarningV4(ctx.staffMap['14'], { dateKey: '2026-05-15' }, '早出8h', ctx);
  Logger.log('staff=14 / 5/15 / 早出8h → ' + (r ? 'R1警告: ' + r.message : '警告なし') + ' (期待:なし)');
  
  // === R2 テスト ===
  Logger.log('\n--- R2 (同日遅出8h → 同日夜勤) ---');
  // 13: 5/15 遅出8h済 → 同日 夜勤A 配置 → R2警告
  r = checkR2WarningV4(ctx.staffMap['13'], { dateKey: '2026-05-15' }, '夜勤A', ctx);
  Logger.log('staff=13 / 5/15 / 夜勤A → ' + (r ? 'R2警告: ' + r.message : '警告なし') + ' (期待:R2警告)');
  // 13: 5/15 遅出8h済 → 同日 早出8h 配置 → R2対象外 (R2は夜勤のみ)
  r = checkR2WarningV4(ctx.staffMap['13'], { dateKey: '2026-05-15' }, '早出8h', ctx);
  Logger.log('staff=13 / 5/15 / 早出8h → ' + (r ? 'R2警告: ' + r.message : '警告なし') + ' (期待:なし R2対象外)');
  // 14: 配置なし → 5/15 夜勤A 配置 → 警告なし
  r = checkR2WarningV4(ctx.staffMap['14'], { dateKey: '2026-05-15' }, '夜勤A', ctx);
  Logger.log('staff=14 / 5/15 / 夜勤A → ' + (r ? 'R2警告: ' + r.message : '警告なし') + ' (期待:なし)');
  
  // === R3 テスト ===
  Logger.log('\n--- R3 (同一施設・同一日 新人同士のみ) ---');
  // 既存ctx: 5/15 リフレ要町に staff=99 (通常) 配置済み
  // 14 (新人) を配置 → 通常99がいるので警告なし
  r = checkR3WarningV4(ctx.staffMap['14'], { dateKey: '2026-05-15', facility: 'リフレ要町' }, '夜勤A', ctx);
  Logger.log('staff=14(新人1) / 5/15 / リフレ要町 (通常99あり) → ' + (r ? 'R3警告' : '警告なし') + ' (期待:なし)');
  // 13 (通常) を配置 → 通常スタッフ自身なので警告なし
  r = checkR3WarningV4(ctx.staffMap['13'], { dateKey: '2026-05-15', facility: 'リフレ要町' }, '夜勤B', ctx);
  Logger.log('staff=13(通常) / 5/15 / リフレ要町 → ' + (r ? 'R3警告' : '警告なし') + ' (期待:なし 通常)');
  // 14 (新人) を 5/16 リフレ要町に配置 → 5/16はだれも配置なし → 警告
  r = checkR3WarningV4(ctx.staffMap['14'], { dateKey: '2026-05-16', facility: 'リフレ要町' }, '夜勤A', ctx);
  Logger.log('staff=14(新人1) / 5/16 / リフレ要町 (配置なし) → ' + (r ? 'R3警告: ' + r.message : '警告なし') + ' (期待:R3警告)');
  
  // 既存ctx を拡張: 5/16 リフレ要町に新人だけ
  ctx.staffAssignedDates['15'] = {
    '2026-05-16': [{ shift: '夜勤A', jigyosho: 'GHコノヒカラ', facility: 'リフレ要町', unit: 'コノヒカラⅠ', workHours: 8 }]
  };
  // 14 (新人) を 5/16 リフレ要町に配置 → 既存は新人15のみ → 警告
  r = checkR3WarningV4(ctx.staffMap['14'], { dateKey: '2026-05-16', facility: 'リフレ要町' }, '夜勤B', ctx);
  Logger.log('staff=14(新人1) / 5/16 / リフレ要町 (新人15のみ) → ' + (r ? 'R3警告: ' + r.message : '警告なし') + ' (期待:R3警告)');
  // 13 (通常) を 5/16 リフレ要町に配置 → 警告なし (自分が通常)
  r = checkR3WarningV4(ctx.staffMap['13'], { dateKey: '2026-05-16', facility: 'リフレ要町' }, '夜勤B', ctx);
  Logger.log('staff=13(通常) / 5/16 / リフレ要町 → ' + (r ? 'R3警告' : '警告なし') + ' (期待:なし 通常)');
  
  // === 統合テスト ===
  Logger.log('\n--- checkAllRWarningsV4 統合 ---');
  const all = checkAllRWarningsV4(ctx.staffMap['13'], { dateKey: '2026-05-15', facility: 'リフレ要町' }, '夜勤A', ctx);
  Logger.log('staff=13 / 5/15 / 夜勤A → 警告 ' + all.length + '件');
  all.forEach(function(w) { Logger.log('  - ' + w.ruleId + ': ' + w.message); });
  
  Logger.log('\n=== 完了 ===');
}

// ============================================================
// Step 3.2.5: assignByScoreV4 (配置メインロジック)
// ============================================================
function assignByScoreV4(ctx) {
  Logger.log('assignByScoreV4: 配置開始 (' + ctx.slots.length + 'スロット × 3シフト)');
  
  ctx.pendingWarnings = [];  // 警告書き込み用バッファ
  let assignedCount = 0;
  let warningCount = 0;
  let unassignedCount = 0;
  
  // 全スロットを処理
  for (let si = 0; si < ctx.slots.length; si++) {
    const slot = ctx.slots[si];
    if (slot.assignment) continue;  // 既に埋まってる (将来の保護配置等)
    
    // 各夜勤シフトで候補検索
    let allCandidatesByShift = {};  // {夜勤A: [...], 夜勤B: [...], 夜勤C: [...]}
    for (const shift of NSE_V4.NIGHT_SHIFTS) {
      const candidates = findCandidatesV4(ctx, slot, shift);
      candidates.forEach(function(c) {
        c.score = calcScoreV4(ctx, c.staff, c.wish, slot);
        c.warnings = checkAllRWarningsV4(c.staff, slot, shift, ctx);
        c.shift = shift;
      });
      if (candidates.length > 0) allCandidatesByShift[shift] = candidates;
    }
    
    // 全候補を1つの配列にまとめて優先順位ソート
    let allCands = [];
    Object.keys(allCandidatesByShift).forEach(function(s) {
      allCands = allCands.concat(allCandidatesByShift[s]);
    });
    
    if (allCands.length === 0) {
      unassignedCount++;
      continue;
    }
    
    // ソート: VIP > 警告なし > シフト種別 (夜勤C>B>A) > スコア降順
    // シフト種別優先度の根拠:
    //   夜勤C: 朝8時まで → 朝の忙しい時間をカバー (最優先)
    //   夜勤B: 朝7時まで → 最低限
    //   夜勤A: 朝5時帰宅 → 朝サポートなし (最後の手段)
    //   例外: 看護師の夜勤A希望はVIPフラグで運用カバー (上位の1.VIP優先で担保)
    const _v4_shiftRank = function(s) {
      if (s === '夜勤C') return 3;
      if (s === '夜勤B') return 2;
      if (s === '夜勤A') return 1;
      return 0;
    };
    allCands.sort(function(a, b) {
      // 1. VIP優先
      const aVIP = a.staff.isVIP ? 1 : 0;
      const bVIP = b.staff.isVIP ? 1 : 0;
      if (aVIP !== bVIP) return bVIP - aVIP;
      // 2. 警告なし優先
      const aNoWarn = (a.warnings.length === 0) ? 1 : 0;
      const bNoWarn = (b.warnings.length === 0) ? 1 : 0;
      if (aNoWarn !== bNoWarn) return bNoWarn - aNoWarn;
      // 3. シフト種別優先 (夜勤C > 夜勤B > 夜勤A)
      const aRank = _v4_shiftRank(a.shift);
      const bRank = _v4_shiftRank(b.shift);
      if (aRank !== bRank) return bRank - aRank;
      // 4. スコア降順
      return b.score - a.score;
    });
    
    // 最優先候補を採用
    const top = allCands[0];
    const wh = (typeof SHIFT_PATTERNS !== 'undefined' && SHIFT_PATTERNS[top.shift])
      ? (SHIFT_PATTERNS[top.shift].dayHours + SHIFT_PATTERNS[top.shift].nightHours)
      : 8;
    
    slot.assignment = {
      staff_id: top.staff.staff_id,
      staff_name: top.staff.name,
      shift: top.shift,
      score: top.score,
      warnings: top.warnings,
      reason: top.warnings.length > 0 ? '警告あり配置(承認待ち)' : '通常配置'
    };
    
    // ctx.staffAssignedDates に反映
    if (!ctx.staffAssignedDates[top.staff.staff_id][slot.dateKey]) {
      ctx.staffAssignedDates[top.staff.staff_id][slot.dateKey] = [];
    }
    ctx.staffAssignedDates[top.staff.staff_id][slot.dateKey].push({
      shift: top.shift,
      jigyosho: slot.jigyosho,
      facility: slot.facility,
      unit: slot.unit_name,
      workHours: wh
    });
    ctx.monthlyAssign[top.staff.staff_id] = (ctx.monthlyAssign[top.staff.staff_id] || 0) + 1;
    
    assignedCount++;
    
    // 警告レコードをバッファ
    if (top.warnings.length > 0) {
      top.warnings.forEach(function(w) {
        ctx.pendingWarnings.push({
          shiftKind: 'night',
          targetYm: ctx.targetYM,
          date: slot.dateKey,
          jigyosho: slot.jigyosho,
          facility: slot.facility,
          unit: slot.unit_name,
          staffId: top.staff.staff_id,
          staffName: top.staff.name,
          ruleId: w.ruleId,
          level: w.level,
          message: w.message
        });
        warningCount++;
      });
    }
  }
  
  Logger.log('assignByScoreV4: 配置完了');
  Logger.log('  配置済み: ' + assignedCount + 'スロット');
  Logger.log('  警告レコード: ' + warningCount + '件');
  Logger.log('  未配置: ' + unassignedCount + 'スロット');
  
  return {
    assignedCount: assignedCount,
    warningCount: warningCount,
    unassignedCount: unassignedCount
  };
}

// ============================================================
// テスト用: ダミー希望データを投入してassignByScoreV4を動作確認
// 注: 実際のT_希望提出シートには書き込まない、ctxの中だけ
// ============================================================
function testAssignByScoreV4() {
  Logger.log('=== Step 3.2.5 assignByScoreV4 動作確認 ===');
  const ym = '2026-05';
  const ctx = loadEngineContextV4(ym);
  generateSlotsV4(ctx);
  
  // ダミー希望を ctx に直接注入 (シートには書き込まない)
  // 既存のスタッフ (staff_id=2 水野惠子, staff_id=3 など) に希望を投入
  const staffIds = Object.keys(ctx.staffMap).slice(0, 10);  // 先頭10名
  Logger.log('ダミー希望投入対象スタッフ: ' + staffIds.length + '名');
  
  // 5/1 〜 5/5 に夜勤A/B/Cの希望を投入
  let dummyWishCount = 0;
  for (let day = 1; day <= 5; day++) {
    const dateKey = '2026-05-' + String(day).padStart(2, '0');
    const date = new Date(dateKey + 'T00:00:00');
    
    staffIds.forEach(function(sid, idx) {
      const shift = ['夜勤A', '夜勤B', '夜勤C'][idx % 3];
      const staff = ctx.staffMap[sid];
      
      // allowedShifts に当該シフトが含まれてるスタッフだけ
      if (staff.allowedShifts.indexOf(shift) === -1) return;
      
      const wish = {
        requestId: 'DUMMY-' + sid + '-' + dateKey + '-' + shift,
        staff_id: sid,
        name: staff.name,
        date: date,
        dateKey: dateKey,
        shift: shift,
        isNight: true,
        mainFac: staff.mainFac,
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
      const dsKey = dateKey + '_' + shift;
      if (!ctx.wishesByDayShift[dsKey]) ctx.wishesByDayShift[dsKey] = [];
      ctx.wishesByDayShift[dsKey].push(wish);
      dummyWishCount++;
    });
  }
  Logger.log('ダミー希望投入: ' + dummyWishCount + '件 (5/1〜5/5)');
  
  // 配置実行
  Logger.log('\n--- 配置実行 ---');
  const startTs = Date.now();
  const result = assignByScoreV4(ctx);
  const elapsed = ((Date.now() - startTs) / 1000).toFixed(2);
  Logger.log('処理時間: ' + elapsed + '秒');
  
  // 結果サマリー
  Logger.log('\n--- 配置結果 ---');
  let withWarning = 0;
  let withoutWarning = 0;
  ctx.slots.forEach(function(s) {
    if (s.assignment) {
      if (s.assignment.warnings.length > 0) withWarning++;
      else withoutWarning++;
    }
  });
  Logger.log('警告なし配置: ' + withoutWarning);
  Logger.log('警告あり配置: ' + withWarning);
  Logger.log('未配置スロット: ' + (ctx.slots.length - withWarning - withoutWarning));
  
  // 配置サンプル表示 (5件)
  Logger.log('\n--- 配置サンプル ---');
  let shown = 0;
  for (const slot of ctx.slots) {
    if (slot.assignment && shown < 5) {
      const a = slot.assignment;
      Logger.log(slot.dateKey + ' / ' + slot.facility + ' / ' + slot.unit_name +
                 ' → ' + a.staff_name + ' (' + a.shift + ', score=' + a.score + ', warnings=' + a.warnings.length + ')');
      shown++;
    }
  }
  
  // 警告サンプル
  if (ctx.pendingWarnings.length > 0) {
    Logger.log('\n--- 警告サンプル (先頭3件) ---');
    ctx.pendingWarnings.slice(0, 3).forEach(function(w) {
      Logger.log(w.rule_id + ' / ' + w.date + ' / ' + w.staff_name + ': ' + w.message);
    });
  }
  
  Logger.log('\n=== 完了 ===');
}

// ============================================================
// Step 3.2.6: writeShiftResultsV4 + メインエントリ
// ============================================================

// ============================================================
// writeShiftResultsV4: T_シフト確定 + V_警告チェック への書き込み
// インクリメンタル: 対象月の既存夜勤レコード(夜勤A/B/C)を削除→新規挿入
// 日勤レコードは保持
// ============================================================
function writeShiftResultsV4(ctx) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(NSE_V4.SHEET_NAME_CONF);
  if (!sheet) throw new Error('T_シフト確定シートが見つからない');
  
  Logger.log('writeShiftResultsV4: 書き込み開始');
  
  // 1. 対象月の既存夜勤レコードを削除 (日勤データは残す)
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const allData = sheet.getRange(2, 1, lastRow - 1, 18).getValues();
    const rowsToDelete = [];
    for (let i = 0; i < allData.length; i++) {
      const ym = _v4_normYm(allData[i][NSE_V4.COL_CONF_YM]);
      const shift = String(allData[i][NSE_V4.COL_CONF_SHIFT] || '').trim();
      // 対象月 かつ 夜勤シフト
      if (ym === ctx.targetYM && NSE_V4.NIGHT_SHIFTS.indexOf(shift) !== -1) {
        rowsToDelete.push(i + 2); // 1-indexed + ヘッダー1行
      }
    }
    // 後ろから削除 (前から削除すると行番号がずれる)
    rowsToDelete.reverse().forEach(function(rowNum) {
      sheet.deleteRow(rowNum);
    });
    Logger.log('  既存夜勤レコード削除: ' + rowsToDelete.length + '件');
  }
  
  // 2. 配置結果を T_シフト確定 に書き込み
  const newRows = [];
  const now = new Date();
  let placedCount = 0;
  
  for (const slot of ctx.slots) {
    if (!slot.assignment) continue;
    const a = slot.assignment;
    const shiftPat = (typeof SHIFT_PATTERNS !== 'undefined' && SHIFT_PATTERNS[a.shift])
      ? SHIFT_PATTERNS[a.shift]
      : { start: '', end: '', dayHours: 0, nightHours: 8 };
    
    const requestId = 'NSE-V4-' + ctx.targetYM + '-' + slot.unit.unit_id + '-' + slot.dateKey + '-' + a.shift;
    const status = a.warnings.length > 0 ? '警告承認待ち' : '仮';
    
    // T_シフト確定 18列構造 (シート実体に合わせる)
    // ヘッダー: shift_id / 日付 / unit_id / 事業所名 / 施設名 / ユニット名 / staff_id / 氏名
    //          / シフト種別 / 開始時刻 / 終了時刻 / 配置カウント / ステータス / 更新日時
    //          / 実開始時刻 / 実終了時刻 / 夜勤換算時間 / 日勤換算時間
    const row = [
      requestId,                  // [0] shift_id
      slot.date,                  // [1] 日付
      slot.unit.unit_id,          // [2] unit_id  (★ year_month から修正)
      slot.jigyosho,              // [3] 事業所名
      slot.facility,              // [4] 施設名
      slot.unit_name,             // [5] ユニット名
      a.staff_id,                 // [6] staff_id
      a.staff_name,               // [7] 氏名
      a.shift,                    // [8] シフト種別
      shiftPat.start,             // [9] 開始時刻
      shiftPat.end,               // [10] 終了時刻
      a.reason,                   // [11] 配置カウント
      status,                     // [12] ステータス
      now,                        // [13] 更新日時
      shiftPat.start,             // [14] 実開始時刻
      shiftPat.end,               // [15] 実終了時刻
      shiftPat.nightHours,        // [16] 夜勤換算時間
      shiftPat.dayHours,          // [17] 日勤換算時間
    ];
    newRows.push(row);
    placedCount++;
  }
  
  if (newRows.length > 0) {
    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, newRows.length, 18).setValues(newRows);
    Logger.log('  新規夜勤レコード書き込み: ' + newRows.length + '件');
  }
  
  // 3. 既存の警告レコード (対象月+夜勤) を削除
  if (typeof deleteWarningsForMonth === 'function') {
    const deletedCount = deleteWarningsForMonth(ctx.targetYM, 'night');
    Logger.log('  既存警告レコード削除: ' + deletedCount + '件');
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
// runNightShiftEngineV4: メインエントリ
// 引数: targetYM (e.g. "2026-05")
// ============================================================
function runNightShiftEngineV4(targetYM) {
  const overallStart = Date.now();
  Logger.log('===== runNightShiftEngineV4 開始: ' + targetYM + ' =====');
  
  // 1. ctx 構築
  Logger.log('[1/4] ctx構築...');
  const ctx = loadEngineContextV4(targetYM);
  Logger.log('  ユニット: ' + ctx.units.length + ' / スタッフ: ' + Object.keys(ctx.staffMap).length + ' / 希望: ' + ctx.wishes.length);
  
  // 2. スロット生成
  Logger.log('[2/4] スロット生成...');
  generateSlotsV4(ctx);
  Logger.log('  スロット: ' + ctx.slots.length);
  
  // 3. 配置実行
  Logger.log('[3/4] 配置実行...');
  const result = assignByScoreV4(ctx);
  
  // 4. 書き込み
  Logger.log('[4/4] 書き込み...');
  const writeResult = writeShiftResultsV4(ctx);
  
  const elapsed = ((Date.now() - overallStart) / 1000).toFixed(2);
  Logger.log('===== 完了: ' + elapsed + '秒 =====');
  Logger.log('配置: ' + writeResult.placedCount + '件 / 警告: ' + writeResult.warningCount + '件 / 未配置: ' + result.unassignedCount + 'スロット');
  
  return {
    targetYM: targetYM,
    elapsed: elapsed,
    placedCount: writeResult.placedCount,
    warningCount: writeResult.warningCount,
    unassignedCount: result.unassignedCount
  };
}

// ============================================================
// テスト用エントリ (実データ書き込みあり)
// ============================================================
function testRunNightShiftEngineV4() {
  Logger.log('=== Step 3.2.6 メインエントリ動作確認 ===');
  Logger.log('注意: T_シフト確定 + V_警告チェック に実データ書き込みします');
  Logger.log('');
  const result = runNightShiftEngineV4('2026-05');
  Logger.log('');
  Logger.log('結果: ' + JSON.stringify(result, null, 2));
}

function debug_check_night_wishes_903() {
  const ctx = loadEngineContextV4('2026-06');
  
  Logger.log('=== 903 の希望 (ctx.wishesByStaff) ===');
  const w903 = (ctx.wishesByStaff && ctx.wishesByStaff['903']) || [];
  Logger.log('件数: ' + w903.length);
  w903.forEach(function(w) {
    Logger.log('  ' + w.dateKey + ' / ' + w.shift + ' / mainFac=' + w.mainFac);
  });
  
  Logger.log('');
  Logger.log('=== wishesByDayShift で夜勤Cキー ===');
  const keys = Object.keys(ctx.wishesByDayShift || {}).filter(function(k) { return k.indexOf('夜勤C') !== -1; });
  Logger.log('夜勤Cキー数: ' + keys.length);
  keys.slice(0, 5).forEach(function(k) {
    Logger.log('  ' + k + ' -> ' + (ctx.wishesByDayShift[k].length) + '件');
  });
}

function debug_check_night_61() {
  const ctx = loadEngineContextV4('2026-06');
  const wishes = ctx.wishesByDayShift['2026-06-01_夜勤C'] || [];
  Logger.log('=== 2026-06-01 夜勤C 希望 ===');
  Logger.log('件数: ' + wishes.length);
  wishes.forEach(function(w) {
    const staff = ctx.staffMap[w.staff_id];
    Logger.log('  staff_id=' + w.staff_id + ' / mainFac=' + w.mainFac + ' / allowed=' + (staff ? staff.allowedShifts.join(',') : '?'));
  });
  
  Logger.log('');
  Logger.log('=== 903 のスロット候補チェック ===');
  const slot = (ctx.slots || []).find(function(s) {
    return s.dateKey === '2026-06-01' && s.unit && s.unit.facility === 'リフレ要町';
  });
  if (!slot) {
    Logger.log('リフレ要町の6/1 slotが見つからない');
    return;
  }
  Logger.log('slot: ' + slot.dateKey + ' / unit=' + slot.unit_name + ' / fac=' + slot.facility + ' / jig=' + slot.jigyosho);
  
  const cands = findCandidatesV4(ctx, slot, '夜勤C');
  Logger.log('候補: ' + cands.length + '件');
  cands.forEach(function(c) {
    Logger.log('  ' + c.staff.staff_id + '(' + c.staff.name + ')');
  });
}

function debug_night_61_step_by_step() {
  const ctx = loadEngineContextV4('2026-06');
  generateSlotsV4(ctx);
  
  const slot = (ctx.slots || []).find(function(s) {
    return s.dateKey === '2026-06-01' && s.facility === 'リフレ要町';
  });
  if (!slot) { Logger.log('リフレ要町slot 6/1 なし'); return; }
  Logger.log('slot: ' + slot.dateKey + ' / unit=' + slot.unit_name + ' / fac=' + slot.facility + ' / jig=' + slot.jigyosho);
  
  const dsKey = '2026-06-01_夜勤C';
  const wishes = ctx.wishesByDayShift[dsKey] || [];
  Logger.log('');
  Logger.log('=== 6/1 夜勤C 希望と各候補のチェック ===');
  
  wishes.forEach(function(w) {
    const staff = ctx.staffMap[w.staff_id];
    if (!staff) { Logger.log(w.staff_id + ': ctx.staffMapにない'); return; }
    
    const reasons = [];
    if (staff.allowedShifts.indexOf('夜勤C') === -1) reasons.push('allowedShifts拒否');
    
    const sameDay = ctx.staffAssignedDates[staff.staff_id][slot.dateKey] || [];
    if (sameDay.length > 0) reasons.push('既配置(' + sameDay.length + ')');
    
    const otherFac = hasOtherFacilityAssignment(staff.staff_id, slot.dateKey, slot.jigyosho, ctx);
    if (otherFac.exists) reasons.push('他事業所配置あり');
    
    Logger.log('  ' + w.staff_id + '(' + staff.name + '): ' + (reasons.length ? reasons.join(',') : 'OK'));
  });
}

function debug_night_assign_trace() {
  const ctx = loadEngineContextV4('2026-06');
  generateSlotsV4(ctx);
  
  let traceCount = 0;
  let totalCands = 0;
  
  for (let si = 0; si < ctx.slots.length && traceCount < 20; si++) {
    const slot = ctx.slots[si];
    if (slot.assignment) continue;
    
    let allCands = [];
    for (const shift of NSE_V4.NIGHT_SHIFTS) {
      const cands = findCandidatesV4(ctx, slot, shift);
      cands.forEach(function(c) { c.shift = shift; });
      allCands = allCands.concat(cands);
    }
    
    if (allCands.length > 0) {
      totalCands += allCands.length;
      if (traceCount < 5) {
        Logger.log('si=' + si + ' ' + slot.dateKey + '/' + slot.unit_name + ' 候補=' + allCands.length);
        allCands.forEach(function(c) {
          Logger.log('  ' + c.staff.staff_id + '(' + c.shift + ')');
        });
      }
      traceCount++;
    }
  }
  
  Logger.log('');
  Logger.log('=== 集計 ===');
  Logger.log('候補ありスロット: ' + traceCount);
  Logger.log('総候補数: ' + totalCands);
  Logger.log('全スロット: ' + ctx.slots.length);
}

function debug_night_full_filter_903() {
  const ctx = loadEngineContextV4('2026-06');
  generateSlotsV4(ctx);
  
  const slot = (ctx.slots || []).find(function(s) {
    return s.dateKey === '2026-06-01' && s.facility === 'リフレ要町';
  });
  if (!slot) { Logger.log('slot なし'); return; }
  
  Logger.log('slot: ' + slot.dateKey + ' / ' + slot.unit_name + ' / ' + slot.facility);
  
  const staff = ctx.staffMap['903'];
  const shiftType = '夜勤C';
  
  Logger.log('');
  Logger.log('=== 903 の filter step-by-step ===');
  
  Logger.log('1. allowedShifts: ' + staff.allowedShifts.join(','));
  Logger.log('   夜勤C含む?: ' + (staff.allowedShifts.indexOf('夜勤C') !== -1));
  
  const sameDay = ctx.staffAssignedDates['903'][slot.dateKey] || [];
  Logger.log('2. sameDayAssigns: ' + sameDay.length + '件');
  
  const otherFac = hasOtherFacilityAssignment('903', slot.dateKey, slot.jigyosho, ctx);
  Logger.log('3. hasOtherFacilityAssignment: ' + otherFac.exists);
  
  const tmpCtx = _v4_makeTempCtx(ctx, '903', slot.dateKey, shiftType, slot);
  const consec = checkConsecutiveDays('903', slot.dateKey, tmpCtx);
  Logger.log('4. checkConsecutiveDays: exceeded=' + consec.exceeded + ' / consec=' + consec.consec);
  
  const addedH = (typeof SHIFT_PATTERNS !== 'undefined' && SHIFT_PATTERNS[shiftType])
    ? (SHIFT_PATTERNS[shiftType].dayHours + SHIFT_PATTERNS[shiftType].nightHours)
    : 8;
  const weekly = checkWeeklyHours('903', slot.dateKey, addedH, ctx);
  Logger.log('5. checkWeeklyHours: exceeded=' + weekly.exceeded + ' / weeklyH=' + weekly.weeklyH + ' / addedH=' + addedH);
}

function debug_compare_score_18_vs_903_61() {
  const ctx = loadEngineContextV4('2026-06');
  generateSlotsV4(ctx);
  
  const slot = (ctx.slots || []).find(function(s) {
    return s.dateKey === '2026-06-01' && s.facility === 'ルーデンス新板橋Ⅱ' && s.unit_name === 'コノヒカラ板橋北区Ⅰ';
  });
  if (!slot) { Logger.log('slotなし'); return; }
  
  Logger.log('slot: ' + slot.dateKey + ' / ' + slot.unit_name + ' / ' + slot.facility + ' / ' + slot.jigyosho);
  Logger.log('');
  
  ['18', '903'].forEach(function(sid) {
    const staff = ctx.staffMap[sid];
    if (!staff) { Logger.log(sid + ': staffMapなし'); return; }
    
    Logger.log('=== staff_id=' + sid + ' (' + staff.name + ') ===');
    Logger.log('  mainFac: ' + staff.mainFac);
    Logger.log('  secondFac: ' + staff.secondFac);
    Logger.log('  subFacs: ' + JSON.stringify(staff.subFacs));
    Logger.log('  qualification: ' + staff.qualification);
    Logger.log('  employment: ' + staff.employment);
    Logger.log('  hireMonths: ' + staff.hireMonths);
    Logger.log('  isProtected: ' + staff.isProtected);
    
    const wish = (ctx.wishesByDayShift['2026-06-01_夜勤C'] || []).find(function(w) { return w.staff_id === sid; });
    if (!wish) { Logger.log('  wish なし'); return; }
    
    const score = calcScoreV4(ctx, staff, wish, slot);
    Logger.log('  >>> SCORE: ' + score);
    Logger.log('');
  });
}

function debug_check_staff_fac_format() {
  const ctx = loadEngineContextV4('2026-06');
  
  ['13', '18', '59', '903'].forEach(function(sid) {
    const staff = ctx.staffMap[sid];
    if (!staff) { Logger.log(sid + ': staffMapなし'); return; }
    
    Logger.log('=== staff_id=' + sid + ' (' + staff.name + ') ===');
    Logger.log('  mainFac: "' + staff.mainFac + '" (type=' + typeof staff.mainFac + ', length=' + (staff.mainFac || '').length + ')');
    Logger.log('  secondFac: "' + staff.secondFac + '" (type=' + typeof staff.secondFac + ')');
    Logger.log('  subFacs: ' + JSON.stringify(staff.subFacs));
    Logger.log('');
  });
  
  // 6/1 リフレ要町 slot を探してmainFac比較
  generateSlotsV4(ctx);
  const refleSlot = (ctx.slots || []).find(function(s) {
    return s.dateKey === '2026-06-01' && s.facility === 'リフレ要町';
  });
  if (refleSlot) {
    Logger.log('=== リフレ要町 slot ===');
    Logger.log('  facility: "' + refleSlot.facility + '" (length=' + refleSlot.facility.length + ')');
    Logger.log('');
    
    const s18 = ctx.staffMap['18'];
    Logger.log('=== 18 vs リフレ要町 比較 ===');
    Logger.log('  staff.mainFac === slot.facility ? ' + (s18.mainFac === refleSlot.facility));
    Logger.log('  staff.mainFac="' + s18.mainFac + '"');
    Logger.log('  slot.facility="' + refleSlot.facility + '"');
  }
}

function debug_check_18_candidate() {
  const ctx = loadEngineContextV4('2026-06');
  generateSlotsV4(ctx);
  
  const slot = (ctx.slots || []).find(function(s) {
    return s.dateKey === '2026-06-01' && s.facility === 'リフレ要町' && s.unit_name === 'コノヒカラⅠ';
  });
  if (!slot) { Logger.log('slotなし'); return; }
  
  Logger.log('slot: ' + slot.dateKey + ' / ' + slot.unit_name + ' / ' + slot.facility);
  
  const cands = findCandidatesV4(ctx, slot, '夜勤C');
  Logger.log('夜勤C候補: ' + cands.length + '件');
  cands.forEach(function(c) {
    Logger.log('  ' + c.staff.staff_id + '(' + c.staff.name + ')');
  });
  
  Logger.log('');
  const candsB = findCandidatesV4(ctx, slot, '夜勤B');
  Logger.log('夜勤B候補: ' + candsB.length + '件');
  candsB.forEach(function(c) {
    Logger.log('  ' + c.staff.staff_id + '(' + c.staff.name + ')');
  });
}

function debug_full_assign_trace_61() {
  const ctx = loadEngineContextV4('2026-06');
  generateSlotsV4(ctx);
  
  const slot = (ctx.slots || []).find(function(s) {
    return s.dateKey === '2026-06-01' && s.facility === 'リフレ要町' && s.unit_name === 'コノヒカラⅠ';
  });
  if (!slot) { Logger.log('slotなし'); return; }
  
  Logger.log('slot: ' + slot.dateKey + ' / ' + slot.unit_name);
  
  // 各夜勤シフトで候補検索 (assignByScoreV4と同じロジック)
  let allCands = [];
  for (const shift of NSE_V4.NIGHT_SHIFTS) {
    const cands = findCandidatesV4(ctx, slot, shift);
    cands.forEach(function(c) {
      c.score = calcScoreV4(ctx, c.staff, c.wish, slot);
      c.warnings = checkAllRWarningsV4(c.staff, slot, shift, ctx);
      c.shift = shift;
    });
    Logger.log(shift + ': ' + cands.length + '件');
    cands.forEach(function(c) {
      Logger.log('  ' + c.staff.staff_id + '(' + c.staff.name + ') / score=' + c.score + ' / warnings=' + c.warnings.length);
    });
    allCands = allCands.concat(cands);
  }
  
  Logger.log('');
  Logger.log('全候補: ' + allCands.length);
  
  if (allCands.length === 0) {
    Logger.log('候補ゼロのため未配置');
    return;
  }
  
  allCands.sort(function(a, b) {
    const aVIP = a.staff.isVIP ? 1 : 0;
    const bVIP = b.staff.isVIP ? 1 : 0;
    if (aVIP !== bVIP) return bVIP - aVIP;
    const aNoWarn = (a.warnings.length === 0) ? 1 : 0;
    const bNoWarn = (b.warnings.length === 0) ? 1 : 0;
    if (aNoWarn !== bNoWarn) return bNoWarn - aNoWarn;
    return b.score - a.score;
  });
  
  const top = allCands[0];
  Logger.log('最優先: ' + top.staff.staff_id + ' / shift=' + top.shift + ' / score=' + top.score);
}

function debug_check_18_assigned_dates() {
  const ctx = loadEngineContextV4('2026-06');
  const dates = ctx.staffAssignedDates['18'] || {};
  Logger.log('=== 18 staffAssignedDates ===');
  Object.keys(dates).forEach(function(k) {
    Logger.log('  ' + k + ': ' + JSON.stringify(dates[k]));
  });
  Logger.log('total: ' + Object.keys(dates).length);
}

function debug_check_18_assigned_dates() {
  const ctx = loadEngineContextV4('2026-06');
  const dates = ctx.staffAssignedDates['18'] || {};
  Logger.log('=== 18 staffAssignedDates ===');
  Object.keys(dates).forEach(function(k) {
    Logger.log('  ' + k + ': ' + JSON.stringify(dates[k]));
  });
  Logger.log('total: ' + Object.keys(dates).length);
}

function debug_count_t_shift_2026_06() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('T_シフト確定');
  const data = sheet.getDataRange().getValues();
  let count = 0;
  let nightCount = 0;
  for (let i = 1; i < data.length; i++) {
    const date = data[i][1];
    if (!(date instanceof Date)) continue;
    const ym = Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy-MM');
    if (ym !== '2026-06') continue;
    count++;
    const shift = String(data[i][8] || '');
    if (shift.indexOf('夜勤') !== -1) nightCount++;
  }
  Logger.log('T_シフト確定 2026-06: ' + count + '件 (うち夜勤: ' + nightCount + '件)');
}

function debug_check_all_assigned_dates() {
  const ctx = loadEngineContextV4('2026-06');
  
  ['13', '18', '59', '903'].forEach(function(sid) {
    const dates = ctx.staffAssignedDates[sid] || {};
    Logger.log('=== staff_id=' + sid + ' staffAssignedDates ===');
    Object.keys(dates).forEach(function(k) {
      Logger.log('  ' + k + ': ' + JSON.stringify(dates[k]));
    });
    Logger.log('total: ' + Object.keys(dates).length + '日');
    Logger.log('');
  });
}

function debug_check_night_e_col() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('T_シフト確定');
  const data = sheet.getDataRange().getValues();
  
  let count = 0;
  const byStaff = {};
  const byFacility = {};
  const byUnit = {};
  const samples = [];
  
  for (let i = 1; i < data.length; i++) {
    const date = data[i][1];
    if (!(date instanceof Date)) continue;
    const ym = Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy-MM');
    if (ym !== '2026-06') continue;
    
    const shift = String(data[i][8] || '');
    if (shift.indexOf('夜勤') === -1) continue;
    
    count++;
    const sid = String(data[i][6] || '');
    const fac = String(data[i][4] || '');
    const unit = String(data[i][5] || '');
    const dateStr = Utilities.formatDate(date, 'Asia/Tokyo', 'MM/dd');
    
    byStaff[sid] = (byStaff[sid] || 0) + 1;
    byFacility[fac] = (byFacility[fac] || 0) + 1;
    byUnit[unit] = (byUnit[unit] || 0) + 1;
    
    if (samples.length < 35) {
      samples.push(dateStr + ' ' + shift + ' / ' + sid + ' / ' + fac + ' / ' + unit);
    }
  }
  
  Logger.log('=== 2026-06 夜勤配置確認 ===');
  Logger.log('総夜勤配置: ' + count);
  Logger.log('');
  Logger.log('=== スタッフ別 ===');
  Object.keys(byStaff).forEach(function(k) { Logger.log('  staff_id=' + k + ': ' + byStaff[k] + '件'); });
  Logger.log('');
  Logger.log('=== 施設別 ===');
  Object.keys(byFacility).forEach(function(k) { Logger.log('  ' + k + ': ' + byFacility[k] + '件'); });
  Logger.log('');
  Logger.log('=== ユニット別 ===');
  Object.keys(byUnit).forEach(function(k) { Logger.log('  ' + k + ': ' + byUnit[k] + '件'); });
  Logger.log('');
  Logger.log('=== 配置詳細 ===');
  samples.forEach(function(s) { Logger.log('  ' + s); });
}

function debug_check_18_at_itabashi() {
  const ctx = loadEngineContextV4('2026-06');
  generateSlotsV4(ctx);
  
  const slot = (ctx.slots || []).find(function(s) {
    return s.dateKey === '2026-06-01' && s.facility === 'ルーデンス新板橋Ⅱ' && s.unit_name === 'コノヒカラ板橋北区Ⅰ';
  });
  if (!slot) { Logger.log('slotなし'); return; }
  
  Logger.log('slot: ' + slot.dateKey + ' / ' + slot.unit_name + ' / ' + slot.facility);
  
  const cands = findCandidatesV4(ctx, slot, '夜勤C');
  Logger.log('夜勤C候補: ' + cands.length + '件');
  cands.forEach(function(c) {
    Logger.log('  ' + c.staff.staff_id + '(' + c.staff.name + ') / mainFac=' + c.staff.mainFac + ' / subFacs=' + JSON.stringify(c.staff.subFacs));
  });
  
  // 18のmainFacとslot.facilityの直接比較
  const s18 = ctx.staffMap['18'];
  Logger.log('');
  Logger.log('=== 18 vs ルーデンス新板橋Ⅱ ===');
  Logger.log('  staff.mainFac="' + s18.mainFac + '"');
  Logger.log('  slot.facility="' + slot.facility + '"');
  Logger.log('  match: ' + (s18.mainFac === slot.facility));
  Logger.log('  subFacs: ' + JSON.stringify(s18.subFacs));
}

function debug_check_full_engine_run() {
  const ctx = loadEngineContextV4('2026-06');
  generateSlotsV4(ctx);
  
  const result = assignByScoreV4(ctx);
  Logger.log('=== assignByScoreV4 結果 ===');
  Logger.log('  assignedCount: ' + result.assignedCount);
  Logger.log('');
  
  // 採用されたslotを抽出 (先頭10件)
  let placed = 0;
  Logger.log('=== 採用slot (assignment付き) ===');
  ctx.slots.forEach(function(s) {
    if (s.assignment) {
      placed++;
      if (placed <= 10) {
        Logger.log('  ' + s.dateKey + ' / unit=' + s.unit_name + ' / slot.facility=' + s.facility + ' / staff=' + s.assignment.staff_id + ' / shift=' + s.assignment.shift);
      }
    }
  });
  Logger.log('placed total: ' + placed);
}

function debug_check_t_shift_e_col() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('T_シフト確定');
  const data = sheet.getDataRange().getValues();
  
  Logger.log('=== T_シフト確定 ヘッダー ===');
  for (let i = 0; i < data[0].length; i++) {
    Logger.log('  [' + i + '] ' + data[0][i]);
  }
  
  Logger.log('');
  Logger.log('=== 2026-06 夜勤レコード 先頭3件の全列 ===');
  let count = 0;
  for (let i = 1; i < data.length; i++) {
    const date = data[i][1];
    if (!(date instanceof Date)) continue;
    const ym = Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy-MM');
    if (ym !== '2026-06') continue;
    const shift = String(data[i][8] || '');
    if (shift.indexOf('夜勤') === -1) continue;
    
    count++;
    if (count > 3) break;
    
    Logger.log('--- レコード ' + count + ' ---');
    for (let j = 0; j < data[0].length; j++) {
      Logger.log('  [' + j + ']' + data[0][j] + ': ' + data[i][j]);
    }
  }
}

function debug_check_t_shift_e_col() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('T_シフト確定');
  const data = sheet.getDataRange().getValues();
  
  Logger.log('=== T_シフト確定 ヘッダー ===');
  for (let i = 0; i < data[0].length; i++) {
    Logger.log('  [' + i + '] ' + data[0][i]);
  }
  
  Logger.log('');
  Logger.log('=== 2026-06 夜勤レコード 先頭3件 ===');
  let count = 0;
  for (let i = 1; i < data.length; i++) {
    const date = data[i][1];
    if (!(date instanceof Date)) continue;
    const ym = Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy-MM');
    if (ym !== '2026-06') continue;
    const shift = String(data[i][8] || '');
    if (shift.indexOf('夜勤') === -1) continue;
    
    count++;
    if (count > 3) break;
    
    Logger.log('--- レコード ' + count + ' ---');
    for (let j = 0; j < data[0].length; j++) {
      Logger.log('  [' + j + '] ' + data[0][j] + ': ' + data[i][j]);
    }
  }
}
