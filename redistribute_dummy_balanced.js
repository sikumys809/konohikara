// ============================================================
// ダミー114名を13建物にバランス配分 v3
// - 全角括弧(板橋北区)/(板橋北区セカンド) 対応
// - ルーデンス上板橋E-st は板橋北区/セカンドで別物として区別
// - 既存99名 + 114名 = 213名を13建物に均等化(目標16-17人/建物)
// ============================================================

// 実データと完全一致する建物名(全角括弧)
const BUILDINGS_BY_FACILITY = {
  'GHコノヒカラ': [
    'リフレ要町',
    'ルーデンス中野富士見町',
    'EST東長崎'
  ],
  'GHコノヒカラ板橋北区': [
    'ルーデンス新板橋Ⅱ',
    'ルーデンス東十条アネックス',
    'ルーデンス上板橋E-st(板橋北区)',
    'ルーデンス東十条マキシブ'
  ],
  'GHコノヒカラ板橋北区セカンド': [
    'ルーデンス本蓮沼',
    'ルーデンス上板橋E-st(板橋北区セカンド)',
    'ルーデンス板橋区役所前'
  ],
  'GHコノヒカラ練馬': [
    'ルーデンス大泉学園前'
  ],
  'GHコノヒカラ品川': [
    'ルーデンス立会川Ⅱ',
    'ルーデンス梅屋敷'
  ]
};

function checkActualBuildingNames() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('M_スタッフ');
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 20).getValues();

  const names = {};
  data.forEach(row => {
    const retired = String(row[16] || '').toUpperCase() === 'TRUE';
    if (retired) return;
    const mainFac = String(row[9] || '').trim();
    if (!mainFac) return;
    names[mainFac] = (names[mainFac] || 0) + 1;
  });

  Logger.log('========== 実データの建物名(在籍) ==========');
  Object.keys(names).sort().forEach(k => {
    Logger.log(`  ${k}  [${names[k]}人]  raw=${JSON.stringify(k)}`);
  });
}

/**
 * メイン関数: ダミー114名を13建物に均等分散
 */
function redistributeDummyStaffBalanced() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('M_スタッフ');
  const lastRow = sheet.getLastRow();
  const data = sheet.getRange(2, 1, lastRow - 1, 20).getValues();

  Logger.log(`========== ダミー114名の建物再割当(v3) 開始 ==========`);

  // 全建物リスト構築
  const allBuildings = [];
  Object.values(BUILDINGS_BY_FACILITY).forEach(buildings => {
    buildings.forEach(b => allBuildings.push(b));
  });

  Logger.log(`配分対象建物: ${allBuildings.length}建物`);
  allBuildings.forEach(b => Logger.log(`  - ${b}`));

  // ステップ1: 対象と既存分布の集計
  const targets = [];
  const existingCount = {};
  allBuildings.forEach(b => { existingCount[b] = 0; });

  data.forEach((row, idx) => {
    const rowNum = idx + 2;
    const mainFac = String(row[9] || '').trim();
    const retired = String(row[16] || '').toUpperCase() === 'TRUE';
    if (retired) return;

    if (mainFac === 'GHコノヒカラ') {
      targets.push({
        rowNum,
        staffId: row[0],
        name: String(row[1])
      });
    } else if (existingCount.hasOwnProperty(mainFac)) {
      existingCount[mainFac]++;
    } else if (mainFac) {
      Logger.log(`⚠ 配分対象外の建物名: "${mainFac}" - ${row[1]} (そのまま維持)`);
    }
  });

  Logger.log(`\n対象ダミー: ${targets.length}件`);
  Logger.log(`\n既存分布:`);
  Object.keys(existingCount).sort().forEach(b => {
    Logger.log(`  ${b}: ${existingCount[b]}人`);
  });

  if (targets.length === 0) {
    Logger.log('対象なし');
    return;
  }

  // ステップ2: 配分計算(均等化)
  const totalExisting = Object.values(existingCount).reduce((a, b) => a + b, 0);
  const totalAfter = totalExisting + targets.length;
  const avgPerBuilding = totalAfter / allBuildings.length;

  Logger.log(`\n配分計算:`);
  Logger.log(`  既存合計(配分対象13建物): ${totalExisting}人`);
  Logger.log(`  ダミー追加: ${targets.length}人`);
  Logger.log(`  最終合計: ${totalAfter}人 / ${allBuildings.length}建物`);
  Logger.log(`  目標平均: ${avgPerBuilding.toFixed(1)}人/建物`);

  const targetAddPerBuilding = {};
  allBuildings.forEach(b => {
    const target = Math.ceil(avgPerBuilding);
    targetAddPerBuilding[b] = Math.max(0, target - existingCount[b]);
  });

  // 差分調整
  let totalTargetAdd = Object.values(targetAddPerBuilding).reduce((a, b) => a + b, 0);
  if (totalTargetAdd < targets.length) {
    const sorted = allBuildings.slice().sort((a, b) =>
      (existingCount[a] + targetAddPerBuilding[a]) - (existingCount[b] + targetAddPerBuilding[b])
    );
    let diff = targets.length - totalTargetAdd;
    while (diff > 0) {
      for (const b of sorted) {
        if (diff <= 0) break;
        targetAddPerBuilding[b]++;
        diff--;
      }
    }
  } else if (totalTargetAdd > targets.length) {
    const sorted = allBuildings.slice().sort((a, b) =>
      (existingCount[b] + targetAddPerBuilding[b]) - (existingCount[a] + targetAddPerBuilding[a])
    );
    let diff = totalTargetAdd - targets.length;
    while (diff > 0) {
      for (const b of sorted) {
        if (diff <= 0) break;
        if (targetAddPerBuilding[b] > 0) {
          targetAddPerBuilding[b]--;
          diff--;
        }
      }
    }
  }

  totalTargetAdd = Object.values(targetAddPerBuilding).reduce((a, b) => a + b, 0);
  Logger.log(`\n配分計画:`);
  allBuildings.slice().sort().forEach(b => {
    const final = existingCount[b] + targetAddPerBuilding[b];
    Logger.log(`  ${b}: 既存${existingCount[b]} + 追加${targetAddPerBuilding[b]} = ${final}人`);
  });
  Logger.log(`  追加合計: ${totalTargetAdd} (対象${targets.length}件と${totalTargetAdd === targets.length ? '一致 ✓' : '不一致 ✗'})`);

  // ステップ3: 配分リスト生成+シャッフル
  const assignments = [];
  allBuildings.forEach(b => {
    for (let i = 0; i < targetAddPerBuilding[b]; i++) {
      assignments.push(b);
    }
  });
  for (let i = assignments.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [assignments[i], assignments[j]] = [assignments[j], assignments[i]];
  }

  // ステップ4: 割当実行
  const summary = {};
  targets.forEach((t, idx) => {
    const building = assignments[idx];
    sheet.getRange(t.rowNum, 10).setDataValidation(null).setValue(building);
    summary[building] = (summary[building] || 0) + 1;
  });

  SpreadsheetApp.flush();

  Logger.log(`\n✅ 完了: ${targets.length}件の再割当成功`);
  Logger.log(`\n========== 最終結果 ==========`);
  allBuildings.slice().sort().forEach(b => {
    const final = existingCount[b] + (summary[b] || 0);
    Logger.log(`  ${b}: ${final}人 (既存${existingCount[b]} + 追加${summary[b] || 0})`);
  });
}

/**
 * 確認用: 全在籍スタッフの建物分布
 */
function checkFinalDistribution() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('M_スタッフ');
  const lastRow = sheet.getLastRow();
  const data = sheet.getRange(2, 1, lastRow - 1, 20).getValues();

  const distribution = {};
  let activeTotal = 0;

  data.forEach(row => {
    const retired = String(row[16] || '').toUpperCase() === 'TRUE';
    if (retired) return;
    activeTotal++;
    const mainFac = String(row[9] || '').trim();
    if (!mainFac) return;
    distribution[mainFac] = (distribution[mainFac] || 0) + 1;
  });

  Logger.log(`========== 在籍${activeTotal}名の最終分布 ==========`);
  Object.keys(distribution).sort().forEach(k => {
    const bar = '█'.repeat(distribution[k]);
    Logger.log(`  ${String(distribution[k]).padStart(3)}人 ${k.padEnd(35)} ${bar}`);
  });
}