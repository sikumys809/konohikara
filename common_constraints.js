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

// ============================================================
// Step 2.2: 勤務制約チェック関数
// ============================================================

// 内部: 日付加算 (nightshift_engine_v3.js の addDays とプレフィックス分けて衝突回避)
function _cc_addDays(dateKey, delta) {
  const d = new Date(dateKey + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd');
}

// 内部: 月曜日取得 (週の起点)
// 例: '2026-05-15'(金) → '2026-05-11'(月)
//     '2026-05-11'(月) → '2026-05-11'
//     '2026-05-17'(日) → '2026-05-11'
function _cc_getWeekStart(dateKey) {
  const d = new Date(dateKey + 'T00:00:00');
  const day = d.getDay(); // 0=日, 1=月, ..., 6=土
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd');
}

// ============================================================
// ============================================================
// H14: 1日8時間上限チェック (労基法準拠)
// targetDate を含む1日の合計勤務h + addedHours が8hを超えるか
// 始業日帰属ルール:
//   - 早出/遅出/夜勤A/B/C すべて targetDate に集約 (始業日)
//   - ctx.staffAssignedDates[staffId][targetDate] の workHours 合計 + addedH
// 戻り値: { exceeded, currentH, willBeH }
//   currentH = 既存配置の合計h
//   willBeH = currentH + addedHours
//   exceeded = willBeH > 8
// 根拠: 障害福祉法では配置基準時間カウントは労基法上の1日8h内のみ有効
// ============================================================
function checkDailyHours(staffId, targetDate, addedHours, ctx) {
  const dates = (ctx.staffAssignedDates && ctx.staffAssignedDates[staffId]) || {};
  const assigns = dates[targetDate] || [];
  let currentH = 0;
  
  assigns.forEach(function(a) {
    currentH += (a.workHours || 0);
  });
  
  const willBeH = currentH + (addedHours || 0);
  return {
    exceeded: willBeH > 8,
    currentH: currentH,
    willBeH: willBeH
  };
}

// ============================================================
// 配置時の役割自動選択 (Step C 簡易版、Day10新規)
// 引数:
//   staff - スタッフオブジェクト (isSabikan/isSewa/isSeikatsu/isNurse などのフラグ)
//   jigyoshoShortage - その事業所の不足判定 (例: {sewa: true, seikatsu: false, sabikan: false, nurse: true})
// 戻り値: '世話人' | '生活支援員' | 'サビ管' | '看護師' | '管理者' | '' (該当なし)
//
// 優先順位:
//   1. サビ管持ちなら無条件でサビ管 (サビ管最優先)
//   2. 世話人不足 && 世話人持ち → 世話人
//   3. 生活支援員不足 && 生活支援員持ち → 生活支援員
//   4. 世話人持ち → 世話人 (両方足りてても世話人優先)
//   5. 生活支援員持ち → 生活支援員
//   6. 主職種T列の先頭値 (フォールバック)
// ============================================================
function pickAssignedRole(staff, jigyoshoShortage) {
  if (!staff) return '';
  const shortage = jigyoshoShortage || {};
  
  // ★Day 12 v2: 両方持ちの柔軟配置ロジック
  // サビ管 > 世話人不足時のみ世話人 > 生活支援員へ自動切替 > 世話人のみ持ちは世話人
  // 両方持ち(世話人+生活支援員)は、世話人不足中は世話人、充足したら生活支援員に回す
  
  // 1. サビ管持ち → 無条件サビ管
  if (staff.isSabikan) return 'サビ管';
  
  // 2. 世話人不足 + 世話人持ち → 世話人
  if (shortage.sewa && staff.isSewa) return '世話人';
  
  // 3. 世話人充足後(or 世話人持ちでない) → 生活支援員持ちは生活支援員へ
  //    両方持ちはここで生活支援員に流れる(柔軟配置の主目的)
  if (staff.isSeikatsu) return '生活支援員';
  
  // 4. 世話人のみ持ち(生活支援員兼任なし) → 世話人
  if (staff.isSewa) return '世話人';
  
  // 5. フォールバック
  if (staff.mainRoles && staff.mainRoles.length > 0) {
    return staff.mainRoles[0];
  }
  return '';
}

// ============================================================
// 連続勤務日数チェック
// targetDate を含む前後の連続勤務日数をカウント
// 戻り値: { exceeded: bool, count: number }
//   exceeded = count > 6 (= 7日以上)
// ============================================================
function checkConsecutiveDays(staffId, targetDate, ctx) {
  const dates = (ctx.staffAssignedDates && ctx.staffAssignedDates[staffId]) || {};
  let count = 1; // targetDate 自体
  
  // 前日方向に遡る
  let prev = _cc_addDays(targetDate, -1);
  while (true) {
    const assigns = dates[prev] || [];
    if (assigns.length === 0) break;
    count++;
    prev = _cc_addDays(prev, -1);
  }
  
  // 翌日方向に進む (既存配置検証用)
  let next = _cc_addDays(targetDate, 1);
  while (true) {
    const assigns = dates[next] || [];
    if (assigns.length === 0) break;
    count++;
    next = _cc_addDays(next, 1);
  }
  
  return { exceeded: count > 6, count: count };
}

// ============================================================
// 週40時間チェック (月曜起算)
// targetDate を含む週の合計勤務h + addedHours が40hを超えるか
// 戻り値: { exceeded, currentH, willBeH, weekStart }
//   currentH = ctx 既存配置の合計h
//   willBeH = currentH + addedHours
//   exceeded = willBeH > 40
// ============================================================
function checkWeeklyHours(staffId, targetDate, addedHours, ctx) {
  const weekStart = _cc_getWeekStart(targetDate);
  const dates = (ctx.staffAssignedDates && ctx.staffAssignedDates[staffId]) || {};
  let currentH = 0;
  
  for (let i = 0; i < 7; i++) {
    const day = _cc_addDays(weekStart, i);
    const assigns = dates[day] || [];
    assigns.forEach(function(a) {
      currentH += (a.workHours || 0);
    });
  }
  
  const willBeH = currentH + (addedHours || 0);
  return {
    exceeded: willBeH > 40,
    currentH: currentH,
    willBeH: willBeH,
    weekStart: weekStart
  };
}

// ============================================================
// 同日他事業所配置チェック (H1)
// 戻り値: { exists: bool, conflicts: [...] }
//   exists = true なら自動配置から除外 (ハード除外)
// ============================================================
function hasOtherFacilityAssignment(staffId, date, currentJigyosho, ctx) {
  const dates = (ctx.staffAssignedDates && ctx.staffAssignedDates[staffId]) || {};
  const assigns = dates[date] || [];
  const conflicts = assigns.filter(function(a) {
    return a.jigyosho && a.jigyosho !== currentJigyosho;
  });
  return {
    exists: conflicts.length > 0,
    conflicts: conflicts
  };
}

// ============================================================
// テスト関数 (Step 2.2)
// ============================================================
function testWorkConstraints() {
  Logger.log('=== 勤務制約テスト (Step 2.2) ===');
  
  // 1. _cc_getWeekStart
  Logger.log('\n--- _cc_getWeekStart (月曜日取得) ---');
  const weekTests = [
    ['2026-05-11', '2026-05-11', '月曜日 → 自身'],
    ['2026-05-15', '2026-05-11', '金曜日 → その週の月曜'],
    ['2026-05-17', '2026-05-11', '日曜日 → その週の月曜'],
    ['2026-05-18', '2026-05-18', '次の月曜日']
  ];
  weekTests.forEach(function(t) {
    const actual = _cc_getWeekStart(t[0]);
    const ok = actual === t[1] ? 'OK' : 'NG';
    Logger.log(ok + ' ' + t[0] + ' → ' + actual + ' (期待:' + t[1] + ') [' + t[2] + ']');
  });
  
  // 2. mock ctx 構築
  // 5/11(月) 早出8h, 5/12(火) 早出8h, 5/13(水) 早出8h, 5/14(木) 早出8h, 5/15(金) 早出4h
  // = 月〜金 5日連続、合計 8+8+8+8+4 = 36h
  const mockCtx = {
    staffAssignedDates: {
      '13': {
        '2026-05-11': [{ shift: '早出8h', jigyosho: 'GHコノヒカラ', facility: 'リフレ要町', workHours: 8 }],
        '2026-05-12': [{ shift: '早出8h', jigyosho: 'GHコノヒカラ', facility: 'リフレ要町', workHours: 8 }],
        '2026-05-13': [{ shift: '早出8h', jigyosho: 'GHコノヒカラ', facility: 'リフレ要町', workHours: 8 }],
        '2026-05-14': [{ shift: '早出8h', jigyosho: 'GHコノヒカラ', facility: 'リフレ要町', workHours: 8 }],
        '2026-05-15': [{ shift: '早出4h', jigyosho: 'GHコノヒカラ', facility: 'リフレ要町', workHours: 4 }]
      },
      '99': {
        // 同日他事業所テスト用: 5/15 にA事業所配置済み
        '2026-05-15': [{ shift: '早出8h', jigyosho: 'GHコノヒカラ', facility: 'リフレ要町', workHours: 8 }]
      }
    }
  };
  
  // 3. checkConsecutiveDays
  Logger.log('\n--- checkConsecutiveDays ---');
  // staff_id=13 で 5/15 を起点 → 月〜金 5日連続
  let r = checkConsecutiveDays('13', '2026-05-15', mockCtx);
  Logger.log('staff=13 / 5/15起点 → count=' + r.count + ', exceeded=' + r.exceeded + ' (期待:5, false)');
  // 5/16 を新規追加した時の連続数を仮想計算
  r = checkConsecutiveDays('13', '2026-05-16', mockCtx);
  Logger.log('staff=13 / 5/16起点 → count=' + r.count + ', exceeded=' + r.exceeded + ' (期待:6, false 5/11-5/16の6日)');
  // 5/17 を新規追加 → 7日連続でexceed
  r = checkConsecutiveDays('13', '2026-05-17', mockCtx);
  Logger.log('staff=13 / 5/17起点 → count=' + r.count + ', exceeded=' + r.exceeded + ' (期待:1, false 5/16空欄なので 5/17単独)');
  // 配置がないスタッフ
  r = checkConsecutiveDays('999', '2026-05-15', mockCtx);
  Logger.log('staff=999 / 配置なし → count=' + r.count + ', exceeded=' + r.exceeded + ' (期待:1, false)');
  
  // 4. checkWeeklyHours
  Logger.log('\n--- checkWeeklyHours ---');
  // 5/15 の週 (月-日 = 5/11-5/17) の合計 36h、追加 0h → 36h
  r = checkWeeklyHours('13', '2026-05-15', 0, mockCtx);
  Logger.log('staff=13 / 5/15 / +0h → currentH=' + r.currentH + ', willBeH=' + r.willBeH + ', exceeded=' + r.exceeded + ', weekStart=' + r.weekStart + ' (期待:36, 36, false, 2026-05-11)');
  // 追加 4h → 40h ちょうど (40 > 40 はfalse)
  r = checkWeeklyHours('13', '2026-05-16', 4, mockCtx);
  Logger.log('staff=13 / 5/16 / +4h → currentH=' + r.currentH + ', willBeH=' + r.willBeH + ', exceeded=' + r.exceeded + ' (期待:36, 40, false ちょうど40h)');
  // 追加 5h → 41h オーバー
  r = checkWeeklyHours('13', '2026-05-16', 5, mockCtx);
  Logger.log('staff=13 / 5/16 / +5h → currentH=' + r.currentH + ', willBeH=' + r.willBeH + ', exceeded=' + r.exceeded + ' (期待:36, 41, true)');
  // 翌週 5/18 (月) は別週
  r = checkWeeklyHours('13', '2026-05-18', 8, mockCtx);
  Logger.log('staff=13 / 5/18 / +8h → currentH=' + r.currentH + ', willBeH=' + r.willBeH + ', weekStart=' + r.weekStart + ' (期待:0, 8, 2026-05-18)');
  
  // 5. hasOtherFacilityAssignment
  Logger.log('\n--- hasOtherFacilityAssignment ---');
  // staff=99 / 5/15 / 同じGHコノヒカラ → 重複なし
  let h = hasOtherFacilityAssignment('99', '2026-05-15', 'GHコノヒカラ', mockCtx);
  Logger.log('staff=99 / 5/15 / GHコノヒカラ → exists=' + h.exists + ' (期待:false)');
  // staff=99 / 5/15 / GHコノヒカラ品川 → 既存(GHコノヒカラ)と他事業所重複
  h = hasOtherFacilityAssignment('99', '2026-05-15', 'GHコノヒカラ品川', mockCtx);
  Logger.log('staff=99 / 5/15 / GHコノヒカラ品川 → exists=' + h.exists + ', conflicts=' + h.conflicts.length + '件 (期待:true, 1)');
  // 配置なし
  h = hasOtherFacilityAssignment('999', '2026-05-15', 'GHコノヒカラ', mockCtx);
  Logger.log('staff=999 / 配置なし → exists=' + h.exists + ' (期待:false)');
  
  Logger.log('\n=== 完了 ===');
}

// ============================================================
// Step 2.3: 兼務NG判定
// ============================================================

// 同時刻NGの役割ペア (順序不問)
const PROHIBITED_ROLE_PAIRS = [
  ['サビ管', '世話人'],
  ['サビ管', '生活支援員'],
  ['サビ管', '看護師'],
  ['世話人', '生活支援員']
];

// 内部: 役割ペアが禁止リストにあるか
function _isPairProhibited(roleA, roleB) {
  if (roleA === roleB) return false; // 同じ役割は対象外
  for (let i = 0; i < PROHIBITED_ROLE_PAIRS.length; i++) {
    const pair = PROHIBITED_ROLE_PAIRS[i];
    if ((pair[0] === roleA && pair[1] === roleB) ||
        (pair[0] === roleB && pair[1] === roleA)) {
      return true;
    }
  }
  return false;
}

// ============================================================
// 2人のスタッフ (役割の組み合わせ) が同時刻NGか
// rolesA, rolesB: 役割の配列
// 例: isCombinationProhibited(['世話人'], ['生活支援員']) → true (H2)
// ============================================================
function isCombinationProhibited(rolesA, rolesB) {
  if (!Array.isArray(rolesA) || !Array.isArray(rolesB)) return false;
  for (let i = 0; i < rolesA.length; i++) {
    for (let j = 0; j < rolesB.length; j++) {
      if (_isPairProhibited(rolesA[i], rolesB[j])) return true;
    }
  }
  return false;
}

// ============================================================
// 1人のスタッフが複数役割を同時刻に担う場合のNG判定
// roles: 役割の配列
// 例: hasInternalRoleConflict(['世話人', '生活支援員']) → true (H2)
//     hasInternalRoleConflict(['管理者', '世話人']) → false (兼務OK)
// ============================================================
function hasInternalRoleConflict(roles) {
  if (!Array.isArray(roles) || roles.length < 2) return false;
  for (let i = 0; i < roles.length; i++) {
    for (let j = i + 1; j < roles.length; j++) {
      if (_isPairProhibited(roles[i], roles[j])) return true;
    }
  }
  return false;
}

// ============================================================
// テスト関数 (Step 2.3)
// ============================================================
function testRoleCombinations() {
  Logger.log('=== 兼務NG判定テスト (Step 2.3) ===');
  
  // 1. isCombinationProhibited (2人の組み合わせ)
  Logger.log('\n--- isCombinationProhibited ---');
  const pairCases = [
    [['世話人'], ['生活支援員'], true,  'H2 世話人×生活支援員'],
    [['サビ管'], ['世話人'], true,      'H4 サビ管×世話人'],
    [['サビ管'], ['生活支援員'], true,  'H4 サビ管×生活支援員'],
    [['サビ管'], ['看護師'], true,      'H5 サビ管×看護師'],
    [['管理者'], ['世話人'], false,     '管理者×世話人 OK'],
    [['管理者'], ['サビ管'], false,     '管理者×サビ管 OK'],
    [['看護師'], ['世話人'], false,     '看護師×世話人 OK'],
    [['看護師'], ['生活支援員'], false, '看護師×生活支援員 OK'],
    [['世話人'], ['世話人'], false,     '同じ役割同士 OK'],
    [['管理者', '世話人'], ['看護師'], false, '管理者+世話人 vs 看護師 OK'],
    [['管理者', '世話人'], ['生活支援員'], true, '世話人 vs 生活支援員でNG'],
    [['看護師'], ['サビ管'], true,      '逆順でも判定 NG']
  ];
  pairCases.forEach(function(c) {
    const actual = isCombinationProhibited(c[0], c[1]);
    const ok = actual === c[2] ? 'OK' : 'NG';
    Logger.log(ok + ' ' + JSON.stringify(c[0]) + ' vs ' + JSON.stringify(c[1]) + ' -> ' + actual + ' (期待:' + c[2] + ') [' + c[3] + ']');
  });
  
  // 2. hasInternalRoleConflict (1人内の役割競合)
  Logger.log('\n--- hasInternalRoleConflict ---');
  const internalCases = [
    [['世話人', '生活支援員'], true,             'H2 世話人+生活支援員 同時刻NG'],
    [['サビ管', '世話人'], true,                 'H4 サビ管+世話人 同時刻NG'],
    [['サビ管', '看護師'], true,                 'H5 サビ管+看護師 同時刻NG'],
    [['管理者', '世話人'], false,                '管理者+世話人 OK'],
    [['管理者', '世話人', '看護師'], false,      '管理者+世話人+看護師 3つOK'],
    [['管理者', '世話人', '生活支援員'], true,   'H3 世話人+生活支援員NG'],
    [['世話人'], false,                          '単一役割 OK'],
    [[], false,                                  '空配列 OK']
  ];
  internalCases.forEach(function(c) {
    const actual = hasInternalRoleConflict(c[0]);
    const ok = actual === c[1] ? 'OK' : 'NG';
    Logger.log(ok + ' ' + JSON.stringify(c[0]) + ' -> ' + actual + ' (期待:' + c[1] + ') [' + c[2] + ']');
  });
  
  Logger.log('\n=== 完了 ===');
}


// ============================================================
// 希望提出時バリデーション (5ルール)
// ============================================================
// 仕様: https://www.notion.so/357ec81ceecf81b4bcc7cca0cd4c082a
//
// 1日1シフト原則:
//   - 同日に複数の日勤シフトNG (ルール1)
//   - 同日 遅出8h → 夜勤A/B/C NG (ルール2)
//   - 同日 夜勤 → 日勤NG (ルール3)
//   - 前日夜勤 → 翌日早出NG (ルール4)
//   - 翌日早出済み → 前日夜勤NG (ルール5)
//
// 引数:
//   wishes: 検証対象の希望配列 [{dateKey, shift}, ...]
// 戻り値:
//   { valid: bool, violations: [{rule, dateKey, shift, conflictWith, message}, ...] }
// ============================================================
function validateWishSubmission(wishes) {
  const DAY_SHIFTS = ['早出8h', '早出4h', '遅出8h', '遅出4h'];
  const NIGHT_SHIFTS = ['夜勤A', '夜勤B', '夜勤C'];
  const EARLY_SHIFTS = ['早出8h', '早出4h'];
  const LATE_SHIFTS = ['遅出8h', '遅出4h'];  // ★Day10新規
  
  // 日付別にインデックス化
  const byDate = {};
  for (const w of wishes) {
    if (!byDate[w.dateKey]) byDate[w.dateKey] = [];
    byDate[w.dateKey].push(w);
  }
  
  const violations = [];
  
  // 各希望をチェック
  for (let i = 0; i < wishes.length; i++) {
    const wish = wishes[i];
    const sameDayWishes = (byDate[wish.dateKey] || []).filter(function(w, j) {
      // 自分以外
      return wishes.indexOf(w) !== i;
    });
    
    // ルール1: 同日に日勤シフトは1つだけ
    if (DAY_SHIFTS.indexOf(wish.shift) !== -1) {
      const conflict = sameDayWishes.find(function(w) {
        return DAY_SHIFTS.indexOf(w.shift) !== -1;
      });
      if (conflict) {
        violations.push({
          rule: 'RULE1_DUPLICATE_DAYSHIFT',
          dateKey: wish.dateKey,
          shift: wish.shift,
          conflictWith: conflict.shift,
          message: wish.dateKey + 'は既に' + conflict.shift + 'が提出されています。日勤シフトは1日1つまでです。'
        });
      }
    }
    
    // ルール2: 同日 日勤(早出8h/早出4h/遅出8h/遅出4h) + 夜勤A/B/C NG
    // 労基法H14: 始業日帰属で1日8時間上限のため
    // (Day10改修: 旧「遅出8h+夜勤NG, 遅出4h+夜勤OK」を労基法準拠に統一)
    if (NIGHT_SHIFTS.indexOf(wish.shift) !== -1) {
      const conflict = sameDayWishes.find(function(w) {
        return EARLY_SHIFTS.indexOf(w.shift) !== -1 || LATE_SHIFTS.indexOf(w.shift) !== -1;
      });
      if (conflict) {
        violations.push({
          rule: 'RULE2_DAY_TO_NIGHT',
          dateKey: wish.dateKey,
          shift: wish.shift,
          conflictWith: conflict.shift,
          message: wish.dateKey + 'は既に' + conflict.shift + 'が提出されています。日勤と夜勤の組み合わせは1日8時間上限のため不可です。'
        });
      }
    }
    
    // ルール3: 同日 夜勤A/B/C + 日勤(早出8h/早出4h/遅出8h/遅出4h) NG (逆方向チェック)
    // 労基法H14: 始業日帰属で1日8時間上限のため
    // (Day10改修: 旧「夜勤+遅出8hのみNG」を全日勤シフトに拡張)
    if (EARLY_SHIFTS.indexOf(wish.shift) !== -1 || LATE_SHIFTS.indexOf(wish.shift) !== -1) {
      const conflict = sameDayWishes.find(function(w) {
        return NIGHT_SHIFTS.indexOf(w.shift) !== -1;
      });
      if (conflict) {
        violations.push({
          rule: 'RULE3_NIGHT_TO_DAY',
          dateKey: wish.dateKey,
          shift: wish.shift,
          conflictWith: conflict.shift,
          message: wish.dateKey + 'は既に' + conflict.shift + 'が提出されています。夜勤と日勤の組み合わせは1日8時間上限のため不可です。'
        });
      }
    }
    
    // ルール4: 前日夜勤A/B/C → 翌日早出8h/4h NG
    if (EARLY_SHIFTS.indexOf(wish.shift) !== -1) {
      const prevDay = _cc_addDays(wish.dateKey, -1);
      const prevDayWishes = byDate[prevDay] || [];
      const conflict = prevDayWishes.find(function(w) {
        return NIGHT_SHIFTS.indexOf(w.shift) !== -1;
      });
      if (conflict) {
        violations.push({
          rule: 'RULE4_PREV_NIGHT_TO_EARLY',
          dateKey: wish.dateKey,
          shift: wish.shift,
          conflictWith: prevDay + ' ' + conflict.shift,
          message: '前日(' + prevDay + ')に' + conflict.shift + 'が提出されています。夜勤翌日の早出は提出できません。'
        });
      }
    }
    
    // ルール5: (逆) 翌日早出8h/4h済み → 前日夜勤A/B/C NG
    if (NIGHT_SHIFTS.indexOf(wish.shift) !== -1) {
      const nextDay = _cc_addDays(wish.dateKey, 1);
      const nextDayWishes = byDate[nextDay] || [];
      const conflict = nextDayWishes.find(function(w) {
        return EARLY_SHIFTS.indexOf(w.shift) !== -1;
      });
      if (conflict) {
        violations.push({
          rule: 'RULE5_NEXT_EARLY_TO_NIGHT',
          dateKey: wish.dateKey,
          shift: wish.shift,
          conflictWith: nextDay + ' ' + conflict.shift,
          message: '翌日(' + nextDay + ')に' + conflict.shift + 'が提出されています。前日の夜勤は提出できません。'
        });
      }
    }
  }
  
  return {
    valid: violations.length === 0,
    violations: violations
  };
}

function debug_test_validate_wish_submission() {
  Logger.log('=== バリデーションテスト ===');
  Logger.log('');
  
  // テストケース1: 正常パターン
  const ok = [
    { dateKey: '2026-06-01', shift: '早出8h' },
    { dateKey: '2026-06-02', shift: '夜勤A' },
    { dateKey: '2026-06-04', shift: '遅出4h' }
    // ★Day10修正: 「遅出4h+夜勤A」は労基法H14でNGになったため除外
  ];
  Logger.log('--- TC1: 正常パターン (期待: valid=true) ---');
  const r1 = validateWishSubmission(ok);
  Logger.log('valid: ' + r1.valid + ' / 違反数: ' + r1.violations.length);
  
  // テストケース2: ルール1違反 (同日2日勤)
  const ng1 = [
    { dateKey: '2026-06-01', shift: '早出8h' },
    { dateKey: '2026-06-01', shift: '遅出8h' }
  ];
  Logger.log('');
  Logger.log('--- TC2: ルール1違反 (早出+遅出) ---');
  const r2 = validateWishSubmission(ng1);
  Logger.log('valid: ' + r2.valid);
  r2.violations.forEach(function(v) { Logger.log('  ' + v.rule + ': ' + v.message); });
  
  // テストケース3: ルール2違反 (遅出8h+夜勤)
  const ng2 = [
    { dateKey: '2026-06-01', shift: '遅出8h' },
    { dateKey: '2026-06-01', shift: '夜勤A' }
  ];
  Logger.log('');
  Logger.log('--- TC3: ルール2違反 (遅出8h+夜勤) ---');
  const r3 = validateWishSubmission(ng2);
  Logger.log('valid: ' + r3.valid);
  r3.violations.forEach(function(v) { Logger.log('  ' + v.rule + ': ' + v.message); });
  
  // テストケース4: ルール4違反 (前日夜勤+翌日早出)
  const ng3 = [
    { dateKey: '2026-06-01', shift: '夜勤C' },
    { dateKey: '2026-06-02', shift: '早出8h' }
  ];
  Logger.log('');
  Logger.log('--- TC4: ルール4違反 (前日夜勤+翌日早出) ---');
  const r4 = validateWishSubmission(ng3);
  Logger.log('valid: ' + r4.valid);
  r4.violations.forEach(function(v) { Logger.log('  ' + v.rule + ': ' + v.message); });
  
  // テストケース5: 遅出4h+夜勤A は労基法H14でNG (Day10改修)
  const ng5 = [
    { dateKey: '2026-06-01', shift: '遅出4h' },
    { dateKey: '2026-06-01', shift: '夜勤A' }
  ];
  Logger.log('');
  Logger.log('--- TC5: 遅出4h+夜勤A (期待: valid=false, 労基法H14) ---');
  const r5 = validateWishSubmission(ng5);
  Logger.log('valid: ' + r5.valid);
  
  Logger.log('');
  Logger.log('=== テスト完了 ===');
}

function debug_test_validate_detail() {
  Logger.log('=== TC1詳細 ===');
  const ok = [
    { dateKey: '2026-06-01', shift: '早出8h' },
    { dateKey: '2026-06-02', shift: '夜勤A' },
    { dateKey: '2026-06-04', shift: '遅出4h' }
    // ★Day10修正: 「遅出4h+夜勤A」は労基法H14でNGになったため除外
  ];
  const r1 = validateWishSubmission(ok);
  Logger.log('valid: ' + r1.valid);
  r1.violations.forEach(function(v) { Logger.log('  ' + v.rule + ': ' + v.message); });
  
  Logger.log('');
  Logger.log('=== TC5詳細 ===');
  const ok2 = [
    { dateKey: '2026-06-01', shift: '遅出4h' },
    { dateKey: '2026-06-01', shift: '夜勤A' }
  ];
  const r5 = validateWishSubmission(ok2);
  Logger.log('valid: ' + r5.valid);
  r5.violations.forEach(function(v) { Logger.log('  ' + v.rule + ': ' + v.message); });
}
