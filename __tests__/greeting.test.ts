import { greetingForHour } from '../src/lib/greeting';

describe('greetingForHour', () => {
  it('morning hours', () => {
    expect(greetingForHour(5)).toBe('Good morning');
    expect(greetingForHour(11)).toBe('Good morning');
  });

  it('afternoon hours', () => {
    expect(greetingForHour(12)).toBe('Back at it');
    expect(greetingForHour(17)).toBe('Back at it');
  });

  it('evening hours', () => {
    expect(greetingForHour(18)).toBe('Good evening');
    expect(greetingForHour(22)).toBe('Good evening');
  });

  it('late night wraps past midnight', () => {
    expect(greetingForHour(23)).toBe('Up late?');
    expect(greetingForHour(0)).toBe('Up late?');
    expect(greetingForHour(4)).toBe('Up late?');
  });
});
