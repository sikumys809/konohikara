// ============================================================
// 希望テンプレート管理（繰り返し提出）
// Step 3-2: CRUD + 月展開
//
// このファイルは StaffApp_Code.gs とは独立して動く。
// Index.html から google.script.run.xxx() で直接呼べる。
// ============================================================

/**
 * スプレッドシート取得（STAFF_SS_ID があれば優先、なければアクティブ）
 */
function _tplGetSS() {
  if (typeof STAFF_SS_ID !== 'undefined' && STAFF_SS_ID) {
    return SpreadsheetApp.openById(STAFF_SS_ID);
  }
  return SpreadsheetApp.getActiveSpreadsheet();
}

/**
 * 日付値（Date or 文字列）を "yyyy-MM-dd" に正規化
 */
function _tplNormalizeDate(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return Utilities.formatDate(val, 'Asia/Tokyo', 'yyyy-MM-dd');
  }
  return String(val).trim();
}

/**
 * 年月値（Date or 文字列）を "yyyy-MM" に正規化
 */
function _tplNormalizeYM(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return Utilities.formatDate(val, 'Asia/Tokyo', 'yyyy-MM');
  }
  return String(val).trim();
}

// ============================================================
// テンプレート一覧取得
// ============================================================
function listTemplates(staffId) {
  const ss = _tplGetSS();
  const sheet = ss.getSheetByName('M_希望テンプレート');
  if (!sheet) return [];

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const data = sheet.getRange(2, 1, lastRow - 1, 12).getValues();
  const targetId = String(staffId).trim();

  return data
    .filter(row => {
      const sid = String(row[1]).trim();
      const active = String(row[11]).toUpperCase();
      return sid === targetId && active === 'TRUE';
    })
    .map(row => ({
      template_id:  row[0],
      staff_id:     String(row[1]).trim(),
      name:         row[2],
      templateName: row[3],
      weekdays:     String(row[4]).split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n)),
      shiftType:    row[5],
      mainFac:      row[6] || '',
      secondFac:    row[7] || '',
      subFacs:      String(row[8] || '').split(',').map(s => s.trim()).filter(Boolean),
      comment:      row[9] || '',
      createdAt:    row[10] instanceof Date
        ? Utilities.formatDate(row[10], 'Asia/Tokyo', 'yyyy-MM-dd HH:mm')
        : String(row[10] || '')
    }));
}

// ============================================================
// テンプレート保存（新規 or 更新）
// ============================================================
function saveTemplate(data) {
  const ss = _tplGetSS();
  const sheet = ss.getSheetByName('M_希望テンプレート');
  if (!sheet) throw new Error('M_希望テンプレート が存在しない');

  // バリデーション
  if (!data.staff_id) throw new Error('staff_id が必須');
  if (!data.templateName) throw new Error('テンプレート名が必須');
  if (!data.weekdays || data.weekdays.length === 0) throw new Error('曜日を1つ以上選択してください');
  if (!data.shiftType) throw new Error('シフト種別が必須');
  if (!data.mainFac) throw new Error('メイン施設が必須');

  const weekdaysStr = (data.weekdays || []).map(n => parseInt(n, 10)).filter(n => n >= 1 && n <= 7).join(',');
  const subFacsStr  = (data.subFacs || []).filter(Boolean).join(',');
  const now = new Date();

  // ========== 更新モード ==========
  if (data.template_id) {
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) throw new Error(`template_id ${data.template_id} が見つからない`);

    const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    const targetIdx = ids.findIndex(r => String(r[0]) === data.template_id);
    if (targetIdx < 0) throw new Error(`template_id ${data.template_id} が見つからない`);

    const rowNum = targetIdx + 2;
    sheet.getRange(rowNum, 4, 1, 7).setValues([[
      data.templateName,
      weekdaysStr,
      data.shiftType,
      data.mainFac,
      data.secondFac || '',
      subFacsStr,
      data.comment || ''
    ]]);
    return { success: true, template_id: data.template_id, mode: 'update' };
  }

  // ========== 新規作成 ==========
  const newId = _getNextTemplateId();
  sheet.appendRow([
    newId,
    String(data.staff_id).trim(),
    data.name || '',
    data.templateName,
    weekdaysStr,
    data.shiftType,
    data.mainFac,
    data.secondFac || '',
    subFacsStr,
    data.comment || '',
    now,
    'TRUE'
  ]);
  return { success: true, template_id: newId, mode: 'create' };
}

// ============================================================
// テンプレート削除（論理削除: 有効フラグ = FALSE）
// ============================================================
function deleteTemplate(templateId) {
  const ss = _tplGetSS();
  const sheet = ss.getSheetByName('M_希望テンプレート');
  if (!sheet) throw new Error('M_希望テンプレート が存在しない');

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error(`template_id ${templateId} が見つからない`);

  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  const targetIdx = ids.findIndex(r => String(r[0]) === templateId);
  if (targetIdx < 0) throw new Error(`template_id ${templateId} が見つからない`);

  sheet.getRange(targetIdx + 2, 12).setValue('FALSE');
  return { success: true, template_id: templateId };
}

// ============================================================
// テンプレートを指定月に展開して T_希望提出 に登録
// @param {string}  templateId
// @param {string}  yearMonth  "2026-05"
// @param {boolean} overwrite  true=既存上書き / false=既存スキップ
// ============================================================
function applyTemplate(templateId, yearMonth, overwrite) {
  if (!templateId) throw new Error('templateId 必須');
  if (!yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) throw new Error('yearMonth は YYYY-MM 形式');

  const ss = _tplGetSS();
  const tplSheet = ss.getSheetByName('M_希望テンプレート');
  const reqSheet = ss.getSheetByName('T_希望提出');
  if (!tplSheet) throw new Error('M_希望テンプレート が存在しない');
  if (!reqSheet) throw new Error('T_希望提出 が存在しない');

  // テンプレート取得
  const tplLast = tplSheet.getLastRow();
  if (tplLast < 2) throw new Error(`template_id ${templateId} が見つからない`);
  const tplData = tplSheet.getRange(2, 1, tplLast - 1, 12).getValues();
  const tpl = tplData.find(r => String(r[0]) === templateId);
  if (!tpl) throw new Error(`template_id ${templateId} が見つからない`);
  if (String(tpl[11]).toUpperCase() !== 'TRUE') throw new Error('このテンプレートは無効です');

  const staffId   = String(tpl[1]).trim();
  const staffName = tpl[2];
  const weekdays  = String(tpl[4]).split(',').map(n => parseInt(n.trim(), 10)).filter(n => !isNaN(n));
  const shiftType = tpl[5];
  const mainFac   = tpl[6] || '';
  const secondFac = tpl[7] || '';
  const subFacs   = String(tpl[8] || '').split(',').map(s => s.trim()).filter(Boolean);
  const comment   = tpl[9] || '';

  // 指定月の該当曜日の日付リストを生成
  // weekdays: 1=月, 2=火, 3=水, 4=木, 5=金, 6=土, 7=日
  const parts = yearMonth.split('-');
  const year  = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const daysInMonth = new Date(year, month, 0).getDate();

  const targetDates = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(year, month - 1, d);
    const jsDay = dt.getDay();               // 0=日, 1=月, ..., 6=土
    const myWeekday = jsDay === 0 ? 7 : jsDay; // 1=月, ..., 7=日
    if (weekdays.indexOf(myWeekday) !== -1) {
      targetDates.push(Utilities.formatDate(dt, 'Asia/Tokyo', 'yyyy-MM-dd'));
    }
  }

  // 既存希望を取得（重複検知用）
  const reqLast = reqSheet.getLastRow();
  const existingKeys = {}; // key -> rowNum（1-indexed）
  if (reqLast > 1) {
    const reqData = reqSheet.getRange(2, 1, reqLast - 1, 13).getValues();
    reqData.forEach((row, idx) => {
      const sid = String(row[2]).trim();
      if (sid !== staffId) return;
      const ym = _tplNormalizeYM(row[4]);
      if (ym !== yearMonth) return;
      const dateStr = _tplNormalizeDate(row[5]);
      const shift = String(row[6]).trim();
      const key = `${dateStr}_${shift}`;
      existingKeys[key] = idx + 2;
    });
  }

  // 新規行を準備
  const now = new Date();
  const tplNum = templateId.replace('TPL_', '');
  const newRows = [];
  const overwriteRows = []; // [{rowNum, values}]
  let skipped = 0;

  targetDates.forEach((dateStr, i) => {
    const key = `${dateStr}_${shiftType}`;
    const reqId = `${staffId}_${yearMonth}_TPL${tplNum}_${String(i + 1).padStart(3, '0')}`;
    const rowValues = [
      reqId, now, staffId, staffName, yearMonth, dateStr, shiftType,
      mainFac, secondFac, subFacs.join(','), comment, '', ''
    ];

    if (existingKeys[key]) {
      if (overwrite) {
        overwriteRows.push({ rowNum: existingKeys[key], values: rowValues });
      } else {
        skipped++;
      }
    } else {
      newRows.push(rowValues);
    }
  });

  // 書込: 新規
  if (newRows.length > 0) {
    const startRow = reqSheet.getLastRow() + 1;
    reqSheet.getRange(startRow, 1, newRows.length, 13).setValues(newRows);
    reqSheet.getRange(startRow, 5, newRows.length, 1).setNumberFormat('@'); // 対象年月を文字列書式
    reqSheet.getRange(startRow, 6, newRows.length, 1).setNumberFormat('@'); // 希望日も文字列書式
  }

  // 書込: 上書き
  overwriteRows.forEach(o => {
    reqSheet.getRange(o.rowNum, 1, 1, 13).setValues([o.values]);
    reqSheet.getRange(o.rowNum, 5).setNumberFormat('@');
    reqSheet.getRange(o.rowNum, 6).setNumberFormat('@');
  });

  return {
    success: true,
    template_id: templateId,
    yearMonth: yearMonth,
    inserted: newRows.length,
    overwritten: overwriteRows.length,
    skipped: skipped,
    totalTargetDates: targetDates.length
  };
}

// ============================================================
// テスト関数
// ============================================================
function testTemplateFlow() {
  Logger.log('=== Step 3-2 テンプレート管理テスト ===');

  // 1. 新規作成（水野永吉 staff_id=13）
  const saveResult = saveTemplate({
    staff_id: 13,
    name: '水野永吉',
    templateName: '平日早番テスト',
    weekdays: [1, 2, 3, 4, 5], // 月〜金
    shiftType: '早出8h',
    mainFac: 'GHコノヒカラ',
    secondFac: '',
    subFacs: [],
    comment: 'テンプレテスト'
  });
  Logger.log('① saveTemplate: ' + JSON.stringify(saveResult));

  // 2. 一覧取得
  const list = listTemplates(13);
  Logger.log(`② listTemplates: ${list.length}件`);
  list.forEach(t => {
    Logger.log(`  ${t.template_id} / ${t.templateName} / 曜日=${t.weekdays.join(',')} / ${t.shiftType}`);
  });

  // 3. 適用（2026-07 に展開、上書きなし）
  const applyResult = applyTemplate(saveResult.template_id, '2026-07', false);
  Logger.log('③ applyTemplate(2026-07): ' + JSON.stringify(applyResult));

  // 4. 再適用（同月 overwrite=false → skipされるはず）
  const applyResult2 = applyTemplate(saveResult.template_id, '2026-07', false);
  Logger.log('④ 再適用 overwrite=false: ' + JSON.stringify(applyResult2));

  // 5. 削除
  const delResult = deleteTemplate(saveResult.template_id);
  Logger.log('⑤ deleteTemplate: ' + JSON.stringify(delResult));

  // 6. 削除後の一覧（0件のはず）
  const listAfter = listTemplates(13);
  Logger.log(`⑥ listTemplates (削除後): ${listAfter.length}件`);

  // 7. T_希望提出 から今回のテストデータを掃除
  const ss = _tplGetSS();
  const reqSheet = ss.getSheetByName('T_希望提出');
  const reqLast = reqSheet.getLastRow();
  if (reqLast > 1) {
    const reqData = reqSheet.getRange(2, 1, reqLast - 1, 1).getValues();
    const deleteRows = [];
    reqData.forEach((r, i) => {
      if (String(r[0]).indexOf(`TPL${saveResult.template_id.replace('TPL_', '')}`) !== -1) {
        deleteRows.push(i + 2);
      }
    });
    // 下から削除
    deleteRows.reverse().forEach(rn => reqSheet.deleteRow(rn));
    Logger.log(`⑦ テストデータ掃除: ${deleteRows.length}行削除`);
  }

  Logger.log('=== テスト完了 ===');
  return { save: saveResult, apply: applyResult, del: delResult };
}