import test from 'node:test';
import assert from 'node:assert/strict';
import { renderShell, renderSetup, renderTeacherTimetable, renderLabTimetable } from '../src/ui.js';

test('top bar keeps the class selector and regenerate button without the template dropdown', () => {
  const html = renderShell();
  assert.match(html, /id="class-selector"/);
  assert.match(html, /Regenerate Selected Class/);
  assert.doesNotMatch(html, /template-selector/);
  assert.doesNotMatch(html, /Class template|Teacher template/);
});

test('timetable format offers only Class and Teacher options, never Lab', () => {
  const html = renderSetup();
  assert.match(html, /data-template="class"/);
  assert.match(html, /data-template="teacher"/);
  assert.doesNotMatch(html, /data-template="lab"/);
  assert.doesNotMatch(html, /<strong>Lab<\/strong>/);
});

test('renders working teacher and lab timetable views', () => {
  const model = { classes: ['AIDS'], teachers: { T1: { name: 'Teacher One', initials: 'TO' } }, subjects: [{ id: 'lab', className: 'AIDS', acronym: 'LB', code: 'L1', name: 'Lab', teacher: 'Teacher One', labPeriods: 2 }] };
  const schedule = { className: 'AIDS', MON: Array(8).fill(null), TUE: Array(8).fill(null), WED: Array(8).fill(null), THU: Array(8).fill(null), FRI: Array(8).fill(null), SAT: Array(8).fill(null) };
  schedule.MON[2] = { subjectId: 'lab', acronym: 'LB', kind: 'lab', teacher: 'Teacher One', period: 2 };
  schedule.MON[3] = { subjectId: 'lab', acronym: 'LB', kind: 'lab', teacher: 'Teacher One', period: 3 };
  const result = { schedules: { AIDS: schedule } };
  assert.match(renderTeacherTimetable(result, model), /Individual timetable/);
  assert.match(renderTeacherTimetable(result, model), /teacher-selector/);
  assert.match(renderTeacherTimetable(result, model), /Print \/ Save PDF/);
  assert.match(renderLabTimetable(result, model, 'AIDS'), /LB P3–P4/);
});

test('renders each lab Day dropdown with its own stored day and reflects updates', () => {
  const model = {
    activeClass: 'AIDS', classes: ['AIDS'], filename: 'classes.xlsx',
    subjects: [
      { id: 'a', className: 'AIDS', acronym: 'DB', code: 'D1', name: 'Database', teacher: 'T1', theoryPeriods: 4, labPeriods: 2 },
      { id: 'b', className: 'AIDS', acronym: 'OS', code: 'O1', name: 'Operating Systems', teacher: 'T2', theoryPeriods: 4, labPeriods: 2 }
    ],
    staff: [],
    labs: [
      { subjectId: 'a', day: '', startPeriod: null, length: 2 },
      { subjectId: 'b', day: 'WED', startPeriod: 5, length: 2 }
    ]
  };
  const html = renderSetup(model);
  const dbSelect = html.match(/<select data-lab-day="a">([\s\S]*?)<\/select>/)[1];
  const osSelect = html.match(/<select data-lab-day="b">([\s\S]*?)<\/select>/)[1];
  assert.match(dbSelect, /<option value="MON" >MON<\/option>/);
  assert.doesNotMatch(dbSelect, /value="MON" selected/);
  assert.match(osSelect, /<option value="WED" selected>WED<\/option>/);
  assert.doesNotMatch(osSelect, /value="MON" selected/);
  assert.doesNotMatch(html, /data-lab-period/);
  assert.doesNotMatch(html, /Starting period/);
  model.labs[0].day = 'THU';
  const reRendered = renderSetup(model);
  assert.match(reRendered, /<select data-lab-day="a">[\s\S]*?<option value="THU" selected>THU<\/option>/);
  assert.doesNotMatch(reRendered, /data-lab-day="b"[\s\S]*?<option value="THU" selected>/);
});

test('lab cards expose only subject info and Day after the Starting period control is removed', () => {
  const model = {
    activeClass: 'AIDS', classes: ['AIDS'],
    subjects: [{ id: 'a', className: 'AIDS', acronym: 'DB', code: 'D1', name: 'Database', teacher: 'T1', theoryPeriods: 4, labPeriods: 2 }],
    staff: [],
    labs: [{ subjectId: 'a', day: 'MON', startPeriod: null, length: 2 }]
  };
  const html = renderSetup(model);
  const row = html.match(/<div class="lab-entry-row">(<div>[\s\S]*?<\/div>)(<label>Day[\s\S]*?<\/label>)<\/div>/);
  assert.ok(row, 'expected a lab entry row');
  const info = row[1];
  const dayControl = row[2];
  assert.match(info, /Database/);
  assert.match(dayControl, /<select data-lab-day="a">/);
  assert.match(dayControl, /<option value="MON" selected>MON<\/option>/);
  assert.equal((dayControl.match(/<select/g) || []).length, 1);
  assert.doesNotMatch(dayControl, /data-lab-period/);
  assert.doesNotMatch(dayControl, /Starting period/);
  assert.doesNotMatch(dayControl, /Period [0-9]/);
  assert.doesNotMatch(html, /data-lab-override/);
  assert.doesNotMatch(html, /r23-warning/);
});

test('renders staff roles and subjects only for the selected class', () => {
  const model = {
    activeClass: 'AIDS', classes: ['AIDS', 'CSE'], filename: 'classes.xlsx',
    subjects: [
      { id: 'a', className: 'AIDS', acronym: 'AI', code: 'A1', name: 'AI Subject', teacher: 'Teacher One', theoryPeriods: 2, labPeriods: 0 },
      { id: 'c', className: 'CSE', acronym: 'CS', code: 'C1', name: 'CSE Subject', teacher: 'Teacher Two', theoryPeriods: 2, labPeriods: 0 }
    ],
    staff: [
      { name: 'Teacher One', initials: 'TO', hodFor: ['AIDS'], ccFor: [] },
      { name: 'Teacher Two', initials: 'TT', hodFor: [], ccFor: ['CSE'] }
    ],
    labs: []
  };
  const html = renderSetup(model);
  assert.match(html, /STAFF RULES · AIDS/);
  assert.match(html, /Teacher One/);
  assert.doesNotMatch(html, /Teacher Two/);
  assert.match(html, /HOD · On/);
  assert.match(html, /CC · Off/);
  assert.match(html, /AI Subject/);
  assert.doesNotMatch(html, /CSE Subject/);
});
