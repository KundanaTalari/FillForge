import express from 'express';
import os from 'os';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import multer from 'multer';
import * as archiverModule from 'archiver';

function createZipArchive(options: any) {
  const mod: any = archiverModule;
  if (typeof mod === 'function') {
    return mod('zip', options);
  }
  if (mod.default && typeof mod.default === 'function') {
    return mod.default('zip', options);
  }
  if (mod.ZipArchive) {
    return new mod.ZipArchive(options);
  }
  if (mod.Archiver) {
    return new mod.Archiver('zip', options);
  }
  throw new Error('Unsupported archiver module structure');
}
import Papa from 'papaparse';
import { createServer as createViteServer } from 'vite';
import { calculateCTC, CTCBreakdown } from './server/calculations';
import {
  extractPlaceholdersFromDocxBuffer,
  renderDocxBuffer,
  DocumentRecord,
  PlaceholderMeta,
} from './server/docx';
import { convertDocxToPdfBuffer } from './server/pdfConverter';

const PORT = 3000;
const STORAGE_DIR = path.join(process.cwd(), 'storage');
const TEMPLATES_DIR = path.join(STORAGE_DIR, 'templates');
const GENERATED_DIR = path.join(STORAGE_DIR, 'generated');
const BULK_DIR = path.join(STORAGE_DIR, 'bulk');
const DB_FILE = path.join(STORAGE_DIR, 'documents.json');
const USERS_FILE = path.join(STORAGE_DIR, 'users.json');

interface UserRecord {
  id: string;
  name: string;
  email: string;
  salt: string;
  passwordHash: string;
  created_at: string;
}

interface SessionRecord {
  userId: string;
  expiresAt: number;
}

const sessions = new Map<string, SessionRecord>();

function loadUsers(): UserRecord[] {
  try {
    const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveUsers(users: UserRecord[]) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8');
}

function hashPassword(password: string, salt: string) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function publicUser(user: UserRecord) {
  return { id: user.id, name: user.name, email: user.email };
}

function getCookie(req: express.Request, name: string) {
  const raw = req.headers.cookie || '';
  const match = raw.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : undefined;
}

function createSession(res: express.Response, userId: string) {
  const token = crypto.randomBytes(32).toString('hex');
  const maxAgeSeconds = 60 * 60 * 8;
  sessions.set(token, { userId, expiresAt: Date.now() + maxAgeSeconds * 1000 });
  res.cookie('fillforge_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: maxAgeSeconds * 1000,
    secure: process.env.NODE_ENV === 'production',
  });
}

// Ensure storage directories exist
[STORAGE_DIR, TEMPLATES_DIR, GENERATED_DIR, BULK_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

function loadDocumentsDb(): DocumentRecord[] {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = fs.readFileSync(DB_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (err) {
    console.error('Error reading documents DB:', err);
  }
  return [];
}

function saveDocumentsDb(docs: DocumentRecord[]) {
  try {
    const serialized = JSON.stringify(docs, null, 2);
    if (fs.existsSync(DB_FILE) && fs.readFileSync(DB_FILE, 'utf-8') === serialized) {
      return;
    }
    fs.writeFileSync(DB_FILE, serialized, 'utf-8');
  } catch (err) {
    console.error('Error writing documents DB:', err);
  }
}

// Rescan templates directory and update DB
function syncTemplates() {
  const currentDocs = loadDocumentsDb();
  const currentMap = new Map<string, DocumentRecord>(currentDocs.map((d) => [d.id, d]));

  if (!fs.existsSync(TEMPLATES_DIR)) return;

  const files = fs.readdirSync(TEMPLATES_DIR);
  for (const file of files) {
    if (!file.toLowerCase().endsWith('.docx')) continue;

    const parts = file.split('_');
    const docId = parts[0];
    const docName = parts.slice(1).join('_').replace(/_/g, ' ') || file;

    const filePath = path.join(TEMPLATES_DIR, file);
    try {
      const fileBuffer = fs.readFileSync(filePath);
      const placeholders = extractPlaceholdersFromDocxBuffer(fileBuffer);

      currentMap.set(docId, {
        id: docId,
        name: docName,
        filename: file,
        placeholders,
        created_at: currentMap.get(docId)?.created_at || new Date().toISOString(),
      });
    } catch (err) {
      console.error(`Error parsing template ${file}:`, err);
    }
  }

  saveDocumentsDb(Array.from(currentMap.values()));
}

// Initial sync on startup
syncTemplates();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

async function startServer() {
  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.post('/auth/signup', (req, res) => {
    const name = String(req.body?.name || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!name || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8) {
      res.status(400).json({ detail: 'Enter your name, a valid email, and a password of at least 8 characters.' });
      return;
    }
    const users = loadUsers();
    if (users.some((user) => user.email === email)) {
      res.status(409).json({ detail: 'An account with this email already exists.' });
      return;
    }
    const salt = crypto.randomBytes(16).toString('hex');
    const user: UserRecord = {
      id: crypto.randomUUID(), name, email, salt,
      passwordHash: hashPassword(password, salt), created_at: new Date().toISOString(),
    };
    users.push(user);
    saveUsers(users);
    createSession(res, user.id);
    res.status(201).json({ user: publicUser(user) });
  });

  app.post('/auth/signin', (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const user = loadUsers().find((entry) => entry.email === email);
    if (!user || !crypto.timingSafeEqual(Buffer.from(user.passwordHash, 'hex'), Buffer.from(hashPassword(password, user.salt), 'hex'))) {
      res.status(401).json({ detail: 'Incorrect email or password.' });
      return;
    }
    createSession(res, user.id);
    res.json({ user: publicUser(user) });
  });

  app.post('/auth/signout', (req, res) => {
    const token = getCookie(req, 'fillforge_session');
    if (token) sessions.delete(token);
    res.clearCookie('fillforge_session');
    res.status(204).end();
  });

  app.get('/auth/me', (req, res) => {
    const token = getCookie(req, 'fillforge_session');
    const session = token ? sessions.get(token) : undefined;
    if (!session || session.expiresAt < Date.now()) {
      if (token) sessions.delete(token);
      res.status(401).json({ detail: 'Not signed in.' });
      return;
    }
    const user = loadUsers().find((entry) => entry.id === session.userId);
    if (!user) {
      sessions.delete(token!);
      res.status(401).json({ detail: 'Not signed in.' });
      return;
    }
    res.json({ user: publicUser(user) });
  });

  app.use((req, res, next) => {
    const protectedPath = req.path.startsWith('/documents') || req.path === '/calculate' || req.path === '/seed-samples' || req.path === '/api/seed-samples';
    if (!protectedPath) return next();
    const token = getCookie(req, 'fillforge_session');
    const session = token ? sessions.get(token) : undefined;
    if (!session || session.expiresAt < Date.now()) {
      if (token) sessions.delete(token);
      res.status(401).json({ detail: 'Please sign in to continue.' });
      return;
    }
    next();
  });

  // 1. Health check
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'FillForge' });
  });

  // 2. List all documents
  app.get('/documents', (req, res) => {
    syncTemplates();
    const docs = loadDocumentsDb();
    res.json(docs);
  });

  // 3. Upload a new document template
  app.post('/documents/upload', upload.single('file'), (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ detail: 'No file uploaded' });
        return;
      }

      if (!req.file.originalname.toLowerCase().endsWith('.docx')) {
        res.status(400).json({ detail: 'Only .docx documents are supported.' });
        return;
      }

      const docId = crypto.randomUUID();
      const safeOrigName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      const savedFilename = `${docId}_${safeOrigName}`;
      const destPath = path.join(TEMPLATES_DIR, savedFilename);

      fs.writeFileSync(destPath, req.file.buffer);

      const placeholders = extractPlaceholdersFromDocxBuffer(req.file.buffer);
      const newDoc: DocumentRecord = {
        id: docId,
        name: req.file.originalname,
        filename: savedFilename,
        placeholders,
        created_at: new Date().toISOString(),
      };

      const docs = loadDocumentsDb();
      docs.unshift(newDoc);
      saveDocumentsDb(docs);

      res.json(newDoc);
    } catch (err: any) {
      console.error('Upload error:', err);
      res.status(500).json({ detail: err.message || 'Failed to upload document' });
    }
  });

  // 4. Get a single document metadata
  app.get('/documents/:id', (req, res) => {
    const docs = loadDocumentsDb();
    const doc = docs.find((d) => d.id === req.params.id);
    if (!doc) {
      res.status(404).json({ detail: 'Document not found' });
      return;
    }
    res.json(doc);
  });

  // 5. Preview document (returns raw .docx for mammoth conversion in frontend)
  app.get('/documents/:id/preview', (req, res) => {
    const docs = loadDocumentsDb();
    const doc = docs.find((d) => d.id === req.params.id);
    if (!doc) {
      res.status(404).json({ detail: 'Document not found' });
      return;
    }

    const filePath = path.join(TEMPLATES_DIR, doc.filename);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ detail: 'Template file missing' });
      return;
    }

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    res.sendFile(filePath);
  });

  // 5b. High-fidelity PDF Preview with caching (preserves 100% of colors, tables, logos, fonts)
  app.get('/documents/:id/preview-pdf', async (req, res) => {
    try {
      const docs = loadDocumentsDb();
      const doc = docs.find((d) => d.id === req.params.id);
      if (!doc) {
        res.status(404).json({ detail: 'Document not found' });
        return;
      }

      const filePath = path.join(TEMPLATES_DIR, doc.filename);
      if (!fs.existsSync(filePath)) {
        res.status(404).json({ detail: 'Template file missing' });
        return;
      }

      const cacheDir = path.join(os.tmpdir(), 'fillforge-preview-cache');
      fs.mkdirSync(cacheDir, { recursive: true });
      const cachePdfPath = path.join(cacheDir, `${doc.filename}.pdf`);

      if (fs.existsSync(cachePdfPath) && fs.statSync(cachePdfPath).size > 0) {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.name.replace(/\.docx$/i, '.pdf'))}"`);
        res.sendFile(cachePdfPath);
        return;
      }

      const docxBuffer = fs.readFileSync(filePath);
      const pdfBuffer = await convertDocxToPdfBuffer(docxBuffer, doc.name);
      fs.writeFileSync(cachePdfPath, pdfBuffer);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.name.replace(/\.docx$/i, '.pdf'))}"`);
      res.send(pdfBuffer);
    } catch (err: any) {
      console.error('PDF Preview error:', err);
      res.status(500).json({ detail: 'Failed to generate PDF preview' });
    }
  });

  // 6. Delete document
  app.delete('/documents/:id', (req, res) => {
    const docs = loadDocumentsDb();
    const idx = docs.findIndex((d) => d.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ detail: 'Document not found' });
      return;
    }

    const [deleted] = docs.splice(idx, 1);
    saveDocumentsDb(docs);

    const filePath = path.join(TEMPLATES_DIR, deleted.filename);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (e) {
        console.error('Error removing file:', e);
      }
    }

    res.json({ status: 'deleted', id: req.params.id });
  });

  // 7. Calculate CTC
  app.post('/calculate', (req, res) => {
    try {
      const {
        ctc_total,
        basic_pf = 1800,
        pf_mode = 'fixed',
        pf_percentage = 12,
        preset = 'nichebit',
        hra_rate_pct = 10,
        insurance_annual = 8000,
        basic_mode = 'statutory_min',
      } = req.body;
      const breakdown = calculateCTC(
        ctc_total,
        basic_pf,
        pf_mode,
        pf_percentage,
        preset,
        hra_rate_pct,
        insurance_annual,
        basic_mode
      );
      res.json(breakdown);
    } catch (err: any) {
      res.status(400).json({ detail: err.message || 'Calculation error' });
    }
  });

  // 8. Generate Single Document
  app.post('/documents/:id/generate', async (req, res) => {
    try {
      const docs = loadDocumentsDb();
      const doc = docs.find((d) => d.id === req.params.id);
      if (!doc) {
        res.status(404).json({ detail: 'Document not found' });
        return;
      }

      const templatePath = path.join(TEMPLATES_DIR, doc.filename);
      if (!fs.existsSync(templatePath)) {
        res.status(404).json({ detail: 'Template file not found' });
        return;
      }

      const templateBuffer = fs.readFileSync(templatePath);
      const { values = {}, pf_mode = 'fixed', pf_percentage = 12, format = 'docx' } = req.body;

      const generatedBuffer = renderDocxBuffer(templateBuffer, values, pf_mode, pf_percentage);

      const baseName = (doc.name || 'document').replace(/\.docx$/i, '');
      const first = values.first_name || '';
      const last = values.last_name || '';
      const empId = values.employee_id || '';
      const nameParts = [baseName, empId, first, last].filter(Boolean);

      const isPdf = String(format).toLowerCase() === 'pdf';

      if (isPdf) {
        const pdfBuffer = await convertDocxToPdfBuffer(generatedBuffer, doc.name);
        const filename = `${nameParts.join('_') || 'filled_document'}.pdf`;

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(pdfBuffer);
      } else {
        const filename = `${nameParts.join('_') || 'filled_document'}.docx`;

        res.setHeader(
          'Content-Type',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        );
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(generatedBuffer);
      }
    } catch (err: any) {
      console.error('Generation error:', err);
      res.status(500).json({ detail: err.message || 'Generation failed' });
    }
  });

  // 9. Download Sample CSV Sheet for Bulk Mode
  app.get(['/documents/:id/sample-sheet', '/api/documents/:id/sample-sheet'], (req, res) => {
    const docs = loadDocumentsDb();
    const doc = docs.find((d) => d.id === req.params.id);
    if (!doc) {
      res.status(404).json({ detail: 'Document not found' });
      return;
    }

    // Include non-calculated placeholders plus sample data
    const nonCalc = doc.placeholders.filter((p) => !p.calculated);
    const headers = nonCalc.map((p) => p.name);

    const sampleRow1: Record<string, string> = {};
    const sampleRow2: Record<string, string> = {};

    nonCalc.forEach((p) => {
      if (p.name === 'first_name') {
        sampleRow1[p.name] = 'Aarav';
        sampleRow2[p.name] = 'Diya';
      } else if (p.name === 'last_name') {
        sampleRow1[p.name] = 'Patel';
        sampleRow2[p.name] = 'Sharma';
      } else if (p.name === 'candidate_name') {
        sampleRow1[p.name] = 'Aarav Patel';
        sampleRow2[p.name] = 'Diya Sharma';
      } else if (p.name === 'employee_id') {
        sampleRow1[p.name] = 'EMP-1001';
        sampleRow2[p.name] = 'EMP-1002';
      } else if (p.name === 'designation') {
        sampleRow1[p.name] = 'Software Engineer';
        sampleRow2[p.name] = 'Product Designer';
      } else if (p.name === 'department') {
        sampleRow1[p.name] = 'Engineering';
        sampleRow2[p.name] = 'Design';
      } else if (p.name === 'date_of_joining') {
        sampleRow1[p.name] = '2026-10-01';
        sampleRow2[p.name] = '2026-10-15';
      } else if (p.name === 'joining_time') {
        sampleRow1[p.name] = '10:00:00';
        sampleRow2[p.name] = '10:00:00';
      } else if (p.name === 'ctc_total' || p.name === 'salary' || p.name === 'ctc') {
        sampleRow1[p.name] = '800000';
        sampleRow2[p.name] = '1200000';
      } else if (p.name === 'basic_pf') {
        sampleRow1[p.name] = '1800';
        sampleRow2[p.name] = '1800';
      } else if (p.name === 'email') {
        sampleRow1[p.name] = 'aarav.patel@example.com';
        sampleRow2[p.name] = 'diya.sharma@example.com';
      } else if (p.name === 'phone' || p.name === 'mobile') {
        sampleRow1[p.name] = '+91 98765 12345';
        sampleRow2[p.name] = '+91 98765 67890';
      } else {
        sampleRow1[p.name] = 'Sample ' + p.name;
        sampleRow2[p.name] = 'Sample ' + p.name;
      }
    });

    const csv = Papa.unparse({
      fields: headers,
      data: [sampleRow1, sampleRow2],
    });

    const filename = `${doc.name.replace(/\.docx$/i, '')}_sample_template.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(csv);
  });

  // 10. Bulk Generate Documents
  app.post('/documents/:id/bulk-generate', upload.single('file'), async (req, res) => {
    try {
      const docs = loadDocumentsDb();
      const doc = docs.find((d) => d.id === req.params.id);
      if (!doc) {
        res.status(404).json({ detail: 'Document not found' });
        return;
      }

      if (!req.file) {
        res.status(400).json({ detail: 'No spreadsheet file uploaded.' });
        return;
      }

      const templatePath = path.join(TEMPLATES_DIR, doc.filename);
      if (!fs.existsSync(templatePath)) {
        res.status(404).json({ detail: 'Template file missing' });
        return;
      }

      const templateBuffer = fs.readFileSync(templatePath);
      const fileContent = req.file.buffer.toString('utf-8');

      const parsed = Papa.parse(fileContent, { header: true, skipEmptyLines: true });
      const rows = parsed.data as Record<string, any>[];

      if (rows.length === 0) {
        res.status(400).json({ detail: 'The uploaded spreadsheet contains no data rows.' });
        return;
      }

      const pfMode = (req.body.pf_mode || 'fixed') as 'fixed' | 'percentage';
      const pfPercentage = Number(req.body.pf_percentage) || 12;
      const format = (req.body.format || 'pdf').toLowerCase() === 'docx' ? 'docx' : 'pdf';

      const batchId = crypto.randomUUID();
      const zipFilename = `bulk_${batchId}.zip`;
      const zipFilePath = path.join(BULK_DIR, zipFilename);

      const output = fs.createWriteStream(zipFilePath);
      const archive = createZipArchive({ zlib: { level: 6 } });

      let successfulRows = 0;
      let failedRows = 0;
      const errors: string[] = [];

      archive.pipe(output);

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        try {
          const docBuffer = renderDocxBuffer(templateBuffer, row, pfMode, pfPercentage);
          const first = row.first_name || '';
          const last = row.last_name || '';
          const empId = row.employee_id || `Row_${i + 1}`;
          const baseDocName = doc.name.replace(/\.docx$/i, '');

          if (format === 'pdf') {
            const pdfBuffer = await convertDocxToPdfBuffer(docBuffer, doc.name);
            const rowFilename = `${baseDocName}_${empId}_${first}_${last}`.replace(/__+/g, '_') + '.pdf';
            archive.append(pdfBuffer, { name: rowFilename });
          } else {
            const rowFilename = `${baseDocName}_${empId}_${first}_${last}`.replace(/__+/g, '_') + '.docx';
            archive.append(docBuffer, { name: rowFilename });
          }
          successfulRows++;
        } catch (rowErr: any) {
          failedRows++;
          errors.push(`Row ${i + 1}: ${rowErr.message}`);
        }
      }

      await archive.finalize();

      // Wait for output stream to close
      await new Promise<void>((resolve, reject) => {
        output.on('close', resolve);
        output.on('error', reject);
      });

      res.json({
        succeeded: successfulRows,
        failed: failedRows,
        failures: errors.map((err, idx) => ({ row: idx + 1, error: err })),
        total_rows: rows.length,
        successful_rows: successfulRows,
        failed_rows: failedRows,
        errors,
        download_url: `/documents/download-bulk/${batchId}`,
        batch_id: batchId,
      });
    } catch (err: any) {
      console.error('Bulk generate error:', err);
      res.status(500).json({ detail: err.message || 'Bulk generation failed' });
    }
  });

  // 11. Download Bulk Zip
  app.get(['/documents/download-bulk/:batchId', '/bulk/download/:batchId'], (req, res) => {
    const batchId = req.params.batchId.replace(/^bulk_/, '').replace(/\.zip$/, '');
    const zipPath = path.join(BULK_DIR, `bulk_${batchId}.zip`);

    if (!fs.existsSync(zipPath)) {
      res.status(404).json({ detail: 'Bulk archive not found or expired.' });
      return;
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="fillforge_bulk_${batchId.slice(0, 8)}.zip"`);
    res.sendFile(zipPath);
  });

  // 12. Seed samples
  app.post(['/seed-samples', '/api/seed-samples'], (req, res) => {
    syncTemplates();
    res.json({ status: 'ok', message: 'Sample templates synced.' });
  });

  // Vite development middleware vs production static files
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`FillForge Full-Stack Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
