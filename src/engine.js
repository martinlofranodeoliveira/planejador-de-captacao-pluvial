function assertPlainObject(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Valor deve ser um objeto JSON");
  }
}

function assertRootKeys(root) {
  if (
    !Object.hasOwn(root, "schemaVersion") ||
    !Object.hasOwn(root, "areaM2") ||
    !Object.hasOwn(root, "efficiencyPct") ||
    !Object.hasOwn(root, "capacityL") ||
    !Object.hasOwn(root, "initialL") ||
    !Object.hasOwn(root, "days")
  ) {
    throw new TypeError("Objeto raiz com chaves obrigatorias ausentes");
  }
  const keys = Object.keys(root);
  if (keys.length !== 6) {
    throw new TypeError("Objeto raiz deve conter exatamente seis chaves");
  }
  for (const key of keys) {
    if (
      key !== "schemaVersion" &&
      key !== "areaM2" &&
      key !== "efficiencyPct" &&
      key !== "capacityL" &&
      key !== "initialL" &&
      key !== "days"
    ) {
      throw new TypeError("Objeto raiz contem chave nao permitida");
    }
  }
}

function assertDayKeys(dayItem) {
  if (!Object.hasOwn(dayItem, "rainMm") || !Object.hasOwn(dayItem, "demandL")) {
    throw new TypeError("Item de days com chaves obrigatorias ausentes");
  }
  const keys = Object.keys(dayItem);
  if (keys.length !== 2) {
    throw new TypeError("Item de days deve conter exatamente duas chaves");
  }
  for (const key of keys) {
    if (key !== "rainMm" && key !== "demandL") {
      throw new TypeError("Item de days contem chave nao permitida");
    }
  }
}

function readIntegerInRange(value, min, max) {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new TypeError("Valor deve ser um numero inteiro");
  }
  if (value < min || value > max) {
    throw new RangeError("Valor fora do intervalo permitido");
  }
  if (value === 0) {
    return 0;
  }
  return value;
}

export function simulate(document) {
  assertPlainObject(document);
  assertRootKeys(document);

  readIntegerInRange(document.schemaVersion, 1, 1);
  const areaM2 = readIntegerInRange(document.areaM2, 1, 10000);
  const efficiencyPct = readIntegerInRange(document.efficiencyPct, 0, 100);
  const capacityL = readIntegerInRange(document.capacityL, 1, 1000000);
  const initialL = readIntegerInRange(document.initialL, 0, capacityL);

  const days = document.days;
  if (!Array.isArray(days)) {
    throw new TypeError("days deve ser um array");
  }
  if (days.length > 366) {
    throw new RangeError("days excede o limite de 366 itens");
  }

  const rows = [];
  let stock = initialL;
  let totalCapturedL = 0;
  let totalServedL = 0;
  let totalShortageL = 0;
  let totalOverflowL = 0;
  let dayNumber = 0;

  for (const dayItem of days) {
    assertPlainObject(dayItem);
    assertDayKeys(dayItem);

    const rainMm = readIntegerInRange(dayItem.rainMm, 0, 1000);
    const demandL = readIntegerInRange(dayItem.demandL, 0, 1000000);

    dayNumber += 1;

    const capturedL = Math.floor((areaM2 * rainMm * efficiencyPct) / 100);
    const volume = stock + capturedL;
    const overflowL = Math.max(0, volume - capacityL);
    const available = volume - overflowL;
    const servedL = Math.min(demandL, available);
    const shortageL = demandL - servedL;
    const storedL = available - servedL;

    stock = storedL;
    totalCapturedL += capturedL;
    totalServedL += servedL;
    totalShortageL += shortageL;
    totalOverflowL += overflowL;

    rows.push({
      day: dayNumber,
      capturedL: capturedL,
      overflowL: overflowL,
      servedL: servedL,
      shortageL: shortageL,
      storedL: storedL
    });
  }

  return {
    schemaVersion: 1,
    rows: rows,
    summary: {
      capturedL: totalCapturedL,
      servedL: totalServedL,
      shortageL: totalShortageL,
      overflowL: totalOverflowL,
      finalL: stock
    }
  };
}
