from pathlib import Path

path = Path('src/scripts/smoke/head-xray.mjs')
text = path.read_text(encoding='utf-8')

old_const = "const TYPES = [\"benchmark\", \"delta\", \"pct24h\", \"id_pct\", \"pct_drv\"];\r\nconst SLEEP = ms => new Promise(r => setTimeout(r, ms));"
new_const = "const TYPES = [\"benchmark\", \"delta\", \"pct24h\", \"id_pct\", \"pct_drv\"];\r\nconst DEF_COINS = [\"BTC\",\"ETH\",\"BNB\",\"SOL\",\"ADA\",\"XRP\",\"PEPE\",\"USDT\"];\r\nconst SLEEP = ms => new Promise(r => setTimeout(r, ms));"
if old_const not in text:
    raise SystemExit('expected constants block not found')
text = text.replace(old_const, new_const, 1)

old_func = "async function getSettingsCoins() {\r\n  const { status, body } = await jget(\"/api/settings\");\r\n  if (status !== 200 || !body) return normCoins([\"BTC\",\"ETH\",\"BNB\",\"SOL\",\"ADA\",\"XRP\",\"PEPE\",\"USDT\"]);\r\n  const from =\r\n    (Array.isArray(body?.coinUniverse) && body.coinUniverse) ||\r\n    (Array.isArray(body?.coins) && body.coins) ||\r\n    [];\r\n  const coins = normCoins(from);\r\n  return coins.length ? coins : normCoins([\"BTC\",\"ETH\",\"BNB\",\"SOL\",\"ADA\",\"XRP\",\"PEPE\",\"USDT\"]);\r\n}\r\n\r\nfunction qsCoins(coins) {"
new_func = "async function resolveCoins() {\r\n  if (process.env.COINS) {\r\n    const fromEnv = normCoins(process.env.COINS.split(\",\"));\r\n    if (fromEnv.length) return { coins: fromEnv, source: \"env:COINS\" };\r\n  }\r\n\r\n  const head = await jget(\"/api/matrices/head\");\r\n  if (head.status === 200 && Array.isArray(head.body?.coins)) {\r\n    const fromHead = normCoins(head.body.coins);\r\n    if (fromHead.length) return { coins: fromHead, source: \"/api/matrices/head\" };\r\n  }\r\n\r\n  const settings = await jget(\"/api/settings\");\r\n  if (settings.status === 200 && settings.body) {\r\n    const list =\r\n      (Array.isArray(settings.body?.coinUniverse) && settings.body.coinUniverse) ||\r\n      (Array.isArray(settings.body?.coins) && settings.body.coins) ||\r\n      [];\r\n    const fromSettings = normCoins(list);\r\n    if (fromSettings.length) return { coins: fromSettings, source: \"/api/settings\" };\r\n  }\r\n\r\n  return { coins: normCoins(DEF_COINS), source: \"default\" };\r\n}\r\n\r\nfunction qsCoins(coins) {"
if old_func not in text:
    raise SystemExit('expected getSettingsCoins block not found')
text = text.replace(old_func, new_func, 1)

old_main = "  console.log(\"\\u{1F52A} head-xray: settings \u001a preview \u001a pipeline \u001a head/latest \u001a DB \\u{1F52A}\");\r\n  const coins = await getSettingsCoins();\r\n  console.log(\"[coins]\", coins.join(\", \"));"
new_main = "  console.log(\"\\u{1F52A} head-xray: settings \u001a preview \u001a pipeline \u001a head/latest \u001a DB \\u{1F52A}\");\r\n  const { coins, source: coinSource } = await resolveCoins();\r\n  console.log(\"[coins]\", coins.join(\", \"), `(source: ${coinSource})`);"
if old_main not in text:
    raise SystemExit('expected main coins logging block not found')
text = text.replace(old_main, new_main, 1)

path.write_text(text, encoding='utf-8')
