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

const SUBMIT_START_DAY = 10;
const SUBMIT_END_DAY = 22;

// シフト時間定義
const SHIFT_TIMES = {
   '夜勤A': '20:00-05:00',
  '夜勤B': '22:00-07:00',
  '夜勤C': '22:00-08:00',
  '早出8h': '06:00-15:00',
  '早出4h': '06:00-10:00',
  '遅出8h': '13:00-22:00',
  '遅出4h': '13:00-17:00'
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
  if (kubun === '日勤のみ') return ['日勤早出','日勤遅出'];
  return ['夜勤A','夜勤B','夜勤C','日勤早出','日勤遅出'];
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
      startDay: SUBMIT_START_DAY,
      endDay: SUBMIT_END_DAY,
      isOverride: true,
      overrideType: override.type,
    };
  }
  
  const isOpen = day >= SUBMIT_START_DAY && day <= SUBMIT_END_DAY;
  
  let openMsg = '';
  if (isOpen) {
    openMsg = targetYear + '年' + targetMonth + '月分の希望を提出できます(〜' + SUBMIT_END_DAY + '日まで)';
  } else if (day < SUBMIT_START_DAY) {
    openMsg = targetYear + '年' + targetMonth + '月分の提出期間: ' + SUBMIT_START_DAY + '日〜' + SUBMIT_END_DAY + '日';
  } else {
    openMsg = '提出期間外です。次回: 来月' + SUBMIT_START_DAY + '日から';
  }
  
  return {
    isOpen: isOpen,
    targetYM: targetYM,
    targetYear: targetYear,
    targetMonth: targetMonth,
    message: openMsg,
    startDay: SUBMIT_START_DAY,
    endDay: SUBMIT_END_DAY,
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
    const allowedShifts = rawAllowed
      ? rawAllowed.split(',').map(s => s.trim()).filter(Boolean)
      : getDefaultAllowedShifts(shiftKubun);

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
    return { success: false, message: '現在は提出期間外です(毎月' + SUBMIT_START_DAY + '日〜' + SUBMIT_END_DAY + '日)' };
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

    result.push({
      date: dateStr,
      facility: String(row[COL_SHIFT.FACILITY] || ''),
      shift: String(row[COL_SHIFT.SHIFT_TYPE] || ''),
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