// ============================================================
// 日勤エンジン ボトルネック計測
// - 既存エンジンを改変せず、runDayShiftEngine_timed() で時間測定
// - 各フェーズの所要時間をログ出力
// ============================================================

function runDayShiftEngine_timed() {
  const yearMonth = '2026-05';
  const timings = [];
  const markers = {};

  function mark(label) {
    markers[label] = Date.now();
  }

  function elapsed(from, to) {
    const dur = (markers[to] - markers[from]) / 1000;
    timings.push({ label: `${from} -> ${to}`, dur });
    return dur.toFixed(2);
  }

  Logger.log(`========== ボトルネック計測 開始 ==========`);
  mark('全体開始');

  // ====== Phase 1: データ読込 ======
  mark('P1読込_開始');

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  mark('P1a_SS取得');

  // スタッフ
  const staffSheet = ss.getSheetByName('M_スタッフ');
  const staffLast = staffSheet.getLastRow();
  const staffData = staffSheet.getRange(2, 1, staffLast - 1, 20).getValues();
  const staffMap = {};
  staffData.forEach(row => {
    const sid = String(row[0]).trim();
    const retired = String(row[16] || '').toUpperCase() === 'TRUE';
    if (retired) return;
    staffMap[sid] = {
      staff_id: sid,
      name: String(row[1]),
      mainFacility: String(row[9] || ''),
      shiftKubun: String(row[12] || ''),
      allowedShifts: String(row[13] || '').split(',').map(s => s.trim()).filter(Boolean),
      mainRoles: String(row[19] || '世話人')
    };
  });

  mark('P1b_スタッフ');

  // ユニット(M_ユニット)
  const unitSheet = ss.getSheetByName('M_ユニット');
  const unitData = unitSheet ? unitSheet.getRange(2, 1, unitSheet.getLastRow() - 1, 10).getValues() : [];
  const facilityMap = {};
  unitData.forEach(row => {
    const facilityName = String(row[3] || '').trim();
    const jigyosho = String(row[4] || '').trim();
    if (facilityName && jigyosho) facilityMap[facilityName] = jigyosho;
  });

  mark('P1c_ユニット');

  // 希望
  const reqSheet = ss.getSheetByName('T_希望提出');
  const reqLast = reqSheet.getLastRow();
  const reqData = reqLast > 1 ? reqSheet.getRange(2, 1, reqLast - 1, 20).getValues() : [];

  const dayShiftSet = new Set(['早出8h', '早出4h', '遅出8h', '遅出4h']);
  const reqMap = {};  // staffId -> dateKey -> [shiftTypes]

  reqData.forEach(row => {
    const rowYm = row[1] instanceof Date
      ? Utilities.formatDate(row[1], 'Asia/Tokyo', 'yyyy-MM')
      : String(row[1]).substring(0, 7);
    if (rowYm !== yearMonth) return;

    const shift = String(row[4]).trim();
    if (!dayShiftSet.has(shift)) return;

    const sid = String(row[3]);
    const dateKey = row[1] instanceof Date
      ? Utilities.formatDate(row[1], 'Asia/Tokyo', 'yyyy-MM-dd')
      : String(row[1]);

    if (!reqMap[sid]) reqMap[sid] = {};
    if (!reqMap[sid][dateKey]) reqMap[sid][dateKey] = [];
    reqMap[sid][dateKey].push(shift);
  });

  mark('P1d_希望');

  // シフト確定
  const cfSheet = ss.getSheetByName('T_シフト確定');
  const cfLast = cfSheet.getLastRow();
  const cfData = cfLast > 1 ? cfSheet.getRange(2, 1, cfLast - 1, 19).getValues() : [];

  mark('P1e_確定読込');

  // 既存の日勤行を特定
  const dayRowsToDelete = [];
  const nightCfMap = {};

  cfData.forEach((row, idx) => {
    const rowYm = row[1] instanceof Date
      ? Utilities.formatDate(row[1], 'Asia/Tokyo', 'yyyy-MM')
      : String(row[1]).substring(0, 7);
    if (rowYm !== yearMonth) return;

    const shift = String(row[8]).trim();
    const rowNum = idx + 2;
    const sid = String(row[6]);
    const dateKey = row[1] instanceof Date
      ? Utilities.formatDate(row[1], 'Asia/Tokyo', 'yyyy-MM-dd')
      : String(row[1]);

    if (dayShiftSet.has(shift)) {
      dayRowsToDelete.push(rowNum);
    } else {
      if (!nightCfMap[sid]) nightCfMap[sid] = {};
      if (!nightCfMap[sid][dateKey]) nightCfMap[sid][dateKey] = [];
      nightCfMap[sid][dateKey].push(shift);
    }
  });

  mark('P1f_既存分析');

  // ====== Phase 2: 既存日勤削除 ======
  mark('P2削除_開始');

  // 逆順削除
  dayRowsToDelete.sort((a, b) => b - a).forEach(rowNum => {
    cfSheet.deleteRow(rowNum);
  });
  SpreadsheetApp.flush();

  mark('P2削除_完了');

  // ====== Phase 3: 配置ロジック ======
  mark('P3配置_開始');

  const newPlacements = [];
  let skipped = 0;
  const reqEntries = [];

  Object.keys(reqMap).forEach(sid => {
    Object.keys(reqMap[sid]).forEach(dateKey => {
      reqMap[sid][dateKey].forEach(shiftType => {
        reqEntries.push({ sid, dateKey, shiftType });
      });
    });
  });

  // 既存確定の衝突チェック用マップ (nightCfMap から作成済み)
  const placedMap = {};  // staffId -> dateKey -> [shift]
  Object.keys(nightCfMap).forEach(sid => {
    placedMap[sid] = {};
    Object.keys(nightCfMap[sid]).forEach(dk => {
      placedMap[sid][dk] = nightCfMap[sid][dk].slice();
    });
  });

  mark('P3a_準備');

  reqEntries.forEach(entry => {
    const staff = staffMap[entry.sid];
    if (!staff) { skipped++; return; }

    // 物理NG検証(簡易)
    if (!placedMap[entry.sid]) placedMap[entry.sid] = {};
    const existing = placedMap[entry.sid][entry.dateKey] || [];

    // 同日に夜勤がある
    const hasNight = existing.some(s => s.indexOf('夜勤') !== -1);
    if (hasNight) { skipped++; return; }

    // 同日に既に日勤がある(8h上限超)
    const dayHoursExisting = existing.filter(s => dayShiftSet.has(s))
      .reduce((sum, s) => sum + (s.indexOf('8h') !== -1 ? 8 : 4), 0);
    const newH = entry.shiftType.indexOf('8h') !== -1 ? 8 : 4;
    if (dayHoursExisting + newH > 8) { skipped++; return; }

    // メイン施設取得 → 事業所変換
    const mainFac = staff.mainFacility;
    const jigyosho = facilityMap[mainFac] || mainFac;

    // 配置確定
    newPlacements.push({
      sid: entry.sid,
      name: staff.name,
      dateKey: entry.dateKey,
      shiftType: entry.shiftType,
      facility: mainFac,
      jigyosho: jigyosho
    });

    placedMap[entry.sid][entry.dateKey] = existing.concat([entry.shiftType]);
  });

  mark('P3配置_完了');

  // ====== Phase 4: 一括書込 ======
  mark('P4書込_開始');

  if (newPlacements.length > 0) {
    const startRow = cfSheet.getLastRow() + 1;

    const rows = newPlacements.map((p, i) => {
      const shiftId = `SHIFT_${yearMonth}_D${String(i + 1).padStart(4, '0')}`;
      const timeInfo = _getTimeInfo(p.shiftType);
      return [
        shiftId,               // A shift_id
        p.dateKey,             // B 日付
        '',                    // C unit_id
        p.jigyosho,            // D 事業所
        p.facility,            // E 施設
        '',                    // F ユニット
        p.sid,                 // G staff_id
        p.name,                // H 氏名
        p.shiftType,           // I シフト種別
        timeInfo.start,        // J 開始時刻
        timeInfo.end,          // K 終了時刻
        1,                     // L 稼働フラグ
        '',                    // M アラート
        '確定',                 // N ステータス
        new Date(),            // O 更新日時
        timeInfo.start,        // P 実開始
        timeInfo.end,          // Q 実終了
        0,                     // R 夜勤時間
        timeInfo.dayH          // S 日勤時間
      ];
    });

    cfSheet.getRange(startRow, 2, rows.length, 1).setNumberFormat('@');  // 日付列文字列固定
    cfSheet.getRange(startRow, 1, rows.length, 19).setValues(rows);
    SpreadsheetApp.flush();
  }

  mark('P4書込_完了');

  // ====== 最終レポート ======
  mark('全体終了');

  Logger.log(`\n========== 結果 ==========`);
  Logger.log(`配置: ${newPlacements.length}件`);
  Logger.log(`スキップ: ${skipped}件`);
  Logger.log(`希望総数: ${reqEntries.length}件`);

  Logger.log(`\n========== フェーズ別時間 ==========`);

  const phases = [
    ['P1a_SS取得', '全体開始', 'P1a_SS取得'],
    ['P1b_スタッフ', 'P1a_SS取得', 'P1b_スタッフ'],
    ['P1c_ユニット', 'P1b_スタッフ', 'P1c_ユニット'],
    ['P1d_希望', 'P1c_ユニット', 'P1d_希望'],
    ['P1e_確定読込', 'P1d_希望', 'P1e_確定読込'],
    ['P1f_既存分析', 'P1e_確定読込', 'P1f_既存分析'],
    ['P2削除', 'P2削除_開始', 'P2削除_完了'],
    ['P3配置_準備', 'P3配置_開始', 'P3a_準備'],
    ['P3配置_本処理', 'P3a_準備', 'P3配置_完了'],
    ['P4書込', 'P4書込_開始', 'P4書込_完了'],
  ];

  let total = 0;
  phases.forEach(p => {
    const dur = (markers[p[2]] - markers[p[1]]) / 1000;
    total += dur;
    const bar = '█'.repeat(Math.ceil(dur));
    Logger.log(`  ${p[0].padEnd(20)}: ${dur.toFixed(2).padStart(8)}秒  ${bar}`);
  });

  const totalActual = (markers['全体終了'] - markers['全体開始']) / 1000;
  Logger.log(`  ${'合計'.padEnd(20)}: ${totalActual.toFixed(2).padStart(8)}秒`);

  Logger.log(`\n========== 内訳の比率 ==========`);
  phases.forEach(p => {
    const dur = (markers[p[2]] - markers[p[1]]) / 1000;
    const pct = (dur / totalActual * 100).toFixed(1);
    Logger.log(`  ${p[0].padEnd(20)}: ${pct}%`);
  });
}

function _getTimeInfo(shiftType) {
  const map = {
    '早出8h': { start: '06:00', end: '15:00', dayH: 8 },
    '早出4h': { start: '06:00', end: '10:00', dayH: 4 },
    '遅出8h': { start: '13:00', end: '22:00', dayH: 8 },
    '遅出4h': { start: '13:00', end: '17:00', dayH: 4 },
  };
  return map[shiftType] || { start: '09:00', end: '18:00', dayH: 8 };
}