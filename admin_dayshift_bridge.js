// ============================================================
// Step 5-1: 管理画面から日勤エンジンを実行するブリッジ関数
// - 既存の AdminApp_Code.gs は触らずに独立ファイルとして追加
// - Admin.html から google.script.run.executeDayShiftEngineFromAdmin() で呼ばれる
// ============================================================

/**
 * 管理画面から日勤エンジン + 充足率レポートを連続実行
 *
 * @param {string|number} adminStaffId - 実行者のstaff_id
 * @param {string} yearMonth - "YYYY-MM"
 * @return {Object} { success, placed, skipped, elapsed, fulfillment }
 */
function executeDayShiftEngineFromAdmin(adminStaffId, yearMonth) {
  try {
    // ① 権限チェック（シフト作成ロール必須）
    const authCheck = _checkDayShiftExecPermission(adminStaffId);
    if (!authCheck.ok) {
      return { success: false, message: authCheck.message };
    }

    // ② 年月バリデーション
    if (!yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) {
      return { success: false, message: '対象年月の形式が不正です（YYYY-MM）' };
    }

    const startTs = Date.now();
    Logger.log(`========== [管理画面経由] 日勤エンジン実行 ==========`);
    Logger.log(`実行者: staff_id=${adminStaffId} / ${authCheck.name}`);
    Logger.log(`対象年月: ${yearMonth}`);

    // ③ エンジン実行
    const engineResult = runDayShiftEngine(yearMonth);

    // ④ 充足率レポート生成
    generateDayShiftFulfillmentReport(yearMonth);

    // ⑤ 充足率サマリ取得（画面表示用）
    const fulfillmentSummary = _extractFulfillmentSummary(yearMonth);

    // ⑥ 操作ログ記録
    _recordDayShiftExecutionLog(adminStaffId, authCheck.name, yearMonth, engineResult, fulfillmentSummary);

    const elapsed = ((Date.now() - startTs) / 1000).toFixed(1);

    return {
      success: true,
      yearMonth: yearMonth,
      placed: engineResult.placed,
      skipped: engineResult.skipped,
      elapsed: elapsed,
      fulfillment: fulfillmentSummary,
      message: `${yearMonth} の日勤自動割当が完了しました（${engineResult.placed}件配置 / ${engineResult.skipped}件スキップ）`
    };
  } catch (e) {
    Logger.log('❌ 日勤エンジン実行エラー: ' + e.message);
    Logger.log(e.stack);
    return { success: false, message: 'エラー: ' + e.message };
  }
}

/**
 * 権限チェック（シフト作成ロール）
 */
function _checkDayShiftExecPermission(staffId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('M_スタッフ');
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 19).getValues();

  const targetId = String(staffId).trim();
  for (const row of data) {
    if (String(row[0]).trim() !== targetId) continue;

    const retired = String(row[16] || '').toUpperCase() === 'TRUE';
    if (retired) {
      return { ok: false, message: '退職済みアカウントです' };
    }

    const role = String(row[18] || '');  // S列: 役割
    if (role.indexOf('シフト作成') === -1) {
      return { ok: false, message: '「シフト作成」ロールが必要です' };
    }

    return { ok: true, name: row[1] };
  }

  return { ok: false, message: '指定されたスタッフIDが見つかりません' };
}

/**
 * V_日勤充足 シートから事業所別サマリを取得
 */
function _extractFulfillmentSummary(yearMonth) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('V_日勤充足');
  if (!sheet) return [];

  const lastRow = sheet.getLastRow();
  if (lastRow < 6) return [];

  // 6行目以降がデータ行（1-2:タイトル、4-5:ヘッダー2段）
  const data = sheet.getRange(6, 1, lastRow - 5, 17).getValues();

  return data.map(row => ({
    facility: row[0],
    capacity: row[1],
    // 特定加配(世+生)
    tokuteiNeed: row[2],
    tokuteiActual: row[3],
    tokuteiRate: row[4],
    // 世話人
    sewaNeed: row[5],
    sewaActual: row[6],
    sewaRate: row[7],
    // 生活支援員
    seikatsuNeed: row[8],
    seikatsuActual: row[9],
    seikatsuRate: row[10],
    // サビ管
    sabikanNeed: row[11],
    sabikanActual: row[12],
    sabikanRate: row[13],
    // 看護師
    nurseNeed: row[14],
    nurseActual: row[15],
    nurseJudge: row[16]
  }));
}

/**
 * 操作ログ記録
 */
function _recordDayShiftExecutionLog(staffId, staffName, yearMonth, engineResult, fulfillment) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('T_操作ログ');
  if (!sheet) return;

  const logId = 'LOG_' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd_HHmmss') + '_' + Math.random().toString(36).slice(2, 8);
  const now = new Date();

  // 充足率サマリを文字列化
  const summaryStr = (fulfillment || []).map(f =>
    `${f.facility}(特定${f.tokuteiRate}/サビ管${f.sabikanRate}/看護${f.nurseJudge})`
  ).join(' | ');

  const memo = `配置:${engineResult.placed}件 / スキップ:${engineResult.skipped}件 / 実行時間:${engineResult.elapsed}秒`;
  const afterDetail = `充足率サマリ: ${summaryStr}`;

  // 役割を取得（ログに記録）
  const staffSheet = ss.getSheetByName('M_スタッフ');
  const staffData = staffSheet.getRange(2, 1, staffSheet.getLastRow() - 1, 19).getValues();
  let role = '';
  for (const row of staffData) {
    if (String(row[0]).trim() === String(staffId).trim()) {
      role = String(row[18] || '');
      break;
    }
  }

  sheet.appendRow([
    logId,
    now,
    String(staffId),
    staffName,
    role,
    '日勤自動割当実行',  // 操作種別
    'T_シフト確定',       // 対象
    yearMonth,            // 対象ID
    '',                   // 変更前
    afterDetail,          // 変更後
    memo
  ]);
}

/**
 * 管理画面から呼ばれる: 対象年月リスト取得（シフト作成画面と同じリストを返す）
 * 既存の getAvailableTargetYMs が同じことをしてるなら、そちらを使えばいい
 * （Admin.html で既にその関数を使っているので、こちらは追加不要だが、保険として実装）
 */
function getDayShiftTargetYMs(adminStaffId) {
  try {
    // 権限チェック
    const auth = _checkDayShiftExecPermission(adminStaffId);
    if (!auth.ok) return { success: false, message: auth.message };

    // 今月 + 来月 + 翌々月（YYYY-MM）
    const now = new Date();
    const yms = [];
    for (let offset = 0; offset <= 2; offset++) {
      const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      yms.push(Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM'));
    }

    // デフォルトは来月
    const defaultYM = yms[1] || yms[0];

    return { success: true, yms, defaultYM };
  } catch (e) {
    return { success: false, message: 'エラー: ' + e.message };
  }
}
/**
 * ダッシュボード用: 充足率サマリを返す
 * V_日勤充足シートから読み取る
 */
function getDayShiftFulfillmentSummary(adminStaffId, yearMonth) {
  try {
    const auth = _checkDayShiftExecPermission(adminStaffId);
    if (!auth.ok) throw new Error(auth.message);

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('V_日勤充足');
    if (!sheet) {
      throw new Error('V_日勤充足シートが未生成');
    }

    // シートのタイトル行から対象年月を確認
    const title = String(sheet.getRange(1, 1).getValue());
    if (title.indexOf(yearMonth) === -1) {
      throw new Error('対象年月のデータではない: ' + title);
    }

    return _extractFulfillmentSummary(yearMonth);
  } catch (e) {
    Logger.log('getDayShiftFulfillmentSummary エラー: ' + e.message);
    throw e;  // withFailureHandler で拾う
  }
}