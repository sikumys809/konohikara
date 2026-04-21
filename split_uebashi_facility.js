// ============================================================
// ルーデンス上板橋E-st の分割処理（バグ修正版）
// - 無限ループ防止: split+join で完全置換
// - 既に「（板橋北区）」「（セカンド）」が付いてる場合はスキップ
// ============================================================

function splitUebashiFacility() {
  Logger.log('========== ルーデンス上板橋E-st 分割処理 開始 ==========');
  const logs = [];

  const variants = [
    'ルーデンス上板橋E-st',
    'ルーデンス上板橋Ｅ-st',
    'ルーデンス上板橋E-ST',
    'ルーデンス上板橋Ｅ-ST',
    'ルーデンス上板橋e-st'
  ];
  const NEW_KITA = 'ルーデンス上板橋E-st（板橋北区）';
  const NEW_SECOND = 'ルーデンス上板橋E-st（セカンド）';
  const SECOND_STAFF_IDS = ['168']; // 伊藤聡一郎

  logs.push(_replaceStaffFacilities(variants, NEW_KITA, NEW_SECOND, SECOND_STAFF_IDS));
  logs.push(_replaceRequestFacilities(variants, NEW_KITA, NEW_SECOND, SECOND_STAFF_IDS));
  logs.push(_replaceConfirmedFacilities(variants, NEW_KITA, NEW_SECOND, SECOND_STAFF_IDS));

  Logger.log('\n========== 完了 ==========');
  Logger.log(logs.join('\n'));
  return logs;
}

/**
 * 置換ロジック（無限ループ防止版）
 * - 既に「（」で始まるサフィックスが付いてれば変換しない
 * - split/join で一度に置換
 */
function _safeReplace(str, variants, newName) {
  if (!str) return { value: str, changed: false };
  let s = String(str);
  let changed = false;

  variants.forEach(v => {
    // 既に「v（板橋北区）」や「v（セカンド）」など、サフィックス付きになってる部分は保護
    // 保護用のプレースホルダーに一時置換
    const PROTECT = '___PROTECTED_UEBASHI___';
    
    // 「v（」という並びを全部保護（v の直後に（）
    while (true) {
      const idx = s.indexOf(v + '（');
      if (idx === -1) break;
      // 「（」の閉じ「）」を探す
      const closeIdx = s.indexOf('）', idx);
      if (closeIdx === -1) break;
      const toProtect = s.substring(idx, closeIdx + 1);
      s = s.substring(0, idx) + PROTECT + s.substring(closeIdx + 1);
      // プレースホルダーに実データを埋め込むわけにいかないので、単純に保護して後で戻す
      // → 戻すために置換ペアを記録
      if (!_safeReplace._protections) _safeReplace._protections = [];
      _safeReplace._protections.push(toProtect);
    }

    // 残ってる v を新名称に置換（split/join で一気に）
    if (s.indexOf(v) !== -1) {
      s = s.split(v).join(newName);
      changed = true;
    }
  });

  // プレースホルダーを元に戻す
  if (_safeReplace._protections && _safeReplace._protections.length > 0) {
    _safeReplace._protections.forEach(original => {
      s = s.replace('___PROTECTED_UEBASHI___', original);
    });
    _safeReplace._protections = [];
  }

  return { value: s, changed: changed };
}

function _containsUebashi(str, variants) {
  if (!str) return false;
  const s = String(str);
  return variants.some(v => s.indexOf(v) !== -1);
}

/**
 * 上板橋を含むか？ただし既にサフィックス付きのものは除外
 */
function _hasRawUebashi(str, variants) {
  if (!str) return false;
  let s = String(str);
  // サフィックス付きを先に取り除いてから判定
  variants.forEach(v => {
    const pat = v + '（';
    while (s.indexOf(pat) !== -1) {
      const idx = s.indexOf(pat);
      const closeIdx = s.indexOf('）', idx);
      if (closeIdx === -1) break;
      s = s.substring(0, idx) + s.substring(closeIdx + 1);
    }
  });
  return variants.some(v => s.indexOf(v) !== -1);
}

function _replaceStaffFacilities(variants, NEW_KITA, NEW_SECOND, SECOND_STAFF_IDS) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('M_スタッフ');
  const lastRow = sheet.getLastRow();

  sheet.getRange(1, 10, lastRow, 3).setDataValidation(null);

  const data = sheet.getRange(2, 1, lastRow - 1, 12).getValues();
  let changed = 0;

  const updates = data.map(row => {
    const staffId = String(row[0]).trim();
    const isSecond = SECOND_STAFF_IDS.indexOf(staffId) !== -1;
    const newName = isSecond ? NEW_SECOND : NEW_KITA;

    const main = String(row[9] || '');
    const second = String(row[10] || '');
    const subs = String(row[11] || '');

    const r1 = _safeReplace(main, variants, newName);
    const r2 = _safeReplace(second, variants, newName);
    const r3 = _safeReplace(subs, variants, newName);

    if (r1.changed) changed++;
    if (r2.changed) changed++;
    if (r3.changed) changed++;

    return [r1.value, r2.value, r3.value];
  });

  sheet.getRange(2, 10, updates.length, 3).setValues(updates);

  const msg = `M_スタッフ: ${changed}セル置換`;
  Logger.log(msg);
  return msg;
}

function _replaceRequestFacilities(variants, NEW_KITA, NEW_SECOND, SECOND_STAFF_IDS) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('T_希望提出');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 'T_希望提出 は空 → スキップ';

  const data = sheet.getRange(2, 1, lastRow - 1, 13).getValues();
  let changed = 0;

  const updates = data.map(row => {
    const staffId = String(row[2]).trim();
    const isSecond = SECOND_STAFF_IDS.indexOf(staffId) !== -1;
    const newName = isSecond ? NEW_SECOND : NEW_KITA;

    const main = String(row[7] || '');
    const second = String(row[8] || '');
    const subs = String(row[9] || '');

    const r1 = _safeReplace(main, variants, newName);
    const r2 = _safeReplace(second, variants, newName);
    const r3 = _safeReplace(subs, variants, newName);

    if (r1.changed) changed++;
    if (r2.changed) changed++;
    if (r3.changed) changed++;

    return [r1.value, r2.value, r3.value];
  });

  sheet.getRange(2, 8, updates.length, 3).setValues(updates);

  const msg = `T_希望提出: ${changed}セル置換`;
  Logger.log(msg);
  return msg;
}

function _replaceConfirmedFacilities(variants, NEW_KITA, NEW_SECOND, SECOND_STAFF_IDS) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('T_シフト確定');
  if (!sheet) return 'T_シフト確定 が存在しない → スキップ';
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 'T_シフト確定 は空 → スキップ';

  const data = sheet.getRange(2, 1, lastRow - 1, 15).getValues();
  let changed = 0;

  const updates = data.map(row => {
    const staffId = String(row[6]).trim();
    const facName = String(row[4] || '');

    if (!_hasRawUebashi(facName, variants)) {
      return [facName];
    }

    const isSecond = SECOND_STAFF_IDS.indexOf(staffId) !== -1;
    const newName = isSecond ? NEW_SECOND : NEW_KITA;
    const r = _safeReplace(facName, variants, newName);
    if (r.changed) changed++;
    return [r.value];
  });

  sheet.getRange(2, 5, updates.length, 1).setValues(updates);

  const msg = `T_シフト確定: ${changed}セル置換`;
  Logger.log(msg);
  return msg;
}

function verifyUebashiSplit() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  Logger.log('=== 実行後の上板橋E-st関連 ===\n');

  const staffSheet = ss.getSheetByName('M_スタッフ');
  const sData = staffSheet.getRange(2, 1, staffSheet.getLastRow() - 1, 17).getValues();
  const counts = {};
  sData.forEach(row => {
    const retired = String(row[16] || '').toUpperCase() === 'TRUE';
    if (retired) return;
    [row[9], row[10]].forEach(v => {
      const s = String(v || '').trim();
      if (s.indexOf('上板橋') !== -1) counts[s] = (counts[s] || 0) + 1;
    });
    String(row[11] || '').split(',').map(x => x.trim()).filter(Boolean).forEach(s => {
      if (s.indexOf('上板橋') !== -1) counts[s] = (counts[s] || 0) + 1;
    });
  });
  Logger.log('【M_スタッフ 在籍者の上板橋関連施設名分布】');
  Object.keys(counts).sort().forEach(k => Logger.log(`  "${k}" : ${counts[k]}セル`));

  const itoRow = sData.find(row => String(row[0]).trim() === '168');
  if (itoRow) {
    Logger.log(`\n【伊藤聡一郎(ID=168)】`);
    Logger.log(`  メイン(J): ${itoRow[9]}`);
    Logger.log(`  セカンド(K): ${itoRow[10]}`);
    Logger.log(`  サブ(L): ${itoRow[11]}`);
  }
}

function checkDataIntegrity() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('M_スタッフ');
  const lastRow = sheet.getLastRow();
  const data = sheet.getRange(2, 1, lastRow - 1, 17).getValues();

  const counts = {};
  data.forEach(row => {
    const retired = String(row[16] || '').toUpperCase() === 'TRUE';
    if (retired) return;
    [row[9], row[10]].forEach(v => {
      const s = String(v || '').trim();
      if (s.indexOf('上板橋') !== -1) counts[s] = (counts[s] || 0) + 1;
    });
    String(row[11] || '').split(',').map(x => x.trim()).filter(Boolean).forEach(s => {
      if (s.indexOf('上板橋') !== -1) counts[s] = (counts[s] || 0) + 1;
    });
  });

  Logger.log('=== 現状の上板橋関連施設名分布 ===');
  Object.keys(counts).sort().forEach(k => Logger.log(`  "${k}" : ${counts[k]}`));
  Logger.log(`\n合計: ${Object.keys(counts).length}種類`);
}