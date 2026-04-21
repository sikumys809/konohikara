// ============================================
// 日勤対応 マスタ整備スクリプト (一度だけ実行)
// 2026-04-20
// ============================================
// このファイルを GAS に追加 → setupDayShiftMasters() を実行するだけでOK
// 
// 実行内容:
// 1. M_スタッフ に T列「主職種」カラム追加 (既存全員に「世話人」を自動投入)
// 2. M_事業所配置基準 シート新設 (5事業所の基準データを投入)
// ============================================


function setupDayShiftMasters() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  
  Logger.log('========== 日勤対応マスタ整備 開始 ==========');
  
  const result1 = _addMainRoleColumnToStaff(ss);
  Logger.log('① 主職種カラム追加: ' + JSON.stringify(result1));
  
  const result2 = _createFacilityBaseSheet(ss);
  Logger.log('② 事業所配置基準シート作成: ' + JSON.stringify(result2));
  
  Logger.log('========== 完了 ==========');
  
  return {
    success: true,
    staffColumnAdded: result1,
    facilityBaseCreated: result2,
  };
}


// ============================================
// ① M_スタッフ に「主職種」カラム追加
// ============================================

function _addMainRoleColumnToStaff(ss) {
  const sheet = ss.getSheetByName('M_スタッフ');
  if (!sheet) throw new Error('M_スタッフシートが見つかりません');
  
  const lastCol = sheet.getLastColumn();
  const lastRow = sheet.getLastRow();
  
  // T列 (20列目) のヘッダー確認
  const TARGET_COL = 20; // T列
  let alreadyExists = false;
  
  if (lastCol >= TARGET_COL) {
    const header = sheet.getRange(1, TARGET_COL).getValue();
    if (String(header).trim() === '主職種') {
      alreadyExists = true;
      Logger.log('主職種カラムは既に存在します');
    }
  }
  
  if (!alreadyExists) {
    // T列ヘッダー追加
    sheet.getRange(1, TARGET_COL).setValue('主職種');
    sheet.getRange(1, TARGET_COL).setFontWeight('bold').setBackground('#4a148c').setFontColor('#ffffff');
    sheet.setColumnWidth(TARGET_COL, 180);
    
    // 既存スタッフ全員にデフォルト「世話人」を投入
    if (lastRow > 1) {
      const values = [];
      for (let i = 0; i < lastRow - 1; i++) {
        values.push(['世話人']);
      }
      sheet.getRange(2, TARGET_COL, lastRow - 1, 1).setValues(values);
    }
    
    Logger.log('主職種カラム追加完了: ' + (lastRow - 1) + '名に「世話人」を設定');
  }
  
  // データ検証を意図的に設定しない (複数選択・自由記述対応)
  // ※ コメント: プルダウンにすると「サビ管,世話人」のような兼務記述ができなくなるため
  
  // T列の備考セル (1行目・Note) にヘルプ追加
  const note = '主職種 (カンマ区切り複数可)\n' +
    '選択値: 管理者 / サビ管 / 世話人 / 生活支援員 / 看護師\n\n' +
    '例: サビ管,世話人 (兼務の場合)\n' +
    '例: 管理者,世話人 (管理者兼世話人)\n\n' +
    '※ サビ管×世話人と サビ管×生活支援員 は同時刻兼務不可\n' +
    '※ 管理者×サビ管 や 看護師×世話人 は兼務可';
  sheet.getRange(1, TARGET_COL).setNote(note);
  
  return {
    success: true,
    alreadyExists: alreadyExists,
    targetCol: TARGET_COL,
    rowsUpdated: alreadyExists ? 0 : (lastRow - 1),
  };
}


// ============================================
// ② M_事業所配置基準 シート作成
// ============================================

function _createFacilityBaseSheet(ss) {
  const sheetName = 'M_事業所配置基準';
  let sheet = ss.getSheetByName(sheetName);
  let alreadyExists = false;
  
  if (sheet) {
    alreadyExists = true;
    Logger.log('既存シートを上書きします');
    sheet.clear();
  } else {
    sheet = ss.insertSheet(sheetName);
  }
  
  // ヘッダー設定
  const headers = [
    'facility_id',       // A
    '事業所名',          // B
    '定員',              // C
    '管理者氏名',        // D (手動入力必要)
    '世話人人数',        // E (常勤換算)
    '生活支援員人数',    // F
    '特定加配人数',      // G
    'サビ管必要人数',    // H (定員÷30, 自動)
    '看護師必要人数',    // I (定員÷20切上, 自動)
    '備考',              // J
  ];
  
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold')
    .setBackground('#4a148c')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center');
  sheet.setFrozenRows(1);
  
  // 5事業所データ
  // ユーザーから提供済みのデータ (2026-04-20 時点)
  const facilityData = [
    {
      id: 'F001',
      name: 'GHコノヒカラ',
      capacity: 30,
      worker: 4.6,
      support: 1.4,
      extra: 8.3,
      manager: '水野恵子',
    },
    {
      id: 'F002',
      name: 'GHコノヒカラ品川',
      capacity: 23,
      worker: 3.3,
      support: 0.4,
      extra: 5.3,
      manager: '季武',
    },
    {
      id: 'F003',
      name: 'GHコノヒカラ練馬',
      capacity: 10,
      worker: 1.2,
      support: 0.2,
      extra: 2.0,
      manager: '水野智貴',
    },
    {
      id: 'F004',
      name: 'GHコノヒカラ板橋北区',
      capacity: 30,
      worker: 4.1,
      support: 0.9,
      extra: 7.0,
      manager: '大内',
    },
    {
      id: 'F005',
      name: 'GHコノヒカラ板橋北区セカンド',
      capacity: 25,
      worker: 3.8,
      support: 0.6,
      extra: 6.3,
      manager: '伊藤',
    },
  ];
  
  const rows = facilityData.map(f => {
    const sabikanNeeded = Math.round((f.capacity / 30) * 100) / 100; // 小数2桁
    const nurseNeeded = Math.ceil(f.capacity / 20); // 切り上げ
    return [
      f.id,
      f.name,
      f.capacity,
      f.manager,  // 暫定。正確なフルネーム設定はユーザーが実施
      f.worker,
      f.support,
      f.extra,
      sabikanNeeded,
      nurseNeeded,
      '',
    ];
  });
  
  sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  
  // 列幅調整
  sheet.setColumnWidth(1, 90);   // facility_id
  sheet.setColumnWidth(2, 220);  // 事業所名
  sheet.setColumnWidth(3, 60);   // 定員
  sheet.setColumnWidth(4, 150);  // 管理者氏名
  sheet.setColumnWidth(5, 100);  // 世話人人数
  sheet.setColumnWidth(6, 120);  // 生活支援員人数
  sheet.setColumnWidth(7, 110);  // 特定加配人数
  sheet.setColumnWidth(8, 120);  // サビ管必要人数
  sheet.setColumnWidth(9, 120);  // 看護師必要人数
  sheet.setColumnWidth(10, 250); // 備考
  
  // 数値セルの書式
  sheet.getRange(2, 3, rows.length, 1).setNumberFormat('0');         // 定員
  sheet.getRange(2, 5, rows.length, 3).setNumberFormat('0.0');       // 世話人/生活支援員/特定加配
  sheet.getRange(2, 8, rows.length, 1).setNumberFormat('0.00');      // サビ管
  sheet.getRange(2, 9, rows.length, 1).setNumberFormat('0');         // 看護師
  
  // ヘッダーにノート追加 (ヘルプ)
  sheet.getRange(1, 4).setNote(
    '管理者氏名\n' +
    '各事業所の常勤管理者1名を記載。\n' +
    'M_スタッフに登録されている人のフルネーム (例: 水野 恵子) を\n' +
    '正確に入れてください。スペース有無も合わせて。'
  );
  sheet.getRange(1, 5).setNote('世話人 常勤換算人数 (利用者÷6)');
  sheet.getRange(1, 6).setNote(
    '生活支援員 常勤換算人数\n' +
    '区分別: 区分3÷9 + 区分4÷6 + 区分5÷4 + 区分6÷2.5 の合計'
  );
  sheet.getRange(1, 7).setNote(
    '特定従業者数換算の加配人数\n' +
    '介護サービス包括型 12:1加算 = 前年度利用者数 × 5/60'
  );
  sheet.getRange(1, 8).setNote(
    'サビ管必要人数 (定員÷30)\n' +
    '計算: 定員 ÷ 30 (小数2桁)\n' +
    '月間必要時間 = この値 × 月の週数 × 40h'
  );
  sheet.getRange(1, 9).setNote(
    '看護師必要人数 (医療連携加算Ⅶ)\n' +
    '計算: 定員 ÷ 20 (切上)\n' +
    '看護師1名が20名まで担当可 (月1回日勤)\n' +
    '他事業所 +10名まで兼務可'
  );
  
  return {
    success: true,
    alreadyExists: alreadyExists,
    rowsInserted: rows.length,
  };
}


// ============================================
// 確認・デバッグ用
// ============================================

function debugDayShiftMasters() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  
  // M_スタッフ T列状態確認
  const staffSheet = ss.getSheetByName('M_スタッフ');
  const lastCol = staffSheet.getLastColumn();
  const lastRow = staffSheet.getLastRow();
  
  Logger.log('=== M_スタッフ ===');
  Logger.log('最終列: ' + lastCol + ' (T列=20)');
  Logger.log('最終行: ' + lastRow);
  if (lastCol >= 20) {
    Logger.log('T1ヘッダー: ' + staffSheet.getRange(1, 20).getValue());
    
    // 主職種分布
    const data = staffSheet.getRange(2, 20, lastRow - 1, 1).getValues();
    const dist = {};
    for (const row of data) {
      const val = String(row[0] || '').trim() || '(空欄)';
      dist[val] = (dist[val] || 0) + 1;
    }
    Logger.log('主職種分布: ' + JSON.stringify(dist));
  }
  
  // M_事業所配置基準
  const baseSheet = ss.getSheetByName('M_事業所配置基準');
  if (baseSheet) {
    const data = baseSheet.getDataRange().getValues();
    Logger.log('=== M_事業所配置基準 ===');
    Logger.log('行数: ' + data.length);
    for (let i = 1; i < data.length; i++) {
      Logger.log(JSON.stringify(data[i]));
    }
  } else {
    Logger.log('M_事業所配置基準シートが存在しません');
  }
}


// ============================================
// (補助) 資格欄に「看護師」を含むスタッフをリストアップ
// ユーザーが主職種に「看護師」タグを付ける時に参考にする
// ============================================

function listNurseCandidates() {
  const ss = SpreadsheetApp.openById(STAFF_SS_ID);
  const sheet = ss.getSheetByName('M_スタッフ');
  const data = sheet.getDataRange().getValues();
  
  const candidates = [];
  for (let i = 1; i < data.length; i++) {
    const qualification = String(data[i][5] || ''); // F列 国家資格
    const retired = String(data[i][16] || '').toUpperCase() === 'TRUE'; // Q列 退職
    if (retired) continue;
    if (qualification.includes('看護師')) {
      candidates.push({
        row: i + 1,
        staff_id: data[i][0],
        name: data[i][1],
        qualification: qualification,
        currentMainRole: data[i][19] || '(空欄)', // T列
      });
    }
  }
  
  Logger.log('=== 看護師資格保有者: ' + candidates.length + '名 ===');
  for (const c of candidates) {
    Logger.log(`行${c.row}: ID=${c.staff_id} / ${c.name} / 資格=${c.qualification} / 主職種=${c.currentMainRole}`);
  }
  
  return candidates;
}
function fixDayShiftSetup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logs = [];
  
  // ===== 1. M_スタッフ T列の validation を消して主職種を入れ直す =====
  const staffSheet = ss.getSheetByName('M_スタッフ');
  if (!staffSheet) throw new Error('M_スタッフが見つからない');
  
  const lastRow = staffSheet.getLastRow();
  const tCol = 20; // T列
  
  // ヘッダー含めて validation 全消し
  staffSheet.getRange(1, tCol, lastRow, 1).setDataValidation(null);
  logs.push('M_スタッフ T列 validation 削除');
  
  // ヘッダー設定
  staffSheet.getRange(1, tCol).setValue('主職種');
  
  // 全員「世話人」で初期化（退職者含む。不要なら後で手動削除でOK）
  if (lastRow > 1) {
    const values = [];
    for (let i = 0; i < lastRow - 1; i++) {
      values.push(['世話人']);
    }
    staffSheet.getRange(2, tCol, lastRow - 1, 1).setValues(values);
    logs.push(`主職種「世話人」を ${lastRow - 1} 名に設定`);
  }
  
  // ===== 2. M_事業所配置基準 を強制再作成 =====
  let fs = ss.getSheetByName('M_事業所配置基準');
  if (fs) {
    ss.deleteSheet(fs);
    logs.push('既存 M_事業所配置基準 削除');
  }
  fs = ss.insertSheet('M_事業所配置基準');
  
  const headers = [
    '事業所名', '定員', '世話人常勤換算', '生活支援員常勤換算',
    '特定加配', 'サビ管必要', '看護師必要', '管理者氏名'
  ];
  fs.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#f0f0f0');
  
  const data = [
    ['GHコノヒカラ',           30, 4.6, 1.4, 8.3, 1.00, 2, '水野恵子'],
    ['GHコノヒカラ品川',       23, 3.3, 0.4, 5.3, 0.77, 2, '季武'],
    ['GHコノヒカラ練馬',       10, 1.2, 0.2, 2.0, 0.33, 1, '水野智貴'],
    ['GHコノヒカラ板橋北区',   30, 4.1, 0.9, 7.0, 1.00, 2, '大内'],
    ['GHコノヒカラ板橋北区セカンド', 25, 3.8, 0.6, 6.3, 0.83, 2, '伊藤']
  ];
  fs.getRange(2, 1, data.length, data[0].length).setValues(data);
  fs.autoResizeColumns(1, headers.length);
  fs.setFrozenRows(1);
  logs.push('M_事業所配置基準 再作成完了（5事業所）');
  
  Logger.log(logs.join('\n'));
  return logs;
}
function assignMainRoles() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('M_スタッフ');
  if (!sheet) throw new Error('M_スタッフが見つからない');
  
  const lastRow = sheet.getLastRow();
  const nameCol = 2;   // B列: 氏名
  const roleCol = 20;  // T列: 主職種
  
  // === 主職種を割り当てる定義 ===
  // 氏名の完全一致または部分一致でマッチ
  const assignments = {
    '管理者': [
      '水野恵子',
      '季武 憲毅',
      '水野智貴',
      '大内 勇太',
      '伊藤聡一郎'
    ],
    'サビ管': [
      '中村',
      '田所',
      '上代あゆみ',
      '上代直人',
      '高橋竜太',
      '惣田',
      '河辺',
      '吉田剛'
    ],
    '看護師': [
      '末原 梨花',
      '中村 仁美',
      '木下 加悦',
      '萩原優紀',
      '村瀬奏絵',
      '松田優子',
      '鈴木桃子',
      '中山綾華',
      '小原有紗',
      '竹内樺織',
      '原 めぐみ',
      '石澤絵美',
      '宮原真希',
      '宮澤由美（看護師）',
      '木戸友美'
    ]
  };
  
  // 全データ取得
  const data = sheet.getRange(2, 1, lastRow - 1, roleCol).getValues();
  const results = [];
  const notFound = [];
  
  // 氏名ごとに付与する役割セットを集計
  const roleMap = {}; // 氏名 -> Set of 職種
  
  Object.keys(assignments).forEach(role => {
    assignments[role].forEach(targetName => {
      let hit = false;
      data.forEach((row, idx) => {
        const fullName = String(row[nameCol - 1] || '').trim();
        const normalized = fullName.replace(/\s+/g, ''); // スペース除去
        const targetNormalized = targetName.replace(/\s+/g, '');
        
        if (normalized === targetNormalized || normalized.includes(targetNormalized)) {
          if (!roleMap[fullName]) roleMap[fullName] = { row: idx + 2, roles: new Set() };
          // 元からある「世話人」もキープしたい場合は追加
          const existing = String(row[roleCol - 1] || '').split(',').map(s => s.trim()).filter(Boolean);
          existing.forEach(r => roleMap[fullName].roles.add(r));
          roleMap[fullName].roles.add(role);
          hit = true;
        }
      });
      if (!hit) notFound.push(`[${role}] ${targetName}`);
    });
  });
  
  // 書き込み
  Object.keys(roleMap).forEach(name => {
    const info = roleMap[name];
    const roleString = Array.from(info.roles).join(',');
    sheet.getRange(info.row, roleCol).setValue(roleString);
    results.push(`行${info.row}: ${name} -> ${roleString}`);
  });
  
  Logger.log('=== 割当結果 ===');
  Logger.log(results.join('\n'));
  if (notFound.length > 0) {
    Logger.log('\n=== 未マッチ（要確認） ===');
    Logger.log(notFound.join('\n'));
  }
  Logger.log(`\n合計 ${results.length}名に主職種割当完了`);
  
  return { assigned: results.length, notFound: notFound };
}
function fixMainRoles() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('M_スタッフ');
  const lastRow = sheet.getLastRow();
  const nameCol = 2;
  const roleCol = 20;
  
  const data = sheet.getRange(2, 1, lastRow - 1, roleCol).getValues();
  const logs = [];
  
  // ===== ① 中村誤爆6名から「サビ管」除去 =====
  const wrongSabikan = [
    '中村優太', '中村拓人', '中村香乃美', '中村風音',
    '中村賢太（柚井紹介学生）', '中村虹太（柚井紹介）', '中村明日香'
  ];
  
  wrongSabikan.forEach(targetName => {
    data.forEach((row, idx) => {
      const fullName = String(row[nameCol - 1] || '').trim();
      if (fullName === targetName) {
        const roles = String(row[roleCol - 1] || '').split(',').map(s => s.trim()).filter(Boolean);
        const filtered = roles.filter(r => r !== 'サビ管');
        const newValue = filtered.join(',');
        sheet.getRange(idx + 2, roleCol).setValue(newValue);
        logs.push(`行${idx + 2}: ${fullName} -> ${newValue} (サビ管除去)`);
      }
    });
  });
  
  // ===== ② 水野 惠子 に「管理者」追加 =====
  const mizunoRow = data.findIndex(row => {
    const name = String(row[nameCol - 1] || '').replace(/\s+/g, '');
    return name === '水野惠子';
  });
  if (mizunoRow >= 0) {
    const current = String(data[mizunoRow][roleCol - 1] || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!current.includes('管理者')) current.push('管理者');
    const newValue = current.join(',');
    sheet.getRange(mizunoRow + 2, roleCol).setValue(newValue);
    logs.push(`行${mizunoRow + 2}: 水野 惠子 -> ${newValue}`);
  } else {
    logs.push('⚠ 水野 惠子 が見つからない');
  }
  
  // ===== ③ 木下 加悦 に「サビ管」追加（田所の後継） =====
  const kinoshitaRow = data.findIndex(row => {
    const name = String(row[nameCol - 1] || '').replace(/\s+/g, '');
    return name === '木下加悦';
  });
  if (kinoshitaRow >= 0) {
    const current = String(data[kinoshitaRow][roleCol - 1] || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!current.includes('サビ管')) current.push('サビ管');
    const newValue = current.join(',');
    sheet.getRange(kinoshitaRow + 2, roleCol).setValue(newValue);
    logs.push(`行${kinoshitaRow + 2}: 木下 加悦 -> ${newValue}`);
  } else {
    logs.push('⚠ 木下 加悦 が見つからない');
  }
  
  Logger.log('=== 修正結果 ===');
  Logger.log(logs.join('\n'));
  return logs;
}
function checkShiftConfirmedStatus() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('T_シフト確定');
  if (!sheet) {
    Logger.log('T_シフト確定が存在しない');
    return;
  }
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  Logger.log(`行数: ${lastRow} / 列数: ${lastCol}`);
  
  // ヘッダー
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  Logger.log(`ヘッダー: ${headers.join(' | ')}`);
  
  // 先頭3行のサンプル
  if (lastRow > 1) {
    const sample = sheet.getRange(2, 1, Math.min(3, lastRow - 1), lastCol).getValues();
    sample.forEach((row, i) => {
      Logger.log(`サンプル${i + 1}: ${row.join(' | ')}`);
    });
  }
}
// ============================================================
// Step 2: シフト種別拡張
// ============================================================

/**
 * シフト定義マスタ（全システムで参照する中央定義）
 * パターン名 -> { start, end, nightHours, dayHours, breakMinutes }
 */
const SHIFT_PATTERNS = {
  '夜勤A':   { start: '20:00', end: '05:00', nightHours: 6, dayHours: 0, breakMinutes: 60 },
  '夜勤B':   { start: '22:00', end: '07:00', nightHours: 6, dayHours: 2, breakMinutes: 60 },
  '夜勤C':   { start: '22:00', end: '08:00', nightHours: 6, dayHours: 2, breakMinutes: 120 },
  '早出8h':  { start: '06:00', end: '15:00', nightHours: 0, dayHours: 8, breakMinutes: 60 },
  '早出4h':  { start: '06:00', end: '10:00', nightHours: 0, dayHours: 4, breakMinutes: 0 },
  '遅出8h':  { start: '13:00', end: '22:00', nightHours: 0, dayHours: 8, breakMinutes: 60 },
  '遅出4h':  { start: '13:00', end: '17:00', nightHours: 0, dayHours: 4, breakMinutes: 0 }
};

/**
 * 時刻値（Date型 or "HH:mm"文字列）を "HH:mm" 文字列に正規化
 */
function _normalizeTime(value) {
  if (!value) return null;
  if (value instanceof Date) {
    const h = String(value.getHours()).padStart(2, '0');
    const m = String(value.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }
  const s = String(value).trim();
  // "HH:mm" または "H:mm" 形式を想定
  const match = s.match(/^(\d{1,2}):(\d{2})/);
  if (match) return `${match[1].padStart(2, '0')}:${match[2]}`;
  return null;
}

/**
 * "HH:mm" を分数に変換（夜勤の日跨ぎは呼び出し側で +24h 調整）
 */
function _timeToMinutes(timeStr) {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

/**
 * シフトの配置換算時間を計算
 * @param {string} shiftType - "夜勤A", "早出8h" など
 * @param {Date|string} actualStart - 実開始時刻（nullの場合パターン標準を使用）
 * @param {Date|string} actualEnd   - 実終了時刻
 * @return {Object} { nightHours, dayHours, totalHours, actualStart, actualEnd, note }
 */
function calcShiftHours(shiftType, actualStart, actualEnd) {
  const pattern = SHIFT_PATTERNS[shiftType];
  if (!pattern) {
    return { nightHours: 0, dayHours: 0, totalHours: 0, actualStart: null, actualEnd: null, note: `未定義シフト: ${shiftType}` };
  }
  
  // 実時刻が未指定ならパターン標準値を使う
  const startStr = _normalizeTime(actualStart) || pattern.start;
  const endStr   = _normalizeTime(actualEnd)   || pattern.end;
  
  // 実時刻がパターンと一致すれば、定義済みの換算値をそのまま返す（高速パス）
  const isStandard = (startStr === pattern.start && endStr === pattern.end);
  if (isStandard) {
    return {
      nightHours: pattern.nightHours,
      dayHours: pattern.dayHours,
      totalHours: Math.min(pattern.nightHours + pattern.dayHours, 8),
      actualStart: startStr,
      actualEnd: endStr,
      note: 'standard'
    };
  }
  
  // 実時刻がパターンと違う場合: 時間帯ベースで再計算
  const result = _calcHoursByBands(startStr, endStr, pattern.breakMinutes);
  result.actualStart = startStr;
  result.actualEnd = endStr;
  result.note = 'custom';
  return result;
}

/**
 * 時間帯別換算: 夜間帯(22:00-翌05:00) = 夜勤、昼間帯(05:00-22:00) = 日勤
 * 休憩は夜間帯から優先控除
 */
function _calcHoursByBands(startStr, endStr, breakMinutes) {
  const startMin = _timeToMinutes(startStr);
  let endMin = _timeToMinutes(endStr);
  // 日跨ぎ判定: 開始 >= 終了 なら翌日扱い
  if (endMin <= startMin) endMin += 24 * 60;
  
  let nightMin = 0;
  let dayMin = 0;
  
  // 1分刻みで帯判定するのは重いので、開始から終了まで走査して帯ごとに集計
  for (let t = startMin; t < endMin; t++) {
    const hourOfDay = Math.floor(t / 60) % 24;
    // 夜間帯: 22:00-23:59 または 00:00-04:59
    if (hourOfDay >= 22 || hourOfDay < 5) {
      nightMin++;
    } else {
      dayMin++;
    }
  }
  
  // 休憩控除（夜間優先）
  let remainingBreak = breakMinutes;
  const nightBreak = Math.min(remainingBreak, nightMin);
  nightMin -= nightBreak;
  remainingBreak -= nightBreak;
  if (remainingBreak > 0) {
    dayMin -= Math.min(remainingBreak, dayMin);
  }
  
  // 1日8h上限
  let nightHours = Math.round((nightMin / 60) * 100) / 100;
  let dayHours = Math.round((dayMin / 60) * 100) / 100;
  let totalHours = nightHours + dayHours;
  if (totalHours > 8) {
    const ratio = 8 / totalHours;
    nightHours = Math.round(nightHours * ratio * 100) / 100;
    dayHours = Math.round(dayHours * ratio * 100) / 100;
    totalHours = 8;
  }
  
  return { nightHours, dayHours, totalHours };
}

/**
 * T_シフト確定に4列追加 + 既存データマイグレーション
 */
function expandShiftConfirmedColumns() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('T_シフト確定');
  if (!sheet) throw new Error('T_シフト確定が見つからない');
  
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  const logs = [];
  
  // 既存ヘッダー確認
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const newCols = ['実開始時刻', '実終了時刻', '夜勤換算時間', '日勤換算時間'];
  
  // 既に追加済みかチェック
  const alreadyAdded = newCols.every(c => headers.includes(c));
  if (alreadyAdded) {
    logs.push('4列は既に追加済み → マイグレーションのみ実行');
  } else {
    // 末尾に4列追加
    const startCol = lastCol + 1;
    sheet.getRange(1, startCol, 1, 4).setValues([newCols])
      .setFontWeight('bold').setBackground('#f0f0f0');
    logs.push(`列 ${startCol}〜${startCol + 3} に4カラム追加`);
  }
  
  // マイグレーション: 既存全行の換算時間を計算して埋める
  if (lastRow > 1) {
    // カラム番号再取得
    const newHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const colIdx = {
      shiftType:    newHeaders.indexOf('シフト種別') + 1,
      start:        newHeaders.indexOf('開始時刻') + 1,
      end:          newHeaders.indexOf('終了時刻') + 1,
      actualStart:  newHeaders.indexOf('実開始時刻') + 1,
      actualEnd:    newHeaders.indexOf('実終了時刻') + 1,
      nightHours:   newHeaders.indexOf('夜勤換算時間') + 1,
      dayHours:     newHeaders.indexOf('日勤換算時間') + 1
    };
    
    // 既存データ一括取得
    const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    const updates = [];  // [実開始, 実終了, 夜勤h, 日勤h]
    
    data.forEach(row => {
      const shiftType = String(row[colIdx.shiftType - 1] || '').trim();
      const startVal = row[colIdx.start - 1];
      const endVal = row[colIdx.end - 1];
      
      const result = calcShiftHours(shiftType, startVal, endVal);
      updates.push([result.actualStart, result.actualEnd, result.nightHours, result.dayHours]);
    });
    
    // 一括書込（実開始〜日勤換算は連続4列と仮定）
    const writeStartCol = colIdx.actualStart;
    sheet.getRange(2, writeStartCol, updates.length, 4).setValues(updates);
    logs.push(`${updates.length}件のマイグレーション完了`);
  }
  
  Logger.log(logs.join('\n'));
  return logs;
}

/**
 * calcShiftHours の単体テスト
 */
function testCalcShiftHours() {
  const cases = [
    ['夜勤A', null, null],
    ['夜勤B', null, null],
    ['夜勤C', null, null],
    ['早出8h', null, null],
    ['早出4h', null, null],
    ['遅出8h', null, null],
    ['遅出4h', null, null],
    ['夜勤B', '22:00', '07:00'],
    ['夜勤C', '21:00', '08:00'],  // カスタム: 1h早入り
    ['早出8h', '07:00', '15:00'], // カスタム: 1h遅入り
  ];
  
  Logger.log('=== calcShiftHours テスト ===');
  cases.forEach(([type, s, e]) => {
    const r = calcShiftHours(type, s, e);
    Logger.log(`${type} (${s || '標準'} - ${e || '標準'}): 夜${r.nightHours}h / 日${r.dayHours}h / 合計${r.totalHours}h [${r.note}]`);
  });
}
// ============================================================
// Step 3: 繰り返し提出テンプレート
// ============================================================

/**
 * M_希望テンプレート シートを作成
 */
function createTemplateSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logs = [];
  
  let sheet = ss.getSheetByName('M_希望テンプレート');
  if (sheet) {
    logs.push('M_希望テンプレート は既に存在 → スキップ');
    Logger.log(logs.join('\n'));
    return logs;
  }
  
  sheet = ss.insertSheet('M_希望テンプレート');
  
  const headers = [
    'template_id',   // A
    'staff_id',      // B
    '氏名',          // C
    'テンプレート名', // D
    '曜日',          // E (カンマ区切り 1=月,2=火,...,7=日)
    'シフト種別',    // F
    'メイン施設',    // G
    'セカンド施設',  // H
    'サブ施設',      // I
    'コメント',      // J
    '作成日時',      // K
    '有効フラグ'     // L
  ];
  
  sheet.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold')
    .setBackground('#4a148c')
    .setFontColor('#ffffff');
  
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headers.length);
  
  logs.push(`M_希望テンプレート 作成完了（${headers.length}列）`);
  Logger.log(logs.join('\n'));
  return logs;
}

/**
 * 次のテンプレートIDを採番
 */
function _getNextTemplateId() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('M_希望テンプレート');
  if (!sheet) throw new Error('M_希望テンプレート が存在しない');
  
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 'TPL_0001';
  
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues()
    .map(r => String(r[0] || ''))
    .filter(s => s.startsWith('TPL_'))
    .map(s => parseInt(s.replace('TPL_', ''), 10))
    .filter(n => !isNaN(n));
  
  const maxId = ids.length ? Math.max(...ids) : 0;
  return `TPL_${String(maxId + 1).padStart(4, '0')}`;
}
function listUebashiStaff() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('M_スタッフ');
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 20).getValues();
  
  Logger.log('=== ルーデンス上板橋E-st 関連スタッフ（在籍のみ） ===');
  let cnt = 0;
  data.forEach((row, idx) => {
    const retired = String(row[16] || '').toUpperCase() === 'TRUE';
    if (retired) return;
    
    const mainFac = String(row[9] || '').trim();
    const secondFac = String(row[10] || '').trim();
    const subFacs = String(row[11] || '').trim();
    
    const hit = [mainFac, secondFac, subFacs].some(f => 
      f.indexOf('上板橋') !== -1 || f.indexOf('E-st') !== -1 || f.indexOf('Ｅ-st') !== -1
    );
    
    if (hit) {
      cnt++;
      const pos = [];
      if (mainFac.indexOf('上板橋') !== -1 || mainFac.indexOf('E-st') !== -1) pos.push('メイン');
      if (secondFac.indexOf('上板橋') !== -1 || secondFac.indexOf('E-st') !== -1) pos.push('セカンド');
      if (subFacs.indexOf('上板橋') !== -1 || subFacs.indexOf('E-st') !== -1) pos.push('サブ');
      Logger.log(`行${idx + 2}: ID=${row[0]} / ${row[1]} / [${pos.join(',')}]`);
    }
  });
  Logger.log(`\n合計: ${cnt}名`);
}
function checkFacilitySheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets();
  Logger.log('=== 全シート名 ===');
  sheets.forEach(s => {
    const name = s.getName();
    const rows = s.getLastRow();
    const cols = s.getLastColumn();
    Logger.log(`  ${name} (${rows}行 × ${cols}列)`);
  });
  
  const candidates = ['M_施設', 'M_ユニット', '施設情報', 'ユニット情報', 'M_ユニット情報'];
  Logger.log('\n=== 施設マスタ候補の中身 ===');
  candidates.forEach(name => {
    const sh = ss.getSheetByName(name);
    if (!sh) return;
    const lastCol = sh.getLastColumn();
    const header = sh.getRange(1, 1, 1, lastCol).getValues()[0];
    Logger.log(`\n【${name}】ヘッダー:`);
    header.forEach((h, i) => Logger.log(`  ${String.fromCharCode(65+i)}: ${h}`));
  });
}
function checkUnitSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('M_ユニット');
  const last = sh.getLastRow();
  const data = sh.getRange(2, 1, last - 1, 6).getValues();
  
  Logger.log('=== M_ユニット 全データ ===');
  data.forEach(row => {
    Logger.log(`unit_id=${row[0]} / 事業所=${row[1]} / ユニット=${row[2]} / 施設=${row[3]} / 定員=${row[4]} / 部屋=${row[5]}`);
  });
  
  // 施設名 → 事業所名のマッピング抽出
  const mapping = {};
  data.forEach(row => {
    const fac = String(row[3] || '').trim();
    const jig = String(row[1] || '').trim();
    if (!fac) return;
    if (!mapping[fac]) mapping[fac] = new Set();
    mapping[fac].add(jig);
  });
  
  Logger.log('\n=== 施設名 → 事業所名マッピング ===');
  Object.keys(mapping).sort().forEach(fac => {
    const jigs = Array.from(mapping[fac]);
    const marker = jigs.length > 1 ? '⚠️' : '✅';
    Logger.log(`${marker} ${fac} -> ${jigs.join(', ')}`);
  });
  
  // スタッフ側との整合性チェック
  Logger.log('\n=== M_スタッフ J/K/L 列に入ってる施設名 vs M_ユニットの施設名 ===');
  const staffSh = ss.getSheetByName('M_スタッフ');
  const sData = staffSh.getRange(2, 1, staffSh.getLastRow() - 1, 17).getValues();
  const staffFacs = new Set();
  sData.forEach(row => {
    const retired = String(row[16] || '').toUpperCase() === 'TRUE';
    if (retired) return;
    [row[9], row[10]].forEach(v => {
      const s = String(v || '').trim();
      if (s) staffFacs.add(s);
    });
    String(row[11] || '').split(',').map(x => x.trim()).filter(Boolean).forEach(s => staffFacs.add(s));
  });
  
  const unitFacs = new Set(Object.keys(mapping));
  Array.from(staffFacs).sort().forEach(f => {
    const inUnit = unitFacs.has(f);
    Logger.log(`  ${inUnit ? '✅' : '❌'} "${f}" (M_ユニットに${inUnit ? 'あり' : '無し'})`);
  });
}
function alignUebashiInUnit() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('M_ユニット');
  if (!sheet) throw new Error('M_ユニットが見つからない');
  
  const last = sheet.getLastRow();
  const data = sheet.getRange(2, 1, last - 1, 6).getValues();
  const logs = [];
  
  data.forEach((row, idx) => {
    const unitId = String(row[0] || '').trim();
    const jigyosho = String(row[1] || '').trim();
    const fac = String(row[3] || '').trim();
    
    // 上板橋E-st の場合のみ処理
    if (fac !== 'ルーデンス上板橋E-st' && fac !== 'ルーデンス上板橋Ｅ-st') return;
    
    let newName;
    if (jigyosho === 'GHコノヒカラ板橋北区') {
      newName = 'ルーデンス上板橋E-st（板橋北区）';
    } else if (jigyosho === 'GHコノヒカラ板橋北区セカンド') {
      newName = 'ルーデンス上板橋E-st（セカンド）';
    } else {
      logs.push(`⚠ ${unitId}: 事業所が想定外 "${jigyosho}" → スキップ`);
      return;
    }
    
    // validation 削除してから書込
    sheet.getRange(idx + 2, 4).setDataValidation(null);
    sheet.getRange(idx + 2, 4).setValue(newName);
    logs.push(`${unitId}: "${fac}" → "${newName}"`);
  });
  
  Logger.log('=== M_ユニット 分割結果 ===');
  logs.forEach(l => Logger.log(l));
  return logs;
}