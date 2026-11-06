// Testes de arquitetura: garantem as regras de dependência da arquitetura hexagonal (Ports & Adapters).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(path);
    return entry.name.endsWith('.js') ? [path] : [];
  });
}

function importsOf(file) {
  const code = readFileSync(file, 'utf8');
  const pattern = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g;
  const found = [];
  let match;
  while ((match = pattern.exec(code))) found.push(match[1]);
  return found;
}

function layerOf(absolutePath) {
  const parts = relative(SRC, absolutePath).split(sep);
  if (parts[0] === 'adapters') return `adapters/${parts[1]}`;
  return parts.length === 1 ? 'root' : parts[0];
}

function violations(layer, { allowedLayers, allowExternal = false }) {
  const problems = [];
  for (const file of listFiles(SRC).filter((f) => layerOf(f) === layer)) {
    for (const spec of importsOf(file)) {
      const name = relative(SRC, file);
      if (spec.startsWith('.')) {
        const target = layerOf(resolve(dirname(file), spec));
        if (!allowedLayers.includes(target)) problems.push(`${name} importa ${spec} (camada ${target})`);
      } else if (!spec.startsWith('node:') && !allowExternal) {
        problems.push(`${name} importa o pacote externo "${spec}"`);
      }
    }
  }
  return problems;
}

test('as camadas existem', () => {
  const layers = new Set(listFiles(SRC).map(layerOf));
  for (const expected of ['application', 'adapters/inbound', 'adapters/outbound']) {
    assert.ok(layers.has(expected), `camada ausente: ${expected}`);
  }
});

test('application não depende de adaptadores nem de pacotes externos', () => {
  assert.deepEqual(violations('application', { allowedLayers: ['application'] }), []);
});

test('adaptador de entrada HTTP não conhece o adaptador de saída', () => {
  assert.deepEqual(
    violations('adapters/inbound', { allowedLayers: ['application', 'adapters/inbound'], allowExternal: true }),
    []
  );
});

test('adaptador de saída não conhece o adaptador de entrada', () => {
  assert.deepEqual(
    violations('adapters/outbound', { allowedLayers: ['application', 'adapters/outbound'], allowExternal: true }),
    []
  );
});
