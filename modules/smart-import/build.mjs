import { build } from 'esbuild';

// Bundles ui/entry.js (which imports everything) into a single IIFE that
// attaches the public API to window.__cwImport. Runs in the browser only.
await build({
  entryPoints: ['ui/entry.js'],
  bundle: true,
  format: 'iife',
  globalName: '__cwImport',
  outfile: 'dist/import-tool.js',
  target: ['safari15', 'chrome100'],
  legalComments: 'none',
});
console.log('built dist/import-tool.js');
