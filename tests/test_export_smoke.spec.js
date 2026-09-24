const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SOURCE_PATH = path.resolve(__dirname, '..', 'idx.html');
const source = fs.readFileSync(SOURCE_PATH, 'utf8');
const NS = 'http://www.prostep.org/ecad-mcad/edmd/4.5/';

/**
 * Minimale Three.js-Attrappe. Der Smoke-Test prueft die Daten- und Exportlogik,
 * nicht das Rendering - WebGL steht unter jsdom nicht zur Verfuegung.
 */
function installThreeStub(window) {
  const vec = () => ({ x: 0, y: 0, z: 0, set() { return this; }, copy() { return this; } });
  class Obj3D {
    constructor() {
      this.children = []; this.userData = {}; this.visible = true;
      this.position = vec(); this.rotation = vec(); this.scale = vec();
      this.castShadow = false; this.receiveShadow = false;
    }
    add(child) { this.children.push(child); return this; }
    remove(child) { const i = this.children.indexOf(child); if (i > -1) this.children.splice(i, 1); return this; }
    updateMatrixWorld() {}
    traverse(fn) { fn(this); this.children.forEach(c => c.traverse && c.traverse(fn)); }
  }
  class Shape {
    constructor() { this.holes = []; this.curves = []; }
    moveTo() {} lineTo() {} closePath() {} absarc() {}
  }
  const Geometry = class { computeVertexNormals() {} dispose() {} };
  window.THREE = {
    Scene: Obj3D, Group: Obj3D, Mesh: Obj3D, LineSegments: Obj3D,
    AmbientLight: Obj3D, DirectionalLight: Obj3D,
    PerspectiveCamera: class extends Obj3D { updateProjectionMatrix() {} },
    WebGLRenderer: class {
      constructor() { this.shadowMap = {}; this.domElement = window.document.createElement('canvas'); }
      setSize() {} render() {} setPixelRatio() {}
    },
    OrbitControls: class { constructor() { this.target = vec(); } update() {} },
    Color: class {}, Shape, Path: Shape,
    ExtrudeGeometry: Geometry, EdgesGeometry: Geometry, BoxGeometry: Geometry,
    MeshStandardMaterial: class { constructor(o) { Object.assign(this, o); } dispose() {} },
    LineBasicMaterial: class { constructor(o) { Object.assign(this, o); } dispose() {} },
    Vector2: class { constructor(x = 0, y = 0) { this.x = x; this.y = y; } set(x, y) { this.x = x; this.y = y; return this; } },
    Vector3: class { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } },
    Raycaster: class { setFromCamera() {} intersectObjects() { return []; } },
    Box3: class {
      constructor() { this.min = vec(); this.max = vec(); }
      expandByObject() { return this; }
      getCenter() { return vec(); }
      getSize() { return { x: 10, y: 10, z: 10 }; }
      setFromObject() { return this; }
    },
    OBJLoader: class { parse() { return new Obj3D(); } }
  };
}

/** Laedt idx.html in jsdom und fuehrt den Hauptskriptblock aus. */
function loadViewer() {
  const dom = new JSDOM(source, { runScripts: 'outside-only', url: 'https://example.invalid/' });
  const { window } = dom;
  installThreeStub(window);
  window.requestAnimationFrame = () => 0;
  window.cancelAnimationFrame = () => {};
  window.alert = msg => { window.__alerts.push(String(msg)); };
  window.confirm = () => true;
  window.__alerts = [];
  window.__downloads = [];
  window.Blob = class { constructor(parts) { this.parts = parts; } };
  window.URL.createObjectURL = blob => { window.__lastBlob = blob; return 'blob:stub'; };
  window.URL.revokeObjectURL = () => {};
  const origCreate = window.document.createElement.bind(window.document);
  window.document.createElement = tag => {
    const el = origCreate(tag);
    if (String(tag).toLowerCase() === 'a') {
      el.click = () => window.__downloads.push({ name: el.download, xml: window.__lastBlob.parts[0] });
    }
    return el;
  };

  const match = source.match(/<script id="main-script">([\s\S]*?)<\/script>/);
  expect(match).toBeTruthy();
  // Direktes eval im selben Scope: let/const des Skriptblocks sind sonst von aussen unsichtbar.
  window.eval(match[1] + '\n;window.__run = function (code) { return eval(code); };');
  return window;
}

function part(id, number, pts) {
  const ptIds = pts.map((p, i) => `P_${id}_${i}`);
  return `
  <Item id="ITEM_${id}"><ItemType>single</ItemType><Shape>SHP_${id}</Shape>
    <Identifier><Number>${number}</Number></Identifier></Item>
  <AssemblyComponent id="SHP_${id}"><ShapeElement>SE_${id}</ShapeElement></AssemblyComponent>
  <ShapeElement id="SE_${id}"><DefiningShape>CS_${id}</DefiningShape></ShapeElement>
  <CurveSet2d id="CS_${id}">
    <LowerBound><Value>0</Value></LowerBound><UpperBound><Value>2</Value></UpperBound>
    <DetailedGeometricModelElement>PL_${id}</DetailedGeometricModelElement>
  </CurveSet2d>
  <PolyLine id="PL_${id}">${ptIds.map(p => `<Point>${p}</Point>`).join('')}<Point>${ptIds[0]}</Point></PolyLine>
  ${pts.map((p, i) => `<CartesianPoint id="${ptIds[i]}"><X>${p[0]}</X><Y>${p[1]}</Y></CartesianPoint>`).join('')}`;
}

const SQUARE = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

function instance(uid, name, itemId, x) {
  return `
    <ItemInstance id="${uid}">
      <Name>${name}</Name>
      <Item>ITEM_${itemId}</Item>
      <Transformation>
        <tx><Value>${x}</Value></tx><ty><Value>0</Value></ty><tz><Value>0</Value></tz>
      </Transformation>
      <AssembleToName>TOP</AssembleToName>
    </ItemInstance>`;
}

/** Synthetische, gueltige Baseline mit drei Bauteilen (keine *.idx-Datei wegen .gitignore). */
function buildBaseline() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<EDMDDataSet xmlns="${NS}"
  xmlns:pdm="http://schema.prostep.org/edmd/pdm"
  xmlns:foundation="http://schema.prostep.org/edmd/foundation"
  xmlns:property="http://schema.prostep.org/edmd/property"
  xmlns:computational="http://schema.prostep.org/edmd/computational"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Header>
    <UserProperty><Key>IDX_MODE</Key><Value>BASELINE</Value></UserProperty>
    <UserProperty><Key>IDX_VERSION</Key><Value>4.5</Value></UserProperty>
  </Header>
  ${part('A', 'PN-A', SQUARE)}
  ${part('B', 'PN-B', SQUARE)}
  ${part('C', 'PN-C', SQUARE)}
  <Item id="ITEM_ASM"><ItemType>assembly</ItemType>
    ${instance('ITEM_INST_1', 'R1', 'A', 0)}
    ${instance('ITEM_INST_2', 'R2', 'B', 10)}
    ${instance('ITEM_INST_3', 'R3', 'C', 20)}
  </Item>
</EDMDDataSet>`;
}

function setup() {
  const window = loadViewer();
  const xml = buildBaseline();
  const validateIDXText = window.__run('validateIDXText');
  const validation = validateIDXText(xml, { kind: 'baseline', fileName: 'smoke.idx' });
  expect(validation.errors).toEqual([]);

  window.__validation = validation;
  window.__run('processIDX')(xml, validation.document);
  // Zustand setzen wie im Baseline-Handler nach erfolgreichem Import.
  window.__run(`
    originalXmlDoc = window.__validation.document;
    originalFileName = "smoke.idx";
    baselineComponents = JSON.parse(JSON.stringify(allComponents));
    window.allComponents = allComponents;
    build3DScene(allComponents, window.lastBoardThickness || 1.6);
  `);
  return window;
}

function treeUids(window) {
  return Array.from(window.document.querySelectorAll('#components-list .tree-item')).map(el => el.dataset.uid);
}

function exportedInstances(xmlText, window) {
  const doc = new window.DOMParser().parseFromString(xmlText, 'application/xml');
  return Array.from(doc.getElementsByTagNameNS('*', 'ItemInstance')).map(el => ({
    id: el.getAttribute('id'),
    name: el.getElementsByTagNameNS('*', 'Name')[0]?.textContent
  }));
}

test('Baseline laedt, Baum enthaelt alle Instanzen', () => {
  const window = setup();
  expect(treeUids(window)).toEqual(['ITEM_INST_1', 'ITEM_INST_2', 'ITEM_INST_3']);
});

test('Umsortierter Baum wird in den Baseline-Export uebernommen', () => {
  const window = setup();
  const list = window.document.getElementById('components-list');
  const items = Array.from(list.querySelectorAll('.tree-item'));
  list.insertBefore(items[2], items[0]); // R3 nach vorne
  window.__run('captureTreeOrder()');
  expect(treeUids(window)).toEqual(['ITEM_INST_3', 'ITEM_INST_1', 'ITEM_INST_2']);

  window.document.getElementById('export-btn').click();
  expect(window.__downloads).toHaveLength(1);
  const insts = exportedInstances(window.__downloads[0].xml, window);
  expect(insts.map(i => i.name)).toEqual(['R3', 'R1', 'R2']);
  // Ohne Checkbox bleiben die Original-IDs erhalten.
  expect(insts.map(i => i.id)).toEqual(['ITEM_INST_3', 'ITEM_INST_1', 'ITEM_INST_2']);
});

test('Baumreihenfolge ueberlebt den Neuaufbau des Baums', async () => {
  const window = setup();
  const list = window.document.getElementById('components-list');
  const items = Array.from(list.querySelectorAll('.tree-item'));
  list.insertBefore(items[2], items[0]);
  window.__run('captureTreeOrder()');

  window.__run('build3DScene(allComponents, window.lastBoardThickness || 1.6)');
  expect(treeUids(window)).toEqual(['ITEM_INST_3', 'ITEM_INST_1', 'ITEM_INST_2']);
});

test('Checkbox "IDs neu nummerieren" vergibt ITEM_INST_n nach Baumreihenfolge', () => {
  const window = setup();
  const list = window.document.getElementById('components-list');
  const items = Array.from(list.querySelectorAll('.tree-item'));
  list.insertBefore(items[2], items[0]);
  window.__run('captureTreeOrder()');

  window.document.getElementById('renumber-ids-toggle').checked = true;
  window.document.getElementById('export-btn').click();

  const insts = exportedInstances(window.__downloads[0].xml, window);
  expect(insts.map(i => i.name)).toEqual(['R3', 'R1', 'R2']);
  expect(insts.map(i => i.id)).toEqual(['ITEM_INST_1', 'ITEM_INST_2', 'ITEM_INST_3']);
  expect(window.lastBaselineRenumber).toBeTruthy();
  // Interner Zustand bleibt unveraendert - nur die Exportkopie wird umnummeriert.
  expect(window.allComponents.map(c => c.uid).sort()).toEqual(['ITEM_INST_1', 'ITEM_INST_2', 'ITEM_INST_3']);
});

test('MCAD-Namen werden nur bei aktiver Checkbox in die Exportkopie geschrieben', () => {
  const window = setup();
  window.__run('hintMap = { "R1": "MCAD_R1" }; useMCADNames = true;');
  const exportToggle = window.document.getElementById('mcad-export-toggle');
  exportToggle.disabled = false;

  exportToggle.checked = false;
  window.document.getElementById('export-btn').click();
  expect(exportedInstances(window.__downloads[0].xml, window).map(i => i.name)).toEqual(['R1', 'R2', 'R3']);

  exportToggle.checked = true;
  window.document.getElementById('export-btn').click();
  expect(exportedInstances(window.__downloads[1].xml, window).map(i => i.name)).toEqual(['MCAD_R1', 'R2', 'R3']);

  // Der interne Zustand traegt weiterhin den Originalnamen.
  expect(window.allComponents.find(c => c.uid === 'ITEM_INST_1').name).toBe('R1');
});

test('Increment-Export nutzt die Baumreihenfolge und die Abbildung des Baseline-Exports', () => {
  const window = setup();
  const list = window.document.getElementById('components-list');
  const items = Array.from(list.querySelectorAll('.tree-item'));
  list.insertBefore(items[2], items[0]);
  window.__run('captureTreeOrder()');

  // Eine Komponente verschieben, damit es ueberhaupt etwas zu exportieren gibt.
  window.__run(`
    const c = allComponents.find(x => x.uid === "ITEM_INST_1");
    c.x = 42; c.isModified = true;
  `);

  window.document.getElementById('renumber-ids-toggle').checked = true;
  window.document.getElementById('export-btn').click();
  window.document.getElementById('export-inc-btn').click();

  expect(window.__downloads).toHaveLength(2);
  const incInsts = exportedInstances(window.__downloads[1].xml, window);
  // ITEM_INST_1 steht in der Baumreihenfolge an Position 2 -> ITEM_INST_2.
  expect(incInsts.map(i => i.id)).toContain('ITEM_INST_2');
  expect(incInsts.map(i => i.id)).not.toContain('ITEM_INST_1');
});

test('Increment-Export ohne Aenderungen meldet "Keine neuen Änderungen!"', () => {
  const window = setup();
  window.document.getElementById('export-inc-btn').click();
  expect(window.__alerts.join('\n')).toContain('Keine neuen Änderungen!');
  expect(window.__downloads).toHaveLength(0);
});

test('Export ohne geladene Baseline erzeugt keine Datei', () => {
  const window = loadViewer();
  window.document.getElementById('export-btn').click();
  window.document.getElementById('export-inc-btn').click();
  expect(window.__downloads).toHaveLength(0);
});

test('Baseline-Handler setzt Baumreihenfolge und Renumber-Abbildung zurueck', () => {
  const handlerStart = source.indexOf("document.getElementById('file-input').addEventListener");
  const handlerEnd = source.indexOf("document.getElementById('inc-file-input').addEventListener", handlerStart);
  const handler = source.slice(handlerStart, handlerEnd);

  expect(source).toContain('function resetManualSessionState');
  expect(handler).toContain('resetManualSessionState();');
  // Zuruecksetzen erst nach erfolgreicher Validierung, innerhalb des try-Blocks.
  expect(handler.indexOf('resetManualSessionState();')).toBeGreaterThan(handler.indexOf('validation.valid'));
  // Rollback stellt den alten Zustand wieder her.
  expect(handler).toContain('window.lastBaselineRenumber = previousState.lastBaselineRenumber;');
  expect(handler).toContain('window.manualTreeOrder = previousState.manualTreeOrder;');
});

test('Bereits geladene Increments werden nicht doppelt angehaengt', () => {
  const start = source.indexOf("document.getElementById('inc-file-input').addEventListener");
  const end = source.indexOf('function toggleAccordion', start);
  const handler = source.slice(start, end);

  expect(handler).toContain('const knownXml = new Set(incrementHistory.map(entry => entry.xml));');
  expect(handler).toContain('const newHistoryEntries = newFiles.map(entry => ({');
  expect(handler).toContain('incrementHistory = previousState.incrementHistory.concat(newHistoryEntries)');
  expect(handler).toContain('Bereits geladen und daher übersprungen');
});
