export const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
export const SLOT_DEFS = [
  { period: 0, label: '09.05–10.00', teaching: true }, { period: 1, label: '10.00–11.00', teaching: true },
  { period: null, label: 'BREAK', teaching: false }, { period: 2, label: '11.15–12.15', teaching: true },
  { period: 3, label: '12.15–01.00', teaching: true }, { period: null, label: 'LUNCH BREAK', teaching: false },
  { period: 4, label: '01.40–02.20', teaching: true }, { period: 5, label: '02.20–03.00', teaching: true },
  { period: null, label: 'BREAK', teaching: false }, { period: 6, label: '03.10–03.50', teaching: true },
  { period: 7, label: '03.50–04.30', teaching: true }
];
export const subjectKeyOf = subject => subject.code || subject.subjectCode || subject.acronym || subject.id || subject.subjectId;

export function createDefaultSlots() { return SLOT_DEFS.map((slot, index) => ({ ...slot, index })); }
const emptyWeek = () => Object.fromEntries(DAYS.map(day => [day, Array(8).fill(null)]));
const teacherName = subject => subject.teacher.split(/[,;]/)[0].trim();
const teacherRecord = (model, teacher) => model.teachers?.[teacher] || Object.values(model.teachers || {}).find(record => record.name === teacher || record.name?.startsWith(teacher)) || {};
const isHodFor = (record, className) => record.hodFor?.includes(className) || record.isHod === true;
const externalHours = (model, teacher, day) => Number(teacherRecord(model, teacher).externalHours?.[day] || 0);
const unavailable = (model, teacher, day, period) => (teacherRecord(model, teacher).unavailable || []).some(x => x.day === day && x.period === period);
const fixedLabDays = (model, subjectId) => new Set((model.labs || []).filter(lab => lab.subjectId === subjectId).map(lab => lab.day).filter(Boolean));

const labAllowEarlyStart = (lab, subject) => lab?.allowEarlyStart === true || subject?.allowEarlyStart === true;
const extracurricularStarts = length => {
  if (length === 1) return [2, 3, 4, 5, 6, 7];
  if (length === 2) return [2, 4, 6];
  return [];
};
const crossesBreakOrLunch = (fromPeriod, toPeriod) => toPeriod === fromPeriod + 1 && (fromPeriod === 1 || fromPeriod === 3 || fromPeriod === 5);
const labWindows = (model, lab, subject) => {
  const length = Number(lab.length || lab.labPeriods || subject.labPeriods || 2);
  const effectiveDay = lab.day || subject.labDay || '';
  const rawStart = lab.startPeriod !== null && lab.startPeriod !== undefined && lab.startPeriod !== '' ? lab.startPeriod : subject.labStart;
  const parsedStart = Number(rawStart);
  const fixedStart = rawStart !== null && rawStart !== undefined && rawStart !== '' && Number.isFinite(parsedStart) ? parsedStart - 1 : null;
  const allowEarlyStart = labAllowEarlyStart(lab, subject);
  const automaticStarts = length === 2 ? [2, 4, 6] : [...Array(8 - length + 1).keys()].filter(start => start >= 2);
  const starts = fixedStart != null ? (fixedStart < 2 && !allowEarlyStart ? [] : [fixedStart]) : automaticStarts;
  const days = effectiveDay ? [effectiveDay] : DAYS;
  return { length, effectiveDay, rawStart, fixedStart, starts, days, allowEarlyStart };
};

export function feasibilityDiagnostics(model) {
  const diagnostics = [];
  const subjectsById = new Map(model.subjects.map(subject => [subject.id, subject]));
  const requiredTotalFor = className => {
    const theory = model.subjects.filter(subject => subject.className === className).reduce((total, subject) => total + (subject.theoryPeriods || 0), 0);
    const labLengths = (model.labs || []).filter(lab => lab.className === className).reduce((total, lab) => total + Number(lab.length || lab.labPeriods || subjectsById.get(lab.subjectId)?.labPeriods || 0), 0);
    return theory + labLengths;
  };
  for (const className of model.classes) {
    const requiredTotal = requiredTotalFor(className);
    if (requiredTotal > DAYS.length * 8) {
      diagnostics.push({ rule: 'CAPACITY', severity: 'error', className, message: `${className} requests ${requiredTotal} teaching slots but only ${DAYS.length * 8} are available — the workload exceeds the week by ${requiredTotal - DAYS.length * 8} slot(s).` });
    }
    for (const subject of model.subjects.filter(item => item.className === className && item.theoryPeriods > 0 && !item.isExtracurricular)) {
      if (subject.theoryPeriods > DAYS.length * 2) {
        diagnostics.push({ rule: 'R4', severity: 'error', className, subjectId: subject.id, message: `${subject.name} needs ${subject.theoryPeriods} weekly theory periods, but a theory subject fits at most twice per day over ${DAYS.length} days (maximum ${DAYS.length * 2}).` });
      }
    }
  }
  for (const lab of model.labs || []) {
    const subject = subjectsById.get(lab.subjectId) || lab;
    if (!subject) continue;
    const { length, effectiveDay, rawStart, fixedStart, starts, allowEarlyStart } = labWindows(model, lab, subject);
    const className = subject.className;
    const teacher = teacherName(subject);
    if (length > DAYS.length * 8) {
      diagnostics.push({ rule: 'R16', severity: 'error', className, subjectId: subject.id, message: `${subject.name || lab.subjectId} lab needs ${length} consecutive periods, more than the ${8} teaching slots available in one day.` });
      continue;
    }
    if (fixedStart != null) {
      if (fixedStart < 0 || fixedStart > 7) {
        diagnostics.push({ rule: 'R16', severity: 'error', className, subjectId: subject.id, message: `${subject.name || lab.subjectId} lab Starting Period ${rawStart} is outside the allowed 1–8 range.` });
        continue;
      }
      if (fixedStart < 2 && !allowEarlyStart) {
        diagnostics.push({ rule: 'R23', severity: 'error', className, subjectId: subject.id, message: `${subject.name || lab.subjectId} lab is fixed to start at Period ${rawStart}, but R23 forbids starting a lab before Period 3 unless the admin explicitly overrides the restriction.` });
        continue;
      }
      if (fixedStart + length > 8) {
        diagnostics.push({ rule: 'R16', severity: 'error', className, subjectId: subject.id, message: `${subject.name || lab.subjectId} lab starting at Period ${rawStart} needs ${length} consecutive periods, overflowing the last teaching slot (Period 8) of the day.` });
        continue;
      }
    }
    const usable = [];
    for (const day of (effectiveDay ? [effectiveDay] : DAYS)) {
      for (const start of starts) {
        const periods = Array.from({ length }, (_, offset) => start + offset);
        if (periods.every(period => period >= 0 && period < 8 && !unavailable(model, teacher, day, period))) usable.push(`${day} P${start + 1}`);
      }
    }
    if (!usable.length) {
      diagnostics.push({ rule: 'R16', severity: 'error', className, subjectId: subject.id, message: `${subject.name || lab.subjectId} lab (${length} periods) cannot run${effectiveDay ? ` on ${effectiveDay}` : ' on any day'}${fixedStart != null ? ` at Period ${rawStart}` : ''} because ${teacher} is listed as unavailable during every eligible time window.` });
    }
  }
  for (const subject of model.subjects.filter(item => item.theoryPeriods > 0 && item.isExtracurricular)) {
    const length = subject.theoryPeriods;
    const teacher = teacherName(subject);
    if (length > 6) {
      diagnostics.push({ rule: 'R18', severity: 'error', className: subject.className, subjectId: subject.id, message: `${subject.name} needs ${length} consecutive periods, but only 6 teaching slots exist from Period 3 onward (Periods 3–8) for an extracurricular block.` });
      continue;
    }
    if (length > 2) {
      diagnostics.push({ rule: 'R18', severity: 'error', className: subject.className, subjectId: subject.id, message: `${subject.name} needs ${length} consecutive periods starting at or after Period 3, but an extracurricular block cannot cross a Break or Lunch period and the longest uninterrupted teaching segment holds only 2 consecutive periods.` });
      continue;
    }
    const anyWindow = DAYS.some(day => extracurricularStarts(length).some(start => {
      const periods = Array.from({ length }, (_, offset) => start + offset);
      return periods.every(period => period < 8 && !unavailable(model, teacher, day, period));
    }));
    if (!anyWindow) {
      diagnostics.push({ rule: 'R18', severity: 'error', className: subject.className, subjectId: subject.id, message: `${subject.name} (${length} continuous periods starting at or after Period 3) cannot be placed because ${teacher} is unavailable during every eligible window on every day.` });
    }
  }
  return diagnostics;
}

export function checkSchedule(schedule, model) {
  const diagnostics = [];
  for (const day of DAYS) {
    const cells = schedule[day] || [];
    const seen = new Map();
    for (const cell of cells.filter(Boolean)) {
      const record = teacherRecord(model, cell.teacher);
      if (cell.period === 0 && (isHodFor(record, schedule.className) || record.ccFor?.includes(schedule.className))) diagnostics.push({ rule: isHodFor(record, schedule.className) ? 'R1' : 'R11', severity: 'error', day, period: 1, message: `${cell.teacher} cannot teach Period 1 for this class.` });
      if (unavailable(model, cell.teacher, day, cell.period)) diagnostics.push({ rule: 'R17', severity: 'error', day, period: cell.period + 1, message: `${cell.teacher} is unavailable.` });
      if (cell.kind === 'activity' && cell.period < 2) diagnostics.push({ rule: 'R19', severity: 'error', day, period: cell.period + 1, subjectId: cell.subjectId, message: 'Extracurricular subjects cannot be scheduled in Period 1 or Period 2.' });
      if (cell.kind === 'activity' && cells[cell.period - 1]?.kind === 'activity' && cells[cell.period - 1]?.subjectId === cell.subjectId && crossesBreakOrLunch(cell.period - 1, cell.period)) diagnostics.push({ rule: 'R18', severity: 'error', day, period: cell.period + 1, subjectId: cell.subjectId, message: 'An extracurricular block cannot cross a Break or Lunch period.' });
      if (cell.kind === 'lab' && cell.period < 2 && !labAllowEarlyStart((model.labs || []).find(item => item.subjectId === cell.subjectId), model.subjects.find(item => item.id === cell.subjectId))) diagnostics.push({ rule: 'R23', severity: 'error', day, period: cell.period + 1, subjectId: cell.subjectId, message: 'A lab cannot be scheduled in Period 1 or Period 2 unless the admin explicitly overrides the restriction.' });
      if (cell.kind === 'theory') seen.set(cell.subjectId, (seen.get(cell.subjectId) || 0) + 1);
    }
    for (const [subjectId, count] of seen) {
      const subject = model.subjects.find(item => item.id === subjectId);
      const labDay = fixedLabDays(model, subjectId).has(day);
      const fallback = subject && subject.theoryPeriods > DAYS.length;
      if (count > 1 && !fallback && !labDay) diagnostics.push({ rule: 'R2', severity: 'error', day, subjectId, message: 'Theory subject appears more than once on this day.' });
      if (count > 1 && fallback) diagnostics.push({ rule: 'R2a', severity: 'warning', day, subjectId, message: 'Subject repeats under the weekly-shortfall fallback.' });
      if (count > 1 && labDay) diagnostics.push({ rule: 'R12', severity: 'warning', day, subjectId, message: 'One same-day theory repeat is permitted because the subject has an externally fixed lab.' });
    }
    for (let i = 1; i < cells.length; i++) if (cells[i]?.kind === 'theory' && cells[i - 1]?.kind === 'theory' && cells[i].subjectId === cells[i - 1].subjectId) diagnostics.push({ rule: 'R3', severity: 'error', day, period: cells[i].period + 1, message: 'Same theory subject is scheduled in adjacent periods.' });
  }
  const firstPeriodSubjects = DAYS.map(day => schedule[day]?.[0]?.subjectId).filter(Boolean);
  const repeatedFirstPeriod = firstPeriodSubjects.find((subjectId, index) => firstPeriodSubjects.indexOf(subjectId) !== index);
  if (repeatedFirstPeriod) diagnostics.push({ rule: 'R20', severity: 'error', subjectId: repeatedFirstPeriod, message: 'The same subject cannot occupy Period 1 on more than one day.' });
  return diagnostics;
}

function generateTimetableAttempt(model, options = {}) {
  const lockedSchedules = options.lockedSchedules || {};
  const schedules = Object.fromEntries(model.classes.map(className => {
    const source = lockedSchedules[className];
    if (source) return [className, { ...source, className, ...Object.fromEntries(DAYS.map(day => [day, [...(source[day] || [])]])) }];
    const week = emptyWeek(); week.className = className; return [className, week];
  }));
  const diagnostics = [];
  const teacherBusy = new Map();
  const teacherDailyHours = new Map();
  const teacherSlots = new Map();
  const subjectSlots = new Map();
  const extraSubjectsByDay = new Map(model.classes.map(className => [className, new Map(DAYS.map(day => [day, new Set()]))]));
  const subjectsById = new Map(model.subjects.map(subject => [subject.id, subject]));
  const placedCounts = new Map();
  const seedText = String(model.settings?.scheduleSeed ?? model.subjects.map(subject => subject.id).join('|'));
  let seed = [...seedText].reduce((value, char) => Math.imul(value ^ char.charCodeAt(0), 16777619), 2166136261) >>> 0;
  const random = () => { seed += 0x6D2B79F5; let value = seed; value = Math.imul(value ^ value >>> 15, value | 1); value ^= value + Math.imul(value ^ value >>> 7, value | 61); return ((value ^ value >>> 14) >>> 0) / 4294967296; };
  const shuffle = values => { const copy = [...values]; for (let index = copy.length - 1; index > 0; index--) { const target = Math.floor(random() * (index + 1)); [copy[index], copy[target]] = [copy[target], copy[index]]; } return copy; };
  const theoryCount = subjectId => placedCounts.get(subjectId) || 0;
  const recordSlot = (map, key, day, period, className) => {
    if (!map.has(key)) map.set(key, new Map());
    const table = map.get(key);
    const slotKey = `${day}-${period}`;
    if (!table.has(slotKey)) table.set(slotKey, new Set());
    table.get(slotKey).add(className);
  };
  for (const [className, schedule] of Object.entries(lockedSchedules)) {
    for (const day of DAYS) for (const cell of schedule[day] || []) if (cell) {
      const key = `${day}-${cell.period}`;
      if (!teacherBusy.has(key)) teacherBusy.set(key, new Set());
      teacherBusy.get(key).add(cell.teacher);
      recordSlot(teacherSlots, cell.teacher, day, cell.period, className);
      recordSlot(subjectSlots, subjectKeyOf(cell), day, cell.period, className);
      if (cell.kind === 'theory') {
        placedCounts.set(cell.subjectId, (placedCounts.get(cell.subjectId) || 0) + 1);
        const teacherKey = `${cell.teacher}-${day}`;
        teacherDailyHours.set(teacherKey, (teacherDailyHours.get(teacherKey) || 0) + 1);
      }
    }
  }
  const teacherCrossClassConflict = (teacher, day, period, className) => {
    const table = teacherSlots.get(teacher);
    if (!table) return false;
    const owners = table.get(`${day}-${period}`);
    if (owners && [...owners].some(other => other !== className)) return true;
    return false;
  };
  const subjectPatternConflict = (subjectId, day, period, className) => {
    const table = subjectSlots.get(subjectId);
    if (!table) return false;
    const owners = table.get(`${day}-${period}`);
    if (owners && [...owners].some(other => other !== className)) return true;
    return false;
  };
  const isCombinedSession = (subject, day, period) => {
    const teacher = teacherName(subject);
    const key = subjectKeyOf(subject);
    const dayIndex = DAYS.indexOf(day);
    const probeDays = [DAYS[dayIndex - 1], day, DAYS[dayIndex + 1]].filter(Boolean);
    for (const probeDay of probeDays) {
      for (const adjacent of [period - 1, period, period + 1]) {
        const subjectOwners = subjectSlots.get(key)?.get(`${probeDay}-${adjacent}`);
        if (!subjectOwners) continue;
        const teacherOwners = teacherSlots.get(teacher)?.get(`${probeDay}-${adjacent}`);
        if (!teacherOwners) continue;
        for (const otherClass of subjectOwners) {
          if (otherClass !== subject.className && teacherOwners.has(otherClass)) return true;
        }
      }
    }
    return false;
  };
  const put = (subject, day, period, kind = 'theory') => {
    const schedule = schedules[subject.className];
    if (!schedule || schedule[day][period]) return false;
    const teacher = teacherName(subject);
    const subjectKey = subjectKeyOf(subject);
    const busyKey = `${day}-${period}`;
    if (unavailable(model, teacher, day, period)) return false;
    if (teacherBusy.get(busyKey)?.has(teacher) && !isCombinedSession(subject, day, period)) return false;
    const record = teacherRecord(model, teacher);
    if (period === 0 && (isHodFor(record, subject.className) || record.ccFor?.includes(subject.className))) return false;
    if (kind === 'activity' && period < 2) return false;
    if (!isCombinedSession(subject, day, period)) {
      if (teacherCrossClassConflict(teacher, day, period, subject.className)) return false;
      if (kind !== 'lab' && subjectPatternConflict(subjectKey, day, period, subject.className)) return false;
    }
    const dayCells = schedule[day];
    if (kind === 'theory') {
      const sameDay = dayCells.filter(cell => cell?.subjectId === subject.id && cell.kind === 'theory').length;
      const dailyCap = fixedLabDays(model, subject.id).has(day) ? 1 : (subject.theoryPeriods > DAYS.length ? 2 : 1);
      if (sameDay >= dailyCap) return false;
      if (dayCells[period - 1]?.subjectId === subject.id || dayCells[period + 1]?.subjectId === subject.id) return false;
      if (period === 0 && DAYS.some(otherDay => otherDay !== day && schedule[otherDay][0]?.subjectId === subject.id)) return false;
      const teacherHoursKey = `${teacher}-${day}`;
      const teacherHours = teacherDailyHours.get(teacherHoursKey) || 0;
      if (teacherHours + externalHours(model, teacher, day) >= 5) return false;
      teacherDailyHours.set(teacherHoursKey, teacherHours + 1);
      placedCounts.set(subject.id, theoryCount(subject.id) + 1);
    }
    dayCells[period] = { subjectId: subject.id, subjectCode: subject.code, acronym: subject.acronym, subjectName: subject.name, teacher, period, kind, lab: kind === 'lab' };
    if (!teacherBusy.has(busyKey)) teacherBusy.set(busyKey, new Set());
    teacherBusy.get(busyKey).add(teacher);
    recordSlot(teacherSlots, teacher, day, period, subject.className);
    recordSlot(subjectSlots, subjectKey, day, period, subject.className);
    return true;
  };
  const canPlaceAt = (subject, day, period, kind = 'theory') => {
    const schedule = schedules[subject.className];
    if (!schedule || schedule[day][period]) return false;
    const teacher = teacherName(subject);
    const subjectKey = subjectKeyOf(subject);
    const busyKey = `${day}-${period}`;
    if (unavailable(model, teacher, day, period)) return false;
    if (teacherBusy.get(busyKey)?.has(teacher) && !isCombinedSession(subject, day, period)) return false;
    const record = teacherRecord(model, teacher);
    if (period === 0 && (isHodFor(record, subject.className) || record.ccFor?.includes(subject.className))) return false;
    if (kind === 'activity' && period < 2) return false;
    if (!isCombinedSession(subject, day, period)) {
      if (teacherCrossClassConflict(teacher, day, period, subject.className)) return false;
      if (kind !== 'lab' && subjectPatternConflict(subjectKey, day, period, subject.className)) return false;
    }
    const dayCells = schedule[day];
    if (kind === 'theory') {
      const sameDay = dayCells.filter(cell => cell?.subjectId === subject.id && cell.kind === 'theory').length;
      const dailyCap = fixedLabDays(model, subject.id).has(day) ? 1 : (subject.theoryPeriods > DAYS.length ? 2 : 1);
      if (sameDay >= dailyCap) return false;
      if (dayCells[period - 1]?.subjectId === subject.id || dayCells[period + 1]?.subjectId === subject.id) return false;
      if (period === 0 && DAYS.some(otherDay => otherDay !== day && schedule[otherDay][0]?.subjectId === subject.id)) return false;
      const teacherHoursKey = `${teacher}-${day}`;
      const teacherHours = teacherDailyHours.get(teacherHoursKey) || 0;
      if (teacherHours + externalHours(model, teacher, day) >= 5) return false;
    }
    return true;
  };
  const placementBlocker = (subject, day, period, kind = 'theory') => {
    const schedule = schedules[subject.className];
    const teacher = teacherName(subject);
    const busyKey = `${day}-${period}`;
    if (!schedule) return `${subject.className} has no schedule`;
    if (schedule[day][period]) return `${day} P${period + 1} is already occupied`;
    if (teacherBusy.get(busyKey)?.has(teacher) && !isCombinedSession(subject, day, period)) return `${teacher} is already engaged at ${day} P${period + 1}`;
    if (unavailable(model, teacher, day, period)) return `${teacher} is unavailable at ${day} P${period + 1}`;
    const record = teacherRecord(model, teacher);
    if (period === 0 && (isHodFor(record, subject.className) || record.ccFor?.includes(subject.className))) return `Period 1 is barred for the HOD/CC teacher ${teacher}`;
    if (kind === 'activity' && period < 2) return `Periods 1–2 are barred for extracurricular activities`;
    if (!isCombinedSession(subject, day, period)) {
      if (teacherCrossClassConflict(teacher, day, period, subject.className)) return `${teacher} reaches ${day} P${period + 1} contiguously across another class`;
      if (kind !== 'lab' && subjectPatternConflict(subjectKeyOf(subject), day, period, subject.className)) return `${subjectKeyOf(subject)} collides with the same subject pattern in another class at ${day} P${period + 1}`;
    }
    if (kind === 'theory') {
      const dayCells = schedule[day];
      const sameDay = dayCells.filter(cell => cell?.subjectId === subject.id && cell.kind === 'theory').length;
      const dailyCap = fixedLabDays(model, subject.id).has(day) ? 1 : (subject.theoryPeriods > DAYS.length ? 2 : 1);
      if (sameDay >= dailyCap) return `${subject.name} already reaches its ${dailyCap}-per-day cap on ${day}`;
      if (dayCells[period - 1]?.subjectId === subject.id || dayCells[period + 1]?.subjectId === subject.id) return `adjacent ${subject.name} hours on ${day}`;
      if (period === 0 && DAYS.some(otherDay => otherDay !== day && schedule[otherDay][0]?.subjectId === subject.id)) return `Period 1 is already occupied by ${subject.subjectCode} on another day`;
      const teacherHoursKey = `${teacher}-${day}`;
      const teacherHours = teacherDailyHours.get(teacherHoursKey) || 0;
      if (teacherHours + externalHours(model, teacher, day) >= 5) return `${teacher} already teaches the full 5-period daily load on ${day}`;
    }
    return 'a placement rule was violated';
  };
  const unplaceCell = (day, period, className) => {
    const schedule = schedules[className];
    const cell = schedule[day][period];
    if (!cell) return;
    schedule[day][period] = null;
    const busyKey = `${day}-${period}`;
    teacherBusy.get(busyKey)?.delete(cell.teacher);
    const tTable = teacherSlots.get(cell.teacher);
    if (tTable?.get(busyKey)?.size === 0) tTable.delete(busyKey);
    else tTable?.get(busyKey)?.delete(className);
    const sTable = subjectSlots.get(subjectKeyOf(cell));
    if (sTable?.get(busyKey)?.size === 0) sTable.delete(busyKey);
    else sTable?.get(busyKey)?.delete(className);
    if (cell.kind === 'theory') {
      const teacherKey = `${cell.teacher}-${day}`;
      const hours = teacherDailyHours.get(teacherKey) || 0;
      teacherDailyHours.set(teacherKey, Math.max(0, hours - 1));
      placedCounts.set(cell.subjectId, Math.max(0, (placedCounts.get(cell.subjectId) || 0) - 1));
    }
  };
  const putBlock = (subject, day, periods, kind) => {
    const placedPeriods = [];
    for (const period of periods) {
      if (!put(subject, day, period, kind)) {
        placedPeriods.forEach(placedPeriod => unplaceCell(day, placedPeriod, subject.className));
        return false;
      }
      placedPeriods.push(period);
    }
    return true;
  };

  for (const lab of shuffle(model.labs || [])) {
    const subject = subjectsById.get(lab.subjectId) || lab;
    if (lockedSchedules[subject.className]) continue;
    const teacher = teacherName(subject);
    const { length, effectiveDay, rawStart, fixedStart, starts, days } = labWindows(model, lab, subject);
    let placed = false;
    const failures = [];
    for (const day of days) {
      for (const start of starts) {
        const periods = Array.from({ length }, (_, offset) => start + offset);
        if (periods.every(period => period < 8 && !schedules[subject.className]?.[day][period] && !unavailable(model, teacher, day, period) && !teacherBusy.get(`${day}-${period}`)?.has(teacher) && !teacherCrossClassConflict(teacher, day, period, subject.className))) {
          if (putBlock(subject, day, periods, 'lab')) { placed = true; break; }
          failures.push(`${day} P${start + 1} hits a Period-1 HOD/CC restriction`);
        } else {
          for (const period of periods) {
            if (period >= 8) { failures.push(`${day} P${period + 1} lies outside the 8 teaching slots`); break; }
            if (unavailable(model, teacher, day, period)) { failures.push(`${teacher} is unavailable at ${day} P${period + 1}`); break; }
            if (schedules[subject.className]?.[day][period]) { failures.push(`${day} P${period + 1} is already occupied`); break; }
            if (teacherBusy.get(`${day}-${period}`)?.has(teacher) || teacherCrossClassConflict(teacher, day, period, subject.className)) { failures.push(`${teacher} is already engaged across another class at ${day} P${period + 1}`); break; }
          }
        }
      }
      if (placed) break;
    }
    if (!placed) {
      const unique = [...new Set(failures)];
      const scope = effectiveDay ? `on ${effectiveDay}` : 'on any day';
      const at = fixedStart != null ? ` at Period ${rawStart}` : ' at an automatic start';
      const reason = unique.length ? ` Blocked because: ${unique.slice(0, 3).join('; ')}.` : ` No consecutive ${length}-period window was free for ${teacher}.`;
      diagnostics.push({ rule: 'R16', severity: 'error', className: subject.className, message: `${subject.name || lab.subjectId} lab (${length} periods) could not be placed as a continuous block${scope}${at}.${reason}`, subjectId: lab.subjectId });
    }
  }

  const extracurricular = shuffle(model.subjects.filter(subject => subject.theoryPeriods > 0 && subject.isExtracurricular));
  for (const subject of extracurricular) {
    if (lockedSchedules[subject.className]) continue;
    const length = subject.theoryPeriods;
    const teacher = teacherName(subject);
    const failures = new Set();
    let placed = 0;
    const dayCount = day => extraSubjectsByDay.get(subject.className).get(day).size;
    const days = shuffle(DAYS).sort((left, right) => dayCount(left) - dayCount(right));
    for (const day of days) {
      if (dayCount(day) >= 2) { failures.add(`${day} already holds two activities`); continue; }
      for (const start of shuffle(extracurricularStarts(length))) {
        const periods = Array.from({ length }, (_, offset) => start + offset);
        if (!periods.every(period => period < 8 && canPlaceAt(subject, day, period, 'activity'))) {
          for (const period of periods) {
            if (period >= 8) { failures.add(`${day} P${period + 1} lies outside the 8 teaching slots`); break; }
            if (period < 2) { failures.add(`${day} P${period + 1} lies before Period 3`); break; }
            if (crossesBreakOrLunch(period - 1, period)) { failures.add(`${day} P${period + 1} crosses a Break or Lunch period`); break; }
            if (unavailable(model, teacher, day, period)) { failures.add(`${teacher} is unavailable at ${day} P${period + 1}`); break; }
            if (teacherBusy.get(`${day}-${period}`)?.has(teacher) || teacherCrossClassConflict(teacher, day, period, subject.className)) { failures.add(`${teacher} is already engaged across another class at ${day} P${period + 1}`); break; }
            if (!schedules[subject.className]?.[day][period]) { failures.add(`${day} P${period + 1} is not free`); break; }
            failures.add(`${placementBlocker(subject, day, period, 'activity')}`);
            break;
          }
          continue;
        }
        if (putBlock(subject, day, periods, 'activity')) {
          extraSubjectsByDay.get(subject.className).get(day).add(subject.id);
          placed = length;
          break;
        }
        failures.add(`${day} P${start + 1} hits an extracurricular restriction`);
      }
      if (placed) break;
    }
    if (placed < length) {
      const summary = [...failures].slice(0, 3).join('; ');
      diagnostics.push({
        rule: 'R18', severity: 'error', className: subject.className, subjectId: subject.id,
        message: `${subject.name} could not be placed for its entire ${length}-period extracurricular block (it must start at or after Period 3 and stay continuous without crossing a Break or Lunch period). ${summary ? `Blocked because: ${summary}.` : `No valid slot remained free.`}`,
      });
    }
  }

  const theory = model.subjects.filter(subject => subject.theoryPeriods > 0 && !subject.isExtracurricular);
  for (const className of shuffle(model.classes)) {
    if (lockedSchedules[className]) continue;
    const schedule = schedules[className];
    const candidates = shuffle(theory.filter(subject => subject.className === className));
    const used = new Set(DAYS.map(day => schedule[day][0]?.subjectId).filter(Boolean));
    for (const day of shuffle(DAYS.filter(day => !schedule[day][0]))) {
      const subject = candidates.find(candidate => !used.has(candidate.id) && put(candidate, day, 0));
      if (subject) used.add(subject.id);
      else diagnostics.push({ rule: 'R9', severity: 'warning', className, day, period: 1, message: 'A unique eligible Period-1 subject could not be assigned.' });
    }
  }

  const orderedTheory = shuffle(theory).sort((left, right) => right.theoryPeriods - left.theoryPeriods || random() - 0.5);
  for (const subject of orderedTheory) {
    if (lockedSchedules[subject.className]) continue;
    let attempts = 0;
    while (theoryCount(subject.id) < subject.theoryPeriods && attempts++ < 12) {
      const slots = shuffle(DAYS.flatMap(day => Array.from({ length: 8 }, (_, period) => [day, period])));
      const slot = slots.find(([day, period]) => put(subject, day, period));
      if (!slot) break;
    }
    if (theoryCount(subject.id) < subject.theoryPeriods) diagnostics.push({ rule: 'R4', severity: 'error', className: subject.className, subjectId: subject.id, message: `${subject.name} has ${subject.theoryPeriods - theoryCount(subject.id)} unresolved weekly period(s).` });
  }

  for (const className of shuffle(model.classes)) {
    if (lockedSchedules[className]) continue;
    const schedule = schedules[className];
    const candidates = theory.filter(subject => subject.className === className);
    let progress = true;
    while (progress) {
      progress = false;
      const deficits = shuffle(candidates.filter(subject => theoryCount(subject.id) < subject.theoryPeriods));
      for (const subject of deficits) {
        const slots = shuffle(DAYS.flatMap(day => Array.from({ length: 8 }, (_, period) => [day, period])).filter(([day, period]) => !schedule[day][period]));
        if (slots.some(([day, period]) => put(subject, day, period))) progress = true;
      }
    }
  }
  for (const className of model.classes) {
    if (lockedSchedules[className]) continue;
    const schedule = schedules[className];
    const candidates = theory.filter(subject => subject.className === className);
    for (let round = 0; round < DAYS.length * 8; round++) {
      const deficit = candidates.find(subject => theoryCount(subject.id) < subject.theoryPeriods);
      if (!deficit) break;
      const empty = DAYS.flatMap(day => Array.from({ length: 8 }, (_, period) => ({ day, period })))
        .find(({ day, period }) => !schedule[day][period]);
      if (!empty) break;
      if (put(deficit, empty.day, empty.period)) continue;
      let repaired = false;
      for (const donorCell of DAYS.flatMap(day => schedule[day].map((cell, period) => ({ cell, day, period })))) {
        if (!donorCell.cell || donorCell.cell.kind === 'lab' || donorCell.cell.kind === 'activity' || donorCell.cell.subjectId === deficit.id) continue;
        const donor = subjectsById.get(donorCell.cell.subjectId);
        if (!donor) continue;
        const original = { day: donorCell.day, period: donorCell.period };
        unplaceCell(original.day, original.period, className);
        for (const destination of DAYS.flatMap(day => Array.from({ length: 8 }, (_, period) => ({ day, period })))) {
          if (schedule[destination.day][destination.period]) continue;
          if (!canPlaceAt(donor, destination.day, destination.period) || !put(donor, destination.day, destination.period)) continue;
          if (canPlaceAt(deficit, original.day, original.period) && put(deficit, original.day, original.period)) {
            repaired = true;
            break;
          }
          unplaceCell(destination.day, destination.period, className);
        }
        if (repaired) break;
        if (canPlaceAt(donor, original.day, original.period)) put(donor, original.day, original.period);
      }
      if (!repaired) break;
    }
  }
  diagnostics.splice(0, diagnostics.length, ...diagnostics.filter(entry => entry.rule !== 'R4'));
  for (const subject of theory) {
    if (theoryCount(subject.id) < subject.theoryPeriods) {
      const missing = subject.theoryPeriods - theoryCount(subject.id);
      const schedule = schedules[subject.className];
      const tallies = new Map();
      if (schedule) {
        for (const day of DAYS) {
          for (let period = 0; period < 8; period++) {
            if (schedule[day][period]) continue;
            const reason = placementBlocker(subject, day, period, 'theory');
            tallies.set(reason, (tallies.get(reason) || 0) + 1);
          }
        }
      }
      const top = [...tallies.entries()].sort((left, right) => right[1] - left[1]).slice(0, 3)
        .map(([reason, count]) => `${reason} (${count} slot${count === 1 ? '' : 's'})`)
        .join('; ');
      diagnostics.push({ rule: 'R4', severity: 'error', className: subject.className, subjectId: subject.id, message: `${subject.name} has ${missing} unresolved weekly period(s). ${top ? `Every free slot was blocked: ${top}.` : 'No free slot remained in the week.'}` });
    }
  }

  for (const schedule of Object.values(schedules)) {
    diagnostics.push(...checkSchedule(schedule, model));
    const filled = DAYS.reduce((total, day) => total + schedule[day].filter(Boolean).length, 0);
    const unallocated = DAYS.length * 8 - filled;
    const classSubjects = model.subjects.filter(subject => subject.className === schedule.className && subject.theoryPeriods > 0);
    const requiredTheory = classSubjects.reduce((total, subject) => total + subject.theoryPeriods, 0);
    const requiredLabs = (model.labs || []).filter(lab => lab.className === schedule.className)
      .reduce((total, lab) => total + Number(lab.length || lab.labPeriods || 0), 0);
    const requiredTotal = requiredTheory + requiredLabs;
    if (requiredTotal > DAYS.length * 8) diagnostics.push({ rule: 'CAPACITY', severity: 'error', className: schedule.className, message: `${schedule.className} requests ${requiredTotal} teaching slots but only ${DAYS.length * 8} are available.` });
    else if (requiredTotal === DAYS.length * 8 && unallocated > 0) diagnostics.push({ rule: 'CAPACITY', severity: 'error', className: schedule.className, message: `${unallocated} mandatory teaching slot(s) remain empty for ${schedule.className}; exact workload cannot be placed while satisfying all hard constraints.` });
  }
  diagnostics.push(...checkCrossClass(schedules, model));
  return { schedules, diagnostics };
}

export function generateTimetable(model) {
  const blockers = feasibilityDiagnostics(model);
  if (blockers.length) {
    const schedules = Object.fromEntries(model.classes.map(className => { const week = emptyWeek(); week.className = className; return [className, week]; }));
    return { schedules, diagnostics: blockers };
  }
  const baseSeed = String(model.settings?.scheduleSeed ?? model.subjects.map(subject => subject.id).join('|'));
  let best = null;
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = generateTimetableAttempt({
      ...model,
      settings: { ...(model.settings || {}), scheduleSeed: attempt === 0 ? baseSeed : `${baseSeed}:${attempt}` },
    });
    const errors = result.diagnostics.filter(item => item.severity === 'error').length;
    const filled = Object.values(result.schedules).reduce((total, schedule) => total + DAYS.reduce((count, day) => count + schedule[day].filter(Boolean).length, 0), 0);
    const score = { errors, filled };
    if (!best || score.errors < best.score.errors || (score.errors === best.score.errors && score.filled > best.score.filled)) best = { ...result, score };
    if (errors === 0) break;
  }
  const { score, ...result } = best;
  return result;
}

export function regenerateClassTimetable(model, previousResult, className) {
  const lockedSchedules = Object.fromEntries(
    Object.entries(previousResult?.schedules || {}).filter(([name]) => name !== className),
  );
  const classBlockers = feasibilityDiagnostics(model).filter(item => item.className === className);
  if (classBlockers.length) {
    const week = emptyWeek();
    week.className = className;
    return { schedules: { ...(previousResult?.schedules || {}), [className]: week }, diagnostics: classBlockers };
  }
  const baseSeed = String(model.settings?.scheduleSeed ?? Date.now());
  let best = null;
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = generateTimetableAttempt({
      ...model,
      settings: { ...(model.settings || {}), scheduleSeed: `${baseSeed}:selected:${className}:${attempt}` },
    }, { lockedSchedules });
    const selectedErrors = result.diagnostics.filter(item => item.severity === 'error' && (item.className === className || !item.className)).length;
    const score = { errors: selectedErrors, filled: DAYS.reduce((total, day) => total + result.schedules[className][day].filter(Boolean).length, 0) };
    if (!best || score.errors < best.score.errors || (score.errors === best.score.errors && score.filled > best.score.filled)) best = { ...result, score };
    if (selectedErrors === 0) break;
  }
  const { score, ...result } = best;
  return result;
}

export function checkCrossClass(schedules, model) {
  const diagnostics = [];
  const teacherOwners = new Map();
  const subjectOwners = new Map();
  const slotSubject = new Map();
  const record = (map, key, slotKey, className) => {
    if (!map.has(key)) map.set(key, new Map());
    const table = map.get(key);
    if (!table.has(slotKey)) table.set(slotKey, new Set());
    table.get(slotKey).add(className);
  };
  const isCombinedSlot = (slotKey, expectedOwners) => {
    const entry = slotSubject.get(slotKey);
    if (!entry || entry.key == null) return false;
    return entry.owners.size === expectedOwners.size && [...expectedOwners].every(cls => entry.owners.has(cls));
  };
  for (const className of Object.keys(schedules)) {
    const schedule = schedules[className];
    for (const day of DAYS) {
      (schedule[day] || []).forEach((cell, period) => {
        if (!cell) return;
        const slotKey = `${day}-${period}`;
        if (cell.teacher) record(teacherOwners, cell.teacher, slotKey, className);
        if (cell.kind !== 'lab' && subjectKeyOf(cell)) {
          const key = subjectKeyOf(cell);
          record(subjectOwners, key, slotKey, className);
          if (!slotSubject.has(slotKey)) slotSubject.set(slotKey, { key, owners: new Set() });
          const entry = slotSubject.get(slotKey);
          if (entry.key !== key) entry.key = null;
          entry.owners.add(className);
        }
      });
    }
  }
  for (const [teacher, table] of teacherOwners) {
    for (const [slotKey, owners] of table) {
      const separator = slotKey.indexOf('-');
      const day = slotKey.slice(0, separator);
      const period = Number(slotKey.slice(separator + 1));
      if (owners.size > 1 && !isCombinedSlot(slotKey, owners)) diagnostics.push({ rule: 'R5', severity: 'error', teacher, day, period: period + 1, message: `${teacher} is assigned to multiple classes at ${day} period ${period + 1}.` });
      const nextSlot = `${day}-${period + 1}`;
      const next = table.get(nextSlot);
      const combinedBlock = next && isCombinedSlot(slotKey, owners) && isCombinedSlot(nextSlot, next) && slotSubject.get(slotKey)?.key === slotSubject.get(nextSlot)?.key;
      if (next && !combinedBlock && [...owners].some(a => [...next].some(b => b !== a))) diagnostics.push({ rule: 'R10', severity: 'warning', teacher, day, period: period + 1, message: `${teacher} has continuous periods ${period + 1} and ${period + 2} on ${day} across different classes.` });
    }
  }
  const parseSlot = slotKey => {
    const separator = slotKey.indexOf('-');
    return [slotKey.slice(0, separator), Number(slotKey.slice(separator + 1))];
  };
  for (const [subjectId, table] of subjectOwners) {
    const keys = [...table.keys()];
    for (let index = 0; index < keys.length; index++) {
      for (let other = index + 1; other < keys.length; other++) {
        const [firstDay, firstPeriod] = parseSlot(keys[index]);
        const [secondDay, secondPeriod] = parseSlot(keys[other]);
        const owners = table.get(keys[index]);
        const otherOwners = table.get(keys[other]);
        if (![...owners].some(a => [...otherOwners].some(b => b !== a))) continue;
        const sameCombined = owners.size === otherOwners.size && [...owners].every(a => otherOwners.has(a));
        const sameColumn = firstPeriod === secondPeriod && Math.abs(DAYS.indexOf(firstDay) - DAYS.indexOf(secondDay)) <= 1;
        const sameRow = firstDay === secondDay && Math.abs(firstPeriod - secondPeriod) <= 1;
        if (!sameCombined && (sameColumn || sameRow)) diagnostics.push({ rule: 'R21', severity: 'warning', subjectId, message: `${subjectId} forms a continuous ${firstDay} P${firstPeriod + 1} / ${secondDay} P${secondPeriod + 1} pattern across different classes.` });
      }
    }
  }
  return diagnostics;
}
