// ============================================================
// 共通制約チェック関数 (夜勤・日勤両エンジン用)
// Step 2.1: 時間判定の基礎
// ============================================================

const SHIFT_BREAKS = {
  '夜勤A': [{ start: '02:00', end: '03:00' }],
  '夜勤B': [{ start: '02:00', end: '03:00' }],
  '夜勤C': [{ start: '02:00', end: '03:00' }, { start: '05:00', end: '06:00' }],
  '早出8h': [{ start: '11:00', end: '12:00' }],
  '早出4h': [],
  '遅出8h': [{ start: '18:00', end: '19:00' }],
  '遅出4h': []
};

function parseTimeToMinutes(hhmm, isAfterMidnight) {
  if (!hhmm) return 0;
  const parts = String(hhmm).split(':');
  const h = parseInt(parts[0], 10) || 0;
  const m = parseInt(parts[1], 10) || 0;
  return h * 60 + m + (isAfterMidnight ? 1440 : 0);
}

function getShiftTimeInfo(shiftType) {
  if (typeof SHIFT_PATTERNS === 'undefined' || !SHIFT_PATTERNS[shiftType]) {
    throw new Error('未定義のシフトタイプ: ' + shiftType);
  }
  const pat = SHIFT_PATTERNS[shiftType];
  return {
    start: pat.start,
    end: pat.end,
    breaks: SHIFT_BREAKS[shiftType] || [],
    workHours: pat.dayHours + pat.nightHours,
    breakMinutes: pat.breakMinutes,
    nightHours: pat.nightHours,
    dayHours: pat.dayHours
  };
}

function getEffectiveWorkBlocks(shiftType) {
  const info = getShiftTimeInfo(shiftType);
  const startM = parseTimeToMinutes(info.start);
  let endM = parseTimeToMinutes(info.end);
  const isOvernight = endM <= startM;
  if (isOvernight) endM += 1440;
  
  const breaksM = info.breaks.map(function(b) {
    let bStart = parseTimeToMinutes(b.start);
    let bEnd = parseTimeToMinutes(b.end);
    if (isOvernight && bStart < startM) bStart += 1440;
    if (isOvernight && bEnd <= bStart) bEnd += 1440;
    return { start: bStart, end: bEnd };
  }).sort(function(a, b) { return a.start - b.start; });
  
  const blocks = [];
  let cursor = startM;
  for (const br of breaksM) {
    if (br.start > cursor) {
      blocks.push({ start: cursor, end: br.start });
    }
    cursor = Math.max(cursor, br.end);
  }
  if (cursor < endM) {
    blocks.push({ start: cursor, end: endM });
  }
  return blocks;
}

function hasTimeOverlap(shiftTypeA, shiftTypeB) {
  const blocksA = getEffectiveWorkBlocks(shiftTypeA);
  const blocksB = getEffectiveWorkBlocks(shiftTypeB);
  for (const a of blocksA) {
    for (const b of blocksB) {
      if (a.start < b.end && b.start < a.end) return true;
    }
  }
  return false;
}

function hasOverallOverlap(shiftTypeA, shiftTypeB) {
  const infoA = getShiftTimeInfo(shiftTypeA);
  const infoB = getShiftTimeInfo(shiftTypeB);
  let aStart = parseTimeToMinutes(infoA.start);
  let aEnd = parseTimeToMinutes(infoA.end);
  if (aEnd <= aStart) aEnd += 1440;
  let bStart = parseTimeToMinutes(infoB.start);
  let bEnd = parseTimeToMinutes(infoB.end);
  if (bEnd <= bStart) bEnd += 1440;
  return aStart < bEnd && bStart < aEnd;
}

// ============================================================
// 跨日衝突判定: 前日のシフトと当日のシフトが時間衝突するか
// 用途: R1/W1 (前日夜勤A/B/C → 当日日勤早出のチェック)
// 
// 夜勤A (20:00-05:00): 翌05:00終了 → 当日早出07:00とは2時間空き → false
// 夜勤B (22:00-07:00): 翌07:00終了 → 当日早出07:00とピッタリ接触 → false (接触は重なりではない)
// 夜勤C (22:00-08:00): 翌08:00終了 → 当日早出07:00と1時間重なる → true
// ============================================================
function hasNextDayConflict(yesterdayShift, todayShift) {
  const yesterday = getShiftTimeInfo(yesterdayShift);
  const today = getShiftTimeInfo(todayShift);
  
  // 前日シフトの終了時刻 (跨日なら翌日扱い、分単位)
  let yEnd = parseTimeToMinutes(yesterday.end);
  const yStart = parseTimeToMinutes(yesterday.start);
  // 跨日でない場合 (例: 早出8h 07-16) は翌日にまたがらない → 衝突なし
  if (yEnd > yStart) return false;
  // 跨日の場合、yEnd は翌日の時刻なのでそのまま分単位で比較
  
  // 当日シフトの開始時刻
  const tStart = parseTimeToMinutes(today.start);
  
  // 前日シフトの終了が当日シフトの開始より遅ければ重なる
  return yEnd > tStart;
}

function testTimeJudgement() {
  Logger.log('=== 時間判定テスト ===');
  
  Logger.log('--- parseTimeToMinutes ---');
  Logger.log('07:00 -> ' + parseTimeToMinutes('07:00') + ' (期待:420)');
  Logger.log('16:00 -> ' + parseTimeToMinutes('16:00') + ' (期待:960)');
  Logger.log('03:00跨日 -> ' + parseTimeToMinutes('03:00', true) + ' (期待:1620)');
  
  Logger.log('--- getEffectiveWorkBlocks ---');
  ['夜勤A', '夜勤B', '夜勤C', '早出8h', '早出4h', '遅出8h', '遅出4h'].forEach(function(s) {
    const blocks = getEffectiveWorkBlocks(s);
    const totalH = blocks.reduce(function(sum, b) { return sum + (b.end - b.start); }, 0) / 60;
    Logger.log(s + ': ' + JSON.stringify(blocks) + ' = 合計 ' + totalH + 'h');
  });
  
  Logger.log('--- hasTimeOverlap (同日内、休憩除外) ---');
  // 注: hasTimeOverlap は同日内シフト同士の判定。夜勤と日勤は同日共存しないため false
  const cases = [
    ['早出8h', '遅出8h', true,  '13-16の3h重なる'],
    ['早出8h', '遅出4h', true,  '13-16の3h重なる'],
    ['早出4h', '遅出4h', false, '11-13は完全に空く'],
    ['早出4h', '遅出8h', false, '11-13は完全に空く'],
    ['夜勤A',  '早出8h', false, '同日共存不可'],
    ['夜勤B',  '早出8h', false, '同日共存不可'],
    ['夜勤C',  '早出8h', false, '同日共存不可']
  ];
  cases.forEach(function(c) {
    const actual = hasTimeOverlap(c[0], c[1]);
    const ok = actual === c[2] ? 'OK' : 'NG';
    Logger.log(ok + ' ' + c[0] + ' vs ' + c[1] + ' -> ' + actual + ' (期待:' + c[2] + ') [' + c[3] + ']');
  });
  
  Logger.log('--- hasOverallOverlap (同日内、拘束時間) ---');
  Logger.log('夜勤A vs 早出8h -> ' + hasOverallOverlap('夜勤A', '早出8h') + ' (期待:false 同日共存不可)');
  Logger.log('夜勤B vs 早出8h -> ' + hasOverallOverlap('夜勤B', '早出8h') + ' (期待:false 同日共存不可)');
  
  Logger.log('--- hasNextDayConflict (前日シフト → 当日シフト) ---');
  const ndCases = [
    ['夜勤A', '早出8h', false, '夜勤A=05:00終了 vs 早出8h=07:00開始 → 2h空き'],
    ['夜勤A', '早出4h', false, '夜勤A=05:00終了 vs 早出4h=07:00開始 → 2h空き'],
    ['夜勤B', '早出8h', false, '夜勤B=07:00終了 vs 早出8h=07:00開始 → 接触のみ'],
    ['夜勤B', '早出4h', false, '夜勤B=07:00終了 vs 早出4h=07:00開始 → 接触のみ'],
    ['夜勤C', '早出8h', true,  '夜勤C=08:00終了 vs 早出8h=07:00開始 → 1h重なる'],
    ['夜勤C', '早出4h', true,  '夜勤C=08:00終了 vs 早出4h=07:00開始 → 1h重なる'],
    ['夜勤A', '遅出8h', false, '夜勤A=05:00終了 vs 遅出8h=13:00開始 → 大きく空く'],
    ['夜勤B', '遅出8h', false, '夜勤B=07:00終了 vs 遅出8h=13:00開始 → 6h空き'],
    ['夜勤C', '遅出8h', false, '夜勤C=08:00終了 vs 遅出8h=13:00開始 → 5h空き'],
    ['早出8h', '遅出8h', false, '前日が日勤なら跨日衝突なし']
  ];
  ndCases.forEach(function(c) {
    const actual = hasNextDayConflict(c[0], c[1]);
    const ok = actual === c[2] ? 'OK' : 'NG';
    Logger.log(ok + ' 前日:' + c[0] + ' → 当日:' + c[1] + ' -> ' + actual + ' (期待:' + c[2] + ') [' + c[3] + ']');
  });
  
  Logger.log('=== 完了 ===');
}
