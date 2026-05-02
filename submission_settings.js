// ============================================================
// 提出期間設定 API (M_設定 シート ベース)
// ============================================================

const SETTINGS_SHEET_NAME = 'M_設定';
const DEFAULT_SUBMIT_START_DAY = 10;
const DEFAULT_SUBMIT_END_DAY = 22;

/**
 * 提出期間設定を取得
 * @returns {{startDay: number, endDay: number}}
 */
function getSubmissionPeriod() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SETTINGS_SHEET_NAME);
    if (!sheet || sheet.getLastRow() < 2) {
      return { startDay: DEFAULT_SUBMIT_START_DAY, endDay: DEFAULT_SUBMIT_END_DAY };
    }
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
    const settings = {};
    data.forEach(function(row) {
      if (row[0]) settings[String(row[0]).trim()] = row[1];
    });
    const startDay = parseInt(settings['submission_start_day']) || DEFAULT_SUBMIT_START_DAY;
    const endDay = parseInt(settings['submission_end_day']) || DEFAULT_SUBMIT_END_DAY;
    
    // バリデーション (1〜31, start <= end)
    if (startDay < 1 || startDay > 31 || endDay < 1 || endDay > 31 || startDay > endDay) {
      Logger.log('getSubmissionPeriod: 不正な値検出、デフォルト値を返す');
      return { startDay: DEFAULT_SUBMIT_START_DAY, endDay: DEFAULT_SUBMIT_END_DAY };
    }
    return { startDay: startDay, endDay: endDay };
  } catch (e) {
    Logger.log('getSubmissionPeriod エラー: ' + e.message);
    return { startDay: DEFAULT_SUBMIT_START_DAY, endDay: DEFAULT_SUBMIT_END_DAY };
  }
}

/**
 * 提出期間設定を更新 (canApprove 必須)
 * @param {string} adminStaffId
 * @param {number} startDay
 * @param {number} endDay
 * @returns {{success: bool, message: string}}
 */
function updateSubmissionPeriod(adminStaffId, startDay, endDay) {
  try {
    // 権限チェック (canApprove)
    const admin = _getAdminInfo(adminStaffId);
    if (!admin) return { success: false, message: '管理者として認証されていません' };
    if (!admin.canApprove) return { success: false, message: '権限がありません (最終承認者のみ)' };
    
    // バリデーション
    const sd = parseInt(startDay);
    const ed = parseInt(endDay);
    if (isNaN(sd) || isNaN(ed)) return { success: false, message: '数値で入力してください' };
    if (sd < 1 || sd > 31) return { success: false, message: '開始日は1〜31の範囲で入力してください' };
    if (ed < 1 || ed > 31) return { success: false, message: '終了日は1〜31の範囲で入力してください' };
    if (sd > ed) return { success: false, message: '開始日は終了日以前にしてください' };
    
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SETTINGS_SHEET_NAME);
    if (!sheet) {
      // シート新規作成
      sheet = ss.insertSheet(SETTINGS_SHEET_NAME);
      sheet.getRange(1, 1, 1, 3).setValues([['key', 'value', 'description']]);
      sheet.getRange(1, 1, 1, 3).setBackground('#4a148c').setFontColor('#ffffff').setFontWeight('bold');
      sheet.setFrozenRows(1);
      sheet.setColumnWidth(1, 200);
      sheet.setColumnWidth(2, 100);
      sheet.setColumnWidth(3, 350);
    }
    
    // 既存設定を取得して、対象キーを更新 or 追加
    const lastRow = sheet.getLastRow();
    const data = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, 1).getValues() : [];
    
    let startRow = -1, endRow = -1;
    for (let i = 0; i < data.length; i++) {
      const k = String(data[i][0]).trim();
      if (k === 'submission_start_day') startRow = i + 2;
      if (k === 'submission_end_day') endRow = i + 2;
    }
    
    // 開始日を書き込み
    if (startRow > 0) {
      sheet.getRange(startRow, 2).setValue(sd);
    } else {
      const newRow = sheet.getLastRow() + 1;
      sheet.getRange(newRow, 1, 1, 3).setValues([['submission_start_day', sd, '提出受付開始日 (前月のN日)']]);
    }
    
    // 終了日を書き込み
    if (endRow > 0) {
      sheet.getRange(endRow, 2).setValue(ed);
    } else {
      const newRow = sheet.getLastRow() + 1;
      sheet.getRange(newRow, 1, 1, 3).setValues([['submission_end_day', ed, '提出受付終了日 (前月のN日)']]);
    }
    
    // ログ記録
    if (typeof logAdminOperation === 'function') {
      logAdminOperation(adminStaffId, admin.name, '提出期間設定変更', '設定', 'submission_period',
        '', JSON.stringify({ startDay: sd, endDay: ed }), '前月' + sd + '日〜' + ed + '日');
    }
    
    return {
      success: true,
      message: '✓ 提出期間を「前月' + sd + '日〜' + ed + '日」に変更しました',
      startDay: sd,
      endDay: ed
    };
  } catch (e) {
    Logger.log('updateSubmissionPeriod エラー: ' + e.message + '\n' + e.stack);
    return { success: false, message: 'エラー: ' + e.message };
  }
}

/**
 * 管理者情報取得 (内部ヘルパー)
 * 役割は M_スタッフ S列 (18) にカンマ区切りで保存されている
 *   例: "シフト作成,マスタ編集,最終承認"
 */
function _getAdminInfo(staffId) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('M_スタッフ');
    if (!sheet || sheet.getLastRow() < 2) return null;
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 19).getValues();
    const sid = String(staffId).trim();
    for (const row of data) {
      if (String(row[0]).trim() !== sid) continue;
      
      const retired = String(row[16] || '').toUpperCase() === 'TRUE';
      if (retired) return null;
      
      const role = String(row[18] || '');  // S列: 役割
      return {
        staff_id: sid,
        name: String(row[1] || ''),
        roles: role,
        canApprove: role.indexOf('最終承認') !== -1,
        canEditMaster: role.indexOf('マスタ編集') !== -1,
        canShiftCreate: role.indexOf('シフト作成') !== -1
      };
    }
    return null;
  } catch (e) {
    Logger.log('_getAdminInfo エラー: ' + e.message);
    return null;
  }
}

/**
 * テスト関数
 */
function testSubmissionPeriod() {
  Logger.log('=== getSubmissionPeriod ===');
  const cur = getSubmissionPeriod();
  Logger.log('現在の設定: ' + JSON.stringify(cur));
  
  Logger.log('');
  Logger.log('=== updateSubmissionPeriod (staff_id=13 で 12〜25 に変更) ===');
  const res = updateSubmissionPeriod('13', 12, 25);
  Logger.log('結果: ' + JSON.stringify(res));
  
  Logger.log('');
  Logger.log('=== 再取得 ===');
  Logger.log('変更後: ' + JSON.stringify(getSubmissionPeriod()));
  
  Logger.log('');
  Logger.log('=== 元に戻す (10〜22) ===');
  const res2 = updateSubmissionPeriod('13', 10, 25);
  Logger.log('結果: ' + JSON.stringify(res2));
}
