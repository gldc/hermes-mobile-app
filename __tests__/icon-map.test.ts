import fs from 'fs';
import path from 'path';
import { SF_TO_MATERIAL } from '../src/lib/icon-map';
// Glyphmap ships inside @expo/vector-icons; this path is stable for the MCI set.
import glyphmap from '@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/MaterialCommunityIcons.json';

/** Every Material name we map to must actually exist in the font. */
test('every mapped material icon exists in the MCI glyphmap', () => {
  for (const [sf, material] of Object.entries(SF_TO_MATERIAL)) {
    expect({ sf, material, exists: material in glyphmap }).toEqual({ sf, material, exists: true });
  }
});

/** Every sf: symbol used anywhere in src/ must have an Android mapping. */
test('every sf: symbol used in the app has a mapping', () => {
  const root = path.join(__dirname, '..', 'src');
  const used = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(entry.name) && !p.includes('__tests__')) {
        for (const m of fs.readFileSync(p, 'utf8').matchAll(/['"`]sf:([a-z0-9._]+)['"`]/g)) {
          used.add(m[1]);
        }
      }
    }
  };
  walk(root);
  expect(used.size).toBeGreaterThan(0);
  for (const sf of used) {
    expect({ sf, mapped: sf in SF_TO_MATERIAL }).toEqual({ sf, mapped: true });
  }
});
