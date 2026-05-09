// ============================================================
// engine_common.js
// 日勤エンジン・夜勤エンジン両方で使う共通定数とヘルパー
// ★Day11 Phase4: E-st仮想キー方式の中核
// ============================================================

const ENGINE_COMMON = {
  // E-st 仮想キー(M_スタッフ J/K/L列で使う)
  EST_VIRTUAL_KEY: 'ルーデンス上板橋E-st',
  // E-st 実体施設(M_ユニット D列・T_シフト確定 E列で使う)
  EST_REAL_FACILITIES: [
    'ルーデンス上板橋E-st（板橋北区）',
    'ルーデンス上板橋E-st（板橋北区セカンド）'
  ],
  // E-st 関連事業所
  EST_JIGYOSHOS: [
    'GHコノヒカラ板橋北区',
    'GHコノヒカラ板橋北区セカンド'
  ],
};

/**
 * facが「E-st実体施設」か(前方一致)
 * "ルーデンス上板橋E-st(板橋北区)" "(板橋北区セカンド)" にマッチ
 */
function _isEstRealFacility(fac) {
  if (!fac) return false;
  return String(fac).indexOf('ルーデンス上板橋E-st') === 0
      && String(fac).length > 'ルーデンス上板橋E-st'.length;
}

/**
 * facがE-st仮想キーか
 */
function _isEstVirtualKey(fac) {
  return fac === ENGINE_COMMON.EST_VIRTUAL_KEY;
}

/**
 * E-st実体施設から、対応する事業所を返す
 * "...（板橋北区）" → "GHコノヒカラ板橋北区"
 * "...（板橋北区セカンド）" → "GHコノヒカラ板橋北区セカンド"
 */
function _estRealFacilityToJigyosho(fac) {
  if (!_isEstRealFacility(fac)) return null;
  if (fac.indexOf('セカンド') !== -1) return 'GHコノヒカラ板橋北区セカンド';
  return 'GHコノヒカラ板橋北区';
}

/**
 * 事業所から、対応するE-st実体施設を返す
 */
function _jigyoshoToEstRealFacility(jig) {
  if (jig === 'GHコノヒカラ板橋北区') return 'ルーデンス上板橋E-st（板橋北区）';
  if (jig === 'GHコノヒカラ板橋北区セカンド') return 'ルーデンス上板橋E-st（板橋北区セカンド）';
  return null;
}

/**
 * スタッフがslot施設にマッチするか判定 (E-st仮想キー対応)
 * 戻り値: 'main' | 'second' | 'sub' | null
 */
function _facilityMatchesStaff(slotFac, staff) {
  if (!slotFac || !staff) return null;
  
  // 通常のダイレクト比較
  if (staff.mainFac === slotFac) return 'main';
  if (staff.secondFac === slotFac) return 'second';
  if (staff.subFacs && staff.subFacs.indexOf(slotFac) !== -1) return 'sub';
  
  // E-st仮想キー対応: slotがE-st実体施設 + スタッフが仮想キー保有
  if (_isEstRealFacility(slotFac)) {
    const VK = ENGINE_COMMON.EST_VIRTUAL_KEY;
    if (staff.mainFac === VK) return 'main';
    if (staff.secondFac === VK) return 'second';
    if (staff.subFacs && staff.subFacs.indexOf(VK) !== -1) return 'sub';
  }
  
  return null;
}

/**
 * facilityToJigyoshos に E-st仮想キーをマージ追加する
 * (既にM_ユニットからカッコ付き2施設→事業所が登録されてる前提で呼ぶ)
 */
function _injectEstVirtualKey(facilityToJigyoshos) {
  const real1 = ENGINE_COMMON.EST_REAL_FACILITIES[0];
  const real2 = ENGINE_COMMON.EST_REAL_FACILITIES[1];
  const vk = ENGINE_COMMON.EST_VIRTUAL_KEY;
  
  if (!facilityToJigyoshos[real1] && !facilityToJigyoshos[real2]) return;
  
  const merged = [];
  (facilityToJigyoshos[real1] || []).forEach(function(j) {
    if (merged.indexOf(j) === -1) merged.push(j);
  });
  (facilityToJigyoshos[real2] || []).forEach(function(j) {
    if (merged.indexOf(j) === -1) merged.push(j);
  });
  facilityToJigyoshos[vk] = merged;
}
