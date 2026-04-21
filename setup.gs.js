// ============================================
// コノヒカラ シフト管理 - セットアップ v3.0
// 18列構造 + 入社月数自動計算 + 全プルダウン
// ============================================

const STAFF_SS_ID = '1IVRo8kj0lmaiuokomDlXVUn6E8XC8tktkwaXjtAAHHE';

// 新列構造（18列）
const NEW_HEADERS = [
  'staff_id',          // A(0)
  '氏名',               // B(1)
  'メールアドレス',      // C(2)
  '電話番号',           // D(3)
  '雇用形態',           // E(4) 正社員/パート
  '国家資格',           // F(5) 看護師/空
  '入社日',             // G(6)
  '入社月数',           // H(7) 🆕 自動計算
  'スタッフ区分',        // I(8) 通常/新人1ヶ月/新人2ヶ月
  'メイン施設名',        // J(9)
  'セカンド施設名',      // K(10) 🆕
  'サブ施設候補',        // L(11) カンマ区切り
  'シフト区分',          // M(12) 夜勤のみ/日勤のみ/両方
  '許可シフト種別',      // N(13)
  '保護フラグ',          // O(14)
  'VIP重要フラグ',       // P(15)
  '退職フラグ',          // Q(16)
  '備考',               // R(17)
];

// 列インデックス定数
const NEW_COL = {
  ID: 0, NAME: 1, EMAIL: 2, PHONE: 3,
  EMPLOYMENT: 4, QUALIFICATION: 5,
  HIRE_DATE: 6, HIRE_MONTHS: 7, KUBUN: 8,
  MAIN_FAC: 9, SECOND_FAC: 10, SUB_FACS: 11,
  SHIFT_KUBUN: 12, ALLOWED_SHIFTS: 13,
  PROTECT: 14, VIP: 15, RETIRE: 16, NOTE: 17,
};

// 旧列→新列マッピング（既存データ移行用）
const OLD_TO_NEW_MAPPING = {
  0: 0,   // staff_id → staff_id
  1: 1,   // 氏名 → 氏名
  2: 2,   // メールアドレス → メールアドレス
  3: 3,   // 電話番号 → 電話番号
  4: 4,   // 雇用形態 → 雇用形態
  5: 5,   // 国家資格 → 国家資格
  6: 6,   // 入社日 → 入社日
  7: 8,   // スタッフ区分 → スタッフ区分（新I列）
  8: 9,   // メイン施設名 → メイン施設名（新J列）
  9: 11,  // サブ施設候補 → サブ施設候補（新L列）
  10: 12, // シフト区分 → シフト区分（新M列）
  11: 13, // 許可シフト種別 → 許可シフト種別（新N列）
  12: 14, // 保護フラグ → 保護フラグ（新O列）
  13: 16, // 退職フラグ → 退職フラグ（新Q列）
  15: 17, // 備考 → 備考（新R列）
  16: 15, // VIPフラグ(旧Q) → VIPフラグ（新P列）
};

// ============================================
// メイン：18列構造に再構築
// ============================================
function setupM_Staff_v3() {
  Logger.log('🚀 M_スタッフ v3セットアップ開始');
  
  try {
    const ss = SpreadsheetApp.openById(STAFF_SS_ID);
    const sheet = ss.getSheetByName('M_スタッフ');
    
    // Step 1: 既存データをバックアップ
    Logger.log('📦 既存データ読み取り中...');
    const oldData = sheet.getDataRange().getValues();
    Logger.log('📊 既存行数: ' + oldData.length);
    
    // Step 2: 有効データのみ抽出（IDと氏名があるもの）
    const validRows = [];
    for (let i = 1; i < oldData.length; i++) {
      const row = oldData[i];
      if (row[0] && row[1]) {
        validRows.push(row);
      }
    }
    Logger.log('✅ 有効データ: ' + validRows.length + '件');
    
    // Step 3: 新列配置にマッピング
    const newRows = validRows.map(oldRow => {
      const newRow = new Array(18).fill('');
      for (const [oldIdx, newIdx] of Object.entries(OLD_TO_NEW_MAPPING)) {
        const val = oldRow[parseInt(oldIdx)];
        if (val !== null && val !== undefined && val !== '') {
          newRow[newIdx] = val;
        }
      }
      // 入社月数を自動計算してH列に入れる
      if (newRow[NEW_COL.HIRE_DATE] instanceof Date) {
        newRow[NEW_COL.HIRE_MONTHS] = calcMonthsBetween(newRow[NEW_COL.HIRE_DATE], new Date());
      }
      return newRow;
    });
    
    // Step 4: シートをクリア
    Logger.log('🗑️ シートクリア中...');
    if (sheet.getMaxRows() > 1) {
      sheet.getRange(2, 1, sheet.getMaxRows() - 1, sheet.getMaxColumns()).clearContent();
    }
    // 列数を18に調整
    if (sheet.getMaxColumns() < 18) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), 18 - sheet.getMaxColumns());
    } else if (sheet.getMaxColumns() > 18) {
      sheet.deleteColumns(19, sheet.getMaxColumns() - 18);
    }
    
    // Step 5: 新ヘッダー書き込み
    Logger.log('📝 新ヘッダー書き込み');
    sheet.getRange(1, 1, 1, 18).setValues([NEW_HEADERS]);
    sheet.getRange(1, 1, 1, 18).setFontWeight('bold').setBackground('#4a148c').setFontColor('#ffffff');
    
    // Step 6: データ書き戻し
    if (newRows.length > 0) {
      Logger.log('💾 データ書き戻し: ' + newRows.length + '件');
      sheet.getRange(2, 1, newRows.length, 18).setValues(newRows);
    }
    
    // Step 7: プルダウン・データ検証設定
    Logger.log('🎨 プルダウン設定');
    setupValidations(sheet);
    
    // Step 8: onEditトリガー設定
    Logger.log('⚡ onEditトリガー設定');
    setupOnEditTrigger();
    
    // Step 9: 月次トリガー設定
    Logger.log('📅 月次トリガー設定');
    setupMonthlyTrigger();
    
    Logger.log('🎉 セットアップ完了');
    return {
      success: true,
      migratedRows: newRows.length,
      totalColumns: 18
    };
    
  } catch (error) {
    Logger.log('❌ エラー: ' + error.toString());
    Logger.log('📍 スタック: ' + error.stack);
    return { success: false, error: error.toString() };
  }
}

// ============================================
// プルダウン・データ検証設定
// ============================================
function setupValidations(sheet) {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const unitSheet = ss.getSheetByName('M_ユニット');
  const unitData = unitSheet.getDataRange().getValues();
  
  // 施設名一覧(D列=インデックス3)を抽出
  const facilitySet = new Set();
  for (let i = 1; i < unitData.length; i++) {
    if (unitData[i][3]) facilitySet.add(unitData[i][3]);
  }
  const facilities = [...facilitySet].sort();
  Logger.log('🏢 施設数: ' + facilities.length);
  
  const maxRow = Math.max(sheet.getLastRow(), 100);
  
  // E列: 雇用形態
  setPulldown(sheet, 5, maxRow, ['正社員', 'パート']);
  
  // F列: 国家資格
  setPulldown(sheet, 6, maxRow, ['看護師', '']);
  
  // I列: スタッフ区分
  setPulldown(sheet, 9, maxRow, ['通常', '新人1ヶ月', '新人2ヶ月']);
  
  // J列: メイン施設名
  setPulldown(sheet, 10, maxRow, facilities);
  
  // K列: セカンド施設名(空欄可)
  setPulldown(sheet, 11, maxRow, ['', ...facilities]);
  
  // M列: シフト区分
  setPulldown(sheet, 13, maxRow, ['夜勤のみ', '日勤のみ', '両方']);
  
  // N列: 許可シフト種別(🆕 プルダウン追加)
  const shiftPatterns = [
    '夜勤A',
    '夜勤B',
    '夜勤C',
    '夜勤A,夜勤B',
    '夜勤A,夜勤C',
    '夜勤B,夜勤C',
    '夜勤A,夜勤B,夜勤C',
    '日勤早出',
    '日勤遅出',
    '日勤早出,日勤遅出',
    '夜勤A,夜勤B,夜勤C,日勤早出,日勤遅出',
  ];
  setPulldown(sheet, 14, maxRow, shiftPatterns);
  
  // O列: 保護フラグ
  setPulldown(sheet, 15, maxRow, ['TRUE', 'FALSE']);
  
  // P列: VIP重要フラグ
  setPulldown(sheet, 16, maxRow, ['TRUE', 'FALSE']);
  
  // Q列: 退職フラグ
  setPulldown(sheet, 17, maxRow, ['TRUE', 'FALSE']);
  
  // H列: 入社月数(編集不可の警告)
  const hireMonthsRange = sheet.getRange(2, 8, maxRow - 1, 1);
  hireMonthsRange.setBackground('#e0f2f1');
  hireMonthsRange.setNote('🤖 自動計算列。入社日(G列)から自動的に計算されます。');
}
// ============================================
// onEdit：入社日変更時に入社月数を自動計算
// ============================================
function onEditTrigger_HireMonths(e) {
  try {
    const sheet = e.range.getSheet();
    if (sheet.getName() !== 'M_スタッフ') return;
    
    const col = e.range.getColumn();
    const row = e.range.getRow();
    
    // G列（入社日）が編集されたら
    if (col === 7 && row > 1) {
      const hireDate = e.range.getValue();
      if (hireDate instanceof Date) {
        const months = calcMonthsBetween(hireDate, new Date());
        sheet.getRange(row, 8).setValue(months); // H列に書き込み
        Logger.log('📅 入社月数自動計算: 行' + row + ' = ' + months + 'ヶ月');
      } else if (!hireDate) {
        sheet.getRange(row, 8).setValue('');
      }
    }
  } catch (error) {
    Logger.log('❌ onEditエラー: ' + error.toString());
  }
}

function setupOnEditTrigger() {
  // 既存のonEditトリガーを削除
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'onEditTrigger_HireMonths') {
      ScriptApp.deleteTrigger(trigger);
    }
  }
  
  // 新しいonEditトリガーを作成
  ScriptApp.newTrigger('onEditTrigger_HireMonths')
    .forSpreadsheet(STAFF_SS_ID)
    .onEdit()
    .create();
  
  Logger.log('✅ onEditトリガー作成完了');
}

// ============================================
// 月次トリガー：毎月1日に全員の入社月数再計算
// ============================================
function monthlyRecalcHireMonths() {
  Logger.log('📅 月次: 入社月数一括再計算');
  
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('M_スタッフ');
  const data = sheet.getDataRange().getValues();
  const now = new Date();
  
  let updated = 0;
  for (let i = 1; i < data.length; i++) {
    const hireDate = data[i][NEW_COL.HIRE_DATE];
    if (hireDate instanceof Date) {
      const months = calcMonthsBetween(hireDate, now);
      if (data[i][NEW_COL.HIRE_MONTHS] !== months) {
        sheet.getRange(i + 1, 8).setValue(months);
        updated++;
      }
    }
  }
  
  Logger.log('✅ 更新件数: ' + updated);
  return updated;
}

function setupMonthlyTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'monthlyRecalcHireMonths') {
      ScriptApp.deleteTrigger(trigger);
    }
  }
  
  ScriptApp.newTrigger('monthlyRecalcHireMonths')
    .timeBased()
    .onMonthDay(1)
    .atHour(1)
    .create();
  
  Logger.log('✅ 月次トリガー作成完了');
}

// ============================================
// ユーティリティ：月数計算
// ============================================
function calcMonthsBetween(startDate, endDate) {
  if (!(startDate instanceof Date)) return 0;
  const months = (endDate.getFullYear() - startDate.getFullYear()) * 12 
               + (endDate.getMonth() - startDate.getMonth());
  return months >= 0 ? months : 0;
}

// ============================================
// 確認用：現在の列構造をチェック
// ============================================
function checkCurrentStructure() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('M_スタッフ');
  const data = sheet.getDataRange().getValues();
  
  Logger.log('📋 総行数: ' + data.length);
  Logger.log('📋 総列数: ' + (data[0] ? data[0].length : 0));
  Logger.log('📋 ヘッダー:');
  if (data[0]) {
    data[0].forEach((h, i) => {
      Logger.log('  ' + String.fromCharCode(65 + i) + '列 (idx=' + i + '): ' + (h || '(空)'));
    });
  }
  
  // 水野さんのデータ
  if (data.length > 1) {
    Logger.log('📋 水野永吉さんのデータ:');
    data[1].forEach((v, i) => {
      Logger.log('  ' + String.fromCharCode(65 + i) + ': ' + v);
    });
  }
}
// ============================================
// 復旧用：水野永吉さんのデータを正しい配置で再投入
// ============================================
function restoreMizunoData() {
  Logger.log('🔧 水野永吉さんのデータ復旧開始');
  
  try {
    const ss = SpreadsheetApp.openById(STAFF_SS_ID);
    const sheet = ss.getSheetByName('M_スタッフ');
    
    const hireDate = new Date(2021, 10, 1); // 2021年11月1日 (月は0始まりなので10=11月)
    const months = calcMonthsBetween(hireDate, new Date());
    
    const mizunoRow = [
      1,                                                     // A: staff_id
      '水野永吉',                                            // B: 氏名
      'mizuno@sikumys.co.jp',                                // C: メールアドレス
      '',                                                    // D: 電話番号
      '正社員',                                              // E: 雇用形態
      '',                                                    // F: 国家資格（空=なし）
      hireDate,                                              // G: 入社日
      months,                                                // H: 入社月数（自動計算値）
      '新人2ヶ月',                                           // I: スタッフ区分
      'EST東長崎',                                           // J: メイン施設名
      'リフレ要町',                                          // K: セカンド施設名（テスト用に設定）
      'ルーデンス東十条アネックス,ルーデンス上板橋E-st',      // L: サブ施設候補
      '夜勤のみ',                                            // M: シフト区分
      '夜勤A',                                               // N: 許可シフト種別
      'TRUE',                                                // O: 保護フラグ
      'TRUE',                                                // P: VIP重要フラグ
      'FALSE',                                               // Q: 退職フラグ
      ''                                                     // R: 備考
    ];
    
    // データ書き戻し
    sheet.getRange(2, 1, 1, 18).setValues([mizunoRow]);
    
    Logger.log('✅ 水野永吉さんのデータ復旧完了');
    Logger.log('📅 入社月数: ' + months + 'ヶ月');
    Logger.log('🏠 メイン: EST東長崎 / セカンド: リフレ要町');
    Logger.log('🎖️ VIP: TRUE / 保護: TRUE');
    
    return {
      success: true,
      months: months,
      data: {
        name: '水野永吉',
        main: 'EST東長崎',
        second: 'リフレ要町',
        sub: 'ルーデンス東十条アネックス,ルーデンス上板橋E-st',
        employment: '正社員',
        kubun: '新人2ヶ月',
        isVIP: true,
        isProtected: true
      }
    };
    
  } catch (error) {
    Logger.log('❌ 復旧エラー: ' + error.toString());
    return { success: false, error: error.toString() };
  }
}

// ============================================
// 復旧→確認を一括実行
// ============================================
function restoreAndCheck() {
  const restoreResult = restoreMizunoData();
  if (!restoreResult.success) return restoreResult;
  
  Logger.log('');
  Logger.log('📋 復旧後の構造確認:');
  checkCurrentStructure();
  
  return restoreResult;
}
// ============================================
// 診断：各列のプルダウン設定を全部表示
// ============================================
function diagnoseValidations() {
  Logger.log('🔍 プルダウン診断開始');
  
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('M_スタッフ');
  const lastRow = sheet.getLastRow();
  
  Logger.log('📊 シート行数: ' + lastRow);
  
  const expectedValidations = {
    1: {name: 'staff_id', expected: 'プルダウンなし'},
    2: {name: '氏名', expected: 'プルダウンなし'},
    3: {name: 'メールアドレス', expected: 'プルダウンなし'},
    4: {name: '電話番号', expected: 'プルダウンなし'},
    5: {name: '雇用形態', expected: '正社員/パート'},
    6: {name: '国家資格', expected: '看護師/空'},
    7: {name: '入社日', expected: 'プルダウンなし'},
    8: {name: '入社月数', expected: '自動計算(プルダウンなし)'},
    9: {name: 'スタッフ区分', expected: '通常/新人1ヶ月/新人2ヶ月'},
    10: {name: 'メイン施設名', expected: '施設12個'},
    11: {name: 'セカンド施設名', expected: '施設12個 + 空欄'},
    12: {name: 'サブ施設候補', expected: 'プルダウンなし(カンマ区切り)'},
    13: {name: 'シフト区分', expected: '夜勤のみ/日勤のみ/両方'},
    14: {name: '許可シフト種別', expected: 'プルダウンなし(カンマ区切り)'},
    15: {name: '保護フラグ', expected: 'TRUE/FALSE'},
    16: {name: 'VIP重要フラグ', expected: 'TRUE/FALSE'},
    17: {name: '退職フラグ', expected: 'TRUE/FALSE'},
    18: {name: '備考', expected: 'プルダウンなし'},
  };
  
  Logger.log('');
  Logger.log('📋 各列のプルダウン設定:');
  
  for (let col = 1; col <= 18; col++) {
    const letter = String.fromCharCode(64 + col);
    const expected = expectedValidations[col];
    const range = sheet.getRange(2, col);
    const validation = range.getDataValidation();
    
    let status;
    if (!validation) {
      status = '❌ なし';
    } else {
      const criteria = validation.getCriteriaType();
      const values = validation.getCriteriaValues();
      if (criteria === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) {
        const list = values[0];
        status = '✅ [' + list.slice(0, 3).join(', ') + (list.length > 3 ? '...' : '') + ']';
      } else {
        status = '⚠️ ' + criteria;
      }
    }
    
    Logger.log(`  ${letter}(${col}): ${expected.name}`);
    Logger.log(`    期待: ${expected.expected}`);
    Logger.log(`    実際: ${status}`);
  }
  
  return { success: true };
}

// ============================================
// 完全クリーン再構築：全プルダウンクリア→データ書き込み→プルダウン再設定
// ============================================
function cleanRebuildStaffSheet() {
  Logger.log('🚀 完全クリーン再構築開始');
  
  try {
    const ss = SpreadsheetApp.openById(STAFF_SS_ID);
    const sheet = ss.getSheetByName('M_スタッフ');
    
    // Step 1: データ範囲全体のデータ検証を完全クリア
    Logger.log('🗑️ Step 1: 全データ検証クリア');
    const maxRow = Math.max(sheet.getMaxRows(), 1000);
    const maxCol = sheet.getMaxColumns();
    sheet.getRange(1, 1, maxRow, maxCol).clearDataValidations();
    Logger.log('  クリア範囲: ' + maxRow + '行 × ' + maxCol + '列');
    
    // Step 2: データもクリア（2行目以降）
    Logger.log('🗑️ Step 2: 既存データクリア');
    if (maxRow > 1) {
      sheet.getRange(2, 1, maxRow - 1, maxCol).clearContent();
    }
    
    SpreadsheetApp.flush();
    
    // Step 3: 水野永吉さんのデータを書き込み（プルダウンなし状態）
    Logger.log('📝 Step 3: データ書き込み');
    const hireDate = new Date(2021, 10, 1);
    const months = calcMonthsBetween(hireDate, new Date());
    
    const mizunoRow = [
      1, '水野永吉', 'mizuno@sikumys.co.jp', '',
      '正社員', '',
      hireDate, months,
      '新人2ヶ月',
      'EST東長崎', 'リフレ要町', 'ルーデンス東十条アネックス,ルーデンス上板橋E-st',
      '夜勤のみ', '夜勤A',
      'TRUE', 'TRUE', 'FALSE', ''
    ];
    
    sheet.getRange(2, 1, 1, 18).setValues([mizunoRow]);
    SpreadsheetApp.flush();
    Logger.log('  書き込み完了');
    
    // Step 4: プルダウン再設定
    Logger.log('🎨 Step 4: プルダウン設定');
    setupValidations(sheet);
    SpreadsheetApp.flush();
    Logger.log('  プルダウン設定完了');
    
    // Step 5: 確認
    Logger.log('');
    Logger.log('📋 最終確認:');
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const row = data[1];
    
    for (let i = 0; i < 18; i++) {
      const letter = String.fromCharCode(65 + i);
      Logger.log(`  ${letter}: ${headers[i]} = ${row[i]}`);
    }
    
    Logger.log('');
    Logger.log('🎉 完全クリーン再構築完了');
    
    return { success: true, months: months };
    
  } catch (error) {
    Logger.log('❌ エラー: ' + error.toString());
    Logger.log('📍 スタック: ' + error.stack);
    return { success: false, error: error.toString() };
  }
}
// ============================================
// N列のプルダウンだけ即時反映（自己完結版）
// ============================================
function updateAllowedShiftsPulldown() {
  Logger.log('🔧 許可シフト種別プルダウン設定');
  
  try {
    const ss = SpreadsheetApp.openById(STAFF_SS_ID);
    const sheet = ss.getSheetByName('M_スタッフ');
    const maxRow = Math.max(sheet.getLastRow(), 100);
    
    const shiftPatterns = [
      '夜勤A', '夜勤B', '夜勤C',
      '夜勤A,夜勤B', '夜勤A,夜勤C', '夜勤B,夜勤C',
      '夜勤A,夜勤B,夜勤C',
      '日勤早出', '日勤遅出', '日勤早出,日勤遅出',
      '夜勤A,夜勤B,夜勤C,日勤早出,日勤遅出',
    ];
    
    // 直接データ検証を作成（setPulldown呼び出さない）
    const range = sheet.getRange(2, 14, maxRow - 1, 1);
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(shiftPatterns, true)
      .setAllowInvalid(false)
      .build();
    range.setDataValidation(rule);
    
    Logger.log('✅ プルダウン設定完了: ' + shiftPatterns.length + 'パターン');
    Logger.log('📋 パターン一覧:');
    shiftPatterns.forEach((p, i) => Logger.log('  ' + (i+1) + '. ' + p));
    
    return { success: true, patterns: shiftPatterns };
    
  } catch (error) {
    Logger.log('❌ エラー: ' + error.toString());
    return { success: false, error: error.toString() };
  }
}
// ============================================
// サブ施設候補(L列)プルダウン化
// 事業所別グループ + 個別施設 + 全施設 + 空欄
// ============================================
function updateSubFacilitiesPulldown() {
  Logger.log('🔧 サブ施設プルダウン設定開始');
  
  try {
    const ss = SpreadsheetApp.openById(STAFF_SS_ID);
    const staffSheet = ss.getSheetByName('M_スタッフ');
    const unitSheet = ss.getSheetByName('M_ユニット');
    const unitData = unitSheet.getDataRange().getValues();
    
    // 事業所別に施設をグルーピング
    const facByJigyosho = {};
    const allFacilitiesSet = new Set();
    
    for (let i = 1; i < unitData.length; i++) {
      const jigyosho = unitData[i][1];
      const facility = unitData[i][3];
      if (!jigyosho || !facility) continue;
      
      if (!facByJigyosho[jigyosho]) facByJigyosho[jigyosho] = new Set();
      facByJigyosho[jigyosho].add(facility);
      allFacilitiesSet.add(facility);
    }
    
    const allFacilities = [...allFacilitiesSet].sort();
    Logger.log('🏢 全施設数: ' + allFacilities.length);
    Logger.log('🏬 事業所数: ' + Object.keys(facByJigyosho).length);
    
    // パターン構築
    const patterns = [];
    
    // 1. 空欄(サブなし)
    patterns.push('');
    
    // 2. 全施設パターン
    patterns.push(allFacilities.join(','));
    
    // 3. 事業所別グループパターン
    const jigyoshoList = Object.keys(facByJigyosho).sort();
    for (const jigyosho of jigyoshoList) {
      const facs = [...facByJigyosho[jigyosho]].sort();
      if (facs.length > 1) {
        patterns.push(facs.join(','));
      }
    }
    
    // 4. 個別施設パターン
    for (const fac of allFacilities) {
      patterns.push(fac);
    }
    
    // 重複削除
    const uniquePatterns = [...new Set(patterns)];
    Logger.log('📋 生成パターン数: ' + uniquePatterns.length);
    
    // L列(12列目)にプルダウン設定 + リスト外入力も許可
    const maxRow = Math.max(staffSheet.getLastRow(), 100);
    const range = staffSheet.getRange(2, 12, maxRow - 1, 1);
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(uniquePatterns, true)
      .setAllowInvalid(true)   // リスト外の手動入力を許可
      .setHelpText('プルダウンから選択するか、施設名をカンマ区切りで手動入力してください')
      .build();
    range.setDataValidation(rule);
    
    Logger.log('');
    Logger.log('✅ 設定完了: ' + uniquePatterns.length + 'パターン');
    Logger.log('📋 パターン一覧:');
    uniquePatterns.forEach((p, i) => {
      const label = p === '' ? '(空欄 = サブなし)' : p;
      Logger.log('  ' + (i + 1) + '. ' + label);
    });
    
    return {
      success: true,
      patternCount: uniquePatterns.length,
      allFacilities: allFacilities.length,
      jigyoshoCount: jigyoshoList.length
    };
    
  } catch (error) {
    Logger.log('❌ エラー: ' + error.toString());
    return { success: false, error: error.toString() };
  }
}
// ============================================
// T_希望提出のスキーマを新構造に更新
// H: メイン施設 / I: セカンド施設 / J: サブ施設(カンマ区切り)
// ============================================
function updateRequestSheetSchema() {
  Logger.log('🚀 T_希望提出スキーマ更新開始');
  
  try {
    const ss = SpreadsheetApp.openById(STAFF_SS_ID);
    const sheet = ss.getSheetByName('T_希望提出');
    
    // 現状確認
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    Logger.log('📊 現状: ' + lastRow + '行 × ' + lastCol + '列');
    
    // Step 1: 既存データをクリア(テストデータなので消してOK)
    Logger.log('🗑️ 既存データクリア');
    if (lastRow > 1) {
      sheet.getRange(2, 1, lastRow - 1, sheet.getMaxColumns()).clearContent();
    }
    // データ検証もクリア
    sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).clearDataValidations();
    
    // Step 2: 列数を13に整える
    if (sheet.getMaxColumns() > 13) {
      sheet.deleteColumns(14, sheet.getMaxColumns() - 13);
    } else if (sheet.getMaxColumns() < 13) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), 13 - sheet.getMaxColumns());
    }
    
    // Step 3: 新ヘッダーを設定
    const newHeaders = [
      '提出ID',      // A
      '提出日時',    // B
      'staff_id',    // C
      '氏名',        // D
      '対象年月',    // E
      '希望日',      // F
      'シフト種別',  // G
      'メイン施設',  // H 🆕 (旧: 希望施設名1)
      'セカンド施設', // I 🆕 (旧: 希望施設名2)
      'サブ施設',    // J 🆕 (旧: 希望施設名3)
      'コメント',    // K
      '希望頻度タイプ', // L
      '希望頻度数',  // M
    ];
    sheet.getRange(1, 1, 1, 13).setValues([newHeaders]);
    sheet.getRange(1, 1, 1, 13).setFontWeight('bold').setBackground('#4a148c').setFontColor('#ffffff');
    
    SpreadsheetApp.flush();
    
    Logger.log('✅ T_希望提出スキーマ更新完了');
    Logger.log('');
    Logger.log('📋 新ヘッダー構造:');
    newHeaders.forEach((h, i) => {
      const letter = String.fromCharCode(65 + i);
      Logger.log('  ' + letter + '列 (idx=' + i + '): ' + h);
    });
    
    return { success: true, headers: newHeaders };
    
  } catch (error) {
    Logger.log('❌ エラー: ' + error.toString());
    return { success: false, error: error.toString() };
  }
}// ============================================
// M_施設に正式住所を一括投入
// ============================================
function fillRealAddresses() {
  Logger.log('🏢 本住所データ投入開始');
  
  try {
    const ss = SpreadsheetApp.openById(STAFF_SS_ID);
    let sheet = ss.getSheetByName('M_施設');
    
    // シートなければ作る
    if (!sheet) {
      sheet = ss.insertSheet('M_施設');
      const headers = ['施設名', '郵便番号', '住所', '最寄り駅', '備考'];
      sheet.getRange(1, 1, 1, 5).setValues([headers]);
      sheet.getRange(1, 1, 1, 5).setFontWeight('bold').setBackground('#4a148c').setFontColor('#ffffff');
      sheet.setColumnWidth(1, 200);
      sheet.setColumnWidth(2, 100);
      sheet.setColumnWidth(3, 380);
      sheet.setColumnWidth(4, 150);
      sheet.setColumnWidth(5, 200);
      Logger.log('🆕 M_施設シート作成');
    }
    
    // 12施設の正式住所データ
    const addressData = [
      ['ルーデンス新板橋Ⅱ',          '173-0004', '東京都板橋区板橋4-40-2 ルーデンス新板橋Ⅱ',          '', ''],
      ['ルーデンス東十条アネックス',  '115-0043', '東京都北区神谷2-9-9 ルーデンス東十条アネックス',      '', ''],
      ['ルーデンス東十条マキシブ',    '115-0043', '東京都北区神谷2-9-9 ルーデンス東十条マキシブ',        '', ''],
      ['ルーデンス本蓮沼',            '174-0052', '東京都板橋区蓮沼町83-8 ルーデンス本蓮沼',             '', ''],
      ['ルーデンス上板橋E-st',        '174-0071', '東京都板橋区常盤台4-30-7 ルーデンス上板橋EST1',       '', ''],
      ['ルーデンス板橋区役所前',      '173-0005', '東京都板橋区仲宿20-6 ルーデンス板橋区役所前',         '', ''],
      ['ルーデンス大泉学園前',        '178-0062', '東京都練馬区東大泉2-15-45 ルーデンス大泉学園前',      '', ''],
      ['リフレ要町',                  '171-0044', '東京都豊島区千早2-21-4 リフレ要町',                   '', ''],
      ['ルーデンス中野富士見町',      '166-0012', '東京都杉並区和田2-14-4 ルーデンス中野富士見町',       '', ''],
      ['EST東長崎',                   '170-0013', '東京都豊島区東池袋1-24-1',                           '', ''],
      ['ルーデンス立会川Ⅱ',           '140-0011', '東京都品川区東大井2-27-7 ルーデンス立会川Ⅱ',          '', ''],
      ['ルーデンス梅屋敷',            '143-0012', '東京都大田区大森東4-37-12 ルーデンス梅屋敷',          '', ''],
    ];
    
    // 既存データクリア
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.getRange(2, 1, lastRow - 1, 5).clearContent();
    }
    
    // 新データ投入
    sheet.getRange(2, 1, addressData.length, 5).setValues(addressData);
    
    Logger.log('✅ 投入完了: ' + addressData.length + '施設');
    addressData.forEach(row => {
      Logger.log('  ' + row[0] + ' (〒' + row[1] + ')');
      Logger.log('    → ' + row[2]);
    });
    
    return { success: true, count: addressData.length };
    
  } catch (error) {
    Logger.log('❌ エラー: ' + error.toString());
    return { success: false, error: error.toString() };
  }
}