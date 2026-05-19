#!/usr/bin/env python3
"""Day 17 Commit 3: 夜勤A-G拡張 優先度ソート (D1)"""
import shutil, sys
from pathlib import Path
from datetime import datetime

ROOT = Path.home() / 'konohikara'
TIMESTAMP = datetime.now().strftime('%Y%m%d_%H%M%S')
BACKUP_DIR = Path('/tmp') / f'day17_commit3_backup_{TIMESTAMP}'

fname = 'nightshift_engine_v4.js'

BACKUP_DIR.mkdir(parents=True, exist_ok=True)
shutil.copy(ROOT / fname, BACKUP_DIR / fname)
print(f"📦 バックアップ: {BACKUP_DIR}/{fname}")

old_str = """    // ソート: VIP > 警告なし > シフト種別 (夜勤C>B>A) > スコア降順
    // シフト種別優先度の根拠:
    //   夜勤C: 朝8時まで → 朝の忙しい時間をカバー (最優先)
    //   夜勤B: 朝7時まで → 最低限
    //   夜勤A: 朝5時帰宅 → 朝サポートなし (最後の手段)
    //   例外: 看護師の夜勤A希望はVIPフラグで運用カバー (上位の1.VIP優先で担保)
    const _v4_shiftRank = function(s) {
      if (s === '夜勤C') return 3;
      if (s === '夜勤B') return 2;
      if (s === '夜勤A') return 1;
      return 0;
    };"""

new_str = """    // ★Day17 A-G拡張: ソート: VIP > 警告なし > シフト種別 (G>F>D>E>C>A>B) > スコア降順
    // シフト種別優先度の根拠 (朝サポート長い順):
    //   夜勤G: 朝9:30まで → 朝サポート最長 (最優先)
    //   夜勤F: 朝8:00まで
    //   夜勤D: 朝7:30まで
    //   夜勤E: 朝7:00まで
    //   夜勤C: 朝6:30まで
    //   夜勤A: 朝5:00まで、合計実労8h (B同時刻だが実労長くA優先)
    //   夜勤B: 朝5:00まで、合計実労5.5h (最後の手段)
    //   例外: 看護師の特殊希望はVIPフラグで運用カバー (上位の1.VIP優先で担保)
    const _v4_shiftRank = function(s) {
      if (s === '夜勤G') return 7;
      if (s === '夜勤F') return 6;
      if (s === '夜勤D') return 5;
      if (s === '夜勤E') return 4;
      if (s === '夜勤C') return 3;
      if (s === '夜勤A') return 2;
      if (s === '夜勤B') return 1;
      return 0;
    };"""

fpath = ROOT / fname
content = fpath.read_text(encoding='utf-8')
n = content.count(old_str)
if n == 0:
    print(f"❌ old_str が見つからない"); sys.exit(1)
elif n > 1:
    print(f"⚠️  {n}箇所マッチ、1箇所のみ期待"); sys.exit(1)
print(f"✅ old_str 1箇所マッチOK")

new_content = content.replace(old_str, new_str)
fpath.write_text(new_content, encoding='utf-8')
print(f"\n✅ Commit 3 適用完了")
print(f"📦 ロールバック: cp {BACKUP_DIR}/{fname} {ROOT}/")
