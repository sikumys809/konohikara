// ============================================
// コノヒカラ スタッフアプリ サーバー側処理 v6
// 18列スタッフ + 新T_希望提出(H:メイン/I:セカンド/J:サブ)
// + 施設住所対応 + 入社月数ベースメッセージ
// ============================================

const COL_STAFF = {
  ID: 0, NAME: 1, EMAIL: 2, PHONE: 3,
  EMPLOYMENT: 4, QUALIFICATION: 5,
  HIRE_DATE: 6, HIRE_MONTHS: 7, KUBUN: 8,
  MAIN_FAC: 9, SECOND_FAC: 10, SUB_FACS: 11,
  SHIFT_KUBUN: 12, ALLOWED_SHIFTS: 13,
  PROTECT: 14, VIP: 15, RETIRE: 16, NOTE: 17,
};

const COL_REQ = {
  ID:0, TIME:1, STAFF_ID:2, NAME:3,
  YM:4, DATE:5, SHIFT:6,
  MAIN_FAC:7, SECOND_FAC:8, SUB_FACS:9,
  COMMENT:10, FREQ_TYPE:11, FREQ_COUNT:12,
};

const COL_SHIFT = {
  ID:0, DATE:1, UNIT_ID:2, JIGYOSHO:3, FACILITY:4,
  UNIT:5, STAFF_ID:6, NAME:7, SHIFT_TYPE:8,
  START:9, END:10, COUNT:11, STATUS:12, UPDATED:13,
};

// ★ Phase: 提出期間は M_設定 シートから動的取得 (submission_settings.js の getSubmissionPeriod)
// 互換性のため定数も残すが、実際の判定では _getSubmitDays() を使う
const SUBMIT_START_DAY = 10;  // デフォルト値
const SUBMIT_END_DAY = 22;    // デフォルト値


// ============================================================
// Phase 7: スタッフの固定配置あり判定 (Index.html.html で使用)
// ============================================================
function _isStaffFixedAssigned(staffId) {
  try {
    if (typeof listFixedAssignments !== 'function') return false;
    const result = listFixedAssignments({ staff_id: staffId, is_active: true });
    if (!result.success) return false;
    return result.items.length > 0;
  } catch (e) {
    return false;
  }
}

function _getSubmitDays() {
  try {
    if (typeof getSubmissionPeriod === 'function') {
      return getSubmissionPeriod();
    }
  } catch (e) {}
  return { startDay: _sp1.startDay, endDay: _sp1.endDay };
}

// シフト時間定義
const SHIFT_TIMES = {
  '夜勤A': {
    label: '20:00-05:00',
    start: '20:00', end: '05:00',
    breaks: [{ start: '02:00', end: '03:00' }],
    workHours: 8
  },
  '夜勤B': {
    label: '22:00-07:00',
    start: '22:00', end: '07:00',
    breaks: [{ start: '02:00', end: '03:00' }],
    workHours: 8
  },
  '夜勤C': {
    label: '22:00-08:00',
    start: '22:00', end: '08:00',
    breaks: [
      { start: '02:00', end: '03:00' },
      { start: '05:00', end: '06:00' }
    ],
    workHours: 8
  },
  '早出8h': {
    label: '07:00-16:00',
    start: '07:00', end: '16:00',
    breaks: [{ start: '11:00', end: '12:00' }],
    workHours: 8
  },
  '早出4h': {
    label: '07:00-11:00',
    start: '07:00', end: '11:00',
    breaks: [],
    workHours: 4
  },
  '遅出8h': {
    label: '13:00-22:00',
    start: '13:00', end: '22:00',
    breaks: [{ start: '18:00', end: '19:00' }],
    workHours: 8
  },
  '遅出4h': {
    label: '13:00-17:00',
    start: '13:00', end: '17:00',
    breaks: [],
    workHours: 4
  }
};

function doGet(e) {
  // ?page=admin なら管理画面、それ以外はスタッフアプリ
  const page = (e && e.parameter && e.parameter.page) ? e.parameter.page : 'staff';
  
  if (page === 'admin') {
    return HtmlService.createHtmlOutputFromFile('Admin')
      .setTitle('コノヒカラ シフト管理 - 管理画面')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('コノヒカラ シフト管理')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ============================================
// ユーティリティ
// ============================================

// ============================================
// 氏名クリーンアップ(スタッフアプリ表示用)
// 括弧内のメモ(柚井紹介学生 等)を除去
// 例: "中村賢太（柚井紹介学生）" -> "中村賢太"
//     "高橋虎ノ介（柚井）" -> "高橋虎ノ介"
//     "水野 永吉" -> "水野 永吉" (変化なし)
// ============================================
function cleanStaffName(name) {
  if (!name) return '';
  return String(name).replace(/[（(][^）)]*[）)]/g, '').trim();
}

function normalizeYM(val) {
  if (val instanceof Date) return Utilities.formatDate(val, 'Asia/Tokyo', 'yyyy-MM');
  return String(val).trim();
}

function getDefaultAllowedShifts(kubun) {
  if (kubun === '夜勤のみ') return ['夜勤A','夜勤B','夜勤C'];
  if (kubun === '日勤のみ') return ['早出8h','遅出8h'];
  return ['夜勤A','夜勤B','夜勤C','早出8h','遅出8h'];
}

function calcMonthsSinceHire(hireDate) {
  if (!hireDate || !(hireDate instanceof Date)) return null;
  const now = new Date();
  const months = (now.getFullYear() - hireDate.getFullYear()) * 12 + (now.getMonth() - hireDate.getMonth());
  return months >= 0 ? months : null;
}

function getSubmitPeriodInfo(staffId) {
  const now = new Date();
  const day = now.getDate();
  const year = now.getFullYear();
  const month = now.getMonth();
  
  const targetDate = new Date(year, month + 1, 1);
  const targetYear = targetDate.getFullYear();
  const targetMonth = targetDate.getMonth() + 1;
  const targetYM = targetYear + '-' + String(targetMonth).padStart(2, '0');
  
  // ★ オーバーライド判定（個人 → 全体 → 通常ロジック）
  const override = staffId ? checkSubmitOverride(staffId, targetYM, now) : null;
  if (override) {
    return {
      isOpen: true,
      targetYM: targetYM,
      targetYear: targetYear,
      targetMonth: targetMonth,
      message: targetYear + '年' + targetMonth + '月分の希望を提出できます (特例開放: ' + override.reason + ')',
      startDay: _sp1.startDay,
      endDay: _sp1.endDay,
      isOverride: true,
      overrideType: override.type,
    };
  }
  
  const _sp1 = _getSubmitDays();
  const isOpen = day >= _sp1.startDay && day <= _sp1.endDay;
  
  let openMsg = '';
  if (isOpen) {
    openMsg = targetYear + '年' + targetMonth + '月分の希望を提出できます(〜' + _sp1.endDay + '日まで)';
  } else if (day < _sp1.startDay) {
    openMsg = targetYear + '年' + targetMonth + '月分の提出期間: ' + _sp1.startDay + '日〜' + _sp1.endDay + '日';
  } else {
    openMsg = '提出期間外です。次回: 来月' + _sp1.startDay + '日から';
  }
  
  return {
    isOpen: isOpen,
    targetYM: targetYM,
    targetYear: targetYear,
    targetMonth: targetMonth,
    message: openMsg,
    startDay: _sp1.startDay,
    endDay: _sp1.endDay,
    isOverride: false,
  };
}

// ============================================
// 提出期間オーバーライド判定
// ============================================
function checkSubmitOverride(staffId, targetYM, today) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('T_提出期間オーバーライド');
    if (!sheet) return null;
    
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return null;
    
    const todayStr = Utilities.formatDate(today, 'Asia/Tokyo', 'yyyy-MM-dd');
    
    let personalMatch = null;
    let globalMatch = null;
    
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const rowStaffId = row[1];
      let rowTargetYM = '';
      if (row[3] instanceof Date) {
        rowTargetYM = Utilities.formatDate(row[3], 'Asia/Tokyo', 'yyyy-MM');
      } else if (row[3]) {
        rowTargetYM = String(row[3]).trim();
      }
      const startDate = row[4];
      const endDate = row[5];
      const unrestricted = row[6] === true || row[6] === 'TRUE' || row[6] === 'true';
      const memo = row[10] || '';
      
      // 対象月チェック (空なら全月対象)
      if (rowTargetYM && rowTargetYM !== targetYM) continue;
      
      // 期間チェック (unrestricted=true なら期間制限なし)
      if (!unrestricted) {
        if (startDate) {
          const startStr = startDate instanceof Date 
            ? Utilities.formatDate(startDate, 'Asia/Tokyo', 'yyyy-MM-dd')
            : String(startDate);
          if (todayStr < startStr) continue;
        }
        if (endDate) {
          const endStr = endDate instanceof Date 
            ? Utilities.formatDate(endDate, 'Asia/Tokyo', 'yyyy-MM-dd')
            : String(endDate);
          if (todayStr > endStr) continue;
        }
      }
      
      // マッチ
      const reason = memo || (unrestricted ? '期間制限なし' : '特例開放');
      if (Number(rowStaffId) === Number(staffId)) {
        personalMatch = { type: 'personal', reason: reason };
      } else if (Number(rowStaffId) === 0) {
        globalMatch = { type: 'global', reason: reason };
      }
    }
    
    return personalMatch || globalMatch;
  } catch (e) {
    Logger.log('checkSubmitOverride エラー: ' + e.message);
    return null;
  }
}

// ============================================
// 施設配置パターン判定(3パターン)
// ============================================
function determineFacilityPattern(mainFac, secondFac, subFacs) {
  const hasMain = !!mainFac;
  const hasSecond = !!secondFac && secondFac !== mainFac;
  const uniqueSubs = (subFacs || []).filter(f => f && f !== mainFac && f !== secondFac);
  const hasSub = uniqueSubs.length > 0;

  if (!hasMain) return { pattern: 'none', displayCount: 0 };
  if (!hasSecond && !hasSub) return { pattern: 'fixed', displayCount: 1 };
  if (hasSecond && !hasSub) return { pattern: 'double', displayCount: 2 };
  return { pattern: 'multi', displayCount: 1 + (hasSecond ? 1 : 0) + uniqueSubs.length };
}

// ============================================
// スタッフ認証
// ============================================
function authenticateStaff(email) {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('M_スタッフ');
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const mail = String(row[COL_STAFF.EMAIL]).trim().toLowerCase();
    const retired = String(row[COL_STAFF.RETIRE]).toUpperCase() === 'TRUE';
    if (!mail || mail !== email.trim().toLowerCase() || retired) continue;

    const shiftKubun = String(row[COL_STAFF.SHIFT_KUBUN] || '両方').trim() || '両方';
    const rawAllowed = String(row[COL_STAFF.ALLOWED_SHIFTS] || '').trim();
    // ★ シフト種別が未設定なら空配列 (UI側で「未設定」表示)
    // 旧: getDefaultAllowedShifts(shiftKubun) でレガシー名を返してた
    const allowedShifts = rawAllowed
      ? rawAllowed.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    const mainFac = String(row[COL_STAFF.MAIN_FAC] || '').trim();
    const secondFac = String(row[COL_STAFF.SECOND_FAC] || '').trim();
    const rawSub = String(row[COL_STAFF.SUB_FACS] || '').trim();
    const subFacs = rawSub ? rawSub.split(',').map(f => f.trim()).filter(Boolean) : [];

    const pattern = determineFacilityPattern(mainFac, secondFac, subFacs);

    // フロント用の施設リスト
    const allFacs = [];
    if (mainFac) allFacs.push({ name: mainFac, type: 'main' });
    if (secondFac && secondFac !== mainFac) allFacs.push({ name: secondFac, type: 'second' });
    for (const sub of subFacs) {
      if (sub !== mainFac && sub !== secondFac) {
        allFacs.push({ name: sub, type: 'sub' });
      }
    }

    let monthsSinceHire = row[COL_STAFF.HIRE_MONTHS];
    if (monthsSinceHire === null || monthsSinceHire === undefined || monthsSinceHire === '') {
      monthsSinceHire = calcMonthsSinceHire(row[COL_STAFF.HIRE_DATE]);
    } else {
      monthsSinceHire = parseInt(monthsSinceHire);
    }

    return {
      success: true,
      staff_id: String(row[COL_STAFF.ID]).trim(),
      isFixedAssigned: _isStaffFixedAssigned(String(row[COL_STAFF.ID]).trim()),
      name: cleanStaffName(row[COL_STAFF.NAME]),
      employment: String(row[COL_STAFF.EMPLOYMENT] || '').trim(),
      qualification: String(row[COL_STAFF.QUALIFICATION] || '').trim(),
      shiftKubun: shiftKubun,
      allowedShifts: allowedShifts,
      mainFacility: mainFac,
      secondFacility: secondFac,
      subFacilities: subFacs.filter(f => f !== mainFac && f !== secondFac),
      allFacilities: allFacs,
      facilityPattern: pattern.pattern,
      displayCount: pattern.displayCount,
      shiftTimes: SHIFT_TIMES,
      monthsSinceHire: monthsSinceHire || 0,
      isVIP: String(row[COL_STAFF.VIP] || 'FALSE').toUpperCase() === 'TRUE',
      isProtected: String(row[COL_STAFF.PROTECT] || 'FALSE').toUpperCase() === 'TRUE',
    };
  }
  return { success: false, message: 'メールアドレスが見つかりません' };
}

// ============================================
// マイページ情報 v2 (施設住所含む)
// ============================================
function getPersonalInfo(staffId) {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('M_スタッフ');
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (String(row[COL_STAFF.ID]).trim() !== String(staffId).trim()) continue;

    const mainFac = String(row[COL_STAFF.MAIN_FAC] || '').trim();
    const secondFac = String(row[COL_STAFF.SECOND_FAC] || '').trim();
    const rawSub = String(row[COL_STAFF.SUB_FACS] || '').trim();
    const subs = rawSub ? rawSub.split(',').map(f => f.trim()).filter(Boolean) : [];
    
    const facilityMap = getFacilityAddressMap();
    
    const myFacilities = [];
    if (mainFac) {
      myFacilities.push({ type: 'main', name: mainFac, ...getFacilityInfo(facilityMap, mainFac) });
    }
    if (secondFac && secondFac !== mainFac) {
      myFacilities.push({ type: 'second', name: secondFac, ...getFacilityInfo(facilityMap, secondFac) });
    }
    for (const sub of subs) {
      if (sub !== mainFac && sub !== secondFac) {
        myFacilities.push({ type: 'sub', name: sub, ...getFacilityInfo(facilityMap, sub) });
      }
    }

    return {
      success: true,
      name: cleanStaffName(row[COL_STAFF.NAME]),
      facilities: myFacilities,
    };
  }
  return { success: false, message: '情報が見つかりません' };
}

// ============================================
// M_施設から住所マップを取得
// ============================================
function getFacilityAddressMap() {
  try {
    const ss = SpreadsheetApp.openById(STAFF_SS_ID);
    const sheet = ss.getSheetByName('M_施設');
    if (!sheet) return {};
    
    const data = sheet.getDataRange().getValues();
    const map = {};
    
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (row[0]) {
        map[row[0]] = {
          zip: row[1] || '',
          address: row[2] || '',
          station: row[3] || '',
          note: row[4] || '',
        };
      }
    }
    return map;
  } catch (e) {
    return {};
  }
}

function getFacilityInfo(map, facilityName) {
  const info = map[facilityName] || {};
  const address = info.address || '';
  return {
    zip: info.zip || '',
    address: address,
    station: info.station || '',
    note: info.note || '',
    mapUrl: address ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(address) : '',
  };
}

function getFacilities() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('M_ユニット');
  const data = sheet.getDataRange().getValues();
  const set = new Set();
  for (let i = 1; i < data.length; i++) {
    if (data[i][3]) set.add(data[i][3]);
  }
  return [...set].sort();
}

// ============================================
// 自分の希望を取得
// ============================================
function getMyRequests(staffId, yearMonth) {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('T_希望提出');
  const data = sheet.getDataRange().getValues();
  const results = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (String(row[COL_REQ.STAFF_ID]).trim() !== String(staffId).trim()) continue;
    if (normalizeYM(row[COL_REQ.YM]) !== yearMonth) continue;
    
    const rawSub = String(row[COL_REQ.SUB_FACS] || '').trim();
    const subs = rawSub ? rawSub.split(',').map(f => f.trim()).filter(Boolean) : [];
    
    results.push({
      id: row[COL_REQ.ID],
      date: row[COL_REQ.DATE] instanceof Date
        ? Utilities.formatDate(row[COL_REQ.DATE], 'Asia/Tokyo', 'yyyy-MM-dd')
        : String(row[COL_REQ.DATE]),
      shift: String(row[COL_REQ.SHIFT]),
      mainFac: String(row[COL_REQ.MAIN_FAC] || ''),
      secondFac: String(row[COL_REQ.SECOND_FAC] || ''),
      subFacs: subs,
      comment: String(row[COL_REQ.COMMENT] || ''),
      freqType: String(row[COL_REQ.FREQ_TYPE] || ''),
      freqCount: row[COL_REQ.FREQ_COUNT] || '',
    });
  }
  return results.sort((a, b) => {
    const da = new Date(a.date), db = new Date(b.date);
    if (da - db !== 0) return da - db;
    return a.shift.localeCompare(b.shift);
  });
}

// ============================================
// 新submitRequests: 施設一括指定 + 複数シフト種別
// ============================================
function submitRequests(staffId, name, yearMonth, facilities, requests, freqType, freqCount) {
  name = cleanStaffName(name);
  
  // 月次ロックチェック
  if (isMonthLockedForStaff(yearMonth)) {
    return { success: false, message: yearMonth + 'はシフト確定済みです。修正が必要な場合は管理者にご連絡ください。' };
  }
  
  const period = getSubmitPeriodInfo(staffId);
  if (!period.isOpen) {
    const _sp2 = _getSubmitDays();
    return { success: false, message: '現在は提出期間外です(毎月' + _sp2.startDay + '日〜' + _sp2.endDay + '日)' };
  }
  if (yearMonth !== period.targetYM) {
    return { success: false, message: '提出できるのは ' + period.targetYear + '年' + period.targetMonth + '月分のみです' };
  }
  if (!freqType || !freqCount) {
    return { success: false, message: '希望頻度を設定してください' };
  }
  if (!facilities) {
    return { success: false, message: '希望施設情報がありません' };
  }

  const staff = authenticateStaffById(staffId);
  if (!staff.success) {
    return { success: false, message: 'スタッフ情報の取得に失敗しました' };
  }

  // バリデーション
  if (!facilities.main) {
    return { success: false, message: 'メイン施設は必須です' };
  }
  if (facilities.main !== staff.mainFacility) {
    return { success: false, message: 'メイン施設が登録内容と一致しません' };
  }

  if (staff.secondFacility) {
    if (!facilities.second) {
      return { success: false, message: 'セカンド施設は必須です' };
    }
    if (facilities.second !== staff.secondFacility) {
      return { success: false, message: 'セカンド施設が登録内容と一致しません' };
    }
  }

  if (staff.subFacilities && staff.subFacilities.length > 0) {
    const selectedSubs = (facilities.subs || []).filter(Boolean);
    if (selectedSubs.length < 1) {
      return { success: false, message: 'サブ施設を1つ以上選択してください' };
    }
    for (const sub of selectedSubs) {
      if (!staff.subFacilities.includes(sub)) {
        return { success: false, message: '登録外のサブ施設が含まれています: ' + sub };
      }
    }
  }

  if (!requests || requests.length === 0) {
    return { success: false, message: '希望日が1件もありません' };
  }
  for (const req of requests) {
    if (!req.date) {
      return { success: false, message: '日付が未入力の希望があります' };
    }
    if (!req.shifts || req.shifts.length === 0) {
      return { success: false, message: req.date + ' のシフト種別が未選択です' };
    }
  }

  // ★ 提出時バリデーション5ルール (validateWishSubmission)
  // 仕様: https://www.notion.so/357ec81ceecf81b4bcc7cca0cd4c082a
  const flatWishes = [];
  for (const req of requests) {
    for (const shift of req.shifts) {
      flatWishes.push({ dateKey: req.date, shift: shift });
    }
  }
  const valid = validateWishSubmission(flatWishes);
  if (!valid.valid) {
    const messages = valid.violations.map(function(v) { return v.message; });
    return {
      success: false,
      message: '希望提出のチェックでエラーが見つかりました:\n\n' + messages.join('\n'),
      violations: valid.violations
    };
  }

  // 既存データ削除
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('T_希望提出');
  const data = sheet.getDataRange().getValues();

  const toDelete = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][COL_REQ.STAFF_ID]).trim() === String(staffId).trim() &&
        normalizeYM(data[i][COL_REQ.YM]) === yearMonth) {
      toDelete.push(i + 1);
    }
  }
  for (let i = toDelete.length - 1; i >= 0; i--) sheet.deleteRow(toDelete[i]);

  // 新レコード展開
  const now = new Date();
  const mainFac = facilities.main;
  const secondFac = facilities.second || '';
  const subFacsStr = (facilities.subs || []).join(',');
  
  const rows = [];
  let seqCounter = 1;
  
  for (const req of requests) {
    for (const shift of req.shifts) {
      rows.push([
        staffId + '_' + yearMonth + '_' + String(seqCounter).padStart(3, '0'),
        now,
        staffId,
        name,
        yearMonth,
        req.date,
        shift,
        mainFac,
        secondFac,
        subFacsStr,
        req.comment || '',
        freqType,
        freqCount,
      ]);
      seqCounter++;
    }
  }

  if (rows.length > 0) {
    const sr = sheet.getLastRow() + 1;
    sheet.getRange(sr, 1, rows.length, 13).setValues(rows);
    sheet.getRange(sr, 5, rows.length, 1).setNumberFormat('@');
  }
  
  return { 
    success: true, 
    count: rows.length,
    uniqueDates: requests.length,
    totalShifts: rows.length
  };
}

// ============================================
// staff_idで認証情報を取得(内部用)
// ============================================
function authenticateStaffById(staffId) {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('M_スタッフ');
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (String(row[COL_STAFF.ID]).trim() !== String(staffId).trim()) continue;
    const retired = String(row[COL_STAFF.RETIRE]).toUpperCase() === 'TRUE';
    if (retired) continue;

    const mainFac = String(row[COL_STAFF.MAIN_FAC] || '').trim();
    const secondFac = String(row[COL_STAFF.SECOND_FAC] || '').trim();
    const rawSub = String(row[COL_STAFF.SUB_FACS] || '').trim();
    const subFacs = rawSub ? rawSub.split(',').map(f => f.trim()).filter(Boolean) : [];
    const uniqueSubs = subFacs.filter(f => f !== mainFac && f !== secondFac);
    const pattern = determineFacilityPattern(mainFac, secondFac, uniqueSubs);

    return {
      success: true,
      staff_id: String(row[COL_STAFF.ID]).trim(),
      isFixedAssigned: _isStaffFixedAssigned(String(row[COL_STAFF.ID]).trim()),
      name: cleanStaffName(row[COL_STAFF.NAME]),
      mainFacility: mainFac,
      secondFacility: secondFac && secondFac !== mainFac ? secondFac : '',
      subFacilities: uniqueSubs,
      facilityPattern: pattern.pattern,
    };
  }
  return { success: false };
}

// ============================================
// 入社月数ベースのメッセージ生成
// ============================================
function getMotivationMessage(staffId) {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('M_スタッフ');
  const data = sheet.getDataRange().getValues();
  
  let name = '';
  let months = 0;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][COL_STAFF.ID]).trim() !== String(staffId).trim()) continue;
    name = cleanStaffName(data[i][COL_STAFF.NAME]);
    const m = data[i][COL_STAFF.HIRE_MONTHS];
    if (m !== null && m !== undefined && m !== '') {
      months = parseInt(m);
    } else {
      months = calcMonthsSinceHire(data[i][COL_STAFF.HIRE_DATE]) || 0;
    }
    break;
  }
  
  if (!name) return { success: false };
  
  let stage;
  if (months <= 1) stage = 'start';
  else if (months <= 6) stage = 'familiar';
  else if (months <= 12) stage = 'established';
  else if (months <= 36) stage = 'midlevel';
  else if (months <= 60) stage = 'veteran';
  else stage = 'legend';
  
  const hour = new Date().getHours();
  let timeOfDay;
  if (hour >= 5 && hour < 11) timeOfDay = 'morning';
  else if (hour >= 11 && hour < 17) timeOfDay = 'day';
  else timeOfDay = 'night';
  
  const messages = {
    start: {
      morning: [
        `${name}さん、おはようございます 🌱 新しい環境、一歩ずつ進んでいきましょう`,
        `${name}さん、今日もよろしくお願いします。わからないことは遠慮なく聞いてくださいね 🌱`,
        `${name}さん、おはようございます。少しずつ慣れていきましょう、応援しています`,
      ],
      day: [
        `${name}さん、お疲れさまです 🌱 今日もゆっくりペースで大丈夫ですよ`,
        `${name}さん、日々の積み重ねが力になります。応援しています 🌱`,
        `${name}さん、わからないことがあれば、いつでも声をかけてください`,
      ],
      night: [
        `${name}さん、今日も一日お疲れさまでした 🌱 ゆっくり休んでくださいね`,
        `${name}さん、お疲れさまです。少しずつ確実に前に進んでいますよ 🌱`,
        `${name}さん、今日も頑張りましたね。明日もサポートしていきます`,
      ],
    },
    familiar: {
      morning: [
        `${name}さん、おはようございます 🌿 今日もよろしくお願いします`,
        `${name}さん、お疲れさまです。頼もしくなってきましたね 🌿`,
        `${name}さん、おはようございます。日々の成長を感じています`,
      ],
      day: [
        `${name}さん、お疲れさまです 🌿 頑張りはしっかり伝わっていますよ`,
        `${name}さん、今日もありがとうございます。調子はいかがですか？ 🌿`,
        `${name}さん、日々の積み重ね、素晴らしいです`,
      ],
      night: [
        `${name}さん、今日も一日お疲れさまでした 🌿 ゆっくり休んでくださいね`,
        `${name}さん、お疲れさまです。一日の頑張り、ありがとうございました 🌿`,
        `${name}さん、今日もよくやりましたね。明日もよろしくお願いします`,
      ],
    },
    established: {
      morning: [
        `${name}さん、おはようございます 🌳 今日もよろしくお願いします`,
        `${name}さん、お疲れさまです。チームに欠かせない存在です 🌳`,
        `${name}さん、おはようございます。いつも頼りにしています`,
      ],
      day: [
        `${name}さん、お疲れさまです 🌳 いつもありがとうございます`,
        `${name}さん、今日も頼りにしています 🌳`,
        `${name}さん、日々の貢献、感謝しています`,
      ],
      night: [
        `${name}さん、今日も一日お疲れさまでした 🌳 ゆっくり休んでください`,
        `${name}さん、今日もありがとうございました 🌳`,
        `${name}さん、お疲れさまです。明日もよろしくお願いします`,
      ],
    },
    midlevel: {
      morning: [
        `${name}さん、おはようございます 🌲 今日もよろしくお願いします`,
        `${name}さん、お疲れさまです。いつも支えてくれてありがとうございます 🌲`,
        `${name}さん、おはようございます。あなたの経験にいつも助けられています`,
      ],
      day: [
        `${name}さん、お疲れさまです 🌲 あなたの力が本当に頼もしいです`,
        `${name}さん、いつもありがとうございます 🌲`,
        `${name}さん、日々の積み重ねたご経験、本当に感謝しています`,
      ],
      night: [
        `${name}さん、今日も一日お疲れさまでした 🌲 ゆっくりお休みください`,
        `${name}さん、今日もありがとうございました。本当に助かりました 🌲`,
        `${name}さん、お疲れさまです。あなたがいてくれて心強いです`,
      ],
    },
    veteran: {
      morning: [
        `${name}さん、おはようございます 🏔 今日もよろしくお願いいたします`,
        `${name}さん、おはようございます。いつも本当にありがとうございます 🏔`,
        `${name}さん、朝からご苦労さまです。あなたの存在がチームの支えです`,
      ],
      day: [
        `${name}さん、お疲れさまです 🏔 いつもありがとうございます`,
        `${name}さん、長きにわたるご貢献、心から感謝しています 🏔`,
        `${name}さん、あなたの経験と姿勢に、いつも学ばせてもらっています`,
      ],
      night: [
        `${name}さん、今日も一日お疲れさまでした 🏔 ごゆっくりお休みください`,
        `${name}さん、今日も本当にありがとうございました 🏔`,
        `${name}さん、お疲れさまでした。心から感謝しています`,
      ],
    },
    legend: {
      morning: [
        `${name}さん、おはようございます 👑 長きにわたり本当にありがとうございます`,
        `${name}さん、おはようございます。あなたの積み重ねてこられた時間がチームの財産です 👑`,
        `${name}さん、朝からご苦労さまです。心からの敬意を込めて、今日もよろしくお願いいたします`,
      ],
      day: [
        `${name}さん、お疲れさまです 👑 いつも本当にありがとうございます`,
        `${name}さん、あなたの長年の貢献に、深く感謝しています 👑`,
        `${name}さん、お疲れさまです。心からの敬意を込めて`,
      ],
      night: [
        `${name}さん、今日も一日お疲れさまでした 👑 ごゆっくりお休みください`,
        `${name}さん、長きにわたるご尽力、本当にありがとうございます 👑`,
        `${name}さん、お疲れさまでした。敬意と感謝を込めて`,
      ],
    },
  };
  
  const list = messages[stage][timeOfDay];
  const message = list[Math.floor(Math.random() * list.length)];
  
  return {
    success: true,
    message: message,
    stage: stage,
    months: months,
  };
}

// ============================================
// シフト確定取得
// ============================================
function getMyShifts(staffId, yearMonth) {
  Logger.log('getMyShifts called: staffId=' + staffId + ' (型:' + typeof staffId + '), yearMonth=' + yearMonth);
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('T_シフト確定');
  if (!sheet) return [];

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  // ★Day17: M_ユニット から部屋番号マップを構築
  // - unitIdToRoom[unit_id] = 部屋番号 (夜勤用: 自分の配置unit_idから1つ)
  // - facilityToRooms[施設名] = [部屋番号,...] (日勤用: 施設全部屋)
  const unitIdToRoom = {};
  const facilityToRooms = {};
  const unitSheet = ss.getSheetByName('M_ユニット');
  if (unitSheet) {
    const uv = unitSheet.getDataRange().getValues();
    for (let i = 1; i < uv.length; i++) {
      const uid = String(uv[i][0] || '').trim();
      const fac = String(uv[i][3] || '').trim();
      const room = String(uv[i][5] || '').trim();
      if (!uid || !room) continue;
      unitIdToRoom[uid] = room;
      if (fac) {
        if (!facilityToRooms[fac]) facilityToRooms[fac] = [];
        if (facilityToRooms[fac].indexOf(room) === -1) facilityToRooms[fac].push(room);
      }
    }
  }

  const isNightShift = (st) => st === '夜勤A' || st === '夜勤B' || st === '夜勤C';

  const targetSid = String(staffId);
  const result = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const rowSid = String(row[COL_SHIFT.STAFF_ID]);
    if (rowSid !== targetSid) continue;

    const status = String(row[COL_SHIFT.STATUS] || '').trim();
    if (status !== '確定') continue;

    const dateVal = row[COL_SHIFT.DATE];
    const dateStr = dateVal instanceof Date
      ? Utilities.formatDate(dateVal, 'Asia/Tokyo', 'yyyy-MM-dd')
      : String(dateVal).substring(0, 10);

    if (!dateStr.startsWith(yearMonth)) continue;

    // 時刻フィールドのパース (Date型・文字列両対応)
    const parseTime = (val) => {
      if (!val) return '';
      if (val instanceof Date) return Utilities.formatDate(val, 'Asia/Tokyo', 'HH:mm');
      const s = String(val).trim();
      if (/^\d{1,2}:\d{2}$/.test(s)) return s.padStart(5, '0');
      const m = s.match(/(\d{2}):(\d{2}):\d{2}/);
      if (m) return m[1] + ':' + m[2];
      return s;
    };

    // ★Day17: 部屋番号を組み立て
    const shiftType = String(row[COL_SHIFT.SHIFT_TYPE] || '').trim();
    const facility = String(row[COL_SHIFT.FACILITY] || '').trim();
    const unitId = String(row[2] || '').trim();  // T_シフト確定 index 2 = unit_id
    let rooms = '';
    if (isNightShift(shiftType)) {
      // 夜勤: 自分の配置ユニットの部屋番号 (1つ)
      rooms = unitIdToRoom[unitId] || '';
    } else {
      // 日勤: 施設にある全部屋番号
      const list = facilityToRooms[facility] || [];
      rooms = list.join(' / ');
    }

    result.push({
      date: dateStr,
      facility: facility,
      rooms: rooms,
      shift: shiftType,
      start: parseTime(row[COL_SHIFT.START]),
      end: parseTime(row[COL_SHIFT.END]),
    });
  }

  result.sort((a, b) => a.date.localeCompare(b.date));
  return result;
}

// ============================================
// 出退勤打刻
// ============================================
function clockIn(staffId, name, facility) {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('T_打刻');
  const now = new Date();
  const today = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd');
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const rDate = row[1] instanceof Date
      ? Utilities.formatDate(new Date(row[1]), 'Asia/Tokyo', 'yyyy-MM-dd') : String(row[1]);
    if (rDate === today && String(row[2]).trim() === String(staffId).trim() &&
        String(row[8]).toUpperCase() === 'TRUE') {
      return { success: false, message: '本日はすでに出勤済みです' };
    }
  }
  sheet.appendRow([
    staffId + '_' + today + '_in', today, staffId, name, facility,
    now, '', '', 'TRUE', 'FALSE', '',
  ]);
  return { success: true, message: '出勤を記録しました' };
}

function clockOut(staffId) {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('T_打刻');
  const now = new Date();
  const today = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd');
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const rDate = row[1] instanceof Date
      ? Utilities.formatDate(new Date(row[1]), 'Asia/Tokyo', 'yyyy-MM-dd') : String(row[1]);
    if (rDate === today && String(row[2]).trim() === String(staffId).trim() &&
        String(row[8]).toUpperCase() === 'TRUE' && String(row[9]).toUpperCase() !== 'TRUE') {
      const minutes = Math.round((now - new Date(row[5])) / 60000);
      sheet.getRange(i + 1, 7).setValue(now);
      sheet.getRange(i + 1, 8).setValue(minutes);
      sheet.getRange(i + 1, 10).setValue('TRUE');
      return { success: true, message: '退勤を記録しました' };
    }
  }
  return { success: false, message: '出勤記録が見つかりません。先に出勤打刻してください' };
}

function getAttendanceStatus(staffId) {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('T_打刻');
  const today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const rDate = row[1] instanceof Date
      ? Utilities.formatDate(new Date(row[1]), 'Asia/Tokyo', 'yyyy-MM-dd') : String(row[1]);
    if (rDate === today && String(row[2]).trim() === String(staffId).trim()) {
      return {
        clockedIn: String(row[8]).toUpperCase() === 'TRUE',
        clockedOut: String(row[9]).toUpperCase() === 'TRUE',
      };
    }
  }
  return { clockedIn: false, clockedOut: false };
}



// ============================================
// 月次ロックチェック (スタッフ側)
// ============================================

function isMonthLockedForStaff(yearMonth) {
  try {
    const ss = SpreadsheetApp.openById(STAFF_SS_ID);
    const sheet = ss.getSheetByName('T_月次ロック');
    if (!sheet) return false;
    
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(yearMonth)) {
        return String(data[i][1]).toUpperCase() === 'TRUE';
      }
    }
    return false;
  } catch (e) {
    Logger.log('ロックチェックエラー: ' + e.toString());
    return false;
  }
}


function checkMonthLockForStaff(yearMonth) {
  const locked = isMonthLockedForStaff(yearMonth);
  return { success: true, locked: locked };
}

function debugGetMyShifts() {
  Logger.log('=== STAFF_SS_ID: ' + STAFF_SS_ID + ' ===');

  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  Logger.log('Spreadsheet: ' + ss.getName());

  const sheet = ss.getSheetByName('T_シフト確定');
  if (!sheet) {
    Logger.log('❌ T_シフト確定 シート見つからず');
    return;
  }

  const data = sheet.getDataRange().getValues();
  Logger.log('総行数: ' + data.length);
  Logger.log('ヘッダ行: ' + JSON.stringify(data[0]));

  // COL_SHIFT 確認
  Logger.log('COL_SHIFT.STAFF_ID = ' + COL_SHIFT.STAFF_ID);
  Logger.log('COL_SHIFT.DATE = ' + COL_SHIFT.DATE);
  Logger.log('COL_SHIFT.STATUS = ' + COL_SHIFT.STATUS);
  Logger.log('COL_SHIFT.SHIFT_TYPE = ' + COL_SHIFT.SHIFT_TYPE);
  Logger.log('COL_SHIFT.START = ' + COL_SHIFT.START);
  Logger.log('COL_SHIFT.END = ' + COL_SHIFT.END);
  Logger.log('COL_SHIFT.FACILITY = ' + COL_SHIFT.FACILITY);

  // 中村仁美さん (staff_id=5) の行を探す
  let nakamuraCount = 0;
  let nakamuraStatusVarieties = {};
  let dateMonths = {};

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const sid = String(row[COL_SHIFT.STAFF_ID]);

    if (sid === '5' || sid === '13') {
      nakamuraCount++;
      const status = String(row[COL_SHIFT.STATUS] || '');
      nakamuraStatusVarieties[status] = (nakamuraStatusVarieties[status] || 0) + 1;

      const dateVal = row[COL_SHIFT.DATE];
      const dateStr = dateVal instanceof Date
        ? Utilities.formatDate(dateVal, 'Asia/Tokyo', 'yyyy-MM-dd')
        : String(dateVal).substring(0, 10);
      const ym = dateStr.substring(0, 7);
      dateMonths[ym] = (dateMonths[ym] || 0) + 1;

      // 最初の3件は詳細ログ
      if (nakamuraCount <= 3) {
        Logger.log('--- 中村仁美 行' + (i+1) + ' ---');
        Logger.log('  date: ' + dateVal + ' → ' + dateStr);
        Logger.log('  status: ' + status);
        Logger.log('  shift: ' + row[COL_SHIFT.SHIFT_TYPE]);
        Logger.log('  facility: ' + row[COL_SHIFT.FACILITY]);
        Logger.log('  start: ' + row[COL_SHIFT.START] + ' (型:' + typeof row[COL_SHIFT.START] + ')');
        Logger.log('  end: ' + row[COL_SHIFT.END]);
      }
    }
  }

  Logger.log('========');
  Logger.log('中村仁美 (staff_id=5) 総行数: ' + nakamuraCount);
  Logger.log('ステータス内訳: ' + JSON.stringify(nakamuraStatusVarieties));
  Logger.log('月別内訳: ' + JSON.stringify(dateMonths));

  // 実際に getMyShifts を呼ぶ
  Logger.log('========');
  Logger.log('getMyShifts(5, "2026-05") 実行...');
  const result = getMyShifts(5, '2026-05');
  Logger.log('結果件数: ' + result.length);
  if (result.length > 0) {
    Logger.log('最初の1件: ' + JSON.stringify(result[0]));
  }

  Logger.log('getMyShifts("5", "2026-05") (文字列版) 実行...');
  const result2 = getMyShifts("5", '2026-05');
  Logger.log('結果件数: ' + result2.length);

  Logger.log('========');
  Logger.log('getMyShifts(13, "2026-05") 実行...');
  const result13 = getMyShifts(13, '2026-05');
  Logger.log('staff_id=13 (水野永吉) 結果件数: ' + result13.length);
  if (result13.length > 0) {
    Logger.log('最初の1件: ' + JSON.stringify(result13[0]));
  }
}
function debug_check_wishes_subfacs_13() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('T_希望提出');
  const data = sheet.getDataRange().getValues();
  
  Logger.log('=== staff_id=13 (水野永吉) の希望レコード SUB_FACS確認 ===');
  
  let count = 0;
  const samples = {};
  
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][COL_REQ.STAFF_ID]).trim() !== '13') continue;
    count++;
    const ym = data[i][COL_REQ.YM];
    const main = String(data[i][COL_REQ.MAIN_FAC] || '');
    const second = String(data[i][COL_REQ.SECOND_FAC] || '');
    const subs = String(data[i][COL_REQ.SUB_FACS] || '');
    
    const key = ym + '|' + main + '|' + second + '|' + subs;
    if (!samples[key]) samples[key] = 0;
    samples[key]++;
  }
  
  Logger.log('総レコード: ' + count);
  Logger.log('');
  Logger.log('=== ユニークパターン ===');
  Object.keys(samples).forEach(function(k) {
    const parts = k.split('|');
    Logger.log('YM=' + parts[0] + ' / MAIN=' + parts[1] + ' / SECOND=' + parts[2] + ' / 件数=' + samples[k]);
    Logger.log('  SUB: ' + parts[3]);
    Logger.log('');
  });
}

function reset_wishes_13_2026_06() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('T_希望提出');
  const data = sheet.getDataRange().getValues();
  
  const toDelete = [];
  for (let i = 1; i < data.length; i++) {
    const staffId = String(data[i][COL_REQ.STAFF_ID]).trim();
    const ym = String(data[i][COL_REQ.YM]).trim();
    if (staffId === '13' && ym === '2026-06') {
      toDelete.push(i + 1);
    }
  }
  
  for (let i = toDelete.length - 1; i >= 0; i--) sheet.deleteRow(toDelete[i]);
  
  Logger.log('=== reset_wishes_13_2026_06 ===');
  Logger.log('削除件数: ' + toDelete.length);
}

function debug_scan_all_wishes_violations() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const wishSheet = ss.getSheetByName('T_希望提出');
  const staffSheet = ss.getSheetByName('M_スタッフ');
  
  const wishData = wishSheet.getDataRange().getValues();
  const staffData = staffSheet.getDataRange().getValues();
  
  // M_スタッフから施設情報を取得
  const staffMap = {};
  for (let i = 1; i < staffData.length; i++) {
    const sid = String(staffData[i][0]).trim();
    if (!sid) continue;
    const subFacsRaw = String(staffData[i][11] || '');  // L列(0-indexed=11)
    staffMap[sid] = {
      name: staffData[i][1],
      mainFac: String(staffData[i][9] || '').trim(),     // J列
      secondFac: String(staffData[i][10] || '').trim(),  // K列
      subFacs: subFacsRaw ? subFacsRaw.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : []
    };
  }
  
  // T_希望提出をスタッフごと月ごとに集計
  const violations = {};
  
  for (let i = 1; i < wishData.length; i++) {
    const sid = String(wishData[i][COL_REQ.STAFF_ID]).trim();
    const ym = String(wishData[i][COL_REQ.YM]).trim();
    if (!sid || !ym) continue;
    
    const main = String(wishData[i][COL_REQ.MAIN_FAC] || '').trim();
    const second = String(wishData[i][COL_REQ.SECOND_FAC] || '').trim();
    const subsRaw = String(wishData[i][COL_REQ.SUB_FACS] || '');
    const subs = subsRaw ? subsRaw.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [];
    
    const staff = staffMap[sid];
    if (!staff) continue;
    
    const issues = [];
    if (main !== staff.mainFac) issues.push('MAIN不一致 (希望=' + main + ' / マスタ=' + staff.mainFac + ')');
    if (second !== staff.secondFac) issues.push('SECOND不一致 (希望=' + second + ' / マスタ=' + staff.secondFac + ')');
    
    for (const s of subs) {
      if (staff.subFacs.indexOf(s) === -1) issues.push('SUB未登録: ' + s);
    }
    
    if (issues.length > 0) {
      const key = sid + '|' + ym;
      if (!violations[key]) violations[key] = { staff: staff.name, sid: sid, ym: ym, issues: {}, count: 0 };
      violations[key].count++;
      issues.forEach(function(iss) {
        violations[key].issues[iss] = (violations[key].issues[iss] || 0) + 1;
      });
    }
  }
  
  Logger.log('=== 違反データスキャン (T_希望提出 vs M_スタッフ) ===');
  const keys = Object.keys(violations);
  Logger.log('違反のあるスタッフ×月: ' + keys.length);
  Logger.log('');
  
  keys.forEach(function(k) {
    const v = violations[k];
    Logger.log(v.sid + '(' + v.staff + ') / ' + v.ym + ' / 影響レコード: ' + v.count);
    Object.keys(v.issues).forEach(function(iss) {
      Logger.log('  - ' + iss + ' (' + v.issues[iss] + '件)');
    });
    Logger.log('');
  });
}

function reset_all_test_wishes_2026_06() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('T_希望提出');
  const data = sheet.getDataRange().getValues();
  
  // テストデータの staff_id を全列挙 (13, 312-314, 901-903)
  const testIds = ['13', '312', '313', '314', '901', '902', '903'];
  const toDelete = [];
  
  for (let i = 1; i < data.length; i++) {
    const sid = String(data[i][COL_REQ.STAFF_ID]).trim();
    const ym = String(data[i][COL_REQ.YM]).trim();
    if (testIds.indexOf(sid) !== -1 && ym === '2026-06') {
      toDelete.push(i + 1);
    }
  }
  
  for (let i = toDelete.length - 1; i >= 0; i--) sheet.deleteRow(toDelete[i]);
  
  Logger.log('=== reset_all_test_wishes_2026_06 ===');
  Logger.log('削除件数: ' + toDelete.length);
  Logger.log('対象ID: ' + testIds.join(','));
}

function debug_count_all_wishes() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('T_希望提出');
  const data = sheet.getDataRange().getValues();
  
  Logger.log('=== T_希望提出 全レコード集計 ===');
  Logger.log('総行数(ヘッダー含む): ' + data.length);
  Logger.log('実データ件数: ' + (data.length - 1));
  
  if (data.length > 1) {
    const byStaff = {};
    for (let i = 1; i < data.length; i++) {
      const sid = String(data[i][COL_REQ.STAFF_ID]).trim();
      byStaff[sid] = (byStaff[sid] || 0) + 1;
    }
    Logger.log('');
    Logger.log('=== スタッフ別件数 ===');
    Object.keys(byStaff).forEach(function(k) {
      Logger.log('  staff_id=' + k + ': ' + byStaff[k] + '件');
    });
  }
}

function reset_all_test_wishes_v2() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('T_希望提出');
  const data = sheet.getDataRange().getValues();
  
  const testIds = ['8', '13', '18', '59', '312', '313', '314', '901', '902', '903'];  // ★Day10: 18/59 追加
  const toDelete = [];
  
  for (let i = 1; i < data.length; i++) {
    const sid = String(data[i][COL_REQ.STAFF_ID]).trim();
    if (testIds.indexOf(sid) === -1) continue;
    
    // YM列がDate型と文字列型の両方に対応
    const ymRaw = data[i][COL_REQ.YM];
    let ym = '';
    if (ymRaw instanceof Date) {
      ym = Utilities.formatDate(ymRaw, 'Asia/Tokyo', 'yyyy-MM');
    } else {
      ym = String(ymRaw).trim();
    }
    
    if (ym === '2026-06') {
      toDelete.push(i + 1);
    }
  }
  
  for (let i = toDelete.length - 1; i >= 0; i--) sheet.deleteRow(toDelete[i]);
  
  Logger.log('=== reset_all_test_wishes_v2 ===');
  Logger.log('削除件数: ' + toDelete.length);
  Logger.log('対象ID: ' + testIds.join(','));
}

function debug_find_night_eligible_staff() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('M_スタッフ');
  const data = sheet.getDataRange().getValues();
  
  // 列番号(0-indexed)
  const COL_ID = 0;
  const COL_NAME = 1;
  const COL_MAIN = 9;        // J列
  const COL_SECOND = 10;     // K列
  const COL_SUB = 11;        // L列
  const COL_ALLOWED = 13;    // N列(許可シフト)
  const COL_RETIRED = 16;    // 退職フラグ(あれば)
  
  const eligible = [];
  
  for (let i = 1; i < data.length; i++) {
    const sid = String(data[i][COL_ID]).trim();
    if (!sid) continue;
    
    const main = String(data[i][COL_MAIN] || '').trim();
    const allowed = String(data[i][COL_ALLOWED] || '').trim();
    
    // 条件: メイン施設あり + 許可シフトに夜勤含む
    const hasMain = main !== '';
    const hasNight = allowed.indexOf('夜勤') !== -1;
    
    if (hasMain && hasNight) {
      eligible.push({
        sid: sid,
        name: data[i][COL_NAME],
        main: main,
        second: String(data[i][COL_SECOND] || '').trim(),
        sub: String(data[i][COL_SUB] || '').trim(),
        allowed: allowed
      });
    }
  }
  
  Logger.log('=== 夜勤対象スタッフ (メイン施設あり + 夜勤シフト許可あり) ===');
  Logger.log('該当: ' + eligible.length + '名');
  Logger.log('');
  
  eligible.forEach(function(s) {
    Logger.log('staff_id=' + s.sid + ' / ' + s.name);
    Logger.log('  メイン: ' + s.main);
    Logger.log('  セカンド: ' + s.second);
    Logger.log('  許可シフト: ' + s.allowed);
    Logger.log('');
  });
}

// ============================================================
// 夜勤エンジンテスト用希望投入 (4名で2026-06)
// 13: 夜勤B (許可: 夜勤B,早出8h,遅出8h)
// 18: 夜勤C (許可: 夜勤Cのみ)
// 59: 夜勤B (許可: 夜勤B,早出8h)
// 903: 夜勤C (許可: 全日勤+夜勤C)
// ============================================================
function inject_night_test_4staff_2026_06() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('T_希望提出');
  
  // M_スタッフから4名の施設情報を取得
  const staffSheet = ss.getSheetByName('M_スタッフ');
  const staffData = staffSheet.getDataRange().getValues();
  const staffInfo = {};
  for (let i = 1; i < staffData.length; i++) {
    const sid = String(staffData[i][0]).trim();
    if (['13', '18', '59', '903'].indexOf(sid) === -1) continue;
    staffInfo[sid] = {
      name: staffData[i][1],
      main: String(staffData[i][9] || '').trim(),
      second: String(staffData[i][10] || '').trim(),
      sub: String(staffData[i][11] || '').trim()
    };
  }
  
  // 各スタッフの投入計画
  const plans = [
    { sid: '13',  shift: '夜勤B', days: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
    { sid: '18',  shift: '夜勤C', days: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
    { sid: '59',  shift: '夜勤B', days: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
    { sid: '903', shift: '夜勤C', days: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }
  ];
  
  const targetYM = '2026-06';
  const now = new Date();
  const rows = [];
  let seq = 1;
  
  for (const plan of plans) {
    const info = staffInfo[plan.sid];
    if (!info) {
      Logger.log('スタッフ情報なし: ' + plan.sid);
      continue;
    }
    
    for (const d of plan.days) {
      const dateStr = targetYM + '-' + String(d).padStart(2, '0');
      rows.push([
        'NIGHT-TEST-' + plan.sid + '-' + targetYM + '-' + String(seq).padStart(3, '0'),
        now,
        plan.sid,
        info.name,
        targetYM,
        dateStr,
        plan.shift,
        info.main,
        info.second,
        info.sub,
        '夜勤エンジンテスト',
        '月次合計',
        plan.days.length
      ]);
      seq++;
    }
  }
  
  if (rows.length > 0) {
    const sr = sheet.getLastRow() + 1;
    sheet.getRange(sr, 1, rows.length, 13).setValues(rows);
    sheet.getRange(sr, 5, rows.length, 1).setNumberFormat('@');
  }
  
  Logger.log('=== inject_night_test_4staff_2026_06 ===');
  Logger.log('投入件数: ' + rows.length);
  plans.forEach(function(p) {
    Logger.log('  staff_id=' + p.sid + ' (' + (staffInfo[p.sid] ? staffInfo[p.sid].name : '?') + '): ' + p.shift + ' × ' + p.days.length + '日');
  });
}

function debug_check_night_placement_2026_06() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('T_シフト確定');
  const data = sheet.getDataRange().getValues();
  
  Logger.log('=== 2026-06 夜勤配置確認 ===');
  
  let count = 0;
  const byStaff = {};
  const byFacility = {};
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
    
    if (samples.length < 25) {
      samples.push(dateStr + ' ' + shift + ' / ' + sid + ' / ' + fac + ' / ' + unit);
    }
  }
  
  Logger.log('総夜勤配置: ' + count);
  Logger.log('');
  Logger.log('=== スタッフ別 ===');
  Object.keys(byStaff).forEach(function(k) { Logger.log('  staff_id=' + k + ': ' + byStaff[k] + '件'); });
  Logger.log('');
  Logger.log('=== 施設別 ===');
  Object.keys(byFacility).forEach(function(k) { Logger.log('  ' + k + ': ' + byFacility[k] + '件'); });
  Logger.log('');
  Logger.log('=== 配置詳細 (先頭25件) ===');
  samples.forEach(function(s) { Logger.log('  ' + s); });
}

function debug_check_18_59_master() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('M_スタッフ');
  const data = sheet.getDataRange().getValues();
  
  Logger.log('=== 18, 59 のマスタ確認 ===');
  
  for (let i = 1; i < data.length; i++) {
    const sid = String(data[i][0]).trim();
    if (sid !== '18' && sid !== '59') continue;
    
    Logger.log('staff_id=' + sid + ' / ' + data[i][1]);
    Logger.log('  J列(メイン): ' + data[i][9]);
    Logger.log('  K列(セカンド): ' + data[i][10]);
    Logger.log('  L列(サブ): ' + data[i][11]);
    Logger.log('');
  }
}

function debug_check_903_assignment_attempts() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('M_スタッフ');
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() !== '903') continue;
    Logger.log('=== 903 マスタ ===');
    Logger.log('  J(メイン): ' + data[i][9]);
    Logger.log('  K(セカンド): ' + data[i][10]);
    Logger.log('  L(サブ): ' + data[i][11]);
    Logger.log('  N(許可シフト): ' + data[i][13]);
    return;
  }
}

function debug_check_18_vip_flag() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('M_スタッフ');
  const data = sheet.getDataRange().getValues();
  
  // 列名を確認するため最初の行(ヘッダー)を取得
  Logger.log('=== ヘッダー行 ===');
  const headers = data[0];
  for (let i = 0; i < headers.length; i++) {
    Logger.log('  [' + i + '] ' + headers[i]);
  }
  
  Logger.log('');
  Logger.log('=== 18 (吉野光) 全列 ===');
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() !== '18') continue;
    for (let j = 0; j < headers.length; j++) {
      Logger.log('  [' + j + '] ' + headers[j] + ': ' + data[i][j]);
    }
    return;
  }
}

function reset_t_shift_kakutei_2026_06() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('T_シフト確定');
  const data = sheet.getDataRange().getValues();
  
  const toDelete = [];
  for (let i = 1; i < data.length; i++) {
    const date = data[i][1];
    if (!(date instanceof Date)) continue;
    const ym = Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy-MM');
    if (ym === '2026-06') {
      toDelete.push(i + 1);
    }
  }
  
  for (let i = toDelete.length - 1; i >= 0; i--) sheet.deleteRow(toDelete[i]);
  
  Logger.log('=== reset_t_shift_kakutei_2026_06 ===');
  Logger.log('削除件数: ' + toDelete.length);
}

function reset_t_shift_kakutei_2026_06_v2() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('T_シフト確定');
  const data = sheet.getDataRange().getValues();
  
  const toDelete = [];
  for (let i = 1; i < data.length; i++) {
    const date = data[i][1];
    if (!(date instanceof Date)) continue;
    const ym = Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy-MM');
    if (ym === '2026-06') {
      toDelete.push(i + 1);
    }
  }
  
  for (let i = toDelete.length - 1; i >= 0; i--) sheet.deleteRow(toDelete[i]);
  
  Logger.log('=== reset_t_shift_kakutei_2026_06_v2 ===');
  Logger.log('削除件数: ' + toDelete.length);
}

function reset_t_shift_kakutei_2026_06_v3() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('T_シフト確定');
  const data = sheet.getDataRange().getValues();
  
  const toDelete = [];
  for (let i = 1; i < data.length; i++) {
    const date = data[i][1];
    if (!(date instanceof Date)) continue;
    const ym = Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy-MM');
    if (ym === '2026-06') toDelete.push(i + 1);
  }
  
  for (let i = toDelete.length - 1; i >= 0; i--) sheet.deleteRow(toDelete[i]);
  Logger.log('削除件数: ' + toDelete.length);
}

function reset_t_shift_2026_06_v4() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('T_シフト確定');
  const data = sheet.getDataRange().getValues();
  const toDelete = [];
  for (let i = 1; i < data.length; i++) {
    const date = data[i][1];
    if (!(date instanceof Date)) continue;
    const ym = Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy-MM');
    if (ym === '2026-06') toDelete.push(i + 1);
  }
  for (let i = toDelete.length - 1; i >= 0; i--) sheet.deleteRow(toDelete[i]);
  Logger.log('削除: ' + toDelete.length);
}

function debug_count_active_staff() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('M_スタッフ');
  const data = sheet.getDataRange().getValues();
  
  let total = 0;
  let active = 0;
  let retired = 0;
  let withMain = 0;
  let withAllowedShifts = 0;
  
  for (let i = 1; i < data.length; i++) {
    const sid = String(data[i][0]).trim();
    if (!sid) continue;
    total++;
    
    const isRetired = data[i][16] === true || String(data[i][16]).toLowerCase() === 'true';
    if (isRetired) {
      retired++;
    } else {
      active++;
      if (String(data[i][9] || '').trim() !== '') withMain++;
      if (String(data[i][13] || '').trim() !== '') withAllowedShifts++;
    }
  }
  
  Logger.log('=== M_スタッフ 集計 ===');
  Logger.log('  総数: ' + total);
  Logger.log('  アクティブ: ' + active);
  Logger.log('  退職: ' + retired);
  Logger.log('  アクティブ&メイン施設あり: ' + withMain);
  Logger.log('  アクティブ&許可シフトあり: ' + withAllowedShifts);
}

// ============================================================
// T_シフト確定 19列目「割当役割」追加 (Day 10 Phase 1)
// ============================================================
function add_assignedRole_column_to_t_shift_kakutei() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('T_シフト確定');
  if (!sheet) {
    Logger.log('ERROR: T_シフト確定 シートが見つからない');
    return;
  }
  
  const lastCol = sheet.getLastColumn();
  Logger.log('=== add_assignedRole_column ===');
  Logger.log('現在の列数: ' + lastCol);
  
  if (lastCol >= 19) {
    const header19 = sheet.getRange(1, 19).getValue();
    if (header19 === '割当役割') {
      Logger.log('既に19列目「割当役割」が存在します。何もせずに終了。');
      return;
    } else {
      Logger.log('警告: 19列目に既に別のヘッダーがあります: ' + header19);
      Logger.log('処理を中断します。手動で確認してください。');
      return;
    }
  }
  
  sheet.getRange(1, 19).setValue('割当役割');
  Logger.log('OK: 19列目「割当役割」追加完了');
}

// ============================================================
// T_シフト確定 2026-06 全クリア (Day 10 Phase 1)
// ============================================================
function reset_t_shift_kakutei_2026_06_full() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('T_シフト確定');
  const data = sheet.getDataRange().getValues();
  
  const toDelete = [];
  for (let i = 1; i < data.length; i++) {
    const date = data[i][1];
    if (!(date instanceof Date)) continue;
    const ym = Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy-MM');
    if (ym === '2026-06') toDelete.push(i + 1);
  }
  
  for (let i = toDelete.length - 1; i >= 0; i--) sheet.deleteRow(toDelete[i]);
  Logger.log('=== reset_t_shift_kakutei_2026_06_full ===');
  Logger.log('削除件数: ' + toDelete.length);
}

// ============================================================
// 日勤テスト用希望投入 (Day10 Phase 3)
// 4名 × 5日 (2026-06-15〜19) で日勤希望を投入
// ============================================================
function inject_day_test_4staff_2026_06() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('T_希望提出');
  
  // M_スタッフから4名の施設情報を取得
  const staffSheet = ss.getSheetByName('M_スタッフ');
  const staffData = staffSheet.getDataRange().getValues();
  const staffInfo = {};
  for (let i = 1; i < staffData.length; i++) {
    const sid = String(staffData[i][0]).trim();
    if (['13', '18', '59', '903'].indexOf(sid) === -1) continue;
    staffInfo[sid] = {
      name: staffData[i][1],
      main: String(staffData[i][9] || '').trim(),
      second: String(staffData[i][10] || '').trim(),
      sub: String(staffData[i][11] || '').trim()
    };
  }
  
  // 各スタッフの日勤投入計画 (許可シフトとメイン施設に基づく最適化版)
  // staff_id=13:  許可=[夜勤B,早出8h,遅出8h]   メイン=ルーデンス新板橋Ⅱ → 早出8h
  // staff_id=18:  許可=[夜勤C]                 → 日勤テスト不可なので除外
  // staff_id=59:  許可=[夜勤B,早出8h]          メイン=リフレ要町 → 早出8h
  // staff_id=903: 許可=[早出8h,早出4h,遅出8h,遅出4h,夜勤C]  メイン=リフレ要町 → 遅出4h
  const plans = [
    { sid: '13',  shift: '早出8h', days: [15, 16, 17, 18, 19] },  // ルーデンス新板橋Ⅱ
    { sid: '59',  shift: '早出8h', days: [15, 16, 17, 18, 19] },  // リフレ要町
    { sid: '903', shift: '遅出4h', days: [15, 16, 17, 18, 19] }   // リフレ要町
  ];
  
  const targetYM = '2026-06';
  const now = new Date();
  const rows = [];
  let seq = 1;
  
  for (const plan of plans) {
    const info = staffInfo[plan.sid];
    if (!info) {
      Logger.log('スタッフ情報なし: ' + plan.sid);
      continue;
    }
    
    for (const d of plan.days) {
      const dateStr = targetYM + '-' + String(d).padStart(2, '0');
      rows.push([
        'DAY-TEST-' + plan.sid + '-' + targetYM + '-' + String(seq).padStart(3, '0'),
        now,
        plan.sid,
        info.name,
        targetYM,
        dateStr,
        plan.shift,
        info.main,
        info.second,
        info.sub,
        '日勤エンジンテスト',
        '月次合計',
        plan.days.length
      ]);
      seq++;
    }
  }
  
  if (rows.length > 0) {
    const sr = sheet.getLastRow() + 1;
    sheet.getRange(sr, 1, rows.length, 13).setValues(rows);
    sheet.getRange(sr, 5, rows.length, 1).setNumberFormat('@');
  }
  
  Logger.log('=== inject_day_test_4staff_2026_06 ===');
  Logger.log('投入件数: ' + rows.length);
  plans.forEach(function(p) {
    Logger.log('  staff_id=' + p.sid + ' (' + (staffInfo[p.sid] ? staffInfo[p.sid].name : '?') + '): ' + p.shift + ' × ' + p.days.length + '日');
  });
}

// ============================================================
// 日勤配置確認 (Day10 Phase 3)
// ============================================================
function debug_check_day_placement_2026_06() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('T_シフト確定');
  const data = sheet.getDataRange().getValues();
  
  const DAY_SHIFTS = ['早出8h', '早出4h', '遅出8h', '遅出4h'];
  
  Logger.log('=== 2026-06 日勤配置確認 ===');
  
  let totalCount = 0;
  const byStaff = {};
  const byJigyosho = {};
  const byRole = {};
  const records = [];
  
  for (let i = 1; i < data.length; i++) {
    const date = data[i][1];
    if (!(date instanceof Date)) continue;
    const ym = Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy-MM');
    if (ym !== '2026-06') continue;
    const shift = String(data[i][8] || '').trim();
    if (DAY_SHIFTS.indexOf(shift) === -1) continue;
    
    totalCount++;
    const sid = String(data[i][6]).trim();
    const name = data[i][7];
    const jig = data[i][3];
    const fac = data[i][4];
    const role = String(data[i][18] || '').trim();
    const dateStr = Utilities.formatDate(date, 'Asia/Tokyo', 'MM/dd');
    
    byStaff[sid] = (byStaff[sid] || 0) + 1;
    byJigyosho[jig] = (byJigyosho[jig] || 0) + 1;
    byRole[role || '(未設定)'] = (byRole[role || '(未設定)'] || 0) + 1;
    
    records.push({ date: dateStr, shift: shift, sid: sid, name: name, jig: jig, fac: fac, role: role });
  }
  
  Logger.log('総日勤配置: ' + totalCount);
  Logger.log('');
  Logger.log('=== スタッフ別 ===');
  Object.keys(byStaff).forEach(function(s) {
    Logger.log('  staff_id=' + s + ': ' + byStaff[s] + '件');
  });
  Logger.log('');
  Logger.log('=== 事業所別 ===');
  Object.keys(byJigyosho).forEach(function(j) {
    Logger.log('  ' + j + ': ' + byJigyosho[j] + '件');
  });
  Logger.log('');
  Logger.log('=== 割当役割別 ===');
  Object.keys(byRole).forEach(function(r) {
    Logger.log('  ' + r + ': ' + byRole[r] + '件');
  });
  Logger.log('');
  Logger.log('=== 配置詳細 ===');
  records.forEach(function(r) {
    Logger.log('  ' + r.date + ' ' + r.shift + ' / ' + r.sid + ' / ' + r.fac + ' / 役割=' + (r.role || '未設定'));
  });
}

// ============================================================
// 4スタッフのマスタ情報確認 (Day10 Phase 3 デバッグ)
// ============================================================
function debug_check_4staff_master() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('M_スタッフ');
  const data = sheet.getDataRange().getValues();
  
  Logger.log('=== 4スタッフのマスタ情報 ===');
  Logger.log('');
  
  for (let i = 1; i < data.length; i++) {
    const sid = String(data[i][0]).trim();
    if (['13', '18', '59', '903'].indexOf(sid) === -1) continue;
    
    Logger.log('--- staff_id=' + sid + ' ---');
    Logger.log('  氏名: ' + data[i][1]);
    Logger.log('  J列(メイン): ' + data[i][9]);
    Logger.log('  K列(セカンド): ' + data[i][10]);
    Logger.log('  L列(サブ): ' + data[i][11]);
    Logger.log('  N列(許可シフト): ' + data[i][13]);
    Logger.log('  T列(主職種): ' + data[i][19]);
    Logger.log('');
  }
}

// ============================================================
// findCandidatesV2 トレース (Day10 Phase 3 デバッグ)
// 6/15 早出4h GHコノヒカラ slot に対して、staff_id=59 が候補に上がるか確認
// ============================================================
function debug_trace_candidate_59() {
  if (typeof loadEngineContextV2 !== 'function') {
    Logger.log('loadEngineContextV2 が見つからない');
    return;
  }
  if (typeof generateSlotsV2 !== 'function') {
    Logger.log('generateSlotsV2 が見つからない');
    return;
  }
  
  const ctx = loadEngineContextV2('2026-06');
  generateSlotsV2(ctx);
  
  Logger.log('=== ctx確認 ===');
  Logger.log('スタッフ: ' + Object.keys(ctx.staffMap).length);
  Logger.log('希望: ' + ctx.wishes.length);
  Logger.log('');
  
  const targetSid = '59';
  const staff = ctx.staffMap[targetSid];
  if (!staff) {
    Logger.log('staff_id=59 が staffMap に無い');
    return;
  }
  
  Logger.log('=== staff_id=59 の情報 ===');
  Logger.log('氏名: ' + staff.name);
  Logger.log('mainFac: ' + staff.mainFac);
  Logger.log('secondFac: ' + staff.secondFac);
  Logger.log('subFacs: ' + JSON.stringify(staff.subFacs));
  Logger.log('allowedShifts: ' + JSON.stringify(staff.allowedShifts));
  Logger.log('isSewa: ' + staff.isSewa);
  Logger.log('isSeikatsu: ' + staff.isSeikatsu);
  Logger.log('');
  
  // 6/15 GHコノヒカラ 早出4h の希望があるか確認
  const dsKey = '2026-06-15_早出4h';
  const wishes = ctx.wishesByDayShift[dsKey] || [];
  Logger.log('=== 2026-06-15 早出4h の希望 ===');
  Logger.log('希望件数: ' + wishes.length);
  wishes.forEach(function(w) {
    Logger.log('  staff_id=' + w.staff_id + ' / mainFac=' + w.mainFac);
  });
  Logger.log('');
  
  // 6/15 GHコノヒカラ 早出4h slot 取得
  const slotKey = '2026-06-15_GHコノヒカラ_早出4h';
  const slot = ctx.slotsByKey[slotKey];
  if (!slot) {
    Logger.log('slot ' + slotKey + ' が無い');
    return;
  }
  
  Logger.log('=== slot 情報 ===');
  Logger.log('jigyosho: ' + slot.jigyosho);
  Logger.log('shift: ' + slot.shift);
  Logger.log('date: ' + slot.dateKey);
  Logger.log('');
  
  // findCandidatesV2 を実行
  if (typeof findCandidatesV2 === 'function') {
    const candidates = findCandidatesV2(ctx, slot);
    Logger.log('=== findCandidatesV2 結果 ===');
    Logger.log('候補数: ' + candidates.length);
    candidates.forEach(function(c) {
      Logger.log('  staff_id=' + c.staff.staff_id + ' / ' + c.staff.name);
    });
  }
}

function _peekUnitColumns() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const s = ss.getSheetByName('M_ユニット');
  const v = s.getDataRange().getValues();
  Logger.log('=== M_ユニット ヘッダー ===');
  Logger.log(JSON.stringify(v[0]));
  Logger.log('=== 最初の3行 ===');
  for (let i = 1; i <= 3 && i < v.length; i++) {
    Logger.log('行' + i + ': ' + JSON.stringify(v[i]));
  }
}
function _peekUnitColumns() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const s = ss.getSheetByName('M_ユニット');
  const v = s.getDataRange().getValues();
  Logger.log('=== M_ユニット ヘッダー ===');
  Logger.log(JSON.stringify(v[0]));
  Logger.log('=== 最初の3行 ===');
  for (let i = 1; i <= 3 && i < v.length; i++) {
    Logger.log('行' + i + ': ' + JSON.stringify(v[i]));
  }
}

function _peekUnitAndShift() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  
  const u = ss.getSheetByName('M_ユニット');
  const uv = u.getDataRange().getValues();
  Logger.log('=== M_ユニット ヘッダー ===');
  Logger.log(JSON.stringify(uv[0]));
  Logger.log('=== M_ユニット 最初の3行 ===');
  for (let i = 1; i <= 3 && i < uv.length; i++) {
    Logger.log(JSON.stringify(uv[i]));
  }
  
  const s = ss.getSheetByName('T_シフト確定');
  const sv = s.getDataRange().getValues();
  Logger.log('=== T_シフト確定 ヘッダー ===');
  Logger.log(JSON.stringify(sv[0]));
  Logger.log('=== 夜勤行サンプル ===');
  let nightCount = 0;
  for (let i = 1; i < sv.length && nightCount < 2; i++) {
    const t = String(sv[i][8]).trim();
    if (t === '夜勤A' || t === '夜勤B' || t === '夜勤C') {
      Logger.log(JSON.stringify(sv[i].slice(0, 12)));
      nightCount++;
    }
  }
}

// ============================================
// ★Day17: 困った時の連絡先 (マイページ用)
// ============================================
const JIGYOSHO_CONTACTS_DAY17 = {
  'GHコノヒカラ': '水野・千葉',
  'GHコノヒカラ品川': '季武',
  'GHコノヒカラ練馬': '水野',
  'GHコノヒカラ板橋北区': '大内',
  'GHコノヒカラ板橋北区セカンド': '伊藤'
};

function getMyContactInfo(staffId) {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  
  // スタッフの登録施設(メイン/セカンド/サブ)を取得
  const staffSheet = ss.getSheetByName('M_スタッフ');
  const sData = staffSheet.getDataRange().getValues();
  let mainFac = '', secondFac = '', subFacs = [];
  const targetSid = String(staffId);
  for (let i = 1; i < sData.length; i++) {
    if (String(sData[i][COL_STAFF.ID]) === targetSid) {
      mainFac = String(sData[i][COL_STAFF.MAIN_FAC] || '').trim();
      secondFac = String(sData[i][COL_STAFF.SECOND_FAC] || '').trim();
      const subStr = String(sData[i][COL_STAFF.SUB_FACS] || '').trim();
      subFacs = subStr ? subStr.split(',').map(s => s.trim()).filter(s => s) : [];
      break;
    }
  }
  
  const myFacilities = new Set();
  if (mainFac) myFacilities.add(mainFac);
  if (secondFac) myFacilities.add(secondFac);
  subFacs.forEach(f => myFacilities.add(f));
  
  // M_ユニットから 施設→事業所 マッピングを作って事業所を抽出
  const unitSheet = ss.getSheetByName('M_ユニット');
  const uData = unitSheet.getDataRange().getValues();
  const myJigyoshos = new Set();
  for (let i = 1; i < uData.length; i++) {
    const jig = String(uData[i][1] || '').trim();
    const fac = String(uData[i][3] || '').trim();
    if (!jig || !fac) continue;
    if (myFacilities.has(fac)) myJigyoshos.add(jig);
  }
  
  const contacts = [];
  Array.from(myJigyoshos).sort().forEach(jig => {
    contacts.push({
      jigyosho: jig,
      tantosha: JIGYOSHO_CONTACTS_DAY17[jig] || '管理者'
    });
  });
  
  return { success: true, contacts: contacts };
}

// ★Day17: 勤務先施設タブ用 - 施設→部屋番号リスト
function getMyWorkplaceFacilities(staffId) {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const unitSheet = ss.getSheetByName('M_ユニット');
  const uData = unitSheet.getDataRange().getValues();
  const facilityToRooms = {};
  for (let i = 1; i < uData.length; i++) {
    const fac = String(uData[i][3] || '').trim();
    const room = String(uData[i][5] || '').trim();
    if (!fac || !room) continue;
    if (!facilityToRooms[fac]) facilityToRooms[fac] = [];
    if (facilityToRooms[fac].indexOf(room) === -1) facilityToRooms[fac].push(room);
  }
  return { success: true, facilityToRooms: facilityToRooms };
}
