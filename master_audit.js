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
