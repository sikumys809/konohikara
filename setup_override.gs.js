function setupSubmitOverrideSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const SHEET_NAME = 'T_提出期間オーバーライド';
  
  // 既存チェック
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (sheet) {
    const ans = SpreadsheetApp.getUi().alert(
      'シート再作成', 
      `${SHEET_NAME} は既に存在します。データを残してヘッダーだけ確認しますか？`,
      SpreadsheetApp.getUi().ButtonSet.YES_NO
    );
    if (ans !== SpreadsheetApp.getUi().Button.YES) return;
  } else {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  
  // ヘッダー
  const headers = [
    'override_id',     // A: ユニークID (タイムスタンプ)
    'staff_id',        // B: 0=全体, 数値=個人
    'staff_name',      // C: 表示用
    'target_ym',       // D: 対象月 YYYY-MM (空=全月対象)
    'start_date',      // E: 有効開始 YYYY-MM-DD
    'end_date',        // F: 有効終了 YYYY-MM-DD
    'unrestricted',    // G: TRUE=期間制限なし(常時可)
    'created_by',      // H: 設定者 staff_id
    'created_by_name', // I: 設定者氏名
    'created_at',      // J: 作成日時
    'memo',            // K: 理由メモ
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#e0f2fe');
  sheet.setFrozenRows(1);
  
  // 列幅
  sheet.setColumnWidth(1, 130);  // override_id
  sheet.setColumnWidth(2, 80);   // staff_id
  sheet.setColumnWidth(3, 120);  // staff_name
  sheet.setColumnWidth(4, 100);  // target_ym
  sheet.setColumnWidth(5, 110);  // start_date
  sheet.setColumnWidth(6, 110);  // end_date
  sheet.setColumnWidth(7, 80);   // unrestricted
  sheet.setColumnWidth(8, 80);   // created_by
  sheet.setColumnWidth(9, 120);  // created_by_name
  sheet.setColumnWidth(10, 150); // created_at
  sheet.setColumnWidth(11, 200); // memo
  
  SpreadsheetApp.getUi().alert(`✅ ${SHEET_NAME} シート準備完了`);
}
