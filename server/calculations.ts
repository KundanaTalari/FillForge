// Dedicated Indian CTC Calculation Engine and Safe Math Evaluator
// Tailored to Indian Statutory Compliance and Corporate Offer Letter Standards (e.g. Nichebit Softech)

export interface CTCComponent {
  raw_value: number;
  formatted_value: string;
}

export type CTCBreakdown = Record<string, CTCComponent>;

export interface CTCParams {
  ctc_total: number | string;
  preset?: 'nichebit' | 'standard' | 'custom';
  basic_mode?: 'statutory_min' | 'percentage' | 'fixed';
  basic_value?: number | string; // e.g. 15000 or 50%
  hra_rate_pct?: number | string; // 10% (Nichebit standard), 40%, 50%
  basic_pf?: number | string; // 1800
  pf_mode?: 'fixed' | 'percentage';
  pf_percentage?: number | string; // 12
  insurance_annual?: number | string; // 8000
}

export function formatINR(val: number | string): string {
  if (val === '—' || val === '-' || val === '') return '—';
  const n = Number(val);
  if (isNaN(n)) return String(val);

  const isNegative = n < 0;
  const absVal = Math.abs(n);
  const rounded = Math.round(absVal * 100) / 100;
  const parts = rounded.toFixed(2).split('.');
  const intPart = parts[0];
  const decPart = parts[1];

  let formattedInt = intPart;
  if (intPart.length > 3) {
    const last3 = intPart.substring(intPart.length - 3);
    let remaining = intPart.substring(0, intPart.length - 3);
    const groups: string[] = [];
    while (remaining.length > 2) {
      groups.unshift(remaining.substring(remaining.length - 2));
      remaining = remaining.substring(0, remaining.length - 2);
    }
    if (remaining.length > 0) {
      groups.unshift(remaining);
    }
    groups.push(last3);
    formattedInt = groups.join(',');
  }

  const res = decPart && decPart !== '00' ? `₹${formattedInt}.${decPart}` : `₹${formattedInt}`;
  return isNegative ? `-${res}` : res;
}

export function round(val: number, places = 2): number {
  const mult = Math.pow(10, places);
  return Math.round(val * mult) / mult;
}

export function calculateCTC(
  ctcTotal: number | string,
  basicPf: number | string = 1800,
  pfMode: 'fixed' | 'percentage' = 'fixed',
  pfPercentage: number | string = 12,
  preset: 'nichebit' | 'standard' | 'custom' = 'nichebit',
  hraRatePct: number | string = 10,
  customInsuranceAnnual: number | string = 8000,
  basicMode: 'statutory_min' | 'percentage' | 'fixed' = 'statutory_min'
): CTCBreakdown {
  const ctc = Math.max(0, Number(ctcTotal) || 0);
  const pfFixed = Math.max(0, Number(basicPf) || 1800);
  const pfPct = Math.max(0, Number(pfPercentage) || 12) / 100;
  const isNichebit = preset === 'nichebit';

  // 1. Basic Salary & Dearness Allowance
  let monthlyBasic = 15000;
  let annualBasic = 180000;

  if (isNichebit) {
    // Under Nichebit / statutory rule: ₹15,000/mo minimum for PF wage threshold, or 50% of CTC if CTC is higher
    if (ctc <= 360000) {
      monthlyBasic = 15000;
      annualBasic = 180000;
    } else {
      monthlyBasic = Math.max(15000, round((ctc * 0.5) / 12, 0));
      annualBasic = monthlyBasic * 12;
    }
  } else if (preset === 'standard') {
    // Standard corporate 50-25 rule
    annualBasic = round(ctc / 2, 2);
    monthlyBasic = round(annualBasic / 12, 2);
  } else {
    // Custom mode
    if (basicMode === 'percentage') {
      const pct = Math.max(1, Math.min(100, Number(hraRatePct) || 50)) / 100;
      annualBasic = round(ctc * pct, 2);
      monthlyBasic = round(annualBasic / 12, 2);
    } else if (basicMode === 'fixed') {
      monthlyBasic = Math.max(0, Number(basicPf) || 15000);
      annualBasic = monthlyBasic * 12;
    } else {
      monthlyBasic = Math.max(15000, round((ctc * 0.5) / 12, 0));
      annualBasic = monthlyBasic * 12;
    }
  }

  // 2. House Rent Allowance (HRA)
  let annualHra = 0;
  let monthlyHra = 0;

  if (isNichebit) {
    // In Nichebit offer letter, HRA is strictly 10% of Basic
    monthlyHra = round(monthlyBasic * 0.1, 2);
    annualHra = monthlyHra * 12;
  } else if (preset === 'standard') {
    // 50% of Basic (25% of CTC)
    annualHra = round(annualBasic * 0.5, 2);
    monthlyHra = round(annualHra / 12, 2);
  } else {
    const rate = Math.max(0, Number(hraRatePct) || 10) / 100;
    monthlyHra = round(monthlyBasic * rate, 2);
    annualHra = monthlyHra * 12;
  }

  // 3. Provident Fund (PF)
  let pfPerYear = 0;
  let pfPerMonth = 0;
  if (pfMode === 'percentage') {
    pfPerMonth = round(monthlyBasic * pfPct, 2);
    pfPerYear = pfPerMonth * 12;
  } else {
    pfPerMonth = round(pfFixed, 2);
    pfPerYear = round(pfFixed * 12, 2);
  }

  // 4. Gratuity (Accrual)
  // Gratuity in India: (15 / 26) * (Monthly Basic) / 12 per month
  // In Nichebit offer letter for ₹15,000 basic: 721.15 rounded up gives ₹722/mo and ₹8,664/yr
  let gratuityPerMonth = 0;
  let gratuityPerYear = 0;
  if (isNichebit || preset === 'standard') {
    gratuityPerMonth = Math.ceil((monthlyBasic * 15) / 26 / 12);
    gratuityPerYear = gratuityPerMonth * 12;
  } else {
    gratuityPerYear = round(annualBasic * 0.0481, 2);
    gratuityPerMonth = round(gratuityPerYear / 12, 2);
  }

  // 5. Group Medical & Accidental Insurance
  const insuranceAnnual = isNichebit
    ? 8000
    : preset === 'standard'
    ? 0
    : Math.max(0, Number(customInsuranceAnnual) || 0);
  const insuranceMonthly = 0; // In offer letter it's annual lump sum "—"

  // 6. Special Allowance (Balancing figure so Total = CTC)
  const statutoryAndBenefits =
    annualBasic + annualHra + pfPerYear + gratuityPerYear + insuranceAnnual;
  const specialAllowance = round(ctc - statutoryAndBenefits, 2);
  const monthlySpecialAllowance = round(specialAllowance / 12, 0);

  // 7. Gross Monthly & Annual Salary
  const grossMonthlySalary = round(
    monthlyBasic + monthlyHra + monthlySpecialAllowance,
    2
  );
  const grossAnnualSalary = round(
    annualBasic + annualHra + specialAllowance,
    2
  );

  // 8. Total Fixed Compensation (Gross + PF + Gratuity + Insurance)
  const totalFixedMonthly = round(
    grossMonthlySalary + pfPerMonth + gratuityPerMonth,
    2
  );
  const totalFixedAnnual = ctc;

  // 9. Total Monthly CTC
  const monthlyCtc = totalFixedMonthly;

  const rawMap: Record<string, number> = {
    ctc_total: ctc,
    annual_basic: annualBasic,
    basic_per_month: monthlyBasic,
    annual_basic_da: annualBasic,
    basic_da_per_month: monthlyBasic,
    annual_hra: annualHra,
    hra_per_month: monthlyHra,
    special_allowance: specialAllowance,
    monthly_special_allowance: monthlySpecialAllowance,
    gross_annual_salary: grossAnnualSalary,
    gross_monthly_salary: grossMonthlySalary,
    pf_per_year: pfPerYear,
    pf_per_month: pfPerMonth,
    gratuity_per_year: gratuityPerYear,
    gratuity_per_month: gratuityPerMonth,
    insurance_per_year: insuranceAnnual,
    insurance_per_month: insuranceMonthly,
    insurance_annual: insuranceAnnual,
    insurance_monthly: insuranceMonthly,
    total_fixed_annual: totalFixedAnnual,
    total_fixed_monthly: totalFixedMonthly,
    monthly_ctc: monthlyCtc,
    ctc_per_month: monthlyCtc,
  };

  const result: CTCBreakdown = {};
  for (const [k, v] of Object.entries(rawMap)) {
    if (
      (k === 'insurance_per_month' || k === 'insurance_monthly') &&
      v === 0
    ) {
      result[k] = {
        raw_value: 0,
        formatted_value: '—',
      };
    } else {
      result[k] = {
        raw_value: v,
        formatted_value: formatINR(v),
      };
    }
  }

  return result;
}

// Safely evaluates math expressions like `{{ctc_total}} / 12`
export function evaluateSafeExpression(
  expression: string,
  context: Record<string, any>
): number | null {
  if (!expression || typeof expression !== 'string') return null;

  let expr = expression.trim();

  // Replace {{var}} in expression
  expr = expr.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, varName) => {
    const val = context[varName];
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      const n = Number(val);
      if (!isNaN(n)) return String(n);
    }
    return '0';
  });

  // Strict whitelist for arithmetic safety
  if (!/^[0-9+\-*/().\s]+$/.test(expr)) {
    return null;
  }

  try {
    const fn = new Function(`"use strict"; return (${expr});`);
    const res = fn();
    if (typeof res === 'number' && !isNaN(res) && isFinite(res)) {
      return round(res, 2);
    }
  } catch {
    return null;
  }

  return null;
}
