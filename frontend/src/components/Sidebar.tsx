import React, { useRef, useState } from 'react';
import { DocumentMeta } from '../types';
import {
  FileText,
  Plus,
  Trash2,
  UploadCloud,
  FileSpreadsheet,
  Layers,
  Sparkles,
  AlertCircle
} from 'lucide-react';

interface SidebarProps {
  documents: DocumentMeta[];
  selectedDocId: string | null;
  onSelectDoc: (id: string) => void;
  onUpload: (file: File) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onLoadSamples: () => Promise<void>;
  loading: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  documents,
  selectedDocId,
  onSelectDoc,
  onUpload,
  onDelete,
  onLoadSamples,
  loading,
}) => {
  const safeDocs = Array.isArray(documents) ? documents : [];
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [docToDelete, setDocToDelete] = useState<DocumentMeta | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processFile(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const processFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.docx')) {
      setUploadError('Please select a valid Microsoft Word (.docx) document.');
      return;
    }
    setUploadError(null);
    setUploading(true);
    try {
      await onUpload(file);
    } catch (err: any) {
      setUploadError(err.response?.data?.detail || err.message || 'Upload failed');
    } finally {
      setUploading(false);
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

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      await processFile(file);
    }
  };

  return (
    <aside className="w-80 border-r border-slate-200 bg-slate-50/50 flex flex-col h-full select-none">
      {/* App Branding */}
      <div className="p-4 border-b border-slate-200 bg-white">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center font-bold text-lg shadow-sm">
            FF
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 tracking-tight leading-tight">FillForge</h1>
            <p className="text-xs text-slate-500 font-medium">Type once. Fill everywhere.</p>
          </div>
        </div>
      </div>

      {/* Upload Zone */}
      <div className="p-4 border-b border-slate-200 bg-white">
        <input
          ref={fileInputRef}
          type="file"
          accept=".docx"
          className="hidden"
          onChange={handleFileChange}
        />
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`cursor-pointer border-2 border-dashed rounded-xl p-4 text-center transition-all ${
            isDragging
              ? 'border-indigo-500 bg-indigo-50/50'
              : 'border-slate-300 hover:border-slate-400 bg-slate-50/80 hover:bg-slate-100/50'
          }`}
        >
          <div className="flex flex-col items-center gap-1.5">
            <div className="w-9 h-9 rounded-lg bg-indigo-100/70 text-indigo-700 flex items-center justify-center">
              <UploadCloud className="w-5 h-5" />
            </div>
            <div className="text-sm font-semibold text-slate-800">
              {uploading ? 'Processing Template...' : 'Upload DOCX Template'}
            </div>
            <p className="text-xs text-slate-500">Drag & drop or click to browse</p>
          </div>
        </div>

        {uploadError && (
          <div className="mt-2.5 p-2.5 rounded-lg bg-rose-50 border border-rose-200 flex items-start gap-2 text-rose-700 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{uploadError}</span>
          </div>
        )}

        <div className="mt-3 flex items-center justify-between">
          <button
            type="button"
            onClick={onLoadSamples}
            disabled={loading}
            className="w-full inline-flex items-center justify-center gap-1.5 text-xs font-medium text-indigo-700 hover:text-indigo-800 bg-indigo-50/80 hover:bg-indigo-100/80 border border-indigo-200/80 rounded-lg py-1.5 px-2.5 transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Load Sample Templates</span>
          </button>
        </div>
      </div>

      {/* Templates List Header */}
      <div className="px-4 py-3 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Templates ({safeDocs.length})
        </span>
      </div>

      {/* Templates List */}
      <div className="flex-1 overflow-y-auto px-3 space-y-1.5 pb-4">
        {safeDocs.length === 0 ? (
          <div className="text-center py-10 px-4">
            <div className="w-12 h-12 mx-auto rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center mb-3">
              <FileText className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-semibold text-slate-700">No templates yet</h3>
            <p className="text-xs text-slate-500 mt-1 max-w-[200px] mx-auto">
              Upload your first DOCX template or click "Load Sample Templates" above.
            </p>
          </div>
        ) : (
          safeDocs.map((doc) => {
            const isSelected = doc.id === selectedDocId;
            const placeholderCount = doc.placeholders?.length || 0;
            const calcCount = doc.placeholders?.filter((p) => p.calculated)?.length || 0;

            return (
              <div
                key={doc.id}
                onClick={() => onSelectDoc(doc.id)}
                className={`group relative rounded-xl p-3 cursor-pointer transition-all border ${
                  isSelected
                    ? 'bg-white border-indigo-600 shadow-xs ring-1 ring-indigo-600/10'
                    : 'bg-white/70 hover:bg-white border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                        isSelected
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-100 text-slate-600 group-hover:bg-slate-200'
                      }`}
                    >
                      <FileText className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900 truncate leading-snug">
                        {doc.name}
                      </div>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        <span className="inline-flex items-center text-[10px] font-medium text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">
                          {placeholderCount} {placeholderCount === 1 ? 'field' : 'fields'}
                        </span>
                        {calcCount > 0 && (
                          <span className="inline-flex items-center text-[10px] font-medium text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200/50">
                            {calcCount} calc
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDocToDelete(doc);
                    }}
                    title="Delete template"
                    className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-rose-600 p-1 rounded-md hover:bg-rose-50 transition-all"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {docToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-xl border border-slate-200">
            <h3 className="text-base font-bold text-slate-900">Delete Template?</h3>
            <p className="text-sm text-slate-600 mt-2">
              Are you sure you want to remove <span className="font-semibold text-slate-800">"{docToDelete.name}"</span>?
              This will also delete the physical template file.
            </p>
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setDocToDelete(null)}
                className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  const id = docToDelete.id;
                  setDocToDelete(null);
                  await onDelete(id);
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 rounded-xl shadow-xs transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};
