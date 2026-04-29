function setupValidationRules() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('M_スタッフ');
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    Logger.log('データ行がありません');
    return;
  }

  const numRows = lastRow - 1;
  const log = [];
  log.push('========== 入力規則の一括再設定 開始 ==========');

  // 施設一覧を M_施設 から取得 (A列が施設名)
  const facilitySheet = ss.getSheetByName('M_施設');
  const facilities = facilitySheet.getRange(2, 1, facilitySheet.getLastRow() - 1, 1)
    .getValues().flat().filter(Boolean);
  log.push('施設数: ' + facilities.length);

  // ===== 規則の構築 =====
  const ruleEmployment = SpreadsheetApp.newDataValidation()
    .requireValueInList(['正社員', 'パート'], true)
    .setAllowInvalid(false).build();

  const ruleKubun = SpreadsheetApp.newDataValidation()
    .requireValueInList(['通常', '新人1ヶ月', '新人2ヶ月'], true)
    .setAllowInvalid(false).build();

  const ruleFacility = SpreadsheetApp.newDataValidation()
    .requireValueInList(facilities, true)
    .setAllowInvalid(false).build();

  const ruleShiftKubun = SpreadsheetApp.newDataValidation()
    .requireValueInList(['夜勤のみ', '日勤のみ', '両方'], true)
    .setAllowInvalid(false).build();

  const ruleCheckbox = SpreadsheetApp.newDataValidation()
    .requireCheckbox().build();

  // ===== 単一選択列に規則設定 =====
  sheet.getRange(2, 5, numRows, 1).setDataValidation(ruleEmployment);
  log.push('✅ E列(雇用形態): 正社員/パート');

  sheet.getRange(2, 9, numRows, 1).setDataValidation(ruleKubun);
  log.push('✅ I列(スタッフ区分): 通常/新人1ヶ月/新人2ヶ月');

  sheet.getRange(2, 10, numRows, 1).setDataValidation(ruleFacility);
  log.push('✅ J列(メイン施設名): 施設リスト');

  sheet.getRange(2, 11, numRows, 1).setDataValidation(ruleFacility);
  log.push('✅ K列(セカンド施設名): 施設リスト');

  sheet.getRange(2, 13, numRows, 1).setDataValidation(ruleShiftKubun);
  log.push('✅ M列(シフト区分): 夜勤のみ/日勤のみ/両方');

  sheet.getRange(2, 15, numRows, 1).setDataValidation(ruleCheckbox);
  log.push('✅ O列(保護フラグ): チェックボックス');

  sheet.getRange(2, 16, numRows, 1).setDataValidation(ruleCheckbox);
  log.push('✅ P列(VIP重要フラグ): チェックボックス');

  sheet.getRange(2, 17, numRows, 1).setDataValidation(ruleCheckbox);
  log.push('✅ Q列(退職フラグ): チェックボックス');

  // ===== 複数選択列は規則削除 =====
  sheet.getRange(2, 6, numRows, 1).clearDataValidations();
  log.push('🗑️ F列(国家資格): 規則削除 (フリー入力)');

  sheet.getRange(2, 12, numRows, 1).clearDataValidations();
  log.push('🗑️ L列(サブ施設候補): 規則削除 (複数選択)');

  sheet.getRange(2, 14, numRows, 1).clearDataValidations();
  log.push('🗑️ N列(許可シフト種別): 規則削除 (複数選択)');

  sheet.getRange(2, 19, numRows, 1).clearDataValidations();
  log.push('🗑️ S列(役割): 規則削除 (複数選択)');

  sheet.getRange(2, 20, numRows, 1).clearDataValidations();
  log.push('🗑️ T列(主職種): 規則削除 (複数選択)');

  log.push('========== 完了 ==========');
  log.forEach(l => Logger.log(l));
}
