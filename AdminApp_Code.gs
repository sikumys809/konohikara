// ============================================
// 管理画面サーバー処理 v1 (2026-04-19)
// ============================================

// ============================================
// 認証とダッシュボード
// ============================================

function authenticateAdmin(email) {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('M_スタッフ');
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const mail = String(row[COL_STAFF.EMAIL]).trim().toLowerCase();
    const retired = String(row[COL_STAFF.RETIRE]).toUpperCase() === 'TRUE';
    const role = String(row[18] || '').trim();
    
    if (!mail || mail !== email.trim().toLowerCase() || retired) continue;
    if (!role) continue;
    
    const roles = role.split(',').map(r => r.trim()).filter(Boolean);
    
    writeAdminLog(
      String(row[COL_STAFF.ID]).trim(),
      row[COL_STAFF.NAME],
      role,
      'ログイン',
      '管理画面',
      '', '', '', ''
    );
    
    return {
      success: true,
      staff_id: String(row[COL_STAFF.ID]).trim(),
      name: row[COL_STAFF.NAME],
      email: mail,
      roles: roles,
      roleString: role,
      canEditMaster: roles.includes('マスタ編集'),
      canCreateShift: roles.includes('シフト作成'),
      canApprove: roles.includes('最終承認者'),
    };
  }
  return { success: false, message: '管理者権限がありません、または登録されていません' };
}


function writeAdminLog(staffId, name, role, operation, target, targetId, before, after, memo) {
  try {
    const ss = SpreadsheetApp.openById(STAFF_SS_ID);
    const sheet = ss.getSheetByName('T_操作ログ');
    if (!sheet) return;
    
    const now = new Date();
    const logId = 'LOG_' + now.getTime() + '_' + Math.random().toString(36).substr(2, 5);
    
    sheet.appendRow([
      logId, now, staffId, name, role,
      operation, target, targetId, before, after, memo || ''
    ]);
  } catch (e) {
    Logger.log('ログ書き込みエラー: ' + e.toString());
  }
}


function getDashboardStats() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  
  const staffSheet = ss.getSheetByName('M_スタッフ');
  const staffData = staffSheet.getDataRange().getValues();
  let activeStaffCount = 0;
  let adminStaffCount = 0;
  for (let i = 1; i < staffData.length; i++) {
    const retired = String(staffData[i][COL_STAFF.RETIRE]).toUpperCase() === 'TRUE';
    if (!retired && staffData[i][COL_STAFF.ID]) {
      activeStaffCount++;
      if (String(staffData[i][18] || '').trim()) {
        adminStaffCount++;
      }
    }
  }
  
  const facSheet = ss.getSheetByName('M_施設');
  const facCount = facSheet ? Math.max(0, facSheet.getLastRow() - 1) : 0;
  
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const targetYM = nextMonth.getFullYear() + '-' + String(nextMonth.getMonth() + 1).padStart(2, '0');
  
  const reqSheet = ss.getSheetByName('T_希望提出');
  const reqData = reqSheet.getDataRange().getValues();
  const submittedIds = new Set();
  for (let i = 1; i < reqData.length; i++) {
    const ym = normalizeYM(reqData[i][COL_REQ.YM]);
    if (ym === targetYM) {
      submittedIds.add(String(reqData[i][COL_REQ.STAFF_ID]).trim());
    }
  }
  
  const logSheet = ss.getSheetByName('T_操作ログ');
  const logData = logSheet.getDataRange().getValues();
  const recentLogs = [];
  for (let i = logData.length - 1; i >= 1 && recentLogs.length < 10; i--) {
    const row = logData[i];
    recentLogs.push({
      time: row[1] instanceof Date ? Utilities.formatDate(row[1], 'Asia/Tokyo', 'MM/dd HH:mm') : String(row[1]),
      name: row[3],
      operation: row[5],
      target: row[6]
    });
  }
  
  return {
    success: true,
    activeStaffCount: activeStaffCount,
    adminStaffCount: adminStaffCount,
    facilityCount: facCount,
    targetYM: targetYM,
    submittedCount: submittedIds.size,
    recentLogs: recentLogs
  };
}


// ============================================
// 管理者権限チェック(共通関数)
// ============================================
function checkAdminAuth(staffId, requiredRole) {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('M_スタッフ');
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) !== String(staffId)) continue;
    
    const retired = String(data[i][16]).toUpperCase() === 'TRUE';
    if (retired) {
      return { authorized: false, message: '退職済みです' };
    }
    
    const role = String(data[i][18] || '').trim();
    if (!role) {
      return { authorized: false, message: '管理者権限がありません' };
    }
    
    const roles = role.split(',').map(r => r.trim());
    if (requiredRole && !roles.includes(requiredRole)) {
      return { authorized: false, message: 'この操作には「' + requiredRole + '」権限が必要です' };
    }
    
    return {
      authorized: true,
      staff_id: data[i][0],
      name: data[i][1],
      role: role,
      roles: roles
    };
  }
  return { authorized: false, message: 'スタッフが見つかりません' };
}


// ============================================
// スタッフマスタ管理機能
// ============================================

function getAllStaffList(adminStaffId) {
  const admin = checkAdminAuth(adminStaffId, 'マスタ編集');
  if (!admin.authorized) {
    return { success: false, message: admin.message };
  }
  
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('M_スタッフ');
  const data = sheet.getDataRange().getValues();
  
  const staffList = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;
    
    const hireDate = row[6];
    const hireDateStr = hireDate instanceof Date 
      ? Utilities.formatDate(hireDate, 'Asia/Tokyo', 'yyyy-MM-dd') 
      : (hireDate ? String(hireDate) : '');
    
    staffList.push({
      staff_id: row[0],
      name: row[1],
      email: row[2] || '',
      phone: row[3] || '',
      employment: row[4] || '',
      qualification: row[5] || '',
      hireDate: hireDateStr,
      hireMonths: row[7] || '',
      kubun: row[8] || '',
      mainFacility: row[9] || '',
      secondFacility: row[10] || '',
      subFacilities: row[11] || '',
      shiftKubun: row[12] || '',
      allowedShifts: row[13] || '',
      isProtected: String(row[14]).toUpperCase() === 'TRUE',
      isVIP: String(row[15]).toUpperCase() === 'TRUE',
      isRetired: String(row[16]).toUpperCase() === 'TRUE',
      note: row[17] || '',
      role: row[18] || '',
    });
  }
  
  return { success: true, staff: staffList };
}


function getStaffDetail(adminStaffId, targetStaffId) {
  const admin = checkAdminAuth(adminStaffId, 'マスタ編集');
  if (!admin.authorized) {
    return { success: false, message: admin.message };
  }
  
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('M_スタッフ');
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) !== String(targetStaffId)) continue;
    const row = data[i];
    
    const hireDate = row[6];
    const hireDateStr = hireDate instanceof Date 
      ? Utilities.formatDate(hireDate, 'Asia/Tokyo', 'yyyy-MM-dd') 
      : (hireDate ? String(hireDate) : '');
    
    return {
      success: true,
      staff: {
        staff_id: row[0],
        name: row[1],
        email: row[2] || '',
        phone: row[3] || '',
        employment: row[4] || '',
        qualification: row[5] || '',
        hireDate: hireDateStr,
        hireMonths: row[7] || '',
        kubun: row[8] || '',
        mainFacility: row[9] || '',
        secondFacility: row[10] || '',
        subFacilities: row[11] || '',
        shiftKubun: row[12] || '',
        allowedShifts: row[13] || '',
        isProtected: String(row[14]).toUpperCase() === 'TRUE',
        isVIP: String(row[15]).toUpperCase() === 'TRUE',
        isRetired: String(row[16]).toUpperCase() === 'TRUE',
        note: row[17] || '',
        role: row[18] || '',
      },
      rowIndex: i + 1
    };
  }
  return { success: false, message: 'スタッフが見つかりません' };
}


function updateStaff(adminStaffId, targetStaffId, updates) {
  const admin = checkAdminAuth(adminStaffId, 'マスタ編集');
  if (!admin.authorized) {
    return { success: false, message: admin.message };
  }
  
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('M_スタッフ');
  const data = sheet.getDataRange().getValues();
  
  // メール重複チェック
  if (updates.email) {
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) !== String(targetStaffId) 
          && String(data[i][2]).trim().toLowerCase() === updates.email.trim().toLowerCase()) {
        return { success: false, message: 'このメールアドレスは他のスタッフが使用中です: ID=' + data[i][0] };
      }
    }
  }
  
  let targetRowIndex = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(targetStaffId)) {
      targetRowIndex = i;
      break;
    }
  }
  if (targetRowIndex < 0) {
    return { success: false, message: 'スタッフが見つかりません' };
  }
  
  const oldRow = data[targetRowIndex];
  const changes = [];
  
  const track = (colIdx, label, newVal, oldVal) => {
    const oldStr = String(oldVal || '').trim();
    const newStr = String(newVal || '').trim();
    if (oldStr !== newStr) {
      changes.push({ col: colIdx, label: label, before: oldStr, after: newStr });
    }
  };
  
  track(1, '氏名', updates.name, oldRow[1]);
  track(2, 'メール', updates.email, oldRow[2]);
  track(3, '電話', updates.phone, oldRow[3]);
  track(4, '雇用形態', updates.employment, oldRow[4]);
  track(5, '国家資格', updates.qualification, oldRow[5]);
  
  const oldHire = oldRow[6] instanceof Date 
    ? Utilities.formatDate(oldRow[6], 'Asia/Tokyo', 'yyyy-MM-dd') : String(oldRow[6] || '');
  if (oldHire !== (updates.hireDate || '')) {
    changes.push({ col: 6, label: '入社日', before: oldHire, after: updates.hireDate });
  }
  
  track(8, 'スタッフ区分', updates.kubun, oldRow[8]);
  track(9, 'メイン施設', updates.mainFacility, oldRow[9]);
  track(10, 'セカンド施設', updates.secondFacility, oldRow[10]);
  track(11, 'サブ施設', updates.subFacilities, oldRow[11]);
  track(12, 'シフト区分', updates.shiftKubun, oldRow[12]);
  track(13, '許可シフト', updates.allowedShifts, oldRow[13]);
  
  const oldProtect = String(oldRow[14]).toUpperCase() === 'TRUE';
  const newProtect = updates.isProtected === true;
  if (oldProtect !== newProtect) changes.push({ col: 14, label: '保護フラグ', before: oldProtect, after: newProtect });
  
  const oldVIP = String(oldRow[15]).toUpperCase() === 'TRUE';
  const newVIP = updates.isVIP === true;
  if (oldVIP !== newVIP) changes.push({ col: 15, label: 'VIP', before: oldVIP, after: newVIP });
  
  const oldRetire = String(oldRow[16]).toUpperCase() === 'TRUE';
  const newRetire = updates.isRetired === true;
  if (oldRetire !== newRetire) changes.push({ col: 16, label: '退職フラグ', before: oldRetire, after: newRetire });
  
  track(17, '備考', updates.note, oldRow[17]);
  track(18, '役割', updates.role, oldRow[18]);
  
  if (changes.length === 0) {
    return { success: true, message: '変更はありませんでした', changedCount: 0 };
  }
  
  const sheetRow = targetRowIndex + 1;
  if (updates.name !== undefined) sheet.getRange(sheetRow, 2).setValue(updates.name);
  if (updates.email !== undefined) sheet.getRange(sheetRow, 3).setValue(updates.email);
  if (updates.phone !== undefined) sheet.getRange(sheetRow, 4).setValue(updates.phone);
  if (updates.employment !== undefined) sheet.getRange(sheetRow, 5).setValue(updates.employment);
  if (updates.qualification !== undefined) sheet.getRange(sheetRow, 6).setValue(updates.qualification);
  
  if (updates.hireDate) {
    const newHireDate = new Date(updates.hireDate);
    sheet.getRange(sheetRow, 7).setValue(newHireDate).setNumberFormat('yyyy-MM-dd');
    const now = new Date();
    const months = (now.getFullYear() - newHireDate.getFullYear()) * 12 
                 + (now.getMonth() - newHireDate.getMonth());
    sheet.getRange(sheetRow, 8).setValue(months >= 0 ? months : '');
  }
  
  if (updates.kubun !== undefined) sheet.getRange(sheetRow, 9).setValue(updates.kubun);
  if (updates.mainFacility !== undefined) sheet.getRange(sheetRow, 10).setValue(updates.mainFacility);
  if (updates.secondFacility !== undefined) sheet.getRange(sheetRow, 11).setValue(updates.secondFacility);
  if (updates.subFacilities !== undefined) sheet.getRange(sheetRow, 12).setValue(updates.subFacilities);
  if (updates.shiftKubun !== undefined) sheet.getRange(sheetRow, 13).setValue(updates.shiftKubun);
  if (updates.allowedShifts !== undefined) sheet.getRange(sheetRow, 14).setValue(updates.allowedShifts);
  sheet.getRange(sheetRow, 15).setValue(updates.isProtected ? 'TRUE' : 'FALSE');
  sheet.getRange(sheetRow, 16).setValue(updates.isVIP ? 'TRUE' : 'FALSE');
  sheet.getRange(sheetRow, 17).setValue(updates.isRetired ? 'TRUE' : 'FALSE');
  if (updates.note !== undefined) sheet.getRange(sheetRow, 18).setValue(updates.note);
  if (updates.role !== undefined) sheet.getRange(sheetRow, 19).setValue(updates.role);
  
  SpreadsheetApp.flush();
  
  const changesSummary = changes.map(c => c.label + ': [' + c.before + '] -> [' + c.after + ']').join(' | ');
  writeAdminLog(
    admin.staff_id, admin.name, admin.role,
    'スタッフ更新', 'M_スタッフ', String(targetStaffId),
    '', changesSummary,
    oldRow[1] + 'さんの情報を' + changes.length + '項目変更'
  );
  
  return { 
    success: true, 
    message: changes.length + '項目更新しました',
    changedCount: changes.length,
    changes: changes
  };
}


function getFacilityListForAdmin(adminStaffId) {
  const admin = checkAdminAuth(adminStaffId, null);
  if (!admin.authorized) {
    return { success: false, message: admin.message };
  }
  
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('M_施設');
  const data = sheet.getDataRange().getValues();
  
  const facilities = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) facilities.push(data[i][0]);
  }
  return { success: true, facilities: facilities };
}


// ============================================
// 施設マスタ管理機能
// ============================================

function getAllFacilities(adminStaffId) {
  const admin = checkAdminAuth(adminStaffId, null);
  if (!admin.authorized) {
    return { success: false, message: admin.message };
  }
  
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('M_施設');
  if (!sheet) {
    return { success: false, message: 'M_施設シートが見つかりません' };
  }
  
  const data = sheet.getDataRange().getValues();
  const facilities = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;
    facilities.push({
      rowIndex: i + 1,
      name: row[0],
      zip: row[1] || '',
      address: row[2] || '',
      station: row[3] || '',
      note: row[4] || '',
    });
  }
  
  // 利用中スタッフ数カウント
  const staffSheet = ss.getSheetByName('M_スタッフ');
  const staffData = staffSheet.getDataRange().getValues();
  const usageMap = {};
  for (let i = 1; i < staffData.length; i++) {
    const retired = String(staffData[i][16]).toUpperCase() === 'TRUE';
    if (retired) continue;
    const main = String(staffData[i][9] || '').trim();
    const second = String(staffData[i][10] || '').trim();
    const subRaw = String(staffData[i][11] || '').trim();
    const subs = subRaw ? subRaw.split(',').map(f => f.trim()) : [];
    
    if (main) {
      usageMap[main] = usageMap[main] || { main: 0, second: 0, sub: 0 };
      usageMap[main].main++;
    }
    if (second) {
      usageMap[second] = usageMap[second] || { main: 0, second: 0, sub: 0 };
      usageMap[second].second++;
    }
    for (const sub of subs) {
      if (sub) {
        usageMap[sub] = usageMap[sub] || { main: 0, second: 0, sub: 0 };
        usageMap[sub].sub++;
      }
    }
  }
  
  facilities.forEach(f => {
    const u = usageMap[f.name] || { main: 0, second: 0, sub: 0 };
    f.usage = u;
    f.totalUsage = u.main + u.second + u.sub;
  });
  
  return { success: true, facilities: facilities };
}


function updateFacility(adminStaffId, facilityName, updates) {
  const admin = checkAdminAuth(adminStaffId, 'マスタ編集');
  if (!admin.authorized) {
    return { success: false, message: admin.message };
  }
  
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('M_施設');
  const data = sheet.getDataRange().getValues();
  
  let targetRow = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(facilityName)) {
      targetRow = i + 1;
      break;
    }
  }
  if (targetRow < 0) {
    return { success: false, message: '施設が見つかりません: ' + facilityName };
  }
  
  const oldRow = data[targetRow - 1];
  const changes = [];
  
  if (String(oldRow[1] || '') !== String(updates.zip || '')) {
    changes.push({ label: '郵便番号', before: oldRow[1] || '', after: updates.zip || '' });
    sheet.getRange(targetRow, 2).setValue(updates.zip || '');
  }
  if (String(oldRow[2] || '') !== String(updates.address || '')) {
    changes.push({ label: '住所', before: oldRow[2] || '', after: updates.address || '' });
    sheet.getRange(targetRow, 3).setValue(updates.address || '');
  }
  if (String(oldRow[3] || '') !== String(updates.station || '')) {
    changes.push({ label: '最寄り駅', before: oldRow[3] || '', after: updates.station || '' });
    sheet.getRange(targetRow, 4).setValue(updates.station || '');
  }
  if (String(oldRow[4] || '') !== String(updates.note || '')) {
    changes.push({ label: '備考', before: oldRow[4] || '', after: updates.note || '' });
    sheet.getRange(targetRow, 5).setValue(updates.note || '');
  }
  
  SpreadsheetApp.flush();
  
  if (changes.length === 0) {
    return { success: true, message: '変更はありませんでした', changedCount: 0 };
  }
  
  const summary = changes.map(c => c.label + ': [' + c.before + '] -> [' + c.after + ']').join(' | ');
  writeAdminLog(
    admin.staff_id, admin.name, admin.role,
    '施設更新', 'M_施設', facilityName,
    '', summary,
    facilityName + 'を' + changes.length + '項目変更'
  );
  
  return { success: true, message: changes.length + '項目更新しました', changedCount: changes.length };
}


function addFacility(adminStaffId, facilityData) {
  const admin = checkAdminAuth(adminStaffId, 'マスタ編集');
  if (!admin.authorized) {
    return { success: false, message: admin.message };
  }
  
  if (!facilityData.name || !facilityData.name.trim()) {
    return { success: false, message: '施設名は必須です' };
  }
  
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('M_施設');
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === facilityData.name.trim()) {
      return { success: false, message: 'この施設名はすでに存在します' };
    }
  }
  
  sheet.appendRow([
    facilityData.name.trim(),
    facilityData.zip || '',
    facilityData.address || '',
    facilityData.station || '',
    facilityData.note || '',
  ]);
  
  writeAdminLog(
    admin.staff_id, admin.name, admin.role,
    '施設追加', 'M_施設', facilityData.name,
    '', JSON.stringify(facilityData),
    '新規施設追加: ' + facilityData.name
  );
  
  return { success: true, message: '施設を追加しました: ' + facilityData.name };
}


function deleteFacility(adminStaffId, facilityName) {
  const admin = checkAdminAuth(adminStaffId, 'マスタ編集');
  if (!admin.authorized) {
    return { success: false, message: admin.message };
  }
  
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  
  // 使用中チェック
  const staffSheet = ss.getSheetByName('M_スタッフ');
  const staffData = staffSheet.getDataRange().getValues();
  let usageCount = 0;
  const usageStaff = [];
  
  for (let i = 1; i < staffData.length; i++) {
    const retired = String(staffData[i][16]).toUpperCase() === 'TRUE';
    if (retired) continue;
    const main = String(staffData[i][9] || '').trim();
    const second = String(staffData[i][10] || '').trim();
    const subRaw = String(staffData[i][11] || '').trim();
    const subs = subRaw ? subRaw.split(',').map(f => f.trim()) : [];
    
    if (main === facilityName || second === facilityName || subs.includes(facilityName)) {
      usageCount++;
      usageStaff.push(staffData[i][1]);
    }
  }
  
  if (usageCount > 0) {
    return { 
      success: false, 
      message: 'この施設を使用中のスタッフが' + usageCount + '人います。先にスタッフの施設設定を変更してください。',
      users: usageStaff.slice(0, 5)
    };
  }
  
  const sheet = ss.getSheetByName('M_施設');
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(facilityName)) {
      sheet.deleteRow(i + 1);
      
      writeAdminLog(
        admin.staff_id, admin.name, admin.role,
        '施設削除', 'M_施設', facilityName,
        JSON.stringify(data[i]), '',
        '施設削除: ' + facilityName
      );
      
      return { success: true, message: '施設を削除しました: ' + facilityName };
    }
  }
  
  return { success: false, message: '施設が見つかりません' };
}


// ============================================
// 希望提出閲覧機能
// ============================================

function getAllRequestsForAdmin(adminStaffId, targetYM) {
  const admin = checkAdminAuth(adminStaffId, null);
  if (!admin.authorized) {
    return { success: false, message: admin.message };
  }
  
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('T_希望提出');
  const data = sheet.getDataRange().getValues();
  
  const requests = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;
    
    const ym = normalizeYM(row[COL_REQ.YM]);
    if (targetYM && ym !== targetYM) continue;
    
    const submittedAt = row[1];
    const submittedStr = submittedAt instanceof Date
      ? Utilities.formatDate(submittedAt, 'Asia/Tokyo', 'MM/dd HH:mm')
      : String(submittedAt || '');
    
    const wishDate = row[COL_REQ.DATE];
    const wishDateStr = wishDate instanceof Date
      ? Utilities.formatDate(wishDate, 'Asia/Tokyo', 'yyyy-MM-dd')
      : String(wishDate || '');
    
    requests.push({
      requestId: row[0],
      submittedAt: submittedStr,
      staff_id: String(row[COL_REQ.STAFF_ID]).trim(),
      name: row[COL_REQ.NAME],
      targetYM: ym,
      wishDate: wishDateStr,
      shiftType: row[COL_REQ.SHIFT_TYPE],
      mainFacility: row[COL_REQ.MAIN_FAC] || '',
      secondFacility: row[COL_REQ.SECOND_FAC] || '',
      subFacilities: row[COL_REQ.SUB_FAC] || '',
      comment: row[COL_REQ.COMMENT] || '',
      freqType: row[COL_REQ.FREQ_TYPE] || '',
      freqCount: row[COL_REQ.FREQ_COUNT] || '',
    });
  }
  
  return { success: true, requests: requests };
}


function getSubmissionSummary(adminStaffId, targetYM) {
  const admin = checkAdminAuth(adminStaffId, null);
  if (!admin.authorized) {
    return { success: false, message: admin.message };
  }
  
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  
  const staffSheet = ss.getSheetByName('M_スタッフ');
  const staffData = staffSheet.getDataRange().getValues();
  const activeStaff = [];
  for (let i = 1; i < staffData.length; i++) {
    const retired = String(staffData[i][COL_STAFF.RETIRE]).toUpperCase() === 'TRUE';
    if (!retired && staffData[i][COL_STAFF.ID]) {
      activeStaff.push({
        staff_id: String(staffData[i][COL_STAFF.ID]).trim(),
        name: staffData[i][COL_STAFF.NAME],
        email: staffData[i][COL_STAFF.EMAIL] || '',
        mainFacility: staffData[i][COL_STAFF.MAIN_FAC] || '',
        shiftKubun: staffData[i][COL_STAFF.SHIFT_KUBUN] || '',
      });
    }
  }
  
  const reqSheet = ss.getSheetByName('T_希望提出');
  const reqData = reqSheet.getDataRange().getValues();
  const submittedMap = {};
  for (let i = 1; i < reqData.length; i++) {
    const ym = normalizeYM(reqData[i][COL_REQ.YM]);
    if (ym !== targetYM) continue;
    const sid = String(reqData[i][COL_REQ.STAFF_ID]).trim();
    submittedMap[sid] = (submittedMap[sid] || 0) + 1;
  }
  
  const submittedIds = Object.keys(submittedMap);
  const unsubmitted = activeStaff.filter(s => !submittedMap[s.staff_id]);
  
  return {
    success: true,
    targetYM: targetYM,
    totalActive: activeStaff.length,
    submittedCount: submittedIds.length,
    unsubmittedCount: unsubmitted.length,
    submissionRate: activeStaff.length > 0 ? Math.round(submittedIds.length / activeStaff.length * 100) : 0,
    unsubmittedStaff: unsubmitted.map(s => ({
      staff_id: s.staff_id,
      name: s.name,
      mainFacility: s.mainFacility,
      shiftKubun: s.shiftKubun,
      hasEmail: !!s.email,
    })),
  };
}


function getAvailableTargetYMs(adminStaffId) {
  const admin = checkAdminAuth(adminStaffId, null);
  if (!admin.authorized) {
    return { success: false, message: admin.message };
  }
  
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('T_希望提出');
  const data = sheet.getDataRange().getValues();
  
  const ymSet = new Set();
  for (let i = 1; i < data.length; i++) {
    const ym = normalizeYM(data[i][COL_REQ.YM]);
    if (ym) ymSet.add(ym);
  }
  
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextYM = nextMonth.getFullYear() + '-' + String(nextMonth.getMonth() + 1).padStart(2, '0');
  ymSet.add(nextYM);
  
  const yms = Array.from(ymSet).sort().reverse();
  return { success: true, yms: yms, defaultYM: nextYM };
}


// ============================================
// 操作ログビューア
// ============================================

function getOperationLogs(adminStaffId, filters) {
  const admin = checkAdminAuth(adminStaffId, null);
  if (!admin.authorized) {
    return { success: false, message: admin.message };
  }
  
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('T_操作ログ');
  if (!sheet) {
    return { success: false, message: 'T_操作ログシートが見つかりません' };
  }
  
  const data = sheet.getDataRange().getValues();
  filters = filters || {};
  
  let startDate = null, endDate = null;
  if (filters.startDate) {
    startDate = new Date(filters.startDate + 'T00:00:00');
  }
  if (filters.endDate) {
    endDate = new Date(filters.endDate + 'T23:59:59');
  }
  
  const logs = [];
  for (let i = data.length - 1; i >= 1; i--) {
    const row = data[i];
    if (!row[0]) continue;
    
    const time = row[1];
    if (!(time instanceof Date)) continue;
    
    if (startDate && time < startDate) continue;
    if (endDate && time > endDate) continue;
    if (filters.staffId && String(row[2]).trim() !== String(filters.staffId).trim()) continue;
    if (filters.operation && row[5] !== filters.operation) continue;
    if (filters.target && row[6] !== filters.target) continue;
    
    if (filters.keyword) {
      const kw = filters.keyword.toLowerCase();
      const blob = (String(row[3]) + ' ' + String(row[6]) + ' ' + 
                   String(row[7]) + ' ' + String(row[8]) + ' ' + 
                   String(row[9]) + ' ' + String(row[10])).toLowerCase();
      if (!blob.includes(kw)) continue;
    }
    
    logs.push({
      logId: row[0],
      time: Utilities.formatDate(time, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss'),
      timeShort: Utilities.formatDate(time, 'Asia/Tokyo', 'MM/dd HH:mm'),
      staffId: row[2],
      name: row[3] || '',
      role: row[4] || '',
      operation: row[5] || '',
      target: row[6] || '',
      targetId: row[7] || '',
      before: String(row[8] || ''),
      after: String(row[9] || ''),
      memo: row[10] || '',
    });
  }
  
  const opSet = new Set();
  const targetSet = new Set();
  const staffSet = new Set();
  for (let i = 1; i < data.length; i++) {
    if (data[i][5]) opSet.add(data[i][5]);
    if (data[i][6]) targetSet.add(data[i][6]);
    if (data[i][2]) staffSet.add(String(data[i][2]) + '|' + (data[i][3] || ''));
  }
  
  return { 
    success: true, 
    logs: logs,
    totalCount: data.length - 1,
    filterOptions: {
      operations: Array.from(opSet).sort(),
      targets: Array.from(targetSet).sort(),
      staffList: Array.from(staffSet).map(s => {
        const [id, name] = s.split('|');
        return { staff_id: id, name: name };
      }).sort((a, b) => a.name.localeCompare(b.name, 'ja')),
    }
  };
}


function getLogDetail(adminStaffId, logId) {
  const admin = checkAdminAuth(adminStaffId, null);
  if (!admin.authorized) {
    return { success: false, message: admin.message };
  }
  
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('T_操作ログ');
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) !== String(logId)) continue;
    const row = data[i];
    const time = row[1];
    return {
      success: true,
      log: {
        logId: row[0],
        time: time instanceof Date ? Utilities.formatDate(time, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss') : String(time),
        staffId: row[2],
        name: row[3] || '',
        role: row[4] || '',
        operation: row[5] || '',
        target: row[6] || '',
        targetId: row[7] || '',
        before: String(row[8] || ''),
        after: String(row[9] || ''),
        memo: row[10] || '',
      }
    };
  }
  return { success: false, message: 'ログが見つかりません' };
}
