// ============================================
// コノヒカラ シフト管理システム
// Phase 1: DB初期セットアップ
// ============================================

const STAFF_SS_ID = '1IVRo8kj0lmaiuokomDlXVUn6E8XC8tktkwaXjtAAHHE';

function setupAll() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  setup_M_Unit(ss);
  setup_M_Staff(ss);
  setup_T_Request(ss);
  setup_T_Shift(ss);
  setup_T_Attendance(ss);
  setup_V_Duplicate(ss);
  setup_V_Coverage(ss);
  const defaultSheet = ss.getSheetByName('Sheet1') || ss.getSheetByName('シート1');
  if (defaultSheet && ss.getSheets().length > 1) ss.deleteSheet(defaultSheet);
  Logger.log('セットアップ完了！全シートが作成されました。');
}

function getOrCreateSheet(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function setHeader(sheet, headers, bgColor) {
  sheet.clear();
  const range = sheet.getRange(1, 1, 1, headers.length);
  range.setValues([headers]);
  range.setBackground(bgColor)
       .setFontColor('#FFFFFF')
       .setFontWeight('bold')
       .setFontSize(10);
  sheet.setFrozenRows(1);
  sheet.setColumnWidths(1, headers.length, 120);
}

// ============================================
// M_ユニット
// ============================================
function setup_M_Unit(ss) {
  const sheet = getOrCreateSheet(ss, 'M_ユニット');
  const headers = ['unit_id', '事業所名', 'ユニット名', '施設名', '定員'];
  setHeader(sheet, headers, '#3C3489');
  const units = [
    ['U01','GHコノヒカラ板橋北区',        'コノヒカラ板橋北区Ⅰ',        'ルーデンス新板橋Ⅱ',        5],
    ['U02','GHコノヒカラ板橋北区',        'コノヒカラ板橋北区Ⅱ',        'ルーデンス新板橋Ⅱ',        5],
    ['U03','GHコノヒカラ板橋北区',        'コノヒカラ板橋北区Ⅲ',        'ルーデンス東十条アネックス',5],
    ['U04','GHコノヒカラ板橋北区',        'コノヒカラ板橋北区Ⅳ',        'ルーデンス上板橋E-st',      5],
    ['U05','GHコノヒカラ板橋北区',        'コノヒカラ板橋北区Ⅴ',        'ルーデンス東十条マキシブ',  5],
    ['U06','GHコノヒカラ板橋北区',        'コノヒカラ板橋北区Ⅵ',        'ルーデンス東十条マキシブ',  5],
    ['U07','GHコノヒカラ板橋北区セカンド','コノヒカラ板橋北区セカンドⅠ','ルーデンス本蓮沼',          5],
    ['U08','GHコノヒカラ板橋北区セカンド','コノヒカラ板橋北区セカンドⅡ','ルーデンス本蓮沼',          5],
    ['U09','GHコノヒカラ板橋北区セカンド','コノヒカラ板橋北区セカンドⅢ','ルーデンス上板橋E-st',      5],
    ['U10','GHコノヒカラ板橋北区セカンド','コノヒカラ板橋北区セカンドⅣ','ルーデンス板橋区役所前',    5],
    ['U11','GHコノヒカラ板橋北区セカンド','コノヒカラ板橋北区セカンドⅤ','ルーデンス板橋区役所前',    5],
    ['U12','GHコノヒカラ練馬',            'コノヒカラ練馬Ⅰ',            'ルーデンス大泉学園前',      5],
    ['U13','GHコノヒカラ練馬',            'コノヒカラ練馬Ⅱ',            'ルーデンス大泉学園前',      5],
    ['U14','GHコノヒカラ',                'コノヒカラⅠ',                'リフレ要町',                7],
    ['U15','GHコノヒカラ',                'コノヒカラⅡ',                'リフレ要町',                6],
    ['U16','GHコノヒカラ',                'コノヒカラⅤ',                'ルーデンス中野富士見町',    5],
    ['U17','GHコノヒカラ',                'コノヒカラⅥ',                'ルーデンス中野富士見町',    5],
    ['U18','GHコノヒカラ',                'コノヒカラⅦ',                'EST東長崎',                 7],
    ['U19','GHコノヒカラ品川',            'コノヒカラ品川Ⅲ',            'ルーデンス立会川Ⅱ',        7],
    ['U20','GHコノヒカラ品川',            'コノヒカラ品川Ⅳ',            'ルーデンス立会川Ⅱ',        6],
    ['U21','GHコノヒカラ品川',            'コノヒカラ品川Ⅷ',            'ルーデンス梅屋敷',          5],
    ['U22','GHコノヒカラ品川',            'コノヒカラ品川Ⅸ',            'ルーデンス梅屋敷',          5],
  ];
  sheet.getRange(2, 1, units.length, 5).setValues(units);
  sheet.autoResizeColumns(1, 5);
}

// ============================================
// M_スタッフ
// ============================================
function setup_M_Staff(ss) {
  const sheet = getOrCreateSheet(ss, 'M_スタッフ');
  const headers = [
    'staff_id','氏名','メールアドレス','電話番号','雇用形態','国家資格','入社日',
    'スタッフ区分',
    'メイン施設名',   // I：1施設のみ（必須）
    'サブ施設候補',   // J：カンマ区切り複数可（自由入力）
    'シフト区分',     // K
    '許可シフト種別', // L
    '保護フラグ',     // M
    '退職フラグ',     // N
    'デバイストークン',// O
    '備考',           // P
  ];
  setHeader(sheet, headers, '#3C3489');

  const kubunRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['新人1ヶ月','新人2ヶ月','通常'], true).build();
  sheet.getRange('H2:H1000').setDataValidation(kubunRule);

  const shiftKubunRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['夜勤のみ','日勤のみ','両方'], true).build();
  sheet.getRange('K2:K1000').setDataValidation(shiftKubunRule);

  const boolRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['TRUE','FALSE'], true).build();
  sheet.getRange('M2:M1000').setDataValidation(boolRule);
  sheet.getRange('N2:N1000').setDataValidation(boolRule);

  sheet.autoResizeColumns(1, headers.length);
}

// ============================================
// T_希望提出
// ============================================
function setup_T_Request(ss) {
  const sheet = getOrCreateSheet(ss, 'T_希望提出');
  const headers = [
    '提出ID','提出日時','staff_id','氏名','対象年月',
    '希望日','シフト種別','希望施設名1','希望施設名2','希望施設名3',
    'コメント','希望頻度タイプ','希望頻度数',
  ];
  setHeader(sheet, headers, '#0F6E56');
  sheet.getRange('G2:G10000').setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList(['夜勤A','夜勤B','夜勤C','日勤早出','日勤遅出'], true).build());
  sheet.getRange('L2:L10000').setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList(['週次','月次合計'], true).build());
  sheet.autoResizeColumns(1, headers.length);
}

// ============================================
// T_シフト確定
// ============================================
function setup_T_Shift(ss) {
  const sheet = getOrCreateSheet(ss, 'T_シフト確定');
  const headers = [
    'shift_id','日付','unit_id','事業所名','施設名','ユニット名',
    'staff_id','氏名','シフト種別','開始時刻','終了時刻',
    '配置カウント','アラート種別','ステータス','更新日時',
  ];
  setHeader(sheet, headers, '#185FA5');
  sheet.getRange('N2:N10000').setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['仮','確定'], true).build());
  sheet.getRange('M2:M10000').setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['なし','ハードブロック','ソフトウォーニング'], true).build());
  sheet.autoResizeColumns(1, headers.length);
}

// ============================================
// T_打刻
// ============================================
function setup_T_Attendance(ss) {
  const sheet = getOrCreateSheet(ss, 'T_打刻');
  const headers = [
    '打刻ID','日付','staff_id','氏名','施設名',
    '出勤打刻日時','退勤打刻日時','実働時間（分）','出勤フラグ','退勤フラグ','備考',
  ];
  setHeader(sheet, headers, '#854F0B');
  const boolRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['TRUE','FALSE'], true).build();
  sheet.getRange('I2:I10000').setDataValidation(boolRule);
  sheet.getRange('J2:J10000').setDataValidation(boolRule);
  sheet.autoResizeColumns(1, headers.length);
}

// ============================================
// V_重複チェック
// ============================================
function setup_V_Duplicate(ss) {
  const sheet = getOrCreateSheet(ss, 'V_重複チェック');
  const headers = ['日付','staff_id','氏名','重複施設1','重複施設2','重複種別','対象shift_id'];
  setHeader(sheet, headers, '#A32D2D');
  sheet.getRange('A1').setNote('このシートはGASが自動生成します。手動編集しないでください。');
  sheet.autoResizeColumns(1, headers.length);
}

// ============================================
// V_充足確認
// ============================================
function setup_V_Coverage(ss) {
  const sheet = getOrCreateSheet(ss, 'V_充足確認');
  const headers = ['日付','unit_id','施設名','ユニット名','割当人数','充足状況','割当staff_id'];
  setHeader(sheet, headers, '#A32D2D');
  sheet.getRange('A1').setNote('このシートはGASが自動生成します。手動編集しないでください。');
  sheet.autoResizeColumns(1, headers.length);
}

// ============================================
// M_スタッフ プルダウン設定
// ============================================
function setupStaffDropdowns() {
  const ss         = SpreadsheetApp.openById(STAFF_SS_ID);
  const staffSheet = ss.getSheetByName('M_スタッフ');
  const unitSheet  = ss.getSheetByName('M_ユニット');

  // 全バリデーションクリア
  staffSheet.getRange('A2:P1000').clearDataValidations();

  // 施設名リスト
  const unitData = unitSheet.getDataRange().getValues();
  const facSet   = new Set();
  for (let i = 1; i < unitData.length; i++) {
    if (unitData[i][3]) facSet.add(unitData[i][3]);
  }
  const facList = [...facSet].sort();

  // H：スタッフ区分
  staffSheet.getRange('H2:H1000').setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList(['新人1ヶ月','新人2ヶ月','通常'], true)
      .setAllowInvalid(false).build());

  // I：メイン施設名（ドロップダウン・必須）
  staffSheet.getRange('I2:I1000').setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList(facList, true)
      .setAllowInvalid(false).build());

  // J：サブ施設候補（バリデーションなし・自由入力）
  // カンマ区切りで複数施設を入力 例: ルーデンス新板橋Ⅱ,リフレ要町,EST東長崎
  staffSheet.getRange('J2:J1000').clearDataValidations();
  // ヒントをセルノートで表示
  staffSheet.getRange('J1').setNote('カンマ区切りで複数施設を入力\n例: ルーデンス新板橋Ⅱ,リフレ要町,EST東長崎');

  // K：シフト区分
  staffSheet.getRange('K2:K1000').setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList(['夜勤のみ','日勤のみ','両方'], true)
      .setAllowInvalid(false).build());

  // L：許可シフト種別（プリセット＋手入力可）
  const shiftList = [
    '夜勤A,夜勤B,夜勤C',
    '日勤早出,日勤遅出',
    '夜勤A,夜勤B,夜勤C,日勤早出,日勤遅出',
    '夜勤A','夜勤B','夜勤C',
    '夜勤A,夜勤B','夜勤A,夜勤C','夜勤B,夜勤C',
    '日勤早出','日勤遅出',
  ];
  staffSheet.getRange('L2:L1000').setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList(shiftList, true)
      .setAllowInvalid(true).build());

  // M：保護フラグ
  staffSheet.getRange('M2:M1000').setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList(['TRUE','FALSE'], true)
      .setAllowInvalid(false).build());

  // N：退職フラグ
  staffSheet.getRange('N2:N1000').setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList(['TRUE','FALSE'], true)
      .setAllowInvalid(false).build());

  Logger.log('✅ プルダウン設定完了');
  Logger.log('I:メイン(ドロップダウン) J:サブ施設候補(自由入力・カンマ区切り) K:シフト区分 L:許可シフト種別 M:保護 N:退職');
}