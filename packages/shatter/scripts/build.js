// Assembles dist/DoooomShatter.jsx = template with core/fracture.js inlined at /*__CORE__*/
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const tpl = fs.readFileSync(path.join(root, 'illustrator/DoooomShatter.template.jsx'), 'utf8');
const core = fs.readFileSync(path.join(root, 'core/fracture.js'), 'utf8')
  .split('\n').map(l => (l.length ? '    ' + l : l)).join('\n');
if (!tpl.includes('/*__CORE__*/')) throw new Error('template missing /*__CORE__*/ marker');
const out = tpl.replace('/*__CORE__*/', '// ==== core/fracture.js (inlined by scripts/build.js) ====\n' + core);
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/DoooomShatter.jsx'), out);
// ES3 parse check so ExtendScript will accept it
const acorn = require('acorn');
acorn.parse(out.replace(/^#target.*$/m, ''), { ecmaVersion: 3 });
console.log('built dist/DoooomShatter.jsx (' + out.length + ' bytes, ES3 OK)');
