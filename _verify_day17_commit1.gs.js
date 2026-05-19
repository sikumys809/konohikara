/**
 * ★Day 17 Commit 1 検証関数
 * GASエディタから実行: _verifyDay17_Commit1()
 */
function _verifyDay17_Commit1() {
  const errors = [];
  const expectedShifts = ['夜勤A', '夜勤B', '夜勤C', '夜勤D', '夜勤E', '夜勤F', '夜勤G'];
  const expected = {
    '夜勤A': { start: '17:30', end: '05:00', nightHours: 3.5, dayHours: 4.5, breakMinutes: 210 },
    '夜勤B': { start: '20:00', end: '05:00', nightHours: 3.5, dayHours: 2.0, breakMinutes: 210 },
    '夜勤C': { start: '20:00', end: '06:30', nightHours: 3.5, dayHours: 3.5, breakMinutes: 210 },
    '夜勤D': { start: '20:00', end: '07:30', nightHours: 3.5, dayHours: 4.5, breakMinutes: 210 },
    '夜勤E': { start: '22:00', end: '07:00', nightHours: 3.5, dayHours: 2.0, breakMinutes: 210 },
    '夜勤F': { start: '22:00', end: '08:00', nightHours: 3.5, dayHours: 3.0, breakMinutes: 210 },
    '夜勤G': { start: '22:00', end: '09:30', nightHours: 3.5, dayHours: 4.5, breakMinutes: 210 }
  };
  Logger.log('=== [A1] SHIFT_PATTERNS ===');
  try {
    expectedShifts.forEach(function(s) {
      const got = SHIFT_PATTERNS[s];
      if (!got) { errors.push('SHIFT_PATTERNS[' + s + ']: 未定義'); Logger.log('  ❌ ' + s + ': 未定義'); return; }
      const exp = expected[s];
      let ok = true;
      Object.keys(exp).forEach(function(k) {
        if (got[k] !== exp[k]) { errors.push('SHIFT_PATTERNS[' + s + '].' + k + ': 期待=' + exp[k] + ', 実値=' + got[k]); ok = false; }
      });
      Logger.log('  ' + (ok ? '✅' : '❌') + ' ' + s + ': start=' + got.start + ', end=' + got.end + ', nightH=' + got.nightHours + ', dayH=' + got.dayHours + ', breakMin=' + got.breakMinutes);
    });
  } catch (e) { errors.push('SHIFT_PATTERNS エラー: ' + e.message); }
  Logger.log('');
  Logger.log('=== [A6] SHIFT_BREAKS ===');
  try {
    expectedShifts.forEach(function(s) {
      const got = SHIFT_BREAKS[s];
      if (!got || !Array.isArray(got) || got.length === 0) { errors.push('SHIFT_BREAKS[' + s + ']: 未定義'); Logger.log('  ❌ ' + s); return; }
      const b = got[0];
      const ok = b.start === '01:00' && b.end === '04:30' && got.length === 1;
      if (!ok) errors.push('SHIFT_BREAKS[' + s + ']: 不正');
      Logger.log('  ' + (ok ? '✅' : '❌') + ' ' + s + ': ' + JSON.stringify(got));
    });
  } catch (e) { errors.push('SHIFT_BREAKS エラー: ' + e.message); }
  Logger.log('');
  Logger.log('=== 結論 ===');
  if (errors.length === 0) Logger.log('✅ Commit 1 検証: 全項目OK');
  else { Logger.log('❌ Commit 1 検証: ' + errors.length + '件エラー'); errors.forEach(function(e) { Logger.log('  - ' + e); }); }
  return { ok: errors.length === 0, errors: errors };
}
