// ============================================================
// Step 4-2: 日勤自動割当エンジン v2 (18列構造対応版)
// 変更点: T_シフト確定 のM列「アラート種別」削除に伴い、
//   - 書き込み配列を19要素→18要素に
//   - getRange の列幅を 19→18 に
// 列構造: A〜L=共通12列 / M=ステータス / N=更新日時 / O=実開始 / P=実終了 / Q=夜勤換算 / R=日勤換算
// ============================================================

const DAY_SHIFT_TYPES = ['早出8h', '早出4h', '遅出8h', '遅出4h'];
const NIGHT_SHIFT_TYPES = ['夜勤A', '夜勤B', '夜勤C'];

function runDayShiftEngine(yearMonth) {
  const ym = yearMonth || '2026-05';
  const startTs = Date.now();
  Logger.log(`========== 日勤エンジン v2 開始 (${ym}) ==========`);

  const ctx = _loadEngineContext(ym);
  Logger.log(`希望: ${ctx.requests.length}件 / スタッフ: ${Object.keys(ctx.staffMap).length}名 / 施設→事業所マップ: ${Object.keys(ctx.facToJigMap).length}施設`);

  const deleted = _deleteExistingDayShifts(ctx.confirmedSheet, ym);
  Logger.log(`既存日勤データ ${deleted}件削除`);

  const placements = [];
  const skips = [];

  ctx.requests.forEach(req => {
    const result = _tryPlace(req, ctx, placements);
    if (result.ok) {
      placements.push(result.record);
    } else {
      skips.push({ req, reason: result.reason });
    }
  });

  Logger.log(`\n配置: ${placements.length}件 / スキップ: ${skips.length}件`);

  if (placements.length > 0) {
    _writePlacements(ctx.confirmedSheet, placements, ym);
  }

  const elapsed = ((Date.now() - startTs) / 1000).toFixed(1);
  Logger.log(`\n========== 完了 (${elapsed}秒) ==========`);
  _printSummary(placements, skips);

  return {
    yearMonth: ym,
    placed: placements.length,
    skipped: skips.length,
    elapsed: elapsed
  };
}

function _loadEngineContext(ym) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const staffSheet = ss.getSheetByName('M_スタッフ');
  const staffData = staffSheet.getRange(2, 1, staffSheet.getLastRow() - 1, 20).getValues();
  const staffMap = {};
  staffData.forEach(row => {
    const retired = String(row[16] || '').toUpperCase() === 'TRUE';
    if (retired) return;
    const sid = String(row[0]).trim();
    staffMap[sid] = {
      staff_id: sid,
      name: row[1],
      certification: String(row[5] || ''),
      mainFac: row[9] || '',
      secondFac: row[10] || '',
      subFacs: String(row[11] || '').split(',').map(s => s.trim()).filter(Boolean),
      allowedShifts: String(row[13] || '').split(',').map(s => s.trim()).filter(Boolean),
      mainRoles: String(row[19] || '世話人').split(',').map(s => s.trim()).filter(Boolean),
      isNurse: String(row[5] || '').indexOf('看護師') !== -1
    };
  });

  const unitSheet = ss.getSheetByName('M_ユニット');
  const unitData = unitSheet.getRange(2, 1, unitSheet.getLastRow() - 1, 6).getValues();
  const facToJigMap = {};
  unitData.forEach(row => {
    const fac = String(row[3] || '').trim();
    const jig = String(row[1] || '').trim();
    if (fac && jig && !facToJigMap[fac]) {
      facToJigMap[fac] = jig;
    }
  });

  const reqSheet = ss.getSheetByName('T_希望提出');
  const lastReqRow = reqSheet.getLastRow();
  const allReqs = lastReqRow > 1
    ? reqSheet.getRange(2, 1, lastReqRow - 1, 13).getValues()
    : [];
  const dayShiftSet = new Set(DAY_SHIFT_TYPES);
  const requests = allReqs
    .filter(row => {
      const reqYm = _normYM(row[4]);
      const shift = String(row[6]).trim();
      return reqYm === ym && dayShiftSet.has(shift);
    })
    .map(row => ({
      reqId: row[0],
      staff_id: String(row[2]).trim(),
      name: row[3],
      date: _normDate(row[5]),
      shift: String(row[6]).trim(),
      mainFac: String(row[7] || '').trim(),
      secondFac: String(row[8] || '').trim(),
      subFacs: String(row[9] || '').split(',').map(s => s.trim()).filter(Boolean),
      comment: row[10] || ''
    }));

  const confirmedSheet = ss.getSheetByName('T_シフト確定');

  // 既存夜勤読み込み（連続勤務NG検証用）→ 18列構造
  const existingNight = {};
  if (confirmedSheet.getLastRow() > 1) {
    const cfData = confirmedSheet.getRange(2, 1, confirmedSheet.getLastRow() - 1, 18).getValues();
    cfData.forEach(row => {
      const rowYm = _normYM(row[1] ? Utilities.formatDate(new Date(row[1]), 'Asia/Tokyo', 'yyyy-MM') : '');
      if (rowYm !== ym) return;
      const sid = String(row[6]).trim();
      const shift = String(row[8]).trim();
      if (NIGHT_SHIFT_TYPES.indexOf(shift) === -1) return;
      if (!existingNight[sid]) existingNight[sid] = [];
      existingNight[sid].push({
        date: _normDate(row[1]),
        shift: shift
      });
    });
  }

  return { staffMap, facToJigMap, requests, confirmedSheet, existingNight };
}

function _tryPlace(req, ctx, placements) {
  const staff = ctx.staffMap[req.staff_id];
  if (!staff) {
    return { ok: false, reason: `スタッフID ${req.staff_id} がM_スタッフに無い or 退職者` };
  }

  const jigyosho = ctx.facToJigMap[req.mainFac];
  if (!jigyosho) {
    return { ok: false, reason: `施設 "${req.mainFac}" がM_ユニットに無い` };
  }

  const existingOnSameDay = placements.filter(p =>
    p.staff_id === staff.staff_id && p.date === req.date
  );

  const nightToday = (ctx.existingNight[staff.staff_id] || []).filter(n => n.date === req.date);
  if (nightToday.length > 0) {
    return { ok: false, reason: `同日に夜勤あり (${nightToday[0].shift})` };
  }

  const prevDate = _prevDate(req.date);
  const prevNightBorC = (ctx.existingNight[staff.staff_id] || []).filter(
    n => n.date === prevDate && (n.shift === '夜勤B' || n.shift === '夜勤C')
  );
  if (prevNightBorC.length > 0) {
    return { ok: false, reason: `前日夜勤${prevNightBorC[0].shift.slice(-1)}と連続` };
  }

  const newTimes = _getShiftTimeRange(req.shift);
  for (const ex of existingOnSameDay) {
    const exTimes = _getShiftTimeRange(ex.shiftType);
    if (_rangesOverlap(newTimes, exTimes)) {
      return { ok: false, reason: `同日既配置 ${ex.shiftType} と時間衝突` };
    }
  }

  const hoursInfo = calcShiftHours(req.shift, null, null);
  const existingHours = existingOnSameDay.reduce((sum, ex) => sum + (ex.nightHours + ex.dayHours), 0);
  if (existingHours + hoursInfo.totalHours > 8.01) {
    return { ok: false, reason: `1日8h上限超え (既${existingHours.toFixed(1)}h + 新${hoursInfo.totalHours}h)` };
  }

  const record = {
    date: req.date,
    unit_id: '',
    jigyosho: jigyosho,
    facility: req.mainFac,
    unitName: '',
    staff_id: staff.staff_id,
    name: staff.name,
    shiftType: req.shift,
    startTime: hoursInfo.actualStart,
    endTime: hoursInfo.actualEnd,
    count: 1,
    status: '仮',
    nightHours: hoursInfo.nightHours,
    dayHours: hoursInfo.dayHours
  };

  return { ok: true, record };
}

function _getShiftTimeRange(shiftType) {
  const pat = SHIFT_PATTERNS[shiftType];
  if (!pat) return null;
  const [sh, sm] = pat.start.split(':').map(Number);
  const [eh, em] = pat.end.split(':').map(Number);
  let startMin = sh * 60 + sm;
  let endMin = eh * 60 + em;
  if (endMin <= startMin) endMin += 24 * 60;
  return { start: startMin, end: endMin };
}

function _rangesOverlap(a, b) {
  if (!a || !b) return false;
  return a.start < b.end && b.start < a.end;
}

function _prevDate(dateStr) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() - 1);
  return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd');
}

function _normYM(val) {
  if (!val) return '';
  if (val instanceof Date) return Utilities.formatDate(val, 'Asia/Tokyo', 'yyyy-MM');
  return String(val).trim();
}

function _normDate(val) {
  if (!val) return '';
  if (val instanceof Date) return Utilities.formatDate(val, 'Asia/Tokyo', 'yyyy-MM-dd');
  return String(val).trim();
}

/**
 * 既存日勤データ削除 (18列構造)
 */
function _deleteExistingDayShifts(sheet, yearMonth) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;

  const dayShiftSet = new Set(DAY_SHIFT_TYPES);
  const data = sheet.getRange(2, 1, lastRow - 1, 18).getValues();
  const rowsToDelete = [];

  data.forEach((row, idx) => {
    const rowYm = _normYM(row[1] ? Utilities.formatDate(new Date(row[1]), 'Asia/Tokyo', 'yyyy-MM') : '');
    const shift = String(row[8]).trim();
    if (rowYm === yearMonth && dayShiftSet.has(shift)) {
      rowsToDelete.push(idx + 2);
    }
  });

  // 連続行を一括削除（高速化）
  if (rowsToDelete.length === 0) return 0;
  rowsToDelete.sort((a, b) => b - a);
  let i = 0;
  while (i < rowsToDelete.length) {
    let endRow = rowsToDelete[i];
    let count = 1;
    while (i + 1 < rowsToDelete.length && rowsToDelete[i + 1] === endRow - count) {
      count++;
      i++;
    }
    sheet.deleteRows(endRow - count + 1, count);
    i++;
  }
  return rowsToDelete.length;
}

/**
 * 配置結果をT_シフト確定に書き込み (18列構造)
 */
function _writePlacements(sheet, placements, yearMonth) {
  const lastRow = sheet.getLastRow();
  let maxSeq = 0;
  if (lastRow > 1) {
    const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    const prefix = `SHIFT_${yearMonth}_D`;
    ids.forEach(r => {
      const s = String(r[0] || '');
      if (s.indexOf(prefix) === 0) {
        const n = parseInt(s.slice(prefix.length), 10);
        if (!isNaN(n) && n > maxSeq) maxSeq = n;
      }
    });
  }

  const now = new Date();
  const rows = placements.map((p, i) => {
    const shiftId = `SHIFT_${yearMonth}_D${String(maxSeq + i + 1).padStart(4, '0')}`;
    return [
      shiftId,            // A shift_id
      p.date,             // B 日付
      p.unit_id,          // C unit_id
      p.jigyosho,         // D 事業所名
      p.facility,         // E 施設名
      p.unitName,         // F ユニット名
      p.staff_id,         // G staff_id
      p.name,             // H 氏名
      p.shiftType,        // I シフト種別
      SHIFT_PATTERNS[p.shiftType] ? SHIFT_PATTERNS[p.shiftType].start : '',  // J 開始時刻
      SHIFT_PATTERNS[p.shiftType] ? SHIFT_PATTERNS[p.shiftType].end : '',    // K 終了時刻
      p.count,            // L 配置カウント
      p.status,           // M ステータス ★旧N
      now,                // N 更新日時 ★旧O
      p.startTime,        // O 実開始時刻 ★旧P
      p.endTime,          // P 実終了時刻 ★旧Q
      p.nightHours,       // Q 夜勤換算時間 ★旧R
      p.dayHours          // R 日勤換算時間 ★旧S
    ];
  });

  const startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, rows.length, 18).setValues(rows);
  sheet.getRange(startRow, 2, rows.length, 1).setNumberFormat('@');
}

function _printSummary(placements, skips) {
  const byJig = {};
  placements.forEach(p => {
    if (!byJig[p.jigyosho]) byJig[p.jigyosho] = {};
    byJig[p.jigyosho][p.shiftType] = (byJig[p.jigyosho][p.shiftType] || 0) + 1;
  });
  Logger.log('\n【事業所 × シフト種別 配置数】');
  Object.keys(byJig).sort().forEach(jig => {
    const parts = Object.keys(byJig[jig]).sort().map(s => `${s}:${byJig[jig][s]}`);
    Logger.log(`  ${jig}: ${parts.join(' / ')}`);
  });

  if (skips.length > 0) {
    const byReason = {};
    skips.forEach(s => {
      const key = s.reason.split(' (')[0];
      byReason[key] = (byReason[key] || 0) + 1;
    });
    Logger.log('\n【スキップ理由の分布】');
    Object.keys(byReason).sort((a,b) => byReason[b] - byReason[a]).forEach(k => {
      Logger.log(`  ${k}: ${byReason[k]}件`);
    });

    Logger.log('\n【スキップ サンプル(先頭10件)】');
    skips.slice(0, 10).forEach(s => {
      Logger.log(`  ${s.req.date} ${s.req.shift} ${s.req.name}(${s.req.staff_id}) @ ${s.req.mainFac} → ${s.reason}`);
    });
  }
}

/**
 * 検証: 配置結果の統計を出力 (18列構造)
 */
function checkDayShiftResult() {
  const ym = '2026-05';
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('T_シフト確定');
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 18).getValues();
  const dayShiftSet = new Set(DAY_SHIFT_TYPES);

  const dayRecords = data.filter(row => {
    const rowYm = _normYM(row[1] ? Utilities.formatDate(new Date(row[1]), 'Asia/Tokyo', 'yyyy-MM') : '');
    const shift = String(row[8]).trim();
    return rowYm === ym && dayShiftSet.has(shift);
  });

  Logger.log(`=== ${ym} 日勤配置結果 ===`);
  Logger.log(`総件数: ${dayRecords.length}件`);

  const byJig = {};
  dayRecords.forEach(row => {
    const jig = String(row[3]).trim();
    const dayH = parseFloat(row[17]) || 0;  // R列(17) 日勤換算
    if (!byJig[jig]) byJig[jig] = 0;
    byJig[jig] += dayH;
  });
  Logger.log('\n【事業所別 日勤換算時間】');
  Object.keys(byJig).sort().forEach(jig => {
    Logger.log(`  ${jig}: ${byJig[jig].toFixed(1)}h`);
  });
}