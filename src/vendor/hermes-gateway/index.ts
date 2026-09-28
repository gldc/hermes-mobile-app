// src/vendor/hermes-gateway/index.ts — APP-OWNED barrel (the only non-vendored file here).
// App code imports vendored symbols ONLY through this module (`@/vendor/hermes-gateway`).
//
// Runtime dependencies of the vendored client (keep these true or the transport breaks):
//  - Hermes has TextEncoder but NO TextDecoder; json-rpc-channel.ts constructs `new TextDecoder()`
//    at module top. It works only because Expo's winter runtime installs TextDecoder, URL and
//    DOMException (node_modules/expo/src/winter/runtime.native.ts). Removing expo winter breaks this.
//  - RN 0.85's WebSocket provides `static OPEN` and EventTarget (`addEventListener` with `once`);
//    json-rpc-gateway.ts reads the global `WebSocket.OPEN`.
// Re-vendor with `scripts/sync-gateway-contract.sh <tag>`; never hand-edit the vendored files
// (the drift guard in src/vendor/hermes-gateway/__tests__/drift.test.ts fails on any edit).
export { JsonRpcGatewayClient } from './json-rpc-gateway';
export type { GatewayClientOptions, ConnectionState } from './json-rpc-gateway';
export { JsonRpcGatewayError } from './json-rpc-channel';
export type { ServerRequest, ServerRequestHandler } from './json-rpc-channel';
export type { GatewayEvent, GatewayEventName, GatewayEventMap } from './gateway-events';
export type {
  RpcMethods,
  ServerRequestMap,
  ApprovalRequestParams,
  ApprovalResult,
  ClarifyRequestParams,
  ClarifyResult,
  SecretRequestParams,
  SudoRequestParams,
  ValueResult,
} from './gateway-contract.generated';
