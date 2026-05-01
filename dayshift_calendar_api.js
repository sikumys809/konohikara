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

    // ★ Step 5.1.1: 警告レコード取得 (カレンダーセルのマーク表示用)
    let warnings = [];
    try {
      if (typeof getWarnings === 'function') {
        warnings = getWarnings({
          shift_kind: 'day',
          target_ym: ym
        });
      }
    } catch (e) {
      Logger.log('警告取得エラー (続行): ' + e.message);
    }

    return {
      success: true,
      yearMonth: ym,
      year: year,
      month: month,
      days: days,
      calendar: calendar,
      canEdit: true,
      warnings: warnings  // ★ Step 5.1.1: 警告リスト追加
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
      
      // ★ Phase 5.1.3.B: 削除前に staff情報を保存 (警告レコード削除用)
      const delDateKey = rowData[1] instanceof Date
        ? Utilities.formatDate(rowData[1], 'Asia/Tokyo', 'yyyy-MM-dd')
        : String(rowData[1]).substring(0, 10);
      const delYM = delDateKey.substring(0, 7);
      const delStaffId = String(rowData[6]);
      const delJigyosho = String(rowData[3]);
      
      sheet.deleteRow(params.rowIndex);
      _recordSlotEditLog(adminStaffId, auth.name, 'delete', null, deletedInfo);
      
      // ★ Phase 5.1.3.B: 関連警告レコードも削除 (新警告は0件で差し替え)
      _replaceDayShiftWarnings(delStaffId, delDateKey, delJigyosho, delYM, []);
      
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
      
      // ★ Phase 5.1.3.C: 警告判定 + レコード差し替え
      const updDateKey = beforeRow[1] instanceof Date
        ? Utilities.formatDate(beforeRow[1], 'Asia/Tokyo', 'yyyy-MM-dd')
        : String(beforeRow[1]).substring(0, 10);
      const updYM = updDateKey.substring(0, 7);
      const updJigyosho = String(beforeRow[3]);
      const updFacility = String(beforeRow[4]);
      const updWarnings = _evaluateDayShiftWarnings(
        params.staff_id, updDateKey, updJigyosho, updFacility, params.shiftType, updYM
      );
      _replaceDayShiftWarnings(params.staff_id, updDateKey, updJigyosho, updYM, updWarnings);
      
      return {
        success: true,
        message: '配置を更新しました',
        action: 'update',
        warnings: updWarnings,
        hasBlockWarning: updWarnings.some(function(w) { return w.level === 'warning_block'; })
      };
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
      
      // ★ Phase 5.1.3.C: 警告判定 + レコード差し替え
      const addWarnings = _evaluateDayShiftWarnings(
        params.staff_id, params.date, jigyosho, params.facility, params.shiftType, ym
      );
      _replaceDayShiftWarnings(params.staff_id, params.date, jigyosho, ym, addWarnings);
      
      return {
        success: true,
        message: '配置を追加しました',
        action: 'add',
        warnings: addWarnings,
        hasBlockWarning: addWarnings.some(function(w) { return w.level === 'warning_block'; })
      };
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
function getDayShiftCandidateStaff(adminStaffId, yearMonth, dateKey, facility, shiftType) {
  try {
    const auth = _checkDayShiftExecPermission(adminStaffId);
    if (!auth.ok) return { success: false, message: auth.message };

    const ss = SpreadsheetApp.getActiveSpreadsheet();

    const staffSheet = ss.getSheetByName('M_スタッフ');
    const staffData = staffSheet.getRange(2, 1, staffSheet.getLastRow() - 1, 20).getValues();

    const cfSheet = ss.getSheetByName('T_シフト確定');
    const cfLast = cfSheet.getLastRow();
    const cfData = cfLast > 1 ? cfSheet.getRange(2, 1, cfLast - 1, 18).getValues() : [];

    // ★ Phase 5.1.2: スタッフID → kubun (新人判定用) のマップを先に作る
    const staffKubunMap = {};
    staffData.forEach(row => {
      staffKubunMap[String(row[0])] = String(row[8] || '').trim();  // I列: 区分
    });

    // 同日 全配置を集計 (W2/N2 判定用)
    const sameDayPlacements = {};   // staff_id → [{shift, facility, jigyosho}, ...]
    const sameDayJigPlacements = {}; // jigyosho → [{staff_id, kubun, ...}, ...]  N2判定用
    cfData.forEach(row => {
      const rowDate = row[1] instanceof Date
        ? Utilities.formatDate(row[1], 'Asia/Tokyo', 'yyyy-MM-dd')
        : String(row[1]);
      if (rowDate === dateKey) {
        const sid = String(row[6]);
        const shift = String(row[8]);
        const fac = String(row[4]);
        const jig = String(row[3]);
        if (!sameDayPlacements[sid]) sameDayPlacements[sid] = [];
        sameDayPlacements[sid].push({ shift: shift, facility: fac, jigyosho: jig });
        if (!sameDayJigPlacements[jig]) sameDayJigPlacements[jig] = [];
        sameDayJigPlacements[jig].push({
          staff_id: sid, shift: shift, facility: fac,
          kubun: staffKubunMap[sid] || ''
        });
      }
    });

    // ★ Phase 5.1.2: 対象事業所の通常スタッフ数を計算 (N2 判定用)
    // facility パラメータが事業所名 (GHコノヒカラ等) の前提
    const targetJigyosho = facility;  // 事業所名として扱う
    const placementsAtJig = sameDayJigPlacements[targetJigyosho] || [];
    const normalStaffCountAtJig = placementsAtJig.filter(p => {
      return p.kubun !== '新人1ヶ月' && p.kubun !== '新人2ヶ月';
    }).length;

    const NIGHT_SHIFTS = ['夜勤A', '夜勤B', '夜勤C'];

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
        const kubun = String(row[8] || '').trim();

        const existingPlacements = sameDayPlacements[sid] || [];

        // ★ Phase 5.1.2: W2/N2 警告判定
        const warnings = [];

        // W2: 候補シフトが「遅出8h」 かつ 同日に夜勤A/B/C配置あり
        if (shiftType === '遅出8h') {
          const hasNightShift = existingPlacements.some(p => NIGHT_SHIFTS.indexOf(p.shift) !== -1);
          if (hasNightShift) {
            warnings.push({
              ruleId: 'W2',
              level: 'warning_block',
              message: '同日(' + dateKey + ')に夜勤配置あり。遅出8h(〜22:00)を追加すると連続勤務NG'
            });
          }
        }

        // N2: 候補が新人 かつ 当該事業所に通常スタッフ0人
        const isNewbie = (kubun === '新人1ヶ月' || kubun === '新人2ヶ月');
        if (isNewbie && normalStaffCountAtJig === 0) {
          warnings.push({
            ruleId: 'N2',
            level: 'warning_only',
            message: '同一事業所(' + targetJigyosho + ')・同一日(' + dateKey + ')に通常スタッフ0人で新人(' + kubun + ')のみ配置'
          });
        }

        return {
          staff_id: sid,
          name: name,
          mainFacility: mainFac,
          mainRoles: mainRoles,
          allowedShifts: allowedShifts,
          kubun: kubun,
          alreadyAssigned: existingPlacements.length > 0,
          existingPlacements: existingPlacements,
          isFacilityMatch: mainFac === facility,
          warnings: warnings,
          hasBlockWarning: warnings.some(w => w.level === 'warning_block'),
          hasOnlyWarning: warnings.some(w => w.level === 'warning_only')
        };
      })
      .sort((a, b) => {
        // block警告ありを末尾に
        if (a.hasBlockWarning && !b.hasBlockWarning) return 1;
        if (!a.hasBlockWarning && b.hasBlockWarning) return -1;
        // メイン施設マッチ優先
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
  const prefix = `SHIFT_${ym}_D`;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return prefix + '0001';
  const data = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
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

// ============================================================
// Phase 5.1.3.A: 日勤配置の警告判定 + 警告レコード差し替え ヘルパー
// ============================================================

/**
 * 日勤配置に対する W2/N2 警告判定
 * @param {string} staffId - スタッフID
 * @param {string} dateKey - yyyy-MM-dd
 * @param {string} jigyosho - 事業所名
 * @param {string} facility - 施設名 (空でもOK)
 * @param {string} shift - シフト種別 (早出8h等)
 * @param {string} ym - yyyy-MM
 * @returns {Array} [{ruleId, level, message}, ...]
 */
function _evaluateDayShiftWarnings(staffId, dateKey, jigyosho, facility, shift, ym) {
  const warnings = [];
  const NIGHT_SHIFTS = ['夜勤A', '夜勤B', '夜勤C'];

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // 1. スタッフ情報取得 (kubun判定用)
    const staffSheet = ss.getSheetByName('M_スタッフ');
    let candidateKubun = '';
    const staffData = staffSheet.getRange(2, 1, staffSheet.getLastRow() - 1, 20).getValues();
    const staffKubunMap = {};
    staffData.forEach(function(row) {
      const sid = String(row[0]);
      staffKubunMap[sid] = String(row[8] || '').trim();
      if (sid === String(staffId)) {
        candidateKubun = String(row[8] || '').trim();
      }
    });

    // 2. 該当日の全配置を取得
    const cfSheet = ss.getSheetByName('T_シフト確定');
    const cfLast = cfSheet.getLastRow();
    if (cfLast > 1) {
      const cfData = cfSheet.getRange(2, 1, cfLast - 1, 18).getValues();
      const sameDayCandidatePlacements = [];  // 候補本人の同日配置
      const sameDayJigPlacements = [];        // 当該事業所の同日配置 (全スタッフ)

      cfData.forEach(function(row) {
        const rowDate = row[1] instanceof Date
          ? Utilities.formatDate(row[1], 'Asia/Tokyo', 'yyyy-MM-dd')
          : String(row[1]);
        if (rowDate !== dateKey) return;

        const rowStaffId = String(row[6]);
        const rowShift = String(row[8]);
        const rowJig = String(row[3]);

        if (rowStaffId === String(staffId)) {
          sameDayCandidatePlacements.push({ shift: rowShift, jigyosho: rowJig });
        }
        if (rowJig === jigyosho) {
          sameDayJigPlacements.push({
            staff_id: rowStaffId,
            shift: rowShift,
            kubun: staffKubunMap[rowStaffId] || ''
          });
        }
      });

      // W2: shift==='遅出8h' && 同日に夜勤A/B/C
      if (shift === '遅出8h') {
        const hasNight = sameDayCandidatePlacements.some(function(p) {
          return NIGHT_SHIFTS.indexOf(p.shift) !== -1;
        });
        if (hasNight) {
          warnings.push({
            ruleId: 'W2',
            level: 'warning_block',
            message: '同日(' + dateKey + ')に夜勤配置あり。遅出8h(〜22:00)を追加すると連続勤務NG'
          });
        }
      }

      // N2: 候補が新人 && 当該事業所に通常スタッフ0人
      const isNewbie = (candidateKubun === '新人1ヶ月' || candidateKubun === '新人2ヶ月');
      if (isNewbie) {
        const normalCount = sameDayJigPlacements.filter(function(p) {
          return p.staff_id !== String(staffId) &&
                 p.kubun !== '新人1ヶ月' && p.kubun !== '新人2ヶ月';
        }).length;
        if (normalCount === 0) {
          warnings.push({
            ruleId: 'N2',
            level: 'warning_only',
            message: '同一事業所(' + jigyosho + ')・同一日(' + dateKey + ')に通常スタッフ0人で新人(' + candidateKubun + ')のみ配置'
          });
        }
      }
    }
  } catch (e) {
    Logger.log('_evaluateDayShiftWarnings エラー: ' + e.message);
  }

  return warnings;
}

/**
 * 日勤配置の警告レコードを差し替え
 * 古い警告(同staff_id, 同date, 同jigyosho, shift_kind=day) を削除 → 新規追加
 * @param {string} staffId
 * @param {string} dateKey
 * @param {string} jigyosho
 * @param {string} ym
 * @param {Array} newWarnings - [{ruleId, level, message}, ...]
 */
function _replaceDayShiftWarnings(staffId, dateKey, jigyosho, ym, newWarnings) {
  try {
    if (typeof getWarnings !== 'function' ||
        typeof deleteWarning !== 'function' ||
        typeof addWarning !== 'function') {
      Logger.log('_replaceDayShiftWarnings: warning_system.js 未読込のためスキップ');
      return;
    }

    // 既存警告を取得して、該当するものを削除
    const existing = getWarnings({
      shift_kind: 'day',
      target_ym: ym
    });
    let deletedCount = 0;
    existing.forEach(function(w) {
      if (String(w.staff_id) === String(staffId) &&
          String(w.date) === String(dateKey) &&
          String(w.jigyosho) === String(jigyosho)) {
        try {
          deleteWarning(w.warning_id);
          deletedCount++;
        } catch (e) {
          Logger.log('警告削除エラー (' + w.warning_id + '): ' + e.message);
        }
      }
    });

    // 新規警告を追加
    let addedCount = 0;
    if (newWarnings && newWarnings.length > 0) {
      // staff_name 取得
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const staffSheet = ss.getSheetByName('M_スタッフ');
      let staffName = '';
      const staffData = staffSheet.getRange(2, 1, staffSheet.getLastRow() - 1, 2).getValues();
      for (let i = 0; i < staffData.length; i++) {
        if (String(staffData[i][0]) === String(staffId)) {
          staffName = String(staffData[i][1]);
          break;
        }
      }

      newWarnings.forEach(function(w) {
        try {
          addWarning({
            shift_kind: 'day',
            target_ym: ym,
            date: dateKey,
            jigyosho: jigyosho,
            facility: '',
            unit: '',
            staff_id: staffId,
            staff_name: staffName,
            rule_id: w.ruleId,
            level: w.level,
            message: w.message
          });
          addedCount++;
        } catch (e) {
          Logger.log('警告追加エラー: ' + e.message);
        }
      });
    }

    Logger.log('_replaceDayShiftWarnings: 削除=' + deletedCount + ' / 追加=' + addedCount);
  } catch (e) {
    Logger.log('_replaceDayShiftWarnings エラー: ' + e.message);
  }
}
