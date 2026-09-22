const aliases = {
  acronym: ['acronym', 'short name', 'subject acronym'],
  code: ['subject code', 'code'],
  name: ['subject name', 'subject', 'name'],
  teacher: ['faculty member', 'teacher name', 'teacher', 'faculty'],
  periods: ['periods', 'periods required', 'workload', 'hours'],
  className: ['class name', 'class', 'section']
  ,labDay: ['lab day', 'lab days', 'lab_day', 'lab schedule day']
  ,labStart: ['lab start', 'lab start period', 'start period']
  ,labLength: ['lab length', 'lab duration', 'lab block length']
};

const clean = value => String(value ?? '').trim();
const key = value => clean(value).toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
const extractTeacherNames = value => clean(value).split(';').map(part => clean(part.split(',')[0])).filter(name => name && !/^(professor|asp|ap|associate|assistant|placement|coordinator|hod|cc)\b/i.test(name));
const normalizeDay = value => ({ monday: 'MON', tuesday: 'TUE', wednesday: 'WED', thursday: 'THU', friday: 'FRI', saturday: 'SAT', mon: 'MON', tue: 'TUE', wed: 'WED', thu: 'THU', fri: 'FRI', sat: 'SAT' }[key(value)] || clean(value).toUpperCase());

function findColumn(headers, field) {
  const wanted = aliases[field];
  return headers.findIndex(header => wanted.includes(key(header)));
}

function parsePeriods(value) {
  const parts = clean(value).split('+').map(Number).filter(Number.isFinite);
  return { theoryPeriods: parts[0] || 0, labPeriods: parts[1] || 0 };
}

function isHeader(row) {
  const normalized = row.map(key);
  return normalized.some(v => v === 'subject code') && normalized.some(v => v === 'subject name') && (normalized.includes('acronym') || normalized.includes('teacher name') || normalized.includes('faculty member'));
}

export function validateRows(rows) {
  const header = rows.find(row => isHeader(row)) || rows[0] || [];
  const required = ['Teacher Name', 'Subject Name', 'Subject Code', 'Class Name', 'Periods Required'];
  const found = new Set(header.map(key));
  const legacy = isHeader(header) && found.has('faculty member') && found.has('periods');
  const missing = [];
  if (!legacy) {
    const requiredFields = { teacher: 'Teacher Name', name: 'Subject Name', code: 'Subject Code', className: 'Class Name', periods: 'Periods Required' };
    for (const [field, label] of Object.entries(requiredFields)) if (findColumn(header, field) < 0) missing.push(label);
  }
  return { valid: missing.length === 0, missing: [...new Set(missing)], warnings: legacy ? ['Legacy section-marker format detected.'] : [] };
}

export function normalizeRows(rows) {
  const classes = [];
  const subjects = [];
  let activeClass = '';
  let header = null;
  let columns = {};
  for (const raw of rows) {
    const row = raw.map(clean);
    if (!row.some(Boolean)) continue;
    if (isHeader(row)) {
      header = row;
      columns = Object.fromEntries(Object.keys(aliases).map(field => [field, findColumn(header, field)]));
      continue;
    }
    const nonEmptyCells = row.filter(Boolean);
    const isClassMarker = nonEmptyCells.length === 1 && row[0] === nonEmptyCells[0];
    if (!header || isClassMarker) {
      if (row[0] && !row[0].toLowerCase().includes('acronym')) {
        activeClass = row[0];
        if (!classes.includes(activeClass)) classes.push(activeClass);
      }
      continue;
    }
    const value = field => columns[field] >= 0 ? row[columns[field]] : '';
    const parsed = parsePeriods(value('periods'));
    const className = value('className') || activeClass || 'Unassigned';
    if (!classes.includes(className)) classes.push(className);
    const teacher = extractTeacherNames(value('teacher')).join('; ');
    const labDetected = parsed.labPeriods > 0 || /lab/i.test(value('name') + value('code'));
    const theoryPeriods = labDetected && parsed.labPeriods === 0 ? 0 : parsed.theoryPeriods;
    const labPeriods = labDetected && parsed.labPeriods === 0 ? parsed.theoryPeriods : parsed.labPeriods;
    const subject = {
      id: `${className}-${value('code') || value('acronym')}-${subjects.length}`,
      className, acronym: value('acronym'), code: value('code'), name: value('name'), teacher,
      theoryPeriods, labPeriods,
      extracurricularPlacement: 'separate',
      isLab: labDetected,
      allowEarlyStart: false,
      labDay: columns.labDay >= 0 ? normalizeDay(value('labDay')) : '',
      labStart: columns.labStart >= 0 ? Number(value('labStart')) || null : null,
      labLength: columns.labLength >= 0 ? Number(value('labLength')) || labPeriods || null : labPeriods || null
    };
    if (subject.code || subject.name || subject.acronym) subjects.push(subject);
  }
  const teachers = Object.fromEntries([...new Set(subjects.flatMap(s => extractTeacherNames(s.teacher)))].map(name => [name, { name, initials: name.split(/\s+/).map(part => part[0]).join('').slice(0, 3).toUpperCase(), unavailable: [], externalHours: {}, hodFor: [], ccFor: [] }]));
  const weeklyHours = subjects.reduce((total, subject) => total + subject.theoryPeriods + subject.labPeriods, 0);
  return { classes, subjects, teachers, staff: Object.values(teachers), labs: subjects.filter(s => s.labPeriods > 0).map(subject => ({ ...subject, subjectId: subject.id, day: subject.labDay || '', startPeriod: subject.labStart, length: subject.labLength || subject.labPeriods })), weeklyHours, metadata: {}, errors: [] };
}
