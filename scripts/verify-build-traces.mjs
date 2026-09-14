import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, relative, sep } from 'node:path';

const root = process.cwd();
const required = resolve('node_modules/next/dist/lib/framework/boundary-constants.js');
let checked = 0;
function visit(folder) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = resolve(folder, entry.name);
    if (entry.isDirectory()) { visit(path); continue; }
    if (!entry.name.endsWith('.nft.json')) continue;
    const files = JSON.parse(readFileSync(path, 'utf8')).files.map(file => resolve(dirname(path), file));
    if (!files.includes(required)) throw new Error(`Missing Next.js runtime dependency in ${relative(root, path)}`);
    for (const file of files) {
      const local = relative(root, file).split(sep).join('/');
      if (/^(work|instance|android|tests)\//.test(local) || /^\.env/.test(local) || /\.(p12|jks|keystore)$/.test(local)) throw new Error(`Private file included in deployment: ${local}`);
    }
    checked++;
  }
}
visit(resolve('.next/server/app'));
if (!checked) throw new Error('No Next.js route traces found.');
console.log(`Verified ${checked} deployment traces: runtime dependency present, private files excluded.`);
