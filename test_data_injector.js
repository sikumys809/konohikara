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
