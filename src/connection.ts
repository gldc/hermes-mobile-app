// src/connection.ts
import * as SecureStore from 'expo-secure-store';
import { CookieJar } from './api/cookieJar';
import { GatewayClient, makeNativeSocket } from './api/gatewayClient';
import { RestClient } from './api/restClient';

const STORE_KEY = 'hermes-connection';

interface StoredConnection {
  baseUrl: string;
  username: string;
  password: string; // M1 only — M2 replaces credentials with device tokens
  cookies: Record<string, string>;
}

let jar = new CookieJar();
let rest: RestClient | null = null;

export function getRest(): RestClient {
  if (!rest) throw new Error('not connected — go to the Connect screen');
  return rest;
}

export async function connect(baseUrl: string, username: string, password: string): Promise<void> {
  const cleanUrl = baseUrl.replace(/\/+$/, '');
  jar = new CookieJar();
  rest = new RestClient(cleanUrl, jar);
  await rest.login(username, password);
  await SecureStore.setItemAsync(
    STORE_KEY,
    JSON.stringify({ baseUrl: cleanUrl, username, password, cookies: jar.toJSON() } satisfies StoredConnection),
  );
}

/** Restore a saved connection. Returns false if none saved. Re-logs-in if
 * the stored cookies are dead (AuthError surfaces to caller otherwise). */
export async function restore(): Promise<boolean> {
  const raw = await SecureStore.getItemAsync(STORE_KEY);
  if (!raw) return false;
  const saved: StoredConnection = JSON.parse(raw);
  jar = CookieJar.fromJSON(saved.cookies);
  rest = new RestClient(saved.baseUrl, jar);
  try {
    await rest.listSessions(); // probe; ingests any rotated cookies
  } catch {
    await rest.login(saved.username, saved.password); // cookies dead → fresh login
  }
  await SecureStore.setItemAsync(STORE_KEY, JSON.stringify({ ...saved, cookies: jar.toJSON() }));
  return true;
}

export async function disconnect(): Promise<void> {
  await SecureStore.deleteItemAsync(STORE_KEY);
  jar.clear();
  rest = null;
}

/** Mint a fresh single-use ticket and open a gateway socket (tickets live 30s — always mint immediately before connecting). */
export async function openGateway(): Promise<GatewayClient> {
  const r = getRest();
  const { ticket } = await r.wsTicket();
  const gw = new GatewayClient((url) => makeNativeSocket(url));
  await gw.connect(r.wsUrl(ticket));
  return gw;
}
