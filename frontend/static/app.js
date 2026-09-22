const META_FIELDS = [
  ["institution_name", "m_institution"],
  ["document_id", "m_document"],
  ["programme", "m_programme"],
  ["year_sem", "m_yearsem"],
  ["regulation", "m_regulation"],
  ["odd_even", "m_odd"],
  ["academic_year", "m_academic"],
  ["wef", "m_wef"],
  ["class_advisor", "m_advisor"],
  ["class_name", "m_class"],
];

const SUBJECT_COLS = [
  ["code", "Subject Code"],
  ["name", "Subject Name"],
  ["teacher", "Teacher Name"],
  ["acronym", "Short Name"],
];

const KIND_META = {
  theory_lab: { label: "Theory + Lab", hours: (load) => { const [t, l] = String(load || "4+3").split("+").map(Number); return (t || 4) + (l || 3); } },
  theory: { label: "Theory", hours: (load) => Number(load) || 4 },
  extra: { label: "Extra-curricular", hours: (load) => Number(load) || 0 },
};

const WEEKLY_SLOTS = 48;

function loadOptions(kind) {
  if (kind === "theory_lab") {
    return [
      ["4+2", "4 Theory + 2 Lab"],
      ["4+3", "4 Theory + 3 Lab"],
      ["5+2", "5 Theory + 2 Lab"],
    ];
  }
  if (kind === "theory") {
    return Array.from({ length: 7 }, (_, i) => {
      const n = i + 1;
      return [String(n), n === 1 ? "1 hour / week" : `${n} hours / week`];
    });
  }
  return Array.from({ length: 8 }, (_, i) => {
    const n = i + 1;
    return [String(n), n === 1 ? "1 period / week" : `${n} periods / week`];
  });
}

function parseLoad(kind, load) {
  if (kind === "theory_lab") {
    const [theory, lab] = String(load || "4+3").split("+").map(Number);
    return { weekly_periods: theory || 4, lab_periods: lab || 3, workload: `${theory || 4}+${lab || 3}` };
  }
  if (kind === "theory") {
    const n = Number(load) || 4;
    return { weekly_periods: n, lab_periods: 0, workload: String(n) };
  }
  const n = Number(load) || 1;
  return { weekly_periods: n, lab_periods: 0, workload: String(n) };
}

function rowHours(tr) {
  const kind = tr.dataset.kind;
  const load = tr.querySelector("select").value;
  const parsed = parseLoad(kind, load);
  return parsed.weekly_periods + parsed.lab_periods;
}

function updateHours() {
  const total = [...document.querySelectorAll("#subject-rows tr")].reduce((sum, tr) => sum + rowHours(tr), 0);
  const hint = document.getElementById("hours-hint");
  hint.textContent = `Weekly hours: ${total} / ${WEEKLY_SLOTS} (6 days × 8 periods)`;
  hint.classList.toggle("ok", total === WEEKLY_SLOTS);
  hint.classList.toggle("bad", total !== WEEKLY_SLOTS);
  return total;
}

function collectForm() {
  const metadata = {};
  for (const [key, id] of META_FIELDS) metadata[key] = document.getElementById(id).value.trim();
  const rows = [...document.querySelectorAll("#subject-rows tr")].map((tr) => {
    const cells = tr.querySelectorAll("input, select");
    const obj = { kind: tr.dataset.kind };
    SUBJECT_COLS.forEach(([key], i) => (obj[key] = cells[i].value.trim()));
    Object.assign(obj, parseLoad(tr.dataset.kind, cells[SUBJECT_COLS.length].value));
    obj.placement_mode = tr.dataset.kind === "extra" ? cells[SUBJECT_COLS.length + 1].value : "separate";
    obj.has_lab = obj.lab_periods > 0;
    return obj;
  }).filter((s) => s.code || s.name || s.acronym);
  return { metadata, subjects: rows };
}

function addRow(kind) {
  const tr = document.createElement("tr");
  tr.dataset.kind = kind;

  const typeTd = document.createElement("td");
  const type = document.createElement("span");
  type.className = "kind-label";
  type.textContent = KIND_META[kind].label;
  typeTd.appendChild(type);
  tr.appendChild(typeTd);

  SUBJECT_COLS.forEach(([, label]) => {
    const td = document.createElement("td");
    const input = document.createElement("input");
    input.placeholder = label;
    input.addEventListener("input", updateHours);
    td.appendChild(input);
    tr.appendChild(td);
  });

  const td = document.createElement("td");
  const select = document.createElement("select");
  for (const [value, label] of loadOptions(kind)) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    select.appendChild(opt);
  }
  select.disabled = false;
  select.onchange = updateHours;
  td.appendChild(select);
  tr.appendChild(td);

  const placementTd = document.createElement("td");
  if (kind === "extra") {
    const placement = document.createElement("select");
    placement.className = "extra-placement";
    [["separate", "Separate periods"], ["continuous", "Continuous block"]].forEach(([value, label]) => {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      placement.appendChild(opt);
    });
    placementTd.appendChild(placement);
  }
  tr.appendChild(placementTd);

  const tdDel = document.createElement("td");
  const btn = document.createElement("button");
  btn.className = "row-del";
  btn.type = "button";
  btn.textContent = "×";
  btn.onclick = () => {
    tr.remove();
    updateHours();
  };
  tdDel.appendChild(btn);
  tr.appendChild(tdDel);

  document.getElementById("subject-rows").appendChild(tr);
  updateHours();
}

function renderTimetable(data) {
  const tt = data.timetables[0];
  if (!tt) throw new Error("The backend did not return timetable 1.");
  const table = document.getElementById("timetable");
  table.innerHTML = "";

  const typeByNumber = {};
  if (tt.days[0]) for (const slot of tt.days[0].periods) typeByNumber[slot.period_number] = slot.slot_type;

  const numbers = [...new Set(tt.days.flatMap((d) => d.periods.map((s) => s.period_number)))].sort((a, b) => a - b);
  const head = document.createElement("tr");
  head.appendChild(th("DAY"));
  for (const n of numbers) {
    const t = typeByNumber[n];
    head.appendChild(th(t === "BREAK" ? "BREAK" : t === "LUNCH" ? "LUNCH" : "P" + n));
  }
  table.appendChild(head);

  for (const day of tt.days) {
    const row = document.createElement("tr");
    const dayCell = document.createElement("td");
    dayCell.className = "day";
    dayCell.textContent = day.day;
    row.appendChild(dayCell);
    const byNumber = {};
    for (const slot of day.periods) byNumber[slot.period_number] = slot;
    for (const n of numbers) {
      const slot = byNumber[n];
      const td = document.createElement("td");
      if (!slot || slot.slot_type === "OPEN") {
        td.className = "empty";
        td.textContent = "—";
      } else if (slot.slot_type === "BREAK") {
        td.className = "break";
        td.textContent = "Break";
      } else if (slot.slot_type === "LUNCH") {
        td.className = "lunch";
        td.textContent = "Lunch";
      } else {
        td.textContent = slot.subject_id + (slot.slot_type === "EXTERNAL" ? " LAB" : "") || "";
      }
      row.appendChild(td);
    }
    table.appendChild(row);
  }
  document.getElementById("result-card").hidden = false;
  const report = data.report || {};
  const reportEl = document.getElementById("result-report");
  reportEl.textContent = report.complete === false ? "Needs review" : "Complete";
  reportEl.className = `report ${report.complete === false ? "bad" : "ok"}`;
}

function th(text) {
  const el = document.createElement("th");
  el.textContent = text;
  return el;
}

function postJSON(url, body) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function openRendered(body) {
  const res = await postJSON("/render", body);
  const html = await res.text();
  const w = window.open("", "_blank");
  if (!w) {
    alert("Allow pop-ups to open the timetable.");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

document.getElementById("add-theory-lab").onclick = () => addRow("theory_lab");
document.getElementById("add-theory").onclick = () => addRow("theory");
document.getElementById("add-extra").onclick = () => addRow("extra");

document.getElementById("generate").onclick = async () => {
  const total = updateHours();
  if (total !== WEEKLY_SLOTS) {
    alert(`Total weekly hours must be ${WEEKLY_SLOTS} to avoid empty slots (currently ${total}). Adjust Theory + Lab, Theory, or extra-curricular periods.`);
    return;
  }
  const body = collectForm();
  const res = await postJSON("/api/generate", body);
  const data = await res.json();
  if (!res.ok) {
    alert(data.message || data.error || "Could not generate timetable.");
    return;
  }
  renderTimetable(data);
  await openRendered(body);
};

document.getElementById("export").onclick = async () => {
  const total = updateHours();
  if (total !== WEEKLY_SLOTS) {
    alert(`Total weekly hours must be ${WEEKLY_SLOTS} to avoid empty slots (currently ${total}).`);
    return;
  }
  await openRendered(collectForm());
};

window.addEventListener("DOMContentLoaded", () => {
  updateHours();
});
