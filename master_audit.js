// ============================================================
// debug_audit_master_v1: マスタ健全性監査 (Day 10)
// 目的: 403名手動入力後のマスタ品質を一発で可視化
// 対象シート: M_スタッフ (退職者除外)
// ============================================================
function debug_audit_master_v1() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('M_スタッフ');
  if (!sheet) { Logger.log('!! M_スタッフ シートなし'); return; }
  const data = sheet.getDataRange().getValues();

  const ALLOWED_ROLES = ['サビ管', '世話人', '生活支援員', '管理者'];
  const ALLOWED_SHIFTS = ['早出8h', '早出4h', '遅出8h', '遅出4h', '夜勤A', '夜勤B', '夜勤C'];

  const issues = {
    missingRequired: [],
    nurseInT: [],
    nurseNoRole: [],
    invalidRole: [],
    invalidShift: [],
    noMainFac: [],
  };
  const roleCount = { 'サビ管': 0, '世話人': 0, '生活支援員': 0, '管理者': 0, '看護師(F列)': 0 };
  const facMatrix = {}; // mainFac別 × 役割別カウント

  let totalActive = 0, totalRetired = 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;
    if (String(row[16]).toUpperCase() === 'TRUE') { totalRetired++; continue; }
    totalActive++;

    const staffId = String(row[0]).trim();
    const name = String(row[1] || '').trim();
    const qualification = String(row[5] || '');
    const mainFac = String(row[9] || '').trim();
    const allowedRaw = String(row[13] || '').trim();
    const mainRolesRaw = String(row[19] || '').trim();
    const mainRoles = mainRolesRaw ? mainRolesRaw.split(',').map(function(s){return s.trim();}).filter(Boolean) : [];
    const allowedShifts = allowedRaw ? allowedRaw.split(',').map(function(s){return s.trim();}).filter(Boolean) : [];
    const isNurseF = qualification.indexOf('看護師') !== -1;

    const ref = 'row' + (i+1) + ' id=' + staffId + ' ' + name;

    // ① 必須列の欠損
    const missing = [];
    if (!mainRolesRaw) missing.push('T主職種');
    if (!allowedRaw) missing.push('N許可シフト');
    if (!mainFac) missing.push('Jメイン施設');
    if (missing.length) issues.missingRequired.push(ref + ' -> 欠損:' + missing.join(','));

    // ② T列に看護師混入 (Day 9確定の禁止事項)
    if (mainRoles.indexOf('看護師') !== -1) {
      issues.nurseInT.push(ref + ' -> mainRoles=[' + mainRoles.join(',') + ']');
    }

    // ③ F列に看護師資格あり、T列空
    if (isNurseF && mainRoles.length === 0) {
      issues.nurseNoRole.push(ref + ' -> 看護師資格保持だがT列空');
    }

    // ④ T列に想定外の値 (typo検出)
    mainRoles.forEach(function(r) {
      if (r === '看護師') return; // ②で既に検出
      if (ALLOWED_ROLES.indexOf(r) === -1) {
        issues.invalidRole.push(ref + ' -> 不明な役割:"' + r + '"');
      }
    });

    // ⑤ N列に想定外の値
    allowedShifts.forEach(function(s) {
      if (ALLOWED_SHIFTS.indexOf(s) === -1) {
        issues.invalidShift.push(ref + ' -> 不明なシフト:"' + s + '"');
      }
    });

    // ⑥ メイン施設なし (Jあるなら通る、再確認用)
    if (!mainFac) issues.noMainFac.push(ref);

    // 役割別カウント
    if (mainRoles.indexOf('サビ管') !== -1) roleCount['サビ管']++;
    if (mainRoles.indexOf('世話人') !== -1) roleCount['世話人']++;
    if (mainRoles.indexOf('生活支援員') !== -1) roleCount['生活支援員']++;
    if (mainRoles.indexOf('管理者') !== -1) roleCount['管理者']++;
    if (isNurseF) roleCount['看護師(F列)']++;

    // メイン施設別マトリクス
    if (mainFac) {
      if (!facMatrix[mainFac]) facMatrix[mainFac] = { 'サビ管': 0, '世話人': 0, '生活支援員': 0, '管理者': 0, '看護師': 0, 'total': 0 };
      facMatrix[mainFac].total++;
      if (mainRoles.indexOf('サビ管') !== -1) facMatrix[mainFac]['サビ管']++;
      if (mainRoles.indexOf('世話人') !== -1) facMatrix[mainFac]['世話人']++;
      if (mainRoles.indexOf('生活支援員') !== -1) facMatrix[mainFac]['生活支援員']++;
      if (mainRoles.indexOf('管理者') !== -1) facMatrix[mainFac]['管理者']++;
      if (isNurseF) facMatrix[mainFac]['看護師']++;
    }
  }

  // ============= 出力 =============
  Logger.log('========= マスタ監査レポート (Day 10) =========');
  Logger.log('稼働: ' + totalActive + '名 / 退職: ' + totalRetired + '名');
  Logger.log('');

  Logger.log('--- ① 必須列欠損 (' + issues.missingRequired.length + '件) ---');
  issues.missingRequired.forEach(function(s){ Logger.log('  ' + s); });
  Logger.log('');

  Logger.log('--- ② T列に看護師混入【NG: Day 9確定】 (' + issues.nurseInT.length + '件) ---');
  issues.nurseInT.forEach(function(s){ Logger.log('  ' + s); });
  Logger.log('');

  Logger.log('--- ③ 看護師資格(F)ありだがT列空 (' + issues.nurseNoRole.length + '件) ---');
  issues.nurseNoRole.forEach(function(s){ Logger.log('  ' + s); });
  Logger.log('');

  Logger.log('--- ④ T列に想定外の役割値 (' + issues.invalidRole.length + '件) ---');
  issues.invalidRole.forEach(function(s){ Logger.log('  ' + s); });
  Logger.log('');

  Logger.log('--- ⑤ N列に想定外のシフト値 (' + issues.invalidShift.length + '件) ---');
  issues.invalidShift.forEach(function(s){ Logger.log('  ' + s); });
  Logger.log('');

  Logger.log('--- ⑥ 役割別人数集計 ---');
  Object.keys(roleCount).forEach(function(k){ Logger.log('  ' + k + ': ' + roleCount[k] + '名'); });
  Logger.log('');

  Logger.log('--- ⑦ メイン施設別 × 役割マトリクス ---');
  const facKeys = Object.keys(facMatrix).sort();
  facKeys.forEach(function(fac){
    const m = facMatrix[fac];
    Logger.log('  [' + fac + '] 計' + m.total + ' | サビ管:' + m['サビ管'] + ' 世話人:' + m['世話人'] + ' 生活:' + m['生活支援員'] + ' 管理:' + m['管理者'] + ' 看護:' + m['看護師']);
  });
  Logger.log('');

  const totalIssues = issues.missingRequired.length + issues.nurseInT.length + issues.nurseNoRole.length + issues.invalidRole.length + issues.invalidShift.length;
  Logger.log('========= 結論: ' + (totalIssues === 0 ? '✅ クリーン' : '⚠️ ' + totalIssues + '件の要修正') + ' =========');
}


// ============================================================
// debug_audit_facility_basis: 5事業所の机上充足率レポート (Day 10)
// 目的: 希望データ無しで、141名マスタだけで6月運用が回るか判定
// 計算: 役割別所属人数 × 1人月最大稼働h vs 必要時間
// ============================================================
function debug_audit_facility_basis() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);

  // 6月想定: 30日
  const targetDays = 30;
  const hoursPerPerson = targetDays * 40 / 7;

  // 1. M_ユニット -> 施設→事業所マップ
  const unitSheet = ss.getSheetByName('M_ユニット');
  if (!unitSheet) { Logger.log('!! M_ユニットなし'); return; }
  const unitData = unitSheet.getDataRange().getValues();
  const facilityToJigyoshos = {};
  for (let i = 1; i < unitData.length; i++) {
    const row = unitData[i];
    if (!row[0]) continue;
    const jig = String(row[1] || '').trim();
    const fac = String(row[3] || '').trim();
    if (!jig || !fac) continue;
    if (!facilityToJigyoshos[fac]) facilityToJigyoshos[fac] = [];
    if (facilityToJigyoshos[fac].indexOf(jig) === -1) facilityToJigyoshos[fac].push(jig);
  }

  // 2. M_事業所配置基準
  const basisSheet = ss.getSheetByName('M_事業所配置基準');
  if (!basisSheet) { Logger.log('!! M_事業所配置基準なし'); return; }
  const basisData = basisSheet.getDataRange().getValues();
  const facilityBasis = {};
  for (let i = 1; i < basisData.length; i++) {
    const row = basisData[i];
    const jig = String(row[0] || '').trim();
    if (!jig) continue;
    const sewa = Number(row[2]) || 0;
    const seikatsu = Number(row[3]) || 0;
    const tokutei = Number(row[4]) || 0;
    const sabikan = Number(row[5]) || 0;
    const nurse = Number(row[6]) || 0;
    facilityBasis[jig] = {
      jigyosho: jig,
      capacity: Number(row[1]) || 0,
      needSewa: sewa, needSeikatsu: seikatsu, needTokutei: tokutei,
      needSabikan: sabikan, needNurse: nurse,
      kanrishaName: String(row[7] || '').trim(),
      needSewaH: sewa * hoursPerPerson,
      needSeikatsuH: seikatsu * hoursPerPerson,
      needSabikanH: sabikan * hoursPerPerson,
      needKanrishaH: 1 * hoursPerPerson,
    };
  }

  // 3. M_スタッフ -> 役割別×事業所別集計
  const staffSheet = ss.getSheetByName('M_スタッフ');
  const staffData = staffSheet.getDataRange().getValues();
  const facStaff = {};
  Object.keys(facilityBasis).forEach(function(j) {
    facStaff[j] = { sabikan: 0, sewa: 0, seikatsu: 0, kanrisha: 0, nurse: 0, total: 0 };
  });
  const dualList = [];
  const unmapped = [];

  for (let i = 1; i < staffData.length; i++) {
    const row = staffData[i];
    if (!row[0]) continue;
    if (String(row[16]).toUpperCase() === 'TRUE') continue;

    const name = String(row[1] || '').trim();
    const qualification = String(row[5] || '');
    const mainFac = String(row[9] || '').trim();
    const mainRolesRaw = String(row[19] || '').trim();
    const mainRoles = mainRolesRaw ? mainRolesRaw.split(',').map(function(s){return s.trim();}).filter(Boolean) : [];
    const isNurseF = qualification.indexOf('看護師') !== -1;

    if (!mainFac) { unmapped.push(name + ' (メイン施設未設定)'); continue; }
    const jigs = facilityToJigyoshos[mainFac] || [];
    if (jigs.length === 0) { unmapped.push(name + ' ("' + mainFac + '" がM_ユニットに存在しない)'); continue; }
    if (jigs.length > 1) dualList.push({ name: name, fac: mainFac, jigs: jigs });

    jigs.forEach(function(jig) {
      if (!facStaff[jig]) return;
      facStaff[jig].total++;
      if (mainRoles.indexOf('サビ管') !== -1) facStaff[jig].sabikan++;
      if (mainRoles.indexOf('世話人') !== -1) facStaff[jig].sewa++;
      if (mainRoles.indexOf('生活支援員') !== -1) facStaff[jig].seikatsu++;
      if (mainRoles.indexOf('管理者') !== -1) facStaff[jig].kanrisha++;
      if (isNurseF) facStaff[jig].nurse++;
    });
  }

  // 4. 出力
  Logger.log('======= マスタ机上充足率レポート (Day 10 / 6月30日想定) =======');
  Logger.log('1人月max稼働: ' + hoursPerPerson.toFixed(2) + 'h (40h/週 × 30日 ÷ 7)');
  Logger.log('');

  const issues = [];

  Object.keys(facilityBasis).sort().forEach(function(jig) {
    const b = facilityBasis[jig];
    const s = facStaff[jig];
    Logger.log('━━━━ [' + jig + '] 定員' + b.capacity + '名 / 所属' + s.total + '名 ━━━━');

    const checks = [
      { role: 'サビ管',     have: s.sabikan,  need: b.needSabikan,  needH: b.needSabikanH },
      { role: '世話人',     have: s.sewa,     need: b.needSewa,     needH: b.needSewaH },
      { role: '生活支援員', have: s.seikatsu, need: b.needSeikatsu, needH: b.needSeikatsuH },
      { role: '管理者',     have: s.kanrisha, need: 1,              needH: b.needKanrishaH },
      { role: '看護師',     have: s.nurse,    need: b.needNurse,    needH: b.needNurse * hoursPerPerson, isHc: true },
    ];

    checks.forEach(function(c) {
      if (c.need === 0 && c.have === 0) { Logger.log('  ' + c.role + ': 必要無し'); return; }
      const haveH = c.have * hoursPerPerson;
      const rate = c.need > 0 ? (c.have / c.need * 100) : 0;
      let mark = '✅';
      if (c.have === 0 && c.need > 0) mark = '🚨ZERO';
      else if (rate < 100) mark = '⚠️不足';
      else if (rate >= 200) mark = '🟢余裕';
      const detail = c.isHc
        ? c.have + '人 / 必要' + c.need + '人 (' + rate.toFixed(0) + '%)'
        : c.have + '人(max ' + haveH.toFixed(0) + 'h) / 必要' + c.need + '人(' + c.needH.toFixed(0) + 'h) → ' + rate.toFixed(0) + '%';
      Logger.log('  ' + mark + ' ' + c.role + ': ' + detail);
      if (mark === '🚨ZERO') issues.push('🚨 ' + jig + ' / ' + c.role + ' 0人 (必要' + c.need + ')');
      else if (mark === '⚠️不足') issues.push('⚠️ ' + jig + ' / ' + c.role + ' ' + rate.toFixed(0) + '%');
    });
    Logger.log('');
  });

  if (dualList.length > 0) {
    Logger.log('--- ⚡ 1施設→複数事業所のスタッフ (' + dualList.length + '名) ---');
    dualList.forEach(function(d) { Logger.log('  ' + d.name + ' (' + d.fac + ') → ' + d.jigs.join(' / ')); });
    Logger.log('※ 上記レポートでは全該当事業所にカウント済 (実際は按分)');
    Logger.log('');
  }
  if (unmapped.length > 0) {
    Logger.log('--- ⚠️ 事業所紐づけ失敗 (' + unmapped.length + '名) ---');
    unmapped.forEach(function(n) { Logger.log('  ' + n); });
    Logger.log('');
  }

  Logger.log('================== 結論 ==================');
  if (issues.length === 0) {
    Logger.log('✅ 全事業所×全役割で充足見込みあり');
  } else {
    Logger.log('要注意 ' + issues.length + '件:');
    issues.forEach(function(s) { Logger.log('  ' + s); });
  }
  Logger.log('==========================================');
}


// ============================================================
// debug_audit_facility_basis_v2: メイン+セカンド+サブ全部見る版 (Day 10)
// 修正: J/K/L列の全施設を所属判定に使う
// 出力: 各役割について「メイン人数 / +セカンドサブ込み人数」を併記
// ============================================================
function debug_audit_facility_basis_v2() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);

  const targetDays = 30;
  const hoursPerPerson = targetDays * 40 / 7;

  // 1. M_ユニット → facility→jigyoshos
  const unitData = ss.getSheetByName('M_ユニット').getDataRange().getValues();
  const facilityToJigyoshos = {};
  for (let i = 1; i < unitData.length; i++) {
    if (!unitData[i][0]) continue;
    const jig = String(unitData[i][1] || '').trim();
    const fac = String(unitData[i][3] || '').trim();
    if (!jig || !fac) continue;
    if (!facilityToJigyoshos[fac]) facilityToJigyoshos[fac] = [];
    if (facilityToJigyoshos[fac].indexOf(jig) === -1) facilityToJigyoshos[fac].push(jig);
  }

  // 2. M_事業所配置基準
  const basisData = ss.getSheetByName('M_事業所配置基準').getDataRange().getValues();
  const facilityBasis = {};
  for (let i = 1; i < basisData.length; i++) {
    const row = basisData[i];
    const jig = String(row[0] || '').trim();
    if (!jig) continue;
    facilityBasis[jig] = {
      jigyosho: jig,
      capacity: Number(row[1]) || 0,
      needSewa: Number(row[2]) || 0,
      needSeikatsu: Number(row[3]) || 0,
      needTokutei: Number(row[4]) || 0,
      needSabikan: Number(row[5]) || 0,
      needNurse: Number(row[6]) || 0,
    };
  }

  // 3. M_スタッフ → 事業所別×役割別 メイン/セカンド/サブの3層集計
  const staffData = ss.getSheetByName('M_スタッフ').getDataRange().getValues();
  const facStaff = {};
  Object.keys(facilityBasis).forEach(function(j) {
    facStaff[j] = {
      sabikan: { main: 0, second: 0, sub: 0, anywhere: 0 },
      sewa:    { main: 0, second: 0, sub: 0, anywhere: 0 },
      seikatsu:{ main: 0, second: 0, sub: 0, anywhere: 0 },
      kanrisha:{ main: 0, second: 0, sub: 0, anywhere: 0 },
      nurse:   { main: 0, second: 0, sub: 0, anywhere: 0 },
    };
  });

  function parseFacList(raw) {
    if (!raw) return [];
    return String(raw).split(',').map(function(s){return s.trim();}).filter(Boolean);
  }

  for (let i = 1; i < staffData.length; i++) {
    const row = staffData[i];
    if (!row[0]) continue;
    if (String(row[16]).toUpperCase() === 'TRUE') continue;

    const qualification = String(row[5] || '');
    const mainFac = String(row[9] || '').trim();
    const secondFac = String(row[10] || '').trim();
    const subFacsRaw = String(row[11] || '').trim();
    const subFacs = parseFacList(subFacsRaw);
    const mainRolesRaw = String(row[19] || '').trim();
    const mainRoles = mainRolesRaw ? parseFacList(mainRolesRaw) : [];
    const isNurseF = qualification.indexOf('看護師') !== -1;

    const mainJigs = facilityToJigyoshos[mainFac] || [];
    const secondJigs = facilityToJigyoshos[secondFac] || [];
    let subJigs = [];
    subFacs.forEach(function(f) {
      (facilityToJigyoshos[f] || []).forEach(function(j) {
        if (subJigs.indexOf(j) === -1) subJigs.push(j);
      });
    });

    const allJigs = [];
    mainJigs.forEach(function(j) { if (allJigs.indexOf(j) === -1) allJigs.push(j); });
    secondJigs.forEach(function(j) { if (allJigs.indexOf(j) === -1) allJigs.push(j); });
    subJigs.forEach(function(j) { if (allJigs.indexOf(j) === -1) allJigs.push(j); });

    function bumpRole(roleKey, hasRole) {
      if (!hasRole) return;
      mainJigs.forEach(function(j) { if (facStaff[j]) facStaff[j][roleKey].main++; });
      secondJigs.forEach(function(j) { if (facStaff[j] && mainJigs.indexOf(j) === -1) facStaff[j][roleKey].second++; });
      subJigs.forEach(function(j) {
        if (facStaff[j] && mainJigs.indexOf(j) === -1 && secondJigs.indexOf(j) === -1) facStaff[j][roleKey].sub++;
      });
      allJigs.forEach(function(j) { if (facStaff[j]) facStaff[j][roleKey].anywhere++; });
    }
    bumpRole('sabikan',  mainRoles.indexOf('サビ管') !== -1);
    bumpRole('sewa',     mainRoles.indexOf('世話人') !== -1);
    bumpRole('seikatsu', mainRoles.indexOf('生活支援員') !== -1);
    bumpRole('kanrisha', mainRoles.indexOf('管理者') !== -1);
    bumpRole('nurse',    isNurseF);
  }

  // 4. 出力
  Logger.log('======= マスタ机上充足率レポート v2 (メイン+セカンド+サブ込み) =======');
  Logger.log('1人月max稼働: ' + hoursPerPerson.toFixed(2) + 'h');
  Logger.log('');

  const issues = [];
  Object.keys(facilityBasis).sort().forEach(function(jig) {
    const b = facilityBasis[jig];
    const s = facStaff[jig];
    Logger.log('━━━━ [' + jig + '] 定員' + b.capacity + '名 ━━━━');

    const checks = [
      { key: 'sabikan',  label: 'サビ管',     need: b.needSabikan },
      { key: 'sewa',     label: '世話人',     need: b.needSewa },
      { key: 'seikatsu', label: '生活支援員', need: b.needSeikatsu },
      { key: 'kanrisha', label: '管理者',     need: 1 },
      { key: 'nurse',    label: '看護師',     need: b.needNurse, isHc: true },
    ];

    checks.forEach(function(c) {
      const r = s[c.key];
      if (c.need === 0 && r.anywhere === 0) { Logger.log('  ' + c.label + ': 必要無し'); return; }
      const rate = c.need > 0 ? (r.anywhere / c.need * 100) : 0;
      let mark = '✅';
      if (r.anywhere === 0 && c.need > 0) mark = '🚨ZERO';
      else if (rate < 100) mark = '⚠️不足';
      else if (rate >= 200) mark = '🟢余裕';
      Logger.log('  ' + mark + ' ' + c.label + ': 計' + r.anywhere + '人 (メイン' + r.main + ' +セカンド' + r.second + ' +サブ' + r.sub + ') / 必要' + c.need.toFixed(2) + '人 → ' + rate.toFixed(0) + '%');
      if (mark === '🚨ZERO') issues.push('🚨 ' + jig + ' / ' + c.label + ' 0人');
      else if (mark === '⚠️不足') issues.push('⚠️ ' + jig + ' / ' + c.label + ' ' + rate.toFixed(0) + '%');
    });
    Logger.log('');
  });

  Logger.log('================== 結論 v2 ==================');
  if (issues.length === 0) Logger.log('✅ 全事業所×全役割 充足見込み (セカンド・サブ含む)');
  else { Logger.log('要注意 ' + issues.length + '件:'); issues.forEach(function(s){ Logger.log('  ' + s); }); }
  Logger.log('==============================================');
}

// ============================================================
// Day11: E-st バランス加点 動作確認
// ============================================================

function debug_est_staff_list() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('M_スタッフ');
  const data = sheet.getDataRange().getValues();
  const EST = 'ルーデンス上板橋E-st';
  
  Logger.log('=== E-st 関連スタッフ一覧 ===');
  let main=0, second=0, sub=0, even=0, odd=0;
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (!r[0]) continue;
    if (String(r[16]) === 'true' || r[16] === true) continue;
    
    const id = r[0], name = r[1];
    const mainFac = String(r[9] || '').trim();
    const secondFac = String(r[10] || '').trim();
    const subFacs = String(r[11] || '').split(',').map(function(s){return s.trim();}).filter(Boolean);
    
    let role = null;
    if (mainFac === EST) role = 'MAIN';
    else if (secondFac === EST) role = 'SECOND';
    else if (subFacs.indexOf(EST) !== -1) role = 'SUB';
    if (!role) continue;
    
    const idNum = parseInt(id, 10) || 0;
    const preferred = (idNum % 2 === 0) ? '板橋北区' : 'セカンド';
    Logger.log('  staff_id=' + id + ' [' + role + '] ' + name + ' -> 初回優先=' + preferred);
    
    if (role === 'MAIN') main++;
    else if (role === 'SECOND') second++;
    else sub++;
    if (idNum % 2 === 0) even++; else odd++;
  }
  Logger.log('');
  Logger.log('合計: MAIN=' + main + ' SECOND=' + second + ' SUB=' + sub);
  Logger.log('偶奇分布: 偶数(板橋北区優先)=' + even + ' 奇数(セカンド優先)=' + odd);
}

function debug_est_history_load_2026_06() {
  const ctx = loadEngineContextV2('2026-06');
  Logger.log('=== estLastJigyoshoByStaff (2026-06既存配置から) ===');
  const keys = Object.keys(ctx.estLastJigyoshoByStaff);
  Logger.log('履歴件数: ' + keys.length);
  keys.forEach(function(sid) {
    Logger.log('  staff_id=' + sid + ' -> ' + ctx.estLastJigyoshoByStaff[sid]);
  });
  if (keys.length === 0) {
    Logger.log('(対象月にE-st既存配置なし -> 全員初回扱いで偶奇優先になる)');
  }
}

function debug_est_score_check() {
  const ctx = loadEngineContextV2('2026-06');
  const EST = 'ルーデンス上板橋E-st';
  let testStaff = null;
  const sids = Object.keys(ctx.staffMap);
  for (let i = 0; i < sids.length; i++) {
    const s = ctx.staffMap[sids[i]];
    if (s.mainFac === EST && !s.isRetired) { testStaff = s; break; }
  }
  if (!testStaff) {
    Logger.log('E-stメインのスタッフが見つからない');
    return;
  }
  
  Logger.log('=== テストスタッフ: staff_id=' + testStaff.staff_id + ' ' + testStaff.name + ' ===');
  Logger.log('mainFac=' + testStaff.mainFac + ' secondFac=' + testStaff.secondFac);
  
  const dummyWish = { dateKey: '2026-06-15', shift: '早出8h' };
  const slotItabashi = { jigyosho: 'GHコノヒカラ板橋北区', dateKey: '2026-06-15', shift: '早出8h' };
  const slotSecond   = { jigyosho: 'GHコノヒカラ板橋北区セカンド', dateKey: '2026-06-15', shift: '早出8h' };
  
  delete ctx.estLastJigyoshoByStaff[testStaff.staff_id];
  const sA1 = calcScoreV2(ctx, testStaff, dummyWish, slotItabashi, {});
  const sA2 = calcScoreV2(ctx, testStaff, dummyWish, slotSecond, {});
  Logger.log('');
  Logger.log('--- A. 履歴なし(初回・偶奇優先) ---');
  Logger.log('  板橋北区: ' + sA1);
  Logger.log('  セカンド: ' + sA2);
  Logger.log('  差分(板橋-セカンド): ' + (sA1 - sA2) + ' (staff_id=' + testStaff.staff_id + ' 偶奇=' + (testStaff.staff_id % 2) + ')');
  
  ctx.estLastJigyoshoByStaff[testStaff.staff_id] = 'GHコノヒカラ板橋北区';
  const sB1 = calcScoreV2(ctx, testStaff, dummyWish, slotItabashi, {});
  const sB2 = calcScoreV2(ctx, testStaff, dummyWish, slotSecond, {});
  Logger.log('');
  Logger.log('--- B. 前回=板橋北区(次はセカンド優先期待) ---');
  Logger.log('  板橋北区: ' + sB1 + '  (期待: PENALTY=-8)');
  Logger.log('  セカンド: ' + sB2 + '  (期待: BONUS=+12)');
  Logger.log('  差分(セカンド-板橋): ' + (sB2 - sB1) + ' (期待: 20)');
  
  ctx.estLastJigyoshoByStaff[testStaff.staff_id] = 'GHコノヒカラ板橋北区セカンド';
  const sC1 = calcScoreV2(ctx, testStaff, dummyWish, slotItabashi, {});
  const sC2 = calcScoreV2(ctx, testStaff, dummyWish, slotSecond, {});
  Logger.log('');
  Logger.log('--- C. 前回=セカンド(次は板橋北区優先期待) ---');
  Logger.log('  板橋北区: ' + sC1 + '  (期待: BONUS=+12)');
  Logger.log('  セカンド: ' + sC2 + '  (期待: PENALTY=-8)');
  Logger.log('  差分(板橋-セカンド): ' + (sC1 - sC2) + ' (期待: 20)');
}

// ============================================================
// Day11 Phase4: E-st事業所切替APIテスト
// ============================================================

// 1. 実機のE-st配置レコードを探す（変更対象候補を見つける）
function debug_find_est_placements() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('T_シフト確定');
  const data = sheet.getDataRange().getValues();
  const dayShifts = ['早出8h', '早出4h', '遅出8h', '遅出4h'];
  
  Logger.log('=== T_シフト確定 のE-st配置レコード ===');
  let count = 0;
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (String(r[4]).trim() !== 'ルーデンス上板橋E-st') continue;
    if (dayShifts.indexOf(String(r[8])) === -1) continue;
    
    const date = r[1] instanceof Date 
      ? Utilities.formatDate(r[1], 'Asia/Tokyo', 'yyyy-MM-dd')
      : String(r[1]);
    Logger.log('  row' + (i+1) + ': ' + date + ' / D=' + r[3] + ' / E=' + r[4] + ' / staff=' + r[7] + ' / shift=' + r[8]);
    count++;
    if (count >= 10) { Logger.log('  ... (10件で打ち切り)'); break; }
  }
  if (count === 0) Logger.log('  E-st日勤配置レコードなし');
  Logger.log('');
  Logger.log('合計: ' + count + ' 件 (頭10件のみ表示)');
}

// 2. updateDayShiftSlot の changeJigyosho action を単体テスト
//    実行前に debug_find_est_placements で対象rowIndexを確認 → 下のtargetRowに設定
function debug_test_change_jigyosho() {
  const targetRow = 0;  // ←ここに debug_find_est_placements で見つけたrow番号を入れる
  
  if (!targetRow || targetRow < 2) {
    Logger.log('❌ targetRow を debug_find_est_placements の結果から設定してください');
    return;
  }
  
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('T_シフト確定');
  
  const before = sheet.getRange(targetRow, 1, 1, 18).getValues()[0];
  const beforeJig = before[3];
  const beforeFac = before[4];
  Logger.log('=== 変更前 ===');
  Logger.log('  row' + targetRow + ': D=' + beforeJig + ' / E=' + beforeFac);
  
  // 反対側に切替
  const newJig = (beforeJig === 'GHコノヒカラ板橋北区')
    ? 'GHコノヒカラ板橋北区セカンド'
    : 'GHコノヒカラ板橋北区';
  
  Logger.log('');
  Logger.log('=== updateDayShiftSlot 呼び出し ===');
  Logger.log('  newJigyosho: ' + newJig);
  
  const result = updateDayShiftSlot(13, {
    action: 'changeJigyosho',
    rowIndex: targetRow,
    newJigyosho: newJig
  });
  
  Logger.log('');
  Logger.log('=== 結果 ===');
  Logger.log(JSON.stringify(result));
  
  const after = sheet.getRange(targetRow, 1, 1, 18).getValues()[0];
  Logger.log('');
  Logger.log('=== 変更後 ===');
  Logger.log('  row' + targetRow + ': D=' + after[3] + ' / E=' + after[4]);
  Logger.log('  D列が変わったか: ' + (beforeJig !== after[3] ? '✅ 変更成功' : '❌ 変更されてない'));
  Logger.log('  E列は変わってないか: ' + (beforeFac === after[4] ? '✅ 不変(正しい)' : '❌ 誤って変更された'));
  
  // 元に戻す
  Logger.log('');
  Logger.log('=== ロールバック ===');
  const rollback = updateDayShiftSlot(13, {
    action: 'changeJigyosho',
    rowIndex: targetRow,
    newJigyosho: beforeJig
  });
  Logger.log(JSON.stringify(rollback));
  Logger.log('元に戻しました');
}

// 3. 不正な入力を検証（エラーハンドリング確認）
function debug_test_change_jigyosho_invalid() {
  Logger.log('=== バリデーションテスト ===');
  
  // ケースA: 不正な事業所
  const r1 = updateDayShiftSlot(13, {
    action: 'changeJigyosho',
    rowIndex: 2,  // 何らかのrow
    newJigyosho: 'GHコノヒカラ品川'  // E-st配下じゃない事業所
  });
  Logger.log('A. 不正事業所: ' + JSON.stringify(r1));
  
  // ケースB: rowIndex不正
  const r2 = updateDayShiftSlot(13, {
    action: 'changeJigyosho',
    rowIndex: 0,
    newJigyosho: 'GHコノヒカラ板橋北区'
  });
  Logger.log('B. rowIndex=0: ' + JSON.stringify(r2));
  
  // ケースC: 空jigyosho
  const r3 = updateDayShiftSlot(13, {
    action: 'changeJigyosho',
    rowIndex: 2,
    newJigyosho: ''
  });
  Logger.log('C. 空jigyosho: ' + JSON.stringify(r3));
}

// ============================================================
// Day11 Phase4: E-st表記の実体総点検
// ============================================================
function debug_est_naming_audit() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  
  Logger.log('=========== M_ユニット の E-st 行 ===========');
  const unitData = ss.getSheetByName('M_ユニット').getDataRange().getValues();
  for (let i = 1; i < unitData.length; i++) {
    const fac = String(unitData[i][3] || '');
    if (fac.indexOf('上板橋') !== -1 || fac.indexOf('E-st') !== -1) {
      Logger.log('  row' + (i+1) + ': jig="' + unitData[i][1] + '" fac="' + fac + '"');
    }
  }
  
  Logger.log('');
  Logger.log('=========== M_スタッフ の E-st 関連表記 ===========');
  const staffData = ss.getSheetByName('M_スタッフ').getDataRange().getValues();
  let mainHits=0, subHits=0;
  const samples = [];
  for (let i = 1; i < staffData.length; i++) {
    if (!staffData[i][0]) continue;
    if (String(staffData[i][16]).toUpperCase() === 'TRUE') continue;
    const main = String(staffData[i][9] || '');
    const second = String(staffData[i][10] || '');
    const sub = String(staffData[i][11] || '');
    
    if (main.indexOf('上板橋') !== -1 || main.indexOf('E-st') !== -1) {
      mainHits++;
      if (samples.length < 5) samples.push('row' + (i+1) + ' MAIN="' + main + '"');
    }
    if (second.indexOf('上板橋') !== -1 || second.indexOf('E-st') !== -1) {
      if (samples.length < 5) samples.push('row' + (i+1) + ' SECOND="' + second + '"');
    }
    if (sub.indexOf('上板橋') !== -1 || sub.indexOf('E-st') !== -1) {
      subHits++;
      if (samples.length < 8) samples.push('row' + (i+1) + ' SUB="' + sub + '"');
    }
  }
  Logger.log('MAIN=' + mainHits + '名 / SUBに含む=' + subHits + '名');
  samples.forEach(function(s) { Logger.log('  ' + s); });
  
  Logger.log('');
  Logger.log('=========== T_シフト確定 の E-st 配置レコード（全件）===========');
  const cfData = ss.getSheetByName('T_シフト確定').getDataRange().getValues();
  let cfCount=0;
  for (let i = 1; i < cfData.length; i++) {
    const fac = String(cfData[i][4] || '');
    if (fac.indexOf('上板橋') !== -1 || fac.indexOf('E-st') !== -1) {
      const date = cfData[i][1] instanceof Date 
        ? Utilities.formatDate(cfData[i][1], 'Asia/Tokyo', 'yyyy-MM-dd')
        : String(cfData[i][1]);
      Logger.log('  row' + (i+1) + ': D="' + cfData[i][3] + '" E="' + fac + '" date=' + date + ' shift=' + cfData[i][8]);
      cfCount++;
      if (cfCount >= 10) { Logger.log('  ...(10件で打ち切り)'); break; }
    }
  }
  if (cfCount === 0) Logger.log('  T_シフト確定にE-st配置なし（クリーン状態）');
  
  Logger.log('');
  Logger.log('=========== facilityToJigyoshos キー（エンジン側構築）===========');
  if (typeof loadEngineContextV2 === 'function') {
    const ctx = loadEngineContextV2('2026-06');
    Object.keys(ctx.facilityToJigyoshos).forEach(function(f) {
      if (f.indexOf('上板橋') !== -1 || f.indexOf('E-st') !== -1) {
        Logger.log('  "' + f + '" → [' + ctx.facilityToJigyoshos[f].join(', ') + ']');
      }
    });
  }
}

function debug_est_naming_audit() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  
  Logger.log('=========== M_ユニット の E-st 行 ===========');
  const unitData = ss.getSheetByName('M_ユニット').getDataRange().getValues();
  for (let i = 1; i < unitData.length; i++) {
    const fac = String(unitData[i][3] || '');
    if (fac.indexOf('上板橋') !== -1 || fac.indexOf('E-st') !== -1) {
      Logger.log('  row' + (i+1) + ': jig="' + unitData[i][1] + '" fac="' + fac + '"');
    }
  }
  
  Logger.log('');
  Logger.log('=========== M_スタッフ の E-st 表記サンプル ===========');
  const staffData = ss.getSheetByName('M_スタッフ').getDataRange().getValues();
  let n=0;
  for (let i = 1; i < staffData.length; i++) {
    if (!staffData[i][0]) continue;
    if (String(staffData[i][16]).toUpperCase() === 'TRUE') continue;
    const j = String(staffData[i][9] || '');
    const k = String(staffData[i][10] || '');
    const l = String(staffData[i][11] || '');
    if ((j+k+l).indexOf('上板橋') === -1 && (j+k+l).indexOf('E-st') === -1) continue;
    Logger.log('  row' + (i+1) + ' name=' + staffData[i][1]);
    Logger.log('    J(main)="' + j + '"');
    Logger.log('    K(second)="' + k + '"');
    Logger.log('    L(sub)="' + l + '"');
    n++;
    if (n >= 5) { Logger.log('  ...(5名で打ち切り)'); break; }
  }
  
  Logger.log('');
  Logger.log('=========== T_シフト確定 のE-st 過去全件 ===========');
  const cfData = ss.getSheetByName('T_シフト確定').getDataRange().getValues();
  let cfN=0;
  for (let i = 1; i < cfData.length; i++) {
    const fac = String(cfData[i][4] || '');
    if (fac.indexOf('上板橋') !== -1 || fac.indexOf('E-st') !== -1) {
      const date = cfData[i][1] instanceof Date 
        ? Utilities.formatDate(cfData[i][1], 'Asia/Tokyo', 'yyyy-MM-dd')
        : String(cfData[i][1]);
      Logger.log('  row' + (i+1) + ': D="' + cfData[i][3] + '" E="' + fac + '" date=' + date);
      cfN++;
      if (cfN >= 10) break;
    }
  }
  if (cfN === 0) Logger.log('  E-st配置レコードなし（クリーン）');
  
  Logger.log('');
  Logger.log('=========== facilityToJigyoshos のE-st関連キー ===========');
  if (typeof loadEngineContextV2 === 'function') {
    const ctx = loadEngineContextV2('2026-06');
    Object.keys(ctx.facilityToJigyoshos).forEach(function(f) {
      if (f.indexOf('上板橋') !== -1 || f.indexOf('E-st') !== -1) {
        Logger.log('  "' + f + '" → [' + ctx.facilityToJigyoshos[f].join(', ') + ']');
      }
    });
  }
}

// ============================================================
// Day11 Phase4: engine_common.js のヘルパー単体テスト
// ============================================================
function debug_engine_common_test() {
  Logger.log('=== _isEstRealFacility ===');
  const cases1 = [
    ['ルーデンス上板橋E-st（板橋北区）', true],
    ['ルーデンス上板橋E-st（板橋北区セカンド）', true],
    ['ルーデンス上板橋E-st', false],   // 仮想キーは実体ではない
    ['リフレ要町', false],
    ['', false],
    [null, false],
  ];
  cases1.forEach(function(c) {
    const got = _isEstRealFacility(c[0]);
    const ok = got === c[1] ? '✅' : '❌';
    Logger.log('  ' + ok + ' "' + c[0] + '" → ' + got + ' (期待: ' + c[1] + ')');
  });
  
  Logger.log('');
  Logger.log('=== _isEstVirtualKey ===');
  const cases2 = [
    ['ルーデンス上板橋E-st', true],
    ['ルーデンス上板橋E-st（板橋北区）', false],
    ['リフレ要町', false],
  ];
  cases2.forEach(function(c) {
    const got = _isEstVirtualKey(c[0]);
    const ok = got === c[1] ? '✅' : '❌';
    Logger.log('  ' + ok + ' "' + c[0] + '" → ' + got + ' (期待: ' + c[1] + ')');
  });
  
  Logger.log('');
  Logger.log('=== _estRealFacilityToJigyosho ===');
  Logger.log('  "（板橋北区）"   → ' + _estRealFacilityToJigyosho('ルーデンス上板橋E-st（板橋北区）'));
  Logger.log('  "（セカンド）"   → ' + _estRealFacilityToJigyosho('ルーデンス上板橋E-st（板橋北区セカンド）'));
  Logger.log('  "リフレ要町"      → ' + _estRealFacilityToJigyosho('リフレ要町'));
  
  Logger.log('');
  Logger.log('=== _jigyoshoToEstRealFacility ===');
  Logger.log('  "板橋北区"        → ' + _jigyoshoToEstRealFacility('GHコノヒカラ板橋北区'));
  Logger.log('  "セカンド"        → ' + _jigyoshoToEstRealFacility('GHコノヒカラ板橋北区セカンド'));
  Logger.log('  "品川"           → ' + _jigyoshoToEstRealFacility('GHコノヒカラ品川'));
  
  Logger.log('');
  Logger.log('=== _facilityMatchesStaff (3パターン) ===');
  
  // パターン1: メインに仮想キー保有
  const staffA = {
    mainFac: 'ルーデンス上板橋E-st',  // 仮想キー
    secondFac: 'リフレ要町',
    subFacs: ['EST東長崎']
  };
  Logger.log('staffA: mainFac=仮想キー');
  Logger.log('  実体（板橋北区）   → ' + _facilityMatchesStaff('ルーデンス上板橋E-st（板橋北区）', staffA) + ' (期待: main)');
  Logger.log('  実体（セカンド）   → ' + _facilityMatchesStaff('ルーデンス上板橋E-st（板橋北区セカンド）', staffA) + ' (期待: main)');
  Logger.log('  リフレ要町         → ' + _facilityMatchesStaff('リフレ要町', staffA) + ' (期待: second)');
  Logger.log('  ルーデンス本蓮沼   → ' + _facilityMatchesStaff('ルーデンス本蓮沼', staffA) + ' (期待: null)');
  
  // パターン2: subに仮想キー保有
  const staffB = {
    mainFac: 'リフレ要町',
    secondFac: 'EST東長崎',
    subFacs: ['ルーデンス上板橋E-st', 'ルーデンス本蓮沼']
  };
  Logger.log('staffB: subFacsに仮想キー');
  Logger.log('  実体（板橋北区）   → ' + _facilityMatchesStaff('ルーデンス上板橋E-st（板橋北区）', staffB) + ' (期待: sub)');
  Logger.log('  実体（セカンド）   → ' + _facilityMatchesStaff('ルーデンス上板橋E-st（板橋北区セカンド）', staffB) + ' (期待: sub)');
  
  // パターン3: E-st無関係
  const staffC = {
    mainFac: 'リフレ要町',
    secondFac: 'EST東長崎',
    subFacs: ['ルーデンス本蓮沼']
  };
  Logger.log('staffC: E-st無関係');
  Logger.log('  実体（板橋北区）   → ' + _facilityMatchesStaff('ルーデンス上板橋E-st（板橋北区）', staffC) + ' (期待: null)');
  Logger.log('  リフレ要町         → ' + _facilityMatchesStaff('リフレ要町', staffC) + ' (期待: main)');
  
  Logger.log('');
  Logger.log('=== _injectEstVirtualKey 動作確認 ===');
  const fmap = {
    'ルーデンス上板橋E-st（板橋北区）': ['GHコノヒカラ板橋北区'],
    'ルーデンス上板橋E-st（板橋北区セカンド）': ['GHコノヒカラ板橋北区セカンド'],
    'リフレ要町': ['GHコノヒカラ']
  };
  _injectEstVirtualKey(fmap);
  Logger.log('  仮想キー追加後 ルーデンス上板橋E-st: ' + JSON.stringify(fmap['ルーデンス上板橋E-st']));
  Logger.log('  期待: ["GHコノヒカラ板橋北区","GHコノヒカラ板橋北区セカンド"]');
}


// ============================================================
// Day11 Phase4: facilityToJigyoshos に仮想キーが入ったか確認
// ============================================================
function debug_facility_map_after_inject() {
  const ctx = loadEngineContextV2('2026-06');
  Logger.log('=== facilityToJigyoshos のE-st関連キー (修正後) ===');
  Object.keys(ctx.facilityToJigyoshos).forEach(function(f) {
    if (f.indexOf('上板橋') !== -1 || f.indexOf('E-st') !== -1) {
      Logger.log('  "' + f + '" -> [' + ctx.facilityToJigyoshos[f].join(', ') + ']');
    }
  });
  
  Logger.log('');
  Logger.log('期待:');
  Logger.log('  "ルーデンス上板橋E-st" -> [GHコノヒカラ板橋北区, GHコノヒカラ板橋北区セカンド]  *仮想キー*');
  Logger.log('  "ルーデンス上板橋E-st(板橋北区)" -> [GHコノヒカラ板橋北区]');
  Logger.log('  "ルーデンス上板橋E-st(板橋北区セカンド)" -> [GHコノヒカラ板橋北区セカンド]');
}


// ============================================================
// Day11 Phase4: E-st UI動作確認用テストデータ投入/削除
// ============================================================

// 注入: staff_id=119(原拓朗 E-stメイン) の 2026-06-15 早出8h 板橋北区 配置を1件作る
function debug_inject_est_test_placement() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('T_シフト確定');
  
  const testRow = [
    'TEST_EST_DAY11_PHASE4',                    // A shift_id (識別用、削除時に使う)
    new Date(2026, 5, 15),                       // B 日付 2026-06-15
    '',                                           // C unit_id (日勤は空)
    'GHコノヒカラ板橋北区',                       // D 事業所
    'ルーデンス上板橋E-st（板橋北区）',           // E 施設(実体)
    '',                                           // F ユニット名 (日勤は空)
    119,                                          // G staff_id
    '原拓朗',                                     // H 氏名
    '早出8h',                                     // I シフト種別
    '07:00',                                      // J 開始
    '16:00',                                      // K 終了
    1,                                            // L 配置カウント
    '仮',                                         // M ステータス
    new Date(),                                   // N 更新日時
    '07:00',                                      // O 実開始
    '16:00',                                      // P 実終了
    0,                                            // Q 夜勤換算
    8,                                            // R 日勤換算
    '世話人'                                      // S 割当役割
  ];
  
  sheet.appendRow(testRow);
  const newRowIdx = sheet.getLastRow();
  sheet.getRange(newRowIdx, 2).setNumberFormat('yyyy-MM-dd');
  sheet.getRange(newRowIdx, 14).setNumberFormat('yyyy-MM-dd HH:mm:ss');
  
  Logger.log('=== テスト配置注入完了 ===');
  Logger.log('  row=' + newRowIdx);
  Logger.log('  shift_id=TEST_EST_DAY11_PHASE4');
  Logger.log('  staff_id=119 原拓朗');
  Logger.log('  date=2026-06-15');
  Logger.log('  jigyosho=GHコノヒカラ板橋北区');
  Logger.log('  facility=ルーデンス上板橋E-st（板橋北区）');
  Logger.log('  shift=早出8h');
  Logger.log('');
  Logger.log('▶ Admin画面で 2026-06 を選択 → 板橋北区行 > ルーデンス上板橋E-st（板橋北区）行 > 6/15のセルを開く');
  Logger.log('▶ 終わったら debug_remove_est_test_placement で削除');
}

// 削除: shift_id=TEST_EST_DAY11_PHASE4 の行を削除
function debug_remove_est_test_placement() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('T_シフト確定');
  const data = sheet.getDataRange().getValues();
  
  let removed = 0;
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === 'TEST_EST_DAY11_PHASE4') {
      sheet.deleteRow(i + 1);
      removed++;
      Logger.log('  row' + (i+1) + ' を削除');
    }
  }
  
  Logger.log('=== 削除完了: ' + removed + '件 ===');
}

// ============================================================
// Day11 Phase5: 全スタッフのallowedShifts分布調査
// ============================================================
function debug_audit_allowed_shifts() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const data = ss.getSheetByName('M_スタッフ').getDataRange().getValues();
  
  const stats = {
    night_only: 0,    // 夜勤のみ
    day_only: 0,      // 日勤のみ
    both: 0,          // 両方
    none: 0,          // どれも無し
    full_141: 0       // 集計対象(稼働)
  };
  const samples = { night_only: [], day_only: [], both: [], none: [] };
  
  const nightSet = ['夜勤A', '夜勤B', '夜勤C'];
  const daySet = ['早出8h', '早出4h', '遅出8h', '遅出4h'];
  
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (!r[0]) continue;
    if (String(r[16]).toUpperCase() === 'TRUE') continue;
    stats.full_141++;
    
    const allowed = String(r[13] || '').split(',').map(function(s){return s.trim();}).filter(Boolean);
    const hasNight = allowed.some(function(s) { return nightSet.indexOf(s) !== -1; });
    const hasDay = allowed.some(function(s) { return daySet.indexOf(s) !== -1; });
    
    let key;
    if (hasNight && hasDay) key = 'both';
    else if (hasNight) key = 'night_only';
    else if (hasDay) key = 'day_only';
    else key = 'none';
    stats[key]++;
    if (samples[key].length < 3) {
      samples[key].push('  staff_id=' + r[0] + ' ' + r[1] + ' allowed="' + (r[13] || '') + '"');
    }
  }
  
  Logger.log('=== allowedShifts 分布 (稼働141名対象) ===');
  Logger.log('稼働総数: ' + stats.full_141);
  Logger.log('夜勤のみ: ' + stats.night_only);
  samples.night_only.forEach(function(s) { Logger.log(s); });
  Logger.log('日勤のみ: ' + stats.day_only);
  samples.day_only.forEach(function(s) { Logger.log(s); });
  Logger.log('両方:     ' + stats.both);
  samples.both.forEach(function(s) { Logger.log(s); });
  Logger.log('なし:     ' + stats.none);
  samples.none.forEach(function(s) { Logger.log(s); });
}

// ============================================================
// Day11 Phase5: 全スタッフのallowedShifts分布調査
// ============================================================
function debug_audit_allowed_shifts() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const data = ss.getSheetByName('M_スタッフ').getDataRange().getValues();
  
  const stats = {
    night_only: 0,    // 夜勤のみ
    day_only: 0,      // 日勤のみ
    both: 0,          // 両方
    none: 0,          // どれも無し
    full_141: 0       // 集計対象(稼働)
  };
  const samples = { night_only: [], day_only: [], both: [], none: [] };
  
  const nightSet = ['夜勤A', '夜勤B', '夜勤C'];
  const daySet = ['早出8h', '早出4h', '遅出8h', '遅出4h'];
  
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (!r[0]) continue;
    if (String(r[16]).toUpperCase() === 'TRUE') continue;
    stats.full_141++;
    
    const allowed = String(r[13] || '').split(',').map(function(s){return s.trim();}).filter(Boolean);
    const hasNight = allowed.some(function(s) { return nightSet.indexOf(s) !== -1; });
    const hasDay = allowed.some(function(s) { return daySet.indexOf(s) !== -1; });
    
    let key;
    if (hasNight && hasDay) key = 'both';
    else if (hasNight) key = 'night_only';
    else if (hasDay) key = 'day_only';
    else key = 'none';
    stats[key]++;
    if (samples[key].length < 3) {
      samples[key].push('  staff_id=' + r[0] + ' ' + r[1] + ' allowed="' + (r[13] || '') + '"');
    }
  }
  
  Logger.log('=== allowedShifts 分布 (稼働141名対象) ===');
  Logger.log('稼働総数: ' + stats.full_141);
  Logger.log('夜勤のみ: ' + stats.night_only);
  samples.night_only.forEach(function(s) { Logger.log(s); });
  Logger.log('日勤のみ: ' + stats.day_only);
  samples.day_only.forEach(function(s) { Logger.log(s); });
  Logger.log('両方:     ' + stats.both);
  samples.both.forEach(function(s) { Logger.log(s); });
  Logger.log('なし:     ' + stats.none);
  samples.none.forEach(function(s) { Logger.log(s); });
}


// ============================================================
// Day11 Phase5: 本番想定テスト希望データ生成 (2026-06)
// 仕様:
//   - 稼働141名全員 各月10件目標
//   - 施設配分: メイン7 / セカンド2 / サブ1 (許可されてる範囲のみ)
//   - シフト配分(両方許可): 夜勤4 + 日勤6
//   - 日付: 5-7日間隔分散 + バリデーション5ルール準拠
// ============================================================
function inject_realistic_test_wishes_2026_06() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const wishSheet = ss.getSheetByName('T_希望提出');
  const staffSheet = ss.getSheetByName('M_スタッフ');
  
  const TARGET_YM = '2026-06';
  const TARGET_YEAR = 2026;
  const TARGET_MONTH = 6;
  const DAYS_IN_MONTH = 30;
  const NIGHT_SHIFTS = ['夜勤A', '夜勤B', '夜勤C'];
  const DAY_SHIFTS_8H = ['早出8h', '遅出8h'];
  const DAY_SHIFTS_4H = ['早出4h', '遅出4h'];
  
  // 1. 既存の2026-06希望を削除
  const wishData = wishSheet.getDataRange().getValues();
  let deletedCount = 0;
  for (let i = wishData.length - 1; i >= 1; i--) {
    let ymVal = wishData[i][4];  // ★E列(YM, COL_REQ_YM=4)
    let ymStr = '';
    if (ymVal instanceof Date) {
      ymStr = Utilities.formatDate(ymVal, 'Asia/Tokyo', 'yyyy-MM');
    } else {
      ymStr = String(ymVal || '').trim().substring(0, 7);
    }
    if (ymStr === TARGET_YM) {
      wishSheet.deleteRow(i + 1);
      deletedCount++;
    }
  }
  Logger.log('既存2026-06希望: ' + deletedCount + '件削除');
  
  // 2. 稼働スタッフ取得
  const staffData = staffSheet.getDataRange().getValues();
  const targets = [];
  for (let i = 1; i < staffData.length; i++) {
    const r = staffData[i];
    if (!r[0]) continue;
    if (String(r[16]).toUpperCase() === 'TRUE') continue;
    
    const allowedRaw = String(r[13] || '').trim();
    if (!allowedRaw) continue;
    const allowed = allowedRaw.split(',').map(function(s){return s.trim();}).filter(Boolean);
    
    const mainFac = String(r[9] || '').trim();
    const secondFac = String(r[10] || '').trim();
    const subFacs = String(r[11] || '').split(',').map(function(s){return s.trim();}).filter(Boolean);
    
    const allowedNight = allowed.filter(function(s) { return NIGHT_SHIFTS.indexOf(s) !== -1; });
    const allowedDay = allowed.filter(function(s) {
      return DAY_SHIFTS_8H.indexOf(s) !== -1 || DAY_SHIFTS_4H.indexOf(s) !== -1;
    });
    
    targets.push({
      staff_id: r[0],
      name: r[1],
      email: r[2],
      mainFac: mainFac,
      secondFac: secondFac,
      subFacs: subFacs,
      allowed: allowed,
      allowedNight: allowedNight,
      allowedDay: allowedDay,
      hasNight: allowedNight.length > 0,
      hasDay: allowedDay.length > 0
    });
  }
  Logger.log('対象スタッフ: ' + targets.length + '名');
  
  // 3. 各スタッフの希望生成
  const generatedRows = [];
  let totalGenerated = 0;
  let staffSkipped = 0;
  
  // 簡易擬似乱数 (staff_id ベース、再現性確保)
  function pseudoRandom(seed) {
    let x = seed;
    return function() {
      x = (x * 9301 + 49297) % 233280;
      return x / 233280;
    };
  }
  
  for (let s = 0; s < targets.length; s++) {
    const staff = targets[s];
    const rng = pseudoRandom(staff.staff_id * 31 + 7);
    
    // 3-1. シフト種別の総数決定 (Phase 5: 5月実績に合わせて月15-18件想定)
    let nightTarget, dayTarget;
    if (staff.hasNight && staff.hasDay) {
      nightTarget = 8;
      dayTarget = 10;  // 計18件
    } else if (staff.hasNight) {
      nightTarget = 18;
      dayTarget = 0;
    } else {
      nightTarget = 0;
      dayTarget = 18;
    }
    
    // 3-2. 施設配分(7:2:1) - 許可されてる施設のみ
    function pickFacilityWithRotation(idx) {
      // idx を 10で割って配分: 0-6=メイン, 7-8=セカンド, 9=サブ
      const slot = idx % 10;
      if (slot <= 6) return staff.mainFac;
      if (slot <= 8 && staff.secondFac) return staff.secondFac;
      if (staff.subFacs.length > 0) return staff.subFacs[idx % staff.subFacs.length];
      // セカンドもサブもない場合はメインに戻す
      return staff.mainFac;
    }
    
    // 3-3. 日付選定 (5-7日間隔で分散) + バリデーション
    const totalWishes = nightTarget + dayTarget;
    if (totalWishes === 0) { staffSkipped++; continue; }
    
    // 開始日をランダム選択(1-3日)、間隔5-7日
    let dayCursor = 1 + Math.floor(rng() * 2);
    const usedDays = {};  // dayキー → assignedShift
    const dayList = [];
    
    let tries = 0;
    while (dayList.length < totalWishes && tries < 200) {
      tries++;
      if (dayCursor > DAYS_IN_MONTH) break;
      
      // バリデーション5ルール簡易チェック
      const prevDay = dayCursor - 1;
      const nextDay = dayCursor + 1;
      const prevShift = usedDays[prevDay];
      const nextShift = usedDays[nextDay];
      
      // この日に何のシフトを置くか決める
      let candidateShift = null;
      const wishIdx = dayList.length;
      const shouldBeNight = wishIdx < nightTarget;
      
      if (shouldBeNight && staff.allowedNight.length > 0) {
        // 夜勤候補
        const ns = staff.allowedNight[Math.floor(rng() * staff.allowedNight.length)];
        // ルール5: 翌日早出→前日夜勤NG (この日に夜勤入れて、明日早出があるとNG)
        const isEarly = function(s) { return s === '早出8h' || s === '早出4h'; };
        if (nextShift && isEarly(nextShift)) {
          // skip この日に夜勤入れられない
        } else {
          candidateShift = ns;
        }
      } else if (staff.allowedDay.length > 0) {
        // 日勤候補
        const ds = staff.allowedDay[Math.floor(rng() * staff.allowedDay.length)];
        // ルール4: 前日夜勤→翌日早出NG
        const isEarly = (ds === '早出8h' || ds === '早出4h');
        const prevIsNight = prevShift && NIGHT_SHIFTS.indexOf(prevShift) !== -1;
        if (isEarly && prevIsNight) {
          // skip
        } else if (ds === '遅出8h' && nextShift && NIGHT_SHIFTS.indexOf(nextShift) !== -1) {
          // ルール2: 同日 遅出8h→夜勤NG (この日遅出8h置いて翌日に夜勤あるのは別日だからOK)
          // ※ルール2は「同日」だから連日関係ない、置ける
          candidateShift = ds;
        } else {
          candidateShift = ds;
        }
      }
      
      if (candidateShift) {
        usedDays[dayCursor] = candidateShift;
        dayList.push({ day: dayCursor, shift: candidateShift });
      }
      
      // 次の日へ進む(2-4日間隔、月10件目標)
      dayCursor += 1 + Math.floor(rng() * 2);  // Phase 5.6: 2-4日→1-2日に詰めて18件物理生成可能に
    }
    
    // 3-4. 各wish行を生成
    dayList.forEach(function(item, idx) {
      const fac = pickFacilityWithRotation(idx);
      const dateStr = TARGET_YEAR + '-' + String(TARGET_MONTH).padStart(2, '0') + '-' + String(item.day).padStart(2, '0');
      const wishId = 'TEST_WISH_2026_06_' + staff.staff_id + '_' + idx;
      
      // ★列構造: COL_REQ_* に厳密準拠 (Phase 5.6: 13列L/M=希望頻度を追加)
      // 仕様: スタッフはマスタの全許可施設を全希望日に必須チェック
      //   メインだけ許可 → H列のみ
      //   メイン+セカンド → H列+I列
      //   メイン+セカンド+サブ → H列+I列+J列(全サブ)
      // 全希望日で同じ施設セット + 全希望日に同じ希望頻度
      generatedRows.push([
        wishId,                                              // A request_id
        new Date(),                                          // B 提出日時
        staff.staff_id,                                      // C staff_id
        staff.name,                                          // D 氏名
        new Date(TARGET_YEAR, TARGET_MONTH - 1, 1),          // E YM
        new Date(dateStr + 'T00:00:00'),                     // F 日付
        item.shift,                                          // G シフト種別
        staff.mainFac,                                       // H メイン施設(固定)
        staff.secondFac || '',                               // I セカンド施設(あれば固定)
        staff.subFacs.join(','),                             // J サブ施設(あれば全部)
        '',                                                  // K コメント
        '月次合計',                                          // L 希望頻度タイプ ★Phase 5.6
        10,                                                  // M 希望頻度数 ★Phase 5.6 (5月実績に近い)
      ]);
      totalGenerated++;
    });
  }
  
  Logger.log('生成行数: ' + totalGenerated);
  Logger.log('スキップしたスタッフ: ' + staffSkipped);
  
  // 4. T_希望提出に一括書き込み
  if (generatedRows.length > 0) {
    const startRow = wishSheet.getLastRow() + 1;
    const numCols = generatedRows[0].length;
    wishSheet.getRange(startRow, 1, generatedRows.length, numCols).setValues(generatedRows);
    
    // フォーマット設定 (列構造に合わせる)
    const submittedRange = wishSheet.getRange(startRow, 2, generatedRows.length, 1);
    submittedRange.setNumberFormat('yyyy-MM-dd HH:mm:ss');
    const ymRange = wishSheet.getRange(startRow, 5, generatedRows.length, 1);
    ymRange.setNumberFormat('yyyy-MM');
    const dateRange = wishSheet.getRange(startRow, 6, generatedRows.length, 1);
    dateRange.setNumberFormat('yyyy-MM-dd');
    
    SpreadsheetApp.flush();
  }
  
  Logger.log('');
  Logger.log('=== 生成完了 ===');
  Logger.log('合計' + totalGenerated + '件 / 対象' + targets.length + '名');
  Logger.log('1人あたり平均: ' + (totalGenerated / targets.length).toFixed(1) + '件');
  Logger.log('');
  Logger.log('▶ 次は GASエディタで runDayShiftEngineV2 や 夜勤エンジン実行');
  Logger.log('▶ または delete_realistic_test_wishes_2026_06 で全削除');
}

// 削除関数(高速化版: 連続行をバッチ削除)
function delete_realistic_test_wishes_2026_06() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('T_希望提出');
  const data = sheet.getDataRange().getValues();
  
  let deleted = 0;
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0] || '').indexOf('TEST_WISH_2026_06_') === 0) {
      sheet.deleteRow(i + 1);
      deleted++;
    }
  }
  Logger.log('=== 削除完了: ' + deleted + '件 ===');
}


// ============================================================
// Day11 Phase5: エンジン実行ラッパー (引数渡し用)
// ============================================================
function debug_run_night_2026_06() {
  Logger.log('=== 夜勤エンジン実行: 2026-06 ===');
  const startTs = Date.now();
  const result = runNightShiftEngineV4('2026-06');
  const elapsed = ((Date.now() - startTs) / 1000).toFixed(1);
  Logger.log('実行時間: ' + elapsed + '秒');
  Logger.log('結果: ' + JSON.stringify(result, null, 2));
}

function debug_run_day_2026_06() {
  Logger.log('=== 日勤エンジン実行: 2026-06 ===');
  const startTs = Date.now();
  const result = runDayShiftEngineV2('2026-06');
  const elapsed = ((Date.now() - startTs) / 1000).toFixed(1);
  Logger.log('実行時間: ' + elapsed + '秒');
  Logger.log('結果: ' + JSON.stringify(result, null, 2));
}


// ============================================================
// Day11 Phase5: 夜勤配置結果分析
// ============================================================
function debug_check_night_assignments_2026_06() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('T_シフト確定');
  const data = sheet.getDataRange().getValues();
  
  const NIGHT = ['夜勤A', '夜勤B', '夜勤C'];
  const stats = {};
  let totalNight = 0;
  let estNight = 0;
  
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    const date = r[1];
    if (!(date instanceof Date)) continue;
    if (date.getFullYear() !== 2026 || date.getMonth() !== 5) continue;  // 6月 = month 5
    
    const shift = String(r[8] || '').trim();
    if (NIGHT.indexOf(shift) === -1) continue;
    
    const jig = String(r[3] || '').trim();
    const fac = String(r[4] || '').trim();
    const unit = String(r[5] || '').trim();
    
    if (!stats[jig]) stats[jig] = {};
    if (!stats[jig][unit]) stats[jig][unit] = { count: 0, facility: fac };
    stats[jig][unit].count++;
    totalNight++;
    
    if (fac.indexOf('ルーデンス上板橋E-st') === 0) estNight++;
  }
  
  Logger.log('=== 2026-06 夜勤配置サマリ ===');
  Logger.log('夜勤総配置数: ' + totalNight);
  Logger.log('うちE-st配置: ' + estNight);
  Logger.log('');
  Logger.log('=== 事業所×ユニット別配置数 ===');
  Object.keys(stats).sort().forEach(function(jig) {
    Logger.log('【' + jig + '】');
    Object.keys(stats[jig]).sort().forEach(function(unit) {
      const u = stats[jig][unit];
      Logger.log('  ' + unit + ' (' + u.facility + '): ' + u.count + '件 / 30日');
    });
  });
}


// ============================================================
// Day11 Phase5: 未配置スロット分析
// 「希望が出てるのに配置できなかった」 vs 「そもそも希望なし」を切り分け
// ============================================================
function debug_analyze_unassigned_2026_06() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const TARGET_YM = '2026-06';
  
  // 1. T_希望提出から夜勤希望のみ抽出
  const reqData = ss.getSheetByName('T_希望提出').getDataRange().getValues();
  const NIGHT = ['夜勤A', '夜勤B', '夜勤C'];
  const wishesByDay = {};  // dateKey -> [{staff_id, name, shift, mainFac, secondFac, subFac}, ...]
  
  for (let i = 1; i < reqData.length; i++) {
    const r = reqData[i];
    const ym = r[4];
    let ymStr = '';
    if (ym instanceof Date) ymStr = Utilities.formatDate(ym, 'Asia/Tokyo', 'yyyy-MM');
    else ymStr = String(ym).substring(0, 7);
    if (ymStr !== TARGET_YM) continue;
    
    const shift = String(r[6] || '').trim();
    if (NIGHT.indexOf(shift) === -1) continue;
    
    const date = r[5];
    const dateKey = date instanceof Date 
      ? Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy-MM-dd')
      : String(date);
    
    if (!wishesByDay[dateKey]) wishesByDay[dateKey] = [];
    wishesByDay[dateKey].push({
      staff_id: r[2],
      name: r[3],
      shift: shift,
      main: String(r[7] || ''),
      second: String(r[8] || ''),
      sub: String(r[9] || '')
    });
  }
  
  // 2. ユニット情報取得
  const unitData = ss.getSheetByName('M_ユニット').getDataRange().getValues();
  const units = [];
  for (let i = 1; i < unitData.length; i++) {
    if (!unitData[i][0]) continue;
    units.push({
      unit_id: unitData[i][0],
      jigyosho: String(unitData[i][1] || ''),
      unit_name: String(unitData[i][2] || ''),
      facility: String(unitData[i][3] || '')
    });
  }
  
  // 3. T_シフト確定から既配置取得
  const cfData = ss.getSheetByName('T_シフト確定').getDataRange().getValues();
  const placedKey = {};  // unitId_dateKey -> true
  for (let i = 1; i < cfData.length; i++) {
    const r = cfData[i];
    const date = r[1];
    if (!(date instanceof Date)) continue;
    if (date.getFullYear() !== 2026 || date.getMonth() !== 5) continue;
    const shift = String(r[8] || '');
    if (NIGHT.indexOf(shift) === -1) continue;
    
    const unitName = String(r[5] || '');
    const dateKey = Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy-MM-dd');
    const key = unitName + '_' + dateKey;
    placedKey[key] = true;
  }
  
  // 4. 各ユニット×各日でアンマッチ分析
  Logger.log('=== 未配置スロット詳細分析 ===');
  Logger.log('');
  
  let category1 = 0;  // 希望者あり、なのに未配置
  let category2 = 0;  // そもそも希望者なし
  const samples1 = [];
  const samples2 = [];
  
  for (let day = 1; day <= 30; day++) {
    const dateKey = '2026-06-' + String(day).padStart(2, '0');
    const dayWishes = wishesByDay[dateKey] || [];
    
    units.forEach(function(u) {
      const placeKey = u.unit_name + '_' + dateKey;
      if (placedKey[placeKey]) return;  // 配置済みはskip
      
      // この日にこのユニット(=その施設)を希望してるスタッフがいるか
      const candidateWishes = dayWishes.filter(function(w) {
        return w.main === u.facility || w.second === u.facility 
            || (w.sub && w.sub.split(',').map(function(s){return s.trim();}).indexOf(u.facility) !== -1)
            // E-st仮想キー対応
            || (u.facility.indexOf('ルーデンス上板橋E-st') === 0
                && (w.main === 'ルーデンス上板橋E-st' 
                    || w.second === 'ルーデンス上板橋E-st'
                    || (w.sub && w.sub.split(',').map(function(s){return s.trim();}).indexOf('ルーデンス上板橋E-st') !== -1)));
      });
      
      if (candidateWishes.length > 0) {
        category1++;
        if (samples1.length < 8) {
          samples1.push('  ' + dateKey + ' ' + u.unit_name + ' (' + u.facility + ') 希望者' + candidateWishes.length + '名: ' 
            + candidateWishes.slice(0,3).map(function(w){return w.name + '(' + w.shift + ')';}).join(', '));
        }
      } else {
        category2++;
        if (samples2.length < 5) {
          samples2.push('  ' + dateKey + ' ' + u.unit_name + ' (' + u.facility + '): 希望者ゼロ');
        }
      }
    });
  }
  
  Logger.log('【ケース1】希望者ありなのに未配置: ' + category1 + 'スロット');
  Logger.log('  サンプル(最初の8件):');
  samples1.forEach(function(s) { Logger.log(s); });
  Logger.log('');
  Logger.log('【ケース2】そもそも希望者なし: ' + category2 + 'スロット');
  Logger.log('  サンプル(最初の5件):');
  samples2.forEach(function(s) { Logger.log(s); });
  
  Logger.log('');
  Logger.log('=== 結論 ===');
  if (category1 > 0) {
    Logger.log('ケース1が ' + category1 + 'スロットあるので、ロジック改善余地あり');
    Logger.log('→ 各候補で何が原因で配置失敗したか個別に追跡可能');
  }
  if (category2 > 0) {
    Logger.log('ケース2が ' + category2 + 'スロットあり、希望データの希薄性が原因');
    Logger.log('→ 月10件設定では薄いと判断、月14-16件に増やすか希望提出指導');
  }
}


// ============================================================
// Day11 Phase5: ケース1の未配置を1件ずつ追跡
// ============================================================
function debug_deepdive_unassigned_2026_06() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const TARGET_YM = '2026-06';
  const NIGHT = ['夜勤A', '夜勤B', '夜勤C'];
  
  // 希望取得
  const reqData = ss.getSheetByName('T_希望提出').getDataRange().getValues();
  const wishesByDayFac = {};  // dateKey_facility -> [{staff_id, name, shift}, ...]
  
  for (let i = 1; i < reqData.length; i++) {
    const r = reqData[i];
    const ym = r[4];
    let ymStr = ym instanceof Date ? Utilities.formatDate(ym, 'Asia/Tokyo', 'yyyy-MM') : String(ym).substring(0, 7);
    if (ymStr !== TARGET_YM) continue;
    const shift = String(r[6] || '').trim();
    if (NIGHT.indexOf(shift) === -1) continue;
    
    const date = r[5];
    const dateKey = date instanceof Date ? Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy-MM-dd') : String(date);
    
    const facs = [r[7], r[8], r[9]].filter(Boolean).map(function(s){return String(s).trim();});
    facs.forEach(function(fac) {
      // 仮想キー展開
      const realFacs = (fac === 'ルーデンス上板橋E-st') 
        ? ['ルーデンス上板橋E-st（板橋北区）', 'ルーデンス上板橋E-st（板橋北区セカンド）']
        : [fac];
      realFacs.forEach(function(realFac) {
        const key = dateKey + '_' + realFac;
        if (!wishesByDayFac[key]) wishesByDayFac[key] = [];
        wishesByDayFac[key].push({
          staff_id: r[2],
          name: r[3],
          shift: shift
        });
      });
    });
  }
  
  // T_シフト確定 既配置取得 (誰が同日どこに配置されたか)
  const cfData = ss.getSheetByName('T_シフト確定').getDataRange().getValues();
  const placedByStaffDay = {};  // staff_id_dateKey -> {jigyosho, unit}
  const placedByUnitDay = {};   // unitName_dateKey -> {staff_id, name}
  
  for (let i = 1; i < cfData.length; i++) {
    const r = cfData[i];
    const date = r[1];
    if (!(date instanceof Date)) continue;
    if (date.getFullYear() !== 2026 || date.getMonth() !== 5) continue;
    const shift = String(r[8] || '');
    if (NIGHT.indexOf(shift) === -1) continue;
    const dateKey = Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy-MM-dd');
    const sk = String(r[6]);
    const unit = String(r[5]);
    placedByStaffDay[sk + '_' + dateKey] = { jigyosho: r[3], unit: unit, facility: r[4] };
    placedByUnitDay[unit + '_' + dateKey] = { staff_id: sk, name: r[7] };
  }
  
  // 未配置スロットでケース1を1件ずつ
  const unitData = ss.getSheetByName('M_ユニット').getDataRange().getValues();
  const units = [];
  for (let i = 1; i < unitData.length; i++) {
    if (!unitData[i][0]) continue;
    units.push({
      unit_id: unitData[i][0],
      jigyosho: String(unitData[i][1] || ''),
      unit_name: String(unitData[i][2] || ''),
      facility: String(unitData[i][3] || '')
    });
  }
  
  Logger.log('=== ケース1 未配置の原因分析 (最初の10件) ===');
  let analyzed = 0;
  
  for (let day = 1; day <= 30 && analyzed < 10; day++) {
    const dateKey = '2026-06-' + String(day).padStart(2, '0');
    
    units.forEach(function(u) {
      if (analyzed >= 10) return;
      const placeKey = u.unit_name + '_' + dateKey;
      if (placedByUnitDay[placeKey]) return;  // 配置済み
      
      const wishKey = dateKey + '_' + u.facility;
      const candidates = wishesByDayFac[wishKey] || [];
      if (candidates.length === 0) return;  // ケース2、skip
      
      // ケース1
      analyzed++;
      Logger.log('');
      Logger.log('【' + analyzed + '】' + dateKey + ' ' + u.unit_name + ' (' + u.facility + ')');
      Logger.log('  希望者' + candidates.length + '名:');
      candidates.forEach(function(c) {
        const sd = c.staff_id + '_' + dateKey;
        const placed = placedByStaffDay[sd];
        if (placed) {
          Logger.log('    ' + c.name + '(' + c.shift + ') -> 同日「' + placed.unit + '」(' + placed.jigyosho + ')に配置済み');
        } else {
          Logger.log('    ' + c.name + '(' + c.shift + ') -> 同日どこにも未配置 ★ロジック調査');
        }
      });
    });
  }
}


// キャッシュ確認用 (削除関数の中身を返す)
function debug_check_delete_function_source() {
  Logger.log('=== delete_realistic_test_wishes_2026_06 の中身 ===');
  Logger.log(delete_realistic_test_wishes_2026_06.toString());
}

// ============================================================
// Day11 Phase5: T_希望提出のシート状態確認
// ============================================================
function debug_check_wish_sheet_state() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('T_希望提出');
  
  Logger.log('=== T_希望提出 シート状態 ===');
  Logger.log('総行数: ' + sheet.getLastRow());
  Logger.log('固定行数 (Frozen rows): ' + sheet.getFrozenRows());
  Logger.log('固定列数 (Frozen columns): ' + sheet.getFrozenColumns());
  
  const protections = sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE);
  Logger.log('保護範囲数: ' + protections.length);
  protections.forEach(function(p, i) {
    Logger.log('  保護' + (i+1) + ': ' + p.getRange().getA1Notation() + ' / ' + p.getDescription());
  });
  
  const sheetProt = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
  Logger.log('シート保護数: ' + sheetProt.length);
  
  // フィルター
  const filter = sheet.getFilter();
  Logger.log('フィルター存在: ' + (filter !== null));
  if (filter) {
    Logger.log('  フィルター範囲: ' + filter.getRange().getA1Notation());
  }
}

// 削除関数(改善版): 一括書き換え方式
// データ全部読む → TEST_WISH除外 → ヘッダー含めて再書き込み
function delete_realistic_test_wishes_2026_06_v2() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('T_希望提出');
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  
  if (lastRow < 2) {
    Logger.log('データなし');
    return;
  }
  
  const data = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const header = data[0];
  const kept = [header];
  let removed = 0;
  
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0] || '').indexOf('TEST_WISH_2026_06_') === 0) {
      removed++;
    } else {
      kept.push(data[i]);
    }
  }
  
  // 既存範囲をクリア
  sheet.getRange(1, 1, lastRow, lastCol).clearContent();
  
  // 残ったデータを書き戻す
  if (kept.length > 0) {
    sheet.getRange(1, 1, kept.length, lastCol).setValues(kept);
  }
  
  Logger.log('=== 削除完了(v2): ' + removed + '件削除 / 残' + (kept.length - 1) + '件 ===');
}


// ============================================================
// Day 11 Phase 5 デバッグ関数群 (夜勤エンジン35.5%バグ調査用)
// ============================================================

function debug_count_shift_dist_2026_06() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('T_希望提出');
  const data = sheet.getDataRange().getValues();
  
  const shiftCounts = {};
  let total = 0;
  
  for (let i = 1; i < data.length; i++) {
    const ymVal = data[i][4];
    const ymStr = (ymVal instanceof Date)
      ? Utilities.formatDate(ymVal, 'JST', 'yyyy-MM')
      : String(ymVal || '').substring(0, 7);
    if (ymStr !== '2026-06') continue;
    total++;
    const shift = String(data[i][6] || '').trim();
    shiftCounts[shift] = (shiftCounts[shift] || 0) + 1;
  }
  
  Logger.log('=== 2026-06 シフト別分布 ===');
  Logger.log('総件数: ' + total);
  Object.keys(shiftCounts).sort().forEach(function(s) {
    Logger.log('  ' + s + ': ' + shiftCounts[s] + '件');
  });
  
  const NIGHT = ['夜勤A', '夜勤B', '夜勤C'];
  let night = 0, day = 0;
  Object.keys(shiftCounts).forEach(function(s) {
    if (NIGHT.indexOf(s) !== -1) night += shiftCounts[s];
    else day += shiftCounts[s];
  });
  Logger.log('---');
  Logger.log('夜勤希望合計: ' + night + ' (需要660 = 22ユニット×30日)');
  Logger.log('夜勤希望/需要: ' + (night/660*100).toFixed(1) + '%');
  Logger.log('日勤希望合計: ' + day);
}

function debug_count_unique_wishes_2026_06() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('T_希望提出');
  const data = sheet.getDataRange().getValues();
  
  let total = 0;
  const uniqueKeys = new Set();
  const facCounts = {};
  
  for (let i = 1; i < data.length; i++) {
    const ymVal = data[i][4];
    const ymStr = (ymVal instanceof Date)
      ? Utilities.formatDate(ymVal, 'JST', 'yyyy-MM')
      : String(ymVal || '').substring(0, 7);
    if (ymStr !== '2026-06') continue;
    total++;
    
    const sid = String(data[i][2]).trim();
    const date = data[i][5];
    const dateStr = (date instanceof Date) ? Utilities.formatDate(date, 'JST', 'yyyy-MM-dd') : String(date);
    const shift = String(data[i][6] || '').trim();
    const key = sid + '_' + dateStr + '_' + shift;
    uniqueKeys.add(key);
    facCounts[key] = (facCounts[key] || 0) + 1;
  }
  
  const dist = {};
  Object.values(facCounts).forEach(function(c) { dist[c] = (dist[c] || 0) + 1; });
  
  Logger.log('=== ユニーク件数 ===');
  Logger.log('総レコード: ' + total);
  Logger.log('ユニーク (sid_date_shift): ' + uniqueKeys.size);
  Logger.log('重複度分布: ' + JSON.stringify(dist));
  Logger.log('解釈: 1レコ=正常 / 2-4レコ重複=施設ごと分割の疑い');
}

function debug_check_shift_kakutei_2026_06() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('T_シフト確定');
  const data = sheet.getDataRange().getValues();
  
  let total = 0, nightTotal = 0;
  const NIGHT = ['夜勤A', '夜勤B', '夜勤C'];
  
  for (let i = 1; i < data.length; i++) {
    const dateVal = data[i][1];
    const dateStr = (dateVal instanceof Date)
      ? Utilities.formatDate(dateVal, 'JST', 'yyyy-MM')
      : String(dateVal || '').substring(0, 7);
    if (dateStr !== '2026-06') continue;
    total++;
    const shift = String(data[i][8] || '').trim();
    if (NIGHT.indexOf(shift) !== -1) nightTotal++;
  }
  
  Logger.log('=== T_シフト確定 2026-06 ===');
  Logger.log('総レコード: ' + total);
  Logger.log('夜勤レコード: ' + nightTotal + ' (期待660 if 完全配置)');
}

// 3つまとめて実行
function debug_phase5_all() {
  Logger.log('##### [1/3] シフト分布 #####');
  debug_count_shift_dist_2026_06();
  Logger.log('');
  Logger.log('##### [2/3] ユニーク件数 #####');
  debug_count_unique_wishes_2026_06();
  Logger.log('');
  Logger.log('##### [3/3] T_シフト確定状態 #####');
  debug_check_shift_kakutei_2026_06();
}


// Phase 5 追加: T_シフト確定の構造分析
function debug_analyze_shift_kakutei_structure() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('T_シフト確定');
  const data = sheet.getDataRange().getValues();
  
  const NIGHT = ['夜勤A', '夜勤B', '夜勤C'];
  const slotKeys = {};       // date_unitId_shift → count
  const dateShiftCounts = {};  // date_shift → count (シフト別)
  const dateCounts = {};       // date → 配置総数
  const unitCounts = {};       // unitId → 配置総数
  let total = 0;
  
  for (let i = 1; i < data.length; i++) {
    const dateVal = data[i][1];
    const dateStr = (dateVal instanceof Date)
      ? Utilities.formatDate(dateVal, 'JST', 'yyyy-MM-dd')
      : String(dateVal || '').substring(0, 10);
    if (dateStr.substring(0, 7) !== '2026-06') continue;
    
    const shift = String(data[i][8] || '').trim();
    if (NIGHT.indexOf(shift) === -1) continue;
    
    total++;
    const unitId = String(data[i][2] || '').trim();
    const slotKey = dateStr + '_' + unitId + '_' + shift;
    const dsKey = dateStr + '_' + shift;
    
    slotKeys[slotKey] = (slotKeys[slotKey] || 0) + 1;
    dateShiftCounts[dsKey] = (dateShiftCounts[dsKey] || 0) + 1;
    dateCounts[dateStr] = (dateCounts[dateStr] || 0) + 1;
    unitCounts[unitId] = (unitCounts[unitId] || 0) + 1;
  }
  
  // ユニークslot数
  const uniqueSlots = Object.keys(slotKeys).length;
  // 重複しているslot
  const dupSlots = Object.keys(slotKeys).filter(function(k) { return slotKeys[k] > 1; });
  
  Logger.log('=== T_シフト確定 夜勤 構造分析 ===');
  Logger.log('総夜勤レコード: ' + total);
  Logger.log('ユニーク (date_unitId_shift): ' + uniqueSlots);
  Logger.log('重複してるslot数: ' + dupSlots.length);
  Logger.log('');
  
  // 重複スロット上位10件
  if (dupSlots.length > 0) {
    Logger.log('=== 重複slot上位10件 ===');
    dupSlots.sort(function(a,b){ return slotKeys[b] - slotKeys[a]; }).slice(0,10).forEach(function(k) {
      Logger.log('  ' + k + ' x ' + slotKeys[k]);
    });
    Logger.log('');
  }
  
  // 日付別配置数 (異常な日があるか)
  Logger.log('=== 日別配置数 (上位5/下位5) ===');
  const sortedDates = Object.keys(dateCounts).sort();
  Logger.log('日数: ' + sortedDates.length);
  const dateValues = sortedDates.map(function(d) { return {date: d, count: dateCounts[d]}; });
  dateValues.sort(function(a,b){ return b.count - a.count; });
  Logger.log('上位5:');
  dateValues.slice(0,5).forEach(function(d) { Logger.log('  ' + d.date + ': ' + d.count + '件'); });
  Logger.log('下位5:');
  dateValues.slice(-5).forEach(function(d) { Logger.log('  ' + d.date + ': ' + d.count + '件'); });
  Logger.log('');
  
  // ユニット別配置数 (上位5/下位5)
  Logger.log('=== ユニット別配置数 (上位5/下位5) ===');
  Logger.log('ユニット数: ' + Object.keys(unitCounts).length);
  const unitValues = Object.keys(unitCounts).map(function(u) { return {unit: u, count: unitCounts[u]}; });
  unitValues.sort(function(a,b){ return b.count - a.count; });
  Logger.log('上位5:');
  unitValues.slice(0,5).forEach(function(u) { Logger.log('  ' + u.unit + ': ' + u.count + '件'); });
  Logger.log('下位5:');
  unitValues.slice(-5).forEach(function(u) { Logger.log('  ' + u.unit + ': ' + u.count + '件'); });
}


// Phase 5 追加: T_シフト確定 2026-06 クリア (clearContent方式)
function clear_shift_kakutei_2026_06() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('T_シフト確定');
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  
  if (lastRow < 2) { Logger.log('データなし'); return; }
  
  const data = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const header = data[0];
  const kept = [header];
  let removed = 0;
  
  for (let i = 1; i < data.length; i++) {
    const dateVal = data[i][1];
    let dateStr = '';
    if (dateVal instanceof Date) {
      dateStr = Utilities.formatDate(dateVal, 'JST', 'yyyy-MM');
    } else {
      dateStr = String(dateVal || '').substring(0, 7);
    }
    if (dateStr === '2026-06') {
      removed++;
    } else {
      kept.push(data[i]);
    }
  }
  
  sheet.getRange(1, 1, lastRow, lastCol).clearContent();
  if (kept.length > 0) {
    sheet.getRange(1, 1, kept.length, lastCol).setValues(kept);
  }
  
  Logger.log('=== T_シフト確定 2026-06 クリア完了 ===');
  Logger.log('削除: ' + removed + '件 / 残: ' + (kept.length - 1) + '件');
}


// Phase 5: テストデータの信用度監査
function debug_audit_test_data_quality() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const wishSheet = ss.getSheetByName('T_希望提出');
  const staffSheet = ss.getSheetByName('M_スタッフ');
  
  // M_スタッフから稼働141名の許可施設をマップ化
  const staffData = staffSheet.getDataRange().getValues();
  const staffInfo = {};  // sid → {mainFac, secondFac, subFacs, allowedNight, allowedDay, name}
  const NIGHT = ['夜勤A', '夜勤B', '夜勤C'];
  const DAY = ['早出8h', '早出4h', '遅出8h', '遅出4h'];
  
  for (let i = 1; i < staffData.length; i++) {
    const r = staffData[i];
    if (!r[0]) continue;
    if (String(r[16]).toUpperCase() === 'TRUE') continue;
    const allowedRaw = String(r[13] || '').trim();
    if (!allowedRaw) continue;
    const allowed = allowedRaw.split(',').map(function(s){return s.trim();}).filter(Boolean);
    
    staffInfo[String(r[0]).trim()] = {
      sid: String(r[0]).trim(),
      name: r[1],
      mainFac: String(r[9] || '').trim(),
      secondFac: String(r[10] || '').trim(),
      subFacs: String(r[11] || '').split(',').map(function(s){return s.trim();}).filter(Boolean),
      allowedNight: allowed.filter(function(s) { return NIGHT.indexOf(s) !== -1; }),
      allowedDay: allowed.filter(function(s) { return DAY.indexOf(s) !== -1; }),
      hasNight: allowed.some(function(s) { return NIGHT.indexOf(s) !== -1; }),
      hasDay: allowed.some(function(s) { return DAY.indexOf(s) !== -1; })
    };
  }
  
  Logger.log('=== M_スタッフ 稼働状況 ===');
  Logger.log('稼働スタッフ: ' + Object.keys(staffInfo).length + '名');
  let bothCount = 0, nightOnly = 0, dayOnly = 0;
  Object.values(staffInfo).forEach(function(s) {
    if (s.hasNight && s.hasDay) bothCount++;
    else if (s.hasNight) nightOnly++;
    else if (s.hasDay) dayOnly++;
  });
  Logger.log('  両方許可: ' + bothCount + '名');
  Logger.log('  夜勤のみ: ' + nightOnly + '名');
  Logger.log('  日勤のみ: ' + dayOnly + '名');
  
  // T_希望提出 2026-06 を staff_id ごとにグループ化
  const wishData = wishSheet.getDataRange().getValues();
  const wishesByStaff = {};  // sid → [{date, shift, h, i, j}]
  
  for (let i = 1; i < wishData.length; i++) {
    const ymVal = wishData[i][4];
    const ymStr = (ymVal instanceof Date)
      ? Utilities.formatDate(ymVal, 'JST', 'yyyy-MM')
      : String(ymVal || '').substring(0, 7);
    if (ymStr !== '2026-06') continue;
    
    const sid = String(wishData[i][2]).trim();
    if (!wishesByStaff[sid]) wishesByStaff[sid] = [];
    wishesByStaff[sid].push({
      shift: String(wishData[i][6] || '').trim(),
      h: String(wishData[i][7] || '').trim(),
      i: String(wishData[i][8] || '').trim(),
      j: String(wishData[i][9] || '').trim()
    });
  }
  
  Logger.log('');
  Logger.log('=== 希望提出してるスタッフ ===');
  Logger.log('提出した稼働スタッフ: ' + Object.keys(wishesByStaff).length + '名');
  Logger.log('未提出の稼働スタッフ: ' + (Object.keys(staffInfo).length - Object.keys(wishesByStaff).length) + '名');
  
  // === 監査A: 施設記入が許可施設に整合してるか ===
  let facMismatch = 0;
  const mismatchSamples = [];
  
  Object.keys(wishesByStaff).forEach(function(sid) {
    const staff = staffInfo[sid];
    if (!staff) return;
    
    const wishes = wishesByStaff[sid];
    wishes.forEach(function(w) {
      // H列がメイン施設と一致するか
      if (w.h !== staff.mainFac) {
        if (mismatchSamples.length < 5) {
          mismatchSamples.push('sid=' + sid + ' name=' + staff.name + 
            ' / H=' + w.h + ' (期待:' + staff.mainFac + ')');
        }
        facMismatch++;
      }
      // I列がセカンド施設と一致するか
      const expectedI = staff.secondFac || '';
      if (w.i !== expectedI) {
        facMismatch++;
      }
      // J列がサブ施設(全部結合)と一致するか
      const expectedJ = staff.subFacs.join(',');
      if (w.j !== expectedJ) {
        facMismatch++;
      }
    });
  });
  
  Logger.log('');
  Logger.log('=== 監査A: 施設記入の整合性 ===');
  Logger.log('施設不整合の希望レコ件数: ' + facMismatch);
  if (mismatchSamples.length > 0) {
    Logger.log('サンプル(H列ズレ):');
    mismatchSamples.forEach(function(s) { Logger.log('  ' + s); });
  }
  
  // === 監査B: 両方許可スタッフの提出状況 ===
  Logger.log('');
  Logger.log('=== 監査B: 両方許可スタッフの希望提出状況 ===');
  let bothSubmitted = 0, bothNotSubmitted = 0;
  let bothNightOnlyInWish = 0, bothDayOnlyInWish = 0, bothNoneInWish = 0;
  const bothMissingNightSamples = [];
  
  Object.values(staffInfo).forEach(function(staff) {
    if (!(staff.hasNight && staff.hasDay)) return;
    const wishes = wishesByStaff[staff.sid];
    if (!wishes || wishes.length === 0) {
      bothNotSubmitted++;
      return;
    }
    bothSubmitted++;
    
    let hasNightWish = false, hasDayWish = false;
    wishes.forEach(function(w) {
      if (NIGHT.indexOf(w.shift) !== -1) hasNightWish = true;
      else if (DAY.indexOf(w.shift) !== -1) hasDayWish = true;
    });
    
    if (hasNightWish && hasDayWish) {
      // OK
    } else if (hasNightWish) {
      bothDayOnlyInWish++;  // 日勤抜け
    } else if (hasDayWish) {
      bothNightOnlyInWish++;  // 夜勤抜け
      if (bothMissingNightSamples.length < 5) {
        bothMissingNightSamples.push('sid=' + staff.sid + ' name=' + staff.name + 
          ' / 希望' + wishes.length + '件全部日勤');
      }
    } else {
      bothNoneInWish++;
    }
  });
  
  Logger.log('両方許可スタッフ: ' + bothCount + '名');
  Logger.log('  希望提出済: ' + bothSubmitted + '名');
  Logger.log('  希望未提出: ' + bothNotSubmitted + '名');
  Logger.log('  --- 提出済の内訳 ---');
  Logger.log('  夜勤+日勤両方希望: ' + (bothSubmitted - bothNightOnlyInWish - bothDayOnlyInWish - bothNoneInWish) + '名');
  Logger.log('  夜勤抜け(日勤のみ希望): ' + bothNightOnlyInWish + '名 ★問題');
  Logger.log('  日勤抜け(夜勤のみ希望): ' + bothDayOnlyInWish + '名');
  if (bothMissingNightSamples.length > 0) {
    Logger.log('  夜勤抜けサンプル:');
    bothMissingNightSamples.forEach(function(s) { Logger.log('    ' + s); });
  }
  
  // === 監査C: ユニット別希望者数 ===
  Logger.log('');
  Logger.log('=== 監査C: ユニット別の夜勤希望スタッフ数 ===');
  // M_ユニットからユニット→施設マップ
  const unitSheet = ss.getSheetByName('M_ユニット');
  const unitData = unitSheet.getDataRange().getValues();
  const unitToFac = {};
  for (let i = 1; i < unitData.length; i++) {
    if (!unitData[i][0]) continue;
    unitToFac[String(unitData[i][0]).trim()] = String(unitData[i][3] || '').trim();
  }
  
  // 各ユニットの施設に対し、希望してる夜勤スタッフ何人いるか
  const facToNightStaff = {};  // facility → Set(sid)
  Object.keys(wishesByStaff).forEach(function(sid) {
    const staff = staffInfo[sid];
    if (!staff) return;
    const wishes = wishesByStaff[sid];
    const hasNightWish = wishes.some(function(w) { return NIGHT.indexOf(w.shift) !== -1; });
    if (!hasNightWish) return;
    
    [staff.mainFac, staff.secondFac].concat(staff.subFacs).forEach(function(fac) {
      if (!fac) return;
      if (!facToNightStaff[fac]) facToNightStaff[fac] = new Set();
      facToNightStaff[fac].add(sid);
    });
  });
  
  // 不足ユニット (U22, U11, U06, U18, U21) の施設名を出して希望者数表示
  const targetUnits = ['U22', 'U11', 'U06', 'U18', 'U21'];
  Logger.log('問題ユニットの夜勤希望者数:');
  targetUnits.forEach(function(uid) {
    const fac = unitToFac[uid] || '?';
    const cnt = facToNightStaff[fac] ? facToNightStaff[fac].size : 0;
    Logger.log('  ' + uid + ' (施設=' + fac + '): 夜勤希望者' + cnt + '名 / 必要30日分');
  });
}


// ============================================================
// Phase 5.5 テスト用関数: 1人だけ freqCount を上書き設定して検証
// ============================================================

// 指定スタッフの freqCount を一時的に上書き (テスト用)
function debug_set_freq_for_one_staff(staffId, freqType, freqCount) {
  staffId = staffId || '901';
  freqType = freqType || '月次合計';
  freqCount = freqCount || 8;
  
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('T_希望提出');
  const data = sheet.getDataRange().getValues();
  let updated = 0;
  
  for (let i = 1; i < data.length; i++) {
    const ymVal = data[i][4];
    const ymStr = (ymVal instanceof Date)
      ? Utilities.formatDate(ymVal, 'JST', 'yyyy-MM')
      : String(ymVal || '').substring(0, 7);
    if (ymStr !== '2026-06') continue;
    
    const sid = String(data[i][2]).trim();
    if (sid !== String(staffId).trim()) continue;
    
    sheet.getRange(i + 1, 12).setValue(freqType);   // L列(1-index 12)
    sheet.getRange(i + 1, 13).setValue(freqCount);  // M列(1-index 13)
    updated++;
  }
  
  Logger.log('=== freqCount 上書き完了 ===');
  Logger.log('staffId: ' + staffId);
  Logger.log('freqType: ' + freqType);
  Logger.log('freqCount: ' + freqCount);
  Logger.log('更新行数: ' + updated);
}

// 全スタッフのfreq設定 + 配置数を比較して整合チェック
function debug_phase5_freq_status_all() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const wishSheet = ss.getSheetByName('T_希望提出');
  const confSheet = ss.getSheetByName('T_シフト確定');
  
  const wishData = wishSheet.getDataRange().getValues();
  const staffFreq = {};
  for (let i = 1; i < wishData.length; i++) {
    const ymVal = wishData[i][4];
    const ymStr = (ymVal instanceof Date)
      ? Utilities.formatDate(ymVal, 'JST', 'yyyy-MM')
      : String(ymVal || '').substring(0, 7);
    if (ymStr !== '2026-06') continue;
    const sid = String(wishData[i][2]).trim();
    if (staffFreq[sid]) continue;
    const type = String(wishData[i][11] || '').trim();
    const count = parseInt(wishData[i][12]) || 0;
    if (type && count > 0) staffFreq[sid] = { type: type, count: count };
  }
  
  const confData = confSheet.getDataRange().getValues();
  const staffCount = {};
  for (let i = 1; i < confData.length; i++) {
    const dateVal = confData[i][1];
    const dateStr = (dateVal instanceof Date)
      ? Utilities.formatDate(dateVal, 'JST', 'yyyy-MM') : String(dateVal || '').substring(0, 7);
    if (dateStr !== '2026-06') continue;
    const sid = String(confData[i][6] || '').trim();  // ★G列(idx=6) staff_id
    if (!sid) continue;
    staffCount[sid] = (staffCount[sid] || 0) + 1;
  }
  
  Logger.log('=== freq vs 配置数 ===');
  Logger.log('staffFreq設定済: ' + Object.keys(staffFreq).length + '名');
  let overLimit = 0, underLimit = 0, exactLimit = 0;
  Object.keys(staffFreq).forEach(function(sid) {
    const f = staffFreq[sid];
    const c = staffCount[sid] || 0;
    if (c > f.count) overLimit++;
    else if (c === f.count) exactLimit++;
    else underLimit++;
  });
  Logger.log('  上限超過(NG): ' + overLimit);
  Logger.log('  上限ピッタリ: ' + exactLimit);
  Logger.log('  上限以下: ' + underLimit);
  
  if (overLimit > 0) {
    Logger.log('');
    Logger.log('=== 上限超過スタッフ (重大NG) ===');
    Object.keys(staffFreq).forEach(function(sid) {
      const f = staffFreq[sid];
      const c = staffCount[sid] || 0;
      if (c > f.count) {
        Logger.log('  sid=' + sid + ' / 設定=' + f.type + '/' + f.count + ' / 実配置=' + c);
      }
    });
  }
}


// Phase 5.5: T_希望提出 2026-06 から実在のstaff_idサンプルを取得
function debug_phase5_pick_sample_staff() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('T_希望提出');
  const data = sheet.getDataRange().getValues();
  
  const NIGHT = ['夜勤A', '夜勤B', '夜勤C'];
  const counts = {};  // sid → 夜勤希望件数
  
  for (let i = 1; i < data.length; i++) {
    const ymVal = data[i][4];
    const ymStr = (ymVal instanceof Date)
      ? Utilities.formatDate(ymVal, 'JST', 'yyyy-MM')
      : String(ymVal || '').substring(0, 7);
    if (ymStr !== '2026-06') continue;
    const shift = String(data[i][6] || '').trim();
    if (NIGHT.indexOf(shift) === -1) continue;
    const sid = String(data[i][2]).trim();
    counts[sid] = (counts[sid] || 0) + 1;
  }
  
  // 夜勤希望件数の多いスタッフ上位10名を出す
  const list = Object.keys(counts).map(function(sid) { return {sid: sid, count: counts[sid]}; });
  list.sort(function(a, b) { return b.count - a.count; });
  
  Logger.log('=== 夜勤希望件数 上位10名 ===');
  list.slice(0, 10).forEach(function(s) {
    Logger.log('  sid=' + s.sid + ' / 夜勤希望: ' + s.count + '件');
  });
  Logger.log('');
  Logger.log('テストには上記から 夜勤希望が10件以上ある人を選んで');
  Logger.log('debug_set_freq_for_one_staff(\'<sid>\', \'月次合計\', 8) で freqCount=8 設定');
}


// Phase 5.5: sid=24 で freqCount=8 を設定するラッパー (引数不要、GASエディタから直接実行可)
function debug_phase5_set_sid24_freq8() {
  debug_set_freq_for_one_staff('24', '月次合計', 8);
}

// 任意staff_idの実配置数を出す
function debug_phase5_count_staff_assignments(staffId) {
  staffId = staffId || '24';
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('T_シフト確定');
  const data = sheet.getDataRange().getValues();
  let cnt = 0;
  const dates = [];
  for (let i = 1; i < data.length; i++) {
    const dateVal = data[i][1];
    const dateStr = (dateVal instanceof Date)
      ? Utilities.formatDate(dateVal, 'JST', 'yyyy-MM-dd') : String(dateVal || '').substring(0, 10);
    if (dateStr.substring(0, 7) !== '2026-06') continue;
    const sid = String(data[i][6] || '').trim();  // ★G列(idx=6) staff_id
    if (sid !== String(staffId).trim()) continue;
    cnt++;
    const shift = String(data[i][8] || '').trim();
    dates.push(dateStr + ' ' + shift);
  }
  Logger.log('=== sid=' + staffId + ' の2026-06配置 ===');
  Logger.log('配置数: ' + cnt);
  dates.forEach(function(d) { Logger.log('  ' + d); });
}

function debug_phase5_count_sid24() {
  debug_phase5_count_staff_assignments('24');
}


// ============================================================
// Phase 6 検証: マスタの主職種分布調査
// ============================================================
function debug_phase6_check_main_roles() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('M_スタッフ');
  const data = sheet.getDataRange().getValues();
  
  // T列(19) = 主職種
  const roleCount = {};
  const jigCount = {};  // 事業所×主職種
  
  let active = 0, retired = 0;
  
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    if (String(data[i][16]).toUpperCase() === 'TRUE') { retired++; continue; }
    active++;
    
    const mainFac = String(data[i][9] || '').trim();
    const rolesRaw = String(data[i][19] || '').trim();
    if (!rolesRaw) {
      roleCount['(未設定)'] = (roleCount['(未設定)'] || 0) + 1;
      continue;
    }
    
    const roles = rolesRaw.split(',').map(function(s){return s.trim();}).filter(Boolean);
    roles.forEach(function(role) {
      roleCount[role] = (roleCount[role] || 0) + 1;
      
      // 事業所×主職種 (メイン施設→事業所マッピングが必要、ここでは施設名のまま)
      const key = mainFac + '/' + role;
      jigCount[key] = (jigCount[key] || 0) + 1;
    });
  }
  
  Logger.log('=== M_スタッフ 主職種分布 ===');
  Logger.log('稼働: ' + active + '名 / 退職: ' + retired + '名');
  Logger.log('');
  Logger.log('--- 主職種別 ---');
  Object.keys(roleCount).sort().forEach(function(r) {
    Logger.log('  ' + r + ': ' + roleCount[r] + '名');
  });
  
  // 兼任パターン
  Logger.log('');
  Logger.log('--- 兼任パターン分析 ---');
  const patternCount = {};
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    if (String(data[i][16]).toUpperCase() === 'TRUE') continue;
    const rolesRaw = String(data[i][19] || '').trim();
    if (!rolesRaw) continue;
    const roles = rolesRaw.split(',').map(function(s){return s.trim();}).filter(Boolean).sort();
    const pattern = roles.join('+') || '(なし)';
    patternCount[pattern] = (patternCount[pattern] || 0) + 1;
  }
  Object.keys(patternCount).sort().forEach(function(p) {
    Logger.log('  ' + p + ': ' + patternCount[p] + '名');
  });
}

// 事業所別の主職種分布 (Phase 6 修正版: 全許可施設 + E-st仮想施設対応)
function debug_phase6_check_roles_by_jigyosho() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const staffSheet = ss.getSheetByName('M_スタッフ');
  const unitSheet = ss.getSheetByName('M_ユニット');
  
  // ユニット → 事業所マッピング (施設経由)
  const unitData = unitSheet.getDataRange().getValues();
  const facToJig = {};
  const jigSet = new Set();
  for (let i = 1; i < unitData.length; i++) {
    if (!unitData[i][0]) continue;
    const jig = String(unitData[i][1] || '').trim();
    const fac = String(unitData[i][3] || '').trim();
    if (fac && jig) {
      // 1施設が複数事業所にまたがる場合 (E-st) は配列で持つ
      if (!facToJig[fac]) facToJig[fac] = new Set();
      facToJig[fac].add(jig);
      jigSet.add(jig);
    }
  }
  
  // 施設名 → E-st判定 (E-stを含む施設は両事業所所属)
  function isEstFac(facName) {
    return facName.indexOf('E-st') !== -1;
  }
  
  // スタッフ主職種を事業所別に集計
  const data = staffSheet.getDataRange().getValues();
  const jigRoles = {};  // 事業所 → 主職種 → Set(staff_id) (重複排除)
  const unassigned = [];  // 振り分けできなかったスタッフ
  
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    if (String(data[i][16]).toUpperCase() === 'TRUE') continue;
    
    const sid = String(data[i][0]).trim();
    const name = data[i][1];
    const mainFac = String(data[i][9] || '').trim();
    const secondFac = String(data[i][10] || '').trim();
    const subRaw = String(data[i][11] || '').trim();
    const subFacs = subRaw ? subRaw.split(',').map(function(s){return s.trim();}).filter(Boolean) : [];
    const rolesRaw = String(data[i][19] || '').trim();
    if (!rolesRaw) continue;
    const roles = rolesRaw.split(',').map(function(s){return s.trim();}).filter(Boolean);
    
    // スタッフが所属する事業所を全部リストアップ (メイン/セカンド/サブ施設経由)
    const staffJigs = new Set();
    const facs = [mainFac, secondFac].concat(subFacs).filter(Boolean);
    
    facs.forEach(function(fac) {
      if (facToJig[fac]) {
        facToJig[fac].forEach(function(jig) { staffJigs.add(jig); });
      } else if (isEstFac(fac)) {
        // E-st施設の振り分け: 板橋北区とセカンドの両方
        staffJigs.add('GHコノヒカラ板橋北区');
        staffJigs.add('GHコノヒカラ板橋北区セカンド');
      }
    });
    
    if (staffJigs.size === 0) {
      unassigned.push({sid: sid, name: name, mainFac: mainFac});
      continue;
    }
    
    // 各事業所に主職種を加算 (重複防止のためSet)
    staffJigs.forEach(function(jig) {
      if (!jigRoles[jig]) jigRoles[jig] = {};
      roles.forEach(function(role) {
        if (!jigRoles[jig][role]) jigRoles[jig][role] = new Set();
        jigRoles[jig][role].add(sid);
      });
    });
  }
  
  Logger.log('=== 事業所×主職種 (メイン+セカンド+サブ全施設ベース) ===');
  Logger.log('★同一スタッフが複数事業所所属の場合は両方にカウント');
  Logger.log('');
  
  // 5事業所順で出力
  const expectedJigs = ['GHコノヒカラ', 'GHコノヒカラ品川', 'GHコノヒカラ練馬', 'GHコノヒカラ板橋北区', 'GHコノヒカラ板橋北区セカンド'];
  expectedJigs.forEach(function(jig) {
    Logger.log('▼ ' + jig);
    if (jigRoles[jig]) {
      const roles = jigRoles[jig];
      ['サビ管', '世話人', '生活支援員', '管理者'].forEach(function(role) {
        if (roles[role]) {
          Logger.log('  ' + role + ': ' + roles[role].size + '名');
        }
      });
    } else {
      Logger.log('  (該当スタッフなし)');
    }
    Logger.log('');
  });
  
  // 未振り分けスタッフ (E-stとかにも該当しない人)
  if (unassigned.length > 0) {
    Logger.log('=== 未振り分けスタッフ (要確認) ===');
    unassigned.forEach(function(s) {
      Logger.log('  sid=' + s.sid + ' / ' + s.name + ' / メイン=' + s.mainFac);
    });
  }
}


// ============================================================
// Phase 6 検証: M_ユニットの実データ確認
// ============================================================
function debug_show_units_sample() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('M_ユニット');
  const data = sheet.getDataRange().getValues();
  Logger.log('行数: ' + data.length);
  Logger.log('ヘッダー: ' + JSON.stringify(data[0]));
  Logger.log('');
  for (let i = 1; i < Math.min(data.length, 23); i++) {
    Logger.log('行' + i + ': ' + JSON.stringify(data[i]));
  }
}


// ============================================================
// Phase 6: 配置エンジンの動作トレース (sid別の assignedRole 確認)
// ============================================================
function debug_phase6_check_assigned_roles() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('T_シフト確定');
  const data = sheet.getDataRange().getValues();
  const staffSheet = ss.getSheetByName('M_スタッフ');
  const staffData = staffSheet.getDataRange().getValues();
  
  // staff_id → 主職種マップ
  const staffRoles = {};
  for (let i = 1; i < staffData.length; i++) {
    if (!staffData[i][0]) continue;
    const sid = String(staffData[i][0]).trim();
    const rolesRaw = String(staffData[i][19] || '').trim();
    staffRoles[sid] = rolesRaw ? rolesRaw.split(',').map(function(s){return s.trim();}).filter(Boolean) : [];
  }
  
  // T_シフト確定のassignedRole列を確認 (idx=18 想定、列構造に依存)
  // ヘッダー先に出す
  Logger.log('=== T_シフト確定 ヘッダ (列構造確認) ===');
  Logger.log(JSON.stringify(data[0]));
  Logger.log('');
  
  // 日勤レコードのassignedRole分布
  const roleDistByJig = {};  // 事業所 → assignedRole → 件数
  const sidAssignedRole = {};  // sid → {assignedRole: count}
  
  const DAY_SHIFTS = ['早出8h', '早出4h', '遅出8h', '遅出4h'];
  
  for (let i = 1; i < data.length; i++) {
    const dateVal = data[i][1];
    const dateStr = (dateVal instanceof Date)
      ? Utilities.formatDate(dateVal, 'JST', 'yyyy-MM') : String(dateVal || '').substring(0, 7);
    if (dateStr !== '2026-06') continue;
    
    const shift = String(data[i][8] || '').trim();
    if (DAY_SHIFTS.indexOf(shift) === -1) continue;  // 日勤のみ
    
    const jig = String(data[i][3] || '').trim();
    const sid = String(data[i][6] || '').trim();
    const assignedRole = String(data[i][18] || '').trim();  // ★assignedRole列 (要確認)
    
    if (!roleDistByJig[jig]) roleDistByJig[jig] = {};
    roleDistByJig[jig][assignedRole] = (roleDistByJig[jig][assignedRole] || 0) + 1;
    
    if (!sidAssignedRole[sid]) sidAssignedRole[sid] = {};
    sidAssignedRole[sid][assignedRole] = (sidAssignedRole[sid][assignedRole] || 0) + 1;
  }
  
  Logger.log('=== 事業所別 assignedRole 分布 ===');
  Object.keys(roleDistByJig).sort().forEach(function(jig) {
    Logger.log('▼ ' + jig);
    Object.keys(roleDistByJig[jig]).sort().forEach(function(role) {
      Logger.log('  ' + (role || '(空)') + ': ' + roleDistByJig[jig][role] + '件');
    });
  });
  
  // 生活支援員として配置された人がいるか
  Logger.log('');
  Logger.log('=== 生活支援員配置 詳細 ===');
  let seikatsuCount = 0;
  Object.keys(sidAssignedRole).forEach(function(sid) {
    if (sidAssignedRole[sid]['生活支援員']) {
      seikatsuCount++;
      Logger.log('  sid=' + sid + ' / 主職種=' + (staffRoles[sid] || []).join(',') + 
                 ' / 生活支援員配置=' + sidAssignedRole[sid]['生活支援員'] + '件');
    }
  });
  Logger.log('合計 生活支援員配置スタッフ: ' + seikatsuCount + '名');
}


// ============================================================
// Phase 6: スタッフ別の配置数分布 (どこが詰まってるか調査)
// ============================================================
function debug_phase6_staff_assignment_distribution() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const confSheet = ss.getSheetByName('T_シフト確定');
  const wishSheet = ss.getSheetByName('T_希望提出');
  const staffSheet = ss.getSheetByName('M_スタッフ');
  
  // スタッフごとの希望件数 (夜勤/日勤別)
  const wishData = wishSheet.getDataRange().getValues();
  const staffWish = {};  // sid → {night, day}
  const NIGHT = ['夜勤A', '夜勤B', '夜勤C'];
  const DAY = ['早出8h', '早出4h', '遅出8h', '遅出4h'];
  
  for (let i = 1; i < wishData.length; i++) {
    const ymVal = wishData[i][4];
    const ymStr = (ymVal instanceof Date)
      ? Utilities.formatDate(ymVal, 'JST', 'yyyy-MM')
      : String(ymVal || '').substring(0, 7);
    if (ymStr !== '2026-06') continue;
    const sid = String(wishData[i][2]).trim();
    const shift = String(wishData[i][6] || '').trim();
    if (!staffWish[sid]) staffWish[sid] = {night: 0, day: 0};
    if (NIGHT.indexOf(shift) !== -1) staffWish[sid].night++;
    else if (DAY.indexOf(shift) !== -1) staffWish[sid].day++;
  }
  
  // スタッフごとの実配置数 (夜勤/日勤別)
  const confData = confSheet.getDataRange().getValues();
  const staffAssign = {};
  for (let i = 1; i < confData.length; i++) {
    const dateVal = confData[i][1];
    const dateStr = (dateVal instanceof Date)
      ? Utilities.formatDate(dateVal, 'JST', 'yyyy-MM') : String(dateVal || '').substring(0, 7);
    if (dateStr !== '2026-06') continue;
    const sid = String(confData[i][6] || '').trim();
    const shift = String(confData[i][8] || '').trim();
    if (!staffAssign[sid]) staffAssign[sid] = {night: 0, day: 0};
    if (NIGHT.indexOf(shift) !== -1) staffAssign[sid].night++;
    else if (DAY.indexOf(shift) !== -1) staffAssign[sid].day++;
  }
  
  // スタッフマスタ参照 (主職種・許可シフト)
  const staffData = staffSheet.getDataRange().getValues();
  const staffInfo = {};
  for (let i = 1; i < staffData.length; i++) {
    if (!staffData[i][0]) continue;
    if (String(staffData[i][16]).toUpperCase() === 'TRUE') continue;
    const sid = String(staffData[i][0]).trim();
    staffInfo[sid] = {
      allowedShifts: String(staffData[i][13] || '').split(',').map(function(s){return s.trim();}).filter(Boolean),
      mainRoles: String(staffData[i][19] || '').split(',').map(function(s){return s.trim();}).filter(Boolean),
    };
  }
  
  // 日勤許可で日勤希望出してるのに日勤配置0件のスタッフを抽出
  let nightOnly = 0, dayOnly = 0, both = 0;
  let dayUnderAssigned = 0;  // 日勤許可で希望ありなのに配置少ない
  
  Object.keys(staffInfo).forEach(function(sid) {
    const allowed = staffInfo[sid].allowedShifts;
    const hasNight = allowed.some(function(s){return NIGHT.indexOf(s) !== -1;});
    const hasDay = allowed.some(function(s){return DAY.indexOf(s) !== -1;});
    if (hasNight && hasDay) both++;
    else if (hasNight) nightOnly++;
    else if (hasDay) dayOnly++;
    
    if (hasDay) {
      const assigned = (staffAssign[sid] && staffAssign[sid].day) || 0;
      const wished = (staffWish[sid] && staffWish[sid].day) || 0;
      if (wished > 0 && assigned < wished / 2) {
        dayUnderAssigned++;
      }
    }
  });
  
  Logger.log('=== スタッフ許可シフト内訳 ===');
  Logger.log('夜勤のみ: ' + nightOnly + ' / 日勤のみ: ' + dayOnly + ' / 両方: ' + both);
  Logger.log('日勤希望出してるのに配置半分以下のスタッフ: ' + dayUnderAssigned);
  
  // 日勤配置の分布
  Logger.log('');
  Logger.log('=== 日勤配置数分布 (日勤許可スタッフのみ) ===');
  const dayDistribution = {};
  Object.keys(staffInfo).forEach(function(sid) {
    const allowed = staffInfo[sid].allowedShifts;
    const hasDay = allowed.some(function(s){return DAY.indexOf(s) !== -1;});
    if (!hasDay) return;
    const assigned = (staffAssign[sid] && staffAssign[sid].day) || 0;
    dayDistribution[assigned] = (dayDistribution[assigned] || 0) + 1;
  });
  Object.keys(dayDistribution).sort(function(a,b){return parseInt(a) - parseInt(b);}).forEach(function(k) {
    Logger.log('  日勤' + k + '件配置: ' + dayDistribution[k] + '名');
  });
  
  // 主職種別の配置数
  Logger.log('');
  Logger.log('=== 主職種別 日勤配置数集計 ===');
  const roleAssignH = {};  // 主職種 → 配置総件数(日勤)
  Object.keys(staffInfo).forEach(function(sid) {
    const roles = staffInfo[sid].mainRoles;
    const assigned = (staffAssign[sid] && staffAssign[sid].day) || 0;
    roles.forEach(function(r) {
      if (!roleAssignH[r]) roleAssignH[r] = {count: 0, staff: 0};
      roleAssignH[r].count += assigned;
      if (assigned > 0) roleAssignH[r].staff += 1;
    });
  });
  Object.keys(roleAssignH).sort().forEach(function(r) {
    Logger.log('  ' + r + ': 配置' + roleAssignH[r].count + '件 / 配置されたスタッフ' + roleAssignH[r].staff + '名');
  });
}


// ============================================================
// Phase 6: 夜勤レコードの日勤換算時間が充足率に反映されてるか検証
// ============================================================
function debug_phase6_check_night_dayhours() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('T_シフト確定');
  const data = sheet.getDataRange().getValues();
  
  const NIGHT = ['夜勤A', '夜勤B', '夜勤C'];
  const jigNightStats = {};  // 事業所 → {totalNightDayH, recordCount, byShift}
  
  for (let i = 1; i < data.length; i++) {
    const dateVal = data[i][1];
    const dateStr = (dateVal instanceof Date)
      ? Utilities.formatDate(dateVal, 'JST', 'yyyy-MM') : String(dateVal || '').substring(0, 7);
    if (dateStr !== '2026-06') continue;
    
    const shift = String(data[i][8] || '').trim();
    if (NIGHT.indexOf(shift) === -1) continue;
    
    const jig = String(data[i][3] || '').trim();
    const dayH = parseFloat(data[i][17]) || 0;  // idx=17 日勤換算時間
    const nightH = parseFloat(data[i][16]) || 0;
    const assignedRole = String(data[i][18] || '').trim();
    
    if (!jigNightStats[jig]) {
      jigNightStats[jig] = {
        totalNightDayH: 0,
        totalNightNightH: 0,
        recordCount: 0,
        byShift: {},
        byRole: {}
      };
    }
    jigNightStats[jig].totalNightDayH += dayH;
    jigNightStats[jig].totalNightNightH += nightH;
    jigNightStats[jig].recordCount++;
    
    if (!jigNightStats[jig].byShift[shift]) jigNightStats[jig].byShift[shift] = {count: 0, dayH: 0};
    jigNightStats[jig].byShift[shift].count++;
    jigNightStats[jig].byShift[shift].dayH += dayH;
    
    if (!jigNightStats[jig].byRole[assignedRole]) jigNightStats[jig].byRole[assignedRole] = 0;
    jigNightStats[jig].byRole[assignedRole]++;
  }
  
  Logger.log('=== 夜勤レコードの日勤換算時間 集計 ===');
  Object.keys(jigNightStats).sort().forEach(function(jig) {
    const s = jigNightStats[jig];
    Logger.log('');
    Logger.log('▼ ' + jig);
    Logger.log('  夜勤レコード: ' + s.recordCount + '件');
    Logger.log('  夜勤換算時間合計: ' + s.totalNightNightH + 'h');
    Logger.log('  日勤換算時間合計: ' + s.totalNightDayH + 'h  ← これが世話人h等に加算されるはず');
    Logger.log('  シフト別:');
    Object.keys(s.byShift).sort().forEach(function(sh) {
      Logger.log('    ' + sh + ': ' + s.byShift[sh].count + '件, 日勤換算 ' + s.byShift[sh].dayH + 'h');
    });
    Logger.log('  assignedRole分布:');
    Object.keys(s.byRole).sort().forEach(function(r) {
      Logger.log('    ' + (r || '(空)') + ': ' + s.byRole[r] + '件');
    });
  });
}


// ============================================================
// Phase 5.7 テスト: R4警告 動作確認
// 手順:
// 1. inject_realistic_test_wishes_2026_06 で希望2533件 (freqCount=10) 投入
// 2. debug_run_night_2026_06 + debug_run_day_2026_06 で配置
// 3. このテストを実行 - sid=24 を11件目として手動配置を試みる
// ============================================================
function debug_phase57_test_r4() {
  const adminId = '13';  // 水野永吉 (オーナー)
  const targetYM = '2026-06';
  const testSid = '24';  // sid=24 のスタッフを使う
  
  // Step 1: T_シフト確定で sid=24 が当月何件配置されてるか確認
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const shiftSheet = ss.getSheetByName('T_シフト確定');
  const shiftData = shiftSheet.getDataRange().getValues();
  
  let count = 0;
  for (let i = 1; i < shiftData.length; i++) {
    const sid = String(shiftData[i][6] || '').trim();
    if (sid !== testSid) continue;
    const d = shiftData[i][1];
    if (!(d instanceof Date)) continue;
    if (Utilities.formatDate(d, 'JST', 'yyyy-MM') === targetYM) count++;
  }
  Logger.log('=== Phase 5.7 R4テスト ===');
  Logger.log('sid=' + testSid + ' 当月配置数: ' + count);
  
  // Step 2: T_希望提出 から freqCount を取得
  const wishSheet = ss.getSheetByName('T_希望提出');
  const wishData = wishSheet.getDataRange().getValues();
  let freqCount = 0;
  for (let i = 1; i < wishData.length; i++) {
    if (String(wishData[i][2]).trim() !== testSid) continue;
    const ymVal = wishData[i][4];
    const ymStr = (ymVal instanceof Date)
      ? Utilities.formatDate(ymVal, 'JST', 'yyyy-MM') : String(ymVal || '').substring(0, 7);
    if (ymStr !== targetYM) continue;
    freqCount = parseInt(wishData[i][12], 10) || 0;
    if (freqCount > 0) break;
  }
  Logger.log('sid=' + testSid + ' freqCount: ' + freqCount);
  
  if (count < freqCount) {
    Logger.log('★ まだ上限未到達。テストの前に sid=' + testSid + ' を' + (freqCount - count + 1) + '件以上配置する必要あり');
    Logger.log('   inject_realistic_test_wishes_2026_06 + debug_run_*_2026_06 を実行');
    return;
  }
  
  // Step 3: 上限到達済なら、checkR4ManualWarning を直接呼んで動作確認
  const r4 = checkR4ManualWarning(testSid, targetYM, '2026-06-25');
  Logger.log('checkR4ManualWarning 結果:');
  Logger.log(JSON.stringify(r4, null, 2));
  
  if (r4.triggered) {
    Logger.log('✅ R4警告が正常に発火 (message: ' + r4.message + ')');
  } else {
    Logger.log('❌ R4警告が発火しなかった、ロジック要確認');
  }
}


// ============================================================
// Phase 7.5 デバッグ関数 (上代直人のallowedShifts確認)
// ============================================================
function debug_check_uesiro_allowed() {
  const sh = SpreadsheetApp.openById('1IVRo8kj0lmaiuokomDlXVUn6E8XC8tktkwaXjtAAHHE').getSheetByName('M_スタッフ');
  const data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] == 23) {
      Logger.log('=== sid=23 (' + data[i][1] + ') ===');
      Logger.log('J(9) メイン: [' + data[i][9] + ']');
      Logger.log('K(10) セカンド: [' + data[i][10] + ']');
      Logger.log('L(11) サブ: [' + data[i][11] + ']');
      Logger.log('M(12) シフト区分: [' + data[i][12] + ']');
      Logger.log('N(13) allowedShifts: [' + data[i][13] + ']');
      Logger.log('  type: ' + typeof data[i][13]);
      Logger.log('  split: ' + JSON.stringify(String(data[i][13] || '').split(',').map(s => s.trim()).filter(Boolean)));
      Logger.log('T(19) 主職種: [' + data[i][19] + ']');
      Logger.log('退職: [' + data[i][16] + ']');
      return;
    }
  }
  Logger.log('sid=23 not found');
}

function debug_check_fixed_003() {
  const sh = SpreadsheetApp.openById('1IVRo8kj0lmaiuokomDlXVUn6E8XC8tktkwaXjtAAHHE').getSheetByName('M_固定配置');
  const data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === 'FIXED_003') {
      Logger.log('=== FIXED_003 全カラム ===');
      const headers = ['A(0)fixed_id','B(1)staff_id','C(2)type','D(3)target_ym','E(4)dates_or_weekdays','F(5)shift_type','G(6)unit_id','H(7)valid_from','I(8)valid_to','J(9)is_active','K(10)note','L(11)created_at'];
      for (var j = 0; j < data[i].length; j++) {
        Logger.log((headers[j] || 'col'+j) + ': [' + data[i][j] + ']');
      }
      return;
    }
  }
  Logger.log('FIXED_003 not found');
}


// ============================================================
// Phase 7.5: E-st 確認用デバッグ
// ============================================================
function debug_check_est_units() {
  const sh = SpreadsheetApp.openById('1IVRo8kj0lmaiuokomDlXVUn6E8XC8tktkwaXjtAAHHE').getSheetByName('M_ユニット');
  const data = sh.getDataRange().getValues();
  Logger.log('=== M_ユニット 全件 (facility含む施設名で重複) ===');
  const facilities = {};
  for (var i = 1; i < data.length; i++) {
    const fac = data[i][3];
    if (!facilities[fac]) facilities[fac] = [];
    facilities[fac].push({
      unit_id: data[i][0],
      jigyosho: data[i][1],
      unit_name: data[i][2]
    });
  }
  // 複数事業所にまたがる施設のみ抽出
  for (const fac in facilities) {
    const units = facilities[fac];
    const jigyoshos = [...new Set(units.map(u => u.jigyosho))];
    if (jigyoshos.length > 1) {
      Logger.log('★ 複数事業所: ' + fac);
      units.forEach(u => Logger.log('  ' + u.unit_id + ' / ' + u.jigyosho + ' / ' + u.unit_name));
    }
  }
  Logger.log('=== 全施設リスト ===');
  for (const fac in facilities) {
    Logger.log(fac + ' (' + facilities[fac].length + 'ユニット, 事業所=' + [...new Set(facilities[fac].map(u => u.jigyosho))].join('/') + ')');
  }
}
