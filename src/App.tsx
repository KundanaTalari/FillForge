import React, { useState, useEffect, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { DocumentPreview } from './components/DocumentPreview';
import { DynamicForm } from './components/DynamicForm';
import { BulkMode } from './components/BulkMode';
import { DocumentMeta, CTCBreakdown } from './types';
import { getDocuments, uploadDocument, deleteDocument } from './services/api';
import {
  FileText,
  Layers,
  Sparkles,
  Users,
  CheckCircle2,
  AlertCircle,
  FileSpreadsheet
} from 'lucide-react';

export function App() {
  const [documents, setDocuments] = useState<DocumentMeta[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [activeMode, setActiveMode] = useState<'single' | 'bulk'>('single');
  const [loading, setLoading] = useState<boolean>(true);
  const [notification, setNotification] = useState<string | null>(null);

  // Live real-time field values and CTC calculations for the preview
  const [liveFormData, setLiveFormData] = useState<Record<string, any>>({});
  const [liveCalculations, setLiveCalculations] = useState<CTCBreakdown | null>(null);

  const fetchDocs = async () => {
    try {
      setLoading(true);
      const docs = await getDocuments();
      const safeDocs = Array.isArray(docs) ? docs : [];
      setDocuments(safeDocs);
      if (safeDocs.length > 0 && !selectedDocId) {
        setSelectedDocId(safeDocs[0].id);
      } else if (safeDocs.length > 0 && selectedDocId && !safeDocs.some((d) => d.id === selectedDocId)) {
        setSelectedDocId(safeDocs[0].id);
      } else if (safeDocs.length === 0) {
        setSelectedDocId(null);
      }
    } catch (err) {
      console.error('Failed to load documents:', err);
      setDocuments([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDocs();
  }, []);

  const handleSelectDoc = (id: string) => {
    setSelectedDocId(id);
  };

  const handleUpload = async (file: File) => {
    const newDoc = await uploadDocument(file);
    await fetchDocs();
    setSelectedDocId(newDoc.id);
    showToast(`Template "${file.name}" uploaded and parsed successfully!`);
  };

  const handleDelete = async (id: string) => {
    await deleteDocument(id);
    await fetchDocs();
    showToast('Template deleted successfully.');
  };

  const showToast = (msg: string) => {
    setNotification(msg);
    setTimeout(() => {
      setNotification(null);
    }, 4500);
  };

  const handleLoadSamples = async () => {
    try {
      setLoading(true);
      // Request sample generation endpoint if available, or fetch docs
      await fetch('/api/seed-samples', { method: 'POST' }).catch(() => {});
      await fetchDocs();
      showToast('Sample templates loaded successfully!');
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const safeDocuments = Array.isArray(documents) ? documents : [];
  const selectedDocument = safeDocuments.find((d) => d.id === selectedDocId) || null;

  return (
    <div className="flex h-screen w-screen bg-white text-slate-900 overflow-hidden font-sans antialiased">
      {/* 1. Left Column: Templates Sidebar */}
      <Sidebar
        documents={documents}
        selectedDocId={selectedDocId}
        onSelectDoc={handleSelectDoc}
        onUpload={handleUpload}
        onDelete={handleDelete}
        onLoadSamples={handleLoadSamples}
        loading={loading}
      />

      {/* 2. Center Column: Live Document Preview */}
      <DocumentPreview
        document={selectedDocument}
        allDocuments={documents}
        onSelectDoc={handleSelectDoc}
        formValues={liveFormData}
        calculatedValues={liveCalculations}
      />

      {/* 3. Right Column: Operation Panel (Single vs Bulk) */}
      <aside className="w-96 flex flex-col h-full bg-white border-l border-slate-200 shrink-0 select-none">
        {/* Mode Selector Header */}
        <div className="h-14 px-6 border-b border-slate-200 flex items-center justify-between shrink-0 bg-white">
          <div className="flex bg-slate-100 p-1 rounded-xl w-full">
            <button
              type="button"
              onClick={() => setActiveMode('single')}
              className={`flex-1 flex items-center justify-center gap-2 py-1.5 px-3 rounded-lg text-xs font-bold transition-all ${
                activeMode === 'single'
                  ? 'bg-white text-indigo-700 shadow-xs ring-1 ring-black/5'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Single Fill</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveMode('bulk')}
              className={`flex-1 flex items-center justify-center gap-2 py-1.5 px-3 rounded-lg text-xs font-bold transition-all ${
                activeMode === 'bulk'
                  ? 'bg-white text-indigo-700 shadow-xs ring-1 ring-black/5'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Bulk Mode</span>
            </button>
          </div>
        </div>

        {/* Mode Content */}
        <div className="flex-1 overflow-hidden">
          {activeMode === 'single' ? (
            <DynamicForm
              document={selectedDocument}
              onGenerationSuccess={(file) => showToast(`Document "${file}" generated!`)}
              onValuesChange={(data, calcs) => {
                setLiveFormData(data);
                setLiveCalculations(calcs);
              }}
            />
          ) : (
            <BulkMode document={selectedDocument} />
          )}
        </div>
      </aside>

      {/* Floating Notification Toast */}
      {notification && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2.5 px-4 py-3 bg-slate-900 text-white rounded-xl shadow-lg text-xs font-medium animate-in fade-in slide-in-from-bottom-3 duration-200">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{notification}</span>
        </div>
      )}
    </div>
  );
}

export default App;
