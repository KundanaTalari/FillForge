const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function underThousand(value: number): string {
  const parts: string[] = [];
  if (value >= 100) parts.push(`${ONES[Math.floor(value / 100)]} Hundred`);
  const rest = value % 100;
  if (rest >= 20) parts.push(`${TENS[Math.floor(rest / 10)]}${rest % 10 ? ` ${ONES[rest % 10]}` : ''}`);
  else if (rest) parts.push(ONES[rest]);
  return parts.join(' ');
}

export function amountToIndianRupeesWords(value: number | string): string {
  const amount = Math.round(Number(String(value).replace(/[^0-9.-]/g, '')) || 0);
  if (amount <= 0) return '';
  let remaining = amount;
  const parts: string[] = [];
  const crore = Math.floor(remaining / 10_000_000); remaining %= 10_000_000;
  const lakh = Math.floor(remaining / 100_000); remaining %= 100_000;
  const thousand = Math.floor(remaining / 1_000); remaining %= 1_000;
  if (crore) parts.push(`${underThousand(crore)} Crore`);
  if (lakh) parts.push(`${underThousand(lakh)} Lakh`);
  if (thousand) parts.push(`${underThousand(thousand)} Thousand`);
  if (remaining) parts.push(underThousand(remaining));
  return `Rupees ${parts.join(' ')} Only`;
}
