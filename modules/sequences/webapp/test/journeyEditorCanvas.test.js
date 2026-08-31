import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const editor = readFileSync(
  new URL('../src/components/journeys/JourneyEditor.jsx', import.meta.url),
  'utf8'
);
const nodes = readFileSync(
  new URL('../src/components/journeys/JourneyNodes.jsx', import.meta.url),
  'utf8'
);
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('flow builder opens on the visual canvas by default', () => {
  assert.match(editor, /useState\('map'\)/);
  assert.match(editor, /<ReactFlow/);
  assert.match(editor, /mapView: 'קנבס'/);
});

test('macro-style list remains available as a secondary view', () => {
  assert.match(editor, /columnView: 'רשימה'/);
  assert.match(editor, /<JourneyColumn/);
  assert.match(editor, /setViewMode\('column'\)/);
});

test('canvas ships its custom nodes and React Flow runtime', () => {
  assert.equal(pkg.dependencies['@xyflow/react'], '^12.11.3');
  assert.match(nodes, /export const NODE_META/);
  assert.match(nodes, /export const nodeTypes/);
});
