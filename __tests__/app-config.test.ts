// __tests__/app-config.test.ts
import appJson from '../app.json';
import pkg from '../package.json';

test('Face ID usage string comes from the expo-local-authentication config plugin', () => {
  const plugin = appJson.expo.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-local-authentication') as
    | [string, { faceIDPermission?: string }]
    | undefined;
  expect(plugin?.[1].faceIDPermission).toMatch(/Face ID/);
  expect(JSON.stringify(appJson.expo.ios.infoPlist)).not.toContain('NSFaceIDUsageDescription');
  expect((pkg.dependencies as Record<string, string>)['expo-local-authentication']).toMatch(/^~56\./);
});
