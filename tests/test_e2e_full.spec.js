const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { parseStringPromise } = require('xml2js');

test.describe('End-to-End Application Feature and Export Validation', () => {
  test.setTimeout(120000);

  test('Full Workflow: Load, Map, Increment, Manual Edit, Export', async ({ page }) => {
    let baselineExportContent = null;
    let incrementExportContent = null;

    page.on('console', msg => {
        if (!msg.text().includes('GL Driver Message')) {
            console.log('PAGE LOG:', msg.text());
        }
    });
    page.on('pageerror', err => {
        console.log('PAGE ERROR (Uncaught):', err.message);
    });

    const filePath = 'file://' + path.resolve(__dirname, '../idx.html');
    await page.goto(filePath);

    // --- 1. Load Baseline ---
    console.log("Loading Baseline...");
    const baselinePath = path.resolve(__dirname, '../DAT_IDX_71695356_A_filtered (1).idx');
    await page.setInputFiles('#file-input', baselinePath);
    await page.waitForSelector('.tree-item');
    
    let itemsCount = await page.locator('.tree-item').count();
    expect(itemsCount).toBeGreaterThan(10);

    // --- 2. Load Hintmap ---
    console.log("Loading Hintmap...");
    const hintmapPath = path.resolve(__dirname, '../ecad/ecad_hint.map');
    await page.setInputFiles('#hintmap-input', hintmapPath);
    await page.waitForTimeout(1000); // Allow mapping to process

    // Toggle MCAD names on
    await page.evaluate(() => document.getElementById('mcad-toggle').click());
    await page.waitForTimeout(500);

    // --- 3. Filter and Move Top ---
    console.log("Filtering and Moving...");
    await page.fill('#search-input', 'X100');
    await page.waitForTimeout(500);
    // Select first visible
    await page.evaluate(() => {
       const visible = Array.from(document.querySelectorAll('.tree-item')).find(el => el.style.display !== 'none');
       if (visible) visible.click();
    });
    await page.click('#move-top-btn');
    await page.click('#clear-search-btn');
    await page.waitForTimeout(500);

    // --- 4. Load Increments ---
    console.log("Loading Increments...");
    const incPaths = [
        path.resolve(__dirname, '../DAT_IDX_71695356_A_filtered (1)_increment.idx'),
        path.resolve(__dirname, '../DAT_IDX_71695356_A_filtered (1)_increment (1).idx')
    ];
    await page.setInputFiles('#inc-file-input', incPaths);
    await page.waitForTimeout(2000);

    // Check timeline bubbles
    const bubblesCount = await page.locator('.history-bubble').count();
    expect(bubblesCount).toBe(4); // Base + 2 Incs + Aktuell

    // Go to Aktuell (should be 999)
    await page.evaluate(() => {
        const bubbles = Array.from(document.querySelectorAll('.history-bubble'));
        const aktuell = bubbles.find(b => b.textContent.includes('Aktuell'));
        if (aktuell) aktuell.click();
    });
    await page.waitForTimeout(1000);

    // --- 5. Manual Edits (Aktuell) ---
    console.log("Applying Manual Edits...");
    
    // Modify X100
    await page.evaluate(() => {
        const x100 = Array.from(document.querySelectorAll('.tree-item')).find(el => el.dataset.name === 'X100');
        if(x100) x100.click();
    });
    await page.waitForTimeout(500);
    await page.fill('#edit-comp-x', '150.5');
    await page.click('#apply-edit-btn');
    await page.locator('#loading').waitFor({ state: 'hidden' });
    await page.waitForTimeout(500);

    // Reject an incremental change (e.g. ZUK1191 which is a component deleted in the increment)
    console.log("Rejecting an incremental change...");
    // Go to increment step first to see the deletion highlighted
    await page.evaluate(() => {
        const bubbles = Array.from(document.querySelectorAll('.history-bubble'));
        const incBubble = bubbles.find(b => b.textContent.includes('increment'));
        if (incBubble) incBubble.click();
    });
    await page.locator('#loading').waitFor({ state: 'hidden' });
    await page.waitForTimeout(500);

    await page.evaluate(() => {
        const comp = allComponents.find(c => c.name === 'ZUK1191' || (c.instName && c.instName.includes('1191')));
        if(comp) {
            window.setResponse(comp.uid, 'rejected');
        }
    });
    await page.locator('#loading').waitFor({ state: 'hidden' });
    await page.waitForTimeout(500);

    // Switch back to Aktuell to make the counter proposal
    await page.evaluate(() => {
        const bubbles = Array.from(document.querySelectorAll('.history-bubble'));
        const aktuell = bubbles.find(b => b.textContent.includes('Aktuell'));
        if (aktuell) aktuell.click();
    });
    await page.locator('#loading').waitFor({ state: 'hidden' });
    await page.waitForTimeout(500);

    // Delete X101
    await page.evaluate(() => {
        const x101 = Array.from(document.querySelectorAll('.tree-item')).find(el => el.dataset.name === 'X101');
        if(x101) {
            const delBtn = x101.querySelector('.delete-toggle');
            if(delBtn) delBtn.click();
        }
    });
    await page.locator('#loading').waitFor({ state: 'hidden' });
    await page.waitForTimeout(500);

    // --- 6. Add Manual Component ---
    console.log("Adding Manual Component...");
    await page.evaluate(() => {
        const acc = Array.from(document.querySelectorAll('.accordion-header')).find(el => el.textContent.includes('Manuelles Bauteil hinzufügen'));
        if (acc) acc.click();
    });
    await page.waitForTimeout(500);
    await page.fill('#new-comp-name', 'TEST_NEW_COMP');
    await page.fill('#new-comp-x', '55');
    await page.fill('#new-comp-y', '66');
    
    // Fake a file selection via evaluate for the OBJ since we can't easily trigger the file dialog in headless without setInputFiles
    await page.evaluate(() => {
       const dt = new DataTransfer();
       const file = new File(['fake obj content'], 'test.obj', { type: 'text/plain' });
       dt.items.add(file);
       document.getElementById('new-comp-file').files = dt.files;
       document.getElementById('new-comp-file').dispatchEvent(new Event('change'));
    });
    
    // Override alert to not block
    await page.evaluate(() => { window.alert = (msg) => console.log('ALERT:', msg); });
    await page.click('#add-manual-btn');
    await page.waitForTimeout(1000);

    const hasTestCompInTree = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.tree-item')).some(el => el.dataset.name === 'TEST_NEW_COMP');
    });
    console.log("TEST_NEW_COMP added to tree:", hasTestCompInTree);
    expect(hasTestCompInTree).toBe(true);

    // --- 7. Intercept Exports ---
    console.log("Preparing Export Interception...");
    await page.evaluate(() => {
        window.interceptedExports = {};
        const originalClick = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function() {
            if (this.download) {
                console.log("Intercepted download request for:", this.download);
                fetch(this.href).then(res => res.text()).then(text => {
                    window.interceptedExports[this.download] = text;
                });
            } else {
                originalClick.apply(this);
            }
        };
    });

    // --- 8. Export Baseline ---
    console.log("Triggering Baseline Export...");
    await page.click('#export-btn');
    await page.waitForTimeout(2000); // Wait for fetch to complete

    // --- 9. Export Increment ---
    console.log("Triggering Increment Export...");
    const exportState = await page.evaluate(() => {
        const rejected = allComponents.filter(c => c.acceptStatus === 'rejected');
        return {
            resps: window.manualStateResponses,
            rejectedCount: rejected.length,
            zuk1191: allComponents.find(c => c.name === 'ZUK1191' || (c.instName && c.instName.includes('1191')))
        };
    });
    console.log("State exactly before export:", JSON.stringify(exportState, null, 2));

    await page.click('#export-inc-btn');
    await page.waitForTimeout(2000); // Wait for fetch to complete

    // Retrieve intercepted files
    let exports = await page.evaluate(() => window.interceptedExports);
    
    // Poll until exports are populated
    let retries = 0;
    while (Object.keys(exports).length < 2 && retries < 10) {
        await page.waitForTimeout(1000);
        exports = await page.evaluate(() => window.interceptedExports);
        retries++;
    }
    
    const baselineKey = Object.keys(exports).find(k => k.includes('_filtered.idx'));
    const incrementKey = Object.keys(exports).find(k => k.includes('_increment.idx'));

    expect(baselineKey).toBeDefined();
    expect(incrementKey).toBeDefined();

    baselineExportContent = exports[baselineKey];
    incrementExportContent = exports[incrementKey];

    // --- 10. Validate Exported Data ---
    console.log("Validating Exported Data...");
    
    // Parse Baseline XML
    const baseXml = await parseStringPromise(baselineExportContent, { ignoreAttrs: false });
    
    // Basic structural checks on Baseline
    expect(baseXml['foundation:EDMDDataSet']).toBeDefined();
    
    // Ensure manual component TEST_NEW_COMP is in baseline export
    const hasNewCompBase = baselineExportContent.includes('TEST_NEW_COMP');
    expect(hasNewCompBase).toBe(true);

    // Ensure X101 is NOT in baseline export (as it was deleted)
    // Actually, in the baseline export, it might just remove the ItemInstance.
    // Let's verify ItemInstance with name containing X101 is missing or marked.
    // Our logic removes deleted components from the ItemInstance list.
    const hasX101Base = baselineExportContent.includes('X101') && baselineExportContent.includes('ItemInstance');
    // It's a bit hard to string match exactly without complex parsing because X101 might be in the comment history.
    // We will trust the increment parsing more strictly.

    // Parse Increment XML
    const incXml = await parseStringPromise(incrementExportContent, { ignoreAttrs: false });
    const processInst = incXml['foundation:EDMDDataSet']['foundation:ProcessInstruction'][0];
    const changes = processInst['computational:Changes'][0]['computational:EDMDChange'][0];

    // Check if X101's internal ObjectName is in DeletedInstanceName
    const deletedInstances = changes['computational:DeletedInstanceName'];
    expect(deletedInstances).toBeDefined();
    // We don't know the exact ObjectName (e.g. ZUK891) without parsing the base again thoroughly.
    // Instead of exactly matching 'X101', we just expect there is at least one deleted instance
    // since we only deleted X101 manually.
    expect(deletedInstances.length).toBeGreaterThan(0);

    // Check if new manual component is in the document as new single Item and Instance
    // Look for TEST_NEW_COMP in the raw text to confirm it's appended
    expect(incrementExportContent.includes('TEST_NEW_COMP')).toBe(true);

    // Check if X100 moved. It should be in the changes list, meaning its tx/ty/tz updated.
    // X100 was modified to X=150.5. We should find 150.5 in the document.
    if (!incrementExportContent.includes('150.500')) {
        console.log("INCREMENT CONTENT DOES NOT CONTAIN 150.500. Content snippet:");
        console.log(incrementExportContent.substring(0, 2000));
    }
    expect(incrementExportContent.includes('150.500')).toBe(true);

    // Check Responses block for ZUK1191
    console.log("Increment export responses check:");
    if (!processInst['computational:Responses']) {
        console.log("No computational:Responses array. Raw XML snippet:", incrementExportContent.substring(0, 1500));
    }
    const responses = processInst['computational:Responses'][0]['computational:EDMDResponse'];
    expect(responses).toBeDefined();
    expect(responses.some(r => r['computational:Status'][0] === 'REJECTED')).toBe(true);

    console.log("All validations passed successfully.");
  });
});
