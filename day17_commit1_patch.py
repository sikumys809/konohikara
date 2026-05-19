#!/usr/bin/env python3
"""Day 17 Commit 1: 夜勤A-G拡張 マスタ定義 (A1-A7)"""
import os, shutil, sys
from pathlib import Path
from datetime import datetime

ROOT = Path.home() / 'konohikara'
TIMESTAMP = datetime.now().strftime('%Y%m%d_%H%M%S')
BACKUP_DIR = Path('/tmp') / f'day17_commit1_backup_{TIMESTAMP}'

files_to_patch = ['setup_dayshift.js', 'AdminApp_Code.js', 'fixed_assignment.js', 'StaffApp_Code.js', 'common_constraints.js', 'dayshift_calendar_api.js']

BACKUP_DIR.mkdir(parents=True, exist_ok=True)
print(f"📦 バックアップ先: {BACKUP_DIR}")
for fname in files_to_patch:
    src = ROOT / fname
    if not src.exists():
        print(f"❌ ファイルなし: {src}"); sys.exit(1)
    shutil.copy(src, BACKUP_DIR / fname)
print(f"✅ バックアップ完了\n")

patches = [
    {'id': 'A1', 'file': 'setup_dayshift.js', 'desc': 'SHIFT_PATTERNS A-G拡張',
     'old': """const SHIFT_PATTERNS = {
  '夜勤A':   { start: '20:00', end: '05:00', nightHours: 6, dayHours: 2, breakMinutes: 60 },  // ★Day10訂正: 20:00-22:00の2hを日勤カウント
  '夜勤B':   { start: '22:00', end: '07:00', nightHours: 6, dayHours: 2, breakMinutes: 60 },
  '夜勤C':   { start: '22:00', end: '08:00', nightHours: 6, dayHours: 2, breakMinutes: 120 },""",
     'new': """const SHIFT_PATTERNS = {
  // ★Day17 A-G拡張: 休憩01:00-04:30共通(3.5h)、夜勤帯3.5h固定
  '夜勤A':   { start: '17:30', end: '05:00', nightHours: 3.5, dayHours: 4.5, breakMinutes: 210 },
  '夜勤B':   { start: '20:00', end: '05:00', nightHours: 3.5, dayHours: 2.0, breakMinutes: 210 },
  '夜勤C':   { start: '20:00', end: '06:30', nightHours: 3.5, dayHours: 3.5, breakMinutes: 210 },
  '夜勤D':   { start: '20:00', end: '07:30', nightHours: 3.5, dayHours: 4.5, breakMinutes: 210 },
  '夜勤E':   { start: '22:00', end: '07:00', nightHours: 3.5, dayHours: 2.0, breakMinutes: 210 },
  '夜勤F':   { start: '22:00', end: '08:00', nightHours: 3.5, dayHours: 3.0, breakMinutes: 210 },
  '夜勤G':   { start: '22:00', end: '09:30', nightHours: 3.5, dayHours: 4.5, breakMinutes: 210 },"""},
    {'id': 'A2', 'file': 'AdminApp_Code.js', 'desc': 'shiftInfo A-G拡張',
     'old': """  const shiftInfo = {
    '夜勤A': { start: '20:00', end: '05:00' },
    '夜勤B': { start: '22:00', end: '07:00' },
    '夜勤C': { start: '22:00', end: '08:00' },
  };""",
     'new': """  const shiftInfo = {
    // ★Day17 A-G拡張
    '夜勤A': { start: '17:30', end: '05:00' },
    '夜勤B': { start: '20:00', end: '05:00' },
    '夜勤C': { start: '20:00', end: '06:30' },
    '夜勤D': { start: '20:00', end: '07:30' },
    '夜勤E': { start: '22:00', end: '07:00' },
    '夜勤F': { start: '22:00', end: '08:00' },
    '夜勤G': { start: '22:00', end: '09:30' },
  };"""},
    {'id': 'A3', 'file': 'fixed_assignment.js', 'desc': 'shiftInfo A-G拡張',
     'old': """  const shiftInfo = {
    '夜勤A': { start: '20:00', end: '05:00', nightH: 6, dayH: 2 },
    '夜勤B': { start: '22:00', end: '07:00', nightH: 6, dayH: 2 },
    '夜勤C': { start: '22:00', end: '08:00', nightH: 6, dayH: 2 },""",
     'new': """  const shiftInfo = {
    // ★Day17 A-G拡張
    '夜勤A': { start: '17:30', end: '05:00', nightH: 3.5, dayH: 4.5 },
    '夜勤B': { start: '20:00', end: '05:00', nightH: 3.5, dayH: 2.0 },
    '夜勤C': { start: '20:00', end: '06:30', nightH: 3.5, dayH: 3.5 },
    '夜勤D': { start: '20:00', end: '07:30', nightH: 3.5, dayH: 4.5 },
    '夜勤E': { start: '22:00', end: '07:00', nightH: 3.5, dayH: 2.0 },
    '夜勤F': { start: '22:00', end: '08:00', nightH: 3.5, dayH: 3.0 },
    '夜勤G': { start: '22:00', end: '09:30', nightH: 3.5, dayH: 4.5 },"""},
    {'id': 'A4', 'file': 'fixed_assignment.js', 'desc': 'SHIFT_HOURS A-G拡張',
     'old': """  const SHIFT_HOURS = { '早出8h': 8, '早出4h': 4, '遅出8h': 8, '遅出4h': 4, '夜勤A': 2, '夜勤B': 2, '夜勤C': 2 };""",
     'new': """  // ★Day17 A-G拡張: 夜勤の日勤帯加算分はパターン毎のdayHours
  const SHIFT_HOURS = { '早出8h': 8, '早出4h': 4, '遅出8h': 8, '遅出4h': 4, '夜勤A': 4.5, '夜勤B': 2.0, '夜勤C': 3.5, '夜勤D': 4.5, '夜勤E': 2.0, '夜勤F': 3.0, '夜勤G': 4.5 };"""},
    {'id': 'A5', 'file': 'StaffApp_Code.js', 'desc': 'SHIFT_TIMES A-G拡張、休憩統一',
     'old': """const SHIFT_TIMES = {
  '夜勤A': {
    label: '20:00-05:00',
    start: '20:00', end: '05:00',
    breaks: [{ start: '02:00', end: '03:00' }],
    workHours: 8
  },
  '夜勤B': {
    label: '22:00-07:00',
    start: '22:00', end: '07:00',
    breaks: [{ start: '02:00', end: '03:00' }],
    workHours: 8
  },
  '夜勤C': {
    label: '22:00-08:00',
    start: '22:00', end: '08:00',
    breaks: [
      { start: '02:00', end: '03:00' },
      { start: '05:00', end: '06:00' }
    ],
    workHours: 8
  },""",
     'new': """const SHIFT_TIMES = {
  // ★Day17 A-G拡張: 休憩01:00-04:30共通
  '夜勤A': {
    label: '17:30-05:00',
    start: '17:30', end: '05:00',
    breaks: [{ start: '01:00', end: '04:30' }],
    workHours: 8
  },
  '夜勤B': {
    label: '20:00-05:00',
    start: '20:00', end: '05:00',
    breaks: [{ start: '01:00', end: '04:30' }],
    workHours: 5.5
  },
  '夜勤C': {
    label: '20:00-06:30',
    start: '20:00', end: '06:30',
    breaks: [{ start: '01:00', end: '04:30' }],
    workHours: 7
  },
  '夜勤D': {
    label: '20:00-07:30',
    start: '20:00', end: '07:30',
    breaks: [{ start: '01:00', end: '04:30' }],
    workHours: 8
  },
  '夜勤E': {
    label: '22:00-07:00',
    start: '22:00', end: '07:00',
    breaks: [{ start: '01:00', end: '04:30' }],
    workHours: 5.5
  },
  '夜勤F': {
    label: '22:00-08:00',
    start: '22:00', end: '08:00',
    breaks: [{ start: '01:00', end: '04:30' }],
    workHours: 6.5
  },
  '夜勤G': {
    label: '22:00-09:30',
    start: '22:00', end: '09:30',
    breaks: [{ start: '01:00', end: '04:30' }],
    workHours: 8
  },"""},
    {'id': 'A6', 'file': 'common_constraints.js', 'desc': 'SHIFT_BREAKS A-G拡張',
     'old': """const SHIFT_BREAKS = {
  '夜勤A': [{ start: '02:00', end: '03:00' }],
  '夜勤B': [{ start: '02:00', end: '03:00' }],
  '夜勤C': [{ start: '02:00', end: '03:00' }, { start: '05:00', end: '06:00' }],""",
     'new': """const SHIFT_BREAKS = {
  // ★Day17 A-G拡張: 全パターン共通 01:00-04:30 (3.5h)
  '夜勤A': [{ start: '01:00', end: '04:30' }],
  '夜勤B': [{ start: '01:00', end: '04:30' }],
  '夜勤C': [{ start: '01:00', end: '04:30' }],
  '夜勤D': [{ start: '01:00', end: '04:30' }],
  '夜勤E': [{ start: '01:00', end: '04:30' }],
  '夜勤F': [{ start: '01:00', end: '04:30' }],
  '夜勤G': [{ start: '01:00', end: '04:30' }],"""},
    {'id': 'A7', 'file': 'dayshift_calendar_api.js', 'desc': 'SHIFT_HOURS(日勤帯加算分) A-G拡張',
     'old': """    const SHIFT_HOURS = {
      '早出8h': 8, '早出4h': 4, '遅出8h': 8, '遅出4h': 4,
      '夜勤A': 2, '夜勤B': 2, '夜勤C': 2  // 日勤帯への加算分
    };""",
     'new': """    // ★Day17 A-G拡張: 各シフトのdayHours (日勤帯への加算分)
    const SHIFT_HOURS = {
      '早出8h': 8, '早出4h': 4, '遅出8h': 8, '遅出4h': 4,
      '夜勤A': 4.5, '夜勤B': 2.0, '夜勤C': 3.5, '夜勤D': 4.5, '夜勤E': 2.0, '夜勤F': 3.0, '夜勤G': 4.5
    };"""},
]

print("🔍 適用前チェック:")
all_ok = True
for p in patches:
    fpath = ROOT / p['file']
    content = fpath.read_text(encoding='utf-8')
    n = content.count(p['old'])
    if n == 0:
        print(f"  ❌ [{p['id']}] {p['file']}: old_str 見つからない"); all_ok = False
    elif n > 1:
        print(f"  ⚠️  [{p['id']}] {p['file']}: {n}箇所マッチ"); all_ok = False
    else:
        print(f"  ✅ [{p['id']}] {p['file']}: 1箇所マッチOK")
if not all_ok:
    print("\n❌ 適用中止"); sys.exit(1)

print("\n🛠️  パッチ適用:")
for p in patches:
    fpath = ROOT / p['file']
    content = fpath.read_text(encoding='utf-8')
    fpath.write_text(content.replace(p['old'], p['new']), encoding='utf-8')
    print(f"  ✅ [{p['id']}] {p['file']}: {p['desc']}")

print("\n✅ 全7パッチ適用完了")
print(f"📦 ロールバック: cp {BACKUP_DIR}/*.js {ROOT}/")
