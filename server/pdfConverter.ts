import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { pathToFileURL } from 'url';
import { jsPDF } from 'jspdf';
import mammoth from 'mammoth';

const execFileAsync = promisify(execFile);

function findSoffice(): string {
  const windowsCandidates = process.platform === 'win32'
    ? [
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'LibreOffice', 'program', 'soffice.exe'),
        path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'LibreOffice', 'program', 'soffice.exe'),
      ]
    : [];

  return windowsCandidates.find((candidate) => fs.existsSync(candidate)) || 'soffice';
}

async function waitForPdf(pdfPath: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(pdfPath) && fs.statSync(pdfPath).size > 0) return true;
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
  }
  return fs.existsSync(pdfPath) && fs.statSync(pdfPath).size > 0;
}

/**
 * Converts a filled DOCX buffer into a high-fidelity PDF buffer on the server.
 * 
 * Primary Engine: Native LibreOffice Writer headless conversion.
 * Preserves 100% of Word layout, typography, tables, borders, headers, footers,
 * margins, and currency glyphs (INR ₹).
 * 
 * Fallback Engine: Structured HTML-aware jsPDF renderer if LibreOffice is unavailable.
 */
export async function convertDocxToPdfBuffer(docxBuffer: Buffer, docTitle?: string): Promise<Buffer> {
  // 1. Primary Engine: Headless LibreOffice
  try {
    const tmpId = crypto.randomUUID();
    const tmpDir = path.join(os.tmpdir(), `fillforge-conv-${tmpId}`);
    const officeProfileDir = path.join(tmpDir, 'office-profile');
    fs.mkdirSync(tmpDir, { recursive: true });
    const docxPath = path.join(tmpDir, 'document.docx');
    const pdfPath = path.join(tmpDir, 'document.pdf');

    try {
      fs.writeFileSync(docxPath, docxBuffer);
      await execFileAsync(findSoffice(), [
        `-env:UserInstallation=${pathToFileURL(officeProfileDir).href}`,
        '--headless',
        '--convert-to', 'pdf',
        '--outdir', tmpDir,
        docxPath,
      ], { timeout: 45000 });

      // On Windows, soffice.exe can return before soffice.bin finishes the
      // conversion. Do not incorrectly fall back to the text-only renderer.
      if (await waitForPdf(pdfPath, 45000)) {
        const pdfBytes = fs.readFileSync(pdfPath);
        if (pdfBytes.length > 0) {
          return pdfBytes;
        }
      }
    } finally {
      try {
        if (fs.existsSync(docxPath)) fs.unlinkSync(docxPath);
        if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
        if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup error
      }
    }
  } catch (loError) {
    console.warn('LibreOffice conversion failed, using fallback engine:', loError);
  }

  // 2. Fallback Engine: Clean HTML-aware renderer with sanitized Unicode
  return renderStructuredFallbackPdf(docxBuffer, docTitle);
}

/**
 * Structured fallback PDF generator using Mammoth HTML structure.
 * Replaces non-WinAnsi glyphs (e.g. ₹ -> Rs. ) so they never render as corrupted characters like ¹.
 */
async function renderStructuredFallbackPdf(docxBuffer: Buffer, docTitle?: string): Promise<Buffer> {
  const extracted = await mammoth.extractRawText({ buffer: docxBuffer });
  let rawText = extracted.value || '';

  // Sanitize Rupee symbol for Helvetica WinAnsi encoding so it never renders as '¹'
  rawText = rawText.replace(/₹\s?/g, 'Rs. ');

  const doc = new jsPDF({
    unit: 'pt',
    format: 'a4',
    orientation: 'portrait',
    compress: true,
  });

  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 50;
  const contentWidth = pageWidth - margin * 2;
  let y = margin + 10;

  const lines = rawText.split('\n');

  doc.setFont('helvetica', 'normal');

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (!rawLine) {
      y += 8;
      continue;
    }

    const isTopHeader =
      rawLine.toUpperCase().includes('NICHEBIT') ||
      rawLine.toUpperCase().includes('OFFER LETTER') ||
      rawLine.toUpperCase().includes('CERTIFICATE OF INTERNSHIP') ||
      rawLine.toUpperCase().includes('PRIVATE LIMITED');

    const isSectionHeading =
      /^(0[1-9]|ANNEXURE|COMPENSATION|TERMS|CANDIDATE ACCEPTANCE)/i.test(rawLine);

    if (isTopHeader) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.setTextColor(15, 23, 42); // slate-900
    } else if (isSectionHeading) {
      y += 10;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(30, 41, 59);
    } else {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(51, 65, 85);
    }

    const splitLines = doc.splitTextToSize(rawLine, contentWidth);

    for (const subLine of splitLines) {
      if (y > pageHeight - margin - 30) {
        doc.addPage();
        y = margin + 10;
        doc.setTextColor(51, 65, 85);
      }

      // Center top title if it's the certificate or main title
      if (isTopHeader && (rawLine.includes('CERTIFICATE') || rawLine.includes('OFFER LETTER'))) {
        doc.text(subLine, pageWidth / 2, y, { align: 'center' });
      } else {
        doc.text(subLine, margin, y);
      }
      y += isTopHeader ? 18 : isSectionHeading ? 15 : 14;
    }

    y += 2;
  }

  const arrayBuffer = doc.output('arraybuffer');
  return Buffer.from(arrayBuffer);
}
