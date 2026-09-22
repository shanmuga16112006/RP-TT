import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRows, validateRows } from '../src/data-model.js';

test('normalizes the supplied section-marker workbook format', () => {
  const rows = [
    ['AIDS'],
    ['Acronym', 'Subject Code', 'Subject Name', 'Faculty Member', 'periods'],
    ['DDM', '24AD301TP', 'Database Design', 'Mr. Kannan / AI&DS', '4+2'],
    ['CSE'],
    ['Acronym', 'Subject Code', 'Subject Name', 'Faculty Member', 'periods'],
    ['OS', '24CS301T', 'Operating Systems', 'Dr. Rao / CSE', 4]
  ];
  const result = normalizeRows(rows);
  assert.deepEqual(result.classes, ['AIDS', 'CSE']);
  assert.equal(result.subjects[0].className, 'AIDS');
  assert.equal(result.subjects[0].theoryPeriods, 4);
  assert.equal(result.subjects[0].labPeriods, 2);
});

test('treats padded one-cell class headings as class markers, not subjects', () => {
  const result = normalizeRows([
    ['AIDS', '', '', '', '', ''],
    ['Acronym', 'Subject Code', 'Subject Name', 'Faculty Member', 'periods', ''],
    ['M', 'M1', 'Math', 'Dr. Saranya, Professor / Maths', 4, ''],
    ['', '', '', '', '', ''],
    ['     CSE', '', '', '', '', '']
  ]);
  assert.deepEqual(result.classes, ['AIDS', 'CSE']);
  assert.equal(result.subjects.length, 1);
  assert.equal(result.subjects.some(subject => subject.acronym === 'CSE'), false);
});

test('validates required canonical columns and reports missing fields', () => {
  const result = validateRows([['Teacher Name', 'Subject Name'], ['T', 'S']]);
  assert.equal(result.valid, false);
  assert.ok(result.missing.includes('Subject Code'));
  assert.ok(result.missing.includes('Class Name'));
  assert.ok(result.missing.includes('Periods Required'));
});

test('preserves input-sheet lab block fields for the scheduler', () => {
  const rows = [
    ['Teacher Name', 'Subject Name', 'Subject Code', 'Class Name', 'Periods Required', 'Lab Day', 'Lab Start', 'Lab Length'],
    ['T1', 'Programming Lab', 'L1', 'AIDS', '0+2', 'MON', 5, 2]
  ];
  const result = normalizeRows(rows);
  assert.equal(result.labs[0].subjectId, result.subjects[0].id);
  assert.deepEqual({ day: result.labs[0].day, startPeriod: result.labs[0].startPeriod, length: result.labs[0].length }, { day: 'MON', startPeriod: 5, length: 2 });
});

test('extracts only faculty names, excluding role and department text', () => {
  const rows = [
    ['AIDS'],
    ['Acronym', 'Subject Code', 'Subject Name', 'Faculty Member', 'periods'],
    ['M', 'M1', 'Math', 'Dr. V. Saranya, Professor / Maths', 4],
    ['DB', 'D1', 'Database', 'Mr. G. Kannan, ASP / AI&DS', 4],
    ['MC', 'MC1', 'Mentor', 'Mr. G. Kannan, ASP / AI&DS; Mrs. M. Srimathi, AP / AI&DS', 1]
  ];
  const result = normalizeRows(rows);
  assert.deepEqual(Object.keys(result.teachers).sort(), ['Dr. V. Saranya', 'Mr. G. Kannan', 'Mrs. M. Srimathi']);
  assert.equal(result.staff.some(person => /Professor|ASP|AI&DS|Maths|Placement Coordinator/.test(person.name)), false);
});

test('treats a lab-named single workload as continuous lab hours', () => {
  const result = normalizeRows([
    ['AIDS'],
    ['Acronym', 'Subject Code', 'Subject Name', 'Faculty Member', 'periods'],
    ['AIT LAB', '24AD304P', 'Artificial Intelligence Techniques Laboratory', 'G. Kannan, ASP / AI&DS', 2]
  ]);
  assert.equal(result.subjects[0].theoryPeriods, 0);
  assert.equal(result.subjects[0].labPeriods, 2);
  assert.equal(result.labs[0].length, 2);
});

test('accepts plural Lab Days markers and normalizes full day names', () => {
  const result = normalizeRows([
    ['AIDS'],
    ['Acronym', 'Subject Code', 'Subject Name', 'Faculty Member', 'periods', 'Lab Days'],
    ['DDM', '24AD301TP', 'Database Design', 'Mr. Kannan, ASP / AI&DS', '4+2', 'Monday']
  ]);
  assert.equal(result.subjects[0].labDay, 'MON');
  assert.equal(result.labs[0].day, 'MON');
});

test('reports the imported weekly workload total without counting separator rows', () => {
  const result = normalizeRows([
    ['AIDS'],
    ['Acronym', 'Subject Code', 'Subject Name', 'Faculty Member', 'periods'],
    ['M', 'M1', 'Math', 'Dr. Saranya', 4],
    ['', '', '', '', 3],
    ['CSE', '', '', '', '']
  ]);
  assert.equal(result.weeklyHours, 4);
});

test('keeps every section in the input data as its own class', () => {
  const result = normalizeRows([
    ['AIDS(A)'],
    ['Acronym', 'Subject Code', 'Subject Name', 'Faculty Member', 'periods', 'Lab Day', 'Lab Start'],
    ['DDM', '24AD301TP', 'Database Design', 'Mr. Kannan', '4+2', 'MON', 3],
    ['AIDS(B)'],
    ['Acronym', 'Subject Code', 'Subject Name', 'Faculty Member', 'periods', 'Lab Day', 'Lab Start'],
    ['DDM', '24AD301TP', 'Database Design', 'Mr. Kannan', '4+2', 'TUE', 5],
    ['AIDS(C)'],
    ['Acronym', 'Subject Code', 'Subject Name', 'Faculty Member', 'periods', 'Lab Day', 'Lab Start'],
    ['DDM', '24AD301TP', 'Database Design', 'Mr. Kannan', '4+2', 'FRI', 7]
  ]);
  assert.deepEqual(result.classes, ['AIDS(A)', 'AIDS(B)', 'AIDS(C)']);
  assert.equal(result.subjects.length, 3);
  assert.ok(result.subjects.every(subject => subject.className !== subject.acronym), 'section markers must never be parsed as subject rows');
  assert.deepEqual(result.subjects.map(subject => subject.className), ['AIDS(A)', 'AIDS(B)', 'AIDS(C)']);
  assert.deepEqual(result.subjects.map(subject => subject.id), result.labs.map(lab => lab.subjectId));
  assert.deepEqual(result.subjects.map(subject => subject.labDay), ['MON', 'TUE', 'FRI']);
  assert.deepEqual(result.subjects.map(subject => subject.labStart), [3, 5, 7]);
});
