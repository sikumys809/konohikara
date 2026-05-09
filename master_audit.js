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
