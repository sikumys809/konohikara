// ============================================================
// 警告システム共通モジュール (夜勤・日勤両用)
// V_警告チェックシートの管理 + 警告レコードCRUD
// ============================================================

const WARNING_SHEET_NAME = 'V_警告チェック';

const WARNING_LEVEL = {
  BLOCK: 'warning_block',  // 確定ブロック対象 (最終承認者承認必要)
  ONLY: 'warning_only'     // 警告のみ、確定ブロックしない
};

const WARNING_STATUS = {
  PENDING: '未承認',
  APPROVED: '承認済',
  NOT_REQUIRED: '承認不要'
};

const WARNING_HEADERS = [
  'warning_id',     // A
  'created_at',     // B
  'shift_kind',     // C: 日勤 / 夜勤
  'target_ym',      // D
  'date',           // E
  'jigyosho',       // F
  'facility',       // G
  'unit',           // H: 夜勤のみ
  'staff_id',       // I
  'staff_name',     // J
  'rule_id',        // K: R1 / R2 / R3 / W1 / W2 / N1 / N2
  'level',          // L
  'message',        // M
  'status',         // N
  'approved_by',    // O
  'approved_at'     // P
];

// ============================================================
// 正規化ヘルパー (Date自動変換に対抗)
// ============================================================
function _normYm(val) {
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }
  return String(val || '');
}

function _normDate(val) {
  if (val instanceof Date) {
    return Utilities.formatDate(val, 'Asia/Tokyo', 'yyyy-MM-dd');
  }
  return String(val || '');
}

// ============================================================
// シート初期化
// ============================================================
function initWarningSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(WARNING_SHEET_NAME);
  
  if (sheet) {
    Logger.log(`既存の ${WARNING_SHEET_NAME} シートを使用`);
  } else {
    sheet = ss.insertSheet(WARNING_SHEET_NAME);
    Logger.log(`${WARNING_SHEET_NAME} シートを新規作成`);
  }
  
  // ヘッダー設定
  sheet.getRange(1, 1, 1, WARNING_HEADERS.length).setValues([WARNING_HEADERS]);
  sheet.getRange(1, 1, 1, WARNING_HEADERS.length)
    .setFontWeight('bold')
    .setBackground('#fbbf24')
    .setFontColor('#000000');
  sheet.setFrozenRows(1);
  
  // 列フォーマット: target_ym と date を文字列固定 (日付自動変換防止)
  sheet.getRange('D:D').setNumberFormat('@');
  sheet.getRange('E:E').setNumberFormat('@');
  
  // 列幅調整
  const widths = [150, 150, 70, 90, 110, 200, 200, 80, 70, 120, 70, 120, 350, 80, 120, 150];
  widths.forEach((w, i) => sheet.setColumnWidth(i + 1, w));
  
  // 入力規則: shift_kind 列
  const shiftKindRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['日勤', '夜勤'], true).build();
  sheet.getRange('C2:C').setDataValidation(shiftKindRule);
  
  // 入力規則: level 列
  const levelRule = SpreadsheetApp.newDataValidation()
    .requireValueInList([WARNING_LEVEL.BLOCK, WARNING_LEVEL.ONLY], true).build();
  sheet.getRange('L2:L').setDataValidation(levelRule);
  
  // 入力規則: status 列
  const statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList([WARNING_STATUS.PENDING, WARNING_STATUS.APPROVED, WARNING_STATUS.NOT_REQUIRED], true).build();
  sheet.getRange('N2:N').setDataValidation(statusRule);
  
  Logger.log(`${WARNING_SHEET_NAME} 初期化完了`);
  return { success: true, sheet: WARNING_SHEET_NAME };
}

// ============================================================
// warning_id 自動採番
// フォーマット: W-{YYYY-MM}-{連番3桁}
// 例: W-2026-05-001
// ============================================================
function _generateWarningId(targetYm) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(WARNING_SHEET_NAME);
  if (!sheet || sheet.getLastRow() <= 1) {
    return `W-${targetYm}-001`;
  }
  
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  const prefix = `W-${targetYm}-`;
  let maxSeq = 0;
  
  data.forEach(row => {
    const id = String(row[0] || '');
    if (id.startsWith(prefix)) {
      const seq = parseInt(id.slice(prefix.length), 10);
      if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
    }
  });
  
  const nextSeq = String(maxSeq + 1).padStart(3, '0');
  return `${prefix}${nextSeq}`;
}

// ============================================================
// 警告追加
// params: { shiftKind, targetYm, date, jigyosho, facility, unit,
//           staffId, staffName, ruleId, level, message }
// ============================================================
function addWarning(params) {
  if (!params || !params.targetYm || !params.ruleId || !params.level) {
    throw new Error('addWarning: 必須パラメータ不足 (targetYm, ruleId, level)');
  }
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(WARNING_SHEET_NAME);
  if (!sheet) {
    initWarningSheet();
    sheet = ss.getSheetByName(WARNING_SHEET_NAME);
  }
  
  const warningId = _generateWarningId(params.targetYm);
  const now = new Date();
  const status = params.level === WARNING_LEVEL.ONLY 
    ? WARNING_STATUS.NOT_REQUIRED 
    : WARNING_STATUS.PENDING;
  
  const row = [
    warningId, now,
    params.shiftKind || '', params.targetYm, params.date || '',
    params.jigyosho || '', params.facility || '', params.unit || '',
    params.staffId || '', params.staffName || '',
    params.ruleId, params.level, params.message || '',
    status, '', ''
  ];
  
  // 新行の位置を確定してから書き込み
  const newRowIdx = sheet.getLastRow() + 1;
  
  // フォーマット先行設定 (D列=target_ym, E列=date を文字列固定)
  sheet.getRange(newRowIdx, 4).setNumberFormat('@');
  sheet.getRange(newRowIdx, 5).setNumberFormat('@');
  
  // 値書き込み
  sheet.getRange(newRowIdx, 1, 1, row.length).setValues([row]);
  
  Logger.log(`警告追加: ${warningId} / ${params.ruleId} / ${params.staffName}`);
  return warningId;
}

// ============================================================
// 警告一覧取得 (フィルタ付き)
// filter: { targetYm, shiftKind, status, level, ruleId, staffId }
// ============================================================
function getWarnings(filter) {
  filter = filter || {};
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(WARNING_SHEET_NAME);
  if (!sheet || sheet.getLastRow() <= 1) return [];
  
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, WARNING_HEADERS.length).getValues();
  const results = [];
  
  data.forEach(row => {
    if (!row[0]) return;
    if (filter.targetYm && _normYm(row[3]) !== filter.targetYm) return;
    if (filter.shiftKind && String(row[2]) !== filter.shiftKind) return;
    if (filter.status && String(row[13]) !== filter.status) return;
    if (filter.level && String(row[11]) !== filter.level) return;
    if (filter.ruleId && String(row[10]) !== filter.ruleId) return;
    if (filter.staffId && String(row[8]) !== String(filter.staffId)) return;
    
    results.push({
      warning_id: row[0], created_at: row[1],
      shift_kind: row[2], target_ym: _normYm(row[3]),
      date: _normDate(row[4]),
      target_ym_raw: row[3],
      jigyosho: row[5], facility: row[6], unit: row[7],
      staff_id: row[8], staff_name: row[9],
      rule_id: row[10], level: row[11], message: row[12],
      status: row[13], approved_by: row[14], approved_at: row[15]
    });
  });
  
  return results;
}

// ============================================================
// 単一警告取得
// ============================================================
function getWarningById(warningId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(WARNING_SHEET_NAME);
  if (!sheet) return null;
  
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;  // 空シート対応
  
  const data = sheet.getRange(2, 1, lastRow - 1, WARNING_HEADERS.length).getValues();
  for (let i = 0; i < data.length; i++) {
    if (data[i][0] === warningId) {
      return {
        warning_id: data[i][0], rowIndex: i + 2,
        created_at: data[i][1], shift_kind: data[i][2],
        target_ym: data[i][3], date: data[i][4],
        jigyosho: data[i][5], facility: data[i][6], unit: data[i][7],
        staff_id: data[i][8], staff_name: data[i][9],
        rule_id: data[i][10], level: data[i][11], message: data[i][12],
        status: data[i][13], approved_by: data[i][14], approved_at: data[i][15]
      };
    }
  }
  return null;
}

// ============================================================
// 警告承認 (最終承認者のみ)
// ============================================================
function approveWarning(warningId, approverName) {
  if (!warningId || !approverName) {
    return { success: false, message: 'warningId と approverName は必須です' };
  }
  
  const w = getWarningById(warningId);
  if (!w) {
    return { success: false, message: '警告ID ' + warningId + ' が見つかりません' };
  }
  if (w.level !== WARNING_LEVEL.BLOCK) {
    return { success: false, message: '警告 ' + warningId + ' は warning_only のため承認不要です' };
  }
  if (w.status === WARNING_STATUS.APPROVED) {
    return { success: true, message: '警告 ' + warningId + ' は既に承認済です', alreadyApproved: true };
  }
  
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(WARNING_SHEET_NAME);
    sheet.getRange(w.rowIndex, 14).setValue(WARNING_STATUS.APPROVED);
    sheet.getRange(w.rowIndex, 15).setValue(approverName);
    sheet.getRange(w.rowIndex, 16).setValue(new Date());
    Logger.log('警告承認: ' + warningId + ' by ' + approverName);
    return { success: true, message: '警告 ' + warningId + ' を承認しました', warningId: warningId };
  } catch (e) {
    return { success: false, message: '承認処理エラー: ' + e.message };
  }
}

// ============================================================
// 警告承認解除
// ============================================================
function unapproveWarning(warningId) {
  if (!warningId) {
    return { success: false, message: 'warningId は必須です' };
  }
  
  const w = getWarningById(warningId);
  if (!w) {
    return { success: false, message: '警告ID ' + warningId + ' が見つかりません' };
  }
  if (w.level !== WARNING_LEVEL.BLOCK) {
    return { success: false, message: '警告 ' + warningId + ' は warning_only のため承認解除対象外です' };
  }
  if (w.status !== WARNING_STATUS.APPROVED) {
    return { success: true, message: '警告 ' + warningId + ' は未承認状態です', alreadyPending: true };
  }
  
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(WARNING_SHEET_NAME);
    sheet.getRange(w.rowIndex, 14).setValue(WARNING_STATUS.PENDING);
    sheet.getRange(w.rowIndex, 15).setValue('');
    sheet.getRange(w.rowIndex, 16).setValue('');
    Logger.log('警告承認解除: ' + warningId);
    return { success: true, message: '警告 ' + warningId + ' の承認を解除しました', warningId: warningId };
  } catch (e) {
    return { success: false, message: '承認解除エラー: ' + e.message };
  }
}

// ============================================================
// 警告削除 (配置取り消し時)
// ============================================================
function deleteWarning(warningId) {
  const w = getWarningById(warningId);
  if (!w) {
    Logger.log(`警告ID ${warningId} が見つからない`);
    return false;
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(WARNING_SHEET_NAME);
  sheet.deleteRow(w.rowIndex);
  Logger.log(`警告削除: ${warningId}`);
  return true;
}

// ============================================================
// 月の警告全削除 (再生成時)
// ============================================================
function deleteWarningsForMonth(targetYm, shiftKind) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(WARNING_SHEET_NAME);
  if (!sheet || sheet.getLastRow() <= 1) return 0;
  
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, WARNING_HEADERS.length).getValues();
  const rowsToDelete = [];
  
  for (let i = 0; i < data.length; i++) {
    if (_normYm(data[i][3]) === targetYm && (!shiftKind || String(data[i][2]) === shiftKind)) {
      rowsToDelete.push(i + 2);
    }
  }
  
  rowsToDelete.reverse().forEach(rowIdx => sheet.deleteRow(rowIdx));
  Logger.log(`月の警告削除: ${targetYm} / ${shiftKind || '両方'} = ${rowsToDelete.length}件`);
  return rowsToDelete.length;
}

// ============================================================
// 未承認 warning_block ありか? (確定可否判定用)
// ============================================================
function hasUnapprovedBlockWarnings(targetYm, shiftKind) {
  const warnings = getWarnings({
    targetYm: targetYm, shiftKind: shiftKind,
    level: WARNING_LEVEL.BLOCK, status: WARNING_STATUS.PENDING
  });
  return warnings.length > 0;
}

// ============================================================
// テスト関数
// ============================================================
function testWarningSystem() {
  Logger.log('=== 警告システム動作確認 ===');
  
  // 既存シート削除 (フォーマット再適用のため)
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const old = ss.getSheetByName(WARNING_SHEET_NAME);
  if (old) {
    ss.deleteSheet(old);
    Logger.log('既存シート削除');
  }
  
  initWarningSheet();
  Logger.log('1. シート初期化完了');
  
  const id1 = addWarning({
    shiftKind: '夜勤', targetYm: '2026-05', date: '2026-05-15',
    jigyosho: 'GHコノヒカラ', facility: 'リフレ要町', unit: 'コノヒカラⅠ',
    staffId: '13', staffName: '水野永吉',
    ruleId: 'R1', level: WARNING_LEVEL.BLOCK,
    message: '前日夜勤B → 当日日勤早出は連続勤務NG'
  });
  Logger.log(`2. 警告追加 (block): ${id1}`);
  
  const id2 = addWarning({
    shiftKind: '日勤', targetYm: '2026-05', date: '2026-05-15',
    jigyosho: 'GHコノヒカラ', facility: 'リフレ要町', unit: '',
    staffId: '14', staffName: 'テスト太郎',
    ruleId: 'N1', level: WARNING_LEVEL.ONLY,
    message: '当該施設に早出が配置されていない'
  });
  Logger.log(`3. 警告追加 (only): ${id2}`);
  
  const list = getWarnings({ targetYm: '2026-05' });
  Logger.log(`4. 警告一覧 (5月): ${list.length}件`);
  list.forEach(w => Logger.log(`   - ${w.warning_id} / ${w.rule_id} / ${w.level} / ${w.status}`));
  
  Logger.log(`5. 未承認block: ${hasUnapprovedBlockWarnings('2026-05')}`);
  
  approveWarning(id1, '水野永吉');
  Logger.log(`6. 承認後の未承認block: ${hasUnapprovedBlockWarnings('2026-05')}`);
  
  deleteWarningsForMonth('2026-05');
  Logger.log('7. 月の警告削除完了');
  
  Logger.log('=== テスト完了 ===');
}

// ============================================================
// 診断: シートに書き込まれた実際の値とその型を確認
// ============================================================
function diagnoseWarningSheet() {
  Logger.log('=== シート診断 ===');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(WARNING_SHEET_NAME);
  if (!sheet) {
    Logger.log('シートなし');
    return;
  }
  Logger.log('行数: ' + sheet.getLastRow());
  if (sheet.getLastRow() <= 1) {
    Logger.log('データなし。テストデータ追加');
    addWarning({
      shiftKind: '夜勤', targetYm: '2026-05', date: '2026-05-15',
      jigyosho: 'GHコノヒカラ', facility: 'リフレ要町', unit: 'コノヒカラⅠ',
      staffId: '13', staffName: '水野永吉',
      ruleId: 'R1', level: WARNING_LEVEL.BLOCK,
      message: 'テスト'
    });
  }
  
  const row2 = sheet.getRange(2, 1, 1, WARNING_HEADERS.length).getValues()[0];
  Logger.log('D列(target_ym) 値: ' + JSON.stringify(row2[3]) + ' / 型: ' + (row2[3] instanceof Date ? 'Date' : typeof row2[3]));
  Logger.log('E列(date) 値: ' + JSON.stringify(row2[4]) + ' / 型: ' + (row2[4] instanceof Date ? 'Date' : typeof row2[4]));
  
  Logger.log('比較: row[3] === "2026-05" → ' + (row2[3] === '2026-05'));
  Logger.log('比較: String(row[3]) === "2026-05" → ' + (String(row2[3]) === '2026-05'));
  Logger.log('比較: String(row[3]) → ' + JSON.stringify(String(row2[3])));
  
  const fmtD = sheet.getRange(2, 4).getNumberFormat();
  const fmtE = sheet.getRange(2, 5).getNumberFormat();
  Logger.log('D列 NumberFormat: ' + fmtD);
  Logger.log('E列 NumberFormat: ' + fmtE);
  
  Logger.log('=== 診断完了 ===');
}
