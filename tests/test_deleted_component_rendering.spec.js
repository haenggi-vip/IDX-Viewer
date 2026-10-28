const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// Prueft idx.html (die einzige Quelle des Viewer-Codes).
test('deleted components are not converted into board cutouts in idx.html', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'idx.html'), 'utf8');
  const declaration = source.match(/const cutouts = components\.filter\([^;]+;/);

  expect(declaration).not.toBeNull();
  expect(declaration[0]).toContain('!c.isDeleted');
  expect(declaration[0]).toContain('c.type === "Cutout"');
  expect(declaration[0]).not.toContain('|| c.isDeleted');
});
