// __tests__/mcp-oauth.test.ts
import type { McpOauthFlow } from '../src/api/mcp';
import { OauthPreflightError } from '../src/api/mcp';
import { AuthError, HttpError } from '../src/api/restClient';
import {
  OAUTH_CONFLICT_RETRY_MS,
  OAUTH_DISMISS_WAIT_MS,
  OAUTH_FINISH_GRACE_MS,
  OAUTH_MAX_FAILED_POLLS,
  OAUTH_POLL_MS,
  OAUTH_TOTAL_LIMIT_MS,
  runOauthSignIn,
  type OauthDeps,
  type OauthPhase,
} from '../src/lib/mcp-oauth';

const URL_A = 'https://a.example/authorize?state=s1';

function flow(over: Partial<McpOauthFlow> = {}): McpOauthFlow {
  return { flow_id: 'f1', server_name: 'linear', status: 'authorization_required', authorization_url: URL_A, error: null, ...over };
}

type Step = McpOauthFlow | Error;

interface Script {
  start?: Step | Step[];
  /** Poll answers in order; the last one repeats. */
  polls?: Step[];
  cancelStatus?: string;
  cancelError?: Error;
  checkUrl?: (url: string) => string | null;
  /** The person closes the browser just before this poll (0-based). */
  closeBrowserBeforePoll?: number;
  /** openBrowser rejects. */
  openFails?: boolean;
  /** openBrowser throws synchronously. */
  openThrows?: boolean;
  /** openBrowser resolves at once with this value (no page was shown). */
  openResult?: unknown;
  /** dismissBrowser never settles, or rejects. */
  dismiss?: 'hang' | 'reject';
  /** isCancelled() turns true just before this poll (0-based). */
  cancelBeforePoll?: number;
  /** Extra clock jump (ms) added to the sleep before this poll (0-based) — a background suspension. */
  jumpBeforePoll?: Record<number, number>;
  retryConflict?: boolean;
  /** Cancel was tapped (or the screen left) before the start request came back. */
  cancelledFromStart?: boolean;
}

function harness(script: Script) {
  let t = 0;
  let pollIndex = 0;
  let startIndex = 0;
  let cancelled = script.cancelledFromStart ?? false;
  let closeBrowser: () => void = () => {};
  const log = {
    phases: [] as OauthPhase[],
    opened: [] as string[],
    dismissed: 0,
    dismissWaits: 0,
    cancels: [] as string[],
    polls: 0,
    starts: 0,
    sleeps: [] as number[],
  };
  const starts = Array.isArray(script.start) ? script.start : [script.start ?? flow()];
  const polls = script.polls ?? [flow()];

  const deps: OauthDeps = {
    start: async () => {
      log.starts += 1;
      const step = starts[Math.min(startIndex++, starts.length - 1)];
      if (step instanceof Error) throw step;
      return step;
    },
    poll: async () => {
      log.polls += 1;
      const step = polls[Math.min(pollIndex++, polls.length - 1)];
      if (step instanceof Error) throw step;
      return step;
    },
    cancel: async (id) => {
      log.cancels.push(id);
      if (script.cancelError) throw script.cancelError;
      return { status: script.cancelStatus ?? 'error' };
    },
    openBrowser: (url) => {
      log.opened.push(url);
      if (script.openThrows) throw new Error('sync boom');
      if (script.openFails) return Promise.reject(new Error('no browser'));
      if ('openResult' in script) return Promise.resolve(script.openResult);
      return new Promise<void>((resolve) => {
        closeBrowser = resolve;
      });
    },
    dismissBrowser: () => {
      log.dismissed += 1;
      if (script.dismiss === 'hang') return new Promise<void>(() => {});
      if (script.dismiss === 'reject') return Promise.reject(new Error('cannot dismiss'));
      closeBrowser();
    },
    checkUrl: script.checkUrl ?? (() => null),
    sleep: async (ms) => {
      if (ms === OAUTH_DISMISS_WAIT_MS) {
        log.dismissWaits += 1; // the bound on a dismiss: not a poll tick, the clock stays put
        return;
      }
      log.sleeps.push(ms);
      t += ms + (script.jumpBeforePoll?.[pollIndex] ?? 0);
      if (script.closeBrowserBeforePoll === pollIndex) closeBrowser();
      if (script.cancelBeforePoll === pollIndex) cancelled = true;
      await Promise.resolve();
    },
    now: () => t,
    onPhase: (p) => log.phases.push(p),
    isCancelled: () => cancelled,
    retryConflict: script.retryConflict,
  };
  return { deps, log, clock: () => t };
}

const approved = (tools = [{ name: 'search', description: 'Search' }]) => flow({ status: 'approved', tools });

describe('runOauthSignIn — the normal path', () => {
  it('opens the URL, polls, and closes the browser on approval', async () => {
    const h = harness({ polls: [flow(), flow(), approved()] });
    const out = await runOauthSignIn(h.deps);
    expect(out).toEqual({ kind: 'approved', tools: [{ name: 'search', description: 'Search' }] });
    expect(h.log.opened).toEqual([URL_A]);
    expect(h.log.phases).toEqual(['starting', 'browser']);
    expect(h.log.polls).toBe(3);
    expect(h.log.dismissed).toBe(1);
    expect(h.log.cancels).toEqual([]);
    expect(h.log.sleeps.every((ms) => ms === OAUTH_POLL_MS)).toBe(true);
  });

  it('keeps polling through `starting` and a null URL', async () => {
    const h = harness({ polls: [flow({ status: 'starting', authorization_url: null }), approved([])] });
    expect(await runOauthSignIn(h.deps)).toEqual({ kind: 'approved', tools: [] });
  });

  it('already approved at start: no browser, tools read once', async () => {
    const h = harness({ start: flow({ status: 'approved', authorization_url: null }), polls: [approved()] });
    const out = await runOauthSignIn(h.deps);
    expect(out.kind).toBe('approved');
    expect(h.log.opened).toEqual([]);
    expect(h.log.polls).toBe(1);
    expect(h.log.cancels).toEqual([]);
  });

  it('already approved at start still succeeds when the tools read fails', async () => {
    const h = harness({ start: flow({ status: 'approved', authorization_url: null }), polls: [new HttpError(404, 'gone')] });
    expect(await runOauthSignIn(h.deps)).toEqual({ kind: 'approved', tools: [] });
  });
});

describe('runOauthSignIn — start failures', () => {
  it('an error status at start cancels the flow (rule A) and reports the gateway error', async () => {
    const h = harness({ start: flow({ status: 'error', authorization_url: null, error: 'Registration refused' }) });
    expect(await runOauthSignIn(h.deps)).toEqual({ kind: 'error', message: 'Registration refused' });
    expect(h.log.cancels).toEqual(['f1']);
    expect(h.log.opened).toEqual([]);
  });

  it('no URL at start cancels and reports it', async () => {
    const h = harness({ start: flow({ status: 'starting', authorization_url: null }) });
    expect(await runOauthSignIn(h.deps)).toEqual({ kind: 'error', message: 'The gateway did not produce a sign-in page. Try again.' });
    expect(h.log.cancels).toEqual(['f1']);
  });

  it('a URL that fails rule B is not opened and the flow is cancelled', async () => {
    const h = harness({ checkUrl: () => 'The sign-in address is not HTTPS, so it was not opened.' });
    expect(await runOauthSignIn(h.deps)).toEqual({ kind: 'error', message: 'The sign-in address is not HTTPS, so it was not opened.' });
    expect(h.log.opened).toEqual([]);
    expect(h.log.cancels).toEqual(['f1']);
  });

  it('a start timeout holds no flow id, so nothing is cancelled', async () => {
    const h = harness({ start: new HttpError(0, 'request timed out after 45s') });
    expect(await runOauthSignIn(h.deps)).toEqual({
      kind: 'error',
      message: 'The gateway did not answer in time. Trying again may be refused for up to 5 minutes.',
    });
    expect(h.log.cancels).toEqual([]);
  });

  it('a start HTTP error shows the gateway reason', async () => {
    const h = harness({ start: new HttpError(409, "MCP OAuth for 'linear' is already in progress") });
    expect(await runOauthSignIn(h.deps)).toEqual({ kind: 'error', message: "MCP OAuth for 'linear' is already in progress" });
    expect(h.log.starts).toBe(1);
  });

  it('retries once after a 409 when the app has just cancelled a flow', async () => {
    const h = harness({ retryConflict: true, start: [new HttpError(409, 'in progress'), flow()], polls: [approved()] });
    expect((await runOauthSignIn(h.deps)).kind).toBe('approved');
    expect(h.log.starts).toBe(2);
    expect(h.log.sleeps[0]).toBe(OAUTH_CONFLICT_RETRY_MS);
  });

  it('retries a 409 only once', async () => {
    const h = harness({ retryConflict: true, start: [new HttpError(409, 'in progress'), new HttpError(409, 'in progress')] });
    expect(await runOauthSignIn(h.deps)).toEqual({ kind: 'error', message: 'in progress' });
    expect(h.log.starts).toBe(2);
  });

  it('a 404 at start means the connector is gone', async () => {
    const h = harness({ start: new HttpError(404, "Server 'linear' not found") });
    expect(await runOauthSignIn(h.deps)).toEqual({ kind: 'error', message: 'This connector no longer exists.', gone: true });
  });

  it('an error at start whose cancel answers `approved` is a success', async () => {
    const h = harness({ start: flow({ status: 'error', authorization_url: null, error: 'x' }), cancelStatus: 'approved', polls: [approved()] });
    expect((await runOauthSignIn(h.deps)).kind).toBe('approved');
  });

  it('a failed fast request is a list failure, not a missing connector', async () => {
    const h = harness({ start: new OauthPreflightError(new HttpError(404, "Profile 'x' not found")) });
    expect(await runOauthSignIn(h.deps)).toEqual({ kind: 'error', message: "Profile 'x' not found" });
  });

  it('a timed-out fast request does not warn about a 5-minute refusal: no flow was started', async () => {
    const h = harness({ start: new OauthPreflightError(new HttpError(0, 'request timed out after 20s')) });
    expect(await runOauthSignIn(h.deps)).toEqual({ kind: 'error', message: 'The gateway did not answer in time.' });
  });

  it('a network failure at start is reported plainly', async () => {
    const h = harness({ start: new TypeError('Network request failed') });
    expect(await runOauthSignIn(h.deps)).toEqual({ kind: 'error', message: 'Gateway unreachable — check your VPN or Wi-Fi.' });
  });

  it('AuthError at start passes through', async () => {
    const h = harness({ start: new AuthError('dead') });
    await expect(runOauthSignIn(h.deps)).rejects.toThrow(AuthError);
  });
});

describe('runOauthSignIn — while the browser is open', () => {
  it('a gateway error on a poll closes the browser, cancels, and reports it', async () => {
    const h = harness({ polls: [flow(), flow({ status: 'error', error: 'Access denied' })] });
    expect(await runOauthSignIn(h.deps)).toEqual({ kind: 'error', message: 'Access denied' });
    expect(h.log.dismissed).toBe(1);
    expect(h.log.cancels).toEqual(['f1']);
  });

  it('a changed authorization URL cancels: the open page can no longer complete', async () => {
    const h = harness({ polls: [flow({ authorization_url: 'https://a.example/authorize?state=s2' })] });
    expect(await runOauthSignIn(h.deps)).toEqual({ kind: 'error', message: 'The gateway restarted the sign-in. Try again.' });
    expect(h.log.dismissed).toBe(1);
    expect(h.log.cancels).toEqual(['f1']);
  });

  it('a 404 on a poll means the flow expired; there is nothing to cancel', async () => {
    const h = harness({ polls: [new HttpError(404, 'OAuth flow not found or expired')] });
    expect(await runOauthSignIn(h.deps)).toEqual({ kind: 'error', message: 'Sign-in expired. Try again.' });
    expect(h.log.dismissed).toBe(1);
    expect(h.log.cancels).toEqual([]);
  });

  it('a failed poll is retried on the next tick', async () => {
    const h = harness({ polls: [new TypeError('Network request failed'), new HttpError(502, 'bad gateway'), approved()] });
    expect((await runOauthSignIn(h.deps)).kind).toBe('approved');
    expect(h.log.polls).toBe(3);
  });

  it('gives up after 15 failed polls in a row (review focus 4)', async () => {
    const h = harness({ polls: [new TypeError('Network request failed')] });
    expect(await runOauthSignIn(h.deps)).toEqual({ kind: 'error', message: 'Lost contact with the gateway during sign-in.' });
    expect(h.log.polls).toBe(OAUTH_MAX_FAILED_POLLS);
    expect(h.log.dismissed).toBe(1);
    expect(h.log.cancels).toEqual(['f1']);
  });

  it('AuthError on a poll closes the browser, then passes through', async () => {
    const h = harness({ polls: [flow(), new AuthError('dead')] });
    await expect(runOauthSignIn(h.deps)).rejects.toThrow(AuthError);
    expect(h.log.dismissed).toBe(1);
  });

  it('stops at the 6-minute limit, after a poll', async () => {
    const h = harness({ polls: [flow()] });
    expect(await runOauthSignIn(h.deps)).toEqual({ kind: 'error', message: 'Sign-in timed out.' });
    expect(h.clock()).toBe(OAUTH_TOTAL_LIMIT_MS);
    expect(h.log.polls).toBe(OAUTH_TOTAL_LIMIT_MS / OAUTH_POLL_MS);
    expect(h.log.dismissed).toBe(1);
    expect(h.log.cancels).toEqual(['f1']);
  });

  it('after a long gap the poll comes first, and approval beats the limit (review focus 3)', async () => {
    const h = harness({ polls: [flow(), approved()], jumpBeforePoll: { 1: 30 * 60_000 } });
    expect((await runOauthSignIn(h.deps)).kind).toBe('approved');
    expect(h.log.cancels).toEqual([]);
  });

  it('a failed poll never triggers a time limit by itself', async () => {
    const h = harness({
      polls: [flow(), new TypeError('Network request failed'), approved()],
      jumpBeforePoll: { 1: 30 * 60_000 },
    });
    expect((await runOauthSignIn(h.deps)).kind).toBe('approved');
  });

  it('a browser that cannot open ends with an error and a cancel', async () => {
    const h = harness({ openFails: true });
    expect(await runOauthSignIn(h.deps)).toEqual({ kind: 'error', message: 'Could not open the sign-in page.' });
    expect(h.log.cancels).toEqual(['f1']);
    expect(h.log.dismissed).toBe(0);
  });
});

describe('runOauthSignIn — a misbehaving browser', () => {
  it('a dismiss that never settles does not block the cancel', async () => {
    const h = harness({ dismiss: 'hang', polls: [flow(), flow({ status: 'error', error: 'Access denied' })] });
    expect(await runOauthSignIn(h.deps)).toEqual({ kind: 'error', message: 'Access denied' });
    expect(h.log.dismissed).toBe(1);
    expect(h.log.dismissWaits).toBe(1);
    expect(h.log.cancels).toEqual(['f1']);
  });

  it('a dismiss that rejects is ignored', async () => {
    const h = harness({ dismiss: 'reject', polls: [approved()] });
    expect((await runOauthSignIn(h.deps)).kind).toBe('approved');
  });

  it('an open that answers `locked` is a failure to open, not a closed page', async () => {
    const h = harness({ openResult: { type: 'locked' } });
    expect(await runOauthSignIn(h.deps)).toEqual({ kind: 'error', message: 'Could not open the sign-in page.' });
    expect(h.log.phases).toEqual(['starting', 'browser']);
    expect(h.log.cancels).toEqual(['f1']);
  });

  it('an open that throws synchronously still cancels the flow', async () => {
    const h = harness({ openThrows: true });
    expect(await runOauthSignIn(h.deps)).toEqual({ kind: 'error', message: 'Could not open the sign-in page.' });
    expect(h.log.cancels).toEqual(['f1']);
  });

  it('reports a failed open without waiting for a poll to succeed', async () => {
    const h = harness({ openFails: true, polls: [new TypeError('Network request failed')] });
    expect(await runOauthSignIn(h.deps)).toEqual({ kind: 'error', message: 'Could not open the sign-in page.' });
    expect(h.log.polls).toBe(0);
    expect(h.log.cancels).toEqual(['f1']);
  });

  it('a throwing dependency cancels the flow instead of escaping', async () => {
    const h = harness({
      checkUrl: () => {
        throw new Error('boom');
      },
    });
    expect(await runOauthSignIn(h.deps)).toEqual({ kind: 'error', message: 'Sign-in failed unexpectedly.' });
    expect(h.log.opened).toEqual([]);
    expect(h.log.cancels).toEqual(['f1']);
  });
});

describe('runOauthSignIn — the person closes the browser', () => {
  it('keeps polling and succeeds when approval lands within 60 s', async () => {
    const h = harness({ closeBrowserBeforePoll: 1, polls: [flow(), flow(), flow(), approved()] });
    expect((await runOauthSignIn(h.deps)).kind).toBe('approved');
    expect(h.log.phases).toEqual(['starting', 'browser', 'finishing']);
    expect(h.log.dismissed).toBe(0); // it is already closed
    expect(h.log.cancels).toEqual([]);
  });

  it('announces `finishing` even when the polls after the close fail', async () => {
    const h = harness({ closeBrowserBeforePoll: 0, polls: [new TypeError('Network request failed'), approved()] });
    expect((await runOauthSignIn(h.deps)).kind).toBe('approved');
    expect(h.log.phases).toEqual(['starting', 'browser', 'finishing']);
  });

  it('cancels after 60 s without approval', async () => {
    const h = harness({ closeBrowserBeforePoll: 0, polls: [flow()] });
    expect(await runOauthSignIn(h.deps)).toEqual({ kind: 'cancelled' });
    expect(h.log.cancels).toEqual(['f1']);
    // closed is first seen at the first poll; the grace runs from there
    expect(h.clock()).toBe(OAUTH_POLL_MS + OAUTH_FINISH_GRACE_MS);
  });

  it('a cancel that answers `approved` is a success (rule A)', async () => {
    const h = harness({ closeBrowserBeforePoll: 0, polls: [flow()], cancelStatus: 'approved' });
    const out = await runOauthSignIn(h.deps);
    expect(out.kind).toBe('approved');
  });

  it('a failing cancel still reports the outcome', async () => {
    const h = harness({ closeBrowserBeforePoll: 0, polls: [flow()], cancelError: new HttpError(500, 'x') });
    expect(await runOauthSignIn(h.deps)).toEqual({ kind: 'cancelled' });
  });

  it('AuthError from the cancel passes through', async () => {
    const h = harness({ closeBrowserBeforePoll: 0, polls: [flow()], cancelError: new AuthError('dead') });
    await expect(runOauthSignIn(h.deps)).rejects.toThrow(AuthError);
  });
});

describe('runOauthSignIn — Cancel and leaving the screen', () => {
  it('Cancel while the start request is in flight: no browser, flow cancelled', async () => {
    const h = harness({ cancelledFromStart: true });
    expect(await runOauthSignIn(h.deps)).toEqual({ kind: 'cancelled' });
    expect(h.log.opened).toEqual([]);
    expect(h.log.polls).toBe(0);
    expect(h.log.cancels).toEqual(['f1']);
  });

  it('Cancel during the 409 retry wait does not start a second flow', async () => {
    const h = harness({ cancelledFromStart: true, retryConflict: true, start: [new HttpError(409, 'in progress'), flow()] });
    expect(await runOauthSignIn(h.deps)).toEqual({ kind: 'cancelled' });
    expect(h.log.starts).toBe(1);
    expect(h.log.opened).toEqual([]);
  });

  it('a flow already approved at start still counts when Cancel was tapped', async () => {
    const h = harness({ cancelledFromStart: true, start: flow({ status: 'approved', authorization_url: null }), polls: [approved()] });
    expect((await runOauthSignIn(h.deps)).kind).toBe('approved');
    expect(h.log.cancels).toEqual([]);
  });

  it('isCancelled ends the sequence at the next tick, closing the browser and cancelling the flow', async () => {
    const h = harness({ cancelBeforePoll: 1, polls: [flow()] });
    expect(await runOauthSignIn(h.deps)).toEqual({ kind: 'cancelled' });
    expect(h.log.polls).toBe(2);
    expect(h.log.dismissed).toBe(1);
    expect(h.log.cancels).toEqual(['f1']);
  });

  it('a flow approved on the very poll where Cancel was tapped still counts', async () => {
    const h = harness({ cancelBeforePoll: 0, polls: [approved()] });
    expect((await runOauthSignIn(h.deps)).kind).toBe('approved');
    expect(h.log.cancels).toEqual([]);
  });

  it('Cancel is honoured even when the poll failed', async () => {
    const h = harness({ cancelBeforePoll: 0, polls: [new TypeError('Network request failed')] });
    expect(await runOauthSignIn(h.deps)).toEqual({ kind: 'cancelled' });
    expect(h.log.cancels).toEqual(['f1']);
  });
});
