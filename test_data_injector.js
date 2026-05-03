/**
 * test_data_injector.js
 * 自動配置テスト用のダミー希望データを投入
 *
 * 使い方:
 *   1. injectTestRequests('2026-06')  ← テストデータ投入
 *   2. UIで自動割当実行
 *   3. deleteTestRequests('2026-06')  ← テストデータ削除
 *
 * 仕組み:
 *   - T_希望提出シートにテストレコードを追加
 *   - request_id を 'TEST-' プレフィックスで識別
 *   - 削除時は 'TEST-' で始まる行のみ削除 (本物データは無傷)
 */

const TEST_PREFIX = 'TEST-';

// テスト用スタッフ (M_スタッフ staff_id 312/313/314 = 水野さんと同条件)
// 全員: メイン=リフレ要町 / セカンド=EST東長崎 / サブ=10施設 / 許可=5シフト
const TEST_STAFF = [
  {
    staff_id: '312',
    name: 'M_スタッフから取得',
    mainFac: 'リフレ要町',
    secondFac: 'EST東長崎',
    subFacs: 'ルーデンス新板橋Ⅱ,ルーデンス東十条アネックス,ルーデンス東十条マキシブ,ルーデンス本蓮沼,ルーデンス上板橋E-st,ルーデンス板橋区役所前,ルーデンス大泉学園前,ルーデンス中野富士見町,ルーデンス立会川Ⅱ,ルーデンス梅屋敷',
    allowedShifts: ['早出4h', '早出8h', '遅出4h', '遅出8h', '夜勤C']
  },
  {
    staff_id: '313',
    name: 'M_スタッフから取得',
    mainFac: 'リフレ要町',
    secondFac: 'EST東長崎',
    subFacs: 'ルーデンス新板橋Ⅱ,ルーデンス東十条アネックス,ルーデンス東十条マキシブ,ルーデンス本蓮沼,ルーデンス上板橋E-st,ルーデンス板橋区役所前,ルーデンス大泉学園前,ルーデンス中野富士見町,ルーデンス立会川Ⅱ,ルーデンス梅屋敷',
    allowedShifts: ['早出4h', '早出8h', '遅出4h', '遅出8h', '夜勤C']
  },
  {
    staff_id: '314',
    name: 'M_スタッフから取得',
    mainFac: 'リフレ要町',
    secondFac: 'EST東長崎',
    subFacs: 'ルーデンス新板橋Ⅱ,ルーデンス東十条アネックス,ルーデンス東十条マキシブ,ルーデンス本蓮沼,ルーデンス上板橋E-st,ルーデンス板橋区役所前,ルーデンス大泉学園前,ルーデンス中野富士見町,ルーデンス立会川Ⅱ,ルーデンス梅屋敷',
    allowedShifts: ['早出4h', '早出8h', '遅出4h', '遅出8h', '夜勤C']
  }
];

// テスト対象日 (1日〜5日まで提出)
const TEST_DAYS = [1, 2, 3, 4, 5];

/**
 * テスト希望データを T_希望提出 に投入
 * @param {string} targetYM e.g. '2026-06'
 */
function injectTestRequests(targetYM) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('T_希望提出');
  if (!sheet) {
    Logger.log('❌ T_希望提出 シートが見つかりません');
    return;
  }

  const now = new Date();
  const rows = [];
  let counter = 1;

  for (const staff of TEST_STAFF) {
    for (const day of TEST_DAYS) {
      const dateStr = targetYM + '-' + String(day).padStart(2, '0');
      // 各スタッフの allowedShifts 全部を希望として投入
      for (const shift of staff.allowedShifts) {
        const reqId = TEST_PREFIX + targetYM + '-' + staff.staff_id + '-' + day + '-' + shift;
        rows.push([
          reqId,                              // A: request_id
          now,                                // B: 提出日時
          staff.staff_id,                     // C: staff_id
          staff.name,                         // D: 氏名
          targetYM,                           // E: 対象年月
          dateStr,                            // F: 希望日
          shift,                              // G: シフト種別
          staff.mainFac,                      // H: メイン施設
          staff.secondFac,                    // I: セカンド施設
          staff.subFacs,                      // J: サブ施設
          'テストデータ',                     // K: コメント
          '月次合計',                         // L: 頻度タイプ
          8                                   // M: 頻度回数
        ]);
        counter++;
      }
    }
  }

  if (rows.length === 0) {
    Logger.log('⚠️ 投入データがありません');
    return;
  }

  // 一括書き込み
  const startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, rows.length, rows[0].length).setValues(rows);

  Logger.log('✅ テストデータ投入完了:');
  Logger.log('  - スタッフ数: ' + TEST_STAFF.length);
  Logger.log('  - テスト日数: ' + TEST_DAYS.length);
  Logger.log('  - 総レコード数: ' + rows.length + '件');
  Logger.log('  - 対象月: ' + targetYM);
  Logger.log('');
  Logger.log('次のステップ: 管理画面で「自動割当実行」を押してください');
  Logger.log('テスト終了後: deleteTestRequests("' + targetYM + '") で削除');
}

/**
 * テスト希望データを T_希望提出 から削除
 * 'TEST-' プレフィックスのレコードのみ削除 (本物データは無傷)
 * @param {string} targetYM e.g. '2026-06'
 */
function deleteTestRequests(targetYM) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('T_希望提出');
  if (!sheet) {
    Logger.log('❌ T_希望提出 シートが見つかりません');
    return;
  }

  const data = sheet.getDataRange().getValues();
  const rowsToDelete = [];

  // 後ろから検索して、削除する行番号を集める
  for (let i = data.length - 1; i >= 1; i--) {
    const reqId = String(data[i][0] || '');
    if (reqId.startsWith(TEST_PREFIX) && reqId.includes(targetYM)) {
      rowsToDelete.push(i + 1); // 1-indexed
    }
  }

  // 後ろから削除 (前から削除すると行番号がずれるため)
  for (const rowNum of rowsToDelete) {
    sheet.deleteRow(rowNum);
  }

  Logger.log('✅ テストデータ削除完了:');
  Logger.log('  - 削除レコード数: ' + rowsToDelete.length + '件');
  Logger.log('  - 対象月: ' + targetYM);

  // T_シフト確定シートのテスト配置結果も削除
  deleteTestShiftAssignments(targetYM);
}

/**
 * T_シフト確定シートからテストスタッフの配置結果を削除
 * @param {string} targetYM
 */
function deleteTestShiftAssignments(targetYM) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('T_シフト確定');
  if (!sheet) return;

  const testStaffIds = TEST_STAFF.map(s => String(s.staff_id));
  const data = sheet.getDataRange().getValues();
  const rowsToDelete = [];

  for (let i = data.length - 1; i >= 1; i--) {
    const ym = String(data[i][2] || '');     // C列: 対象年月
    const staffId = String(data[i][7] || ''); // H列: staff_id
    if (ym === targetYM && testStaffIds.includes(staffId)) {
      rowsToDelete.push(i + 1);
    }
  }

  for (const rowNum of rowsToDelete) {
    sheet.deleteRow(rowNum);
  }

  Logger.log('  - T_シフト確定からテスト配置削除: ' + rowsToDelete.length + '件');
}

/**
 * テストデータの状態を確認 (件数チェック)
 */
function checkTestRequests(targetYM) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('T_希望提出');
  if (!sheet) return;

  const data = sheet.getDataRange().getValues();
  let testCount = 0;
  let realCount = 0;

  for (let i = 1; i < data.length; i++) {
    const reqId = String(data[i][0] || '');
    const ym = String(data[i][4] || '');
    if (ym !== targetYM) continue;

    if (reqId.startsWith(TEST_PREFIX)) {
      testCount++;
    } else {
      realCount++;
    }
  }

  Logger.log('📊 ' + targetYM + ' のレコード数:');
  Logger.log('  - テストデータ (TEST-): ' + testCount + '件');
  Logger.log('  - 本物データ: ' + realCount + '件');
}

// ============================================================
// GASエディタから直接実行できるラッパー関数
// ============================================================

function inject_2026_06() {
  injectTestRequests('2026-06');
}

function delete_2026_06() {
  deleteTestRequests('2026-06');
}

function check_2026_06() {
  checkTestRequests('2026-06');
}

// ============================================================
// 日勤専用テストスタッフ 315/316/317 登録
// 312/313/314 と違い、夜勤一切なし、主職種=世話人、VIPなし
// 純粋に日勤エンジンの動作検証用
// ============================================================
function add_dayshift_only_staff() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('M_スタッフ');
  if (!sheet) { Logger.log('M_スタッフが見つからない'); return; }
  
  const data = sheet.getDataRange().getValues();
  const existingIds = {};
  for (let i = 1; i < data.length; i++) {
    existingIds[String(data[i][0]).trim()] = true;
  }
  
  const subFacs = 'EST東長崎,ルーデンス中野富士見町,ルーデンス新板橋Ⅱ,ルーデンス東十条アネックス,ルーデンス東十条マキシブ,ルーデンス本蓮沼,ルーデンス板橋区役所前,ルーデンス大泉学園前,ルーデンス立会川Ⅱ,ルーデンス梅屋敷';
  
  const newStaffs = [
    ['901', '日勤テスト1（テスト用）', 'dayshift1.test@example.com', '', '正社員', '', new Date('2025-07-01'), 9, '通常', 'リフレ要町', 'EST東長崎', subFacs, '日勤', '早出8h,早出4h,遅出8h,遅出4h', false, false, false, 'Day7テスト用・日勤専用', '', '世話人'],
    ['902', '日勤テスト2（テスト用）', 'dayshift2.test@example.com', '', '正社員', '', new Date('2025-07-01'), 9, '通常', 'リフレ要町', 'EST東長崎', subFacs, '日勤', '早出8h,早出4h,遅出8h,遅出4h', false, false, false, 'Day7テスト用・日勤専用', '', '世話人'],
    ['903', '日勤テスト3（テスト用）', 'dayshift3.test@example.com', '', '正社員', '', new Date('2025-07-01'), 9, '通常', 'リフレ要町', 'EST東長崎', subFacs, '日勤', '早出8h,早出4h,遅出8h,遅出4h', false, false, false, 'Day7テスト用・日勤専用', '', '世話人'],
  ];
  
  const toAdd = newStaffs.filter(function(s) { return !existingIds[s[0]]; });
  if (toAdd.length === 0) {
    Logger.log('全員既存、追加なし');
    return;
  }
  
  const startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, toAdd.length, 20).setValues(toAdd);
  
  Logger.log('追加: ' + toAdd.length + '名');
  toAdd.forEach(function(s) {
    Logger.log('  staff_id=' + s[0] + ' (' + s[1] + ')');
  });
  Logger.log('開始行: ' + startRow);
}

function delete_dayshift_only_staff() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('M_スタッフ');
  if (!sheet) { Logger.log('M_スタッフが見つからない'); return; }
  
  const targetIds = ['315', '316', '317'];
  const data = sheet.getDataRange().getValues();
  const rowsToDelete = [];
  
  for (let i = data.length - 1; i >= 1; i--) {
    if (targetIds.indexOf(String(data[i][0]).trim()) !== -1) {
      rowsToDelete.push(i + 1);
    }
  }
  
  rowsToDelete.forEach(function(r) { sheet.deleteRow(r); });
  Logger.log('削除: ' + rowsToDelete.length + '件');
}

function debug_check_315_317() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('M_スタッフ');
  const data = sheet.getDataRange().getValues();
  
  ['315', '316', '317'].forEach(function(id) {
    let found = false;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === id) {
        found = true;
        Logger.log('staff_id=' + id + ' 行' + (i+1));
        Logger.log('  B氏名: ' + data[i][1]);
        Logger.log('  J メイン: ' + data[i][9]);
        Logger.log('  K セカンド: ' + data[i][10]);
        Logger.log('  N 許可シフト: ' + data[i][13]);
        Logger.log('  T 主職種: ' + data[i][19]);
        Logger.log('  Q 退職: ' + data[i][16]);
        break;
      }
    }
    if (!found) Logger.log('staff_id=' + id + ' なし');
  });
}

function debug_check_901_903() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('M_スタッフ');
  const data = sheet.getDataRange().getValues();
  
  ['901', '902', '903'].forEach(function(id) {
    let found = false;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === id) {
        found = true;
        Logger.log('staff_id=' + id + ' 行' + (i+1));
        Logger.log('  B氏名: ' + data[i][1]);
        Logger.log('  J メイン: ' + data[i][9]);
        Logger.log('  K セカンド: ' + data[i][10]);
        Logger.log('  L サブ: ' + data[i][11]);
        Logger.log('  N 許可シフト: ' + data[i][13]);
        Logger.log('  Q 退職: ' + data[i][16]);
        Logger.log('  S 役割: ' + data[i][18]);
        Logger.log('  T 主職種: ' + data[i][19]);
        break;
      }
    }
    if (!found) Logger.log('staff_id=' + id + ' なし');
  });
}

function delete_test_staff_901_only() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('M_スタッフ');
  const data = sheet.getDataRange().getValues();
  const rowsToDelete = [];
  
  for (let i = data.length - 1; i >= 1; i--) {
    const id = String(data[i][0]).trim();
    if (['901', '902', '903'].indexOf(id) !== -1) {
      rowsToDelete.push(i + 1);
    }
  }
  
  rowsToDelete.forEach(function(r) { sheet.deleteRow(r); });
  Logger.log('削除: ' + rowsToDelete.length + '件');
}

function add_test_staff_skip_validation_columns() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('M_スタッフ');
  if (!sheet) { Logger.log('M_スタッフが見つからない'); return; }
  
  const data = sheet.getDataRange().getValues();
  const existingIds = {};
  for (let i = 1; i < data.length; i++) {
    existingIds[String(data[i][0]).trim()] = true;
  }
  
  const subFacs = 'EST東長崎,ルーデンス中野富士見町,ルーデンス新板橋Ⅱ,ルーデンス東十条アネックス,ルーデンス東十条マキシブ,ルーデンス本蓮沼,ルーデンス板橋区役所前,ルーデンス大泉学園前,ルーデンス立会川Ⅱ,ルーデンス梅屋敷';
  
  const targets = [
    {id: '901', name: '日勤テスト1（テスト用）'},
    {id: '902', name: '日勤テスト2（テスト用）'},
    {id: '903', name: '日勤テスト3（テスト用）'},
  ];
  
  let added = 0;
  targets.forEach(function(t) {
    if (existingIds[t.id]) {
      Logger.log('skip: ' + t.id + ' 既存');
      return;
    }
    const newRow = sheet.getLastRow() + 1;
    sheet.getRange(newRow, 1).setValue(t.id);
    sheet.getRange(newRow, 2).setValue(t.name);
    sheet.getRange(newRow, 3).setValue('test' + t.id + '@example.com');
    sheet.getRange(newRow, 5).setValue('正社員');
    sheet.getRange(newRow, 7).setValue(new Date('2025-07-01'));
    sheet.getRange(newRow, 8).setValue(9);
    sheet.getRange(newRow, 9).setValue('通常');
    sheet.getRange(newRow, 10).setValue('リフレ要町');
    sheet.getRange(newRow, 11).setValue('EST東長崎');
    sheet.getRange(newRow, 12).setValue(subFacs);
    sheet.getRange(newRow, 13).setValue('日勤');
    sheet.getRange(newRow, 14).setValue('早出8h,早出4h,遅出8h,遅出4h');
    sheet.getRange(newRow, 15).setValue(false);
    sheet.getRange(newRow, 16).setValue(false);
    sheet.getRange(newRow, 17).setValue(false);
    sheet.getRange(newRow, 18).setValue('Day7テスト用・日勤専用');
    added++;
    Logger.log('追加: ' + t.id + ' 行' + newRow);
  });
  
  Logger.log('合計追加: ' + added + '件');
  Logger.log('');
  Logger.log('★手動でT列(主職種)に「世話人」を901/902/903の3行に入力してください');
}

// ============================================================
// 日勤専用テスト: 901/902/903 が 6/1〜6/10 早出8h を希望
// 30件投入 (3スタッフ × 10日 × 1シフト)
// ============================================================
function inject_dayshift_only_2026_06() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('T_希望提出');
  if (!sheet) { Logger.log('T_希望提出 シートが見つかりません'); return; }

  const targetYM = '2026-06';
  const subFacs = 'EST東長崎,ルーデンス中野富士見町,ルーデンス新板橋Ⅱ,ルーデンス東十条アネックス,ルーデンス東十条マキシブ,ルーデンス本蓮沼,ルーデンス板橋区役所前,ルーデンス大泉学園前,ルーデンス立会川Ⅱ,ルーデンス梅屋敷';
  
  const targets = [
    {id: '901', name: '日勤テスト1（テスト用）'},
    {id: '902', name: '日勤テスト2（テスト用）'},
    {id: '903', name: '日勤テスト3（テスト用）'},
  ];
  
  const days = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const shift = '早出8h';
  const now = new Date();
  
  const rows = [];
  targets.forEach(function(t) {
    days.forEach(function(d) {
      const dateStr = targetYM + '-' + String(d).padStart(2, '0');
      const reqId = 'TEST-' + targetYM + '-' + t.id + '-' + d + '-' + shift;
      rows.push([
        reqId,
        now,
        t.id,
        t.name,
        targetYM,
        dateStr,
        shift,
        'リフレ要町',
        'EST東長崎',
        subFacs,
        '日勤専用テスト',
        '月次合計',
        10,
      ]);
    });
  });
  
  const startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, rows.length, rows[0].length).setValues(rows);
  
  Logger.log('投入: ' + rows.length + '件');
  Logger.log('対象月: ' + targetYM);
  Logger.log('スタッフ: 901/902/903');
  Logger.log('日: 6/1〜6/10');
  Logger.log('シフト: 早出8h');
}

function delete_dayshift_only_2026_06() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('T_希望提出');
  if (!sheet) return;
  
  const targetIds = ['901', '902', '903'];
  const data = sheet.getDataRange().getValues();
  const rowsToDelete = [];
  
  for (let i = data.length - 1; i >= 1; i--) {
    const reqId = String(data[i][0] || '');
    const staffId = String(data[i][2] || '').trim();
    const ym = String(data[i][4] || '');
    if (reqId.indexOf('TEST-') === 0 && targetIds.indexOf(staffId) !== -1 && ym === '2026-06') {
      rowsToDelete.push(i + 1);
    }
  }
  
  rowsToDelete.forEach(function(r) { sheet.deleteRow(r); });
  Logger.log('削除: ' + rowsToDelete.length + '件');
  
  // T_シフト確定からも削除
  const confSheet = ss.getSheetByName('T_シフト確定');
  if (confSheet) {
    const cdata = confSheet.getDataRange().getValues();
    const cToDelete = [];
    for (let i = cdata.length - 1; i >= 1; i--) {
      const ym = String(cdata[i][2] || '');
      const staffId = String(cdata[i][7] || '');
      if (ym === '2026-06' && targetIds.indexOf(staffId) !== -1) {
        cToDelete.push(i + 1);
      }
    }
    cToDelete.forEach(function(r) { confSheet.deleteRow(r); });
    Logger.log('T_シフト確定削除: ' + cToDelete.length + '件');
  }
}

function debug_check_901_903_final() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('M_スタッフ');
  const data = sheet.getDataRange().getValues();
  
  ['901', '902', '903'].forEach(function(id) {
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === id) {
        Logger.log(id + ': T主職種="' + data[i][19] + '" / N許可="' + data[i][13] + '" / J="' + data[i][9] + '"');
        break;
      }
    }
  });
}
