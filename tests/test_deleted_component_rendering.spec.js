const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

for (const relativePath of ['idx.html', 'main_script_fixed.js']) {
  test(`deleted components are not converted into board cutouts in ${relativePath}`, () => {
    const source = fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
    const declaration = source.match(/const cutouts = components\.filter\([^;]+;/);

    expect(declaration).not.toBeNull();
    expect(declaration[0]).toContain('!c.isDeleted');
    expect(declaration[0]).toContain('c.type === "Cutout"');
    expect(declaration[0]).not.toContain('|| c.isDeleted');
  });
}
