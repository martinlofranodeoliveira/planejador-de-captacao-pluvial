import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dest = process.argv.length === 2 ? path.join(root, 'dist') : process.argv[3];
if (process.argv.length !== 2 && !(process.argv.length === 4 && process.argv[2] === '--output' && dest === '/tmp/atendimento-dist')) throw new Error('Destino inválido');
await mkdir(dest, { recursive: true });
for (const file of ['index.html','styles.css','src','examples','LICENSE','THIRD_PARTY_NOTICES.md','CONTRACT.json','scripts/vendor/LICENSE-Acorn.txt']) {
  const to = path.join(dest,file);
  await mkdir(path.dirname(to),{recursive:true}); await cp(path.join(root,file),to,{recursive:true});
}
