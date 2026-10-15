import { Linking } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { LinkifiedText } from '../src/components/linkified-text';
import { MarkdownView } from '../src/components/markdown-view';
import { MessageRow } from '../src/components/message-row';
import { isOpenableUrl, LINKIFY_MAX_CHARS, linkSegments, openExternal } from '../src/lib/links';

jest.mock('../src/components/icon', () => ({ Icon: () => null }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(async () => {}), ImpactFeedbackStyle: { Medium: 'medium' } }));

let openURL: jest.SpyInstance;
beforeEach(() => {
  // The preset's Linking.openURL is already a mock: clear its calls from earlier tests.
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  openURL.mockClear();
});
afterEach(() => jest.restoreAllMocks());

describe('isOpenableUrl', () => {
  test.each(['https://example.com', 'http://192.168.1.4:9119/x', 'mailto:hi@example.com', 'HTTPS://EXAMPLE.COM'])(
    '%s opens in the browser',
    (url) => expect(isOpenableUrl(url)).toBe(true),
  );

  // Agent output is untrusted: it must not deep-link into this app, run script or dial.
  test.each(['hermesmobileapp://dev-cards', 'javascript:alert(1)', 'tel:5551234', 'file:///etc/passwd', 'sms:1', '', 'example.com'])(
    '%s is refused',
    (url) => expect(isOpenableUrl(url)).toBe(false),
  );
});

describe('openExternal', () => {
  test('hands an http(s) URL to the system, which opens the default browser', () => {
    openExternal('https://example.com/a');
    expect(openURL).toHaveBeenCalledWith('https://example.com/a');
  });

  test('does nothing for a refused scheme', () => {
    openExternal('hermesmobileapp://settings');
    expect(openURL).not.toHaveBeenCalled();
  });

  test('swallows a rejected open instead of throwing from a tap handler', async () => {
    openURL.mockRejectedValue(new Error('no handler'));
    expect(() => openExternal('https://example.com')).not.toThrow();
    await Promise.resolve();
  });
});

describe('linkSegments', () => {
  test('splits text around URLs, leaving trailing punctuation outside', () => {
    expect(linkSegments('See https://example.com/a, then http://b.dev/x.')).toEqual([
      { text: 'See ' },
      { text: 'https://example.com/a', url: 'https://example.com/a' },
      { text: ', then ' },
      { text: 'http://b.dev/x', url: 'http://b.dev/x' },
      { text: '.' },
    ]);
  });

  test('a link needs its scheme: a bare domain stays text', () => {
    expect(linkSegments('try www.foo.org or foo.com')).toEqual([{ text: 'try www.foo.org or foo.com' }]);
  });

  test('file names that happen to end in a TLD are not links', () => {
    expect(linkSegments('Edited README.md and setup.py')).toEqual([{ text: 'Edited README.md and setup.py' }]);
  });

  test('text without URLs is one plain segment', () => {
    expect(linkSegments('no links here')).toEqual([{ text: 'no links here' }]);
  });

  test('a text that is only a URL is one link', () => {
    expect(linkSegments('https://a.dev/x')).toEqual([{ text: 'https://a.dev/x', url: 'https://a.dev/x' }]);
  });

  test('a scheme the app refuses stays text between links', () => {
    expect(linkSegments('https://a.dev ftp://b.dev https://c.dev')).toEqual([
      { text: 'https://a.dev', url: 'https://a.dev' },
      { text: ' ftp://b.dev ' },
      { text: 'https://c.dev', url: 'https://c.dev' },
    ]);
  });

  test('the empty string is one empty segment', () => {
    expect(linkSegments('')).toEqual([{ text: '' }]);
  });

  // linkify's scan is quadratic on some inputs ('mailto:' repeated: ~1.2 s at 140 KB on a Mac),
  // and agent output is untrusted: past the cap, text is not scanned at all.
  test('text past the cap is not scanned', () => {
    const huge = 'mailto:'.repeat(20_000);
    const started = Date.now();
    expect(linkSegments(huge)).toEqual([{ text: huge }]);
    expect(Date.now() - started).toBeLessThan(50);
    expect(linkSegments(`https://a.dev ${'x'.repeat(LINKIFY_MAX_CHARS)}`)).toHaveLength(1);
  });
});

describe('LinkifiedText', () => {
  test('URLs are links that open in the browser; the rest stays plain', async () => {
    await render(<LinkifiedText style={{ fontSize: 17 }}>Docs at https://docs.expo.dev today</LinkifiedText>);
    const link = screen.getByRole('link', { name: 'https://docs.expo.dev' });
    await fireEvent.press(link);
    expect(openURL).toHaveBeenCalledWith('https://docs.expo.dev');
    expect(screen.getByText(/Docs at/)).toBeOnTheScreen();
  });
});

describe('MarkdownView', () => {
  test('a bare URL in a reply is a link that opens in the browser', async () => {
    await render(<MarkdownView text="Read https://example.com/guide for more." />);
    await fireEvent.press(screen.getByRole('link', { name: 'https://example.com/guide' }));
    expect(openURL).toHaveBeenCalledWith('https://example.com/guide');
  });

  test('a markdown link opens its target', async () => {
    await render(<MarkdownView text="See [the guide](https://example.com/guide)." />);
    await fireEvent.press(screen.getByRole('link', { name: 'the guide' }));
    expect(openURL).toHaveBeenCalledWith('https://example.com/guide');
  });

  test.each(['hermesmobileapp://settings', 'tel:5551234', 'ftp://files.example.com', 'javascript:alert(1)'])(
    'a markdown link to %s is plain text, not a dead link',
    async (href) => {
      await render(<MarkdownView text={`[open it](${href})`} />);
      expect(screen.queryByRole('link')).toBeNull();
      await fireEvent.press(screen.getByText(/open it/));
      expect(openURL).not.toHaveBeenCalled();
    },
  );

  test.each([
    ['[mail me](mailto:hi@example.com)', 'mail me', 'mailto:hi@example.com'],
    ['[Shout](HTTPS://EXAMPLE.COM/A)', 'Shout', 'HTTPS://EXAMPLE.COM/A'],
  ])('%s opens', async (text, name, url) => {
    await render(<MarkdownView text={text} />);
    await fireEvent.press(screen.getByRole('link', { name }));
    expect(openURL).toHaveBeenCalledWith(url);
  });

  test('past the cap a bare URL is not linked, but a written link still is', async () => {
    const pad = 'word '.repeat(LINKIFY_MAX_CHARS / 5);
    await render(<MarkdownView text={`${pad}\n\nhttps://example.com/bare and [docs](https://example.com/docs)`} />);
    expect(screen.queryByRole('link', { name: 'https://example.com/bare' })).toBeNull();
    await fireEvent.press(screen.getByRole('link', { name: 'docs' }));
    expect(openURL).toHaveBeenCalledWith('https://example.com/docs');
  });

  test('a file name is not linked', async () => {
    await render(<MarkdownView text="Updated README.md." />);
    expect(screen.queryByRole('link')).toBeNull();
  });

  test('a URL inside inline code stays code', async () => {
    await render(<MarkdownView text="Run `curl https://example.com`." />);
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('transcript', () => {
  test('a URL in your own message is a link', async () => {
    await render(<MessageRow item={{ key: 'u', role: 'user', text: 'look at https://github.com/gldc', complete: true }} />);
    await fireEvent.press(screen.getByRole('link', { name: 'https://github.com/gldc' }));
    expect(openURL).toHaveBeenCalledWith('https://github.com/gldc');
  });

  test('a URL in tool output is a link once the detail is open', async () => {
    await render(
      <MessageRow
        item={{
          key: 't',
          role: 'tool',
          text: 'web_fetch',
          tool: { id: 't', name: 'web_fetch', running: false, detail: '{"url": "https://example.com/x"}' },
        }}
      />,
    );
    await fireEvent.press(screen.getByRole('button'));
    await fireEvent.press(screen.getByRole('link', { name: 'https://example.com/x' }));
    expect(openURL).toHaveBeenCalledWith('https://example.com/x');
  });
});
