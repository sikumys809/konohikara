// ============================================
// コノヒカラ スタッフアプリ - サーバー側処理 v2
// ============================================

// ---- M_スタッフ列定義（0始まり）----
const COL_STAFF = {
  ID:0, NAME:1, EMAIL:2, PHONE:3, EMPLOYMENT:4,
  QUALIFICATION:5, HIRE_DATE:6, KUBUN:7,
  MAIN_FAC:8,
  SUB_FACS:9,
  SHIFT_KUBUN:10,
  ALLOWED_SHIFTS:11,
  PROTECT:12,
  RETIRE:13,
  DEVICE:14,
  NOTE:15,
};

// ---- T_希望提出列定義（0始まり）----
const COL_REQ = {
  ID:0, TIME:1, STAFF_ID:2, NAME:3,
  YM:4, DATE:5, SHIFT:6,
  FAC1:7, FAC2:8, FAC3:9,
  COMMENT:10, FREQ_TYPE:11, FREQ_COUNT:12,
};

// ---- T_シフト確定列定義（0始まり）----
const COL_SHIFT = {
  ID:0, DATE:1, UNIT_ID:2, JIGYOSHO:3, FACILITY:4,
  UNIT:5, STAFF_ID:6, NAME:7, SHIFT_TYPE:8,
  START:9, END:10, COUNT:11, ALERT:12, STATUS:13, UPDATED:14,
};

// ============================================
// Web App エントリーポイント
// ============================================
function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('コノヒカラ シフト管理')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ============================================
// ユーティリティ
// ============================================
function normalizeYM(val) {
  if (val instanceof Date) return Utilities.formatDate(val, 'Asia/Tokyo', 'yyyy-MM');
  return String(val).trim();
}

function getDefaultAllowedShifts(kubun) {
  if (kubun === '夜勤のみ') return ['夜勤A','夜勤B','夜勤C'];
  if (kubun === '日勤のみ') return ['日勤早出','日勤遅出'];
  return ['夜勤A','夜勤B','夜勤C','日勤早出','日勤遅出'];
}

// ============================================
// スタッフ認証
// ============================================
function authenticateStaff(email) {
  const ss    = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('M_スタッフ');
  const data  = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const row     = data[i];
    const mail    = String(row[COL_STAFF.EMAIL]).trim().toLowerCase();
    const retired = String(row[COL_STAFF.RETIRE]).toUpperCase() === 'TRUE';
    if (!mail || mail !== email.trim().toLowerCase() || retired) continue;

    const shiftKubun = String(row[COL_STAFF.SHIFT_KUBUN] || '両方').trim() || '両方';
    const rawAllowed = String(row[COL_STAFF.ALLOWED_SHIFTS] || '').trim();
    const allowedShifts = rawAllowed
      ? rawAllowed.split(',').map(s => s.trim()).filter(Boolean)
      : getDefaultAllowedShifts(shiftKubun);

    const mainFac = String(row[COL_STAFF.MAIN_FAC] || '').trim();
    const rawSub  = String(row[COL_STAFF.SUB_FACS] || '').trim();
    const subFacs = rawSub
      ? rawSub.split(',').map(f => f.trim()).filter(Boolean)
      : [];

    const allFacs = [mainFac, ...subFacs.filter(f => f !== mainFac)].filter(Boolean);

    // デバッグログ
    Logger.log('allFacilities: ' + JSON.stringify(allFacs));
    Logger.log('mainFac: ' + mainFac);
    Logger.log('subFacs: ' + JSON.stringify(subFacs));
    Logger.log('shiftKubun: ' + shiftKubun);
    Logger.log('allowedShifts: ' + JSON.stringify(allowedShifts));

    return {
      success:        true,
      staff_id:       String(row[COL_STAFF.ID]).trim(),
      name:           row[COL_STAFF.NAME],
      kubun:          row[COL_STAFF.KUBUN],
      shiftKubun:     shiftKubun,
      allowedShifts:  allowedShifts,
      mainFacility:   mainFac,
      subFacilities:  subFacs,
      allFacilities:  allFacs,
    };
  }
  return { success: false, message: 'メールアドレスが見つかりません' };
}

// ============================================
// 施設一覧取得
// ============================================
function getFacilities() {
  const ss    = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('M_ユニット');
  const data  = sheet.getDataRange().getValues();
  const set   = new Set();
  for (let i = 1; i < data.length; i++) {
    if (data[i][3]) set.add(data[i][3]);
  }
  return [...set].sort();
}

// ============================================
// 提出データ取得
// ============================================
function getMyRequests(staffId, yearMonth) {
  const ss    = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('T_希望提出');
  const data  = sheet.getDataRange().getValues();
  const results = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (String(row[COL_REQ.STAFF_ID]).trim() !== String(staffId).trim()) continue;
    if (normalizeYM(row[COL_REQ.YM]) !== yearMonth) continue;
    results.push({
      id:        row[COL_REQ.ID],
      date:      row[COL_REQ.DATE] instanceof Date
                   ? Utilities.formatDate(row[COL_REQ.DATE], 'Asia/Tokyo', 'yyyy-MM-dd')
                   : String(row[COL_REQ.DATE]),
      shift:     String(row[COL_REQ.SHIFT]),
      facility1: String(row[COL_REQ.FAC1]      || ''),
      facility2: String(row[COL_REQ.FAC2]      || ''),
      facility3: String(row[COL_REQ.FAC3]      || ''),
      comment:   String(row[COL_REQ.COMMENT]   || ''),
      freqType:  String(row[COL_REQ.FREQ_TYPE] || ''),
      freqCount: row[COL_REQ.FREQ_COUNT]       || '',
    });
  }
  return results.sort((a, b) => new Date(a.date) - new Date(b.date));
}

// ============================================
// 希望提出（上書き）
// ============================================
function submitRequests(staffId, name, yearMonth, requests, freqType, freqCount) {
  const ss    = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('T_希望提出');
  const data  = sheet.getDataRange().getValues();

  const toDelete = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][COL_REQ.STAFF_ID]).trim() === String(staffId).trim() &&
        normalizeYM(data[i][COL_REQ.YM]) === yearMonth) {
      toDelete.push(i + 1);
    }
  }
  for (let i = toDelete.length - 1; i >= 0; i--) sheet.deleteRow(toDelete[i]);

  const now  = new Date();
  const rows = requests.map((req, idx) => [
    staffId + '_' + yearMonth + '_' + String(idx + 1).padStart(3, '0'),
    now, staffId, name, yearMonth,
    req.date, req.shift,
    req.facility1 || '', req.facility2 || '', req.facility3 || '',
    req.comment   || '', freqType || '', freqCount || '',
  ]);

  if (rows.length > 0) {
    const sr = sheet.getLastRow() + 1;
    sheet.getRange(sr, 1, rows.length, 13).setValues(rows);
    sheet.getRange(sr, 5, rows.length, 1).setNumberFormat('@');
  }
  return { success: true, count: rows.length };
}

// ============================================
// 確定シフト取得
// ============================================
function getMyShifts(staffId, yearMonth) {
  const ss    = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('T_シフト確定');
  const data  = sheet.getDataRange().getValues();
  const results = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (String(row[COL_SHIFT.STAFF_ID]).trim() !== String(staffId).trim()) continue;
    if (String(row[COL_SHIFT.STATUS]).toUpperCase() !== '確定') continue;
    const dateStr = row[COL_SHIFT.DATE] instanceof Date
      ? Utilities.formatDate(new Date(row[COL_SHIFT.DATE]), 'Asia/Tokyo', 'yyyy-MM-dd')
      : String(row[COL_SHIFT.DATE]);
    if (dateStr.substring(0, 7) !== yearMonth) continue;
    results.push({
      date:     dateStr,
      facility: row[COL_SHIFT.FACILITY],
      shift:    row[COL_SHIFT.SHIFT_TYPE],
    });
  }
  return results.sort((a, b) => new Date(a.date) - new Date(b.date));
}

// ============================================
// 出勤打刻
// ============================================
function clockIn(staffId, name, facility) {
  const ss    = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('T_打刻');
  const now   = new Date();
  const today = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd');
  const data  = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const row   = data[i];
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

// ============================================
// 退勤打刻
// ============================================
function clockOut(staffId) {
  const ss    = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('T_打刻');
  const now   = new Date();
  const today = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd');
  const data  = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const row   = data[i];
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

// ============================================
// 打刻状況取得
// ============================================
function getAttendanceStatus(staffId) {
  const ss    = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('T_打刻');
  const today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  const data  = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const row   = data[i];
    const rDate = row[1] instanceof Date
      ? Utilities.formatDate(new Date(row[1]), 'Asia/Tokyo', 'yyyy-MM-dd') : String(row[1]);
    if (rDate === today && String(row[2]).trim() === String(staffId).trim()) {
      return {
        clockedIn:  String(row[8]).toUpperCase() === 'TRUE',
        clockedOut: String(row[9]).toUpperCase() === 'TRUE',
      };
    }
  }
  return { clockedIn: false, clockedOut: false };
}

// ============================================
// デバッグ用
// ============================================
function debugStaffData() {
  const ss    = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('M_スタッフ');
  const data  = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[2]) continue;
    Logger.log('--- ' + row[1] + ' ---');
    Logger.log('メイン施設(I=8): [' + row[8] + ']');
    Logger.log('サブ施設候補(J=9): [' + row[9] + ']');
    Logger.log('シフト区分(K=10): [' + row[10] + ']');
    Logger.log('許可シフト種別(L=11): [' + row[11] + ']');
  }
}