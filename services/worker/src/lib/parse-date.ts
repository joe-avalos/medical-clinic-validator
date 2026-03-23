const MONTHS: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04',
  May: '05', Jun: '06', Jul: '07', Aug: '08',
  Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};

/**
 * Parses OpenCorporates date format ("13 Dec 1905") to ISO 8601 ("1905-12-13").
 */
export function parseOCDate(input: string | undefined | null): string | undefined {
  if (!input) return undefined;

  const match = input.trim().match(/^(\d{1,2})\s+(\w{3})\s+(\d{4})$/);
  if (!match) return undefined;

  const [, day, monthAbbr, year] = match;
  const month = MONTHS[monthAbbr];
  if (!month) return undefined;

  return `${year}-${month}-${day.padStart(2, '0')}`;
}
