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

/** Every SF symbol used anywhere in src/ must have an Android mapping.
 * Call sites go through <Icon sf="..."> (or wrapper components taking an
 * `icon` prop / map entry), so collect string literals from `sf=`/`icon=`
 * JSX attributes — including ternaries — and `icon:` object properties. */
test('every sf: symbol used in the app has a mapping', () => {
  const root = path.join(__dirname, '..', 'src');
  const used = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(entry.name) && !p.includes('__tests__')) {
        const src = fs.readFileSync(p, 'utf8');
        for (const m of src.matchAll(/\b(?:sf|icon)\s*[=:]\s*("[a-z0-9._]+"|'[a-z0-9._]+'|\{[^}]*\})/g)) {
          for (const lit of m[1].matchAll(/['"]([a-z0-9._]+)['"]/g)) {
            used.add(lit[1]);
          }
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
