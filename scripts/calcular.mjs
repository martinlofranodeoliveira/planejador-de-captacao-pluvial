import { readFile } from 'node:fs/promises';
import { simulate } from '../src/engine.js';
if (process.argv.length !== 3) {
  console.error('Uso: node scripts/calcular.mjs arquivo.json');
  process.exitCode = 2;
} else {
  try {
    const raw = await readFile(process.argv[2], 'utf8');
    console.log(JSON.stringify(simulate(JSON.parse(raw)), null, 2));
  } catch {
    console.error('Cenário indisponível ou inválido. Consulte CONTRACT.json.');
    process.exitCode = 1;
  }
}
