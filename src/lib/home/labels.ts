/**
 * Labels for home widgets, built on the server with fixed names. Never
 * toLocale* or Intl: a label formatted differently on the server and in the
 * browser is a hydration error (React #418 on Linux WebKit).
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-13" as "13 Nov". */
export function dayMonth(dateStr: string): string {
  const [, m, d] = dateStr.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}
