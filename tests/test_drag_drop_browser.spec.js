// Prueft Drag & Drop von IDX-Dateien in einem echten Chromium (nicht jsdom).
// Benoetigt `npx playwright install chromium` und Internetzugang (three.js kommt vom CDN).
const { test, expect } = require('@playwright/test');
const path = require('path');

const NS = 'http://www.prostep.org/ecad-mcad/edmd/4.5/';
const SQUARE = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

function part(id, number) {
  const ptIds = SQUARE.map((_, i) => `P_${id}_${i}`);
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
  ${SQUARE.map((p, i) => `<CartesianPoint id="${ptIds[i]}"><X>${p[0]}</X><Y>${p[1]}</Y></CartesianPoint>`).join('')}`;
}

function instance(uid, name, itemId, x) {
  return `
    <ItemInstance id="${uid}"><Name>${name}</Name><Item>ITEM_${itemId}</Item>
      <Transformation><tx><Value>${x}</Value></tx><ty><Value>0</Value></ty><tz><Value>0</Value></tz></Transformation>
      <AssembleToName>TOP</AssembleToName>
    </ItemInstance>`;
}

const BASELINE = `<?xml version="1.0" encoding="UTF-8"?>
<EDMDDataSet xmlns="${NS}">
  <Header>
    <UserProperty><Key>IDX_MODE</Key><Value>BASELINE</Value></UserProperty>
    <UserProperty><Key>IDX_VERSION</Key><Value>4.5</Value></UserProperty>
  </Header>
  ${part('A', 'PN-A')}
  ${part('B', 'PN-B')}
  <Item id="ITEM_ASM"><ItemType>assembly</ItemType>
    ${instance('ITEM_INST_1', 'R1', 'A', 0)}
    ${instance('ITEM_INST_2', 'R2', 'B', 10)}
  </Item>
</EDMDDataSet>`;

/** Simuliert das Ablegen einer Datei auf dem Fenster ueber ein echtes DataTransfer-Objekt. */
async function dropFile(page, name, content) {
  await page.evaluate(({ name, content }) => {
    const dt = new DataTransfer();
    dt.items.add(new File([content], name, { type: 'application/xml' }));
    const target = document.getElementById('canvas-container');
    target.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, { name, content });
}

test('Baseline per Drag & Drop laden, ungueltige Datei wird abgelehnt', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto(`file://${path.resolve(__dirname, '..', 'idx.html')}`);

  await dropFile(page, 'board.idx', BASELINE);
  await expect(page.locator('.tree-item')).toHaveCount(2);
  await expect(page.locator('#file-stats')).toContainText('Elemente');
  await expect(page.locator('#inc-file-input')).toBeEnabled();

  // Nicht-IDX-Dateien werden ignoriert, kaputte IDX-Dateien abgelehnt, der Stand bleibt erhalten.
  await dropFile(page, 'notes.txt', 'hallo');
  await dropFile(page, 'broken_increment.idx', '<EDMDDataSet><broken>');
  await expect(page.locator('#idx-validation-modal')).toContainText('Es wurde nichts importiert');
  await expect(page.locator('.tree-item')).toHaveCount(2);
});
