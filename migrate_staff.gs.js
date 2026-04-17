// ============================================
// コノヒカラ スタッフアプリ - サーバー側処理
// ============================================

// ============================================
// Web App エントリーポイント
// ============================================
function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('Index.html')
    .setTitle('コノヒカラ シフト管理')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ============================================
// 共通ユーティリティ：yearMonth正規化（Date型・文字列両対応）
// ============================================
function normalizeYM(val) {
  if (val instanceof Date) {
    return Utilities.formatDate(val, 'Asia/Tokyo', 'yyyy-MM');
  }
  return String(val).trim();
}

// ============================================
// スタッフ認証（メールアドレスで本人確認）
// ============================================
function authenticateStaff(email) {
  const ss    = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('M_スタッフ');
  const data  = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const row        = data[i];
    const staffEmail = String(row[2]).trim().toLowerCase();
    const isRetired  = String(row[11]).toUpperCase() === 'TRUE';

    if (staffEmail === email.trim().toLowerCase() && !isRetired) {
      return {
        success:      true,
        staff_id:     String(row[0]).trim(),
        name:         row[1],
        kubun:        row[7],
        mainFacility: row[8] || '',
      };
    }
  }
  return { success: false, message: 'メールアドレスが見つかりません' };
}

// ============================================
// 施設一覧を取得（希望施設の選択肢）
// ============================================
function getFacilities() {
  const ss    = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('M_ユニット');
  const data  = sheet.getDataRange().getValues();

  const facilities = new Set();
  for (let i = 1; i < data.length; i++) {
    if (data[i][3]) facilities.add(data[i][3]);
  }
  return [...facilities].sort();
}

// ============================================
// 既存の提出データを取得（当月分）
// ============================================
function getMyRequests(staffId, yearMonth) {
  const ss    = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('T_希望提出');
  const data  = sheet.getDataRange().getValues();

  const results = [];
  for (let i = 1; i < data.length; i++) {
    const row   = data[i];
    const rowId = String(row[2]).trim();
    const rowYM = normalizeYM(row[4]);

    if (rowId === String(staffId).trim() && rowYM === yearMonth) {
      results.push({
        id:       row[0],
        date:     row[5] instanceof Date
                    ? Utilities.formatDate(row[5], 'Asia/Tokyo', 'yyyy-MM-dd')
                    : String(row[5]),
        shift:    row[6],
        facility: row[7],
        comment:  row[8],
      });
    }
  }
  return results.sort((a, b) => new Date(a.date) - new Date(b.date));
}

// ============================================
// 希望提出（追加・上書き）
// ============================================
function submitRequests(staffId, name, yearMonth, requests) {
  const ss    = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('T_希望提出');
  const data  = sheet.getDataRange().getValues();

  const rowsToDelete = [];
  for (let i = 1; i < data.length; i++) {
    const rowId = String(data[i][2]).trim();
    const rowYM = normalizeYM(data[i][4]);
    if (rowId === String(staffId).trim() && rowYM === yearMonth) {
      rowsToDelete.push(i + 1);
    }
  }
  for (let i = rowsToDelete.length - 1; i >= 0; i--) {
    sheet.deleteRow(rowsToDelete[i]);
  }

  const now     = new Date();
  const newRows = requests.map((req, idx) => {
    const id = staffId + '_' + yearMonth + '_' + String(idx + 1).padStart(3, '0');
    return [
      id,
      now,
      staffId,
      name,
      yearMonth,
      req.date,
      req.shift,
      req.facility,
      req.comment || '',
    ];
  });

  if (newRows.length > 0) {
    const startRow = sheet.getLastRow() + 1;
    const range    = sheet.getRange(startRow, 1, newRows.length, 9);
    range.setValues(newRows);
    sheet.getRange(startRow, 5, newRows.length, 1).setNumberFormat('@');
  }

  return { success: true, count: newRows.length };
}

// ============================================
// 確定シフトを取得（スタッフ向け・時刻なし）
// ============================================
function getMyShifts(staffId, yearMonth) {
  const ss    = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('T_シフト確定');
  const data  = sheet.getDataRange().getValues();

  const results = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (String(row[6]).trim() !== String(staffId).trim()) continue;
    if (String(row[14]).toUpperCase() !== '確定') continue;

    const dateStr = row[1] instanceof Date
      ? Utilities.formatDate(new Date(row[1]), 'Asia/Tokyo', 'yyyy-MM-dd')
      : String(row[1]);
    const rowYM = dateStr.substring(0, 7);
    if (rowYM !== yearMonth) continue;

    results.push({
      date:     dateStr,
      facility: row[4],
      shift:    row[8],
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

  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const row      = data[i];
    const rowDate  = row[1] instanceof Date
      ? Utilities.formatDate(new Date(row[1]), 'Asia/Tokyo', 'yyyy-MM-dd')
      : String(row[1]);
    const rowStaff = String(row[2]).trim();
    const inFlag   = String(row[8]).toUpperCase();
    if (rowDate === today && rowStaff === String(staffId).trim() && inFlag === 'TRUE') {
      return { success: false, message: '本日はすでに出勤済みです' };
    }
  }

  const clockId = staffId + '_' + today + '_in';
  sheet.appendRow([
    clockId,
    today,
    staffId,
    name,
    facility,
    now,
    '',
    '',
    'TRUE',
    'FALSE',
    '',
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

  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const row      = data[i];
    const rowDate  = row[1] instanceof Date
      ? Utilities.formatDate(new Date(row[1]), 'Asia/Tokyo', 'yyyy-MM-dd')
      : String(row[1]);
    const rowStaff = String(row[2]).trim();
    const inFlag   = String(row[8]).toUpperCase();
    const outFlag  = String(row[9]).toUpperCase();

    if (rowDate === today && rowStaff === String(staffId).trim() && inFlag === 'TRUE' && outFlag !== 'TRUE') {
      const inTime  = new Date(row[5]);
      const minutes = Math.round((now - inTime) / 60000);

      sheet.getRange(i + 1, 7).setValue(now);
      sheet.getRange(i + 1, 8).setValue(minutes);
      sheet.getRange(i + 1, 10).setValue('TRUE');

      return { success: true, message: '退勤を記録しました' };
    }
  }
  return { success: false, message: '出勤記録が見つかりません。先に出勤打刻してください' };
}

// ============================================
// 打刻状況を取得（スタッフ向け・フラグのみ）
// ============================================
function getAttendanceStatus(staffId) {
  const ss    = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('T_打刻');
  const now   = new Date();
  const today = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd');

  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const row      = data[i];
    const rowDate  = row[1] instanceof Date
      ? Utilities.formatDate(new Date(row[1]), 'Asia/Tokyo', 'yyyy-MM-dd')
      : String(row[1]);
    const rowStaff = String(row[2]).trim();
    if (rowDate === today && rowStaff === String(staffId).trim()) {
      return {
        clockedIn:  String(row[8]).toUpperCase() === 'TRUE',
        clockedOut: String(row[9]).toUpperCase() === 'TRUE',
      };
    }
  }
  return { clockedIn: false, clockedOut: false };
}