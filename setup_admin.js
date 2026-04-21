// ============================================
// 管理画面用インフラ (2026-04-19)
// M_スタッフに役割列追加 + T_操作ログ + T_月次ロック
// ============================================

function setupAdminInfrastructure() {
  Logger.log('管理画面インフラ構築開始');
  
  try {
    const ss = SpreadsheetApp.openById(STAFF_SS_ID);
    
    // 1. M_スタッフにS列「役割」追加
    const staffSheet = ss.getSheetByName('M_スタッフ');
    const currentCols = staffSheet.getLastColumn();
    
    if (currentCols < 19) {
      if (staffSheet.getMaxColumns() < 19) {
        staffSheet.insertColumnsAfter(currentCols, 19 - currentCols);
      }
      staffSheet.getRange(1, 19).setValue('役割');
      staffSheet.getRange(1, 19).setFontWeight('bold').setBackground('#4a148c').setFontColor('#ffffff');
      Logger.log('M_スタッフにS列役割を追加');
      
      const roles = [
        'マスタ編集',
        'シフト作成',
        '最終承認者',
        'マスタ編集,シフト作成',
        'マスタ編集,最終承認者',
        'シフト作成,最終承認者',
        'マスタ編集,シフト作成,最終承認者'
      ];
      const rule = SpreadsheetApp.newDataValidation()
        .requireValueInList(roles, true)
        .setAllowInvalid(false)
        .build();
      staffSheet.getRange(2, 19, staffSheet.getMaxRows() - 1, 1).setDataValidation(rule);
      Logger.log('役割プルダウン設定完了');
    } else {
      Logger.log('S列役割はすでに存在');
    }
    
    // 2. 水野さんを全ロールに設定
    const staffData = staffSheet.getDataRange().getValues();
    let mizunoFound = false;
    for (let i = 1; i < staffData.length; i++) {
      if (String(staffData[i][0]).trim() === '1') {
        staffSheet.getRange(i + 1, 19).setValue('マスタ編集,シフト作成,最終承認者');
        Logger.log('水野さん(staff_id=1)を全ロール設定');
        mizunoFound = true;
        break;
      }
    }
    if (!mizunoFound) {
      Logger.log('staff_id=1が見つかりません');
    }
    
    // 3. T_操作ログシート作成
    let logSheet = ss.getSheetByName('T_操作ログ');
    if (!logSheet) {
      logSheet = ss.insertSheet('T_操作ログ');
      const logHeaders = [
        'ログID', '日時', 'staff_id', '氏名', '役割',
        '操作種別', '対象', '対象ID', '変更前', '変更後', 'メモ'
      ];
      logSheet.getRange(1, 1, 1, logHeaders.length).setValues([logHeaders]);
      logSheet.getRange(1, 1, 1, logHeaders.length)
        .setFontWeight('bold').setBackground('#4a148c').setFontColor('#ffffff');
      
      logSheet.setColumnWidth(1, 120);
      logSheet.setColumnWidth(2, 140);
      logSheet.setColumnWidth(3, 80);
      logSheet.setColumnWidth(4, 120);
      logSheet.setColumnWidth(5, 180);
      logSheet.setColumnWidth(6, 120);
      logSheet.setColumnWidth(7, 140);
      logSheet.setColumnWidth(8, 100);
      logSheet.setColumnWidth(9, 200);
      logSheet.setColumnWidth(10, 200);
      logSheet.setColumnWidth(11, 150);
      
      Logger.log('T_操作ログシート作成');
    } else {
      Logger.log('T_操作ログはすでに存在');
    }
    
    // 4. T_月次ロックシート作成
    let lockSheet = ss.getSheetByName('T_月次ロック');
    if (!lockSheet) {
      lockSheet = ss.insertSheet('T_月次ロック');
      const lockHeaders = [
        '対象年月', 'ロック状態', 'ロック取得者ID', 'ロック取得者氏名',
        'ロック取得日時', 'ロック期限', 'メモ'
      ];
      lockSheet.getRange(1, 1, 1, lockHeaders.length).setValues([lockHeaders]);
      lockSheet.getRange(1, 1, 1, lockHeaders.length)
        .setFontWeight('bold').setBackground('#4a148c').setFontColor('#ffffff');
      
      lockSheet.setColumnWidth(1, 100);
      lockSheet.setColumnWidth(2, 100);
      lockSheet.setColumnWidth(3, 100);
      lockSheet.setColumnWidth(4, 120);
      lockSheet.setColumnWidth(5, 140);
      lockSheet.setColumnWidth(6, 140);
      lockSheet.setColumnWidth(7, 200);
      
      Logger.log('T_月次ロックシート作成');
    } else {
      Logger.log('T_月次ロックはすでに存在');
    }
    
    SpreadsheetApp.flush();
    Logger.log('管理画面インフラ構築完了');
    
    return { success: true };
    
  } catch (error) {
    Logger.log('エラー: ' + error.toString());
    return { success: false, error: error.toString() };
  }
}


function testAdminRole() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('M_スタッフ');
  const data = sheet.getDataRange().getValues();
  
  Logger.log('役割設定済みスタッフ一覧:');
  let count = 0;
  for (let i = 1; i < data.length; i++) {
    const role = data[i][18];
    if (role) {
      Logger.log('  staff_id=' + data[i][0] + ' ' + data[i][1] + ' -> ' + role);
      count++;
    }
  }
  Logger.log('合計: ' + count + '人');
  
  const lockSheet = ss.getSheetByName('T_月次ロック');
  const logSheet = ss.getSheetByName('T_操作ログ');
  Logger.log('');
  Logger.log('シート確認:');
  Logger.log('  T_月次ロック: ' + (lockSheet ? '存在' : 'なし'));
  Logger.log('  T_操作ログ: ' + (logSheet ? '存在' : 'なし'));
}