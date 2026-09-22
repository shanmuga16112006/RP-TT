import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRows } from '../src/data-model.js';
import { generateTimetable } from '../src/scheduler.js';

test('supplied workbook rows produce class schedules and diagnostics', () => {
  const model = normalizeRows([
    ['AIDS'], ['Acronym', 'Subject Code', 'Subject Name', 'Faculty Member', 'periods'],
    ['MATH', 'M1', 'Math', 'Dr. Rao / AI&DS', 4], ['CSE'],
    ['Acronym', 'Subject Code', 'Subject Name', 'Faculty Member', 'periods'],
    ['OS', 'O1', 'Operating Systems', 'Dr. Rao / CSE', 4]
  ]);
  const result = generateTimetable(model);
  assert.deepEqual(model.classes, ['AIDS', 'CSE']);
  assert.ok(result.schedules.AIDS);
  assert.ok(Array.isArray(result.diagnostics));
});
