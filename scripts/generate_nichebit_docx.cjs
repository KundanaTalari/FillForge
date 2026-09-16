const fs = require('fs');
const path = require('path');
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  BorderStyle,
  HeadingLevel,
} = require('docx');

async function buildNichebitOfferLetter() {
  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: 'Arial',
            size: 21, // 10.5pt
            color: '1E293B',
          },
          paragraph: {
            spacing: {
              line: 280,
              after: 120,
            },
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1000,
              right: 1200,
              bottom: 1000,
              left: 1200,
            },
          },
        },
        children: [
          // Header
          new Paragraph({
            children: [
              new TextRun({
                text: 'NICHEBIT SOFTECH PRIVATE LIMITED',
                bold: true,
                size: 26,
                color: '0F172A',
              }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: 'Enterprise Integrations · Digital Process Automation · Business Analytics',
                size: 18,
                color: '475569',
              }),
            ],
            spacing: { after: 80 },
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: 'Nichebit Softech Private Limited · Hyderabad, India',
                size: 16,
                color: '64748B',
              }),
            ],
            spacing: { after: 260 },
          }),

          // Offer Letter Title and Metadata
          new Paragraph({
            alignment: AlignmentType.LEFT,
            children: [
              new TextRun({
                text: 'O F F E R   L E T T E R',
                bold: true,
                size: 24,
                color: '1E3A8A',
              }),
            ],
            spacing: { after: 120 },
          }),
          new Paragraph({
            children: [
              new TextRun({ text: 'Ref: NB/HR/OL/2026/{{employee_id}}\n', bold: true, size: 18, color: '64748B' }),
              new TextRun({ text: 'Date: {{date_of_joining}}', size: 18, color: '64748B' }),
            ],
            spacing: { after: 240 },
          }),

          // Salutation
          new Paragraph({
            children: [
              new TextRun({ text: 'Dear ', size: 21 }),
              new TextRun({ text: '{{first_name}} {{last_name}}', bold: true, size: 21 }),
              new TextRun({ text: ',', size: 21 }),
            ],
            spacing: { after: 140 },
          }),

          // Preamble
          new Paragraph({
            children: [
              new TextRun({
                text: "Nichebit Softech Private Limited (hereinafter referred to as 'the Company') is a professional IT Services company incorporated under the laws of India, delivering niche technology solutions specialising in Enterprise Integrations, Digital Process Automation, Business Analytics & Business Intelligence, and Product Life Cycle Management.",
              }),
            ],
            spacing: { after: 140 },
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: 'Based on your application and our subsequent discussions, we are pleased to offer you the position of ',
              }),
              new TextRun({
                text: '{{designation}}',
                bold: true,
              }),
              new TextRun({
                text: ' at the Company, subject to the following terms and conditions:',
              }),
            ],
            spacing: { after: 240 },
          }),

          // Section 01
          new Paragraph({
            children: [
              new TextRun({
                text: '01 · Compensation & Engagement Details',
                bold: true,
                size: 22,
                color: '1E3A8A',
              }),
            ],
            spacing: { before: 180, after: 140 },
          }),
          new Paragraph({
            bullet: { level: 0 },
            children: [
              new TextRun({ text: 'Annual CTC: ', bold: true }),
              new TextRun({ text: 'INR {{ctc_total}}', bold: true }),
              new TextRun({ text: '. The detailed salary breakup is attached in Annexure A.' }),
            ],
          }),
          new Paragraph({
            bullet: { level: 0 },
            children: [
              new TextRun({ text: 'Designation: ', bold: true }),
              new TextRun({ text: '{{designation}}' }),
            ],
          }),
          new Paragraph({
            bullet: { level: 0 },
            children: [
              new TextRun({ text: 'Department: ', bold: true }),
              new TextRun({ text: '{{department}}' }),
            ],
          }),
          new Paragraph({
            bullet: { level: 0 },
            children: [
              new TextRun({ text: 'Probation Period: ', bold: true }),
              new TextRun({ text: '3 months. The Company reserves the right to extend probation by up to three additional months in specific cases.' }),
            ],
          }),
          new Paragraph({
            bullet: { level: 0 },
            children: [
              new TextRun({ text: 'Type of Engagement: ', bold: true }),
              new TextRun({ text: 'Regular Employment' }),
            ],
          }),
          new Paragraph({
            bullet: { level: 0 },
            children: [
              new TextRun({ text: 'Location: ', bold: true }),
              new TextRun({ text: '{{location}}' }),
            ],
          }),
          new Paragraph({
            bullet: { level: 0 },
            children: [
              new TextRun({ text: 'Date of Commencement: ', bold: true }),
              new TextRun({ text: '{{date_of_joining}}' }),
            ],
            spacing: { after: 200 },
          }),

          // Section 02
          new Paragraph({
            children: [
              new TextRun({
                text: '02 · Terms of Employment',
                bold: true,
                size: 22,
                color: '1E3A8A',
              }),
            ],
            spacing: { before: 180, after: 140 },
          }),
          new Paragraph({
            bullet: { level: 0 },
            children: [
              new TextRun({ text: 'Notice Period - Probation: ', bold: true }),
              new TextRun({ text: 'During probation, management may terminate services with cause or without notice. Resignation during probation requires one month basic salary pay or training cost recovery.' }),
            ],
          }),
          new Paragraph({
            bullet: { level: 0 },
            children: [
              new TextRun({ text: 'Notice Period - Post Confirmation: ', bold: true }),
              new TextRun({ text: 'Following confirmation of employment, a 90-day notice period applies for resignation.' }),
            ],
          }),
          new Paragraph({
            bullet: { level: 0 },
            children: [
              new TextRun({ text: 'Background Verification: ', bold: true }),
              new TextRun({ text: 'The Company reserves the right to conduct comprehensive background checks.' }),
            ],
            spacing: { after: 200 },
          }),

          // Section 03 & 04
          new Paragraph({
            children: [
              new TextRun({
                text: '03 · Documents Required at Joining',
                bold: true,
                size: 22,
                color: '1E3A8A',
              }),
            ],
            spacing: { before: 180, after: 120 },
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: 'Please furnish passport-size photograph, educational marksheets, digital copy of Aadhaar and PAN Card, relieving letter and previous 3 months payslips at the time of joining.',
                size: 19,
                color: '334155',
              }),
            ],
            spacing: { after: 240 },
          }),

          // Signatures
          new Paragraph({
            children: [
              new TextRun({ text: 'We look forward to a long-standing and mutually enriching association. Welcome to the Nichebit family!\n\n', bold: true, color: '1E3A8A' }),
              new TextRun({ text: 'For Nichebit Softech Private Limited\n', bold: true }),
              new TextRun({ text: 'Apparao Mutyala\nSenior Manager — Human Resources', color: '475569' }),
            ],
            spacing: { after: 300 },
          }),

          // Page Break to Compensation Table (Page 4)
          new Paragraph({
            pageBreakBefore: true,
            children: [
              new TextRun({
                text: 'Compensation Breakdown · Cost to Company (CTC)',
                bold: true,
                size: 26,
                color: '0F172A',
              }),
            ],
            spacing: { after: 80 },
          }),
          new Paragraph({
            children: [
              new TextRun({ text: 'Employee Name: ', bold: true }),
              new TextRun({ text: '{{first_name}} {{last_name}}    |    ' }),
              new TextRun({ text: 'Designation: ', bold: true }),
              new TextRun({ text: '{{designation}}    |    ' }),
              new TextRun({ text: 'Total CTC: ', bold: true }),
              new TextRun({ text: 'INR {{ctc_total}}', bold: true }),
            ],
            spacing: { after: 200 },
          }),

          // Table
          createTable(),

          // Footnote
          new Paragraph({
            children: [
              new TextRun({
                text: '* The Performance Bonus is paid at the end of each financial year, based on individual and Company performance, entirely at the discretion of the Company, and shall not exceed 15% of the employee’s gross annual salary.',
                size: 17,
                color: '64748B',
                italics: true,
              }),
            ],
            spacing: { before: 180, after: 240 },
          }),

          // Acceptance Sign-off
          new Paragraph({
            children: [
              new TextRun({ text: 'CANDIDATE ACCEPTANCE\n', bold: true, size: 20, color: '1E3A8A' }),
              new TextRun({ text: 'I hereby accept the terms and conditions of this offer.\n\n', size: 19 }),
              new TextRun({ text: 'Signature: _________________________________\n', size: 19 }),
              new TextRun({ text: 'Full Name: {{first_name}} {{last_name}}\n', size: 19 }),
              new TextRun({ text: 'Date: {{date_of_joining}}', size: 19 }),
            ],
            spacing: { before: 180 },
          }),
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}

function cell(text, bold = false, colSpan = 1, isHeader = false, isCategory = false) {
  return new TableCell({
    columnSpan: colSpan,
    shading: isHeader
      ? { fill: '0F172A' }
      : isCategory
      ? { fill: 'F1F5F9' }
      : { fill: 'FFFFFF' },
    margins: {
      top: 100,
      bottom: 100,
      left: 140,
      right: 140,
    },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: 'E2E8F0' },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: 'E2E8F0' },
      left: { style: BorderStyle.SINGLE, size: 1, color: 'E2E8F0' },
      right: { style: BorderStyle.SINGLE, size: 1, color: 'E2E8F0' },
    },
    children: [
      new Paragraph({
        alignment: isHeader ? AlignmentType.LEFT : AlignmentType.LEFT,
        children: [
          new TextRun({
            text: text,
            bold: bold || isHeader || isCategory,
            size: 19,
            color: isHeader ? 'FFFFFF' : isCategory ? '0F172A' : '334155',
          }),
        ],
      }),
    ],
  });
}

function createTable() {
  const rows = [
    // Header
    new TableRow({
      children: [
        cell('Component', true, 1, true),
        cell('Per Month (INR)', true, 1, true),
        cell('Per Annum (INR)', true, 1, true),
      ],
    }),

    // Category 1
    new TableRow({
      children: [
        cell('Basic Components', true, 3, false, true),
      ],
    }),
    new TableRow({
      children: [
        cell('Basic + Dearness Allowance'),
        cell('{{basic_per_month}}'),
        cell('{{annual_basic}}'),
      ],
    }),

    // Category 2
    new TableRow({
      children: [
        cell('Monthly Earnings', true, 3, false, true),
      ],
    }),
    new TableRow({
      children: [
        cell('House Rent Allowance (HRA)'),
        cell('{{hra_per_month}}'),
        cell('{{annual_hra}}'),
      ],
    }),
    new TableRow({
      children: [
        cell('Special Allowance'),
        cell('{{monthly_special_allowance}}'),
        cell('{{special_allowance}}'),
      ],
    }),
    new TableRow({
      children: [
        cell('Gross Monthly Salary', true),
        cell('{{gross_monthly_salary}}', true),
        cell('{{gross_annual_salary}}', true),
      ],
    }),

    // Category 3
    new TableRow({
      children: [
        cell('Employer Statutory Contributions', true, 3, false, true),
      ],
    }),
    new TableRow({
      children: [
        cell("Nichebit's Contribution to Provident Fund"),
        cell('{{pf_per_month}}'),
        cell('{{pf_per_year}}'),
      ],
    }),
    new TableRow({
      children: [
        cell('Gratuity (Accrual)'),
        cell('{{gratuity_per_month}}'),
        cell('{{gratuity_per_year}}'),
      ],
    }),
    new TableRow({
      children: [
        cell('Group Medical Insurance (₹3L) & Accidental Cover (₹10L)'),
        cell('{{insurance_per_month}}'),
        cell('{{insurance_per_year}}'),
      ],
    }),

    // Total Fixed
    new TableRow({
      children: [
        cell('Total Fixed Compensation', true, 1, false, true),
        cell('{{total_fixed_monthly}}', true, 1, false, true),
        cell('{{total_fixed_annual}}', true, 1, false, true),
      ],
    }),

    // Variable
    new TableRow({
      children: [
        cell('Variable Pay', true, 3, false, true),
      ],
    }),
    new TableRow({
      children: [
        cell('Performance Bonus *'),
        cell('—'),
        cell('—'),
      ],
    }),

    // Total CTC
    new TableRow({
      children: [
        cell('Total Cost to Company (CTC)', true, 1, true),
        cell('{{monthly_ctc}}', true, 1, true),
        cell('{{ctc_total}}', true, 1, true),
      ],
    }),
  ];

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows,
  });
}

buildNichebitOfferLetter().then((buffer) => {
  const outPath = path.join(__dirname, '../storage/templates/1a2b3c4d-5e6f-7a8b-9c0d-e1f2a3b4c5d6_Nichebit_Offer_Letter.docx');
  fs.writeFileSync(outPath, buffer);
  console.log('Successfully generated Nichebit Offer Letter template at', outPath);
});
