
function debug_check_unit_facilities() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('M_ユニット');
  const data = sheet.getDataRange().getValues();
  const facs = {};
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    const jig = String(data[i][1] || '').trim();
    const fac = String(data[i][3] || '').trim();
    if (!fac) continue;
    if (!facs[fac]) facs[fac] = [];
    if (facs[fac].indexOf(jig) === -1) facs[fac].push(jig);
  }
  Logger.log('=== M_ユニット 施設→事業所 全マップ ===');
  Object.keys(facs).sort().forEach(function(f) {
    Logger.log('  [' + f + '] → ' + facs[f].join(' / '));
  });
  Logger.log('合計 ' + Object.keys(facs).length + '施設');
  
  // E-st 探す
  Logger.log('');
  Logger.log('=== E-st 該当行検索 ===');
  let hit = 0;
  for (let i = 1; i < data.length; i++) {
    const fac = String(data[i][3] || '');
    if (fac.indexOf('上板橋') !== -1 || fac.indexOf('E-st') !== -1 || fac.indexOf('Eーst') !== -1) {
      Logger.log('  row' + (i+1) + ': jigyosho="' + data[i][1] + '" facility="' + data[i][3] + '"');
      hit++;
    }
  }
  if (hit === 0) Logger.log('  該当行なし → M_ユニットに E-st の行が存在しない');
}
