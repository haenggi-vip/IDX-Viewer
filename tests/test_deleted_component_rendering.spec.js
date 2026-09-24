const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// Nur idx.html wird geprueft: main_script_fixed.js wird von der Anwendung
// nirgends eingebunden und ist toter Code.
test('deleted components are not converted into board cutouts in idx.html', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'idx.html'), 'utf8');
  const declaration = source.match(/const cutouts = components\.filter\([^;]+;/);

  expect(declaration).not.toBeNull();
  expect(declaration[0]).toContain('!c.isDeleted');
  expect(declaration[0]).toContain('c.type === "Cutout"');
  expect(declaration[0]).not.toContain('|| c.isDeleted');
});
