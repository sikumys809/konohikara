// ============================================================
// Step 4-2: 日勤自動割当エンジン v1
// - 希望ベース配置（メイン固定）
// - 施設→事業所変換はM_ユニットから取得
// - 物理NG検証: 1日8h上限 / 夜勤連続NG / 自己内主職種衝突
// - 既存日勤データは事前削除 (Q1=A: クリーン再生成)
//
// 実行関数: runDayShiftEngine(yearMonth)
//   例: runDayShiftEngine('2026-05')
// ============================================================

const DAY_SHIFT_TYPES = ['早出8h', '早出4h', '遅出8h', '遅出4h'];
const NIGHT_SHIFT_TYPES = ['夜勤A', '夜勤B', '夜勤C'];

/**
 * メインエントリ
 */
function runDayShiftEngine(yearMonth) {
  const ym = yearMonth || '2026-05';
  const startTs = Date.now();
  Logger.log(`========== 日勤エンジン v1 開始 (${ym}) ==========`);

  const ctx = _loadEngineContext(ym);
  Logger.log(`希望: ${ctx.requests.length}件 / スタッフ: ${Object.keys(ctx.staffMap).length}名 / 施設→事業所マップ: ${Object.keys(ctx.facToJigMap).length}施設`);

  // 既存の日勤データを削除
  const deleted = _deleteExistingDayShifts(ctx.confirmedSheet, ym);
  Logger.log(`既存日勤データ ${deleted}件削除`);

  // 配置処理
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

  // 書き込み
  if (placements.length > 0) {
    _writePlacements(ctx.confirmedSheet, placements, ym);
  }

  // サマリ
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

/**
 * コンテキスト（全データ）をロード
 */
function _loadEngineContext(ym) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // M_スタッフ
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

  // M_ユニット: 施設名 → 事業所名マップ
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

  // T_希望提出（日勤のみ + 指定年月）
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

  // T_シフト確定
  const confirmedSheet = ss.getSheetByName('T_シフト確定');

  // 既存の夜勤配置（同月）を読み込み（連続勤務NG検証用）
  const existingNight = {};  // staff_id -> [{date, shift}]
  if (confirmedSheet.getLastRow() > 1) {
    const cfData = confirmedSheet.getRange(2, 1, confirmedSheet.getLastRow() - 1, 19).getValues();
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

/**
 * 1件の希望を配置試行
 */
function _tryPlace(req, ctx, placements) {
  const staff = ctx.staffMap[req.staff_id];
  if (!staff) {
    return { ok: false, reason: `スタッフID ${req.staff_id} がM_スタッフに無い or 退職者` };
  }

  // 事業所名を取得
  const jigyosho = ctx.facToJigMap[req.mainFac];
  if (!jigyosho) {
    return { ok: false, reason: `施設 "${req.mainFac}" がM_ユニットに無い` };
  }

  // 物理NG検証
  const existingOnSameDay = placements.filter(p =>
    p.staff_id === staff.staff_id && p.date === req.date
  );

  // NG検証1: 同日の夜勤との衝突
  const nightToday = (ctx.existingNight[staff.staff_id] || []).filter(n => n.date === req.date);
  if (nightToday.length > 0) {
    return { ok: false, reason: `同日に夜勤あり (${nightToday[0].shift})` };
  }

  // NG検証2: 前日夜勤B/Cの連続チェック
  const prevDate = _prevDate(req.date);
  const prevNightBorC = (ctx.existingNight[staff.staff_id] || []).filter(
    n => n.date === prevDate && (n.shift === '夜勤B' || n.shift === '夜勤C')
  );
  if (prevNightBorC.length > 0) {
    return { ok: false, reason: `前日夜勤${prevNightBorC[0].shift.slice(-1)}と連続` };
  }

  // NG検証3: 同日の日勤時間衝突
  const newTimes = _getShiftTimeRange(req.shift);
  for (const ex of existingOnSameDay) {
    const exTimes = _getShiftTimeRange(ex.shiftType);
    if (_rangesOverlap(newTimes, exTimes)) {
      return { ok: false, reason: `同日既配置 ${ex.shiftType} と時間衝突` };
    }
  }

  // NG検証4: 1日8h上限チェック
  const hoursInfo = calcShiftHours(req.shift, null, null);
  const existingHours = existingOnSameDay.reduce((sum, ex) => sum + (ex.nightHours + ex.dayHours), 0);
  if (existingHours + hoursInfo.totalHours > 8.01) {
    return { ok: false, reason: `1日8h上限超え (既${existingHours.toFixed(1)}h + 新${hoursInfo.totalHours}h)` };
  }

  // 配置決定
  const unitId = '';      // 日勤はユニット拘束なし
  const unitName = '';
  const startStr = hoursInfo.actualStart;
  const endStr = hoursInfo.actualEnd;

  const record = {
    date: req.date,
    unit_id: unitId,
    jigyosho: jigyosho,
    facility: req.mainFac,
    unitName: unitName,
    staff_id: staff.staff_id,
    name: staff.name,
    shiftType: req.shift,
    startTime: startStr,
    endTime: endStr,
    count: 1,
    alert: '',
    status: '確定',
    nightHours: hoursInfo.nightHours,
    dayHours: hoursInfo.dayHours
  };

  return { ok: true, record };
}

/**
 * シフト種別の時間帯(分)を返す。休憩込みの単純な開始-終了
 */
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

/**
 * 時間帯が重なるか
 */
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
 * 既存の日勤データ(指定年月)を削除
 */
function _deleteExistingDayShifts(sheet, yearMonth) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;

  const dayShiftSet = new Set(DAY_SHIFT_TYPES);
  const data = sheet.getRange(2, 1, lastRow - 1, 19).getValues();
  const rowsToDelete = [];

  data.forEach((row, idx) => {
    const rowYm = _normYM(row[1] ? Utilities.formatDate(new Date(row[1]), 'Asia/Tokyo', 'yyyy-MM') : '');
    const shift = String(row[8]).trim();
    if (rowYm === yearMonth && dayShiftSet.has(shift)) {
      rowsToDelete.push(idx + 2);
    }
  });

  rowsToDelete.reverse().forEach(rn => sheet.deleteRow(rn));
  return rowsToDelete.length;
}

/**
 * 配置結果をT_シフト確定に書き込み
 */
function _writePlacements(sheet, placements, yearMonth) {
  // shift_id採番: 既存の最大Dシリーズ連番+1
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
      p.alert,            // M アラート種別
      p.status,           // N ステータス
      now,                // O 更新日時
      p.startTime,        // P 実開始時刻
      p.endTime,          // Q 実終了時刻
      p.nightHours,       // R 夜勤換算時間
      p.dayHours          // S 日勤換算時間
    ];
  });

  const startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, rows.length, 19).setValues(rows);

  // 日付列を文字列書式に
  sheet.getRange(startRow, 2, rows.length, 1).setNumberFormat('@');
}

/**
 * サマリ出力
 */
function _printSummary(placements, skips) {
  // 事業所×シフト別
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

  // スキップ理由の集計
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

    // 先頭10件のサンプル
    Logger.log('\n【スキップ サンプル(先頭10件)】');
    skips.slice(0, 10).forEach(s => {
      Logger.log(`  ${s.req.date} ${s.req.shift} ${s.req.name}(${s.req.staff_id}) @ ${s.req.mainFac} → ${s.reason}`);
    });
  }
}

/**
 * 検証: 配置結果の統計を出力
 */
function checkDayShiftResult() {
  const ym = '2026-05';
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('T_シフト確定');
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 19).getValues();
  const dayShiftSet = new Set(DAY_SHIFT_TYPES);

  const dayRecords = data.filter(row => {
    const rowYm = _normYM(row[1] ? Utilities.formatDate(new Date(row[1]), 'Asia/Tokyo', 'yyyy-MM') : '');
    const shift = String(row[8]).trim();
    return rowYm === ym && dayShiftSet.has(shift);
  });

  Logger.log(`=== ${ym} 日勤配置結果 ===`);
  Logger.log(`総件数: ${dayRecords.length}件`);

  // 事業所別時間集計
  const byJig = {};
  dayRecords.forEach(row => {
    const jig = String(row[3]).trim();
    const dayH = parseFloat(row[18]) || 0;
    if (!byJig[jig]) byJig[jig] = 0;
    byJig[jig] += dayH;
  });
  Logger.log('\n【事業所別 日勤換算時間】');
  Object.keys(byJig).sort().forEach(jig => {
    Logger.log(`  ${jig}: ${byJig[jig].toFixed(1)}h`);
  });
}
function debugDayShiftData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('T_シフト確定');
  const last = sheet.getLastRow();
  Logger.log(`T_シフト確定 総行数: ${last}`);
  
  // 末尾5行を確認(日勤が入っているはず)
  if (last > 1) {
    const from = Math.max(2, last - 4);
    const data = sheet.getRange(from, 1, last - from + 1, 19).getValues();
    Logger.log('\n=== 末尾5行 ===');
    data.forEach((row, i) => {
      Logger.log(`\n行${from + i}:`);
      Logger.log(`  A shift_id: "${row[0]}"`);
      Logger.log(`  B 日付: "${row[1]}" (type=${typeof row[1]}, isDate=${row[1] instanceof Date})`);
      Logger.log(`  D 事業所名: "${row[3]}"`);
      Logger.log(`  E 施設名: "${row[4]}"`);
      Logger.log(`  G staff_id: "${row[6]}"`);
      Logger.log(`  H 氏名: "${row[7]}"`);
      Logger.log(`  I シフト種別: "${row[8]}"`);
      Logger.log(`  R 夜勤換算: ${row[17]}`);
      Logger.log(`  S 日勤換算: ${row[18]}`);
    });
  }
  
  // 日勤シフト種別の件数確認
  const allData = sheet.getRange(2, 1, last - 1, 19).getValues();
  const shiftCounts = {};
  allData.forEach(row => {
    const shift = String(row[8]).trim();
    shiftCounts[shift] = (shiftCounts[shift] || 0) + 1;
  });
  Logger.log('\n=== シフト種別別件数(T_シフト確定) ===');
  Object.keys(shiftCounts).sort().forEach(k => {
    Logger.log(`  "${k}": ${shiftCounts[k]}`);
  });
}
function deepCheckConfirmed() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('T_シフト確定');
  const last = sheet.getLastRow();
  Logger.log(`総行数: ${last}`);
  
  const data = sheet.getRange(2, 1, last - 1, 19).getValues();
  
  // shift_id のプレフィックスで分類
  const prefixCounts = {};
  let emptyShiftId = 0;
  let emptyShift = 0;
  let dayRecords = [];
  
  data.forEach((row, idx) => {
    const shiftId = String(row[0] || '').trim();
    const shift = String(row[8] || '').trim();
    
    if (!shiftId) emptyShiftId++;
    if (!shift) emptyShift++;
    
    // プレフィックス抽出（SHIFT_2026-05_D0001 → SHIFT_2026-05_D）
    const match = shiftId.match(/^(SHIFT_\d{4}-\d{2}_D?)/);
    const prefix = match ? match[1] : '(other)';
    prefixCounts[prefix] = (prefixCounts[prefix] || 0) + 1;
    
    // 日勤シフト種別があれば記録
    if (['早出8h', '早出4h', '遅出8h', '遅出4h'].indexOf(shift) !== -1) {
      dayRecords.push({ row: idx + 2, shiftId, shift, date: row[1] });
    }
  });
  
  Logger.log('\n=== shift_id プレフィックス別件数 ===');
  Object.keys(prefixCounts).sort().forEach(k => Logger.log(`  "${k}": ${prefixCounts[k]}`));
  Logger.log(`\n空のshift_id: ${emptyShiftId}件`);
  Logger.log(`空のシフト種別: ${emptyShift}件`);
  Logger.log(`日勤レコード数: ${dayRecords.length}`);
  
  if (dayRecords.length > 0) {
    Logger.log('\n=== 日勤レコード サンプル ===');
    dayRecords.slice(0, 5).forEach(r => {
      Logger.log(`  行${r.row}: ${r.shiftId} / ${r.shift} / ${r.date}`);
    });
  }
}
// ============================================================
// デバッグ用: 書込検証
// T_シフト確定 に1件だけ書き込んで、データが入るか確認する
// ============================================================

function debugWriteOneRow() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('T_シフト確定');
  
  // 書込前の状態
  const beforeLast = sheet.getLastRow();
  Logger.log(`書込前: ${beforeLast}行`);
  
  // 1件だけ書き込む
  const now = new Date();
  const testRow = [
    'SHIFT_2026-05_DTEST',  // A shift_id
    '2026-05-01',            // B 日付 (文字列)
    '',                      // C unit_id
    'GHコノヒカラ板橋北区',  // D 事業所名
    'ルーデンス新板橋Ⅱ',    // E 施設名
    '',                      // F ユニット名
    '13',                    // G staff_id
    '水野永吉',              // H 氏名
    '早出8h',                // I シフト種別
    '06:00',                 // J 開始時刻
    '15:00',                 // K 終了時刻
    1,                       // L 配置カウント
    '',                      // M アラート
    '確定',                  // N ステータス
    now,                     // O 更新日時
    '06:00',                 // P 実開始
    '15:00',                 // Q 実終了
    0,                       // R 夜勤換算
    8                        // S 日勤換算
  ];
  
  const startRow = beforeLast + 1;
  Logger.log(`書込開始行: ${startRow}`);
  
  try {
    sheet.getRange(startRow, 1, 1, 19).setValues([testRow]);
    Logger.log('✅ setValues成功');
  } catch (e) {
    Logger.log('❌ setValues失敗: ' + e.message);
  }
  
  SpreadsheetApp.flush();
  
  // 書込後の状態
  const afterLast = sheet.getLastRow();
  Logger.log(`書込後: ${afterLast}行 (差分=${afterLast - beforeLast})`);
  
  // 書き込んだ行を読み戻す
  if (afterLast >= startRow) {
    const readBack = sheet.getRange(startRow, 1, 1, 19).getValues()[0];
    Logger.log('\n=== 書込後の確認(読み戻し) ===');
    readBack.forEach((v, i) => {
      const col = String.fromCharCode(65 + i);
      Logger.log(`  ${col}: "${v}" (type=${typeof v})`);
    });
  }
}

/**
 * 成功したら消す用
 */
function cleanupDebugRow() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('T_シフト確定');
  const last = sheet.getLastRow();
  const data = sheet.getRange(2, 1, last - 1, 1).getValues();
  
  data.forEach((row, idx) => {
    if (String(row[0]) === 'SHIFT_2026-05_DTEST') {
      sheet.deleteRow(idx + 2);
      Logger.log(`テスト行削除: 行${idx + 2}`);
    }
  });
}
function runDayShiftEngineDebug() {
  const ym = '2026-05';
  const startTs = Date.now();
  Logger.log(`========== 日勤エンジンv1(デバッグ版) 開始 (${ym}) ==========`);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('T_シフト確定');
  
  const ctx = _loadEngineContext(ym);
  Logger.log(`希望: ${ctx.requests.length}件`);

  Logger.log(`\n--- 削除前: ${sheet.getLastRow()}行 ---`);
  const deleted = _deleteExistingDayShifts(ctx.confirmedSheet, ym);
  Logger.log(`削除: ${deleted}件`);
  Logger.log(`--- 削除後: ${sheet.getLastRow()}行 ---`);

  const placements = [];
  const skips = [];
  ctx.requests.forEach(req => {
    const result = _tryPlace(req, ctx, placements);
    if (result.ok) placements.push(result.record);
    else skips.push({ req, reason: result.reason });
  });

  Logger.log(`\n配置: ${placements.length}件 / スキップ: ${skips.length}件`);

  if (placements.length > 0) {
    Logger.log(`\n--- 書込前: ${sheet.getLastRow()}行 ---`);
    Logger.log(`書込予定: ${placements.length}件`);
    Logger.log('先頭1件サンプル: ' + JSON.stringify(placements[0]));
    
    try {
      _writePlacements(ctx.confirmedSheet, placements, ym);
      Logger.log('✅ _writePlacements 完了');
    } catch(e) {
      Logger.log('❌ _writePlacements エラー: ' + e.message);
      Logger.log('スタックトレース: ' + e.stack);
    }
    
    SpreadsheetApp.flush();
    Logger.log(`--- 書込後(flush済): ${sheet.getLastRow()}行 ---`);
  }

  Logger.log(`\n========== 完了 (${((Date.now()-startTs)/1000).toFixed(1)}秒) ==========`);
}
function checkTestRow() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('T_シフト確定');
  const last = sheet.getLastRow();
  Logger.log(`総行数: ${last}`);
  
  const data = sheet.getRange(2, 1, last - 1, 9).getValues();
  let found = false;
  data.forEach((row, idx) => {
    if (String(row[0]).indexOf('DTEST') !== -1) {
      Logger.log(`✅ テスト行発見: 行${idx+2}: ${row[0]}`);
      found = true;
    }
  });
  if (!found) Logger.log('❌ テスト行が削除されてる');
}