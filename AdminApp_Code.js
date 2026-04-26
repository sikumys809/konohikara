// ============================================
// 管理画面サーバー処理 v2 (2026-04-26)
// 変更: 夜勤エンジンにロックガード追加
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
        mainRoles: row[19] || '',
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
  track(19, '主職種', updates.mainRoles, oldRow[19]);
  
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
  if (updates.mainRoles !== undefined) sheet.getRange(sheetRow, 20).setValue(updates.mainRoles);
  
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
      try {
        const kw = String(filters.keyword).toLowerCase();
        const parts = [row[3], row[6], row[7], row[8], row[9], row[10]];
        const blob = parts.map(p => {
          if (p === null || p === undefined) return '';
          return String(p);
        }).join(' ').toLowerCase();
        if (!blob.includes(kw)) continue;
      } catch (e) {
      }
    }
    
    logs.push({
      logId: String(row[0] || ''),
      time: Utilities.formatDate(time, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss'),
      timeShort: Utilities.formatDate(time, 'Asia/Tokyo', 'MM/dd HH:mm'),
      staffId: String(row[2] || ''),
      name: String(row[3] || ''),
      role: String(row[4] || ''),
      operation: String(row[5] || ''),
      target: String(row[6] || ''),
      targetId: String(row[7] || ''),
      before: row[8] === null || row[8] === undefined ? '' : String(row[8]),
      after: row[9] === null || row[9] === undefined ? '' : String(row[9]),
      memo: String(row[10] || ''),
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

// ============================================
// シフト作成画面用サーバー処理
// ============================================

function executeNightShiftEngine(adminStaffId, targetYM) {
  const admin = checkAdminAuth(adminStaffId, 'シフト作成');
  if (!admin.authorized) {
    return { success: false, message: admin.message };
  }
  
  // ★ 追加: ロック中は実行不可（保険として最終承認者でも拒否）
  if (isMonthLocked(targetYM)) {
    return { success: false, message: targetYM + 'はロック中です。編集するには最終承認者にロック解除を依頼してください。' };
  }
  
  const startTime = new Date().getTime();
  
  try {
    const result = runNightShiftEngine(targetYM);
    if (!result.success) {
      return { success: false, message: result.error || 'エンジン実行エラー' };
    }
    
    const ctx = result.ctx;
    const elapsed = ((new Date().getTime() - startTime) / 1000).toFixed(1);
    
    const assigned = ctx.slots.filter(s => s.staff_id).length;
    const total = ctx.slots.length;
    const rate = Math.round(assigned / total * 100);
    
    writeAdminLog(
      admin.staff_id, admin.name, admin.role,
      '自動割当実行', 'T_シフト確定', targetYM,
      '', assigned + '/' + total + '枠 (' + rate + '%) 実行時間' + elapsed + '秒',
      targetYM + 'の夜勤シフト自動割当を実行'
    );
    
    return {
      success: true,
      targetYM: targetYM,
      assigned: assigned,
      total: total,
      rate: rate,
      duplicates: (ctx.conflicts || []).length,
      warnings: ctx.warnings.length,
      elapsed: elapsed,
    };
    
  } catch (error) {
    return { success: false, message: 'エンジン実行エラー: ' + error.toString() };
  }
}


function getShiftCalendar(adminStaffId, targetYM) {
  const admin = checkAdminAuth(adminStaffId, null);
  if (!admin.authorized) {
    return { success: false, message: admin.message };
  }
  
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const [year, month] = targetYM.split('-').map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  
  const unitSheet = ss.getSheetByName('M_ユニット');
  const unitData = unitSheet.getDataRange().getValues();
  const units = [];
  for (let i = 1; i < unitData.length; i++) {
    if (!unitData[i][0]) continue;
    units.push({
      unit_id: unitData[i][0],
      jigyosho: unitData[i][1],
      unit_name: unitData[i][2],
      facility: unitData[i][3],
      capacity: unitData[i][4],
      room: unitData[i][5],
    });
  }
  
  const shiftSheet = ss.getSheetByName('T_シフト確定');
  const shiftData = shiftSheet.getDataRange().getValues();
  const shifts = {};
  for (let i = 1; i < shiftData.length; i++) {
    const row = shiftData[i];
    const date = row[1];
    if (!(date instanceof Date)) continue;
    if (date.getFullYear() !== year || date.getMonth() !== month - 1) continue;
    
    const dateKey = Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy-MM-dd');
    const key = dateKey + '_' + row[2];
    shifts[key] = {
      shift_id: row[0],
      dateKey: dateKey,
      unit_id: row[2],
      staff_id: row[6] ? String(row[6]).trim() : '',
      staff_name: row[7] || '',
      shift_type: row[8] || '',
      status: row[12] || '仮',
    };
  }
  
  const calendar = [];
  for (const unit of units) {
    const row = {
      unit: unit,
      days: [],
    };
    for (let day = 1; day <= daysInMonth; day++) {
      const dateKey = year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
      const d = new Date(dateKey + 'T00:00:00');
      const key = dateKey + '_' + unit.unit_id;
      row.days.push({
        day: day,
        dateKey: dateKey,
        dow: d.getDay(),
        shift: shifts[key] || null,
      });
    }
    calendar.push(row);
  }
  
  const totalSlots = units.length * daysInMonth;
  const assignedCount = Object.keys(shifts).length;
  
  const staffDateMap = {};
  const duplicates = [];
  for (const key of Object.keys(shifts)) {
    const s = shifts[key];
    if (!s.staff_id) continue;
    const sdKey = s.staff_id + '_' + s.dateKey;
    if (staffDateMap[sdKey]) {
      duplicates.push({ dateKey: s.dateKey, staff_id: s.staff_id });
    }
    staffDateMap[sdKey] = true;
  }
  
  return {
    success: true,
    targetYM: targetYM,
    year: year,
    month: month,
    daysInMonth: daysInMonth,
    calendar: calendar,
    summary: {
      totalSlots: totalSlots,
      assigned: assignedCount,
      unassigned: totalSlots - assignedCount,
      rate: totalSlots > 0 ? Math.round(assignedCount / totalSlots * 100) : 0,
      duplicates: duplicates.length,
    },
    canEdit: admin.roles.indexOf('シフト作成') >= 0,
    canApprove: admin.roles.indexOf('最終承認者') >= 0,
  };
}


function getCandidateStaffForSlot(adminStaffId, targetYM, dateKey, unitId) {
  const admin = checkAdminAuth(adminStaffId, 'シフト作成');
  if (!admin.authorized) {
    return { success: false, message: admin.message };
  }
  
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  
  const unitSheet = ss.getSheetByName('M_ユニット');
  const unitData = unitSheet.getDataRange().getValues();
  let facility = '';
  for (let i = 1; i < unitData.length; i++) {
    if (String(unitData[i][0]) === String(unitId)) {
      facility = unitData[i][3];
      break;
    }
  }
  
  const staffSheet = ss.getSheetByName('M_スタッフ');
  const staffData = staffSheet.getDataRange().getValues();
  
  const reqSheet = ss.getSheetByName('T_希望提出');
  const reqData = reqSheet.getDataRange().getValues();
  const wishesForDate = {};
  for (let i = 1; i < reqData.length; i++) {
    const d = reqData[i][5];
    if (!(d instanceof Date)) continue;
    const dKey = Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd');
    if (dKey !== dateKey) continue;
    const ym = normalizeYM(reqData[i][4]);
    if (ym !== targetYM) continue;
    const sid = String(reqData[i][2]).trim();
    if (!wishesForDate[sid]) wishesForDate[sid] = [];
    wishesForDate[sid].push(reqData[i][6]);
  }
  
  const shiftSheet = ss.getSheetByName('T_シフト確定');
  const shiftData = shiftSheet.getDataRange().getValues();
  const assignedToday = {};
  for (let i = 1; i < shiftData.length; i++) {
    const d = shiftData[i][1];
    if (!(d instanceof Date)) continue;
    const dKey = Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd');
    if (dKey !== dateKey) continue;
    const sid = String(shiftData[i][6] || '').trim();
    if (sid) assignedToday[sid] = true;
  }
  
  const candidates = [];
  for (let i = 1; i < staffData.length; i++) {
    const row = staffData[i];
    if (!row[0]) continue;
    if (String(row[16]).toUpperCase() === 'TRUE') continue;
    
    const sid = String(row[0]).trim();
    const mainFac = String(row[9] || '').trim();
    const secondFac = String(row[10] || '').trim();
    const subRaw = String(row[11] || '').trim();
    const subs = subRaw ? subRaw.split(',').map(s => s.trim()) : [];
    const allowedRaw = String(row[13] || '').trim();
    const allowed = allowedRaw ? allowedRaw.split(',').map(s => s.trim()) : [];
    
    const isMainMatch = mainFac === facility;
    const isSecondMatch = secondFac === facility;
    const isSubMatch = subs.indexOf(facility) >= 0;
    const facMatch = isMainMatch || isSecondMatch || isSubMatch;
    
    const hasWish = !!wishesForDate[sid];
    const alreadyAssigned = !!assignedToday[sid];
    
    candidates.push({
      staff_id: sid,
      name: row[1],
      mainFac: mainFac,
      secondFac: secondFac,
      shiftKubun: row[12] || '',
      allowedShifts: allowed,
      isProtected: String(row[14]).toUpperCase() === 'TRUE',
      qualification: row[5] || '',
      hireMonths: row[7] || 0,
      facilityMatch: facMatch ? (isMainMatch ? 'main' : isSecondMatch ? 'second' : 'sub') : 'none',
      hasWishForDate: hasWish,
      wishShifts: wishesForDate[sid] || [],
      alreadyAssignedToday: alreadyAssigned,
    });
  }
  
  candidates.sort((a, b) => {
    const scoreA = (a.hasWishForDate ? 100 : 0) + (a.facilityMatch === 'main' ? 30 : a.facilityMatch === 'second' ? 20 : a.facilityMatch === 'sub' ? 10 : 0);
    const scoreB = (b.hasWishForDate ? 100 : 0) + (b.facilityMatch === 'main' ? 30 : b.facilityMatch === 'second' ? 20 : b.facilityMatch === 'sub' ? 10 : 0);
    return scoreB - scoreA;
  });
  
  return {
    success: true,
    facility: facility,
    candidates: candidates,
  };
}


function updateShiftSlot(adminStaffId, targetYM, dateKey, unitId, updates) {
  const admin = checkAdminAuth(adminStaffId, 'シフト作成');
  if (!admin.authorized) {
    return { success: false, message: admin.message };
  }
  
  if (isMonthLocked(targetYM)) {
    return { success: false, message: targetYM + 'はロック中です。編集するには最終承認者にロック解除を依頼してください。' };
  }
  
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const shiftSheet = ss.getSheetByName('T_シフト確定');
  const data = shiftSheet.getDataRange().getValues();
  
  let targetRow = -1;
  let oldData = null;
  for (let i = 1; i < data.length; i++) {
    const d = data[i][1];
    if (!(d instanceof Date)) continue;
    const dKey = Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd');
    if (dKey === dateKey && String(data[i][2]) === String(unitId)) {
      targetRow = i + 1;
      oldData = data[i].slice();
      break;
    }
  }
  
  const unitSheet = ss.getSheetByName('M_ユニット');
  const unitData = unitSheet.getDataRange().getValues();
  let unit = null;
  for (let i = 1; i < unitData.length; i++) {
    if (String(unitData[i][0]) === String(unitId)) {
      unit = {
        unit_id: unitData[i][0],
        jigyosho: unitData[i][1],
        unit_name: unitData[i][2],
        facility: unitData[i][3],
      };
      break;
    }
  }
  if (!unit) {
    return { success: false, message: 'ユニットが見つかりません' };
  }
  
  let staffName = '';
  if (updates.staffId) {
    const staffSheet = ss.getSheetByName('M_スタッフ');
    const staffData = staffSheet.getDataRange().getValues();
    for (let i = 1; i < staffData.length; i++) {
      if (String(staffData[i][0]) === String(updates.staffId)) {
        staffName = staffData[i][1];
        break;
      }
    }
    if (!staffName) {
      return { success: false, message: 'スタッフが見つかりません: ' + updates.staffId };
    }
  }
  
  const shiftInfo = {
    '夜勤A': { start: '20:00', end: '05:00' },
    '夜勤B': { start: '22:00', end: '07:00' },
    '夜勤C': { start: '22:00', end: '08:00' },
  };
  const si = shiftInfo[updates.shiftType] || { start: '', end: '' };
  
  const now = new Date();
  
  if (updates.action === 'delete') {
    if (targetRow < 0) {
      return { success: false, message: '削除対象が見つかりません' };
    }
    shiftSheet.deleteRow(targetRow);
    
    writeAdminLog(
      admin.staff_id, admin.name, admin.role,
      'シフト削除', 'T_シフト確定', dateKey + '_' + unitId,
      oldData ? (oldData[7] + ' (' + oldData[8] + ')') : '',
      '',
      unit.unit_name + ' ' + dateKey + ' の配置を削除'
    );
    
    return { success: true, message: '削除しました' };
  }
  
  const d = new Date(dateKey + 'T00:00:00');
  const newRow = [
    oldData ? oldData[0] : 'SHIFT_MANUAL_' + now.getTime(),
    d,
    unit.unit_id,
    unit.jigyosho,
    unit.facility,
    unit.unit_name,
    updates.staffId,
    staffName,
    updates.shiftType,
    si.start,
    si.end,
    1,
    oldData ? oldData[12] : '仮',
    now,
  ];
  
  if (targetRow > 0) {
    shiftSheet.getRange(targetRow, 1, 1, 14).setValues([newRow]);
    shiftSheet.getRange(targetRow, 2).setNumberFormat('yyyy-MM-dd');
    shiftSheet.getRange(targetRow, 14).setNumberFormat('yyyy-MM-dd HH:mm:ss');
    
    const oldSummary = oldData[7] + ' (' + oldData[8] + ')';
    const newSummary = staffName + ' (' + updates.shiftType + ')';
    
    writeAdminLog(
      admin.staff_id, admin.name, admin.role,
      'シフト更新', 'T_シフト確定', dateKey + '_' + unitId,
      oldSummary,
      newSummary,
      unit.unit_name + ' ' + dateKey + ' を変更'
    );
  } else {
    shiftSheet.appendRow(newRow);
    const newRowIdx = shiftSheet.getLastRow();
    shiftSheet.getRange(newRowIdx, 2).setNumberFormat('yyyy-MM-dd');
    shiftSheet.getRange(newRowIdx, 14).setNumberFormat('yyyy-MM-dd HH:mm:ss');
    
    writeAdminLog(
      admin.staff_id, admin.name, admin.role,
      'シフト追加', 'T_シフト確定', dateKey + '_' + unitId,
      '',
      staffName + ' (' + updates.shiftType + ')',
      unit.unit_name + ' ' + dateKey + ' に新規配置'
    );
  }
  
  SpreadsheetApp.flush();
  return { success: true, message: '保存しました' };
}


// ============================================
// シフト確定(承認)機能
// ============================================

function getShiftsForApproval(adminStaffId, targetYM) {
  const admin = checkAdminAuth(adminStaffId, null);
  if (!admin.authorized) {
    return { success: false, message: admin.message };
  }
  
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const [year, month] = targetYM.split('-').map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  
  const NIGHT_SHIFT_SET = new Set(['夜勤A', '夜勤B', '夜勤C']);
  const DAY_SHIFT_SET = new Set(['早出8h', '早出4h', '遅出8h', '遅出4h']);
  
  // ===== M_ユニット (夜勤用) =====
  const unitSheet = ss.getSheetByName('M_ユニット');
  const unitData = unitSheet.getDataRange().getValues();
  const units = [];
  for (let i = 1; i < unitData.length; i++) {
    if (!unitData[i][0]) continue;
    units.push({
      unit_id: unitData[i][0],
      jigyosho: unitData[i][1],
      unit_name: unitData[i][2],
      facility: unitData[i][3],
      capacity: unitData[i][4],
      room: unitData[i][5],
    });
  }
  
  // ===== M_事業所配置基準 (日勤用 / 事業所一覧) =====
  let dayFacilities = [];
  let facilityBuildings = {};
  const baseSheet = ss.getSheetByName('M_事業所配置基準');
  if (baseSheet) {
    const baseData = baseSheet.getRange(2, 1, baseSheet.getLastRow() - 1, 8).getValues();
    dayFacilities = baseData.map(row => ({
      name: String(row[0]).trim(),
      capacity: parseInt(row[1]) || 0
    })).filter(f => f.name);
    
    dayFacilities.forEach(f => { facilityBuildings[f.name] = new Set(); });
    unitData.forEach((row, i) => {
      if (i === 0) return;
      const jig = String(row[1] || '').trim();
      const building = String(row[3] || '').trim();
      if (jig && building && facilityBuildings[jig]) {
        facilityBuildings[jig].add(building);
      }
    });
  }
  
  // ===== T_シフト確定 読み込み =====
  const shiftSheet = ss.getSheetByName('T_シフト確定');
  const shiftData = shiftSheet.getDataRange().getValues();
  const nightShifts = {};
  const dayShifts = {};
  let draftCount = 0, confirmedCount = 0;
  let lastUpdated = null;
  
  for (let i = 1; i < shiftData.length; i++) {
    const row = shiftData[i];
    let date = row[1];
    if (typeof date === 'string') {
      date = new Date(date);
    }
    if (!(date instanceof Date) || isNaN(date.getTime())) continue;
    if (date.getFullYear() !== year || date.getMonth() !== month - 1) continue;
    
    const dateKey = Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy-MM-dd');
    const status = row[12] || '仮';
    const updated = row[13];
    const shiftType = String(row[8] || '').trim();
    
    if (status === '確定') confirmedCount++;
    else draftCount++;
    
    if (updated instanceof Date) {
      if (!lastUpdated || updated > lastUpdated) lastUpdated = updated;
    }
    
    const updatedStr = updated instanceof Date 
      ? Utilities.formatDate(updated, 'Asia/Tokyo', 'MM/dd HH:mm') : '';
    
    if (NIGHT_SHIFT_SET.has(shiftType)) {
      const key = dateKey + '_' + row[2];
      nightShifts[key] = {
        shift_id: row[0],
        dateKey: dateKey,
        unit_id: row[2],
        staff_id: row[6] ? String(row[6]).trim() : '',
        staff_name: row[7] || '',
        shift_type: shiftType,
        status: status,
        updated: updatedStr,
      };
    } else if (DAY_SHIFT_SET.has(shiftType)) {
      const jigyosho = String(row[3] || '').trim();
      const facility = String(row[4] || '').trim();
      const key = jigyosho + '||' + facility + '||' + dateKey;
      if (!dayShifts[key]) dayShifts[key] = [];
      dayShifts[key].push({
        shift_id: row[0],
        dateKey: dateKey,
        staff_id: row[6] ? String(row[6]).trim() : '',
        staff_name: row[7] || '',
        shift_type: shiftType,
        status: status,
        updated: updatedStr,
      });
    }
  }
  
  // ===== 夜勤カレンダー構築 =====
  const calendar = [];
  for (const unit of units) {
    const row = { unit: unit, days: [] };
    for (let day = 1; day <= daysInMonth; day++) {
      const dateKey = year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
      const d = new Date(dateKey + 'T00:00:00');
      const key = dateKey + '_' + unit.unit_id;
      row.days.push({
        day: day,
        dateKey: dateKey,
        dow: d.getDay(),
        shift: nightShifts[key] || null,
      });
    }
    calendar.push(row);
  }
  
  // ===== 日勤カレンダー構築 =====
  const days = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const dateKey = year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    const d = new Date(dateKey + 'T00:00:00');
    days.push({ day: day, dateKey: dateKey, dow: d.getDay() });
  }
  
  const dayCalendar = dayFacilities.map(f => {
    const buildings = Array.from(facilityBuildings[f.name] || []).sort();
    const buildingRows = buildings.map(b => {
      const cells = days.map(d => {
        const key = f.name + '||' + b + '||' + d.dateKey;
        const placements = dayShifts[key] || [];
        return {
          day: d.day,
          dateKey: d.dateKey,
          dow: d.dow,
          count: placements.length,
          placements: placements,
        };
      });
      return { facility: b, cells: cells };
    });
    return {
      jigyosho: f.name,
      capacity: f.capacity,
      buildings: buildingRows,
    };
  });
  
  const totalSlots = units.length * daysInMonth;
  const assignedCount = Object.keys(nightShifts).length;
  
  let dayCount = 0;
  Object.keys(dayShifts).forEach(k => { dayCount += dayShifts[k].length; });
  
  return {
    success: true,
    targetYM: targetYM,
    year: year,
    month: month,
    daysInMonth: daysInMonth,
    days: days,
    calendar: calendar,
    dayCalendar: dayCalendar,
    summary: {
      totalSlots: totalSlots + dayFacilities.length * daysInMonth,
      assigned: assignedCount + dayCount,
      nightCount: assignedCount,
      dayCount: dayCount,
      draft: draftCount,
      confirmed: confirmedCount,
      unassigned: (totalSlots + dayFacilities.length * daysInMonth) - (assignedCount + dayCount),
      confirmRate: (draftCount + confirmedCount) > 0 
        ? Math.round(confirmedCount / (draftCount + confirmedCount) * 100) 
        : 0,
      lastUpdated: lastUpdated instanceof Date ? Utilities.formatDate(lastUpdated, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm') : '',
    },
    canApprove: admin.roles.indexOf('最終承認者') >= 0,
  };
}


function approveShifts(adminStaffId, targetYM) {
  const admin = checkAdminAuth(adminStaffId, '最終承認者');
  if (!admin.authorized) {
    return { success: false, message: admin.message };
  }
  
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const [year, month] = targetYM.split('-').map(Number);
  const sheet = ss.getSheetByName('T_シフト確定');
  const data = sheet.getDataRange().getValues();
  
  const now = new Date();
  let changedCount = 0;
  const updates = [];
  
  for (let i = 1; i < data.length; i++) {
    let date = data[i][1];
    if (typeof date === 'string') {
      date = new Date(date);
    }
    if (!(date instanceof Date) || isNaN(date.getTime())) continue;
    if (date.getFullYear() !== year || date.getMonth() !== month - 1) continue;
    
    const currentStatus = data[i][12];
    if (currentStatus === '確定') continue;
    
    updates.push({ row: i + 1, shiftId: data[i][0] });
    changedCount++;
  }
  
  if (changedCount === 0) {
    return { success: false, message: '変更対象の仮シフトがありません' };
  }
  
  for (const u of updates) {
    sheet.getRange(u.row, 13).setValue('確定');
    sheet.getRange(u.row, 14).setValue(now);
  }
  
  SpreadsheetApp.flush();
  
  _setMonthLock(targetYM, true, admin, '確定化に伴う自動ロック');
  
  writeAdminLog(
    admin.staff_id, admin.name, admin.role,
    'シフト確定', 'T_シフト確定', targetYM,
    '仮', '確定',
    targetYM + 'の' + changedCount + '件を確定化+ロック'
  );
  
  return {
    success: true,
    message: changedCount + '件を確定しロックしました',
    changedCount: changedCount,
  };
}


function revertApproval(adminStaffId, targetYM) {
  const admin = checkAdminAuth(adminStaffId, '最終承認者');
  if (!admin.authorized) {
    return { success: false, message: admin.message };
  }
  
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const [year, month] = targetYM.split('-').map(Number);
  const sheet = ss.getSheetByName('T_シフト確定');
  const data = sheet.getDataRange().getValues();
  
  const now = new Date();
  let changedCount = 0;
  const updates = [];
  
  for (let i = 1; i < data.length; i++) {
    let date = data[i][1];
    if (typeof date === 'string') {
      date = new Date(date);
    }
    if (!(date instanceof Date) || isNaN(date.getTime())) continue;
    if (date.getFullYear() !== year || date.getMonth() !== month - 1) continue;
    
    const currentStatus = data[i][12];
    if (currentStatus !== '確定') continue;
    
    updates.push({ row: i + 1, shiftId: data[i][0] });
    changedCount++;
  }
  
  if (changedCount === 0) {
    return { success: false, message: '確定済みのシフトがありません' };
  }
  
  for (const u of updates) {
    sheet.getRange(u.row, 13).setValue('仮');
    sheet.getRange(u.row, 14).setValue(now);
  }
  
  SpreadsheetApp.flush();
  
  _setMonthLock(targetYM, false, admin, '確定取消に伴う自動ロック解除');
  
  writeAdminLog(
    admin.staff_id, admin.name, admin.role,
    '確定取消', 'T_シフト確定', targetYM,
    '確定', '仮',
    targetYM + 'の' + changedCount + '件の確定を取消+ロック解除'
  );
  
  return {
    success: true,
    message: changedCount + '件の確定を取り消し、ロックを解除しました',
    changedCount: changedCount,
  };
}



// ============================================
// 月次ロック機構
// ============================================

function isMonthLocked(targetYM) {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('T_月次ロック');
  if (!sheet) return false;
  
  const data = sheet.getDataRange().getValues();
  let latestLocked = false;
  let found = false;
  
  for (let i = 1; i < data.length; i++) {
    if (_ymMatches(data[i][0], targetYM)) {
      latestLocked = String(data[i][1]).toUpperCase() === 'TRUE';
      found = true;
    }
  }
  return found ? latestLocked : false;
}


function _ymMatches(cellVal, targetYM) {
  if (cellVal instanceof Date) {
    const ym = Utilities.formatDate(cellVal, 'Asia/Tokyo', 'yyyy-MM');
    return ym === String(targetYM);
  }
  return String(cellVal).trim() === String(targetYM).trim();
}


function _setMonthLock(targetYM, locked, admin, memo) {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  let sheet = ss.getSheetByName('T_月次ロック');
  
  if (!sheet) {
    sheet = ss.insertSheet('T_月次ロック');
    sheet.getRange(1, 1, 1, 7).setValues([['対象年月', 'ロック状態', '取得者ID', '氏名', '取得日時', '期限', 'メモ']]);
    sheet.getRange(1, 1, 1, 7).setFontWeight('bold').setBackground('#4a148c').setFontColor('#ffffff');
  }
  
  sheet.getRange('A2:A1000').setNumberFormat('@');
  sheet.getRange('B2:B1000').setNumberFormat('@');
  
  const data = sheet.getDataRange().getValues();
  const now = new Date();
  let targetRow = -1;
  
  for (let i = 1; i < data.length; i++) {
    if (_ymMatches(data[i][0], targetYM)) {
      targetRow = i + 1;
    }
  }
  
  if (targetRow > 0) {
    sheet.getRange(targetRow, 1).setValue(String(targetYM));
    sheet.getRange(targetRow, 2).setValue(locked ? 'TRUE' : 'FALSE');
    if (locked) {
      sheet.getRange(targetRow, 3).setValue(admin.staff_id);
      sheet.getRange(targetRow, 4).setValue(admin.name);
      sheet.getRange(targetRow, 5).setValue(now);
    } else {
      sheet.getRange(targetRow, 3).setValue('');
      sheet.getRange(targetRow, 4).setValue('');
      sheet.getRange(targetRow, 5).setValue('');
    }
    sheet.getRange(targetRow, 7).setValue(memo || '');
  } else {
    sheet.appendRow([
      String(targetYM),
      locked ? 'TRUE' : 'FALSE',
      locked ? admin.staff_id : '',
      locked ? admin.name : '',
      locked ? now : '',
      '',
      memo || '',
    ]);
    const newRowIdx = sheet.getLastRow();
    sheet.getRange(newRowIdx, 1).setNumberFormat('@');
    sheet.getRange(newRowIdx, 1).setValue(String(targetYM));
    sheet.getRange(newRowIdx, 2).setNumberFormat('@');
    if (locked) {
      sheet.getRange(newRowIdx, 5).setNumberFormat('yyyy-MM-dd HH:mm:ss');
    }
  }
  
  SpreadsheetApp.flush();
  return true;
}


function getLockStatus(adminStaffId, targetYM) {
  const admin = checkAdminAuth(adminStaffId, null);
  if (!admin.authorized) {
    return { success: false, message: admin.message };
  }
  
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('T_月次ロック');
  
  if (!sheet) {
    return { success: true, locked: false };
  }
  
  const data = sheet.getDataRange().getValues();
  let result = null;
  for (let i = 1; i < data.length; i++) {
    if (_ymMatches(data[i][0], targetYM)) {
      const locked = String(data[i][1]).toUpperCase() === 'TRUE';
      const lockedAt = data[i][4];
      result = {
        success: true,
        locked: locked,
        lockedBy: data[i][3] || '',
        lockedById: data[i][2] || '',
        lockedAt: lockedAt instanceof Date ? Utilities.formatDate(lockedAt, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm') : '',
        memo: data[i][6] || '',
      };
    }
  }
  return result || { success: true, locked: false };
}


function unlockMonthByAdmin(adminStaffId, targetYM) {
  const admin = checkAdminAuth(adminStaffId, '最終承認者');
  if (!admin.authorized) {
    return { success: false, message: admin.message };
  }
  
  const ok = _setMonthLock(targetYM, false, admin, '手動ロック解除(修正のため)');
  if (!ok) {
    return { success: false, message: 'ロック解除失敗' };
  }
  
  writeAdminLog(
    admin.staff_id, admin.name, admin.role,
    'ロック解除', 'T_月次ロック', targetYM,
    'ロック中', '解除',
    targetYM + 'のロックを手動解除(修正のため・確定ステータスは維持)'
  );
  
  return { success: true, message: 'ロックを解除しました。編集可能になります。確定ステータスは維持されます。' };
}


// ============================================
// PDF出力用データ取得 (施設ごと)
// ============================================

function getShiftsForPDF(adminStaffId, targetYM, facility) {
  const admin = checkAdminAuth(adminStaffId, null);
  if (!admin.authorized) {
    return { success: false, message: admin.message };
  }
  
  if (!facility) {
    return { success: false, message: '施設を指定してください' };
  }
  
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const [year, month] = targetYM.split('-').map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  
  const unitSheet = ss.getSheetByName('M_ユニット');
  const unitData = unitSheet.getDataRange().getValues();
  const units = [];
  for (let i = 1; i < unitData.length; i++) {
    if (!unitData[i][0]) continue;
    if (unitData[i][3] !== facility) continue;
    units.push({
      unit_id: unitData[i][0],
      jigyosho: unitData[i][1],
      unit_name: unitData[i][2],
      facility: unitData[i][3],
      capacity: unitData[i][4],
      room: unitData[i][5] || '',
    });
  }
  
  if (units.length === 0) {
    return { success: false, message: '施設「' + facility + '」のユニットが見つかりません' };
  }
  
  const shiftSheet = ss.getSheetByName('T_シフト確定');
  const shiftData = shiftSheet.getDataRange().getValues();
  const shifts = {};
  for (let i = 1; i < shiftData.length; i++) {
    const row = shiftData[i];
    const date = row[1];
    if (!(date instanceof Date)) continue;
    if (date.getFullYear() !== year || date.getMonth() !== month - 1) continue;
    if (row[4] !== facility) continue;
    
    const dateKey = Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy-MM-dd');
    const key = dateKey + '_' + row[2];
    
    const startVal = row[9];
    const endVal = row[10];
    const startStr = (startVal instanceof Date) 
      ? Utilities.formatDate(startVal, 'Asia/Tokyo', 'HH:mm')
      : String(startVal || '');
    const endStr = (endVal instanceof Date) 
      ? Utilities.formatDate(endVal, 'Asia/Tokyo', 'HH:mm')
      : String(endVal || '');
    
    shifts[key] = {
      staff_name: String(row[7] || ''),
      shift_type: String(row[8] || ''),
      start: startStr,
      end: endStr,
      status: String(row[12] || '仮'),
    };
  }
  
  const rows = [];
  const dowChars = ['日','月','火','水','木','金','土'];
  for (let day = 1; day <= daysInMonth; day++) {
    const dateKey = year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    const d = new Date(dateKey + 'T00:00:00');
    const cells = [];
    for (const unit of units) {
      const key = dateKey + '_' + unit.unit_id;
      cells.push(shifts[key] || null);
    }
    rows.push({
      day: day,
      dateKey: dateKey,
      dow: d.getDay(),
      dowChar: dowChars[d.getDay()],
      cells: cells,
    });
  }
  
  return {
    success: true,
    targetYM: targetYM,
    year: year,
    month: month,
    facility: facility,
    units: units,
    rows: rows,
  };
}


function getFacilitiesWithShifts(adminStaffId, targetYM) {
  const admin = checkAdminAuth(adminStaffId, null);
  if (!admin.authorized) {
    return { success: false, message: admin.message };
  }
  
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const [year, month] = targetYM.split('-').map(Number);
  
  const shiftSheet = ss.getSheetByName('T_シフト確定');
  const shiftData = shiftSheet.getDataRange().getValues();
  const facSet = new Set();
  
  for (let i = 1; i < shiftData.length; i++) {
    const row = shiftData[i];
    const date = row[1];
    if (!(date instanceof Date)) continue;
    if (date.getFullYear() !== year || date.getMonth() !== month - 1) continue;
    if (row[4]) facSet.add(row[4]);
  }
  
  return { success: true, facilities: Array.from(facSet).sort() };
}



// ============================================
// T_月次ロック 重複行クリーンアップ (手動実行用)
// ============================================

function cleanupMonthLockSheet() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('T_月次ロック');
  if (!sheet) {
    Logger.log('T_月次ロックシートが見つかりません');
    return;
  }
  
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) {
    Logger.log('データなし');
    return;
  }
  
  const latestByYM = {};
  for (let i = 1; i < data.length; i++) {
    let ymKey;
    const cellVal = data[i][0];
    if (cellVal instanceof Date) {
      ymKey = Utilities.formatDate(cellVal, 'Asia/Tokyo', 'yyyy-MM');
    } else {
      ymKey = String(cellVal).trim();
    }
    if (!ymKey) continue;
    
    latestByYM[ymKey] = data[i];
  }
  
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, 7).clearContent();
  }
  
  sheet.getRange('A2:A1000').setNumberFormat('@');
  sheet.getRange('B2:B1000').setNumberFormat('@');
  
  const ymKeys = Object.keys(latestByYM).sort();
  if (ymKeys.length > 0) {
    const rows = ymKeys.map(k => {
      const r = latestByYM[k];
      return [String(k), String(r[1]).toUpperCase(), r[2] || '', r[3] || '', r[4] || '', r[5] || '', r[6] || ''];
    });
    sheet.getRange(2, 1, rows.length, 7).setValues(rows);
  }
  
  SpreadsheetApp.flush();
  Logger.log('クリーンアップ完了: ' + ymKeys.length + '年月分を整理');
  return { success: true, count: ymKeys.length, yms: ymKeys };
}