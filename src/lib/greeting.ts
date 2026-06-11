/** Time-of-day greeting for the new-chat screen, in the style of the big
 * chat apps. Pure function of the hour so it's testable and stable. */
export function greetingForHour(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 18) return 'Back at it';
  if (hour >= 18 && hour < 23) return 'Good evening';
  return 'Up late?';
}
