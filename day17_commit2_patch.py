#!/usr/bin/env python3
"""Day 17 Commit 2: 夜勤A-G拡張 配列単純拡張 (B1-B15)
- 9種類のパターン、合計52箇所
- 全 .js/.html ファイルに対して文字列置換
"""
import os, shutil, sys
from pathlib import Path
from datetime import datetime

ROOT = Path.home() / 'konohikara'
TIMESTAMP = datetime.now().strftime('%Y%m%d_%H%M%S')
BACKUP_DIR = Path('/tmp') / f'day17_commit2_backup_{TIMESTAMP}'

# 対象ファイル: ルート直下の全 .js / .html
target_files = sorted([f for f in os.listdir(ROOT)
                       if f.endswith('.js') or f.endswith('.html')
                       and not f.startswith('day17_commit')])

# パッチ定義 (長いパターンから先)
patches = [
    {'id': 'P3', 'expected_count': 4, 'desc': 'ALL_SHIFTS型配列 (夜勤+日勤、スペース付き)',
     'old': "['夜勤A', '夜勤B', '夜勤C', '早出8h', '早出4h', '遅出8h', '遅出4h']",
     'new': "['夜勤A', '夜勤B', '夜勤C', '夜勤D', '夜勤E', '夜勤F', '夜勤G', '早出8h', '早出4h', '遅出8h', '遅出4h']"},
    {'id': 'P4', 'expected_count': 2, 'desc': 'ALLOWED_SHIFTS型配列 (日勤+夜勤)',
     'old': "['早出8h', '早出4h', '遅出8h', '遅出4h', '夜勤A', '夜勤B', '夜勤C']",
     'new': "['早出8h', '早出4h', '遅出8h', '遅出4h', '夜勤A', '夜勤B', '夜勤C', '夜勤D', '夜勤E', '夜勤F', '夜勤G']"},
    {'id': 'P10', 'expected_count': 1, 'desc': 'StaffApp_Code.js デフォルト許可シフト (夜勤区分外)',
     'old': "['夜勤A','夜勤B','夜勤C','早出8h','遅出8h']",
     'new': "['夜勤A','夜勤B','夜勤C','夜勤D','夜勤E','夜勤F','夜勤G','早出8h','遅出8h']"},
    {'id': 'P5', 'expected_count': 2, 'desc': 'カンマ区切り文字列',
     'old': "'夜勤A,夜勤B,夜勤C,早出8h,早出4h,遅出8h,遅出4h'",
     'new': "'夜勤A,夜勤B,夜勤C,夜勤D,夜勤E,夜勤F,夜勤G,早出8h,早出4h,遅出8h,遅出4h'"},
    {'id': 'P7', 'expected_count': 1, 'desc': 'placedByShift初期化オブジェクト',
     'old': "placedByShift: { '夜勤A': 0, '夜勤B': 0, '夜勤C': 0 },",
     'new': "placedByShift: { '夜勤A': 0, '夜勤B': 0, '夜勤C': 0, '夜勤D': 0, '夜勤E': 0, '夜勤F': 0, '夜勤G': 0 },"},
    {'id': 'P8', 'expected_count': 1, 'desc': 'isNightShift OR連結 (st)',
     'old': "st === '夜勤A' || st === '夜勤B' || st === '夜勤C'",
     'new': "st === '夜勤A' || st === '夜勤B' || st === '夜勤C' || st === '夜勤D' || st === '夜勤E' || st === '夜勤F' || st === '夜勤G'"},
    {'id': 'P9', 'expected_count': 1, 'desc': '夜勤判定 OR連結 (t)',
     'old': "t === '夜勤A' || t === '夜勤B' || t === '夜勤C'",
     'new': "t === '夜勤A' || t === '夜勤B' || t === '夜勤C' || t === '夜勤D' || t === '夜勤E' || t === '夜勤F' || t === '夜勤G'"},
    {'id': 'P1', 'expected_count': 35, 'desc': '単独NIGHT_SHIFTS配列 (スペース付き)',
     'old': "['夜勤A', '夜勤B', '夜勤C']",
     'new': "['夜勤A', '夜勤B', '夜勤C', '夜勤D', '夜勤E', '夜勤F', '夜勤G']"},
    {'id': 'P2', 'expected_count': 5, 'desc': '単独NIGHT_SHIFTS配列 (スペース無し)',
     'old': "['夜勤A','夜勤B','夜勤C']",
     'new': "['夜勤A','夜勤B','夜勤C','夜勤D','夜勤E','夜勤F','夜勤G']"},
]

# Step 1: バックアップ
BACKUP_DIR.mkdir(parents=True, exist_ok=True)
print(f"📦 バックアップ先: {BACKUP_DIR}")
for fname in target_files:
    shutil.copy(ROOT / fname, BACKUP_DIR / fname)
print(f"✅ {len(target_files)}ファイル バックアップ完了\n")

# Step 2: 適用前カウント確認
print("🔍 適用前カウント確認:")
all_ok = True
for p in patches:
    total = 0
    file_counts = {}
    for fname in target_files:
        content = (ROOT / fname).read_text(encoding='utf-8')
        c = content.count(p['old'])
        if c > 0:
            file_counts[fname] = c
            total += c
    p['_total'] = total
    p['_file_counts'] = file_counts
    if total == p['expected_count']:
        print(f"  ✅ [{p['id']}] 期待={p['expected_count']}, 実値={total}: {p['desc']}")
    else:
        print(f"  ❌ [{p['id']}] 期待={p['expected_count']}, 実値={total}: {p['desc']}")
        print(f"       検出: {file_counts}")
        all_ok = False

if not all_ok:
    print("\n❌ カウント不一致、適用中止")
    sys.exit(1)

# Step 3: 適用
print("\n🛠️  パッチ適用:")
total_replacements = 0
for p in patches:
    affected_files = []
    for fname in target_files:
        fpath = ROOT / fname
        content = fpath.read_text(encoding='utf-8')
        c = content.count(p['old'])
        if c > 0:
            new_content = content.replace(p['old'], p['new'])
            fpath.write_text(new_content, encoding='utf-8')
            affected_files.append(f"{fname}({c})")
            total_replacements += c
    print(f"  ✅ [{p['id']}] {p['_total']}箇所適用: {', '.join(affected_files)}")

print(f"\n✅ 全{total_replacements}箇所適用完了")
print(f"📦 ロールバック: cp {BACKUP_DIR}/*.js {BACKUP_DIR}/*.html {ROOT}/")
