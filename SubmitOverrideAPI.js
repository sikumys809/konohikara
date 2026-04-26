// ============================================
// 提出期間オーバーライド管理 API
// ============================================
const OVERRIDE_SHEET_NAME = 'T_提出期間オーバーライド';

const OVERRIDE_COL = {
  ID: 0,         // override_id
  STAFF_ID: 1,   // 0=全体, 数値=個人
  STAFF_NAME: 2,
  TARGET_YM: 3,  // YYYY-MM (空=全月)
  START: 4,      // YYYY-MM-DD
  END: 5,        // YYYY-MM-DD
  UNRESTRICTED: 6, // TRUE=期間制限なし
  CREATED_BY: 7,
  CREATED_BY_NAME: 8,
  CREATED_AT: 9,
  MEMO: 10,
};

// ============================================
// シート作成 (初回1回だけ実行)
// ============================================
// ============================================
// シート作成 (初回1回だけ実行)
// ============================================
function setupSubmitOverrideSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(OVERRIDE_SHEET_NAME);
  
  if (sheet) {
    Logger.log('⚠️ ' + OVERRIDE_SHEET_NAME + ' は既に存在します。再作成は不要です。');
    return;
  }
  
  sheet = ss.insertSheet(OVERRIDE_SHEET_NAME);
  
  const headers = [
    'override_id', 'staff_id', 'staff_name', 'target_ym',
    'start_date', 'end_date', 'unrestricted',
    'created_by', 'created_by_name', 'created_at', 'memo',
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#e0f2fe');
  sheet.setFrozenRows(1);
  
  sheet.setColumnWidth(1, 130);
  sheet.setColumnWidth(2, 80);
  sheet.setColumnWidth(3, 120);
  sheet.setColumnWidth(4, 100);
  sheet.setColumnWidth(5, 110);
  sheet.setColumnWidth(6, 110);
  sheet.setColumnWidth(7, 80);
  sheet.setColumnWidth(8, 80);
  sheet.setColumnWidth(9, 120);
  sheet.setColumnWidth(10, 150);
  sheet.setColumnWidth(11, 200);
  
  Logger.log('✅ ' + OVERRIDE_SHEET_NAME + ' シート作成完了');
}
// ============================================
// 一覧取得
// ============================================
function getSubmitOverrides(adminStaffId) {
  const admin = checkAdminAuth(adminStaffId, 'マスタ編集');
  if (!admin.authorized) {
    return { success: false, message: admin.message };
  }
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(OVERRIDE_SHEET_NAME);
  if (!sheet) {
    return { success: false, message: 'シートが未作成です。setupSubmitOverrideSheet() を先に実行してください。' };
  }
  
  const data = sheet.getDataRange().getValues();
  const today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  const list = [];
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[OVERRIDE_COL.ID]) continue;
    
    const startDate = row[OVERRIDE_COL.START];
    const endDate = row[OVERRIDE_COL.END];
    const startStr = startDate instanceof Date 
      ? Utilities.formatDate(startDate, 'Asia/Tokyo', 'yyyy-MM-dd')
      : (startDate ? String(startDate) : '');
    const endStr = endDate instanceof Date 
      ? Utilities.formatDate(endDate, 'Asia/Tokyo', 'yyyy-MM-dd')
      : (endDate ? String(endDate) : '');
    
    const unrestricted = row[OVERRIDE_COL.UNRESTRICTED] === true 
      || row[OVERRIDE_COL.UNRESTRICTED] === 'TRUE' 
      || row[OVERRIDE_COL.UNRESTRICTED] === 'true';
    
    let status = '有効';
    if (!unrestricted) {
      if (startStr && today < startStr) status = '未開始';
      else if (endStr && today > endStr) status = '期限切れ';
    }
    
    const createdAt = row[OVERRIDE_COL.CREATED_AT];
    const createdAtStr = createdAt instanceof Date
      ? Utilities.formatDate(createdAt, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm')
      : String(createdAt || '');
    
    list.push({
      override_id: String(row[OVERRIDE_COL.ID]),
      staff_id: String(row[OVERRIDE_COL.STAFF_ID]),
      staff_name: String(row[OVERRIDE_COL.STAFF_NAME] || ''),
      target_ym: String(row[OVERRIDE_COL.TARGET_YM] || ''),
      start_date: startStr,
      end_date: endStr,
      unrestricted: unrestricted,
      created_by: String(row[OVERRIDE_COL.CREATED_BY] || ''),
      created_by_name: String(row[OVERRIDE_COL.CREATED_BY_NAME] || ''),
      created_at: createdAtStr,
      memo: String(row[OVERRIDE_COL.MEMO] || ''),
      status: status,
      is_global: Number(row[OVERRIDE_COL.STAFF_ID]) === 0,
    });
  }
  
  list.sort((a, b) => b.created_at.localeCompare(a.created_at));
  
  return { success: true, overrides: list };
}

// ============================================
// 追加
// ============================================
function addSubmitOverride(adminStaffId, params) {
  const admin = checkAdminAuth(adminStaffId, 'マスタ編集');
  if (!admin.authorized) {
    return { success: false, message: admin.message };
  }
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(OVERRIDE_SHEET_NAME);
  if (!sheet) {
    return { success: false, message: 'シートが未作成です' };
  }
  
  // バリデーション
  const staffId = (params.staff_id !== undefined && params.staff_id !== null) ? Number(params.staff_id) : null;
  if (staffId === null || isNaN(staffId)) {
    return { success: false, message: 'staff_id が不正です (0=全体, または個人ID)' };
  }
  
  let staffName = '';
  if (staffId === 0) {
    staffName = '【全体】';
  } else {
    // スタッフ存在確認
    const staffSheet = ss.getSheetByName('M_スタッフ');
    const staffData = staffSheet.getDataRange().getValues();
    let found = false;
    for (let i = 1; i < staffData.length; i++) {
      if (Number(staffData[i][0]) === staffId) {
        staffName = String(staffData[i][1] || '').replace(/[（(][^）)]*[）)]/g, '').trim();
        found = true;
        break;
      }
    }
    if (!found) {
      return { success: false, message: 'staff_id ' + staffId + ' のスタッフが見つかりません' };
    }
  }
  
  const unrestricted = params.unrestricted === true || params.unrestricted === 'true';
  
  if (!unrestricted) {
    if (!params.start_date && !params.end_date) {
      return { success: false, message: '開始日または終了日を指定するか、「期間制限なし」をONにしてください' };
    }
  }
  
  // ID生成 (タイムスタンプ)
  const now = new Date();
  const overrideId = 'OV_' + Utilities.formatDate(now, 'Asia/Tokyo', 'yyyyMMdd_HHmmss');
  
  const row = [
    overrideId,
    staffId,
    staffName,
    String(params.target_ym || '').trim(),
    params.start_date || '',
    params.end_date || '',
    unrestricted,
    Number(adminStaffId),
    admin.name,
    now,
    String(params.memo || '').trim(),
  ];
  
  sheet.appendRow(row);
  // target_ym 列を強制的に文字列フォーマットに固定
  const lastRow = sheet.getLastRow();
  sheet.getRange(lastRow, 4).setNumberFormat('@');

  // 操作ログ
  try {
    logAdminOperation(adminStaffId, admin.name, '提出期間オーバーライド追加', 'オーバーライド', overrideId, '', JSON.stringify(row), '対象: ' + staffName);
  } catch (e) {
    Logger.log('ログ記録エラー: ' + e.message);
  }
  
  return { 
    success: true, 
    message: '✅ 追加しました: ' + staffName + (params.target_ym ? ' (' + params.target_ym + '分)' : ''),
    override_id: overrideId 
  };
}

// ============================================
// 削除
// ============================================
function deleteSubmitOverride(adminStaffId, overrideId) {
  const admin = checkAdminAuth(adminStaffId, 'マスタ編集');
  if (!admin.authorized) {
    return { success: false, message: admin.message };
  }
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(OVERRIDE_SHEET_NAME);
  if (!sheet) {
    return { success: false, message: 'シートが未作成です' };
  }
  
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][OVERRIDE_COL.ID]) === String(overrideId)) {
      const targetName = String(data[i][OVERRIDE_COL.STAFF_NAME] || '');
      sheet.deleteRow(i + 1);
      
      try {
        logAdminOperation(adminStaffId, admin.name, '提出期間オーバーライド削除', 'オーバーライド', overrideId, JSON.stringify(data[i]), '', '対象: ' + targetName);
      } catch (e) {
        Logger.log('ログ記録エラー: ' + e.message);
      }
      
      return { success: true, message: '🗑 削除しました: ' + targetName };
    }
  }
  
  return { success: false, message: 'override_id ' + overrideId + ' が見つかりません' };
}

// ============================================
// スタッフ簡易リスト取得 (UI用、検索/絞り込み対応)
// ============================================
function getStaffListForOverride(adminStaffId) {
  const admin = checkAdminAuth(adminStaffId, 'マスタ編集');
  if (!admin.authorized) {
    return { success: false, message: admin.message };
  }
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('M_スタッフ');
  const data = sheet.getDataRange().getValues();
  const list = [];
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const retired = String(row[16]).toUpperCase() === 'TRUE';
    if (retired) continue;
    
    const name = String(row[1] || '').replace(/[（(][^）)]*[）)]/g, '').trim();
    if (!name) continue;
    
    list.push({
      staff_id: Number(row[0]),
      name: name,
      mainFacility: String(row[9] || ''),
      hireDate: row[6] ? Utilities.formatDate(new Date(row[6]), 'Asia/Tokyo', 'yyyy-MM-dd') : '',
    });
  }
  
  list.sort((a, b) => a.staff_id - b.staff_id);
  return { success: true, staff: list };
}
