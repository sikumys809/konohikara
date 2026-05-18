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
    const engineResult = runDayShiftEngineV2(yearMonth);

    // ④ 充足率レポート生成
    generateDayShiftFulfillmentReportV2(yearMonth);

    // ⑤ 充足率サマリ取得（画面表示用）
    const fulfillmentSummary = _extractFulfillmentSummary(yearMonth);

    // ⑥ 操作ログ記録
    _recordDayShiftExecutionLog(adminStaffId, authCheck.name, yearMonth, engineResult, fulfillmentSummary);

    const elapsed = ((Date.now() - startTs) / 1000).toFixed(1);

    const placedCount = engineResult.placedCount || 0;
    const skippedCount = (engineResult.warningBlockCount || 0) + (engineResult.unassignedCount || 0);

    return {
      success: true,
      yearMonth: yearMonth,
      placed: placedCount,
      skipped: skippedCount,
      elapsed: elapsed,
      fulfillment: fulfillmentSummary,
      message: `${yearMonth} の日勤自動割当が完了しました（${placedCount}件配置 / ${skippedCount}件スキップ）`
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
 * V_日勤充足 シートから事業所別サマリを取得 (V2: 20列構造)
 * 行7〜データ実体、20列。生成側: generateDayShiftFulfillmentReportV2
 */
function _extractFulfillmentSummary(yearMonth) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('V_日勤充足');
  if (!sheet) return [];

  const lastRow = sheet.getLastRow();
  if (lastRow < 7) return [];

  // V2構造: 7行目以降がデータ行、20列
  const data = sheet.getRange(7, 1, lastRow - 6, 20).getValues();

  return data.map(row => ({
    facility: row[0],
    capacity: row[1],
    tokuteiNeed: row[2],
    tokuteiActual: row[3],
    tokuteiRate: row[4],
    sewaNeed: row[5],
    sewaActual: row[6],
    sewaRate: row[7],
    seikatsuNeed: row[8],
    seikatsuActual: row[9],
    seikatsuRate: row[10],
    sabikanNeed: row[11],
    sabikanActual: row[12],
    sabikanRate: row[13],
    kanrishaNeed: row[14],
    kanrishaActual: row[15],
    kanrishaRate: row[16],
    nurseNeed: row[17],
    nurseActual: row[18],
    nurseJudge: row[19]
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

// ============ ★Day14 P4: runFinalValidation Webラッパー ============
// フロントから呼び出して最終検証結果を返す
function runFinalValidationFromAdmin(adminStaffId, yearMonth) {
  try {
    // 権限チェック
    const permCheck = _checkDayShiftExecPermission(adminStaffId);
    if (!permCheck.ok) {
      return { success: false, message: permCheck.message };
    }
    
    // common_constraints.js の runFinalValidation を呼び出し
    const result = runFinalValidation(yearMonth);
    return result;
  } catch (e) {
    Logger.log('runFinalValidationFromAdmin エラー: ' + e.message);
    return { success: false, message: e.message };
  }
}


// ============================================================
// ★Day16: シフト確定画面用サマリー取得
// - 夜勤: 配置件数 / 期待枠 (= ユニット数 × 月日数)
// - 日勤: V_日勤充足 から事業所別充足率を取得 (既存 _extractFulfillmentSummary 流用)
// ============================================================
function getApprovalSummary(yearMonth) {
  try {
    if (!yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) {
      return { success: false, message: 'yearMonth形式不正 (YYYY-MM)' };
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const [yStr, mStr] = yearMonth.split('-');
    const year = parseInt(yStr, 10);
    const month = parseInt(mStr, 10);
    const daysInMonth = new Date(year, month, 0).getDate();

    // ① ユニット数 (M_ユニットのヘッダー除いた行数)
    const unitSheet = ss.getSheetByName('M_ユニット');
    const unitCount = unitSheet ? Math.max(0, unitSheet.getLastRow() - 1) : 0;
    const nightExpected = unitCount * daysInMonth;

    // ② T_シフト確定 から対象月の夜勤A/B/C件数を集計
    const NIGHT_SHIFTS = ['夜勤A', '夜勤B', '夜勤C'];
    const shiftSheet = ss.getSheetByName('T_シフト確定');
    let nightPlaced = 0;
    let nightConfirmed = 0;
    if (shiftSheet) {
      const last = shiftSheet.getLastRow();
      if (last > 1) {
        const data = shiftSheet.getRange(2, 1, last - 1, 19).getValues();
        for (let i = 0; i < data.length; i++) {
          const row = data[i];
          const date = row[1];
          if (!(date instanceof Date)) continue;
          if (date.getFullYear() !== year || date.getMonth() !== month - 1) continue;
          const shiftType = String(row[8] || '');
          if (NIGHT_SHIFTS.indexOf(shiftType) === -1) continue;
          nightPlaced++;
          if (String(row[12] || '') === '確定') nightConfirmed++;
        }
      }
    }
    const nightRate = nightExpected > 0
      ? Math.round((nightPlaced / nightExpected) * 1000) / 10
      : 0;

    // ③ 日勤: 既存関数で V_日勤充足 から事業所別サマリ取得
    const dayFulfillment = _extractFulfillmentSummary(yearMonth);

    return {
      success: true,
      yearMonth: yearMonth,
      night: {
        placed: nightPlaced,
        confirmed: nightConfirmed,
        expected: nightExpected,
        rate: nightRate,
        unitCount: unitCount,
        daysInMonth: daysInMonth
      },
      day: {
        fulfillment: dayFulfillment
      }
    };
  } catch (e) {
    Logger.log('getApprovalSummary error: ' + e.message + '\n' + e.stack);
    return { success: false, message: e.message };
  }
}


// ============================================================
// ★Day16: 看護師の事業所別配置詳細を取得
// - F列(国家資格)に「看護師」を含むスタッフを抽出
// - T_シフト確定 から対象月の dayHours>0 レコードを集計
// - 必要人数は M_事業所配置基準 G列
// 戻り値:
//   { success, yearMonth, jigyoshoList: [{ jigyosho, required, nurseCount, judge,
//     nurses: [{ staff_id, staff_name, days: [{ date, facility, shift }] }] }] }
// ============================================================
function getNurseAssignmentDetails(yearMonth) {
  try {
    if (!yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) {
      return { success: false, message: 'yearMonth形式不正 (YYYY-MM)' };
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const [yStr, mStr] = yearMonth.split('-');
    const year = parseInt(yStr, 10);
    const month = parseInt(mStr, 10);

    // ① M_スタッフ から看護師 (F列に「看護師」含む) を抽出
    const staffSheet = ss.getSheetByName('M_スタッフ');
    if (!staffSheet) return { success: false, message: 'M_スタッフが見つかりません' };
    const sLast = staffSheet.getLastRow();
    const staffData = sLast > 1 ? staffSheet.getRange(2, 1, sLast - 1, 6).getValues() : [];
    const nurseMap = {};  // staff_id → name
    staffData.forEach(function(row) {
      const sid = String(row[0] || '').trim();
      const name = String(row[1] || '').trim();
      const qual = String(row[5] || '');  // F列(0始まり=5)
      if (sid && qual.indexOf('看護師') !== -1) {
        nurseMap[sid] = name;
      }
    });

    // ② M_事業所配置基準 から事業所 + 必要看護師数 (G列=6)
    const basisSheet = ss.getSheetByName('M_事業所配置基準');
    const basisLast = basisSheet ? basisSheet.getLastRow() : 0;
    const basisData = basisLast > 1 ? basisSheet.getRange(2, 1, basisLast - 1, 8).getValues() : [];
    const jigyoshoOrder = [];
    const requiredMap = {};  // jigyosho → required
    basisData.forEach(function(row) {
      const jig = String(row[0] || '').trim();
      const required = Number(row[6]) || 0;
      if (jig) {
        jigyoshoOrder.push(jig);
        requiredMap[jig] = required;
      }
    });

    // ③ T_シフト確定 から対象月の dayHours>0 レコードを集計
    const shiftSheet = ss.getSheetByName('T_シフト確定');
    const accum = {};  // jigyosho → staff_id → { name, days: [{date,facility,shift}] }
    const uniqueNursesByJig = {};  // jigyosho → Set<staff_id>
    if (shiftSheet) {
      const last = shiftSheet.getLastRow();
      if (last > 1) {
        const data = shiftSheet.getRange(2, 1, last - 1, 19).getValues();
        for (let i = 0; i < data.length; i++) {
          const row = data[i];
          const date = row[1];
          if (!(date instanceof Date)) continue;
          if (date.getFullYear() !== year || date.getMonth() !== month - 1) continue;
          const dayHours = parseFloat(row[17]) || 0;
          if (dayHours <= 0) continue;  // 日勤帯貢献なし → スキップ
          const sid = String(row[6] || '').trim();
          if (!nurseMap[sid]) continue;  // 看護師でなければスキップ
          const jig = String(row[3] || '').trim();
          const facility = String(row[4] || '').trim();
          const shift = String(row[8] || '').trim();
          const dateKey = Utilities.formatDate(date, 'Asia/Tokyo', 'M/d');

          if (!accum[jig]) accum[jig] = {};
          if (!accum[jig][sid]) {
            accum[jig][sid] = { staff_id: sid, staff_name: nurseMap[sid], days: [] };
          }
          accum[jig][sid].days.push({ date: dateKey, facility: facility, shift: shift });

          if (!uniqueNursesByJig[jig]) uniqueNursesByJig[jig] = {};
          uniqueNursesByJig[jig][sid] = true;
        }
      }
    }

    // ④ 結果整形 (M_事業所配置基準の順序を保つ)
    const jigyoshoList = jigyoshoOrder.map(function(jig) {
      const nurses = accum[jig] ? Object.keys(accum[jig]).map(function(sid) {
        const obj = accum[jig][sid];
        // 日付昇順 (M/d を数値化)
        obj.days.sort(function(a, b) {
          const pa = a.date.split('/').map(Number);
          const pb = b.date.split('/').map(Number);
          return pa[0] !== pb[0] ? pa[0] - pb[0] : pa[1] - pb[1];
        });
        return obj;
      }) : [];
      // 配置日数の多い順に並べる
      nurses.sort(function(a, b) { return b.days.length - a.days.length; });
      const required = requiredMap[jig] || 0;
      const nurseCount = uniqueNursesByJig[jig] ? Object.keys(uniqueNursesByJig[jig]).length : 0;
      return {
        jigyosho: jig,
        required: required,
        nurseCount: nurseCount,
        judge: nurseCount >= required ? 'OK' : '不足',
        nurses: nurses
      };
    });

    return {
      success: true,
      yearMonth: yearMonth,
      jigyoshoList: jigyoshoList
    };
  } catch (e) {
    Logger.log('getNurseAssignmentDetails error: ' + e.message + '\n' + e.stack);
    return { success: false, message: e.message };
  }
}
