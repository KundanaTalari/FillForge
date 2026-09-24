export type VariableType =
  | 'text'
  | 'number'
  | 'currency'
  | 'date'
  | 'time'
  | 'datetime'
  | 'email'
  | 'phone'
  | 'boolean'
  | 'percentage';

export interface Placeholder {
  name: string;
  type: VariableType;
  required: boolean;
  calculated: boolean;
  description?: string;
}

export interface DocumentMeta {
  id: string;
  name: string;
  filename: string;
  placeholders: Placeholder[];
  created_at: string;
}

export interface CalculationResult {
  raw_value: number;
  formatted_value: string;
}

export type CTCBreakdown = Record<string, CalculationResult>;

export interface BulkFailure {
  row: number;
  error: string;
}

export interface BulkResult {
  succeeded: number;
  failed: number;
  failures: BulkFailure[];
  download_url?: string | null;
  download_filename?: string | null;
  batch_id?: string | null;
}
