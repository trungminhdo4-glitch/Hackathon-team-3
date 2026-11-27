#!/usr/bin/env python3
"""Read-only progress viewer; does not launch model requests."""
import argparse
from datetime import datetime
import json
from pathlib import Path
import time


def show(root):
    files = list(root.glob('*/submission.json'))
    if not files:
        print('Сохранённых запусков пока нет.', flush=True)
        return
    path = max(files, key=lambda p: p.stat().st_mtime)
    data = json.loads(path.read_text())
    rows = data['products']
    a = sum(r['phase'] in ('A', 'B') for r in rows)
    b = sum(r['phase'] == 'B' for r in rows)
    active = sum(r['status'] == 'RUNNING' for r in rows)
    print(f"\n{datetime.now():%H:%M:%S}  {path.parent.name}", flush=True)
    print(f'Первый этап: {a}/{len(rows)}. Перепроверено: {b}/{len(rows)}. В работе: {active}.', flush=True)
    stages = {'queued': 'очередь', 'source_fetch': 'загрузка страниц', 'research_queue': 'ожидание поиска', 'research': 'поиск', 'validation': 'проверка цитат', 'judgement_queue': 'ожидание пересмотра', 'judgement': 'пересмотр вывода', 'settled': 'этап завершён'}
    for r in rows:
        phase = r.get('active_phase') or r['phase']
        stage = stages.get(r.get('stage'), '')
        print(f"{r['id']:12} {r['status']:9} этап {phase:4} цитат: {len(r['reasons'])} {stage}  {r['url']}", flush=True)
    print('Отчёт: ' + str(path.parent / 'report.md'), flush=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--watch', type=float, default=0, help='Refresh interval in seconds')
    args = ap.parse_args()
    root = Path(__file__).resolve().parent / 'runs'
    while True:
        try:
            show(root)
        except (OSError, ValueError) as e:
            print('Не удалось прочитать состояние: ' + str(e), flush=True)
        if args.watch <= 0:
            break
        time.sleep(max(1, args.watch))


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        pass
