# Phase 7 完了引き継ぎ書 - 固定配置機能

## 概要
- 実施日: 2026-05-12
- HEAD: 8d945af
- Deploy: @176
- 目的: 管理者・正社員などの固定勤務スタッフを完全対応

## 主要ファイル
- 新規: fixed_assignment.js (513行)
- 改修: AdminApp_Code.js, Admin.html, StaffApp_Code.js, Index.html.html
- 改修: dayshift_engine_v2.js, nightshift_engine_v4.js (FIXED_*保護ガード)

## データ構造

### M_固定配置 (12列)
- A: fixed_id (例: FIXED_001)
- B: staff_id
- C: type (日付指定 / 曜日指定)
- D: target_ym (日付指定の場合のみ)
- E: dates_or_weekdays (カンマ区切り)
- F: shift_type (既存7種類)
- G: unit_id
- H: valid_from, I: valid_to
- J: is_active
- K: note, L: created_at

### T_シフト確定 への先取り書込
- shift_id 形式: FIXED_<fixed_id>_<dateKey>
- ステータス: "確定" (最初から確定状態)
- writeShiftResults* は FIXED_* レコを削除しない保護ガード

## 動作フロー
1. Admin画面で固定配置設定 (M_固定配置 に追加)
2. preplaceFixedAssignments(targetYM) を実行 (現状: 手動)
3. T_シフト確定 に FIXED_* レコ書込
4. 自動配置エンジン実行: 既存配置として ctx に反映 → H1で同時刻除外
5. スタッフUI: ログイン時 isFixedAssigned 判定 → 提出無効化

## 重要な関数
- expandFixedAssignments(targetYM): 対象月への日付展開
- preplaceFixedAssignments(targetYM): T_シフト確定 に書込
- _isStaffFixedAssigned(staffId): スタッフの固定配置あり判定
- getFixedAssignmentsForAdmin: Admin画面用、スタッフ名・ユニット情報付き
- getUnitsList: 固定配置UI用、M_ユニット一覧

## テスト関数
- testFixedAssignmentSystem: 全体動作確認
- testPreplaceFixedAssignments: 展開・書込テスト
- debug_test_fixed_assignment_full: 統合テスト
- debug_preplace_2026_06: 2026-06 の固定配置を再書込

## 検証結果 (2026-06)
- 固定配置 27件展開・書込確認:
  - FIXED_001: sid=5 (中村仁美) / 月-金 早出8h @ U15 × 22日
  - FIXED_002: sid=13 (水野永吉) / 毎週月曜 遅出8h @ U14 × 5日
- 夜勤+日勤エンジン実行後も FIXED_* レコ残存
- 充足率改善:
  - GHコノヒカラ 世話人: 53% → 69%
  - GHコノヒカラ サビ管: 105% → 145%
  - 生活支援員: 全事業所 0% → 101-117% (Phase 6効果)

## 残課題 (次セッション以降)

### 高優先
1. ブラウザでのUI動作確認 (Admin画面/スタッフ画面両方)
2. preplaceFixedAssignments の自動実行統合
   - 現状: GAS関数を手動で呼ぶ必要
   - 改善: runDayShiftEngineV2 / runNightShiftEngineV4 の冒頭で自動呼出

### 中優先
3. スタッフUIで FIXED_* レコを「確定済シフト」として明示表示
4. 固定配置の編集機能 (現状: 削除→再追加)
5. 同一日時の競合チェック

### 低優先
6. M_固定配置 シートのCSVインポート
7. 月別の固定配置プレビュー

## 関連リンク
- Notion 親: https://www.notion.so/353ec81ceecf81809525c6a88057b9de
