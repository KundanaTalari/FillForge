import axios from 'axios';
import { DocumentMeta, CTCBreakdown, BulkResult } from '../types';

const api = axios.create({
  baseURL: '', // Uses relative paths, intercepted by dev proxy or express
  timeout: 120000,
  withCredentials: true,
});

export interface User { id: string; name: string; email: string; }

export const getCurrentUser = async (): Promise<User | null> => {
  try {
    const res = await api.get('/auth/me');
    return res.data.user;
  } catch {
    return null;
  }
};

export const signIn = async (email: string, password: string): Promise<User> => {
  const res = await api.post('/auth/signin', { email, password });
  return res.data.user;
};

export const signUp = async (name: string, email: string, password: string): Promise<User> => {
  const res = await api.post('/auth/signup', { name, email, password });
  return res.data.user;
};

export const signOut = async () => {
  await api.post('/auth/signout');
};

export const getHealth = async () => {
  const res = await api.get('/health');
  return res.data;
};

export const getDocuments = async (): Promise<DocumentMeta[]> => {
  try {
    const res = await api.get('/documents');
    return Array.isArray(res.data) ? res.data : [];
  } catch (err) {
    console.error('getDocuments error:', err);
    return [];
  }
};

export const getDocument = async (id: string): Promise<DocumentMeta> => {
  const res = await api.get(`/documents/${id}`);
  return res.data;
};

export const uploadDocument = async (file: File): Promise<DocumentMeta> => {
  const formData = new FormData();
  formData.append('file', file);
  const res = await api.post('/documents/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data;
};

export const deleteDocument = async (id: string): Promise<{ status: string; id: string }> => {
  const res = await api.delete(`/documents/${id}`);
  return res.data;
};

export const getDocumentPreviewArrayBuffer = async (id: string): Promise<ArrayBuffer> => {
  const res = await api.get(`/documents/${id}/preview`, {
    responseType: 'arraybuffer',
  });
  return res.data;
};

export const calculateCTC = async (payload: {
  ctc_total: number;
  basic_pf?: number;
  pf_mode?: 'fixed' | 'percentage';
  pf_percentage?: number;
  preset?: 'nichebit' | 'standard' | 'custom';
  hra_rate_pct?: number;
  insurance_annual?: number;
  basic_mode?: 'statutory_min' | 'percentage' | 'fixed';
}): Promise<CTCBreakdown> => {
  const res = await api.post('/calculate', payload);
  return res.data;
};

export const generateDocument = async (
  id: string,
  payload: {
    format: 'docx' | 'pdf';
    values: Record<string, any>;
    pf_mode?: 'fixed' | 'percentage';
    pf_percentage?: number;
  }
): Promise<{ blob: Blob; filename: string }> => {
  const res = await api.post(`/documents/${id}/generate`, payload, {
    responseType: 'blob',
  });

  // Extract filename from Content-Disposition header if present
  let filename = `generated_document.${payload.format}`;
  const disposition = res.headers['content-disposition'];
  if (disposition) {
    const match = disposition.match(/filename="?([^";]+)"?/i);
    if (match && match[1]) {
      filename = match[1];
    }
  }

  return { blob: res.data, filename };
};

export const getSampleSheetUrl = (id: string) => `/documents/${id}/sample-sheet`;

export const fetchSampleSheetText = async (id: string): Promise<string> => {
  const res = await api.get(`/documents/${id}/sample-sheet`, {
    responseType: 'text',
  });
  return res.data;
};

export const downloadBulkZip = async (downloadUrl: string): Promise<Blob> => {
  const res = await api.get(downloadUrl, {
    responseType: 'blob',
  });
  return res.data;
};

export const bulkGenerate = async (
  id: string,
  file: File,
  format: 'docx' | 'pdf',
  pf_mode: 'fixed' | 'percentage',
  pf_percentage: number
): Promise<BulkResult> => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('format', format);
  formData.append('pf_mode', pf_mode);
  formData.append('pf_percentage', pf_percentage.toString());

  const res = await api.post(`/documents/${id}/bulk-generate`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data;
};
