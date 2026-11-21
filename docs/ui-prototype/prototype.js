const controls = {
  searchEntryLabel: { label: "Notes search button", baseline: "Search in Notes" },
  lastOpenedLabel: { label: "Recent notes heading", baseline: "Last opened" },
  searchPlaceholder: { label: "Search placeholder", baseline: "Search" },
  searchRadius: { label: "Search field corner radius", baseline: 28, min: 8, max: 32, css: "--search-radius" },
  tabGap: { label: "Tab spacing", baseline: 10, min: 4, max: 20, css: "--tab-gap" },
  tabRadius: { label: "Tab corner radius", baseline: 16, min: 4, max: 28, css: "--tab-radius" },
  tabLabels: { label: "Tab labels", baseline: false }
};
const baseline = Object.fromEntries(Object.entries(controls).map(([key, item]) => [key, item.baseline]));
const storageKey = "ohai-ui-prototype-v1";
const feedback = document.querySelector("#feedback");
const intent = document.querySelector("#intent");
const form = document.querySelector("#settings");
const screen = document.querySelector("#screen");
const nav = document.querySelector("#screens");
const views = { notes: "Notes", search: "Search", menu: "Notes menu", notebooks: "Notebooks", editor: "Note editor", browser: "Browser", profile: "Profile" };
const destinations = ["Notes", "Favorites", "Reminders", "Monographs", "Archive", "Trash"];
const samples = [
  { title: "Garden journal", body: "Plant basil and take photos of the new seedlings." },
  { title: "Reading list", body: "Pick a book for the weekend." },
  { title: "Project notes", body: "Ideas and next steps for the project." }
];
const notebooks = ["Personal", "Work"];
const icons = {
  note: "M6 3h8l4 4v14H6z M14 3v5h4 M9 12h6 M9 16h6",
  folder: "M3 8V5h6l3 3h9v12H3z M3 11h18",
  search: "M10 17a7 7 0 1 1 0-14 7 7 0 0 1 0 14z M15 15l5 5",
  add: "M12 5v14 M5 12h14",
  close: "M6 6l12 12 M18 6 6 18",
  compass: "M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18z M15 9l-2 4-4 2 2-4z",
  profile: "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21v-2c0-5 16-5 16 0v2z",
  back: "M20 12H5 M11 6l-6 6 6 6",
  home: "M3 11l9-8 9 8 M6 10v10h12V10 M10 20v-6h4v6",
  book: "M5 3h14v18H5z M8 3v7l2-2 2 2V3"
};
const initialView = new URLSearchParams(location.search).get("view");
let view = Object.hasOwn(views, initialView) ? initialView : "notes";
let destination = "Notes";
let query = "";
let selectedNote;
let draft = { values: { ...baseline }, intent: "" };
try {
  const saved = JSON.parse(localStorage.getItem(storageKey));
  if (saved) {
    for (const [key, item] of Object.entries(controls)) {
      const value = saved.values?.[key];
      if (typeof value !== typeof item.baseline) continue;
      if (typeof value === "number" && (!Number.isInteger(value) || value < item.min || value > item.max)) continue;
      draft.values[key] = typeof value === "string" ? value.slice(0, 60) : value;
    }
    if (typeof saved.intent === "string") draft.intent = saved.intent.slice(0, 2000);
  }
} catch {}

function element(tag, className, label) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (label !== undefined) node.textContent = label;
  return node;
}

function icon(name) {
  const node = element("span", "icon");
  node.setAttribute("aria-hidden", "true");
  node.innerHTML = '<svg viewBox="0 0 24 24"><path d="' + icons[name] + '"></path></svg>';
  return node;
}

function button(label, callback, className) {
  const node = element("button", className, label);
  node.type = "button";
  node.onclick = callback;
  return node;
}

function iconButton(label, name, callback, className = "") {
  const node = button("", callback, "icon-button " + className);
  node.setAttribute("aria-label", label);
  node.append(icon(name));
  return node;
}

function navigate(next, { focus = false } = {}) {
  view = next;
  if (next === "search") query = "";
  render();
  if (focus) screen.querySelector("#search-query")?.focus({ preventScroll: true });
}

function tabs() {
  const tabBar = element("div", "tabs");
  tabBar.setAttribute("role", "group");
  tabBar.setAttribute("aria-label", "App tabs");
  for (const [id, name] of [["notes", "note"], ["browser", "compass"], ["profile", "profile"]]) {
    const tab = button("", () => navigate(id));
    tab.setAttribute("aria-label", views[id]);
    tab.setAttribute("aria-pressed", String(view === id || (id === "notes" && ["menu", "notebooks"].includes(view))));
    tab.append(icon(name));
    if (draft.values.tabLabels) tab.append(element("small", "", views[id]));
    tabBar.append(tab);
  }
  return tabBar;
}

function rows(content, list) {
  for (const note of list) {
    const row = button("", () => { selectedNote = note; navigate("editor"); }, "note");
    const copy = element("span");
    copy.append(element("strong", "", note.title || "Untitled note"), element("small", "", note.body));
    row.append(icon("note"), copy);
    content.append(row);
  }
}

function notes() {
  const content = element("div", "content");
  if (destination !== "Notes") content.append(element("h2", "", destination));
  if (destination === "Notes") rows(content, samples);
  const toolbar = element("div", "toolbar");
  const search = element("div", "search-entry");
  search.append(
    iconButton("Open Notes menu", "folder", () => navigate("menu")),
    button(draft.values.searchEntryLabel, () => navigate("search", { focus: true }), "search-launch")
  );
  toolbar.append(search, iconButton("Create note", "add", () => {
    selectedNote = { title: "", body: "" };
    samples.unshift(selectedNote);
    navigate("editor");
  }, "add"));
  screen.append(content, toolbar, tabs());
}

function search() {
  const content = element("div", "content");
  content.setAttribute("aria-label", "Notes search results");
  const row = element("div", "search-row");
  const field = element("div", "search-field");
  const input = element("input");
  input.id = "search-query";
  input.type = "search";
  input.setAttribute("aria-label", "Search notes");
  input.inputMode = "none";
  input.placeholder = draft.values.searchPlaceholder;
  input.value = query;
  field.append(icon("search"), input);
  row.append(field, iconButton("Close search", "close", () => navigate("notes"), "close-search"));
  const keyboard = element("div", "keyboard");
  keyboard.setAttribute("aria-label", "Simulated keyboard");
  function update(value) {
    query = value;
    input.value = value;
    content.replaceChildren();
    const term = value.trim().toLowerCase();
    const matches = term ? samples.filter(note => (note.title + " " + note.body).toLowerCase().includes(term)) : samples;
    const heading = term ? (matches.length === 1 ? "1 result" : matches.length + " results") : draft.values.lastOpenedLabel;
    content.append(element("h2", "", heading));
    rows(content, matches);
  }
  input.oninput = () => update(input.value);
  input.onkeydown = event => { if (event.key === "Escape") navigate("notes"); };
  for (const letters of ["qwertyuiop", "asdfghjkl", "zxcvbnm"]) {
    const line = element("div", "keys");
    for (const letter of letters) line.append(button(letter, () => update(query + letter)));
    keyboard.append(line);
  }
  const last = element("div", "keys");
  last.append(button("⌫", () => update(query.slice(0, -1))), button("space", () => update(query + " "), "space"), button("Search", () => update(query), "done"));
  keyboard.append(last);
  update(query);
  screen.append(content, row, keyboard);
}

function menu() {
  notes();
  const shade = element("div", "shade");
  shade.onclick = event => { if (event.target === shade) navigate("notes"); };
  const sheet = element("div", "sheet");
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-label", view === "notebooks" ? "Notebooks" : "Notes menu");
  const head = element("div", "sheet-head");
  head.append(iconButton("Close Notes menu", "close", () => navigate("notes")));
  const list = element("div", "sheet-list");
  const inNotebooks = view === "notebooks";
  for (const name of inNotebooks ? notebooks : destinations) {
    const item = button(name, () => { destination = name; navigate("notes"); });
    if (name === destination) item.setAttribute("aria-current", "page");
    item.append(element("span", "", name === "Notes" ? String(samples.length) : "0"));
    list.append(item);
  }
  const footer = element("div", "sheet-footer");
  const home = iconButton("Notes sections", "home", () => navigate("menu"));
  home.setAttribute("aria-pressed", String(!inNotebooks));
  const book = iconButton("Notebooks", "book", () => navigate("notebooks"));
  book.setAttribute("aria-pressed", String(inNotebooks));
  footer.append(home, book);
  if (inNotebooks) footer.append(iconButton("Add notebook", "add", () => {
    list.replaceChildren();
    const title = element("input");
    title.setAttribute("aria-label", "Notebook title");
    title.placeholder = "Notebook title";
    list.append(title, button("Add", () => {
      if (!title.value.trim()) return;
      notebooks.push(title.value.trim());
      render();
    }));
    title.focus();
  }));
  sheet.append(element("div", "grabber"), head, list, footer);
  shade.append(sheet);
  screen.append(shade);
}

function editor() {
  const content = element("div", "content editor");
  const title = element("input");
  title.setAttribute("aria-label", "Note title");
  title.placeholder = "Note title";
  const body = element("textarea");
  body.setAttribute("aria-label", "Note body");
  body.placeholder = "Start writing your note…";
  title.value = selectedNote?.title ?? "";
  body.value = selectedNote?.body ?? "";
  title.oninput = () => { if (selectedNote) selectedNote.title = title.value; };
  body.oninput = () => { if (selectedNote) selectedNote.body = body.value; };
  content.append(iconButton("Back to Notes", "back", () => navigate("notes")), title, body);
  screen.append(content);
}

function render() {
  for (const [key, item] of Object.entries(controls)) {
    if (item.css) screen.style.setProperty(item.css, draft.values[key] + "px");
  }
  for (const entry of nav.querySelectorAll("button")) {
    if (entry.dataset.view === view) entry.setAttribute("aria-current", "page");
    else entry.removeAttribute("aria-current");
  }
  screen.replaceChildren();
  if (view === "notes") notes();
  else if (view === "search") search();
  else if (view === "menu" || view === "notebooks") menu();
  else if (view === "editor") editor();
  else {
    const preview = element("div", "tab-preview");
    preview.append(element("strong", "", views[view]), element("span", "", "Tab preview"));
    screen.append(preview, tabs());
  }
}

function save() {
  try { localStorage.setItem(storageKey, JSON.stringify(draft)); }
  catch { feedback.textContent = "Draft storage is unavailable. Export to keep your changes."; }
}

function setupControls() {
  form.replaceChildren();
  for (const [key, item] of Object.entries(controls)) {
    const row = element("div", "setting");
    const label = element("label", "", item.label);
    label.htmlFor = key;
    const boolean = typeof item.baseline === "boolean";
    const numeric = typeof item.baseline === "number";
    const input = element(boolean ? "select" : "input");
    input.id = key;
    if (boolean) {
      for (const [value, label] of [["false", "Icons only"], ["true", "Icons and labels"]]) {
        const option = element("option", "", label);
        option.value = value;
        input.append(option);
      }
    } else if (numeric) {
      input.type = "number";
      input.min = item.min;
      input.max = item.max;
      input.required = true;
    } else input.maxLength = 60;
    input.value = String(draft.values[key]);
    input.oninput = () => {
      if (!input.validity.valid) return;
      draft.values[key] = boolean ? input.value === "true" : numeric ? input.valueAsNumber : input.value;
      save();
      render();
    };
    row.append(label, input);
    form.append(row);
  }
  intent.value = draft.intent;
}

for (const [id, label] of Object.entries(views)) {
  const entry = button(label, () => navigate(id, { focus: id === "search" }));
  entry.dataset.view = id;
  if (["search", "menu", "notebooks", "editor"].includes(id)) entry.dataset.child = "true";
  nav.append(entry);
}
form.onsubmit = event => event.preventDefault();
intent.maxLength = 2000;
intent.oninput = () => { draft.intent = intent.value; save(); };
document.querySelector("#export").onclick = () => {
  if (!form.reportValidity()) return;
  const snapshot = {
    schema: "ohai-ui-design/v1",
    baselineId: "ohai-ios-notes-2026-11-13",
    exportedAt: new Date().toISOString(),
    view,
    baseline,
    proposed: { ...draft.values },
    intent: draft.intent.trim()
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2) + "\n"], { type: "application/json" }));
  const download = element("a");
  download.href = url;
  download.download = "ohai-ui-design-" + snapshot.exportedAt.replace(/[:.]/g, "-") + ".json";
  download.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  feedback.textContent = "Snapshot exported. Give the JSON to the UI implementation brief skill.";
};
document.querySelector("#reset").onclick = () => {
  draft = { values: { ...baseline }, intent: "" };
  save();
  setupControls();
  render();
  feedback.textContent = "Draft reset to the prototype baseline.";
};
setupControls();
render();
