import { DAYS } from './scheduler.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const replaceAll = (text, from, to) => text.split(from).join(to);
const TEMPLATE_URL = 'src/timetable-output.html';
const INDIVIDUAL_TEMPLATE_URL = 'src/timetable-output-individual.html';
const LOGO_SRC = 'src/rpsit_logo.jpeg';
const LOGO_URL = '/src/rpsit_logo.jpeg';
let templateCache = {};
let logoCache = null;

async function loadLogo() {
  if (logoCache) return logoCache;
  if (typeof document === 'undefined') return LOGO_URL;
  try {
    const url = new URL(LOGO_SRC, document.baseURI).href;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not load logo (${response.status}).`);
    const blob = await response.blob();
    logoCache = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Could not read logo file.'));
      reader.readAsDataURL(blob);
    });
    return logoCache;
  } catch {
    return LOGO_URL;
  }
}

async function loadTemplate(file = TEMPLATE_URL) {
  if (templateCache[file]) return templateCache[file];
  const url = new URL(file, document.baseURI).href;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load timetable template (${response.status}).`);
  templateCache[file] = await response.text();
  return templateCache[file];
}

function sectionOf(className) {
  const cleaned = String(className || '').trim();
  const inParens = cleaned.match(/[(\[]\s*([A-Za-z0-9]{1,3})\s*[)\]]$/);
  if (inParens) return inParens[1].toUpperCase();
  const trailing = cleaned.match(/(?:^|[-_\s])([A-Za-z0-9]{1,3})$/);
  return trailing ? trailing[1].toUpperCase() : 'A';
}

function cellLabel(schedule, day, period) {
  const cell = schedule[day]?.[period];
  if (!cell) return '';
  return `${esc(cell.acronym || cell.code)}${cell.kind === 'lab' ? ' LAB' : ''}`;
}

function workloadOf(subject) {
  return `${subject.theoryPeriods || 0}${subject.labPeriods ? `+${subject.labPeriods}` : ''}`;
}

export function renderTemplate(templateHtml, schedule, model, logoSrc = LOGO_URL) {
  const className = schedule.className || '';
  const classSubjects = model.subjects.filter(subject => String(subject.className || '').trim() === String(className).trim());

  let doc = fillHeader(templateHtml, model, className, logoSrc);

  for (let dayIndex = 0; dayIndex < DAYS.length; dayIndex++) {
    const day = DAYS[dayIndex];
    for (let period = 0; period < 8; period++) {
      doc = replaceAll(doc, `%%CELL_${dayIndex}_${period}%%`, cellLabel(schedule, day, period));
    }
  }

  const fields = ['ACRONYM', 'CODE', 'NAME', 'WORKLOAD', 'TEACHER'];
  for (let row = 0; row < 15; row++) {
    const subject = classSubjects[row];
    for (const field of fields) {
      const value = !subject ? '' : { ACRONYM: subject.acronym, CODE: subject.code, NAME: subject.name, WORKLOAD: workloadOf(subject), TEACHER: subject.teacher }[field];
      doc = replaceAll(doc, `%%SUBJ_${row}_${field}%%`, esc(value));
    }
  }

  return doc.replace(/%%[A-Z][A-Z_]*(?:_[A-Z0-9]+)*%%/g, '');
}

function fillHeader(templateHtml, model, className, logoSrc) {
  const metadata = model.metadata || {};
  let doc = templateHtml;
  doc = replaceAll(doc, 'src="rpsit_logo.jpeg"', `src="${logoSrc}"`);
  doc = replaceAll(doc, '%%DOC_ID%%', esc(metadata.documentId || `2026-27/ODD/RPSIT/${className}/TT/01`));
  doc = replaceAll(doc, '%%DOC_NAME%%', esc(metadata.documentName || 'Time Table'));
  doc = replaceAll(doc, '%%PROGRAMME%%', esc(metadata.programme || className));
  doc = replaceAll(doc, '%%YEAR_SEM%%', esc(metadata.yearSem || ''));
  doc = replaceAll(doc, '%%REGULATION%%', esc(metadata.regulation || 'R-2024'));
  doc = replaceAll(doc, '%%ODD_EVEN%%', esc(metadata.oddEven || 'ODD'));
  doc = replaceAll(doc, '%%ACADEMIC_YEAR%%', esc(metadata.academicYear || ''));
  doc = replaceAll(doc, '%%WEF%%', esc(metadata.effectiveDate || ''));
  doc = replaceAll(doc, '%%CLASS_ADVISOR%%', esc(metadata.classAdvisor || ''));
  doc = replaceAll(doc, '%%SECTION%%', esc(metadata.section || sectionOf(className)));
  return doc;
}

export function renderTeacherTemplate(templateHtml, result, model, teacherName, logoSrc = LOGO_URL) {
  const teacher = String(teacherName || '').trim();
  const className = teacher.replace(/[^A-Za-z0-9]+/g, '_');
  let doc = fillHeader(templateHtml, model, className, logoSrc);
  doc = replaceAll(doc, '%%FACULTY%%', esc(teacher));

  for (let dayIndex = 0; dayIndex < DAYS.length; dayIndex++) {
    const day = DAYS[dayIndex];
    for (let period = 0; period < 8; period++) {
      const assignments = Object.values(result.schedules).map(schedule => {
        const cell = schedule[day]?.[period];
        return cell?.teacher === teacher ? `<strong>${esc(cell.acronym || cell.subjectCode || cell.subjectName)}</strong><small>${esc(schedule.className)}${cell.kind === 'lab' ? ' · LAB' : ''}</small>` : '';
      }).filter(Boolean);
      const content = assignments.length ? assignments.join('<span class="divider"></span>') : '';
      doc = replaceAll(doc, `%%TCELL_${dayIndex}_${period}%%`, content);
    }
  }

  return doc.replace(/%%[A-Z][A-Z_]*(?:_[A-Z0-9]+)*%%/g, '');
}

export async function buildExportDocument(schedule, model, template = 'class', templateHtml) {
  const html = templateHtml || await loadTemplate();
  const logoSrc = await loadLogo();
  return renderTemplate(html, schedule, model, logoSrc);
}

export async function buildIndividualExportDocument(result, model, teacherName, templateHtml) {
  const html = templateHtml || await loadTemplate(INDIVIDUAL_TEMPLATE_URL);
  const logoSrc = await loadLogo();
  return renderTeacherTemplate(html, result, model, teacherName, logoSrc);
}

export async function downloadPdf(schedule, model, template = 'class') {
  const doc = await buildExportDocument(schedule, model, template);
  const frame = document.createElement('iframe');
  frame.className = 'print-frame';
  frame.srcdoc = doc.replace('</body>', '<script>window.onload=()=>setTimeout(()=>window.print(),150)<\/script></body>');
  document.body.appendChild(frame);
  setTimeout(() => frame.remove(), 4000);
}

export async function downloadTeacherPdf(result, model, teacherName) {
  const doc = await buildIndividualExportDocument(result, model, teacherName);
  const frame = document.createElement('iframe');
  frame.className = 'print-frame';
  frame.srcdoc = doc.replace('</body>', '<script>window.onload=()=>setTimeout(()=>window.print(),150)<\/script></body>');
  document.body.appendChild(frame);
  setTimeout(() => frame.remove(), 4000);
}
