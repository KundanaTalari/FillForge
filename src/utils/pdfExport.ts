import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { DocumentMeta, CTCBreakdown } from '../types';

// Format currency for display in PDF
function formatCurrencyINR(val: any): string {
  if (val === undefined || val === null || val === '') return '';
  const num = Number(val);
  if (isNaN(num)) return String(val);
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(num);
}

// Evaluate CALC expressions cleanly for PDF rendering
function evaluateExpr(
  expr: string,
  formValues: Record<string, any>,
  calculations: CTCBreakdown | null
): string | null {
  const normExpr = expr.trim().toLowerCase();
  const directMatch =
    normExpr === 'ctc/2'
      ? calculations?.annual_basic?.formatted_value
      : normExpr === 'ctc/24'
      ? calculations?.basic_per_month?.formatted_value
      : normExpr === 'ctc/4'
      ? calculations?.annual_hra?.formatted_value
      : normExpr === 'ctc/48'
      ? calculations?.hra_per_month?.formatted_value
      : normExpr === 'ctc*0.5'
      ? calculations?.annual_basic?.formatted_value
      : normExpr === 'ctc*0.25'
      ? calculations?.annual_hra?.formatted_value
      : null;

  if (directMatch) return directMatch;

  let resolved = expr;
  const ctcVal = Number(formValues.ctc_total || formValues.salary || formValues.ctc || 0);
  resolved = resolved.replace(/\bctc\b/gi, String(ctcVal));

  for (const [k, v] of Object.entries(formValues)) {
    if (typeof v === 'number' || (typeof v === 'string' && !isNaN(Number(v)) && v.trim() !== '')) {
      const regex = new RegExp(`\\b${k}\\b`, 'gi');
      resolved = resolved.replace(regex, String(v));
    }
  }

  if (calculations) {
    for (const [k, v] of Object.entries(calculations)) {
      if (v && typeof v.raw_value === 'number') {
        const regex = new RegExp(`\\b${k}\\b`, 'gi');
        resolved = resolved.replace(regex, String(v.raw_value));
      }
    }
  }

  try {
    const fn = new Function(`"use strict"; return (${resolved});`);
    const res = fn();
    if (typeof res === 'number' && !isNaN(res) && isFinite(res)) {
      return formatCurrencyINR(res);
    }
  } catch {
    return null;
  }
  return null;
}

// Prepare clean printable HTML without UI edit marks, badges, or debug styling
export function preparePrintableHtml(
  rawHtml: string,
  doc: DocumentMeta | null,
  formValues: Record<string, any>,
  calculations: CTCBreakdown | null
): string {
  if (!rawHtml) return '';
  let html = rawHtml;

  // 1. Process [CALC(...)] expressions
  html = html.replace(/\[CALC\((.*?)\)\]/g, (match, expr) => {
    const evaluated = evaluateExpr(expr, formValues, calculations);
    if (evaluated !== null) {
      return `<strong>${evaluated}</strong>`;
    }
    return '';
  });

  // 2. Process {{placeholder}} tags
  html = html.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (match, varName) => {
    if (calculations && calculations[varName]) {
      return `<strong>${calculations[varName].formatted_value}</strong>`;
    }

    const userVal = formValues[varName];
    if (userVal !== undefined && userVal !== null && String(userVal).trim() !== '') {
      const pMeta = doc?.placeholders.find((p) => p.name === varName);
      if (pMeta?.type === 'currency' && !isNaN(Number(userVal))) {
        return `<strong>${formatCurrencyINR(userVal)}</strong>`;
      }
      return `<strong>${String(userVal)}</strong>`;
    }

    // Default to empty string or clean placeholder
    return '';
  });

  return html;
}

export interface PdfExportOptions {
  document: DocumentMeta;
  rawHtml: string;
  formValues: Record<string, any>;
  calculatedValues: CTCBreakdown | null;
  filename?: string;
}

/**
 * High-fidelity PDF generation using html2canvas and jsPDF.
 * Renders an offscreen A4 container with authentic corporate styling,
 * slices cleanly across standard A4 pages (210mm x 297mm),
 * and triggers automatic browser download of a genuine .pdf file.
 */
export async function generatePdfDocument({
  document,
  rawHtml,
  formValues,
  calculatedValues,
  filename,
}: PdfExportOptions): Promise<{ filename: string; blob: Blob }> {
  // Construct clean filename: <docName>_<empId>_<firstName>_<lastName>.pdf
  const baseName = (document.name || 'document').replace(/\.docx$/i, '');
  const empId = formValues.employee_id || '';
  const first = formValues.first_name || '';
  const last = formValues.last_name || '';
  const nameParts = [baseName, empId, first, last].filter(Boolean);
  const finalFilename = filename || `${nameParts.join('_') || 'offer_letter'}.pdf`;

  const printableHtml = preparePrintableHtml(rawHtml, document, formValues, calculatedValues);

  // Create an offscreen wrapper with exact A4 page width (794px = 210mm at 96 DPI)
  const container = window.document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-9999px';
  container.style.top = '0';
  container.style.width = '794px'; // 210mm at 96dpi
  container.style.backgroundColor = '#ffffff';
  container.style.color = '#0f172a';
  container.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  container.style.fontSize = '12px';
  container.style.lineHeight = '1.6';
  container.style.padding = '44px 50px';
  container.style.boxSizing = 'border-box';
  container.style.zIndex = '-9999';

  // Inject professional styling for typography, tables, and borders
  container.innerHTML = `
    <style>
      .pdf-render-root * {
        box-sizing: border-box;
      }
      .pdf-render-root h1, .pdf-render-root h2, .pdf-render-root h3, .pdf-render-root h4 {
        color: #0f172a;
        margin-top: 14px;
        margin-bottom: 8px;
        font-weight: 700;
        line-height: 1.3;
      }
      .pdf-render-root h1 { font-size: 19px; }
      .pdf-render-root h2 { font-size: 16px; }
      .pdf-render-root h3 { font-size: 14px; }
      .pdf-render-root p {
        margin: 0 0 10px 0;
        color: #1e293b;
      }
      .pdf-render-root table {
        width: 100% !important;
        border-collapse: collapse !important;
        margin: 14px 0 !important;
        font-size: 11px !important;
      }
      .pdf-render-root th {
        background-color: #f1f5f9 !important;
        color: #0f172a !important;
        font-weight: 700 !important;
        border: 1px solid #cbd5e1 !important;
        padding: 6px 10px !important;
        text-align: left !important;
      }
      .pdf-render-root td {
        border: 1px solid #cbd5e1 !important;
        padding: 6px 10px !important;
        color: #1e293b !important;
      }
      .pdf-render-root strong {
        color: #0f172a;
        font-weight: 700;
      }
      .pdf-render-root hr {
        border: 0;
        border-top: 1px solid #e2e8f0;
        margin: 16px 0;
      }
    </style>
    <div class="pdf-render-root">
      ${printableHtml}
    </div>
  `;

  window.document.body.appendChild(container);

  try {
    // Render high-res canvas at scale 2 for crisp 300-DPI-equivalent output
    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
      windowWidth: 794,
    });

    // A4 dimensions in mm: 210 x 297
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true,
    });

    const pageWidth = 210;
    const pageHeight = 297;

    // Convert canvas pixels to mm
    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    // Split across pages
    let heightLeft = imgHeight;
    let position = 0;
    let pageIndex = 0;

    // Slicing approach: Draw page by page from the master canvas
    const pageCanvas = window.document.createElement('canvas');
    const pageCtx = pageCanvas.getContext('2d');
    const canvasPageHeight = (canvas.width * pageHeight) / pageWidth;

    pageCanvas.width = canvas.width;
    pageCanvas.height = canvasPageHeight;

    let sourceY = 0;

    while (sourceY < canvas.height) {
      if (pageIndex > 0) {
        pdf.addPage();
      }

      if (pageCtx) {
        // Clear previous slice
        pageCtx.fillStyle = '#ffffff';
        pageCtx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);

        // Height of this slice
        const sliceHeight = Math.min(canvasPageHeight, canvas.height - sourceY);

        pageCtx.drawImage(
          canvas,
          0,
          sourceY,
          canvas.width,
          sliceHeight,
          0,
          0,
          canvas.width,
          sliceHeight
        );

        const pageDataUrl = pageCanvas.toDataURL('image/jpeg', 0.95);
        pdf.addImage(pageDataUrl, 'JPEG', 0, 0, pageWidth, pageHeight, undefined, 'FAST');
      }

      sourceY += canvasPageHeight;
      pageIndex++;
    }

    const pdfBlob = pdf.output('blob');

    // Trigger download in the browser
    const blobUrl = window.URL.createObjectURL(pdfBlob);
    const downloadLink = window.document.createElement('a');
    downloadLink.href = blobUrl;
    downloadLink.download = finalFilename;
    window.document.body.appendChild(downloadLink);
    downloadLink.click();
    downloadLink.remove();
    window.URL.revokeObjectURL(blobUrl);

    return { filename: finalFilename, blob: pdfBlob };
  } finally {
    if (window.document.body.contains(container)) {
      window.document.body.removeChild(container);
    }
  }
}
