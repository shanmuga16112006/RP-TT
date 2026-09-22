import { normalizeRows, validateRows } from './data-model.js';

export function rowsFromWorkbook(workbook) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error('Workbook has no worksheets.');
  return window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
}

export async function loadWorkbook(file) {
  if (!window.XLSX) throw new Error('Excel parser is still loading. Please try again.');
  const buffer = await file.arrayBuffer();
  const workbook = window.XLSX.read(buffer, { type: 'array' });
  return rowsFromWorkbook(workbook);
}

export async function buildModelFromWorkbook(file) {
  const rows = await loadWorkbook(file);
  const validation = validateRows(rows);
  if (!validation.valid) {
    const error = new Error(`Missing required columns: ${validation.missing.join(', ')}`);
    error.validation = validation;
    throw error;
  }
  return normalizeRows(rows);
}
