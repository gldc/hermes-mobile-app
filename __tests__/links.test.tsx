import { Linking } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { LinkifiedText } from '../src/components/linkified-text';
import { MarkdownView } from '../src/components/markdown-view';
import { MessageRow } from '../src/components/message-row';
import { isOpenableUrl, linkSegments, openExternal } from '../src/lib/links';

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

  test('a markdown link to a refused scheme stays inert', async () => {
    await render(<MarkdownView text="[open settings](hermesmobileapp://settings)" />);
    await fireEvent.press(screen.getByText('open settings'));
    expect(openURL).not.toHaveBeenCalled();
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
