// Renders the MCP smoke-test SVGs to PNG with headless Chromium (visual check). Run: npm run render
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
(async () => {
  const dir = path.join(__dirname, '..', 'mcp', 'test', 'out');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.svg'));
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const p = await b.newPage({ viewport: { width: 1700, height: 700 } });
  const html = files.map((f) => `<div style="display:inline-block;margin:6px;vertical-align:top"><div style="color:#bbb;font:14px sans-serif">${f}</div>${fs.readFileSync(path.join(dir, f), 'utf8').replace('<svg ', '<svg width="820" ')}</div>`).join('');
  await p.setContent(`<body style="background:#000;margin:0">${html}</body>`);
  await p.screenshot({ path: path.join(dir, 'contact.png') });
  await b.close();
  console.log('wrote', path.join(dir, 'contact.png'));
})();
