import React, { useState, useEffect, useMemo } from 'react';
import { DocumentMeta, Placeholder, VariableType, CTCBreakdown } from '../types';
import { calculateCTC, generateDocument } from '../services/api';
import { amountToIndianRupeesWords } from '../utils/numberToWords';
import {
  Download,
  FileDown,
  RefreshCw,
  IndianRupee,
  Calendar,
  Clock,
  Mail,
  Phone,
  CheckSquare,
  Percent,
  Hash,
  FileText,
  AlertCircle,
  CheckCircle2,
  Sliders,
  Sparkles,
  Calculator,
  RotateCcw
} from 'lucide-react';

interface DynamicFormProps {
  document: DocumentMeta | null;
  onGenerationSuccess?: (filename: string) => void;
  onValuesChange?: (values: Record<string, any>, calculations: CTCBreakdown | null) => void;
}

export const DynamicForm: React.FC<DynamicFormProps> = ({
  document,
  onGenerationSuccess,
  onValuesChange,
}) => {
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [preset, setPreset] = useState<'nichebit' | 'standard' | 'custom'>('nichebit');
  const [pfMode, setPfMode] = useState<'fixed' | 'percentage'>('fixed');
  const [pfPercentage, setPfPercentage] = useState<number>(12);
  const [hraRatePct, setHraRatePct] = useState<number>(10);
  const [insuranceAnnual, setInsuranceAnnual] = useState<number>(8000);
  const [basicMode, setBasicMode] = useState<'statutory_min' | 'percentage' | 'fixed'>('statutory_min');

  const [calculations, setCalculations] = useState<CTCBreakdown | null>(null);
  const [calcLoading, setCalcLoading] = useState(false);
  const [generatingFormat, setGeneratingFormat] = useState<'docx' | 'pdf' | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // When document changes, preserve already entered fields and ensure all placeholders exist
  useEffect(() => {
    if (!document) {
      setFormData({});
      setCalculations(null);
      return;
    }

    if (document.name.toLowerCase().includes('nichebit') || document.name.toLowerCase().includes('offer')) {
      setPreset('nichebit');
      setHraRatePct(10);
      setInsuranceAnnual(8000);
      setPfMode('fixed');
    }

    // Preserve any existing entered values from previous template, only add empty string for new placeholders
    setFormData((prev) => {
      const next = { ...prev };
      document.placeholders.forEach((p) => {
        if (!p.calculated) {
          if (next[p.name] === undefined) {
            next[p.name] = '';
          }
        }
      });
      return next;
    });
    setErrorMsg(null);
    setSuccessMsg(null);
  }, [document?.id]);

  const handleFillSampleData = () => {
    if (!document) return;
    const isNichebit =
      document.name.toLowerCase().includes('nichebit') ||
      document.name.toLowerCase().includes('offer') ||
      preset === 'nichebit';

    const sampleValues: Record<string, any> = isNichebit
      ? {
          first_name: 'Talari',
          last_name: 'Kundana',
          employee_id: '010',
          designation: 'Associate Software Engineer',
          department: 'Digital Process Automation',
          location: 'Hyderabad',
          date_of_joining: new Date().toISOString().split('T')[0],
          joining_time: '09:30:00',
          ctc_total: 240000,
          salary: 240000,
          basic_pf: 1800,
          email: 'kundana.t@nichebit.com',
          phone: '+91 91234 56789',
        }
      : {
          first_name: 'Priya',
          last_name: 'Sharma',
          employee_id: 'EMP-4029',
          designation: 'Senior Software Engineer',
          department: 'Technology & Product',
          location: 'Hyderabad',
          date_of_joining: new Date().toISOString().split('T')[0],
          joining_time: '10:00:00',
          ctc_total: 800000,
          salary: 800000,
          basic_pf: 1800,
          email: 'priya.sharma@example.com',
          phone: '+91 98765 43210',
        };

    setFormData((prev) => ({
      ...prev,
      ...sampleValues,
    }));
  };

  const handleClearAll = () => {
    if (!document) return;
    const cleared: Record<string, any> = {};
    document.placeholders.forEach((p) => {
      if (!p.calculated) {
        cleared[p.name] = '';
      }
    });
    setFormData(cleared);
    setCalculations(null);
  };

  const ctcInputName = document?.placeholders.find((placeholder) =>
    ['ctc_total', 'salary', 'ctc'].includes(placeholder.name.toLowerCase())
  )?.name;
  const basicPfInputName = document?.placeholders.find(
    (placeholder) => placeholder.name.toLowerCase() === 'basic_pf'
  )?.name;
  const ctcValue = ctcInputName ? formData[ctcInputName] : undefined;
  const basicPfValue = basicPfInputName ? formData[basicPfInputName] : 1800;
  const ctcInWordsInputName = document?.placeholders.find(
    (placeholder) => ['ctcinwords', 'ctc_in_words', 'annualcompensationinwords'].includes(placeholder.name.toLowerCase())
  )?.name;

  useEffect(() => {
    if (!ctcInWordsInputName) return;
    const words = amountToIndianRupeesWords(ctcValue || '');
    setFormData((previous) => previous[ctcInWordsInputName] === words
      ? previous
      : { ...previous, [ctcInWordsInputName]: words });
  }, [ctcInWordsInputName, ctcValue]);

  // Recalculate CTC whenever the template's CTC input changes. Template
  // authors use both {{ctc}} and {{CTC}}, so matching is case-insensitive.
  useEffect(() => {
    if (ctcValue && !isNaN(Number(ctcValue))) {
      let isCurrent = true;
      setCalcLoading(true);

      calculateCTC({
        ctc_total: Number(ctcValue),
        basic_pf: Number(basicPfValue),
        pf_mode: pfMode,
        pf_percentage: pfPercentage,
        preset,
        hra_rate_pct: hraRatePct,
        insurance_annual: insuranceAnnual,
        basic_mode: basicMode,
      })
        .then((res) => {
          if (isCurrent) setCalculations(res);
        })
        .catch((err) => {
          console.error('Calculation error:', err);
        })
        .finally(() => {
          if (isCurrent) setCalcLoading(false);
        });

      return () => {
        isCurrent = false;
      };
    } else {
      setCalculations(null);
    }
  }, [
    ctcValue,
    basicPfValue,
    pfMode,
    pfPercentage,
    preset,
    hraRatePct,
    insuranceAnnual,
    basicMode,
  ]);

  // Notify parent component of live form data and calculations for live template preview
  useEffect(() => {
    onValuesChange?.(formData, calculations);
  }, [formData, calculations, onValuesChange]);

  const handleInputChange = (name: string, value: any) => {
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
    setErrorMsg(null);
  };

  const handleGenerate = async (format: 'docx' | 'pdf') => {
    if (!document) return;
    setGeneratingFormat(format);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      // Primary: High-fidelity server generation (renders identical styling for both DOCX and PDF via LibreOffice)
      try {
        const { blob, filename } = await generateDocument(document.id, {
          format,
          values: {
            ...formData,
            ctc_preset: preset,
            hra_rate_pct: hraRatePct,
            insurance_annual: insuranceAnnual,
            basic_mode: basicMode,
          },
          pf_mode: pfMode,
          pf_percentage: pfPercentage,
        });

        // Trigger automatic browser download
        const url = window.URL.createObjectURL(blob);
        const link = window.document.createElement('a');
        link.href = url;
        link.download = filename;
        window.document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);

        setSuccessMsg(`Successfully generated and downloaded ${filename}`);
        if (onGenerationSuccess) onGenerationSuccess(filename);
        return;
      } catch (serverErr: any) {
        // FastAPI + LibreOffice is the single document-generation path. The
        // former browser fallback produced a different layout from the DOCX.
        throw serverErr;
      }
    } catch (err: any) {
      const errDetail = err.response?.data?.detail;
      if (typeof errDetail === 'object' && errDetail?.errors) {
        setErrorMsg(errDetail.errors.join(', '));
      } else {
        setErrorMsg(errDetail || err.message || 'Generation failed.');
      }
    } finally {
      setGeneratingFormat(null);
    }
  };

  if (!document) {
    return (
      <div className="p-8 text-center text-slate-400">
        <p className="text-sm font-medium">Select a document to display dynamic fields.</p>
      </div>
    );
  }

  const inputPlaceholders = document.placeholders.filter((p) => !p.calculated);
  const hasCTC = document.placeholders.some(
    (p) =>
      ['ctc_total', 'salary', 'ctc', 'annual_basic'].includes(p.name.toLowerCase()) ||
      p.calculated
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Dynamic Fields Section */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Dynamic Input Fields</h3>
              <p className="text-xs text-slate-500">Values auto-fill directly into the template in real-time</p>
            </div>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
              {inputPlaceholders.length} Fields
            </span>
          </div>

          {/* Quick Helper Actions: Fill Sample / Clear All */}
          <div className="flex items-center gap-2 mb-4 p-2 rounded-xl bg-slate-50 border border-slate-200 text-xs">
            <button
              type="button"
              onClick={handleFillSampleData}
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg bg-white border border-slate-200 font-semibold text-indigo-700 hover:bg-indigo-50 hover:border-indigo-200 transition-all shadow-2xs"
            >
              <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
              <span>Fill Sample Data</span>
            </button>
            <button
              type="button"
              onClick={handleClearAll}
              className="flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg bg-white border border-slate-200 font-medium text-slate-600 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50 transition-all shadow-2xs"
              title="Clear all fields"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Clear</span>
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {inputPlaceholders.map((p) => {
              const val = formData[p.name] ?? '';
              const label = p.name
                .split('_')
                .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                .join(' ');

              return (
                <div key={p.name} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                      <span>{label}</span>
                      {p.required && <span className="text-rose-500 font-bold">*</span>}
                    </label>
                    <span className="text-[10px] font-mono text-slate-400">
                      {`{{${p.name}}}`}
                    </span>
                  </div>

                  {/* Field Control according to Variable Type */}
                  {p.type === 'boolean' ? (
                    <label className="flex items-center gap-2.5 p-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 cursor-pointer transition-colors">
                      <input
                        type="checkbox"
                        checked={!!val}
                        onChange={(e) => handleInputChange(p.name, e.target.checked)}
                        className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300"
                      />
                      <span className="text-xs font-medium text-slate-700">Yes / Active</span>
                    </label>
                  ) : p.type === 'currency' ? (
                    <div className="relative rounded-xl shadow-2xs">
                      <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                        <IndianRupee className="w-4 h-4" />
                      </div>
                      <input
                        type="number"
                        step="any"
                        value={val}
                        onChange={(e) => handleInputChange(p.name, e.target.value)}
                        placeholder="0"
                        className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600 transition-colors"
                      />
                    </div>
                  ) : p.type === 'date' ? (
                    <div className="relative rounded-xl shadow-2xs">
                      <input
                        type="date"
                        value={val}
                        onChange={(e) => handleInputChange(p.name, e.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-white py-2 px-3 text-sm text-slate-900 focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600 transition-colors"
                      />
                    </div>
                  ) : p.type === 'time' ? (
                    <div className="relative rounded-xl shadow-2xs">
                      <input
                        type="time"
                        step="1"
                        value={val}
                        onChange={(e) => handleInputChange(p.name, e.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-white py-2 px-3 text-sm text-slate-900 focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600 transition-colors"
                      />
                    </div>
                  ) : p.type === 'datetime' ? (
                    <div className="relative rounded-xl shadow-2xs">
                      <input
                        type="datetime-local"
                        value={val}
                        onChange={(e) => handleInputChange(p.name, e.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-white py-2 px-3 text-sm text-slate-900 focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600 transition-colors"
                      />
                    </div>
                  ) : p.type === 'percentage' ? (
                    <div className="relative rounded-xl shadow-2xs">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        value={val}
                        onChange={(e) => handleInputChange(p.name, e.target.value)}
                        placeholder="0 - 100"
                        className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-3 pr-8 text-sm text-slate-900 focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600 transition-colors"
                      />
                      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 text-xs font-semibold">
                        %
                      </div>
                    </div>
                  ) : p.name.toLowerCase().includes('address') ? (
                    <textarea
                      rows={2}
                      value={val}
                      onChange={(e) => handleInputChange(p.name, e.target.value)}
                      placeholder={`Enter ${label}`}
                      className="w-full rounded-xl border border-slate-200 bg-white py-2 px-3 text-sm text-slate-900 focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600 transition-colors shadow-2xs resize-none"
                    />
                  ) : (
                    <input
                      type={p.type === 'email' ? 'email' : p.type === 'phone' ? 'tel' : p.type === 'number' ? 'number' : 'text'}
                      value={val}
                      onChange={(e) => handleInputChange(p.name, e.target.value)}
                      placeholder={`Enter ${label}`}
                      className="w-full rounded-xl border border-slate-200 bg-white py-2 px-3 text-sm text-slate-900 focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600 transition-colors shadow-2xs"
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Live CTC Calculation Engine Card */}
        {hasCTC && (
          <div className="rounded-2xl border border-indigo-100 bg-gradient-to-b from-indigo-50/60 via-white to-white p-5 shadow-2xs">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-indigo-600 text-white flex items-center justify-center shadow-2xs">
                  <Calculator className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-900">Live Salary & CTC Engine</h4>
                  <p className="text-[11px] text-slate-500">Accurate statutory & corporate offer calculations</p>
                </div>
              </div>
              {calcLoading && <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-600" />}
            </div>

            {/* Compensation Preset Selector */}
            <div className="bg-white rounded-xl p-3 border border-slate-200/80 mb-3 shadow-2xs">
              <div className="text-[11px] font-semibold text-slate-700 mb-2 flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-indigo-600" />
                <span>Compensation Structure Preset</span>
              </div>
              <div className="grid grid-cols-3 gap-1.5 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setPreset('nichebit');
                    setHraRatePct(10);
                    setInsuranceAnnual(8000);
                    setPfMode('fixed');
                  }}
                  className={`py-1.5 px-2 rounded-lg font-medium border text-center transition-all text-[11px] ${
                    preset === 'nichebit'
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                      : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  Nichebit Offer
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPreset('standard');
                    setHraRatePct(50);
                    setInsuranceAnnual(0);
                  }}
                  className={`py-1.5 px-2 rounded-lg font-medium border text-center transition-all text-[11px] ${
                    preset === 'standard'
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                      : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  Standard 50-25
                </button>
                <button
                  type="button"
                  onClick={() => setPreset('custom')}
                  className={`py-1.5 px-2 rounded-lg font-medium border text-center transition-all text-[11px] ${
                    preset === 'custom'
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                      : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  Custom
                </button>
              </div>

              {preset === 'nichebit' && (
                <div className="mt-2.5 rounded-lg bg-indigo-50/80 border border-indigo-100 p-2 text-[11px] text-indigo-900 leading-relaxed">
                  <span className="font-bold">✨ Nichebit Offer Letter Rules:</span> Basic min ₹15,000/mo (50% if CTC &gt; 3.6L), HRA 10% of Basic, Gratuity accrual (₹722/mo), Group Medical & Accidental Insurance (₹8,000/yr), Special Allowance balancing figure.
                </div>
              )}

              {/* Custom Settings Controls */}
              {preset === 'custom' && (
                <div className="mt-3 pt-2.5 border-t border-slate-100 space-y-2.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">HRA Rate (% of Basic):</span>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={hraRatePct}
                        onChange={(e) => setHraRatePct(Number(e.target.value) || 0)}
                        className="w-14 px-2 py-0.5 text-right font-semibold text-slate-900 border border-slate-200 rounded-md"
                      />
                      <span className="text-slate-500 font-bold">%</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">Medical Insurance (Annual ₹):</span>
                    <input
                      type="number"
                      min="0"
                      step="500"
                      value={insuranceAnnual}
                      onChange={(e) => setInsuranceAnnual(Number(e.target.value) || 0)}
                      className="w-20 px-2 py-0.5 text-right font-semibold text-slate-900 border border-slate-200 rounded-md"
                    />
                  </div>
                </div>
              )}

              {/* PF Mode Selector */}
              <div className="mt-3 pt-2.5 border-t border-slate-100">
                <div className="flex items-center justify-between text-[11px] font-semibold text-slate-600 mb-1.5">
                  <span>Provident Fund (PF):</span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setPfMode('fixed')}
                      className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                        pfMode === 'fixed'
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      Fixed (₹1,800)
                    </button>
                    <button
                      type="button"
                      onClick={() => setPfMode('percentage')}
                      className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                        pfMode === 'percentage'
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      12% Basic
                    </button>
                  </div>
                </div>

                {pfMode === 'percentage' && (
                  <div className="flex items-center justify-between text-xs pt-1">
                    <span className="text-slate-600">PF Percentage:</span>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min="1"
                        max="100"
                        value={pfPercentage}
                        onChange={(e) => setPfPercentage(Number(e.target.value) || 12)}
                        className="w-14 px-2 py-0.5 text-right font-semibold text-slate-900 border border-slate-200 rounded-md"
                      />
                      <span className="text-slate-500 font-bold">%</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Breakdown Table */}
            {calculations ? (
              <div className="space-y-2 text-xs bg-white rounded-xl p-3 border border-slate-200/80 shadow-2xs">
                {/* Column Headers */}
                <div className="grid grid-cols-3 pb-1 border-b border-slate-200 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  <span>Component</span>
                  <span className="text-right">Per Month</span>
                  <span className="text-right">Per Annum</span>
                </div>

                {/* Group 1: Basic */}
                <div className="pt-0.5">
                  <div className="text-[10px] font-bold text-indigo-900 uppercase tracking-wider mb-1">
                    Basic Components
                  </div>
                  <div className="grid grid-cols-3 py-1 font-medium text-slate-700 hover:bg-slate-50 rounded px-1 -mx-1">
                    <span>Basic + DA</span>
                    <span className="text-right font-semibold text-slate-900">
                      {calculations.basic_per_month?.formatted_value}
                    </span>
                    <span className="text-right font-semibold text-slate-900">
                      {calculations.annual_basic?.formatted_value}
                    </span>
                  </div>
                </div>

                {/* Group 2: Monthly Earnings */}
                <div className="pt-1.5 border-t border-slate-100">
                  <div className="text-[10px] font-bold text-indigo-900 uppercase tracking-wider mb-1">
                    Monthly Earnings
                  </div>
                  <div className="grid grid-cols-3 py-1 text-slate-700 hover:bg-slate-50 rounded px-1 -mx-1">
                    <span>House Rent Allowance (HRA)</span>
                    <span className="text-right font-semibold text-slate-900">
                      {calculations.hra_per_month?.formatted_value}
                    </span>
                    <span className="text-right font-semibold text-slate-900">
                      {calculations.annual_hra?.formatted_value}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 py-1 text-slate-700 hover:bg-slate-50 rounded px-1 -mx-1">
                    <span>Special Allowance</span>
                    <span className="text-right font-semibold text-slate-900">
                      {calculations.monthly_special_allowance?.formatted_value}
                    </span>
                    <span className="text-right font-semibold text-slate-900">
                      {calculations.special_allowance?.formatted_value}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 py-1 font-bold text-slate-900 bg-slate-100/70 rounded px-1.5 -mx-0.5 mt-0.5">
                    <span>Gross Monthly Salary</span>
                    <span className="text-right text-indigo-950">
                      {calculations.gross_monthly_salary?.formatted_value}
                    </span>
                    <span className="text-right text-indigo-950">
                      {calculations.gross_annual_salary?.formatted_value}
                    </span>
                  </div>
                </div>

                {/* Group 3: Employer Statutory Contributions */}
                <div className="pt-1.5 border-t border-slate-100">
                  <div className="text-[10px] font-bold text-indigo-900 uppercase tracking-wider mb-1">
                    Employer Statutory Contributions
                  </div>
                  <div className="grid grid-cols-3 py-1 text-slate-700 hover:bg-slate-50 rounded px-1 -mx-1">
                    <span>Provident Fund (PF)</span>
                    <span className="text-right font-semibold text-slate-900">
                      {calculations.pf_per_month?.formatted_value}
                    </span>
                    <span className="text-right font-semibold text-slate-900">
                      {calculations.pf_per_year?.formatted_value}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 py-1 text-slate-700 hover:bg-slate-50 rounded px-1 -mx-1">
                    <span>Gratuity (Accrual)</span>
                    <span className="text-right font-semibold text-slate-900">
                      {calculations.gratuity_per_month?.formatted_value}
                    </span>
                    <span className="text-right font-semibold text-slate-900">
                      {calculations.gratuity_per_year?.formatted_value}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 py-1 text-slate-700 hover:bg-slate-50 rounded px-1 -mx-1">
                    <span className="truncate pr-1">Medical & Accidental Insurance</span>
                    <span className="text-right font-semibold text-slate-500">
                      {calculations.insurance_per_month?.formatted_value || '—'}
                    </span>
                    <span className="text-right font-semibold text-slate-900">
                      {calculations.insurance_per_year?.formatted_value}
                    </span>
                  </div>
                </div>

                {/* Total CTC */}
                <div className="pt-2 border-t-2 border-slate-200">
                  <div className="grid grid-cols-3 py-2 px-2 rounded-lg bg-indigo-600 text-white font-bold text-xs shadow-2xs">
                    <span>Total CTC</span>
                    <span className="text-right">
                      {calculations.total_fixed_monthly?.formatted_value || calculations.monthly_ctc?.formatted_value}
                    </span>
                    <span className="text-right">
                      {calculations.total_fixed_annual?.formatted_value || calculations.ctc_total?.formatted_value}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-500 italic text-center py-3">
                Enter a CTC value to see instant breakdown
              </p>
            )}
          </div>
        )}

        {/* Feedback banners */}
        {errorMsg && (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Generation Error</p>
              <p className="mt-0.5">{errorMsg}</p>
            </div>
          </div>
        )}

        {successMsg && (
          <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Download Ready</p>
              <p className="mt-0.5">{successMsg}</p>
            </div>
          </div>
        )}
      </div>

      {/* Action Footer */}
      <div className="p-5 border-t border-slate-200 bg-white shrink-0 space-y-2">
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => handleGenerate('docx')}
            disabled={generatingFormat !== null}
            className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-bold text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-300 shadow-2xs transition-all disabled:opacity-60"
          >
            {generatingFormat === 'docx' ? (
              <RefreshCw className="w-4 h-4 animate-spin text-slate-700" />
            ) : (
              <FileDown className="w-4 h-4 text-indigo-600" />
            )}
            <span>Generate DOCX</span>
          </button>

          <button
            type="button"
            onClick={() => handleGenerate('pdf')}
            disabled={generatingFormat !== null}
            className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm transition-all disabled:opacity-60"
          >
            {generatingFormat === 'pdf' ? (
              <RefreshCw className="w-4 h-4 animate-spin text-white" />
            ) : (
              <Download className="w-4 h-4 text-white" />
            )}
            <span>Generate PDF</span>
          </button>
        </div>
      </div>
    </div>
  );
};
