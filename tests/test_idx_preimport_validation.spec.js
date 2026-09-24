const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const SOURCE_PATH = path.resolve(__dirname, '..', 'idx.html');
const source = fs.readFileSync(SOURCE_PATH, 'utf8');

/**
 * Schneidet den Validierungsblock aus idx.html heraus, damit er ohne die
 * komplette Viewer-Initialisierung (Three.js, WebGL) geprueft werden kann.
 */
function extractValidationBlock() {
  const start = source.indexOf('// --- IDX VALIDATION');
  const end = source.indexOf('// --- 3. INPUT HANDLERS ---');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

function loadValidator() {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const block = extractValidationBlock().replace(/window\.validateIDXText\s*=\s*validateIDXText;/, '');
  const factory = new Function('window', 'document', 'DOMParser', `${block}\nreturn { validateIDXText, collectIDXIds };`);
  return factory(dom.window, dom.window.document, dom.window.DOMParser);
}

const NS = 'http://www.prostep.org/ecad-mcad/edmd/4.5/';

function buildIDX({ mode = 'BASELINE', version = '4.5', body = '', header = true } = {}) {
  const headerXml = header
    ? `<Header>
         <UserProperty><Key>IDX_MODE</Key><Value>${mode}</Value></UserProperty>
         <UserProperty><Key>IDX_VERSION</Key><Value>${version}</Value></UserProperty>
       </Header>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<EDMDDataSet xmlns="${NS}">
  ${headerXml}
  ${body}
</EDMDDataSet>`;
}

const BASELINE_BODY = `
  <Item id="ITEM_ASM"><ItemType>assembly</ItemType></Item>
  <Item id="ITEM_1"><ItemType>single</ItemType></Item>
  <ItemInstance id="ITEM_INST_1"><Item>ITEM_1</Item></ItemInstance>
  <CurveSet2d id="CS_1"/>
`;

test('Validierungsblock und Import-Handler sind korrekt verdrahtet', () => {
  const incrementStart = source.indexOf("document.getElementById('inc-file-input').addEventListener");
  const incrementEnd = source.indexOf('function toggleAccordion', incrementStart);
  const handler = source.slice(incrementStart, incrementEnd);

  expect(source).toContain('function validateIDXText');
  expect(source).toContain('parsererror');
  expect(source).toContain('EDMDDataSet');
  expect(source).toContain('Nicht auflösbare IDX-Referenzen');
  expect(source).toContain('validatedDocument || new DOMParser()');

  // Validierung laeuft vor jeder Zustandsaenderung und vor dem Ladebalken.
  expect(handler.indexOf('validateIDXText')).toBeGreaterThan(-1);
  expect(handler.indexOf('some(entry => !entry.validation.valid)')).toBeGreaterThan(
    handler.indexOf('validateIDXText')
  );
  expect(handler.indexOf("document.getElementById('loading').style.display = 'block'")).toBeGreaterThan(
    handler.indexOf('some(entry => !entry.validation.valid)')
  );
  expect(handler.indexOf('incrementHistory = previousState.incrementHistory.concat(newHistoryEntries)')).toBeGreaterThan(
    handler.indexOf('some(entry => !entry.validation.valid)')
  );

  // Auch der Baseline-Handler validiert vor dem Import.
  const baselineStart = source.indexOf("document.getElementById('file-input').addEventListener");
  const baselineHandler = source.slice(baselineStart, incrementStart);
  expect(baselineHandler.indexOf('validateIDXText')).toBeGreaterThan(-1);
  expect(baselineHandler.indexOf('processIDX(')).toBeGreaterThan(baselineHandler.indexOf('validateIDXText'));
});

test('validateIDXText akzeptiert eine gueltige Baseline', () => {
  const { validateIDXText } = loadValidator();
  const result = validateIDXText(buildIDX({ body: BASELINE_BODY }), { kind: 'baseline', fileName: 'board.idx' });
  expect(result.errors).toEqual([]);
  expect(result.valid).toBe(true);
  expect(result.document).not.toBeNull();
  expect(result.metadata.idxMode).toBe('BASELINE');
  expect(result.metadata.idxVersion).toBe('4.5');
});

test('validateIDXText lehnt nicht wohlgeformtes XML ab', () => {
  const { validateIDXText } = loadValidator();
  const result = validateIDXText('<EDMDDataSet><broken>', { kind: 'baseline', fileName: 'board.idx' });
  expect(result.valid).toBe(false);
  expect(result.errors.join(' ')).toContain('nicht wohlgeformt');
  expect(result.document).toBeNull();
});

test('validateIDXText lehnt HTML, leere Dateien und falsche Endungen ab', () => {
  const { validateIDXText } = loadValidator();

  const html = validateIDXText('<!doctype html><html><body>Fehlerseite</body></html>', { kind: 'baseline', fileName: 'board.idx' });
  expect(html.valid).toBe(false);
  expect(html.errors.join(' ')).toContain('HTML statt eines IDX-Dokuments');

  const empty = validateIDXText('   ', { kind: 'baseline', fileName: 'board.idx' });
  expect(empty.valid).toBe(false);
  expect(empty.errors.join(' ')).toContain('leer');

  const wrongExtension = validateIDXText(buildIDX({ body: BASELINE_BODY }), { kind: 'baseline', fileName: 'board.txt' });
  expect(wrongExtension.valid).toBe(false);
  expect(wrongExtension.errors.join(' ')).toContain('Endung .idx');

  // Der interne Viewer unterstuetzt auch .xml, daher darf diese Endung nicht blockieren.
  const xmlExtension = validateIDXText(buildIDX({ body: BASELINE_BODY }), { kind: 'baseline', fileName: 'board.xml' });
  expect(xmlExtension.errors).toEqual([]);
  expect(xmlExtension.valid).toBe(true);
});

test('validateIDXText lehnt falsches Wurzelelement und fehlenden Namensraum ab', () => {
  const { validateIDXText } = loadValidator();

  const wrongRoot = validateIDXText(`<?xml version="1.0"?><SomethingElse xmlns="${NS}"/>`, { kind: 'baseline', fileName: 'board.idx' });
  expect(wrongRoot.valid).toBe(false);
  expect(wrongRoot.errors.join(' ')).toContain('EDMDDataSet');

  const noNamespace = validateIDXText(
    `<?xml version="1.0"?><EDMDDataSet>${BASELINE_BODY}</EDMDDataSet>`,
    { kind: 'baseline', fileName: 'board.idx' }
  );
  expect(noNamespace.valid).toBe(false);
  expect(noNamespace.errors.join(' ')).toContain('PROSTEP-EDMD/IDX-Namensraum');
});

test('validateIDXText meldet fehlende Header-Eigenschaften und Baseline-Struktur', () => {
  const { validateIDXText } = loadValidator();

  const noHeader = validateIDXText(buildIDX({ body: BASELINE_BODY, header: false }), { kind: 'baseline', fileName: 'board.idx' });
  expect(noHeader.valid).toBe(false);
  expect(noHeader.errors.join(' ')).toContain('IDX-Header fehlt');
  expect(noHeader.errors.join(' ')).toContain('IDX_MODE');

  const noAssembly = validateIDXText(
    buildIDX({ body: '<Item id="ITEM_1"><ItemType>single</ItemType></Item><CurveSet2d id="CS_1"/>' }),
    { kind: 'baseline', fileName: 'board.idx' }
  );
  expect(noAssembly.valid).toBe(false);
  expect(noAssembly.errors.join(' ')).toContain('keine IDX-Assembly');
  expect(noAssembly.errors.join(' ')).toContain('keine ItemInstance-Elemente');
});

test('validateIDXText erkennt unaufloesbare Referenzen und akzeptiert sie mit Baseline-Kontext', () => {
  const { validateIDXText } = loadValidator();

  const incrementBody = `
    <ChangeRelation><PredecessorItem>ITEM_1</PredecessorItem></ChangeRelation>
    <ItemInstance id="ITEM_INST_9"><Item>ITEM_UNBEKANNT</Item></ItemInstance>
  `;
  const standalone = validateIDXText(buildIDX({ mode: 'INCREMENTAL', body: incrementBody }), {
    kind: 'increment', fileName: 'inc.idx'
  });
  expect(standalone.valid).toBe(false);
  expect(standalone.errors.join(' ')).toContain('Nicht auflösbare IDX-Referenzen');

  // Mit der Baseline als Referenzdokument ist dieselbe Referenz aufloesbar.
  const baseline = validateIDXText(buildIDX({ body: `${BASELINE_BODY}<Item id="ITEM_UNBEKANNT"><ItemType>single</ItemType></Item>` }), {
    kind: 'baseline', fileName: 'board.idx'
  });
  expect(baseline.valid).toBe(true);

  const withBaseline = validateIDXText(buildIDX({ mode: 'INCREMENTAL', body: incrementBody }), {
    kind: 'increment', fileName: 'inc.idx', baselineDocument: baseline.document
  });
  expect(withBaseline.errors).toEqual([]);
  expect(withBaseline.valid).toBe(true);
});

test('validateIDXText lehnt Increments ohne Aenderungsobjekte ab', () => {
  const { validateIDXText } = loadValidator();
  const result = validateIDXText(buildIDX({ mode: 'INCREMENTAL', body: '<Item id="ITEM_1"><ItemType>single</ItemType></Item>' }), {
    kind: 'increment', fileName: 'inc.idx'
  });
  expect(result.valid).toBe(false);
  expect(result.errors.join(' ')).toContain('keine vom Viewer unterstützten Increment-Änderungen');
});

test('validateIDXText warnt statt zu blockieren bei doppelten IDs und abweichendem IDX_MODE', () => {
  const { validateIDXText } = loadValidator();
  const body = `
    <Item id="ITEM_ASM"><ItemType>assembly</ItemType></Item>
    <Item id="ITEM_1"><ItemType>single</ItemType></Item>
    <ItemInstance id="DUP"><Item>ITEM_1</Item></ItemInstance>
    <ItemInstance id="DUP"><Item>ITEM_1</Item></ItemInstance>
    <CurveSet2d id="CS_1"/>
  `;
  const result = validateIDXText(buildIDX({ mode: 'INCREMENTAL', body }), { kind: 'baseline', fileName: 'board.idx' });
  expect(result.valid).toBe(true);
  expect(result.warnings.join(' ')).toContain('mehrfach verwendete ID');
  expect(result.warnings.join(' ')).toContain('IDX_MODE');
});

test('validateIDXText lehnt ungueltige Zahlenwerte in Transformationen ab', () => {
  const { validateIDXText } = loadValidator();
  const body = `${BASELINE_BODY}<Transformation><tx><Value>abc</Value></tx></Transformation>`;
  const result = validateIDXText(buildIDX({ body }), { kind: 'baseline', fileName: 'board.idx' });
  expect(result.valid).toBe(false);
  expect(result.errors.join(' ')).toContain('Ungültiger Zahlenwert in tx');
});
