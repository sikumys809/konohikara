// ============================================================
// Step 4-1: テスト用日勤希望データ生成
// 2026-05 対象 / 在籍者からランダム200名 / 計1,600件目標
// ============================================================

/**
 * メイン関数: 日勤希望データを一括生成
 */
function generateTestDayRequests() {
  const TARGET_YM = '2026-05';
  const TARGET_STAFF_COUNT = 200;
  const SEED_LOG = [];

  Logger.log('========== 日勤テスト希望データ生成 開始 ==========');
  Logger.log(`対象月: ${TARGET_YM} / ターゲットスタッフ数: ${TARGET_STAFF_COUNT}`);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const staffSheet = ss.getSheetByName('M_スタッフ');
  const reqSheet = ss.getSheetByName('T_希望提出');

  if (!staffSheet) throw new Error('M_スタッフが見つからない');
  if (!reqSheet) throw new Error('T_希望提出が見つからない');

  // ===== 在籍者を取得（20列目まで読む = 主職種含む） =====
  const lastRow = staffSheet.getLastRow();
  const staffData = staffSheet.getRange(2, 1, lastRow - 1, 20).getValues();

  const activeStaff = staffData.filter(row => {
    const retired = String(row[16] || '').toUpperCase() === 'TRUE'; // Q列: 退職フラグ
    return !retired;
  });

  Logger.log(`在籍者: ${activeStaff.length}名`);

  // ===== 200名をランダム抽出 =====
  const shuffled = _shuffle([...activeStaff]);
  const targetStaff = shuffled.slice(0, TARGET_STAFF_COUNT);
  Logger.log(`ランダム抽出: ${targetStaff.length}名`);

  // ===== 既存の2026-05希望を削除（上書きのため） =====
  const deletedCount = _deleteExistingDayRequests(reqSheet, TARGET_YM, targetStaff);
  Logger.log(`既存の日勤希望 ${deletedCount}件を削除`);

  // ===== 各スタッフの希望を生成 =====
  const now = new Date();
  const newRows = [];

  targetStaff.forEach((row, idx) => {
    const staffId = String(row[0]).trim();
    const name = row[1];
    const mainFac = row[9] || '';
    const secondFac = row[10] || '';
    const subFacsStr = String(row[11] || '');
    const subFacs = subFacsStr.split(',').map(s => s.trim()).filter(Boolean);
    const mainRoles = String(row[19] || '世話人').split(',').map(s => s.trim()).filter(Boolean);
    const cert = String(row[5] || ''); // F列: 国家資格
    const isNurse = cert.indexOf('看護師') !== -1;

    // メイン施設なければスキップ
    if (!mainFac) return;

    // 主職種に応じた希望パターンを決定
    const pattern = _decidePattern(mainRoles, isNurse);
    const desiredDates = _pickDates(TARGET_YM, pattern);
    const shiftType = _pickShiftType(pattern);

    desiredDates.forEach((dateStr, di) => {
      const reqId = `${staffId}_${TARGET_YM}_DAY_${String(di + 1).padStart(3, '0')}`;
      newRows.push([
        reqId,                               // A: 提出ID
        now,                                  // B: 提出日時
        staffId,                              // C: staff_id
        name,                                 // D: 氏名
        TARGET_YM,                            // E: 対象年月
        dateStr,                              // F: 希望日
        shiftType,                            // G: シフト種別
        mainFac,                              // H: メイン施設
        secondFac,                            // I: セカンド施設
        subFacs.join(','),                    // J: サブ施設
        '',                                   // K: コメント
        pattern.freqType,                     // L: 希望頻度タイプ
        pattern.freqCount                     // M: 希望頻度数
      ]);
    });

    SEED_LOG.push({
      staffId, name, mainRoles: mainRoles.join(','),
      pattern: pattern.label, days: desiredDates.length, shift: shiftType
    });
  });

  // ===== 一括書込 =====
  if (newRows.length > 0) {
    const startRow = reqSheet.getLastRow() + 1;
    reqSheet.getRange(startRow, 1, newRows.length, 13).setValues(newRows);
    // 型罠対策: 対象年月・希望日を文字列書式
    reqSheet.getRange(startRow, 5, newRows.length, 1).setNumberFormat('@');
    reqSheet.getRange(startRow, 6, newRows.length, 1).setNumberFormat('@');
  }

  Logger.log(`\n✅ 生成完了: ${newRows.length}件`);

  // 主職種別サマリ
  const roleSummary = {};
  SEED_LOG.forEach(s => {
    const key = s.mainRoles;
    if (!roleSummary[key]) roleSummary[key] = { staff: 0, days: 0 };
    roleSummary[key].staff++;
    roleSummary[key].days += s.days;
  });
  Logger.log('\n=== 主職種別サマリ ===');
  Object.keys(roleSummary).sort().forEach(k => {
    Logger.log(`  ${k}: ${roleSummary[k].staff}名 / ${roleSummary[k].days}人日`);
  });

  // シフト種別別サマリ
  const shiftSummary = {};
  SEED_LOG.forEach(s => {
    shiftSummary[s.shift] = (shiftSummary[s.shift] || 0) + s.days;
  });
  Logger.log('\n=== シフト種別別サマリ ===');
  Object.keys(shiftSummary).sort().forEach(k => {
    Logger.log(`  ${k}: ${shiftSummary[k]}件`);
  });

  Logger.log('\n========== 完了 ==========');
  return { total: newRows.length, summary: roleSummary };
}

/**
 * 主職種と看護師フラグから希望パターンを決定
 */
function _decidePattern(mainRoles, isNurse) {
  // サビ管: 平日中心・週3〜4日
  if (mainRoles.indexOf('サビ管') !== -1) {
    return {
      label: 'サビ管平日型',
      freqType: '週次',
      freqCount: 4,
      targetDaysPerMonth: [14, 16, 18],        // 月14-18日
      weekdayBias: 'weekday',                   // 平日優先
      shiftPool: ['早出8h', '遅出8h'],
      shiftWeight: [0.5, 0.5]
    };
  }
  // 管理者: 平日中心・週5日
  if (mainRoles.indexOf('管理者') !== -1) {
    return {
      label: '管理者平日型',
      freqType: '週次',
      freqCount: 5,
      targetDaysPerMonth: [18, 20, 22],
      weekdayBias: 'weekday',
      shiftPool: ['早出8h'],
      shiftWeight: [1.0]
    };
  }
  // 看護師（資格のみ）: 週1〜2日
  if (isNurse) {
    return {
      label: '看護師資格型',
      freqType: '週次',
      freqCount: 2,
      targetDaysPerMonth: [4, 6, 8],
      weekdayBias: 'any',
      shiftPool: ['早出8h', '遅出8h', '早出4h'],
      shiftWeight: [0.4, 0.4, 0.2]
    };
  }
  // 世話人: 通常は週2〜3日
  return {
    label: '世話人標準型',
    freqType: '月次合計',
    freqCount: 8,
    targetDaysPerMonth: [6, 8, 10],
    weekdayBias: 'any',
    shiftPool: ['早出8h', '遅出8h', '早出4h', '遅出4h'],
    shiftWeight: [0.35, 0.35, 0.15, 0.15]
  };
}

/**
 * 希望日を月内からランダムに選択
 */
function _pickDates(yearMonth, pattern) {
  const parts = yearMonth.split('-');
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const daysInMonth = new Date(year, month, 0).getDate();

  // 候補日を生成
  const candidates = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(year, month - 1, d);
    const dow = dt.getDay(); // 0=日, 6=土
    const isWeekend = dow === 0 || dow === 6;

    if (pattern.weekdayBias === 'weekday' && isWeekend) {
      // 平日優先: 土日は確率10%でしか候補に入れない
      if (Math.random() > 0.1) continue;
    }
    candidates.push(d);
  }

  // targetDaysPerMonth からランダムに目標日数を決定
  const targetDays = pattern.targetDaysPerMonth[Math.floor(Math.random() * pattern.targetDaysPerMonth.length)];

  // シャッフルして先頭N個
  const shuffled = _shuffle(candidates);
  const picked = shuffled.slice(0, Math.min(targetDays, shuffled.length)).sort((a, b) => a - b);

  return picked.map(d => `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
}

/**
 * シフト種別を重み付きランダムで選択（スタッフごとに1種類固定）
 */
function _pickShiftType(pattern) {
  const r = Math.random();
  let acc = 0;
  for (let i = 0; i < pattern.shiftPool.length; i++) {
    acc += pattern.shiftWeight[i];
    if (r <= acc) return pattern.shiftPool[i];
  }
  return pattern.shiftPool[pattern.shiftPool.length - 1];
}

/**
 * Fisher-Yates shuffle
 */
function _shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 既存の日勤希望（2026-05, 指定スタッフ）を削除
 * 夜勤希望は保持
 */
function _deleteExistingDayRequests(reqSheet, targetYM, targetStaff) {
  const lastRow = reqSheet.getLastRow();
  if (lastRow < 2) return 0;

  const staffIds = new Set(targetStaff.map(r => String(r[0]).trim()));
  const dayShifts = new Set(['早出8h', '早出4h', '遅出8h', '遅出4h']);

  const data = reqSheet.getRange(2, 1, lastRow - 1, 13).getValues();
  const rowsToDelete = [];

  data.forEach((row, idx) => {
    const ym = _normalizeYMValue(row[4]);
    const staffId = String(row[2]).trim();
    const shift = String(row[6]).trim();

    if (ym === targetYM && staffIds.has(staffId) && dayShifts.has(shift)) {
      rowsToDelete.push(idx + 2);
    }
  });

  // 下から削除
  rowsToDelete.reverse().forEach(rn => reqSheet.deleteRow(rn));

  return rowsToDelete.length;
}

function _normalizeYMValue(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return Utilities.formatDate(val, 'Asia/Tokyo', 'yyyy-MM');
  }
  return String(val).trim();
}

/**
 * 生成結果を検証（サマリ表示）
 */
function checkTestDayRequests() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const reqSheet = ss.getSheetByName('T_希望提出');
  const lastRow = reqSheet.getLastRow();
  if (lastRow < 2) {
    Logger.log('T_希望提出 は空');
    return;
  }

  const data = reqSheet.getRange(2, 1, lastRow - 1, 13).getValues();
  const TARGET_YM = '2026-05';
  const dayShifts = new Set(['早出8h', '早出4h', '遅出8h', '遅出4h']);
  const nightShifts = new Set(['夜勤A', '夜勤B', '夜勤C']);

  let dayCount = 0, nightCount = 0, other = 0;
  const dayByShift = {};
  const dayByFacility = {};
  const dayByStaff = {};

  data.forEach(row => {
    const ym = _normalizeYMValue(row[4]);
    if (ym !== TARGET_YM) return;
    const shift = String(row[6]).trim();
    const mainFac = String(row[7]).trim();
    const staffId = String(row[2]).trim();

    if (dayShifts.has(shift)) {
      dayCount++;
      dayByShift[shift] = (dayByShift[shift] || 0) + 1;
      dayByFacility[mainFac] = (dayByFacility[mainFac] || 0) + 1;
      dayByStaff[staffId] = (dayByStaff[staffId] || 0) + 1;
    } else if (nightShifts.has(shift)) {
      nightCount++;
    } else {
      other++;
    }
  });

  Logger.log(`=== ${TARGET_YM} 希望データ集計 ===`);
  Logger.log(`日勤: ${dayCount}件 / 夜勤: ${nightCount}件 / その他: ${other}件`);
  Logger.log(`日勤希望スタッフ数: ${Object.keys(dayByStaff).length}名`);
  Logger.log(`\n【シフト種別別】`);
  Object.keys(dayByShift).sort().forEach(k => Logger.log(`  ${k}: ${dayByShift[k]}件`));
  Logger.log(`\n【事業所別】`);
  Object.keys(dayByFacility).sort().forEach(k => Logger.log(`  ${k}: ${dayByFacility[k]}件`));
}
