const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

for (const relativePath of ['idx.html', 'main_script_fixed.js']) {
  test(`IDX files are validated before import state changes in ${relativePath}`, () => {
    const source = fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
    const incrementStart = source.indexOf("document.getElementById('inc-file-input').addEventListener");
    const incrementEnd = source.indexOf('function toggleAccordion', incrementStart);
    const handler = source.slice(incrementStart, incrementEnd);

    expect(source).toContain('function validateIDXText');
    expect(source).toContain('parsererror');
    expect(source).toContain('EDMDDataSet');
    expect(source).toContain('Nicht auflösbare IDX-Referenzen');
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
    expect(source).toContain('validatedDocument || new DOMParser()');
  });
}

test('an invalid increment leaves the loaded model and timeline unchanged', async ({ page }) => {
  test.setTimeout(60000);
  const baselinePath = path.resolve(__dirname, '..', 'examples', 'template.idx');
  test.skip(!fs.existsSync(baselinePath), 'Local IDX example files are not part of the deployment repository.');
  await page.goto(`file://${path.resolve(__dirname, '..', 'idx.html')}`);

  await page.setInputFiles('#file-input', baselinePath);
  await expect(page.locator('.tree-item')).toHaveCount(49);

  await page.setInputFiles(
    '#inc-file-input',
    path.resolve(__dirname, '..', 'examples', 'template_increment_1.idx')
  );
  await expect(page.locator('.history-bubble')).toHaveCount(3);

  await page.setInputFiles(
    '#inc-file-input',
    path.resolve(__dirname, '..', 'examples', 'template_increment_2.idx')
  );
  await expect(page.locator('.history-bubble')).toHaveCount(4);
  await expect(page.locator('.history-bubble')).toContainText([
    'Base',
    'template_increment_1.idx',
    'template_increment_2.idx',
    'Aktuell'
  ]);

  const before = {
    rows: await page.locator('.tree-item').count(),
    bubbles: await page.locator('.history-bubble').allTextContents(),
    stats: await page.locator('#file-stats').textContent()
  };

  await page.setInputFiles(
    '#inc-file-input',
    path.resolve(__dirname, 'fixtures', 'malformed_increment.txt')
  );
  await expect(page.locator('#idx-validation-modal')).toContainText('Es wurde nichts importiert.');
  await expect(page.locator('#idx-validation-modal')).toContainText('Das XML ist nicht wohlgeformt');

  expect(await page.locator('.tree-item').count()).toBe(before.rows);
  expect(await page.locator('.history-bubble').allTextContents()).toEqual(before.bubbles);
  expect(await page.locator('#file-stats').textContent()).toBe(before.stats);
});
