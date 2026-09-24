import React, { useState, useRef, useMemo } from 'react';
import Papa from 'papaparse';
import { DocumentMeta, BulkResult, Placeholder } from '../types';
import { bulkGenerate, downloadBulkZip } from '../services/api';
import {
  FileSpreadsheet,
  Download,
  UploadCloud,
  FileArchive,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  FileText,
  AlertCircle,
  Copy,
  Check,
  Table,
  ChevronDown,
  ChevronUp,
  Info,
  Sparkles,
} from 'lucide-react';

interface BulkModeProps {
  document: DocumentMeta | null;
}

export const BulkMode: React.FC<BulkModeProps> = ({ document }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadedHeaders, setUploadedHeaders] = useState<string[]>([]);
  const [uploadedRowCount, setUploadedRowCount] = useState<number>(0);
  const [format, setFormat] = useState<'pdf' | 'docx'>('pdf');
  const [pfMode, setPfMode] = useState<'fixed' | 'percentage'>('fixed');
  const [pfPercentage, setPfPercentage] = useState<number>(12);
  const [processing, setProcessing] = useState(false);
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showTablePreview, setShowTablePreview] = useState(false);
  const [copiedHeaders, setCopiedHeaders] = useState(false);
  const [downloadNotice, setDownloadNotice] = useState<string | null>(null);

  // 1. Identify fillable placeholders (non-calculated placeholders that need to be populated in the spreadsheet)
  const fillablePlaceholders = useMemo(() => {
    if (!document) return [];
    const nonCalc = document.placeholders.filter((p) => !p.calculated);
    return nonCalc.length > 0 ? nonCalc : document.placeholders;
  }, [document]);

  // Column header names for the CSV
  const columnNames = useMemo(() => {
    return fillablePlaceholders.map((p) => p.name);
  }, [fillablePlaceholders]);

  // Realistic sample data rows for the CSV template
  const sampleRows = useMemo(() => {
    if (!fillablePlaceholders.length) return [];

    const getSampleValue = (p: Placeholder, rowIndex: number): string => {
      const name = p.name.toLowerCase();
      if (name === 'first_name') return rowIndex === 0 ? 'Aarav' : 'Diya';
      if (name === 'last_name') return rowIndex === 0 ? 'Patel' : 'Sharma';
      if (name === 'candidate_name') return rowIndex === 0 ? 'Aarav Patel' : 'Diya Sharma';
      if (name === 'candidate_address' || name === 'address') {
        return rowIndex === 0 ? 'Plot 42, Hitech City, Hyderabad, 500081' : 'Flat 302, Palm Grove, Bengaluru, 560001';
      }
      if (name === 'employee_id') return rowIndex === 0 ? 'EMP-1001' : 'EMP-1002';
      if (name === 'designation') return rowIndex === 0 ? 'Software Engineer' : 'Product Designer';
      if (name === 'department') return rowIndex === 0 ? 'Engineering' : 'Design';
      if (name === 'date_of_joining') return rowIndex === 0 ? '2026-10-01' : '2026-10-15';
      if (name === 'joining_time') return '10:00:00';
      if (name === 'ctc_total' || name === 'salary' || name === 'ctc') {
        return rowIndex === 0 ? '800000' : '1200000';
      }
      if (name === 'basic_pf') return '1800';
      if (name === 'email') {
        return rowIndex === 0 ? 'aarav.patel@example.com' : 'diya.sharma@example.com';
      }
      if (name === 'phone' || name === 'mobile') {
        return rowIndex === 0 ? '+91 98765 12345' : '+91 98765 67890';
      }
      if (name === 'location' || name === 'city') {
        return rowIndex === 0 ? 'Hyderabad' : 'Bengaluru';
      }

      if (p.type === 'currency' || p.type === 'number') return rowIndex === 0 ? '50000' : '75000';
      if (p.type === 'date') return rowIndex === 0 ? '2026-10-01' : '2026-10-15';
      if (p.type === 'email') return rowIndex === 0 ? 'user1@example.com' : 'user2@example.com';
      if (p.type === 'phone') return rowIndex === 0 ? '+91 98765 43210' : '+91 98765 43211';
      return `Sample ${p.name}`;
    };

    const row1: Record<string, string> = {};
    const row2: Record<string, string> = {};

    fillablePlaceholders.forEach((p) => {
      row1[p.name] = getSampleValue(p, 0);
      row2[p.name] = getSampleValue(p, 1);
    });

    return [row1, row2];
  }, [fillablePlaceholders]);

  // Client-side CSV generation ensuring pure, valid CSV format without any HTML interference
  const handleDownloadSampleCsv = () => {
    if (!document || !fillablePlaceholders.length) return;

    try {
      const csvContent = Papa.unparse({
        fields: columnNames,
        data: sampleRows,
      });

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const link = window.document.createElement('a');
      const cleanDocName = (document.name || 'document')
        .replace(/\.docx$/i, '')
        .replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `${cleanDocName}_sample_template.csv`;

      link.href = url;
      link.download = filename;
      window.document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);

      setDownloadNotice(`Downloaded "${filename}" with ${columnNames.length} placeholder columns.`);
      setTimeout(() => setDownloadNotice(null), 5000);
    } catch (err: any) {
      console.error('Error generating sample CSV:', err);
      setErrorMsg('Failed to generate sample CSV.');
    }
  };

  const handleCopyHeaders = () => {
    if (!columnNames.length) return;
    const headerString = columnNames.join(',');
    navigator.clipboard.writeText(headerString);
    setCopiedHeaders(true);
    setTimeout(() => setCopiedHeaders(false), 2500);
  };

  // Inspect uploaded CSV to verify columns match required placeholders
  const inspectFile = (file: File) => {
    setSelectedFile(file);
    setResult(null);
    setErrorMsg(null);

    const ext = file.name.toLowerCase();
    if (ext.endsWith('.csv')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        if (text) {
          const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
          const fields = parsed.meta.fields || [];
          setUploadedHeaders(fields);
          setUploadedRowCount(parsed.data.length);
        }
      };
      reader.readAsText(file);
    } else {
      setUploadedHeaders([]);
      setUploadedRowCount(0);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      inspectFile(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      const ext = file.name.toLowerCase();
      if (ext.endsWith('.csv') || ext.endsWith('.xlsx') || ext.endsWith('.xls')) {
        inspectFile(file);
      } else {
        setErrorMsg('Please upload a .csv or .xlsx spreadsheet file.');
      }
    }
  };

  const handleGenerateAll = async () => {
    if (!document || !selectedFile) return;
    setProcessing(true);
    setErrorMsg(null);
    try {
      const res = await bulkGenerate(document.id, selectedFile, format, pfMode, pfPercentage);
      setResult(res);
    } catch (err: any) {
      setErrorMsg(
        err.response?.data?.detail || err.message || 'Bulk generation encountered an error.'
      );
    } finally {
      setProcessing(false);
    }
  };

  const handleDownloadZip = async () => {
    if (!result?.download_url) return;
    try {
      setDownloadingZip(true);
      const blob = await downloadBulkZip(result.download_url);
      const url = window.URL.createObjectURL(blob);
      const link = window.document.createElement('a');
      link.href = url;
      link.download = result.download_filename || `FillForge_Bulk_${format}.zip`;
      window.document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error('Error downloading bulk zip:', err);
      setErrorMsg('Failed to download generated ZIP archive.');
    } finally {
      setDownloadingZip(false);
    }
  };

  if (!document) {
    return (
      <div className="p-8 text-center text-slate-400">
        <p className="text-sm font-medium">Select a document template to use Bulk Mode.</p>
      </div>
    );
  }

  // Check which required placeholders are missing from uploaded file (if CSV)
  const missingRequiredColumns = fillablePlaceholders
    .filter((p) => p.required)
    .filter((p) => !uploadedHeaders.some((h) => h.trim().toLowerCase() === p.name.toLowerCase()));

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-50/50">
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-5 space-y-5">
        {/* Step 1: Columns for All Required Placeholders & Sample CSV Download */}
        <div className="rounded-2xl border border-slate-200/90 bg-white p-4 sm:p-5 shadow-xs transition-all">
          <div className="pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 text-[11px] font-bold tracking-wide">
                Step 1
              </span>
              <span className="text-xs font-semibold text-slate-600">
                {columnNames.length} Placeholder Columns Detected
              </span>
            </div>
            <h4 className="text-sm font-bold text-slate-900 truncate">
              Template Columns for {document.name}
            </h4>
            <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
              Contains columns for all required placeholders ready to be filled.
            </p>

            {/* Vertically stacked actions: Download Sample CSV down to Copy Headers */}
            <div className="mt-3.5 flex flex-col gap-2">
              <button
                type="button"
                onClick={handleCopyHeaders}
                title="Copy comma-separated headers to clipboard"
                className="w-full inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 transition-colors"
              >
                {copiedHeaders ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span className="text-emerald-700 font-bold">Headers Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-slate-500" />
                    <span>Copy Headers</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleDownloadSampleCsv}
                className="w-full inline-flex items-center justify-center gap-2 py-2 px-3.5 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 shadow-xs transition-colors"
              >
                <Download className="w-4 h-4" />
                <span>Download Sample CSV</span>
              </button>
            </div>
          </div>

          {/* Download Success Notice */}
          {downloadNotice && (
            <div className="mt-3 p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{downloadNotice}</span>
            </div>
          )}

          {/* Columns Chips View */}
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Columns Ready To Be Filled
              </span>
              <button
                type="button"
                onClick={() => setShowTablePreview(!showTablePreview)}
                className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-semibold"
              >
                <Table className="w-3.5 h-3.5" />
                <span>{showTablePreview ? 'Hide Preview Table' : 'Show Preview Table'}</span>
                {showTablePreview ? (
                  <ChevronUp className="w-3 h-3" />
                ) : (
                  <ChevronDown className="w-3 h-3" />
                )}
              </button>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {fillablePlaceholders.map((p) => (
                <div
                  key={p.name}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700"
                >
                  <span className="font-mono font-semibold text-slate-900">{p.name}</span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-200/70 text-slate-600 font-medium">
                    {p.type}
                  </span>
                  {p.required && (
                    <span className="text-[10px] text-rose-600 font-bold" title="Required field">
                      *
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Interactive Table Preview of Sample CSV Data */}
          {showTablePreview && (
            <div className="mt-4 rounded-xl border border-slate-200 overflow-hidden bg-white shadow-2xs">
              <div className="px-3 py-2 bg-slate-50/80 border-b border-slate-200 flex items-center justify-between text-xs text-slate-500">
                <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                  <FileSpreadsheet className="w-3.5 h-3.5 text-indigo-600" />
                  Sample CSV Data Preview ({sampleRows.length} sample rows included)
                </span>
                <span className="text-[11px] text-slate-400">Format: Standard CSV (RFC 4180)</span>
              </div>
              <div className="overflow-x-auto max-w-full">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-100/70 border-b border-slate-200">
                      <th className="py-2 px-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider w-10">
                        #
                      </th>
                      {columnNames.map((col) => (
                        <th
                          key={col}
                          className="py-2 px-3 font-mono font-bold text-slate-800 whitespace-nowrap text-xs border-r border-slate-200/60 last:border-r-0"
                        >
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-normal">
                    {sampleRows.map((row, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-2 px-3 text-[11px] text-slate-400 font-mono">
                          {idx + 1}
                        </td>
                        {columnNames.map((col) => (
                          <td
                            key={col}
                            className="py-2 px-3 text-slate-700 whitespace-nowrap border-r border-slate-100 last:border-r-0"
                          >
                            {row[col]}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Step 2: Upload CSV or XLSX */}
        <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs">
          <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 text-[11px] font-bold tracking-wide mb-2">
            Step 2
          </span>
          <h4 className="text-sm font-bold text-slate-900 mb-1">Upload Populated Spreadsheet</h4>
          <p className="text-xs text-slate-500 mb-3">
            Upload your completed .csv or .xlsx spreadsheet file with rows for each employee.
          </p>

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
            className="hidden"
            onChange={handleFileChange}
          />

          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`cursor-pointer border-2 border-dashed rounded-xl p-6 text-center transition-all ${
              isDragging
                ? 'border-indigo-500 bg-indigo-50/50'
                : selectedFile
                ? 'border-emerald-300 bg-emerald-50/30'
                : 'border-slate-300 hover:border-slate-400 bg-slate-50/60 hover:bg-slate-100/50'
            }`}
          >
            <div className="flex flex-col items-center gap-2">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                  selectedFile ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-700'
                }`}
              >
                {selectedFile ? (
                  <FileSpreadsheet className="w-5 h-5" />
                ) : (
                  <UploadCloud className="w-5 h-5 text-slate-500" />
                )}
              </div>
              <div className="text-xs font-bold text-slate-800">
                {selectedFile ? selectedFile.name : 'Select or drag & drop populated .csv file'}
              </div>
              <p className="text-[11px] text-slate-500">
                {selectedFile
                  ? `${(selectedFile.size / 1024).toFixed(1)} KB ${
                      uploadedRowCount > 0 ? `• ${uploadedRowCount} data rows detected` : ''
                    }`
                  : 'Click to choose file from your device'}
              </p>
            </div>
          </div>

          {/* Validation Feedback on Uploaded Columns */}
          {selectedFile && uploadedHeaders.length > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-100 text-xs">
              {missingRequiredColumns.length === 0 ? (
                <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>
                    <strong>All required columns matched!</strong> Ready to generate documents for{' '}
                    {uploadedRowCount} record{uploadedRowCount !== 1 ? 's' : ''}.
                  </span>
                </div>
              ) : (
                <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold">Notice: Missing required columns in uploaded CSV:</p>
                    <p className="mt-1 font-mono text-[11px] text-amber-800">
                      {missingRequiredColumns.map((p) => p.name).join(', ')}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Step 3: Generation Options */}
        <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs space-y-4">
          <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 text-[11px] font-bold tracking-wide">
            Step 3
          </span>
          <h4 className="text-sm font-bold text-slate-900">Output Settings</h4>

          {/* Format selection */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700">Output Document Format</label>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <button
                type="button"
                onClick={() => setFormat('pdf')}
                className={`py-2 px-3 rounded-xl font-semibold border text-center transition-all ${
                  format === 'pdf'
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                PDF (.pdf)
              </button>
              <button
                type="button"
                onClick={() => setFormat('docx')}
                className={`py-2 px-3 rounded-xl font-semibold border text-center transition-all ${
                  format === 'docx'
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                DOCX (.docx)
              </button>
            </div>
          </div>

          {/* PF Mode selection */}
          <div className="space-y-1.5 pt-2 border-t border-slate-100">
            <label className="text-xs font-semibold text-slate-700">
              PF Calculation for Compensation Tables
            </label>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <button
                type="button"
                onClick={() => setPfMode('fixed')}
                className={`py-1.5 px-3 rounded-lg font-medium border text-center transition-all ${
                  pfMode === 'fixed'
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-slate-50 text-slate-700 border-slate-200'
                }`}
              >
                Fixed ₹1,800/month
              </button>
              <button
                type="button"
                onClick={() => setPfMode('percentage')}
                className={`py-1.5 px-3 rounded-lg font-medium border text-center transition-all ${
                  pfMode === 'percentage'
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-slate-50 text-slate-700 border-slate-200'
                }`}
              >
                12% of Basic
              </button>
            </div>
          </div>
        </div>

        {/* Feedback messages */}
        {errorMsg && (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Generation Error</p>
              <p className="mt-0.5">{errorMsg}</p>
            </div>
          </div>
        )}

        {/* Results Card */}
        {result && (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
            <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <FileArchive className="w-4 h-4 text-indigo-600" />
              <span>Bulk Generation Results</span>
            </h4>

            <div className="grid grid-cols-2 gap-3 text-center">
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200/80">
                <div className="text-2xl font-black text-emerald-700">{result.succeeded}</div>
                <div className="text-xs font-semibold text-emerald-800 mt-0.5">Succeeded</div>
              </div>
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200/80">
                <div className="text-2xl font-black text-rose-700">{result.failed}</div>
                <div className="text-xs font-semibold text-rose-800 mt-0.5">Failed Rows</div>
              </div>
            </div>

            {/* ZIP Download button */}
            {result.download_url && (
              <button
                type="button"
                onClick={handleDownloadZip}
                disabled={downloadingZip}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 shadow-xs transition-all disabled:opacity-60"
              >
                {downloadingZip ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Downloading ZIP Archive...</span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    <span>Download All Generated as ZIP ({format.toUpperCase()})</span>
                  </>
                )}
              </button>
            )}

            {/* Failed Rows Detail */}
            {result.failures && result.failures.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-slate-100">
                <div className="flex items-center gap-1.5 text-xs font-bold text-rose-700">
                  <AlertTriangle className="w-4 h-4" />
                  <span>Reported Row Errors ({result.failures.length})</span>
                </div>
                <div className="max-h-40 overflow-y-auto divide-y divide-rose-100 rounded-lg border border-rose-200 bg-rose-50/50 p-2 text-xs">
                  {result.failures.map((f, i) => (
                    <div key={i} className="py-1.5 px-1 flex items-start gap-2">
                      <span className="font-mono font-bold text-rose-900 shrink-0">
                        Row {f.row}:
                      </span>
                      <span className="text-rose-800">{f.error}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Action Footer */}
      <div className="p-5 border-t border-slate-200 bg-white shrink-0">
        <button
          type="button"
          onClick={handleGenerateAll}
          disabled={!selectedFile || processing}
          className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 shadow-xs transition-all disabled:opacity-60 cursor-pointer"
        >
          {processing ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>Processing Batch Records...</span>
            </>
          ) : (
            <>
              <FileSpreadsheet className="w-4 h-4" />
              <span>
                {selectedFile
                  ? `Generate ${uploadedRowCount > 0 ? uploadedRowCount : 'All'} ${format.toUpperCase()} Documents`
                  : 'Select a Spreadsheet to Generate'}
              </span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
