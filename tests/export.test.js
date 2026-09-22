import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildExportDocument, renderTeacherTemplate } from '../src/export.js';

const templateHtml = readFileSync(new URL('../src/timetable-output.html', import.meta.url), 'utf8');
const individualTemplateHtml = readFileSync(new URL('../src/timetable-output-individual.html', import.meta.url), 'utf8');

test('builds the official template document with data filled in', async () => {
  const schedule = { className: 'AIDS', MON: Array(8).fill(null), TUE: Array(8).fill(null), WED: Array(8).fill(null), THU: Array(8).fill(null), FRI: Array(8).fill(null), SAT: Array(8).fill(null) };
  schedule.MON[2] = { subjectId: 'lab', acronym: 'DDM', subjectCode: 'D1', teacher: 'Mr. Kannan', kind: 'lab' };
  const model = { metadata: {}, subjects: [{ className: 'AIDS', acronym: 'DDM', code: 'D1', name: 'Database Design', theoryPeriods: 4, labPeriods: 2, teacher: 'Mr. Kannan' }, { className: 'CSE', acronym: 'OS', code: 'O1', name: 'Operating Systems', theoryPeriods: 4, labPeriods: 0, teacher: 'Dr. Rao' }] };
  const html = await buildExportDocument(schedule, model, 'class', templateHtml);
  assert.match(html, /class="time-table"/);
  assert.match(html, /CONCEPT OF THE DAY/);
  assert.match(html, /TIME TABLE INCHARGE/);
  assert.match(html, /DDM LAB/);
  assert.match(html, /Database Design/);
  assert.doesNotMatch(html, /Operating Systems/);
  assert.doesNotMatch(html, /%%CELL_/);
  assert.doesNotMatch(html, /%%SUBJ_/);
  assert.doesNotMatch(html, /%%DOC_/);
});

test('renders the individual (teacher) timetable template with that teacher\'s assignments only', () => {
  const makeWeek = () => ({ MON: Array(8).fill(null), TUE: Array(8).fill(null), WED: Array(8).fill(null), THU: Array(8).fill(null), FRI: Array(8).fill(null), SAT: Array(8).fill(null) });
  const aids = makeWeek();
  aids.MON[1] = { subjectId: 'ddm', acronym: 'DDM', subjectCode: 'D1', teacher: 'Mr. Kannan', kind: 'theory' };
  aids.TUE[4] = { subjectId: 'ddm', acronym: 'DDM', subjectCode: 'D1', teacher: 'Mr. Kannan', kind: 'lab' };
  const cse = makeWeek();
  cse.MON[1] = { subjectId: 'os', acronym: 'OS', subjectCode: 'O1', teacher: 'Dr. Rao', kind: 'theory' };
  const schedules = { AIDS: { ...aids, className: 'AIDS' }, CSE: { ...cse, className: 'CSE' } };
  const model = { metadata: { documentId: 'ID-1', documentName: 'Staff TT', programme: 'B.TECH AI&DS', yearSem: 'III / V Sem', regulation: 'R-2024', oddEven: 'ODD', academicYear: '2026-2027', effectiveDate: '22-06-2026' }, subjects: [] };
  const html = renderTeacherTemplate(individualTemplateHtml, { schedules }, model, 'Mr. Kannan');

  assert.match(html, /INDIVIDUAL TIME TABLE/);
  assert.match(html, /Name of the Faculty/);
  assert.match(html, />Mr\. Kannan</);
  assert.match(html, /ID-1/);
  assert.match(html, /R-2024/);
  assert.match(html, /Day-1/);
  assert.match(html, /Day-6/);
  assert.doesNotMatch(html, /OS/);
  assert.doesNotMatch(html, /%%TCELL_/);
  assert.doesNotMatch(html, /%%DOC_/);
  assert.doesNotMatch(html, /%%FACULTY%%/);
});