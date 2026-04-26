// ============================================================
// T_希望提出の診断
// - セカンドE-stがメイン施設のスタッフが日勤希望を出してるか確認
// ============================================================

function diagnoseSecondEstRequests() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const zenLeft = String.fromCharCode(0xFF08);
  const zenRight = String.fromCharCode(0xFF09);
  const secondEst = 'ルーデンス上板橋E-st' + zenLeft + '板橋北区セカンド' + zenRight;

  Logger.log('========== セカンドE-st スタッフ診断 ==========');
  Logger.log(`対象施設: "${secondEst}"`);

  const staffSheet = ss.getSheetByName('M_スタッフ');
  const staffData = staffSheet.getRange(2, 1, staffSheet.getLastRow() - 1, 20).getValues();

  const secondEstStaff = [];
  staffData.forEach(row => {
    const retired = String(row[16] || '').toUpperCase() === 'TRUE';
    if (retired) return;
    const mainFac = String(row[9] || '').trim();
    if (mainFac === secondEst) {
      secondEstStaff.push({
        staff_id: String(row[0]),
        name: String(row[1]),
        mainFac,
        shiftKubun: String(row[12] || ''),
        allowedShifts: String(row[13] || '')
      });
    }
  });

  Logger.log(`\nセカンドE-stメイン: ${secondEstStaff.length}名`);
  if (secondEstStaff.length > 0) {
    Logger.log('先頭5名:');
    secondEstStaff.slice(0, 5).forEach(s => {
      Logger.log(`  ID${s.staff_id} ${s.name} / 区分:${s.shiftKubun} / 許可:${s.allowedShifts}`);
    });
  }

  const reqSheet = ss.getSheetByName('T_希望提出');
  const reqData = reqSheet.getRange(2, 1, reqSheet.getLastRow() - 1, 13).getValues();

  const secondEstIds = new Set(secondEstStaff.map(s => s.staff_id));
  const theirRequests = [];
  const dayShiftSet = new Set(['早出8h', '早出4h', '遅出8h', '遅出4h']);

  reqData.forEach(row => {
    const rowYm = row[4] instanceof Date
      ? Utilities.formatDate(row[4], 'Asia/Tokyo', 'yyyy-MM')
      : String(row[4]).trim();
    if (rowYm !== '2026-05') return;

    const staffId = String(row[2]);
    if (!secondEstIds.has(staffId)) return;

    const shift = String(row[6]).trim();
    if (!dayShiftSet.has(shift)) return;

    theirRequests.push({
      submitId: String(row[0]),
      staffId,
      name: String(row[3]),
      date: row[5] instanceof Date
        ? Utilities.formatDate(row[5], 'Asia/Tokyo', 'yyyy-MM-dd')
        : String(row[5]),
      shift,
      reqMainFac: String(row[7] || '').trim(),
      reqSecondFac: String(row[8] || '').trim(),
      reqSubFacs: String(row[9] || '').trim()
    });
  });

  Logger.log(`\n【2026-05 日勤希望】`);
  Logger.log(`対象スタッフからの希望: ${theirRequests.length}件`);

  const byReqMain = {};
  theirRequests.forEach(r => {
    byReqMain[r.reqMainFac] = (byReqMain[r.reqMainFac] || 0) + 1;
  });
  Logger.log('\n希望H列(メイン施設)の分布:');
  Object.keys(byReqMain).sort().forEach(k => {
    Logger.log(`  "${k}": ${byReqMain[k]}件`);
  });

  Logger.log('\n希望サンプル(先頭5件):');
  theirRequests.slice(0, 5).forEach(r => {
    Logger.log(`  ${r.date} ${r.shift} ${r.name}(ID${r.staffId}) 希望メイン="${r.reqMainFac}"`);
  });
}
