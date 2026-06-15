const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

test('test auto macro script', async ({ page }) => {
  test.setTimeout(60000); // Increase test timeout
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => {
    console.log('PAGE ERROR:', err.message);
    console.log('PAGE ERROR STACK:', err.stack);
  });

  const filePath = 'file://' + path.resolve(__dirname, '../idx.html');
  await page.goto(filePath);

  // Load Baseline
  const baselinePath = path.resolve(__dirname, '../DAT_IDX_71695356_A_filtered (1).idx');
  await page.setInputFiles('#file-input', baselinePath);
  await page.waitForSelector('.tree-item');

  // Load Hint Map programmatically to avoid waiting for UI interaction during macro
  const hintmapPath = path.resolve(__dirname, '../ecad/ecad_hint.map');
  await page.setInputFiles('#hintmap-input', hintmapPath);
  await page.waitForTimeout(1000);

  // Load macro content and inject it directly to skip the loadhintmap() and sleep
  let macroText = fs.readFileSync(path.resolve(__dirname, '../ecad/auto_process.txt'), 'utf8');
  // Remove loadhintmap and sleep(8000) for testing
  macroText = macroText.replace('loadhintmap()', '// loadhintmap bypassed in test');
  macroText = macroText.replace('sleep(8000)', '// sleep bypassed in test');

  // Prevent actual file download in test, just verify it gets called
  await page.evaluate(() => {
     window.exportCalled = false;
     const originalClick = HTMLAnchorElement.prototype.click;
     HTMLAnchorElement.prototype.click = function() {
        if (this.download && this.download.includes('_filtered')) {
            window.exportCalled = true;
            console.log("Download intercepted:", this.download);
        } else {
            originalClick.apply(this);
        }
     };
  });

  await page.evaluate((text) => {
    document.getElementById('macro-input').value = text;
    console.log("Macro text set");
    document.getElementById('run-macro-btn').click();
  }, macroText);

  // The script contains several sleeps totaling around 4 seconds. Wait 10s to be safe.
  await page.waitForTimeout(10000);

  // Assertions
  const state = await page.evaluate(() => {
     const mcadToggle = document.getElementById('mcad-toggle').checked;
     const items = Array.from(document.querySelectorAll('.tree-item'));
     
     // Check if DG_SHEET, MFG_, LMS-004871, LMS-002972 are deleted
     const deletedCount = items.filter(el => el.classList.contains('is-deleted')).length;
     
     // Check top items (should be 231 and 221)
     const topItems = items.slice(0, 10).map(el => el.dataset.name);

     // Check visibility toggle of KeepIn
     const keepInVisible = Array.from(document.querySelectorAll('label')).find(l => l.textContent.includes('KeepIn'))?.querySelector('input').checked;
     
     return { mcadToggle, deletedCount, topItems, keepInVisible, exportCalled: window.exportCalled };
  });

  console.log("Final State:", state);
  
  expect(state.mcadToggle).toBe(true);
  expect(state.deletedCount).toBeGreaterThan(0);
  expect(state.keepInVisible).toBe(false);
  expect(state.exportCalled).toBe(true);
});
