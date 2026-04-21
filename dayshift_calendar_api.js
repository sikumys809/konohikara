// ============================================================
// Step 5-3: 日勤カレンダー & セル編集 バックエンド
// - getDayShiftCalendarData: 事業所×日付の配置データ取得
// - updateDayShiftSlot: セル編集(追加/削除/更新)
// ============================================================

/**
 * 日勤カレンダーデータを取得
 * 返却: 事業所×日付マトリクス + 各セルの配置詳細
 *
 * @param {string} adminStaffId 実行者staff_id
 * @param {string} yearMonth "YYYY-MM"
 * @return {Object}
 */
function getDayShiftCalendarData(adminStaffId, yearMonth) {
  try {
    const auth = _checkDayShiftExecPermission(adminStaffId);
    if (!auth.ok) return { success: false, message: auth.message };

    const ym = yearMonth;
    if (!ym || !/^\d{4}-\d{2}$/.test(ym)) {
      return { success: false, message: '対象年月が不正' };
    }

    const year = parseInt(ym.substring(0, 4));
    const month = parseInt(ym.substring(5, 7));
    const daysInMonth = new Date(year, month, 0).getDate();

    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // ① 事業所リスト (M_事業所配置基準から取得)
    const baseSheet = ss.getSheetByName('M_事業所配置基準');
    const baseData = baseSheet.getRange(2, 1, baseSheet.getLastRow() - 1, 8).getValues();
    const facilities = baseData.map(row => ({
      name: String(row[0]).trim(),
      capacity: parseInt(row[1]) || 0
    })).filter(f => f.name);

    // ② T_シフト確定 から日勤レコードを取得
    const cfSheet = ss.getSheetByName('T_シフト確定');
    const cfLast = cfSheet.getLastRow();
    const cfData = cfLast > 1 ? cfSheet.getRange(2, 1, cfLast - 1, 19).getValues() : [];

    const dayShiftSet = new Set(['早出8h', '早出4h', '遅出8h', '遅出4h']);

    // 事業所 → 日付 → 配置リストのマトリクス構築
    const matrix = {};
    facilities.forEach(f => { matrix[f.name] = {}; });

    cfData.forEach((row, idx) => {
      const rowYm = row[1] instanceof Date
        ? Utilities.formatDate(row[1], 'Asia/Tokyo', 'yyyy-MM')
        : String(row[1]).substring(0, 7);
      if (rowYm !== ym) return;

      const shift = String(row[8]).trim();
      if (!dayShiftSet.has(shift)) return;

      const jigyosho = String(row[3]).trim();
      if (!matrix[jigyosho]) return;

      const dateKey = row[1] instanceof Date
        ? Utilities.formatDate(row[1], 'Asia/Tokyo', 'yyyy-MM-dd')
        : String(row[1]);

      if (!matrix[jigyosho][dateKey]) matrix[jigyosho][dateKey] = [];

      matrix[jigyosho][dateKey].push({
        rowIndex: idx + 2,  // 1-indexed, ヘッダー行込み
        shift_id: String(row[0]),
        date: dateKey,
        facility: String(row[4]).trim(),
        unitName: String(row[5] || ''),
        staff_id: String(row[6]),
        staff_name: String(row[7]),
        shiftType: shift,
        startTime: _formatTimeCell(row[9]),
        endTime: _formatTimeCell(row[10]),
        status: String(row[13] || '確定'),
        dayHours: parseFloat(row[18]) || 0
      });
    });

    // ③ 日付配列（1〜末日）
    const days = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dateKey = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dow = new Date(year, month - 1, d).getDay();
      days.push({ day: d, dateKey, dow });
    }

    // ④ 事業所×日付のマトリクス返却用
    const calendar = facilities.map(f => {
      const cells = days.map(d => {
        const placements = matrix[f.name][d.dateKey] || [];
        return {
          day: d.day,
          dateKey: d.dateKey,
          dow: d.dow,
          count: placements.length,
          placements: placements
        };
      });
      return {
        facility: f.name,
        capacity: f.capacity,
        cells: cells
      };
    });

    return {
      success: true,
      yearMonth: ym,
      year: year,
      month: month,
      days: days,
      calendar: calendar,
      canEdit: true
    };
  } catch (e) {
    Logger.log('getDayShiftCalendarData エラー: ' + e.message);
    return { success: false, message: e.message };
  }
}

/**
 * 時刻セルのフォーマット (Date型 → "HH:mm")
 */
function _formatTimeCell(val) {
  if (!val) return '';
  if (val instanceof Date) return Utilities.formatDate(val, 'Asia/Tokyo', 'HH:mm');
  const s = String(val);
  // "Sat Dec 30 1899 06:00:00 ..." 形式
  const m = s.match(/\d{2}:\d{2}/);
  return m ? m[0] : s;
}

/**
 * 日勤セル編集
 * action: 'add' | 'update' | 'delete'
 *
 * @param {string} adminStaffId
 * @param {Object} params
 *   - action: string
 *   - rowIndex: number (update/delete 時)
 *   - date: string "YYYY-MM-DD" (add 時)
 *   - facility: string (add 時) - 事業所名
 *   - staff_id: string (add/update 時)
 *   - shiftType: string (add/update 時)
 */
function updateDayShiftSlot(adminStaffId, params) {
  try {
    const auth = _checkDayShiftExecPermission(adminStaffId);
    if (!auth.ok) return { success: false, message: auth.message };

    const action = params.action;
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('T_シフト確定');
    if (!sheet) return { success: false, message: 'T_シフト確定シートが見つかりません' };

    if (action === 'delete') {
      if (!params.rowIndex || params.rowIndex < 2) {
        return { success: false, message: 'rowIndex不正' };
      }
      const rowData = sheet.getRange(params.rowIndex, 1, 1, 19).getValues()[0];
      const deletedInfo = `${rowData[1]} ${rowData[7]} ${rowData[8]} @ ${rowData[4]}`;
      sheet.deleteRow(params.rowIndex);
      _recordSlotEditLog(adminStaffId, auth.name, 'delete', null, deletedInfo);
      return { success: true, message: '配置を削除しました', action: 'delete' };
    }

    if (action === 'update') {
      if (!params.rowIndex || params.rowIndex < 2) {
        return { success: false, message: 'rowIndex不正' };
      }
      if (!params.staff_id || !params.shiftType) {
        return { success: false, message: 'staff_id, shiftType必須' };
      }

      // スタッフ情報取得
      const staffInfo = _getStaffBasicInfo(params.staff_id);
      if (!staffInfo) return { success: false, message: 'staff_idが見つかりません' };

      // シフトパターン取得
      const pat = SHIFT_PATTERNS[params.shiftType];
      if (!pat) return { success: false, message: '不正なシフト種別' };

      const hoursCalc = calcShiftHours(pat.start, pat.end, pat.breakMin);

      // 既存行を書き換え
      const beforeRow = sheet.getRange(params.rowIndex, 1, 1, 19).getValues()[0];
      const beforeInfo = `${beforeRow[7]} ${beforeRow[8]}`;

      sheet.getRange(params.rowIndex, 7).setValue(params.staff_id);
      sheet.getRange(params.rowIndex, 8).setValue(staffInfo.name);
      sheet.getRange(params.rowIndex, 9).setValue(params.shiftType);
      sheet.getRange(params.rowIndex, 10).setValue(pat.start);
      sheet.getRange(params.rowIndex, 11).setValue(pat.end);
      sheet.getRange(params.rowIndex, 15).setValue(new Date());  // 更新日時
      sheet.getRange(params.rowIndex, 16).setValue(pat.start);
      sheet.getRange(params.rowIndex, 17).setValue(pat.end);
      sheet.getRange(params.rowIndex, 18).setValue(hoursCalc.nightH);
      sheet.getRange(params.rowIndex, 19).setValue(hoursCalc.dayH);

      _recordSlotEditLog(adminStaffId, auth.name, 'update',
        `${beforeInfo}`, `${staffInfo.name} ${params.shiftType}`);
      return { success: true, message: '配置を更新しました', action: 'update' };
    }

    if (action === 'add') {
      if (!params.date || !params.facility || !params.staff_id || !params.shiftType) {
        return { success: false, message: 'date, facility, staff_id, shiftType必須' };
      }

      const staffInfo = _getStaffBasicInfo(params.staff_id);
      if (!staffInfo) return { success: false, message: 'staff_idが見つかりません' };

      const pat = SHIFT_PATTERNS[params.shiftType];
      if (!pat) return { success: false, message: '不正なシフト種別' };

      const hoursCalc = calcShiftHours(pat.start, pat.end, pat.breakMin);

      // 施設名: メイン施設を取得(M_ユニットから逆引き)
      const facility = _findStaffDefaultFacility(params.staff_id) || params.facility;

      // shift_id 採番 (末尾の番号 + 1)
      const ym = params.date.substring(0, 7);
      const newShiftId = _generateNewDayShiftId(sheet, ym);

      const newRow = [
        newShiftId,
        params.date,
        '',  // unit_id
        params.facility,
        facility,  // 施設名
        '',  // unitName
        params.staff_id,
        staffInfo.name,
        params.shiftType,
        pat.start,
        pat.end,
        1,
        '',  // アラート
        '確定',
        new Date(),
        pat.start,
        pat.end,
        hoursCalc.nightH,
        hoursCalc.dayH
      ];

      const newRowIdx = sheet.getLastRow() + 1;
      // 日付列は文字列書式に固定
      sheet.getRange(newRowIdx, 2).setNumberFormat('@');
      sheet.getRange(newRowIdx, 1, 1, 19).setValues([newRow]);

      _recordSlotEditLog(adminStaffId, auth.name, 'add', null,
        `${params.date} ${staffInfo.name} ${params.shiftType} @ ${params.facility}`);
      return { success: true, message: '配置を追加しました', action: 'add' };
    }

    return { success: false, message: '不正なaction: ' + action };
  } catch (e) {
    Logger.log('updateDayShiftSlot エラー: ' + e.message);
    Logger.log(e.stack);
    return { success: false, message: e.message };
  }
}

/**
 * 候補スタッフ一覧取得（セル編集時の選択肢）
 */
function getDayShiftCandidateStaff(adminStaffId, yearMonth, dateKey, facility) {
  try {
    const auth = _checkDayShiftExecPermission(adminStaffId);
    if (!auth.ok) return { success: false, message: auth.message };

    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // 全スタッフ取得
    const staffSheet = ss.getSheetByName('M_スタッフ');
    const staffData = staffSheet.getRange(2, 1, staffSheet.getLastRow() - 1, 20).getValues();

    // 同日既配置の確認用にT_シフト確定から当日データ取得
    const cfSheet = ss.getSheetByName('T_シフト確定');
    const cfLast = cfSheet.getLastRow();
    const cfData = cfLast > 1 ? cfSheet.getRange(2, 1, cfLast - 1, 19).getValues() : [];

    const sameDayPlacements = {};  // staff_id → [配置リスト]
    cfData.forEach(row => {
      const rowDate = row[1] instanceof Date
        ? Utilities.formatDate(row[1], 'Asia/Tokyo', 'yyyy-MM-dd')
        : String(row[1]);
      if (rowDate === dateKey) {
        const sid = String(row[6]);
        if (!sameDayPlacements[sid]) sameDayPlacements[sid] = [];
        sameDayPlacements[sid].push({
          shift: String(row[8]),
          facility: String(row[4])
        });
      }
    });

    const candidates = staffData
      .filter(row => {
        const retired = String(row[16] || '').toUpperCase() === 'TRUE';
        if (retired) return false;
        const shiftKubun = String(row[12] || '');
        // 日勤シフトに対応してる人だけ
        if (shiftKubun !== '日勤のみ' && shiftKubun !== '両方') return false;
        return true;
      })
      .map(row => {
        const sid = String(row[0]);
        const name = String(row[1]);
        const mainFac = String(row[9] || '');
        const mainRoles = String(row[19] || '世話人');
        const allowedShifts = String(row[13] || '').split(',').map(s => s.trim()).filter(Boolean);

        const existingPlacements = sameDayPlacements[sid] || [];

        return {
          staff_id: sid,
          name: name,
          mainFacility: mainFac,
          mainRoles: mainRoles,
          allowedShifts: allowedShifts,
          alreadyAssigned: existingPlacements.length > 0,
          existingPlacements: existingPlacements,
          isFacilityMatch: mainFac === facility
        };
      })
      // メイン施設優先でソート
      .sort((a, b) => {
        if (a.isFacilityMatch && !b.isFacilityMatch) return -1;
        if (!a.isFacilityMatch && b.isFacilityMatch) return 1;
        return a.name.localeCompare(b.name, 'ja');
      });

    return { success: true, candidates: candidates };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

// ============ ヘルパー関数 ============

function _getStaffBasicInfo(staffId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('M_スタッフ');
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 10).getValues();
  const sid = String(staffId).trim();
  for (const row of data) {
    if (String(row[0]).trim() === sid) {
      return { staff_id: sid, name: String(row[1]), mainFacility: String(row[9] || '') };
    }
  }
  return null;
}

function _findStaffDefaultFacility(staffId) {
  const info = _getStaffBasicInfo(staffId);
  return info ? info.mainFacility : null;
}

function _generateNewDayShiftId(sheet, ym) {
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  const prefix = `SHIFT_${ym}_D`;
  let maxNum = 0;
  data.forEach(row => {
    const v = String(row[0]);
    if (v.indexOf(prefix) === 0) {
      const n = parseInt(v.substring(prefix.length)) || 0;
      if (n > maxNum) maxNum = n;
    }
  });
  return prefix + String(maxNum + 1).padStart(4, '0');
}

function _recordSlotEditLog(staffId, staffName, action, before, after) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('T_操作ログ');
  if (!sheet) return;

  const logId = 'LOG_' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd_HHmmss')
    + '_' + Math.random().toString(36).slice(2, 8);

  const opLabel = action === 'add' ? '日勤シフト追加'
    : action === 'update' ? '日勤シフト更新'
    : '日勤シフト削除';

  sheet.appendRow([
    logId,
    new Date(),
    String(staffId),
    staffName,
    '',
    opLabel,
    'T_シフト確定',
    '',
    before || '',
    after || '',
    ''
  ]);
}

// ============ テスト関数 ============

function testGetDayShiftCalendarData() {
  const result = getDayShiftCalendarData('13', '2026-05');
  if (!result.success) {
    Logger.log('エラー: ' + result.message);
    return;
  }
  Logger.log(`年月: ${result.yearMonth}`);
  Logger.log(`日数: ${result.days.length}`);
  Logger.log(`事業所数: ${result.calendar.length}`);

  result.calendar.forEach(row => {
    const totalPlacements = row.cells.reduce((sum, c) => sum + c.count, 0);
    Logger.log(`  ${row.facility}: ${totalPlacements}件配置`);
    // 1日目の詳細
    const firstDay = row.cells[0];
    if (firstDay.count > 0) {
      firstDay.placements.forEach(p => {
        Logger.log(`    ${firstDay.dateKey}: ${p.staff_name}(${p.shiftType})`);
      });
    }
  });
}

function testGetCandidates() {
  const result = getDayShiftCandidateStaff('13', '2026-05', '2026-05-01', 'GHコノヒカラ');
  if (!result.success) {
    Logger.log('エラー: ' + result.message);
    return;
  }
  Logger.log(`候補者数: ${result.candidates.length}`);
  result.candidates.slice(0, 10).forEach(c => {
    Logger.log(`  ${c.staff_id} ${c.name} / メイン:${c.mainFacility} / マッチ:${c.isFacilityMatch} / 既配置:${c.alreadyAssigned}`);
  });
}
