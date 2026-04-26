// ============================================================
// Step 5-3 v3: 日勤カレンダー & セル編集 バックエンド
// 18列構造対応版
// ============================================================

/**
 * 日勤カレンダーデータを取得 (施設階層対応 / 18列構造)
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

    // 事業所リスト
    const baseSheet = ss.getSheetByName('M_事業所配置基準');
    const baseData = baseSheet.getRange(2, 1, baseSheet.getLastRow() - 1, 8).getValues();
    const facilities = baseData.map(row => ({
      name: String(row[0]).trim(),
      capacity: parseInt(row[1]) || 0
    })).filter(f => f.name);

    // M_ユニット: 事業所 → 施設リスト
    const unitSheet = ss.getSheetByName('M_ユニット');
    const unitData = unitSheet.getRange(2, 1, unitSheet.getLastRow() - 1, 6).getValues();
    const facilityBuildings = {};
    facilities.forEach(f => { facilityBuildings[f.name] = new Set(); });

    unitData.forEach(row => {
      const jig = String(row[1] || '').trim();
      const building = String(row[3] || '').trim();
      if (jig && building && facilityBuildings[jig]) {
        facilityBuildings[jig].add(building);
      }
    });

    // T_シフト確定 日勤レコード (18列)
    const cfSheet = ss.getSheetByName('T_シフト確定');
    const cfLast = cfSheet.getLastRow();
    const cfData = cfLast > 1 ? cfSheet.getRange(2, 1, cfLast - 1, 18).getValues() : [];

    const dayShiftSet = new Set(['早出8h', '早出4h', '遅出8h', '遅出4h']);

    const matrix = {};
    facilities.forEach(f => {
      matrix[f.name] = {};
      Array.from(facilityBuildings[f.name]).forEach(b => {
        matrix[f.name][b] = {};
      });
    });

    cfData.forEach((row, idx) => {
      const rowYm = row[1] instanceof Date
        ? Utilities.formatDate(row[1], 'Asia/Tokyo', 'yyyy-MM')
        : String(row[1]).substring(0, 7);
      if (rowYm !== ym) return;

      const shift = String(row[8]).trim();
      if (!dayShiftSet.has(shift)) return;

      const jigyosho = String(row[3]).trim();
      const facility = String(row[4]).trim();
      if (!matrix[jigyosho]) return;
      if (!matrix[jigyosho][facility]) matrix[jigyosho][facility] = {};

      const dateKey = row[1] instanceof Date
        ? Utilities.formatDate(row[1], 'Asia/Tokyo', 'yyyy-MM-dd')
        : String(row[1]);

      if (!matrix[jigyosho][facility][dateKey]) {
        matrix[jigyosho][facility][dateKey] = [];
      }

      matrix[jigyosho][facility][dateKey].push({
        rowIndex: idx + 2,
        shift_id: String(row[0]),
        date: dateKey,
        facility: facility,
        unitName: String(row[5] || ''),
        staff_id: String(row[6]),
        staff_name: String(row[7]),
        shiftType: shift,
        startTime: _formatTimeCell(row[9]),
        endTime: _formatTimeCell(row[10]),
        status: String(row[12] || '仮'),    // ★ M列(12) ステータス (旧 row[13])
        dayHours: parseFloat(row[17]) || 0   // ★ R列(17) 日勤換算 (旧 row[18])
      });
    });

    const days = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dateKey = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dow = new Date(year, month - 1, d).getDay();
      days.push({ day: d, dateKey, dow });
    }

    const calendar = facilities.map(f => {
      const buildings = Array.from(facilityBuildings[f.name]).sort();
      const buildingRows = buildings.map(b => {
        const cells = days.map(d => {
          const placements = (matrix[f.name][b] && matrix[f.name][b][d.dateKey]) || [];
          return {
            day: d.day,
            dateKey: d.dateKey,
            dow: d.dow,
            count: placements.length,
            placements: placements
          };
        });
        return {
          facility: b,
          cells: cells
        };
      });
      return {
        jigyosho: f.name,
        capacity: f.capacity,
        buildings: buildingRows
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

function _formatTimeCell(val) {
  if (!val) return '';
  if (val instanceof Date) return Utilities.formatDate(val, 'Asia/Tokyo', 'HH:mm');
  const s = String(val);
  const m = s.match(/\d{2}:\d{2}/);
  return m ? m[0] : s;
}

/**
 * 日勤セル編集 (18列構造)
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
      const rowData = sheet.getRange(params.rowIndex, 1, 1, 18).getValues()[0];
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

      const staffInfo = _getStaffBasicInfo(params.staff_id);
      if (!staffInfo) return { success: false, message: 'staff_idが見つかりません' };

      const pat = SHIFT_PATTERNS[params.shiftType];
      if (!pat) return { success: false, message: '不正なシフト種別' };

      const hoursCalc = calcShiftHours(pat.start, pat.end, pat.breakMin);

      const beforeRow = sheet.getRange(params.rowIndex, 1, 1, 18).getValues()[0];
      const beforeInfo = `${beforeRow[7]} ${beforeRow[8]}`;

      // 列番号を全て1ずつ前にズラす (18列構造)
      sheet.getRange(params.rowIndex, 7).setValue(params.staff_id);   // G staff_id
      sheet.getRange(params.rowIndex, 8).setValue(staffInfo.name);    // H 氏名
      sheet.getRange(params.rowIndex, 9).setValue(params.shiftType);  // I シフト種別
      sheet.getRange(params.rowIndex, 10).setValue(pat.start);        // J 開始時刻
      sheet.getRange(params.rowIndex, 11).setValue(pat.end);          // K 終了時刻
      sheet.getRange(params.rowIndex, 14).setValue(new Date());       // N 更新日時 (旧15)
      sheet.getRange(params.rowIndex, 15).setValue(pat.start);        // O 実開始 (旧16)
      sheet.getRange(params.rowIndex, 16).setValue(pat.end);          // P 実終了 (旧17)
      sheet.getRange(params.rowIndex, 17).setValue(hoursCalc.nightH); // Q 夜勤換算 (旧18)
      sheet.getRange(params.rowIndex, 18).setValue(hoursCalc.dayH);   // R 日勤換算 (旧19)

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
      const ym = params.date.substring(0, 7);
      const newShiftId = _generateNewDayShiftId(sheet, ym);

      // 事業所名を解決
      const ss2 = SpreadsheetApp.getActiveSpreadsheet();
      const unitSheet = ss2.getSheetByName('M_ユニット');
      const unitData = unitSheet.getRange(2, 1, unitSheet.getLastRow() - 1, 6).getValues();
      let jigyosho = params.facility;
      for (const row of unitData) {
        const building = String(row[3] || '').trim();
        if (building === params.facility) {
          jigyosho = String(row[1] || '').trim();
          break;
        }
      }

      // 18列構造の新規行
      const newRow = [
        newShiftId,         // A
        params.date,        // B
        '',                 // C
        jigyosho,           // D
        params.facility,    // E
        '',                 // F
        params.staff_id,    // G
        staffInfo.name,     // H
        params.shiftType,   // I
        pat.start,          // J
        pat.end,            // K
        1,                  // L
        '仮',               // M ステータス ★ '確定'→'仮'
        new Date(),         // N 更新日時
        pat.start,          // O 実開始
        pat.end,            // P 実終了
        hoursCalc.nightH,   // Q 夜勤換算
        hoursCalc.dayH      // R 日勤換算
      ];

      const newRowIdx = sheet.getLastRow() + 1;
      sheet.getRange(newRowIdx, 2).setNumberFormat('@');
      sheet.getRange(newRowIdx, 1, 1, 18).setValues([newRow]);

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
 * 候補スタッフ一覧取得 (18列構造)
 */
function getDayShiftCandidateStaff(adminStaffId, yearMonth, dateKey, facility) {
  try {
    const auth = _checkDayShiftExecPermission(adminStaffId);
    if (!auth.ok) return { success: false, message: auth.message };

    const ss = SpreadsheetApp.getActiveSpreadsheet();

    const staffSheet = ss.getSheetByName('M_スタッフ');
    const staffData = staffSheet.getRange(2, 1, staffSheet.getLastRow() - 1, 20).getValues();

    const cfSheet = ss.getSheetByName('T_シフト確定');
    const cfLast = cfSheet.getLastRow();
    const cfData = cfLast > 1 ? cfSheet.getRange(2, 1, cfLast - 1, 18).getValues() : [];

    const sameDayPlacements = {};
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
    Logger.log(`\n【${row.jigyosho}】 定員${row.capacity} / ${row.buildings.length}施設`);
    row.buildings.forEach(b => {
      const total = b.cells.reduce((sum, c) => sum + c.count, 0);
      Logger.log(`  📍 ${b.facility}: ${total}件配置`);
    });
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