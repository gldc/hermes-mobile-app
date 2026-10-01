// Connector state ("reload pending", a sign-in request) belongs to one gateway: connection.ts
// drops it on a disconnect and when the gateway address changes, and keeps it across a silent
// re-login to the same address.
import { connect, disconnect } from '../src/connection';
import { getMcpChangePending, markMcpChanged, resetConnectorState } from '../src/connector-state';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));

const realFetch = global.fetch;

beforeEach(() => {
  resetConnectorState();
  global.fetch = jest.fn(async () => ({
    status: 200,
    ok: true,
    headers: { get: () => null },
    json: async () => ({ ok: true }),
  })) as unknown as typeof fetch;
});

afterAll(() => {
  global.fetch = realFetch;
});

test('a re-login to the same gateway keeps the pending change', async () => {
  await connect('https://a.example', 'u', 'p');
  markMcpChanged();
  await connect('https://a.example/', 'u', 'p'); // same address, trailing slash
  expect(getMcpChangePending()).toBe(true);
});

test('connecting to another gateway drops it', async () => {
  await connect('https://a.example', 'u', 'p');
  markMcpChanged();
  await connect('https://b.example', 'u', 'p');
  expect(getMcpChangePending()).toBe(false);
});

test('disconnecting drops it', async () => {
  await connect('https://a.example', 'u', 'p');
  markMcpChanged();
  await disconnect();
  expect(getMcpChangePending()).toBe(false);
});
