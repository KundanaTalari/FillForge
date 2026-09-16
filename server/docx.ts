import PizZip from 'pizzip';
import { calculateCTC, evaluateSafeExpression, formatINR } from './calculations';

export interface PlaceholderMeta {
  name: string;
  type: string;
  required: boolean;
  calculated: boolean;
  description: string;
}

export interface DocumentRecord {
  id: string;
  name: string;
  filename: string;
  placeholders: PlaceholderMeta[];
  created_at: string;
}

const CALCULATED_FIELD_NAMES = new Set([
  'annual_basic',
  'basic_per_month',
  'annual_basic_da',
  'basic_da_per_month',
  'annual_hra',
  'hra_per_month',
  'special_allowance',
  'monthly_special_allowance',
  'gross_annual_salary',
  'gross_monthly_salary',
  'pf_per_year',
  'pf_per_month',
  'gratuity_per_year',
  'gratuity_per_month',
  'insurance_per_year',
  'insurance_per_month',
  'insurance_annual',
  'insurance_monthly',
  'total_fixed_annual',
  'total_fixed_monthly',
  'monthly_ctc',
  'ctc_per_month',
]);

export function splitIdentifierTokens(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function detectVariableType(name: string): string {
  const tokens = splitIdentifierTokens(name);
  const tokenSet = new Set(tokens);
  const lower = name.toLowerCase();

  // 1. Boolean flags (e.g. is_remote, has_bonus, can_relocate)
  if (/^(is|has|can|should|enable|allow)_/i.test(name) || tokenSet.has('boolean')) {
    return 'boolean';
  }

  // 2. Date fields: Only match when "date", "dob", "doj", "deadline", "expiry", "anniversary" is a discrete word token
  // PREVENTS false positives like "candidate" (which contains the letters d-a-t-e), "update", "mandate", "validate"
  if (
    tokenSet.has('date') ||
    tokenSet.has('dob') ||
    tokenSet.has('doj') ||
    tokenSet.has('deadline') ||
    tokenSet.has('expiry') ||
    tokenSet.has('anniversary') ||
    tokenSet.has('birthdate') ||
    tokenSet.has('effective_date')
  ) {
    return 'date';
  }

  // 3. Time fields: Only match when "time", "hour", "hours" is a discrete word token or identifier ends with _time
  // PREVENTS false positives like "estimate", "sentiment", "legitimate", "optimum"
  if (
    tokenSet.has('time') ||
    tokenSet.has('hour') ||
    tokenSet.has('hours') ||
    lower.endsWith('_time')
  ) {
    return 'time';
  }

  // 4. Email fields
  if (tokenSet.has('email') || tokenSet.has('mail')) {
    return 'email';
  }

  // 5. Phone / Mobile numbers
  if (
    tokenSet.has('phone') ||
    tokenSet.has('mobile') ||
    tokenSet.has('telephone') ||
    tokenSet.has('contact') ||
    tokenSet.has('tel') ||
    tokenSet.has('cell')
  ) {
    return 'phone';
  }

  // 6. Percentage fields (e.g. pf_percentage, tax_rate, hike_pct)
  // Check exact token or ends with _rate / _pct (prevents matching "corporate", "accurate", "separate")
  if (
    tokenSet.has('percentage') ||
    tokenSet.has('pct') ||
    tokenSet.has('percent') ||
    lower.endsWith('_rate') ||
    lower.endsWith('_pct') ||
    lower.endsWith('_percentage')
  ) {
    return 'percentage';
  }

  // 7. Currency / Salary fields (e.g. ctc_total, basic, hra, salary, stipend, bonus, allowance, gratuity)
  if (
    tokenSet.has('ctc') ||
    tokenSet.has('salary') ||
    tokenSet.has('stipend') ||
    tokenSet.has('basic') ||
    tokenSet.has('hra') ||
    tokenSet.has('pf') ||
    tokenSet.has('gratuity') ||
    tokenSet.has('bonus') ||
    tokenSet.has('allowance') ||
    tokenSet.has('compensation') ||
    tokenSet.has('reimbursement') ||
    tokenSet.has('wage') ||
    tokenSet.has('wages') ||
    tokenSet.has('inr') ||
    tokenSet.has('amount') ||
    tokenSet.has('fee') ||
    tokenSet.has('fees')
  ) {
    return 'currency';
  }

  // 8. Numeric count/quantity
  if (
    tokenSet.has('count') ||
    tokenSet.has('qty') ||
    tokenSet.has('quantity') ||
    tokenSet.has('age') ||
    tokenSet.has('number') ||
    tokenSet.has('num')
  ) {
    return 'number';
  }

  // 9. Default to text (covers names, designations, addresses, departments, company name, etc.)
  return 'text';
}

export function escapeXml(unsafe: any): string {
  if (unsafe === undefined || unsafe === null) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function cleanWordXmlPlaceholders(xml: string): string {
  // When Microsoft Word documents are edited, Word frequently fragments text runs (<w:r><w:t>)
  // within a paragraph, splitting tags like {{candidate_name}} or [CALC(...)] across multiple runs.
  // This cleans and reconciles split {{...}} and [CALC(...)] tags without altering any styling.
  // CRITICAL: Strictly scoped to within each paragraph (<w:p>...</w:p>) to prevent crossing table cells or rows.
  if (!xml || typeof xml !== 'string') return xml;

  return xml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (pMatch) => {
    let prev = '';
    let p = pMatch;
    let iter = 0;
    const runSplitMustache =
      /(\{\{[a-zA-Z0-9_]*?)(<\/w:t><\/w:r>(?:(?!<\/w:r>|<w:p|<\/w:p|<w:tc|<\/w:tc|<w:tr|<\/w:tr)[\s\S])*?<w:r[^>]*?>(?:<w:rPr>[\s\S]*?<\/w:rPr>)?<w:t[^>]*?>)([a-zA-Z0-9_]*?\}\})/g;
    const runSplitCalc =
      /(\[CALC\([^[\]]*?)(<\/w:t><\/w:r>(?:(?!<\/w:r>|<w:p|<\/w:p|<w:tc|<\/w:tc|<w:tr|<\/w:tr)[\s\S])*?<w:r[^>]*?>(?:<w:rPr>[\s\S]*?<\/w:rPr>)?<w:t[^>]*?>)([^[\]]*?\])/g;

    while (p !== prev && iter < 8) {
      prev = p;
      iter++;
      p = p.replace(runSplitMustache, '$1$3');
      p = p.replace(runSplitCalc, '$1$3');
    }
    return p;
  });
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function replaceTagsInWordXml(
  xml: string,
  resolve: (tag: string, expression: string) => string | null
): string {
  // Work on decoded text-node content while leaving all surrounding Word XML intact.
  return xml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (paragraph) => {
    const nodes: Array<{ start: number; end: number; text: string }> = [];
    const textPattern = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
    let match: RegExpExecArray | null;
    let fullText = '';

    while ((match = textPattern.exec(paragraph)) !== null) {
      const text = decodeXmlText(match[1]);
      nodes.push({ start: fullText.length, end: fullText.length + text.length, text });
      fullText += text;
    }

    if (!nodes.length) return paragraph;

    const replacements: Array<{ start: number; end: number; value: string }> = [];
    const tagPattern = /\[CALC\(([^[\]]*?)\)\]|\{\{([a-zA-Z0-9_]+)\}\}/g;
    let tagMatch: RegExpExecArray | null;
    while ((tagMatch = tagPattern.exec(fullText)) !== null) {
      const expression = tagMatch[1];
      const tag = tagMatch[2];
      const value = resolve(tag || '', expression || '');
      if (value !== null) {
        replacements.push({ start: tagMatch.index, end: tagMatch.index + tagMatch[0].length, value });
      }
    }

    if (!replacements.length) return paragraph;

    let nodeIndex = 0;
    return paragraph.replace(textPattern, (nodeXml, text: string) => {
      const node = nodes[nodeIndex++];
      const decoded = node.text;
      let output = '';

      for (let offset = 0; offset < decoded.length;) {
        const position = node.start + offset;
        const replacement = replacements.find((item) => item.start === position);
        if (replacement) {
          output += escapeXml(replacement.value);
          offset += replacement.end - replacement.start;
          continue;
        }

        const covered = replacements.find((item) => position > item.start && position < item.end);
        if (covered) {
          offset++;
          continue;
        }

        output += decoded[offset++];
      }

      return nodeXml.replace(text, () => escapeXml(output));
    });
  });
}

export function extractPlaceholdersFromDocxBuffer(buffer: Buffer): PlaceholderMeta[] {
  const zip = new PizZip(buffer);
  const detected = new Set<string>();

  // Scan all xml files in word/ directory (document.xml, header*.xml, footer*.xml)
  Object.keys(zip.files).forEach((filePath) => {
    if (filePath.startsWith('word/') && filePath.endsWith('.xml')) {
      const file = zip.file(filePath);
      if (file) {
        const xml = file.asText();
        xml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (paragraph) => {
          const text = Array.from(paragraph.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g))
            .map((match) => decodeXmlText(match[1]))
            .join('');
          for (const match of text.matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/g)) {
            detected.add(match[1]);
          }
          return paragraph;
        });
      }
    }
  });

  const priorityOrder = [
    'first_name',
    'last_name',
    'employee_id',
    'designation',
    'department',
    'date_of_joining',
    'joining_time',
    'ctc_total',
    'salary',
    'basic_pf',
    'email',
    'phone',
  ];

  const sortedVars = Array.from(detected).sort((a, b) => {
    const aCalc = CALCULATED_FIELD_NAMES.has(a) ? 1 : 0;
    const bCalc = CALCULATED_FIELD_NAMES.has(b) ? 1 : 0;
    if (aCalc !== bCalc) return aCalc - bCalc;

    const aPri = priorityOrder.indexOf(a) !== -1 ? priorityOrder.indexOf(a) : 999;
    const bPri = priorityOrder.indexOf(b) !== -1 ? priorityOrder.indexOf(b) : 999;
    if (aPri !== bPri) return aPri - bPri;

    return a.localeCompare(b);
  });

  return sortedVars.map((v) => {
    const isCalc = CALCULATED_FIELD_NAMES.has(v);
    return {
      name: v,
      type: detectVariableType(v),
      required: !isCalc,
      calculated: isCalc,
      description: isCalc
        ? `Computed ${v.replace(/_/g, ' ')}`
        : `Enter ${v.replace(/_/g, ' ')}`,
    };
  });
}

export function renderDocxBuffer(
  templateBuffer: Buffer,
  values: Record<string, any>,
  pfMode: 'fixed' | 'percentage' = 'fixed',
  pfPercentage = 12
): Buffer {
  const zip = new PizZip(templateBuffer);

  // 1. Context preparation
  const context: Record<string, any> = { ...values };

  const ctcVal = values.ctc_total || values.salary || values.ctc;
  if (ctcVal !== undefined && ctcVal !== null && String(ctcVal).trim() !== '') {
    const basicPf = values.basic_pf ?? 1800;
    const preset = values.ctc_preset || 'nichebit';
    const hraRatePct = values.hra_rate_pct ?? 10;
    const insuranceAnnual = values.insurance_annual ?? 8000;
    const basicMode = values.basic_mode ?? 'statutory_min';

    const breakdown = calculateCTC(
      ctcVal,
      basicPf,
      pfMode,
      pfPercentage,
      preset,
      hraRatePct,
      insuranceAnnual,
      basicMode
    );
    for (const [k, obj] of Object.entries(breakdown)) {
      context[k] = obj.formatted_value;
      context[`${k}_raw`] = obj.raw_value;
    }
  }

  // Format any input currency values if entered as raw numbers
  for (const [k, v] of Object.entries(values)) {
    if (
      (k === 'ctc_total' || k === 'salary') &&
      typeof v === 'number' &&
      !isNaN(v)
    ) {
      context[k] = formatINR(v);
    }
  }

  if (values.first_name && values.last_name && !values.employee_name) {
    context.employee_name = `${values.first_name} ${values.last_name}`.trim();
  }

  // 2. Replace only resolved text tags across Word XML files.
  Object.keys(zip.files).forEach((filePath) => {
    if (filePath.startsWith('word/') && filePath.endsWith('.xml')) {
      const file = zip.file(filePath);
      if (!file) return;

      // Build key map for flexible tag replacement (exact and normalized)
      const contextNorm = new Map<string, any>();
      for (const [k, v] of Object.entries(context)) {
        if (v !== undefined && v !== null) {
          contextNorm.set(k, v);
          contextNorm.set(k.toLowerCase(), v);
          contextNorm.set(k.replace(/_/g, '').toLowerCase(), v);
        }
      }

      const xml = replaceTagsInWordXml(file.asText(), (tag, expression) => {
        if (expression) {
          const result = evaluateSafeExpression(expression, context);
          return result !== null ? formatINR(result) : null;
        }

        if (context[tag] !== undefined && context[tag] !== null) {
          return String(context[tag]);
        }
        const tagLower = tag.toLowerCase();
        if (contextNorm.has(tagLower)) {
          return String(contextNorm.get(tagLower));
        }
        const tagNoUnderscore = tagLower.replace(/_/g, '');
        if (contextNorm.has(tagNoUnderscore)) {
          return String(contextNorm.get(tagNoUnderscore));
        }
        return null;
      });

      zip.file(filePath, xml);
    }
  });

  return zip.generate({ type: 'nodebuffer' });
}
