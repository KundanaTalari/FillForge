import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { renderAsync } from 'docx-preview';
import mammoth from 'mammoth';
import { DocumentMeta, CTCBreakdown } from '../types';
import { getDocumentPreviewArrayBuffer, generateDocument } from '../services/api';
import { fillDocxArrayBufferClient } from '../utils/docxClientFiller';
import {
  FileText,
  Eye,
  ListTree,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  RefreshCw,
  AlertCircle,
  Hash,
  Calendar,
  Clock,
  Mail,
  Phone,
  CheckSquare,
  Percent,
  IndianRupee,
  Highlighter,
  Layers,
  Download,
  Palette,
  ExternalLink,
  Printer,
  Sparkles,
  Maximize2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react';

interface DocumentPreviewProps {
  document: DocumentMeta | null;
  allDocuments?: DocumentMeta[];
  onSelectDoc?: (id: string) => void;
  formValues?: Record<string, any>;
  calculatedValues?: CTCBreakdown | null;
  isSidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  isRightPanelOpen?: boolean;
  onToggleRightPanel?: () => void;
}

// Indian currency formatter helper
function formatCurrencyINR(num: number | string): string {
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

// Safe client-side math evaluator for [CALC(...)] expressions
function evaluateClientExpression(
  expression: string,
  formValues: Record<string, any>,
  calculatedValues: CTCBreakdown | null
): string | null {
  if (!expression) return null;
  let expr = expression.trim();
  let hasUnfilled = false;

  expr = expr.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, varName) => {
    if (calculatedValues && calculatedValues[varName]) {
      return String(calculatedValues[varName].raw_value);
    }
    const val = formValues[varName];
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      const n = Number(val);
      if (!isNaN(n)) return String(n);
    }
    hasUnfilled = true;
    return '0';
  });

  if (hasUnfilled) return null;
  if (!/^[0-9+\-*/().\s]+$/.test(expr)) return null;

  try {
    const fn = new Function(`"use strict"; return (${expr});`);
    const result = fn();
    if (typeof result === 'number' && !isNaN(result) && isFinite(result)) {
      return formatCurrencyINR(result);
    }
  } catch {
    return null;
  }
  return null;
}

// Compute live rendered HTML by injecting form values and calculations into placeholders (for badge view)
function renderTemplateHtml(
  rawHtml: string,
  doc: DocumentMeta | null,
  formValues: Record<string, any>,
  calculatedValues: CTCBreakdown | null,
  highlightFields: boolean
): string {
  if (!rawHtml) return '';
  let html = rawHtml;

  // 1. Process [CALC(...)] expressions
  html = html.replace(/\[CALC\((.*?)\)\]/g, (match, expr) => {
    const evaluated = evaluateClientExpression(expr, formValues, calculatedValues);
    if (evaluated !== null) {
      if (highlightFields) {
        return `<span class="inline-flex items-center px-2 py-0.5 mx-0.5 rounded-md font-semibold text-emerald-900 bg-emerald-100 border border-emerald-300 shadow-2xs transition-all duration-150" title="Auto Calculated [CALC(${expr})]">${evaluated}</span>`;
      }
      return `<span class="font-semibold text-slate-900 border-b border-emerald-400/60 pb-0.5" title="[CALC(${expr})]">${evaluated}</span>`;
    }
    return `<mark class="inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded bg-emerald-50 text-emerald-800 font-mono text-xs font-semibold border border-dashed border-emerald-300 shadow-2xs" title="Expression: ${expr}">[CALC(${expr})]</mark>`;
  });

  // 2. Process {{placeholder}} tags
  html = html.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (match, varName) => {
    // Priority 1: Check calculated values
    if (calculatedValues && calculatedValues[varName]) {
      const val = calculatedValues[varName].formatted_value;
      if (highlightFields) {
        return `<span class="inline-flex items-center px-2 py-0.5 mx-0.5 rounded-md font-semibold text-emerald-900 bg-emerald-100 border border-emerald-300 shadow-2xs transition-all duration-150" title="Calculated: ${varName}">${val}</span>`;
      }
      return `<span class="font-semibold text-slate-900 border-b border-emerald-400/60 pb-0.5" title="Calculated: ${varName}">${val}</span>`;
    }

    // Priority 2: Check user-entered form values
    const userVal = formValues[varName] ?? formValues[varName.toLowerCase()];
    if (userVal !== undefined && userVal !== null && String(userVal).trim() !== '') {
      let displayVal = String(userVal);
      const pMeta = doc?.placeholders.find((p) => p.name === varName);
      if (pMeta?.type === 'currency' && !isNaN(Number(userVal))) {
        displayVal = formatCurrencyINR(userVal);
      }

      if (highlightFields) {
        return `<span class="inline-flex items-center px-2 py-0.5 mx-0.5 rounded-md font-bold text-indigo-950 bg-indigo-100 border border-indigo-300 shadow-2xs transition-all duration-150" title="Filled field: ${varName}">${displayVal}</span>`;
      }
      return `<span class="font-semibold text-slate-900 border-b border-indigo-400/60 pb-0.5" title="Field: ${varName}">${displayVal}</span>`;
    }

    // Unfilled placeholder
    return `<mark class="inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded bg-amber-50 text-amber-900 font-mono text-xs font-semibold border border-dashed border-amber-400 shadow-2xs" title="Pending value for ${varName}">{{${varName}}}</mark>`;
  });

  return html;
}

// Compute fill statistics for any document
function getDocFillStats(doc: DocumentMeta, formValues: Record<string, any>, calculatedValues: CTCBreakdown | null) {
  let filled = 0;
  doc.placeholders.forEach((p) => {
    if (p.calculated) {
      if (calculatedValues && calculatedValues[p.name]) filled++;
    } else {
      const val = formValues[p.name] ?? formValues[p.name.toLowerCase()];
      if (val !== undefined && val !== null && String(val).trim() !== '') filled++;
    }
  });
  return { filled, total: doc.placeholders.length };
}

export const DocumentPreview: React.FC<DocumentPreviewProps> = ({
  document,
  allDocuments = [],
  onSelectDoc,
  formValues = {},
  calculatedValues = null,
  isSidebarOpen = true,
  onToggleSidebar,
  isRightPanelOpen = true,
  onToggleRightPanel,
}) => {
  const [activeTab, setActiveTab] = useState<'preview' | 'schema'>('preview');
  const [viewMode, setViewMode] = useState<'single' | 'all'>('single');
  // Sub-render modes: 'word' (Full Word styling/colors via docx-preview), 'pdf' (Vector PDF iframe), 'badges' (Quick HTML badges)
  // Browser DOCX renderers approximate Word. Default to LibreOffice PDF for
  // faithful pagination, colors, tables, and graphics.
  const [previewFidelity, setPreviewFidelity] = useState<'word' | 'pdf' | 'badges'>('pdf');

  const [bufferCache, setBufferCache] = useState<Record<string, ArrayBuffer>>({});
  const [htmlCache, setHtmlCache] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<boolean>(false);
  const [renderingDocx, setRenderingDocx] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Dynamic scaling and responsive sizing states
  const [autoFit, setAutoFit] = useState<boolean>(true);
  const [zoomLevel, setZoomLevel] = useState<number>(100);
  const [viewportWidth, setViewportWidth] = useState<number>(0);
  const [docDimensions, setDocDimensions] = useState<{ width: number; height: number }>({
    width: 816,
    height: 1056,
  });

  const [highlightFields, setHighlightFields] = useState<boolean>(true);
  const [downloadingDocId, setDownloadingDocId] = useState<string | null>(null);
  const [showOriginalUploaded, setShowOriginalUploaded] = useState<boolean>(false);
  const [livePdfUrl, setLivePdfUrl] = useState<string | null>(null);
  const [renderingPdf, setRenderingPdf] = useState(false);
  const [pdfPreviewError, setPdfPreviewError] = useState<string | null>(null);

  const docxContainerRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const livePdfUrlRef = useRef<string | null>(null);

  const [docxRenderError, setDocxRenderError] = useState<string | null>(null);

  // Measure rendered Word document page dimensions
  const measureDoc = useCallback(() => {
    if (!docxContainerRef.current) return;
    const sections = docxContainerRef.current.querySelectorAll('section.docx');
    if (sections.length > 0) {
      const firstSec = sections[0] as HTMLElement;
      const naturalW = firstSec.offsetWidth || 816;

      let totalH = 0;
      sections.forEach((sec, idx) => {
        const h = (sec as HTMLElement).offsetHeight || 1056;
        const mb = idx < sections.length - 1 ? 32 : 0;
        totalH += h + mb;
      });

      const nextW = Math.max(naturalW, 600);
      const nextH = Math.max(totalH, 800);

      setDocDimensions((prev) => {
        if (Math.abs(prev.width - nextW) < 4 && Math.abs(prev.height - nextH) < 4) {
          return prev;
        }
        return { width: nextW, height: nextH };
      });
    } else {
      const wrapper = docxContainerRef.current.querySelector('.docx-wrapper') as HTMLElement | null;
      const w = wrapper?.offsetWidth || docxContainerRef.current.offsetWidth || 816;
      const h = wrapper?.scrollHeight || docxContainerRef.current.scrollHeight || 1056;

      const nextW = Math.max(w, 600);
      const nextH = Math.max(h, 800);

      setDocDimensions((prev) => {
        if (Math.abs(prev.width - nextW) < 4 && Math.abs(prev.height - nextH) < 4) {
          return prev;
        }
        return { width: nextW, height: nextH };
      });
    }
  }, []);

  // Monitor viewport width dynamically with ResizeObserver
  useEffect(() => {
    if (!viewportRef.current) return;
    const updateViewportWidth = () => {
      if (viewportRef.current) {
        setViewportWidth(viewportRef.current.clientWidth);
      }
    };

    updateViewportWidth();

    const ro = new ResizeObserver(() => {
      updateViewportWidth();
    });

    ro.observe(viewportRef.current);
    window.addEventListener('resize', updateViewportWidth);

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', updateViewportWidth);
    };
  }, []);

  // Dynamic scale calculation to fit the preview panel without clipping or horizontal scrollbars
  const effectiveScale = useMemo(() => {
    const paddingX = viewportWidth < 640 ? 20 : 40;
    const availableDocWidth = Math.max(160, viewportWidth - paddingX);
    const fitScale = docDimensions.width > 0 ? availableDocWidth / docDimensions.width : 1.0;

    if (autoFit) {
      // In autoFit mode, scale down proportionally so the document never overflows or clips.
      // Cap at 1.05 so crisp 1:1 scale is preserved on large displays.
      return Math.max(0.25, Math.min(1.05, fitScale));
    } else {
      return Math.max(0.25, Math.min(2.5, zoomLevel / 100));
    }
  }, [viewportWidth, docDimensions.width, autoFit, zoomLevel]);

  // Zoom and Auto-Fit action handlers
  const handleZoomOut = () => {
    setAutoFit(false);
    setZoomLevel((z) => {
      const current = autoFit ? Math.round(effectiveScale * 100) : z;
      return Math.max(40, current - 10);
    });
  };

  const handleZoomIn = () => {
    setAutoFit(false);
    setZoomLevel((z) => {
      const current = autoFit ? Math.round(effectiveScale * 100) : z;
      return Math.min(200, current + 10);
    });
  };

  const toggleAutoFit = () => {
    if (autoFit) {
      setAutoFit(false);
      setZoomLevel(Math.round(effectiveScale * 100));
    } else {
      setAutoFit(true);
    }
  };

  const handleResetTo100 = () => {
    if (autoFit) {
      setAutoFit(false);
      setZoomLevel(100);
    } else {
      setAutoFit(true);
    }
  };

  // Debounced form values for smooth live Word document re-rendering
  const [debouncedFormValues, setDebouncedFormValues] = useState(formValues);
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedFormValues(formValues);
    }, 250);
    return () => clearTimeout(handler);
  }, [formValues]);

  // PDF Print is the faithful preview. Generate it from current form values
  // after typing settles instead of always showing the raw uploaded template.
  useEffect(() => {
    if (!document || showOriginalUploaded || activeTab !== 'preview' || viewMode !== 'single' || previewFidelity !== 'pdf') {
      return;
    }

    let cancelled = false;
    setRenderingPdf(true);
    setPdfPreviewError(null);

    const renderLivePdf = async () => {
      try {
        const { blob } = await generateDocument(document.id, {
          format: 'pdf',
          values: debouncedFormValues,
          pf_mode: 'fixed',
          pf_percentage: 12,
        });
        if (cancelled) return;

        const nextUrl = URL.createObjectURL(blob);
        const previousUrl = livePdfUrlRef.current;
        livePdfUrlRef.current = nextUrl;
        setLivePdfUrl(nextUrl);
        if (previousUrl) URL.revokeObjectURL(previousUrl);
      } catch (err: any) {
        if (!cancelled) setPdfPreviewError(err?.message || 'Unable to update the live PDF preview.');
      } finally {
        if (!cancelled) setRenderingPdf(false);
      }
    };

    renderLivePdf();
    return () => {
      cancelled = true;
    };
  }, [document?.id, debouncedFormValues, showOriginalUploaded, activeTab, viewMode, previewFidelity]);

  useEffect(() => () => {
    if (livePdfUrlRef.current) URL.revokeObjectURL(livePdfUrlRef.current);
  }, []);

  // Fetch raw ArrayBuffer and Mammoth HTML cache
  useEffect(() => {
    if (!document) return;

    if (bufferCache[document.id] && htmlCache[document.id]) return;

    let isMounted = true;
    const fetchDocData = async () => {
      setLoading(true);
      setError(null);
      try {
        const buffer = await getDocumentPreviewArrayBuffer(document.id);
        const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
        if (isMounted) {
          setBufferCache((prev) => ({ ...prev, [document.id]: buffer }));
          setHtmlCache((prev) => ({
            ...prev,
            [document.id]: result.value || '<p class="text-slate-400 italic">No text extracted.</p>',
          }));
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err.message || 'Failed to fetch document template.');
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchDocData();
    return () => {
      isMounted = false;
    };
  }, [document?.id, bufferCache, htmlCache]);

  // Render high-fidelity Word preview with docx-preview
  useEffect(() => {
    if (activeTab !== 'preview' || viewMode !== 'single' || previewFidelity !== 'word') {
      return;
    }
    if (!document || !bufferCache[document.id] || loading) {
      return;
    }

    let isCancelled = false;
    const renderWord = async () => {
      if (!docxContainerRef.current) return;
      setRenderingDocx(true);
      setDocxRenderError(null);

      try {
        const rawBuf = bufferCache[document.id];
        let targetBuffer = rawBuf;

        if (!showOriginalUploaded) {
          // Inject live form values into the Word document XML while preserving 100% of formatting, colors, logos, and tables
          try {
            targetBuffer = fillDocxArrayBufferClient(
              rawBuf,
              debouncedFormValues,
              calculatedValues,
              highlightFields
            );
          } catch (fillErr) {
            console.warn('Live field filling warning, using clean document buffer:', fillErr);
            targetBuffer = rawBuf;
          }
        }

        if (isCancelled || !docxContainerRef.current) return;
        docxContainerRef.current.innerHTML = '';

        await renderAsync(targetBuffer, docxContainerRef.current, undefined, {
          className: 'docx',
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          ignoreFonts: false,
          breakPages: true,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: true,
          useBase64URL: true,
        });

        if (!isCancelled) {
          setDocxRenderError(null);
        }
      } catch (err: any) {
        if (!isCancelled) {
          console.warn('docx-preview rendering warning:', err);
          // Try fallback rendering the raw unmodified buffer
          try {
            if (docxContainerRef.current) {
              docxContainerRef.current.innerHTML = '';
              await renderAsync(bufferCache[document.id], docxContainerRef.current, undefined, {
                className: 'docx',
                inWrapper: true,
                useBase64URL: true,
              });
              setDocxRenderError(null);
              return;
            }
          } catch (rawErr) {
            console.warn('Fallback docx render also failed:', rawErr);
          }
          setDocxRenderError(err?.message || 'Word styling preview encountered a rendering issue.');
        }
      } finally {
        if (!isCancelled) {
          setRenderingDocx(false);
          requestAnimationFrame(() => {
            if (!isCancelled) measureDoc();
          });
        }
      }
    };

    const timer = setTimeout(() => {
      renderWord();
    }, 40);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [
    document?.id,
    bufferCache,
    loading,
    activeTab,
    viewMode,
    previewFidelity,
    debouncedFormValues,
    calculatedValues,
    highlightFields,
    showOriginalUploaded,
  ]);

  // Prefetch HTML for "all" mode
  useEffect(() => {
    if (viewMode !== 'all' || allDocuments.length === 0) return;

    allDocuments.forEach(async (doc) => {
      if (htmlCache[doc.id]) return;
      try {
        const buffer = await getDocumentPreviewArrayBuffer(doc.id);
        const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
        setBufferCache((prev) => ({ ...prev, [doc.id]: buffer }));
        setHtmlCache((prev) => ({
          ...prev,
          [doc.id]: result.value || '<p class="text-slate-400 italic">Empty</p>',
        }));
      } catch {
        // background prefetch ignored
      }
    });
  }, [viewMode, allDocuments, htmlCache]);

  // Quick download helper
  const handleQuickDownload = async (doc: DocumentMeta, format: 'docx' | 'pdf') => {
    try {
      setDownloadingDocId(doc.id);

      const { blob, filename } = await generateDocument(doc.id, {
        format,
        values: formValues,
        pf_mode: 'fixed',
        pf_percentage: 12,
      });

      const url = window.URL.createObjectURL(blob);
      const link = window.document.createElement('a');
      link.href = url;
      link.download = filename;
      window.document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(`Download failed: ${err.message || 'Error generating document'}`);
    } finally {
      setDownloadingDocId(null);
    }
  };

  const currentRawHtml = document ? htmlCache[document.id] || '' : '';
  const pdfPreviewSrc = document
    ? showOriginalUploaded || !livePdfUrl
      ? `/documents/${document.id}/preview-pdf`
      : livePdfUrl
    : '';
  const currentRenderedHtml = useMemo(() => {
    return renderTemplateHtml(currentRawHtml, document, formValues, calculatedValues, highlightFields);
  }, [currentRawHtml, document, formValues, calculatedValues, highlightFields]);

  if (!document) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-slate-100/70 border-r border-slate-200">
        <div className="w-16 h-16 rounded-2xl bg-white border border-slate-200 flex items-center justify-center text-slate-400 shadow-xs mb-4">
          <FileText className="w-8 h-8" />
        </div>
        <h2 className="text-base font-bold text-slate-800">Select a template to view preview</h2>
        <p className="text-sm text-slate-500 mt-1 max-w-sm text-center">
          Choose a document from the templates list or upload a new template.
        </p>
      </div>
    );
  }

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'currency':
        return <IndianRupee className="w-3.5 h-3.5 text-emerald-600" />;
      case 'date':
        return <Calendar className="w-3.5 h-3.5 text-blue-600" />;
      case 'time':
        return <Clock className="w-3.5 h-3.5 text-amber-600" />;
      case 'email':
        return <Mail className="w-3.5 h-3.5 text-purple-600" />;
      case 'phone':
        return <Phone className="w-3.5 h-3.5 text-green-600" />;
      case 'boolean':
        return <CheckSquare className="w-3.5 h-3.5 text-indigo-600" />;
      case 'percentage':
        return <Percent className="w-3.5 h-3.5 text-rose-600" />;
      default:
        return <Hash className="w-3.5 h-3.5 text-slate-600" />;
    }
  };

  return (
    <section className="flex-1 flex flex-col h-full bg-slate-100/60 overflow-hidden min-w-0">
      {/* 1. Top Primary Toolbar: Template Switcher & Mode Toggles */}
      <div className="min-h-14 px-4 sm:px-5 py-2 border-b border-slate-200 bg-white flex flex-wrap items-center justify-between gap-3 shrink-0 shadow-2xs">
        {/* Left: Template Selector Tabs */}
        <div className="flex items-center gap-2 overflow-x-auto py-1 max-w-full">
          {onToggleSidebar && (
            <button
              type="button"
              onClick={onToggleSidebar}
              className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors shrink-0"
              title={isSidebarOpen ? "Collapse Templates Sidebar" : "Expand Templates Sidebar"}
            >
              {isSidebarOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
            </button>
          )}

          <span className="text-[11px] uppercase tracking-wider font-bold text-slate-400 mr-1 hidden sm:inline">
            Templates:
          </span>

          {allDocuments.map((doc) => {
            const isSelected = doc.id === document.id && viewMode === 'single';
            const stats = getDocFillStats(doc, formValues, calculatedValues);
            const isFullyFilled = stats.total > 0 && stats.filled === stats.total;

            return (
              <button
                key={doc.id}
                type="button"
                onClick={() => {
                  onSelectDoc?.(doc.id);
                  setViewMode('single');
                }}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap border ${
                  isSelected
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
                title={`Select ${doc.name}`}
              >
                <FileText className={`w-3.5 h-3.5 ${isSelected ? 'text-indigo-200' : 'text-slate-500'}`} />
                <span className="max-w-[140px] truncate">{doc.name.replace(/\.docx$/i, '')}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono font-medium ${
                    isSelected
                      ? isFullyFilled
                        ? 'bg-emerald-500 text-white'
                        : 'bg-indigo-700 text-indigo-100'
                      : isFullyFilled
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  {stats.filled}/{stats.total}
                </span>
              </button>
            );
          })}

          {/* All Templates View Switcher */}
          {allDocuments.length > 1 && (
            <button
              type="button"
              onClick={() => setViewMode((m) => (m === 'all' ? 'single' : 'all'))}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap border ${
                viewMode === 'all'
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
              title="View all templates side by side"
            >
              <Layers className={`w-3.5 h-3.5 ${viewMode === 'all' ? 'text-indigo-200' : 'text-slate-500'}`} />
              <span>All Templates ({allDocuments.length})</span>
            </button>
          )}
        </div>

        {/* Right Controls: Fidelity Selector, Zoom, and Actions */}
        <div className="flex items-center gap-2">
          {/* Badge: Full Color Fidelity Guarantee */}
          <span className="hidden xl:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-2xs shrink-0">
            <Palette className="w-3.5 h-3.5 text-emerald-600" />
            <span>Exact Word Colors & Tables Preserved</span>
          </span>

          {/* View Mode Selector (Word Colors vs PDF Print vs Badges vs Schema) */}
          {viewMode === 'single' && (
            <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('preview');
                  setPreviewFidelity('word');
                }}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md transition-all ${
                  activeTab === 'preview' && previewFidelity === 'word'
                    ? 'bg-white text-indigo-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="Exact Word Document layout with full colors, custom fonts, and table cell shading"
              >
                <Palette className="w-3.5 h-3.5" />
                <span>Word Colors</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveTab('preview');
                  setPreviewFidelity('pdf');
                }}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md transition-all ${
                  activeTab === 'preview' && previewFidelity === 'pdf'
                    ? 'bg-white text-indigo-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="View vector PDF generated with headless LibreOffice"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>PDF Print</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveTab('preview');
                  setPreviewFidelity('badges');
                }}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md transition-all ${
                  activeTab === 'preview' && previewFidelity === 'badges'
                    ? 'bg-white text-indigo-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="Quick text view with colored badges highlighting every variable"
              >
                <Highlighter className="w-3.5 h-3.5" />
                <span>Field Badges</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('schema')}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md transition-all ${
                  activeTab === 'schema'
                    ? 'bg-white text-indigo-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="List all extracted placeholders and current values"
              >
                <ListTree className="w-3.5 h-3.5" />
                <span>Variables ({document.placeholders.length})</span>
              </button>
            </div>
          )}

          {/* Template Content Mode: Live Filled vs As Uploaded */}
          {document && viewMode === 'single' && activeTab === 'preview' && (
            <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200">
              <button
                type="button"
                onClick={() => setShowOriginalUploaded(false)}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all ${
                  !showOriginalUploaded
                    ? 'bg-white text-indigo-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="Preview with filled form values"
              >
                Live Filled
              </button>
              <button
                type="button"
                onClick={() => setShowOriginalUploaded(true)}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all ${
                  showOriginalUploaded
                    ? 'bg-white text-indigo-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="View exact raw template as uploaded without values replaced"
              >
                As Uploaded
              </button>
            </div>
          )}

          {/* Zoom & Auto-Fit Controls (Single Preview only) */}
          {viewMode === 'single' && activeTab === 'preview' && previewFidelity !== 'pdf' && (
            <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg border border-slate-200">
              <button
                type="button"
                onClick={handleZoomOut}
                title="Zoom Out"
                className="p-1 text-slate-600 hover:text-slate-900 hover:bg-white rounded transition-colors"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={toggleAutoFit}
                title={autoFit ? "Auto-Fit active: scaled to panel width. Click to lock zoom." : "Click to auto-fit to panel width"}
                className={`px-2 py-0.5 text-[11px] font-mono font-medium rounded transition-all flex items-center gap-1 ${
                  autoFit
                    ? 'bg-white text-indigo-700 shadow-2xs font-semibold ring-1 ring-black/5'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white'
                }`}
              >
                <Maximize2 className={`w-3 h-3 ${autoFit ? 'text-indigo-600' : 'text-slate-400'}`} />
                <span>{autoFit ? `Fit (${Math.round(effectiveScale * 100)}%)` : `${Math.round(effectiveScale * 100)}%`}</span>
              </button>
              <button
                type="button"
                onClick={handleZoomIn}
                title="Zoom In"
                className="p-1 text-slate-600 hover:text-slate-900 hover:bg-white rounded transition-colors"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={handleResetTo100}
                title={autoFit ? "Switch to 100% 1:1 scale" : "Reset to Auto-Fit"}
                className="p-1 text-slate-600 hover:text-slate-900 hover:bg-white rounded transition-colors border-l border-slate-200 text-[10px] font-bold px-1.5"
              >
                {autoFit ? '1:1' : 'Fit'}
              </button>
            </div>
          )}

          {/* Quick Download Buttons */}
          {viewMode === 'single' && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={downloadingDocId === document.id}
                onClick={() => handleQuickDownload(document, 'docx')}
                className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors shadow-2xs disabled:opacity-50"
                title="Download filled DOCX with 100% original formatting and colors"
              >
                <Download className="w-3 h-3" />
                <span>DOCX</span>
              </button>
              <button
                type="button"
                disabled={downloadingDocId === document.id}
                onClick={() => handleQuickDownload(document, 'pdf')}
                className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-slate-800 text-white hover:bg-slate-900 transition-colors shadow-2xs disabled:opacity-50"
                title="Download filled PDF generated via LibreOffice"
              >
                <Download className="w-3 h-3" />
                <span>PDF</span>
              </button>
            </div>
          )}

          {/* Right Panel Toggle Button */}
          {onToggleRightPanel && (
            <button
              type="button"
              onClick={onToggleRightPanel}
              className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors shrink-0 border-l border-slate-200 pl-2"
              title={isRightPanelOpen ? "Collapse Form Panel" : "Expand Form Panel"}
            >
              {isRightPanelOpen ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
            </button>
          )}
        </div>
      </div>

      {/* 2. Main View Area */}
      <div ref={viewportRef} className="flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-5 md:p-6 min-w-0">
        {loading ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-500 py-16">
            <RefreshCw className="w-8 h-8 animate-spin text-indigo-600 mb-3" />
            <p className="text-sm font-medium">Loading document template with full styling...</p>
          </div>
        ) : error ? (
          <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm flex items-start gap-3">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-rose-600" />
            <div>
              <p className="font-semibold">Unable to render preview</p>
              <p className="text-xs text-rose-700 mt-1">{error}</p>
            </div>
          </div>
        ) : viewMode === 'all' ? (
          /* All Templates Side-by-Side View */
          <div className="space-y-6">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Layers className="w-4 h-4 text-indigo-600" />
                  <span>All Loaded Templates (Auto-Filling Live)</span>
                </h3>
                <p className="text-xs text-slate-500">
                  Values entered in the form populate across all templates simultaneously.
                </p>
              </div>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                {allDocuments.length} Templates Active
              </span>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 items-start">
              {(allDocuments || []).map((doc) => {
                const raw = htmlCache[doc.id] || '';
                const rendered = renderTemplateHtml(raw, doc, formValues, calculatedValues, highlightFields);
                const stats = getDocFillStats(doc, formValues, calculatedValues);

                return (
                  <div
                    key={doc.id}
                    className="flex flex-col rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden"
                  >
                    <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <FileText className="w-4 h-4 text-indigo-600 shrink-0" />
                        <h4 className="text-xs font-bold text-slate-900 truncate" title={doc.name}>
                          {doc.name}
                        </h4>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-semibold shrink-0">
                          {stats.filled} / {stats.total} filled
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            onSelectDoc?.(doc.id);
                            setViewMode('single');
                          }}
                          className="px-2.5 py-1 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors"
                        >
                          Focus
                        </button>
                        <button
                          type="button"
                          onClick={() => handleQuickDownload(doc, 'docx')}
                          className="px-2 py-1 text-[11px] font-semibold text-slate-700 hover:text-indigo-600 bg-white border border-slate-200 rounded-lg transition-colors"
                          title="Download DOCX"
                        >
                          DOCX
                        </button>
                      </div>
                    </div>

                    <div className="p-8 max-h-[700px] overflow-y-auto bg-slate-50/50">
                      <div className="bg-white rounded-xl shadow-xs border border-slate-200/80 p-8 text-slate-800 text-xs leading-relaxed">
                        <div
                          className="prose prose-sm prose-slate max-w-none [&_table]:w-full [&_table]:border-collapse [&_table]:my-4 [&_table]:text-xs [&_th]:border [&_th]:border-slate-300 [&_th]:bg-slate-50 [&_th]:p-2 [&_th]:text-left [&_th]:font-bold [&_td]:border [&_td]:border-slate-300 [&_td]:p-2"
                          dangerouslySetInnerHTML={{ __html: rendered }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : activeTab === 'preview' ? (
          /* Single Document Preview with Multi-Fidelity Support */
          <div>
            {previewFidelity === 'word' ? (
              /* High-Fidelity Word Layout (docx-preview with full original colors, tables, logos, and fonts) */
              <div className="flex flex-col items-center">
                {/* Info Callout */}
                <div className="w-full max-w-4xl mb-4 flex items-center justify-between px-4 py-2.5 rounded-xl bg-indigo-50/70 border border-indigo-100 text-indigo-900 text-xs shadow-2xs">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-indigo-600 shrink-0" />
                    <span>
                      {showOriginalUploaded ? (
                        <>
                          <strong>Original Uploaded Template:</strong> Showing the unmodified template in the browser Word preview. Use PDF Print for the most faithful page layout.
                        </>
                      ) : (
                        <>
                          <strong>Live Filled Preview:</strong> Showing a browser approximation of the filled Word document. Use PDF Print for the most faithful page layout.
                        </>
                      )}
                    </span>
                  </div>
                  {renderingDocx && (
                    <span className="flex items-center gap-1 text-[11px] font-medium text-indigo-600">
                      <RefreshCw className="w-3 h-3 animate-spin" /> Updating...
                    </span>
                  )}
                </div>

                {docxRenderError ? (
                  <div className="w-full max-w-2xl p-6 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 shadow-xs flex flex-col items-center text-center my-4">
                    <AlertCircle className="w-8 h-8 text-amber-600 mb-2" />
                    <h4 className="text-sm font-bold">Word Preview Notice</h4>
                    <p className="text-xs text-amber-800 mt-1 max-w-md">
                      This template contains complex Office drawing or markup elements. You can view the <strong>Vector PDF Print</strong> view for a 100% exact print layout or switch to <strong>Field Badges</strong>.
                    </p>
                    <div className="flex items-center gap-2 mt-4">
                      <button
                        type="button"
                        onClick={() => setPreviewFidelity('pdf')}
                        className="px-3.5 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-colors shadow-2xs"
                      >
                        Switch to Vector PDF View
                      </button>
                      <button
                        type="button"
                        onClick={() => setPreviewFidelity('badges')}
                        className="px-3.5 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-700 text-xs font-semibold hover:bg-slate-50 transition-colors shadow-2xs"
                      >
                        View Field Badges
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Proportional Responsive Scaled Word Document Container */
                  <div className="w-full flex flex-col items-center justify-start min-w-0">
                    <div
                      style={{
                        width: `${Math.round(docDimensions.width * effectiveScale)}px`,
                        height: `${Math.round(docDimensions.height * effectiveScale)}px`,
                        maxWidth: '100%',
                        position: 'relative',
                      }}
                      className="flex justify-center"
                    >
                      <div
                        style={{
                          width: `${docDimensions.width}px`,
                          transform: `scale(${effectiveScale})`,
                          transformOrigin: 'top left',
                          position: 'absolute',
                          top: 0,
                          left: 0,
                        }}
                      >
                        <div
                          ref={docxContainerRef}
                          className="w-full flex flex-col items-center [&_.docx-wrapper]:bg-transparent [&_.docx-wrapper]:p-0 [&_.docx-wrapper]:overflow-visible [&_section.docx]:shadow-xl [&_section.docx]:border [&_section.docx]:border-slate-200/90 [&_section.docx]:rounded-sm [&_section.docx]:mb-8"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : previewFidelity === 'pdf' ? (
              /* Vector PDF Print View via Headless LibreOffice */
              <div className="flex flex-col items-center">
                <div className="w-full max-w-4xl mb-4 flex items-center justify-between px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-800 text-xs shadow-2xs">
                  <div className="flex items-center gap-2">
                    <Printer className="w-4 h-4 text-slate-700 shrink-0" />
                    <span>
                      <strong>{showOriginalUploaded ? 'Original PDF Print View:' : 'Live Filled PDF Preview:'}</strong>{' '}
                      {showOriginalUploaded
                        ? 'Showing the untouched uploaded template.'
                        : 'Updates after you pause typing while preserving the template layout, colors, tables, and graphics.'}
                    </span>
                  </div>
                  {renderingPdf && (
                    <span className="flex items-center gap-1 text-[11px] font-medium text-indigo-600">
                      <RefreshCw className="w-3 h-3 animate-spin" /> Updating...
                    </span>
                  )}
                  <a
                    href={pdfPreviewSrc}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                  >
                    <span>Open in new tab</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>

                <div className="w-full max-w-4xl bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden h-[850px]">
                  <iframe
                    src={pdfPreviewSrc}
                    className="w-full h-full border-0"
                    title="PDF Preview"
                  />
                </div>
                {pdfPreviewError && <p className="mt-3 text-xs text-rose-700">{pdfPreviewError}</p>}
              </div>
            ) : (
              /* Field Badges View */
              <div className="flex flex-col items-center">
                <div className="w-full max-w-3xl mb-4 flex items-center justify-between px-4 py-2 rounded-xl bg-amber-50/80 border border-amber-200 text-amber-900 text-xs">
                  <div className="flex items-center gap-2">
                    <Highlighter className="w-4 h-4 text-amber-700" />
                    <span>
                      <strong>Field Badges View:</strong> Emphasizes every placeholder and calculation with color-coded tags for rapid verification.
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setHighlightFields((h) => !h)}
                    className="text-xs font-bold text-amber-800 underline"
                  >
                    {highlightFields ? 'Turn Highlights Off' : 'Turn Highlights On'}
                  </button>
                </div>

                <div
                  style={{ transform: `scale(${zoomLevel / 100})`, transformOrigin: 'top center' }}
                  className="bg-white rounded-xl shadow-lg border border-slate-200/80 p-12 max-w-3xl w-full min-h-[840px] text-slate-800 transition-transform duration-100 ease-out leading-relaxed"
                >
                  <div
                    className="prose prose-slate max-w-none prose-p:leading-relaxed prose-headings:font-bold [&_table]:w-full [&_table]:border-collapse [&_table]:my-5 [&_table]:text-xs sm:[&_table]:text-sm [&_th]:border [&_th]:border-slate-300 [&_th]:bg-slate-50 [&_th]:p-2.5 [&_th]:text-left [&_th]:font-bold [&_th]:text-slate-800 [&_td]:border [&_td]:border-slate-300 [&_td]:p-2.5 [&_td]:text-slate-700"
                    dangerouslySetInnerHTML={{ __html: currentRenderedHtml }}
                  />
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Schema Table */
          <div className="bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 bg-slate-50/50 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Extracted Placeholders & Schema</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Standard format: <code className="text-indigo-600 font-mono">{'{{placeholder}}'}</code> or <code className="text-emerald-600 font-mono">{'[CALC(...)]'}</code>
                </p>
              </div>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                {document.placeholders.length} Variables Found
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-700">
                <thead className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="py-3 px-4 font-semibold">Placeholder</th>
                    <th className="py-3 px-4 font-semibold">Inferred Type</th>
                    <th className="py-3 px-4 font-semibold">Current Value in Preview</th>
                    <th className="py-3 px-4 font-semibold">Mode</th>
                    <th className="py-3 px-4 font-semibold">Required</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {document.placeholders.map((p) => {
                    const isCalc = p.calculated;
                    const val = isCalc
                      ? calculatedValues?.[p.name]?.formatted_value
                      : formValues[p.name] ?? formValues[p.name.toLowerCase()];

                    return (
                      <tr key={p.name} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-4 font-mono font-semibold text-indigo-700">
                          {`{{${p.name}}}`}
                        </td>
                        <td className="py-3 px-4">
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-100 text-slate-800 font-medium text-xs">
                            {getTypeIcon(p.type)}
                            <span className="capitalize">{p.type}</span>
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          {val !== undefined && val !== null && String(val).trim() !== '' ? (
                            <span className="font-mono font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                              {String(val)}
                            </span>
                          ) : (
                            <span className="text-slate-400 italic">Empty</span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          {p.calculated ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-semibold border border-emerald-200 text-[11px]">
                              Auto Calculated
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-medium text-[11px]">
                              User Input
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          {p.required ? (
                            <span className="text-amber-600 font-medium">Yes</span>
                          ) : (
                            <span className="text-slate-400">Optional</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
