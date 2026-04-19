// ============================================
// 夜勤自動割当エンジン v3 (2026-04-19)
// Part 1: 定数・ヘルパー・Phase 0-3
//
// 注意: Part 2 (nightshift_engine_v3_part2.gs) と組み合わせて動作
// ============================================

// ===== 定数 =====
const NSE = {
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
  COL_REQ_FREQ_TYPE: 11,
  COL_REQ_FREQ_COUNT: 12,
  
  // シフト時間定義
  SHIFT_TIMES: {
    '夜勤A': { start: '20:00', end: '05:00', isNight: true },
    '夜勤B': { start: '22:00', end: '07:00', isNight: true },
    '夜勤C': { start: '22:00', end: '08:00', isNight: true },
    '日勤早出': { start: '06:00', end: '15:00', isNight: false },
    '日勤遅出': { start: '13:00', end: '22:00', isNight: false },
  },
  
  // スコア係数
  SCORE: {
    MAIN_FAC: 30,
    SECOND_FAC: 20,
    SUB_FAC: 10,
    QUALIFIED: 10,
    FULL_TIME: 5,
    MONTH_X: 2,
    SKILL_X: 3,
    PROTECTED_ZERO: 50,
    PROTECTED_OTHER: 15,
    NEWBIE1: -30,
    NEWBIE2: -10,
    CONCENTRATION_X: -5,
    VIP: 10000,
  },
  
  // エンジン挙動
  HISTORY_MONTHS: 3,
  MAX_CONSECUTIVE: 6,
};


// ============================================
// メインエントリーポイント
// ============================================
function runNightShiftEngine(targetYM) {
  if (!targetYM) {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    targetYM = next.getFullYear() + '-' + String(next.getMonth() + 1).padStart(2, '0');
  }
  
  Logger.log('========================================');
  Logger.log('[START] 夜勤自動割当エンジン v3');
  Logger.log('  対象月: ' + targetYM);
  Logger.log('========================================');
  
  try {
    Logger.log('[Phase 0] データロード開始');
    const ctx = loadEngineContext(targetYM);
    Logger.log('  スタッフ: ' + Object.keys(ctx.staffMap).length + '人');
    Logger.log('  ユニット: ' + ctx.units.length + '個');
    Logger.log('  希望提出: ' + ctx.wishes.length + '件');
    Logger.log('  提出スタッフ: ' + Object.keys(ctx.wishesByStaff).length + '人');
    Logger.log('  過去3ヶ月実績: ' + ctx.historyCount + '件');
    
    Logger.log('[Phase 1] 空き枠生成');
    generateSlots(ctx);
    Logger.log('  生成枠数: ' + ctx.slots.length + '枠 (' + ctx.daysInMonth + '日 x ' + ctx.units.length + 'ユニット)');
    
    Logger.log('[Phase 2] 保護スタッフ優先配置');
    const protectedRes = assignProtectedStaff(ctx);
    Logger.log('  保護対象: ' + protectedRes.candidates + '人');
    Logger.log('  配置成功: ' + protectedRes.assigned + '人');
    Logger.log('  配置失敗: ' + protectedRes.failed + '人');
    
    Logger.log('[Phase 3] VIP配置');
    const vipRes = assignVIPStaff(ctx);
    Logger.log('  VIP対象: ' + vipRes.candidates + '人');
    Logger.log('  VIP希望件数: ' + vipRes.totalWishes + '件');
    Logger.log('  配置成功: ' + vipRes.assigned + '件');
    
    if (typeof assignByScore === 'function') {
      Logger.log('[Phase 4] スコア順配置');
      const scoreRes = assignByScore(ctx);
      Logger.log('  配置成功: ' + scoreRes.assigned + '枠');
      Logger.log('  未配置: ' + scoreRes.unfilled + '枠');
      
      Logger.log('[Phase 5] 衝突チェック');
      const conflictRes = checkConflicts(ctx);
      Logger.log('  検出: ' + conflictRes.count + '件');
      
      Logger.log('[Phase 6] 書き込み');
      const writeRes = writeShiftResults(ctx);
      Logger.log('  書き込み: ' + writeRes.count + '件 (status=仮)');
      
      Logger.log('[Phase 7] 検証シート生成');
      const verifyRes = generateVerificationSheets(ctx);
      Logger.log('  V_充足確認: ' + verifyRes.satisfied + '枠 / ' + ctx.slots.length + '枠');
      Logger.log('  V_重複チェック: ' + verifyRes.duplicates + '件');
    } else {
      Logger.log('注意: Part 2が未ロード。Phase 3までで停止。');
    }
    
    Logger.log('========================================');
    Logger.log('[DONE] エンジン実行完了');
    Logger.log('========================================');
    
    return { success: true, ctx: ctx };
    
  } catch (error) {
    Logger.log('[ERROR] ' + error.toString());
    Logger.log(error.stack);
    return { success: false, error: error.toString() };
  }
}


// ============================================
// Phase 0: データロード
// ============================================
function loadEngineContext(targetYM) {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const [year, month] = targetYM.split('-').map(Number);
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
    staffAssignedDates: {},
    slots: [],
    slotsByKey: {},
    warnings: [],
  };
  
  // 1. M_ユニット
  const unitSheet = ss.getSheetByName('M_ユニット');
  const unitData = unitSheet.getDataRange().getValues();
  for (let i = 1; i < unitData.length; i++) {
    if (!unitData[i][NSE.COL_UNIT_ID]) continue;
    const unit = {
      unit_id: unitData[i][NSE.COL_UNIT_ID],
      jigyosho: unitData[i][NSE.COL_UNIT_JIGYOSHO],
      unit_name: unitData[i][NSE.COL_UNIT_NAME],
      facility: unitData[i][NSE.COL_UNIT_FACILITY],
      capacity: unitData[i][NSE.COL_UNIT_CAPACITY],
      room: unitData[i][NSE.COL_UNIT_ROOM],
    };
    ctx.units.push(unit);
    if (!ctx.unitsByFacility[unit.facility]) {
      ctx.unitsByFacility[unit.facility] = [];
    }
    ctx.unitsByFacility[unit.facility].push(unit);
  }
  
  // 2. M_スタッフ
  const staffSheet = ss.getSheetByName('M_スタッフ');
  const staffData = staffSheet.getDataRange().getValues();
  for (let i = 1; i < staffData.length; i++) {
    const row = staffData[i];
    if (!row[NSE.COL_STAFF_ID]) continue;
    const retired = String(row[NSE.COL_STAFF_RETIRED]).toUpperCase() === 'TRUE';
    if (retired) continue;
    
    const staffId = String(row[NSE.COL_STAFF_ID]).trim();
    const allowedRaw = String(row[NSE.COL_STAFF_ALLOWED] || '');
    const subRaw = String(row[NSE.COL_STAFF_SUB] || '');
    const kubun = String(row[NSE.COL_STAFF_KUBUN] || '').trim();
    
    ctx.staffMap[staffId] = {
      staff_id: staffId,
      name: row[NSE.COL_STAFF_NAME],
      employment: String(row[NSE.COL_STAFF_EMPLOYMENT] || '').trim(),
      qualification: String(row[NSE.COL_STAFF_QUALIFICATION] || '').trim(),
      hireMonths: Number(row[NSE.COL_STAFF_HIRE_MONTHS]) || 0,
      kubun: kubun,
      mainFac: String(row[NSE.COL_STAFF_MAIN] || '').trim(),
      secondFac: String(row[NSE.COL_STAFF_SECOND] || '').trim(),
      subFacs: subRaw ? subRaw.split(',').map(s => s.trim()).filter(Boolean) : [],
      shiftKubun: String(row[NSE.COL_STAFF_SHIFT_KUBUN] || '').trim(),
      allowedShifts: allowedRaw ? allowedRaw.split(',').map(s => s.trim()).filter(Boolean) : [],
      isProtected: String(row[NSE.COL_STAFF_PROTECTED]).toUpperCase() === 'TRUE',
      isVIP: String(row[NSE.COL_STAFF_VIP]).toUpperCase() === 'TRUE',
      isNewbie1: kubun === '新人1ヶ月',
      isNewbie2: kubun === '新人2ヶ月',
    };
    ctx.monthlyAssign[staffId] = 0;
    ctx.staffAssignedDates[staffId] = {};
  }
  
  // 3. T_希望提出 (対象月のみ)
  const reqSheet = ss.getSheetByName('T_希望提出');
  const reqData = reqSheet.getDataRange().getValues();
  for (let i = 1; i < reqData.length; i++) {
    const row = reqData[i];
    if (!row[NSE.COL_REQ_ID]) continue;
    
    const ym = normalizeYM(row[NSE.COL_REQ_YM]);
    if (ym !== targetYM) continue;
    
    const staffId = String(row[NSE.COL_REQ_STAFF_ID]).trim();
    if (!ctx.staffMap[staffId]) continue;
    
    const date = row[NSE.COL_REQ_DATE];
    if (!(date instanceof Date)) continue;
    const dateKey = Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy-MM-dd');
    
    const shift = String(row[NSE.COL_REQ_SHIFT] || '').trim();
    if (!NSE.SHIFT_TIMES[shift]) continue;
    
    const subRaw = String(row[NSE.COL_REQ_SUB] || '');
    
    const wish = {
      requestId: row[NSE.COL_REQ_ID],
      staff_id: staffId,
      name: row[NSE.COL_REQ_NAME],
      date: date,
      dateKey: dateKey,
      shift: shift,
      mainFac: String(row[NSE.COL_REQ_MAIN] || '').trim(),
      secondFac: String(row[NSE.COL_REQ_SECOND] || '').trim(),
      subFacs: subRaw ? subRaw.split(',').map(s => s.trim()).filter(Boolean) : [],
      comment: row[NSE.COL_REQ_COMMENT] || '',
      freqType: row[NSE.COL_REQ_FREQ_TYPE] || '',
      freqCount: Number(row[NSE.COL_REQ_FREQ_COUNT]) || 0,
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
  
  // 4. 過去3ヶ月の確定シフト実績
  const shiftSheet = ss.getSheetByName('T_シフト確定');
  if (shiftSheet && shiftSheet.getLastRow() > 1) {
    const now = new Date();
    const historyStart = new Date(now.getFullYear(), now.getMonth() - NSE.HISTORY_MONTHS, 1);
    
    const shiftData = shiftSheet.getDataRange().getValues();
    for (let i = 1; i < shiftData.length; i++) {
      const row = shiftData[i];
      const date = row[1];
      if (!(date instanceof Date)) continue;
      if (date < historyStart || date >= new Date(ctx.year, ctx.month - 1, 1)) continue;
      
      const staffId = String(row[6] || '').trim();
      const facility = String(row[4] || '').trim();
      if (!staffId || !facility) continue;
      
      if (!ctx.history3m[staffId]) ctx.history3m[staffId] = {};
      ctx.history3m[staffId][facility] = (ctx.history3m[staffId][facility] || 0) + 1;
      ctx.historyCount++;
    }
  }
  
  return ctx;
}


// ============================================
// Phase 1: 空き枠生成
// ============================================
function generateSlots(ctx) {
  for (let day = 1; day <= ctx.daysInMonth; day++) {
    const dateKey = ctx.year + '-' + String(ctx.month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    const date = new Date(dateKey + 'T00:00:00');
    
    for (const unit of ctx.units) {
      const slot = {
        date: date,
        dateKey: dateKey,
        unit: unit,
        staff_id: null,
        staff_name: null,
        shift: null,
        assignReason: null,
        score: null,
      };
      ctx.slots.push(slot);
      ctx.slotsByKey[dateKey + '_' + unit.unit_id] = slot;
    }
  }
}


// ============================================
// Phase 2: 保護スタッフ優先配置
// ============================================
function assignProtectedStaff(ctx) {
  const protectedStaff = Object.values(ctx.staffMap).filter(s => s.isProtected);
  
  let assigned = 0, failed = 0;
  
  for (const staff of protectedStaff) {
    if (ctx.monthlyAssign[staff.staff_id] > 0) continue;
    
    const wishes = ctx.wishesByStaff[staff.staff_id] || [];
    if (wishes.length === 0) {
      failed++;
      ctx.warnings.push('[保護未配置] ' + staff.name + '(ID=' + staff.staff_id + ') は希望を提出していません');
      continue;
    }
    
    const shuffledWishes = wishes.slice();
    shuffleForEngine(shuffledWishes);
    
    let placed = false;
    for (const wish of shuffledWishes) {
      const slot = findAvailableSlotForWish(ctx, staff, wish);
      if (slot) {
        assignSlot(ctx, slot, staff, wish, 'protected', 9999);
        assigned++;
        placed = true;
        break;
      }
    }
    
    if (!placed) {
      failed++;
      ctx.warnings.push('[保護未配置] ' + staff.name + '(ID=' + staff.staff_id + ') 希望 ' + wishes.length + '件 全て空き枠なし');
    }
  }
  
  return { candidates: protectedStaff.length, assigned: assigned, failed: failed };
}


// ============================================
// Phase 3: VIP配置
// ============================================
function assignVIPStaff(ctx) {
  const vipStaff = Object.values(ctx.staffMap).filter(s => s.isVIP);
  
  let totalWishes = 0, assigned = 0;
  
  for (const staff of vipStaff) {
    const wishes = ctx.wishesByStaff[staff.staff_id] || [];
    totalWishes += wishes.length;
    
    for (const wish of wishes) {
      if (ctx.staffAssignedDates[staff.staff_id][wish.dateKey]) continue;
      
      const slot = findAvailableSlotForWish(ctx, staff, wish);
      if (slot) {
        assignSlot(ctx, slot, staff, wish, 'vip', NSE.SCORE.VIP);
        assigned++;
      } else {
        ctx.warnings.push('[VIP未配置] ' + staff.name + '(ID=' + staff.staff_id + ') ' + wish.dateKey + ' ' + wish.shift + ' 空き枠なし');
      }
    }
  }
  
  return { candidates: vipStaff.length, totalWishes: totalWishes, assigned: assigned };
}


// ============================================
// ヘルパー関数
// ============================================
function findAvailableSlotForWish(ctx, staff, wish) {
  const facPriority = [];
  if (wish.mainFac) facPriority.push(wish.mainFac);
  if (wish.secondFac && wish.secondFac !== wish.mainFac) facPriority.push(wish.secondFac);
  for (const sub of wish.subFacs) {
    if (sub && facPriority.indexOf(sub) < 0) facPriority.push(sub);
  }
  
  for (const fac of facPriority) {
    const units = ctx.unitsByFacility[fac] || [];
    for (const unit of units) {
      const key = wish.dateKey + '_' + unit.unit_id;
      const slot = ctx.slotsByKey[key];
      if (slot && !slot.staff_id) {
        return slot;
      }
    }
  }
  
  return null;
}


function assignSlot(ctx, slot, staff, wish, reason, score) {
  slot.staff_id = staff.staff_id;
  slot.staff_name = staff.name;
  slot.shift = wish.shift;
  slot.assignReason = reason;
  slot.score = score;
  
  ctx.monthlyAssign[staff.staff_id] = (ctx.monthlyAssign[staff.staff_id] || 0) + 1;
  
  if (!ctx.staffAssignedDates[staff.staff_id][slot.dateKey]) {
    ctx.staffAssignedDates[staff.staff_id][slot.dateKey] = [];
  }
  ctx.staffAssignedDates[staff.staff_id][slot.dateKey].push(slot);
}


function shuffleForEngine(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}


// テスト用
function testPhase0to3() {
  return runNightShiftEngine('2026-05');
}
