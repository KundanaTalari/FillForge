import PizZip from 'pizzip';
import { CTCBreakdown } from '../types';

/**
 * Normalizes and rejoins Word XML text runs that were fragmented by Microsoft Word.
 * When editing documents in Word, tags like {{candidate_name}} or [CALC(...)] frequently
 * get split across multiple adjacent <w:r><w:t> tags within the same paragraph.
 *
 * CRITICAL: This is strictly scoped to within each individual paragraph (<w:p>...</w:p>)
 * and strictly forbids crossing table cells (<w:tc>), rows (<w:tr>), or paragraphs (<w:p>).
 */
export function cleanWordXmlTags(xml: string): string {
  if (!xml || typeof xml !== 'string') return xml;

  return xml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (pMatch) => {
    let prev = '';
    let p = pMatch;
    let iter = 0;
    // Strictly match adjacent runs within this single paragraph: </w:t></w:r>(proofErr/rPr)<w:r><w:t>
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

export function escapeXmlEntities(unsafe: any): string {
  if (unsafe === undefined || unsafe === null) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatINR(num: number | string): string {
  const n = Number(num);
  if (isNaN(n)) return String(num);
  const hasDecimal = n % 1 !== 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: hasDecimal ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(n);
}

function evaluateClientExpression(
  expression: string,
  context: Record<string, any>
): number | null {
  if (!expression) return null;
  let expr = expression.trim();
  let hasUnfilled = false;

  expr = expr.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, varName) => {
    const val = context[varName] ?? context[varName.toLowerCase()];
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      const n = Number(String(val).replace(/[^0-9.-]+/g, ''));
      if (!isNaN(n)) return String(n);
    }
    hasUnfilled = true;
    return '0';
  });

  if (hasUnfilled) return null;
  if (!/^[0-9+\-*/().\s]+$/.test(expr)) return null;

  try {
    const fn = new Function(`"use strict"; return (${expr});`);
    const res = fn();
    if (typeof res === 'number' && !isNaN(res) && isFinite(res)) {
      return res;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Fills an ArrayBuffer of a .docx file in-memory using PizZip.
 * Retains 100% of the document's original formatting, colors, font families,
 * tables, shading, logos, images, headers, and footers.
 */
export function fillDocxArrayBufferClient(
  sourceBuffer: ArrayBuffer,
  formValues: Record<string, any> = {},
  calculatedValues: CTCBreakdown | null = null,
  highlightFields = false
): ArrayBuffer {
  try {
    const zip = new PizZip(sourceBuffer);
    const context: Record<string, any> = { ...formValues };

    // Inject calculated CTC fields
    if (calculatedValues) {
      for (const [k, obj] of Object.entries(calculatedValues)) {
        context[k] = obj.formatted_value;
        context[`${k}_raw`] = obj.raw_value;
      }
    }

    // Auto-derive full name if split
    if (formValues.first_name && formValues.last_name && !context.employee_name && !context.Name && !context.FullName) {
      context.employee_name = `${formValues.first_name} ${formValues.last_name}`.trim();
      context.candidate_name = context.employee_name;
      context.Name = context.employee_name;
      context.FullName = context.employee_name;
    }

    // Normalization dictionary
    const normMap = new Map<string, any>();
    for (const [k, v] of Object.entries(context)) {
      if (v !== undefined && v !== null) {
        normMap.set(k, v);
        normMap.set(k.toLowerCase(), v);
        normMap.set(k.replace(/_/g, '').toLowerCase(), v);
      }
    }

    const replaceTagsInWordXml = (xml: string): string => {
      return xml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (paragraph) => {
        const nodes: Array<{ start: number; end: number; text: string }> = [];
        const textPattern = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
        let match: RegExpExecArray | null;
        let fullText = '';

        while ((match = textPattern.exec(paragraph)) !== null) {
          const text = match[1]
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'")
            .replace(/&amp;/g, '&');
          nodes.push({ start: fullText.length, end: fullText.length + text.length, text });
          fullText += text;
        }

        const replacements: Array<{ start: number; end: number; value: string }> = [];
        const tagPattern = /\[CALC\(([^[\]]*?)\)\]|\{\{([a-zA-Z0-9_]+)\}\}/g;
        let tagMatch: RegExpExecArray | null;
        while ((tagMatch = tagPattern.exec(fullText)) !== null) {
          const expression = tagMatch[1];
          const tag = tagMatch[2];
          let value: string | null = null;

          if (expression) {
            const result = evaluateClientExpression(expression, context);
            if (result !== null) value = formatINR(result);
          } else if (context[tag] !== undefined && context[tag] !== null && String(context[tag]).trim() !== '') {
            value = String(context[tag]);
          } else {
            const lower = tag.toLowerCase();
            const normalized = lower.replace(/_/g, '');
            if (normMap.has(lower) && String(normMap.get(lower)).trim() !== '') value = String(normMap.get(lower));
            else if (normMap.has(normalized) && String(normMap.get(normalized)).trim() !== '') value = String(normMap.get(normalized));
          }

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
              output += escapeXmlEntities(replacement.value);
              offset += replacement.end - replacement.start;
              continue;
            }
            if (replacements.some((item) => position > item.start && position < item.end)) {
              offset++;
              continue;
            }
            output += decoded[offset++];
          }

          return nodeXml.replace(text, () => escapeXmlEntities(output));
        });
      });
    };

    Object.keys(zip.files).forEach((filePath) => {
      if (filePath.startsWith('word/') && filePath.endsWith('.xml')) {
        const file = zip.file(filePath);
        if (!file) return;

        const xml = replaceTagsInWordXml(file.asText());

        zip.file(filePath, xml);
      }
    });

    return zip.generate({ type: 'arraybuffer' });
  } catch (err) {
    console.warn('Client docx buffer fill fallback to original buffer:', err);
    return sourceBuffer;
  }
}
