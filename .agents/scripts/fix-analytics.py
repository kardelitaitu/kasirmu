from pathlib import Path

KDS = Path('ui/src/dev-mock/handlers/analytics.ts')
ROUTER = Path('ui/src/dev-mock/tauri-api.ts')

kds_lines = KDS.read_text(encoding='utf-8').split('\n')
router_lines = ROUTER.read_text(encoding='utf-8').split('\n')

# 1. Add imports to analytics.ts
for i, ln in enumerate(kds_lines):
    if "import type { MockHandler } from '../core/mockDispatcher';" in ln:
        kds_lines.insert(i+1, "import { handlers } from '../core/mockDispatcher';")
        kds_lines.insert(i+2, "import { MOCK_CATEGORIES, MOCK_PRODUCTS } from './catalog';")
        break

# 2. Move isoDays from router to analytics.ts
iso_start = None
for i, ln in enumerate(router_lines):
    if 'function isoDays(startDate: string, endDate: string): string[] {' in ln:
        iso_start = i
        break

iso_end = None
if iso_start is not None:
    for j in range(iso_start + 1, len(router_lines)):
        prev = router_lines[j-1].strip()
        if router_lines[j].strip() == '}' and prev.startswith('return out;'):
            iso_end = j + 1
            break

if iso_start is not None and iso_end is not None:
    iso_func = '\n'.join(router_lines[iso_start:iso_end])
    for i, ln in enumerate(kds_lines):
        if 'The over-quota assessment fixture' in ln:
            kds_lines.insert(i, iso_func)
            kds_lines.insert(i+1, '')
            break
    del router_lines[iso_start:iso_end]
    print(f'Moved isoDays ({iso_start+1}-{iso_end}) from router')
else:
    print('isoDays not found')

KDS.write_text('\n'.join(kds_lines), encoding='utf-8')
ROUTER.write_text('\n'.join(router_lines), encoding='utf-8')
print('Updated both files')
