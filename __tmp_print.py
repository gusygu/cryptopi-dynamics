from pathlib import Path
text = Path('src/scripts/smoke/head-xray.mjs').read_text(encoding='utf-8')
start = text.index('const TYPES')
print(repr(text[start:start+120]))
