import { simulate } from './engine.js';

const el = id => document.getElementById(id);
const format = new Intl.NumberFormat('pt-BR');
const litres = n => format.format(n) + ' L';
const cells = Object.entries({
  capturedL: 'Água captada', servedL: 'Demanda atendida', overflowL: 'Extravasamento',
  shortageL: 'Déficit', finalL: 'Estoque final',
});
const parameters = Array.from(document.querySelectorAll('[data-field]'));
let example;
let demonstration;
let result;
let selected;
let input;
let demoMode;
let dirty = false;

function numberInput(label, value, max, key) {
  const wrapper = document.createElement('label');
  wrapper.textContent = label;
  const field = document.createElement('input');
  Object.assign(field, {type:'number', min:'0', max:String(max), required:true, value:String(value)});
  field.dataset.dayField = key;
  wrapper.append(field);
  return wrapper;
}

function relabelDays() {
  const rows = Array.from(el('days').children);
  rows.forEach((row, i) => {
    row.querySelector('strong').textContent = 'Dia ' + (i + 1);
    row.querySelector('button').setAttribute('aria-label', 'Remover dia ' + (i + 1));
    for (const input of row.querySelectorAll('input')) {
      const field = input.dataset.dayField === 'rainMm' ? 'Chuva em milímetros' : 'Demanda em litros';
      input.setAttribute('aria-label', field + ' no dia ' + (i + 1));
    }
  });
  el('add').disabled = rows.length >= 366;
}

function invalidate() {
  dirty = true;
  el('report').hidden = true;
  el('status').textContent = 'Cenário alterado. Simule para ver o balanço atualizado.';
}

function appendDay(day) {
  const row = document.createElement('div');
  row.className = 'edit-day';
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.textContent = 'Remover';
  remove.addEventListener('click', () => {
    const next = row.nextElementSibling || row.previousElementSibling;
    row.remove();
    relabelDays();
    (next?.querySelector('button') || el('add')).focus();
    invalidate();
  });
  row.append(document.createElement('strong'), numberInput('Chuva (mm)', day.rainMm, 1000, 'rainMm'),
    numberInput('Demanda (L)', day.demandL, 1000000, 'demandL'), remove);
  el('days').append(row);
}

function writeForm(scenario) {
  for (const field of parameters) field.value = scenario[field.dataset.field];
  el('days').replaceChildren();
  for (const day of scenario.days) appendDay(day);
  relabelDays();
}

function readForm() {
  const scenario = {schemaVersion:1};
  for (const field of parameters) scenario[field.dataset.field] = field.valueAsNumber;
  if (scenario.initialL > scenario.capacityL) throw new RangeError('O estoque inicial excede a capacidade da cisterna.');
  scenario.days = Array.from(el('days').children, row =>
    Object.fromEntries(Array.from(row.querySelectorAll('input'), field => [field.dataset.dayField,field.valueAsNumber])));
  return scenario;
}

function setEditor(open) {
  el('editor').hidden = !open;
  el('edit').setAttribute('aria-expanded', String(open));
  el('edit').textContent = open ? 'Fechar editor' : 'Editar cenário';
  if (open) parameters[0].focus();
}

function displayDay() {
  const row = result.rows[selected];
  const stored = row?.storedL ?? result.summary.finalL;
  el('stock').textContent = format.format(stored);
  const pct = 100 * stored / input.capacityL;
  el('fill').style.transform = 'scaleX(' + pct / 100 + ')';
  el('percent').textContent = new Intl.NumberFormat('pt-BR', {maximumFractionDigits:1}).format(pct) + '% da capacidade';
  el('capacity').textContent = litres(input.capacityL) + ' de capacidade';
  el('day-description').textContent = row
    ? 'Chuva de ' + format.format(input.days[selected].rainMm) + ' mm. ' + litres(row.servedL) + ' de ' + litres(input.days[selected].demandL) + ' atendidos.'
    : 'Sem dias na série. A reserva corresponde ao estoque inicial.';
  el('tank-title').textContent = row ? 'Reserva no fim do dia' : 'Reserva inicial';
  Array.from(el('ledger-body').children).forEach((tr, i) => tr.classList.toggle('selected', i === selected));
}

function showReport(scenario, report, isExample, isDemo) {
  input = scenario; result = report; demoMode = isDemo; dirty = false;
  el('report-kind').textContent = isDemo ? 'Relatório de exemplo' : 'Simulação calculada';
  el('scenario-name').textContent = isExample ? 'Horta da escola' : 'Cenário editado';
  el('duration').textContent = result.rows.length + (result.rows.length === 1 ? ' dia' : ' dias');
  selected = Math.min(2, result.rows.length - 1);
  const options = result.rows.map((row, i) => new Option('Dia ' + row.day, String(i)));
  if (!options.length) options.push(new Option('Sem dias', '-1'));
  el('day-choice').replaceChildren(...options);
  el('day-choice').value = String(selected);
  el('day-choice').disabled = !result.rows.length;
  el('totals').replaceChildren(...cells.map(([key, label]) => {
    const group = document.createElement('div');
    const term = document.createElement('dt'); term.textContent = label;
    const value = document.createElement('dd'); value.textContent = litres(result.summary[key]);
    group.append(term, value); return group;
  }));
  const tableRows = result.rows.map((row, i) => {
    const tr = document.createElement('tr');
    const day = document.createElement('th'); day.scope = 'row'; day.textContent = 'Dia ' + row.day; tr.append(day);
    for (const n of [scenario.days[i].rainMm, scenario.days[i].demandL, row.capturedL, row.servedL, row.overflowL, row.shortageL, row.storedL]) {
      const td = document.createElement('td'); td.textContent = format.format(n); tr.append(td);
    }
    return tr;
  });
  el('ledger-body').replaceChildren(...tableRows);
  displayDay();
  el('report').hidden = false;
  el('status').textContent = isDemo ? 'Demonstração com relatório conferido. O cálculo de novos cenários aguarda a implementação do motor.' : '';
}

function openExample() {
  const sample = structuredClone(example);
  writeForm(sample);
  try { showReport(sample, simulate(sample), true, false); }
  catch (error) {
    if (error instanceof TypeError && error.message === 'Motor pendente') showReport(sample, demonstration, true, true);
    else throw error;
  }
}

el('edit').addEventListener('click', () => setEditor(el('editor').hidden));
el('form').addEventListener('input', invalidate);
el('add').addEventListener('click', () => {
  if (el('days').children.length === 366) return;
  appendDay({rainMm:0, demandL:0}); relabelDays(); invalidate();
  el('days').lastElementChild.querySelector('input').focus();
});
el('restore').addEventListener('click', () => { openExample(); setEditor(false); el('edit').focus(); });
el('form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const scenario = readForm();
    showReport(scenario, simulate(scenario), false, false);
    setEditor(false); el('edit').focus();
  } catch (error) {
    el('status').textContent = error.message === 'Motor pendente'
      ? 'Motor pendente. O cálculo deste cenário fica disponível após a implementação. Você pode restaurar o exemplo.'
      : error.message;
  }
});
el('day-choice').addEventListener('change', () => { selected = Number(el('day-choice').value); displayDay(); });
el('export').addEventListener('click', () => {
  if (dirty || !result) return;
  const data = {format:'caderno-pluvial-v1', origem:demoMode ? 'exemplo-conferido' : 'simulacao', cenario:input, resultado:result};
  const url = URL.createObjectURL(new Blob([JSON.stringify(data,null,2) + '\n'], {type:'application/json'}));
  const link = document.createElement('a'); link.href = url; link.download = 'balanco-pluvial.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

async function loadFile(name) {
  const response = await fetch('./examples/' + name + '.json');
  if (!response.ok) throw new Error('Falha ao abrir o exemplo');
  return response.json();
}
el('edit').disabled = true;
try {
  [example, demonstration] = await Promise.all([loadFile('cenario'),loadFile('relatorio')]);
  openExample(); el('edit').disabled = false;
} catch {
  el('status').textContent = 'Falha ao carregar a demonstração. Abra esta página pelo servidor local indicado no README.';
}
