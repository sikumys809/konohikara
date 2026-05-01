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
  
  // 既存の対象月データをクリア
  if (sheet.getLastRow() > 1) {
    const existingData = sheet.getDataRange().getValues();
    const rowsToDelete = [];
    for (let i = 1; i < existingData.length; i++) {
      const d = existingData[i][1]; // B列: 日付
      if (d instanceof Date) {
        if (d.getFullYear() === ctx.year && d.getMonth() === ctx.month - 1) {
          rowsToDelete.push(i + 1);
        }
      }
    }
    // 後ろから削除
    for (let i = rowsToDelete.length - 1; i >= 0; i--) {
      sheet.deleteRow(rowsToDelete[i]);
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
