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
// ============================================
// 夜勤自動割当エンジン v3 (2026-04-19)
// Part 2: Phase 4-7
//
// 注意: Part 1 (nightshift_engine_v3.gs) と組み合わせて動作
// ============================================

// ============================================
// Phase 4: スコア順配置 (メイン処理)
// 各空き枠を「その日希望を出したスタッフ」でスコア評価して最適な人を割当
// ============================================
function assignByScore(ctx) {
  let assigned = 0;
  
  // 日付順に処理 (連続勤務判定が正確になるよう前から順に)
  const slotsSorted = ctx.slots.slice().sort((a, b) => {
    if (a.dateKey !== b.dateKey) return a.dateKey.localeCompare(b.dateKey);
    return String(a.unit.unit_id).localeCompare(String(b.unit.unit_id));
  });
  
  for (const slot of slotsSorted) {
    if (slot.staff_id) continue; // 既に保護/VIPで配置済み
    
    // この日この施設希望のスタッフを候補に
    const candidates = findCandidatesForSlot(ctx, slot);
    
    if (candidates.length === 0) {
      ctx.warnings.push('[未配置] ' + slot.dateKey + ' ' + slot.unit.unit_name + ' (' + slot.unit.facility + ') 候補者なし');
      continue;
    }
    
    // スコア計算 + フィルタリング(衝突回避)
    const scored = [];
    for (const cand of candidates) {
      const staff = ctx.staffMap[cand.staff_id];
      if (!staff) continue;
      
      // 衝突チェック: 同日既に配置済み
      if (ctx.staffAssignedDates[staff.staff_id][slot.dateKey] && 
          ctx.staffAssignedDates[staff.staff_id][slot.dateKey].length > 0) continue;
      
      // 衝突チェック: 夜勤翌日に日勤入ってたらNG(逆もNG)
      if (hasConflictWithAdjacentDay(ctx, staff, slot, cand.wish)) continue;
      
      // 連続勤務チェック
      if (hasConsecutiveWorkExceeded(ctx, staff, slot)) continue;
      
      const score = calcScore(ctx, staff, cand.wish, slot);
      scored.push({ staff: staff, wish: cand.wish, score: score });
    }
    
    if (scored.length === 0) {
      ctx.warnings.push('[未配置] ' + slot.dateKey + ' ' + slot.unit.unit_name + ' 衝突/連続勤務で全員NG');
      continue;
    }
    
    // スコア降順で最高点を選ぶ (同点はランダム)
    scored.sort((a, b) => b.score - a.score);
    const topScore = scored[0].score;
    const topCandidates = scored.filter(c => c.score === topScore);
    const chosen = topCandidates[Math.floor(Math.random() * topCandidates.length)];
    
    assignSlot(ctx, slot, chosen.staff, chosen.wish, 'score', chosen.score);
    assigned++;
  }
  
  const unfilled = ctx.slots.filter(s => !s.staff_id).length;
  return { assigned: assigned, unfilled: unfilled };
}


// ============================================
// 候補者抽出: このスロットに希望を出している人たち
// ============================================
function findCandidatesForSlot(ctx, slot) {
  const candidates = [];
  const seen = {};
  
  // この日この施設に希望を出してる人を抽出
  for (const wish of ctx.wishes) {
    if (wish.dateKey !== slot.dateKey) continue;
    
    // 希望先の施設がこのスロットの施設と一致するか
    const wishFacs = [];
    if (wish.mainFac) wishFacs.push(wish.mainFac);
    if (wish.secondFac) wishFacs.push(wish.secondFac);
    for (const sub of wish.subFacs) wishFacs.push(sub);
    
    if (wishFacs.indexOf(slot.unit.facility) < 0) continue;
    
    // スタッフの許可シフト種別にこのシフトが含まれるか
    const staff = ctx.staffMap[wish.staff_id];
    if (!staff) continue;
    if (staff.allowedShifts.indexOf(wish.shift) < 0) continue;
    
    // 夜勤エンジンなので夜勤シフトのみ
    if (!NSE.SHIFT_TIMES[wish.shift] || !NSE.SHIFT_TIMES[wish.shift].isNight) continue;
    
    // 重複排除
    const key = wish.staff_id + '_' + wish.shift;
    if (seen[key]) continue;
    seen[key] = true;
    
    candidates.push({ staff_id: wish.staff_id, wish: wish });
  }
  
  return candidates;
}


// ============================================
// スコア計算 (6段階式)
// ============================================
function calcScore(ctx, staff, wish, slot) {
  let score = 0;
  const fac = slot.unit.facility;
  
  // 施設マッチング
  if (staff.mainFac === fac) score += NSE.SCORE.MAIN_FAC;
  else if (staff.secondFac === fac) score += NSE.SCORE.SECOND_FAC;
  else if (staff.subFacs.indexOf(fac) >= 0) score += NSE.SCORE.SUB_FAC;
  
  // 国家資格
  if (staff.qualification) score += NSE.SCORE.QUALIFIED;
  
  // 正社員
  if (staff.employment === '正社員') score += NSE.SCORE.FULL_TIME;
  
  // 勤務歴月数
  score += (staff.hireMonths || 0) * NSE.SCORE.MONTH_X;
  
  // 施設熟練度 (過去3ヶ月の同施設勤務回数)
  const skillCount = (ctx.history3m[staff.staff_id] || {})[fac] || 0;
  score += skillCount * NSE.SCORE.SKILL_X;
  
  // 保護フラグ
  if (staff.isProtected) {
    if ((ctx.monthlyAssign[staff.staff_id] || 0) === 0) {
      score += NSE.SCORE.PROTECTED_ZERO;
    } else {
      score += NSE.SCORE.PROTECTED_OTHER;
    }
  }
  
  // 新人
  if (staff.isNewbie1) score += NSE.SCORE.NEWBIE1;
  else if (staff.isNewbie2) score += NSE.SCORE.NEWBIE2;
  
  // 当月集中度 (配置回数多いほどスコアダウン)
  const concentration = ctx.monthlyAssign[staff.staff_id] || 0;
  score += concentration * NSE.SCORE.CONCENTRATION_X;
  
  // VIP
  if (staff.isVIP) score += NSE.SCORE.VIP;
  
  return score;
}


// ============================================
// 衝突チェック: 隣接日との勤務時間重複
// ============================================
function hasConflictWithAdjacentDay(ctx, staff, slot, wish) {
  const shiftInfo = NSE.SHIFT_TIMES[wish.shift];
  if (!shiftInfo) return false;
  
  // 今回が夜勤 -> 翌日に早朝勤務(日勤早出など)あるとNG
  if (shiftInfo.isNight) {
    const nextDay = addDays(slot.dateKey, 1);
    const nextAssigns = ctx.staffAssignedDates[staff.staff_id][nextDay] || [];
    for (const a of nextAssigns) {
      // 翌日の開始時刻が今回の終了時刻より早いとNG
      // 夜勤A終了05:00、夜勤B終了07:00、夜勤C終了08:00
      // 日勤早出開始06:00 -> 夜勤B/Cとは衝突する
      if (a.shift && NSE.SHIFT_TIMES[a.shift] && !NSE.SHIFT_TIMES[a.shift].isNight) {
        return true;
      }
    }
  }
  
  // 今回が日勤 -> 前日の夜勤B/Cが終わってないとNG
  if (!shiftInfo.isNight) {
    const prevDay = addDays(slot.dateKey, -1);
    const prevAssigns = ctx.staffAssignedDates[staff.staff_id][prevDay] || [];
    for (const a of prevAssigns) {
      if (a.shift && NSE.SHIFT_TIMES[a.shift] && NSE.SHIFT_TIMES[a.shift].isNight) {
        return true;
      }
    }
  }
  
  return false;
}


// ============================================
// 連続勤務チェック: 上限超過
// ============================================
function hasConsecutiveWorkExceeded(ctx, staff, slot) {
  let count = 1; // この日自体
  for (let i = 1; i <= NSE.MAX_CONSECUTIVE; i++) {
    const d = addDays(slot.dateKey, -i);
    if ((ctx.staffAssignedDates[staff.staff_id][d] || []).length > 0) count++;
    else break;
  }
  return count > NSE.MAX_CONSECUTIVE;
}


function addDays(dateKey, delta) {
  const d = new Date(dateKey + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd');
}


// ============================================
// Phase 5: 衝突チェック (検証)
// ============================================
function checkConflicts(ctx) {
  const conflicts = [];
  
  // 同日同スタッフ複数配置をチェック
  for (const staffId of Object.keys(ctx.staffAssignedDates)) {
    const dates = ctx.staffAssignedDates[staffId];
    for (const dateKey of Object.keys(dates)) {
      if (dates[dateKey].length > 1) {
        conflicts.push({
          type: 'same_day_multi',
          staffId: staffId,
          name: ctx.staffMap[staffId].name,
          dateKey: dateKey,
          slots: dates[dateKey],
        });
      }
    }
  }
  
  ctx.conflicts = conflicts;
  return { count: conflicts.length, conflicts: conflicts };
}


// ============================================
// Phase 6: T_シフト確定に書き込み (status=仮)
// ============================================
function writeShiftResults(ctx) {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('T_シフト確定');
  
  // 既存データ取得 (対象月以外を保持するため)
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  let preservedRows = [];
  
  if (lastRow > 1 && lastCol > 0) {
    const existingData = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
    for (const row of existingData) {
      const d = row[1]; // B列: 日付
      if (!(d instanceof Date)) {
        // 日付不正な行は対象月ではないので保持 (安全側)
        if (row[0]) preservedRows.push(row);
        continue;
      }
      // 対象月と一致しない行は保持
      if (d.getFullYear() !== ctx.year || d.getMonth() !== ctx.month - 1) {
        preservedRows.push(row);
      }
      // 対象月の行は破棄 (preservedRowsに追加しない)
    }
    
    // シート全体のデータ部をクリア (ヘッダーは残す)
    sheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();
    
    // 他月のデータを復元
    if (preservedRows.length > 0) {
      sheet.getRange(2, 1, preservedRows.length, preservedRows[0].length).setValues(preservedRows);
    }
  }
  
  // ヘッダーがない場合は作成
  if (sheet.getLastRow() === 0) {
    const headers = [
      'shift_id', '日付', 'unit_id', '事業所名', '施設名', 'ユニット名',
      'staff_id', '氏名', 'シフト種別', '開始時刻', '終了時刻',
      '配置カウント', 'ステータス', '更新日時',
    ];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold').setBackground('#4a148c').setFontColor('#ffffff');
  }
  
  const now = new Date();
  const rows = [];
  let counter = 1;
  
  for (const slot of ctx.slots) {
    if (!slot.staff_id) continue; // 未配置はスキップ
    
    const shiftInfo = NSE.SHIFT_TIMES[slot.shift] || { start: '', end: '' };
    const shiftId = 'SHIFT_' + ctx.targetYM + '_' + String(counter++).padStart(4, '0');
    
    rows.push([
      shiftId,
      slot.date,
      slot.unit.unit_id,
      slot.unit.jigyosho,
      slot.unit.facility,
      slot.unit.unit_name,
      slot.staff_id,
      slot.staff_name,
      slot.shift,
      shiftInfo.start,
      shiftInfo.end,
      1, // 配置カウント
      '仮', // ステータス
      now,
    ]);
  }
  
  if (rows.length > 0) {
    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, rows.length, 14).setValues(rows);
    // 日付列フォーマット
    sheet.getRange(startRow, 2, rows.length, 1).setNumberFormat('yyyy-MM-dd');
    // 更新日時フォーマット
    sheet.getRange(startRow, 14, rows.length, 1).setNumberFormat('yyyy-MM-dd HH:mm:ss');
  }
  
  SpreadsheetApp.flush();
  return { count: rows.length };
}


// ============================================
// Phase 7: 検証シート生成 (V_重複チェック / V_充足確認)
// ============================================
function generateVerificationSheets(ctx) {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  
  // --- V_重複チェック ---
  let dupSheet = ss.getSheetByName('V_重複チェック');
  if (!dupSheet) {
    dupSheet = ss.insertSheet('V_重複チェック');
  } else {
    dupSheet.clear();
  }
  const dupHeaders = ['日付', 'staff_id', '氏名', '配置ユニット数', '施設リスト', 'シフトリスト'];
  dupSheet.getRange(1, 1, 1, dupHeaders.length).setValues([dupHeaders]);
  dupSheet.getRange(1, 1, 1, dupHeaders.length)
    .setFontWeight('bold').setBackground('#ef4444').setFontColor('#ffffff');
  
  const dupRows = [];
  for (const staffId of Object.keys(ctx.staffAssignedDates)) {
    const dates = ctx.staffAssignedDates[staffId];
    for (const dateKey of Object.keys(dates)) {
      if (dates[dateKey].length > 1) {
        const slots = dates[dateKey];
        dupRows.push([
          dateKey,
          staffId,
          ctx.staffMap[staffId].name,
          slots.length,
          slots.map(s => s.unit.facility + '(' + s.unit.unit_name + ')').join(' / '),
          slots.map(s => s.shift).join(' / '),
        ]);
      }
    }
  }
  
  if (dupRows.length > 0) {
    dupSheet.getRange(2, 1, dupRows.length, 6).setValues(dupRows);
  }
  dupSheet.setColumnWidth(1, 100);
  dupSheet.setColumnWidth(2, 80);
  dupSheet.setColumnWidth(3, 120);
  dupSheet.setColumnWidth(4, 120);
  dupSheet.setColumnWidth(5, 400);
  dupSheet.setColumnWidth(6, 200);
  
  // --- V_充足確認 ---
  let fillSheet = ss.getSheetByName('V_充足確認');
  if (!fillSheet) {
    fillSheet = ss.insertSheet('V_充足確認');
  } else {
    fillSheet.clear();
  }
  const fillHeaders = ['日付', 'unit_id', '事業所名', '施設名', 'ユニット名', '配置状況', 'staff_id', '氏名', 'シフト種別', '配置理由'];
  fillSheet.getRange(1, 1, 1, fillHeaders.length).setValues([fillHeaders]);
  fillSheet.getRange(1, 1, 1, fillHeaders.length)
    .setFontWeight('bold').setBackground('#4a148c').setFontColor('#ffffff');
  
  const fillRows = [];
  let satisfied = 0;
  for (const slot of ctx.slots) {
    const filled = slot.staff_id ? '配置済' : '未配置';
    if (slot.staff_id) satisfied++;
    fillRows.push([
      slot.dateKey,
      slot.unit.unit_id,
      slot.unit.jigyosho,
      slot.unit.facility,
      slot.unit.unit_name,
      filled,
      slot.staff_id || '',
      slot.staff_name || '',
      slot.shift || '',
      slot.assignReason || '',
    ]);
  }
  
  if (fillRows.length > 0) {
    fillSheet.getRange(2, 1, fillRows.length, 10).setValues(fillRows);
    
    // 未配置行を赤背景
    for (let i = 0; i < fillRows.length; i++) {
      if (fillRows[i][5] === '未配置') {
        fillSheet.getRange(i + 2, 1, 1, 10).setBackground('#fef2f2');
      }
    }
  }
  
  fillSheet.setColumnWidth(1, 100);
  fillSheet.setColumnWidth(2, 80);
  fillSheet.setColumnWidth(3, 180);
  fillSheet.setColumnWidth(4, 180);
  fillSheet.setColumnWidth(5, 180);
  fillSheet.setColumnWidth(6, 80);
  fillSheet.setColumnWidth(7, 80);
  fillSheet.setColumnWidth(8, 120);
  fillSheet.setColumnWidth(9, 100);
  fillSheet.setColumnWidth(10, 100);
  
  SpreadsheetApp.flush();
  
  return { 
    satisfied: satisfied, 
    unfilled: ctx.slots.length - satisfied,
    duplicates: dupRows.length 
  };
}


// ============================================
// テスト用
// ============================================
function runFullEngine() {
  return runNightShiftEngine('2026-05');
}