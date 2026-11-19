import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { simulate } from '../src/engine.js';
const sample=JSON.parse(readFileSync(new URL('../CONTRACT.json',import.meta.url),'utf8'));
test('public contract example',()=>assert.deepEqual(simulate(sample.input),sample.output));
test('returns independent values and preserves input',()=>{
  const before=structuredClone(sample.input);
  const a=simulate(sample.input), b=simulate(sample.input);
  assert.notEqual(a,b); assert.notEqual(a.rows,b.rows); assert.deepEqual(a,b); assert.deepEqual(sample.input,before);
});
test('external resources omitted from user interface',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/lang="pt-BR"/);assert.doesNotMatch(html,/<(?:script|link)[^>]*(?:src|href)=["']https?:/);
  assert.match(html,/<label/);assert.match(html,/<main/);
});
test('example driver rejects unknown schema',()=>assert.throws(()=>simulate({...sample.input,schemaVersion:2})));
test('root object is closed',()=>assert.throws(()=>simulate({...sample.input,extra:'x'})));
test('example JSON is processable',()=>{
  const data=JSON.parse(readFileSync(new URL('../examples/cenario.json',import.meta.url),'utf8'));
  assert.ok(Array.isArray(simulate(data).rows));
});
test('no days preserves opening storage',()=>{
 const {rows,summary}=simulate({...sample.input,initialL:17,days:[]});
 assert.deepEqual(rows,[]);assert.equal(summary.finalL,17);assert.equal(summary.capturedL,0);
});
test('invalid efficiency rejected',()=>assert.throws(()=>simulate({...sample.input,efficiencyPct:101})));
test('a semana da horta reproduz integralmente o relatório de exemplo', () => {
  const example = name => JSON.parse(readFileSync(new URL('../examples/' + name, import.meta.url)));
  assert.deepEqual(simulate(example('cenario.json')), example('relatorio.json'));
});
test('arredonda a captação separadamente por dia', () => {
  const days = Array.from({ length: 3 }, () => ({ rainMm: 1, demandL: 0 }));
  const report = simulate({ ...sample.input, areaM2: 1, efficiencyPct: 50, days });
  assert.equal(report.summary.capturedL, 0);
  assert.equal(report.summary.finalL, sample.input.initialL);
});
test('rejeita chaves desconhecidas e tipos incorretos nos dias', () => {
  for (const day of [{rainMm: '8', demandL: 1}, {rainMm: 8, demandL: 1, extra: true}]) {
    assert.throws(() => simulate({ ...sample.input, days: [day] }));
  }
});
