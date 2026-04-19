// ============================================
// テストデータ生成スクリプト v2 (2026-04-19)
// N列データ検証制約を回避するためクリアしてから書き込み
// ============================================

const TEST_CONFIG = {
  STAFF_COUNT: 100,
  TARGET_YM: '2026-05',
  MIN_WISH_DAYS: 10,
  MAX_WISH_DAYS: 20,
  PROTECTED_COUNT: 5,
  FACILITIES: [
    'ルーデンス新板橋Ⅱ',
    'ルーデンス東十条アネックス',
    'ルーデンス東十条マキシブ',
    'ルーデンス本蓮沼',
    'ルーデンス上板橋E-st',
    'ルーデンス板橋区役所前',
    'ルーデンス大泉学園前',
    'リフレ要町',
    'ルーデンス中野富士見町',
    'EST東長崎',
    'ルーデンス立会川Ⅱ',
    'ルーデンス梅屋敷',
  ],
};


function generateTestData() {
  Logger.log('========================================');
  Logger.log('[START] テストデータ生成');
  Logger.log('========================================');
  
  try {
    const setupRes = setupStaffForTest();
    if (!setupRes.success) {
      Logger.log('[ABORT] スタッフ設定失敗');
      return;
    }
    
    const wishRes = generateTestWishes(setupRes.staffList);
    if (!wishRes.success) {
      Logger.log('[ABORT] 希望提出生成失敗');
      return;
    }
    
    Logger.log('========================================');
    Logger.log('[DONE] 全テストデータ生成完了');
    Logger.log('  設定スタッフ: ' + setupRes.count + '人');
    Logger.log('  希望提出数: ' + wishRes.count + '件');
    Logger.log('  保護フラグ: ' + setupRes.protectedCount + '人');
    Logger.log('  新人1ヶ月: ' + setupRes.newbie1 + '人');
    Logger.log('  新人2ヶ月: ' + setupRes.newbie2 + '人');
    Logger.log('========================================');
    
  } catch (error) {
    Logger.log('[ERROR] ' + error.toString());
    Logger.log(error.stack);
  }
}


function setupStaffForTest() {
  Logger.log('[Step 1] スタッフ設定開始');
  
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('M_スタッフ');
  const data = sheet.getDataRange().getValues();
  
  // ★★★ 重要: N列(許可シフト種別)のデータ検証を一時的にクリア ★★★
  // プルダウン制約で書き込みエラーになるのを回避
  const maxRows = sheet.getMaxRows();
  sheet.getRange(2, 14, maxRows - 1, 1).setDataValidation(null);  // N列クリア
  sheet.getRange(2, 13, maxRows - 1, 1).setDataValidation(null);  // M列もクリア
  sheet.getRange(2, 9, maxRows - 1, 1).setDataValidation(null);   // I列もクリア
  Logger.log('  [CLEAR] N/M/I列のデータ検証をクリア');
  
  // 在籍者のうち先頭100人を選出
  const activeStaff = [];
  for (let i = 1; i < data.length; i++) {
    const retired = String(data[i][16]).toUpperCase() === 'TRUE';
    if (retired) continue;
    if (!data[i][0] || !data[i][2]) continue;
    activeStaff.push({
      rowIdx: i + 1,
      staff_id: data[i][0],
      name: data[i][1],
      email: data[i][2],
      hireMonths: Number(data[i][7]) || 0,
    });
    if (activeStaff.length >= TEST_CONFIG.STAFF_COUNT) break;
  }
  
  Logger.log('  対象スタッフ: ' + activeStaff.length + '人');
  
  const facilities = TEST_CONFIG.FACILITIES;
  const fcount = facilities.length;
  
  const staffList = [];
  let protectedCount = 0;
  let newbie1 = 0, newbie2 = 0;
  
  // ★★★ 一括書き込み用配列を準備 ★★★
  const updates = []; // [rowIdx, kubun, main, second, sub, shiftKubun, allowed, protected]
  
  for (let i = 0; i < activeStaff.length; i++) {
    const s = activeStaff[i];
    const mainFac = facilities[i % fcount];
    
    let secondFac = '';
    let subFacs = '';
    if (i >= 40 && i < 80) {
      secondFac = facilities[(i + 1) % fcount];
    } else if (i >= 80) {
      secondFac = facilities[(i + 1) % fcount];
      const sub1 = facilities[(i + 2) % fcount];
      const sub2 = facilities[(i + 3) % fcount];
      const sub3 = facilities[(i + 4) % fcount];
      subFacs = [sub1, sub2, sub3].join(',');
    }
    
    const shiftKubun = Math.random() < 0.8 ? '夜勤のみ' : '両方';
    
    let allowedShifts = [];
    if (shiftKubun === '夜勤のみ') {
      const nights = ['夜勤A', '夜勤B', '夜勤C'];
      shuffleArray(nights);
      const pickCount = Math.random() < 0.5 ? 2 : 3;
      allowedShifts = nights.slice(0, pickCount);
    } else {
      // 両方: 夜勤3種+日勤2種の全部パターンにする(プリセットと同じ)
      allowedShifts = ['夜勤A', '夜勤B', '夜勤C', '日勤早出', '日勤遅出'];
    }
    const allowedShiftsStr = allowedShifts.join(',');
    
    let kubun = '通常';
    if (s.hireMonths === 1) { kubun = '新人1ヶ月'; newbie1++; }
    else if (s.hireMonths === 2) { kubun = '新人2ヶ月'; newbie2++; }
    
    const isProtected = protectedCount < TEST_CONFIG.PROTECTED_COUNT && i < 10 && Math.random() < 0.7;
    if (isProtected) protectedCount++;
    
    updates.push({
      row: s.rowIdx,
      kubun: kubun,
      main: mainFac,
      second: secondFac,
      sub: subFacs,
      shiftKubun: shiftKubun,
      allowed: allowedShiftsStr,
      protected: isProtected,
    });
    
    staffList.push({
      staff_id: s.staff_id,
      name: s.name,
      mainFac: mainFac,
      secondFac: secondFac,
      subFacs: subFacs ? subFacs.split(',') : [],
      shiftKubun: shiftKubun,
      allowedShifts: allowedShifts,
    });
  }
  
  // 一括書き込み
  for (const u of updates) {
    sheet.getRange(u.row, 9).setValue(u.kubun);
    sheet.getRange(u.row, 10).setValue(u.main);
    sheet.getRange(u.row, 11).setValue(u.second);
    sheet.getRange(u.row, 12).setValue(u.sub);
    sheet.getRange(u.row, 13).setValue(u.shiftKubun);
    sheet.getRange(u.row, 14).setValue(u.allowed);
    sheet.getRange(u.row, 15).setValue(u.protected ? 'TRUE' : 'FALSE');
  }
  
  SpreadsheetApp.flush();
  Logger.log('  完了: ' + staffList.length + '人に設定');
  Logger.log('  保護: ' + protectedCount + '人');
  Logger.log('  新人1ヶ月: ' + newbie1 + '人');
  Logger.log('  新人2ヶ月: ' + newbie2 + '人');
  
  return { success: true, count: staffList.length, staffList: staffList, protectedCount: protectedCount, newbie1: newbie1, newbie2: newbie2 };
}


function generateTestWishes(staffList) {
  Logger.log('[Step 2] 希望提出データ生成開始');
  
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('T_希望提出');
  
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
    Logger.log('  既存データクリア: ' + (lastRow - 1) + '件');
  }
  
  const targetYM = TEST_CONFIG.TARGET_YM;
  const [year, month] = targetYM.split('-').map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  
  const now = new Date();
  const rows = [];
  let counter = 1;
  
  for (const s of staffList) {
    const wishDayCount = TEST_CONFIG.MIN_WISH_DAYS + 
      Math.floor(Math.random() * (TEST_CONFIG.MAX_WISH_DAYS - TEST_CONFIG.MIN_WISH_DAYS + 1));
    
    const dayList = [];
    for (let d = 1; d <= daysInMonth; d++) dayList.push(d);
    shuffleArray(dayList);
    const selectedDays = dayList.slice(0, wishDayCount).sort((a, b) => a - b);
    
    const freqType = Math.random() < 0.7 ? '月次合計' : '週次';
    const freqCount = freqType === '月次合計' 
      ? Math.floor(wishDayCount * 0.7) + Math.floor(Math.random() * 5)
      : Math.floor(Math.random() * 3) + 2;
    
    for (const day of selectedDays) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const wishDate = new Date(dateStr + 'T00:00:00');
      
      const nightShifts = s.allowedShifts.filter(sh => sh.startsWith('夜勤'));
      const shifts = nightShifts.length > 0 ? nightShifts : s.allowedShifts;
      if (shifts.length === 0) continue;
      const shift = shifts[Math.floor(Math.random() * shifts.length)];
      
      const requestId = `${s.staff_id}_${targetYM}_${counter++}`;
      
      rows.push([
        requestId, now, s.staff_id, s.name, targetYM, wishDate, shift,
        s.mainFac, s.secondFac, s.subFacs.join(','),
        '', freqType, freqCount,
      ]);
    }
  }
  
  Logger.log('  生成件数: ' + rows.length + '件');
  
  const BATCH = 1000;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    sheet.getRange(2 + i, 1, batch.length, 13).setValues(batch);
  }
  
  if (rows.length > 0) {
    sheet.getRange(2, 6, rows.length, 1).setNumberFormat('yyyy-MM-dd');
  }
  
  SpreadsheetApp.flush();
  Logger.log('  書き込み完了');
  
  return { success: true, count: rows.length };
}


function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}


function verifyTestData() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  
  Logger.log('[VERIFY] スタッフ設定確認');
  const staffSheet = ss.getSheetByName('M_スタッフ');
  const staffData = staffSheet.getDataRange().getValues();
  
  let setCount = 0, nightOnly = 0, both = 0, protectedCnt = 0, newbie1 = 0, newbie2 = 0;
  const facCount = {};
  
  for (let i = 1; i < staffData.length; i++) {
    const retired = String(staffData[i][16]).toUpperCase() === 'TRUE';
    if (retired) continue;
    const main = staffData[i][9];
    if (!main) continue;
    setCount++;
    const sk = staffData[i][12];
    if (sk === '夜勤のみ') nightOnly++;
    else if (sk === '両方') both++;
    if (String(staffData[i][14]).toUpperCase() === 'TRUE') protectedCnt++;
    const kubun = staffData[i][8];
    if (kubun === '新人1ヶ月') newbie1++;
    if (kubun === '新人2ヶ月') newbie2++;
    facCount[main] = (facCount[main] || 0) + 1;
  }
  
  Logger.log('  設定済み: ' + setCount + '人');
  Logger.log('  夜勤のみ: ' + nightOnly + '人 / 両方: ' + both + '人');
  Logger.log('  保護: ' + protectedCnt + '人');
  Logger.log('  新人1ヶ月: ' + newbie1 + '人 / 新人2ヶ月: ' + newbie2 + '人');
  Logger.log('  メイン施設分布:');
  Object.keys(facCount).sort().forEach(f => {
    Logger.log('    ' + f + ': ' + facCount[f] + '人');
  });
  
  Logger.log('');
  Logger.log('[VERIFY] 希望提出データ確認');
  const reqSheet = ss.getSheetByName('T_希望提出');
  const reqData = reqSheet.getDataRange().getValues();
  Logger.log('  総件数: ' + (reqData.length - 1) + '件');
  
  const submittedIds = new Set();
  const shiftCount = {};
  const dayCount = {};
  for (let i = 1; i < reqData.length; i++) {
    submittedIds.add(String(reqData[i][2]));
    const shift = reqData[i][6];
    shiftCount[shift] = (shiftCount[shift] || 0) + 1;
    const d = reqData[i][5];
    if (d instanceof Date) {
      const day = d.getDate();
      dayCount[day] = (dayCount[day] || 0) + 1;
    }
  }
  Logger.log('  提出スタッフ: ' + submittedIds.size + '人');
  Logger.log('  シフト種別分布:');
  Object.keys(shiftCount).sort().forEach(s => {
    Logger.log('    ' + s + ': ' + shiftCount[s] + '件');
  });
  
  Logger.log('');
  Logger.log('  日別配置可能人数(上位5日):');
  const sortedDays = Object.keys(dayCount).sort((a, b) => dayCount[b] - dayCount[a]).slice(0, 5);
  sortedDays.forEach(d => {
    Logger.log('    ' + d + '日: ' + dayCount[d] + '件');
  });
  
  Logger.log('');
  Logger.log('  日別配置可能人数(下位5日):');
  const sortedDaysLow = Object.keys(dayCount).sort((a, b) => dayCount[a] - dayCount[b]).slice(0, 5);
  sortedDaysLow.forEach(d => {
    Logger.log('    ' + d + '日: ' + dayCount[d] + '件');
  });
}
