/* LARE Exam Simulator, Application Logic */

const ACCESS_CODE  = "LARE9000";
const PASSING_PCT  = 70;
const STORAGE_KEY  = "lare_exam_state_v1";
const SIM_Q_COUNT  = 200;  // simulator serves this project's configured pool size (config.json exam.sim_questions)
const CLUSTER_LABEL = "Case";
const DOMAIN_LABELS = {"inventory_analysis_and_project_management": "Inventory Analysis and Project Management", "planning_and_design": "Planning and Design", "construction_documentation_and_administration": "Construction Documentation and Administration", "grading_drainage_and_stormwater_management": "Grading Drainage and Stormwater Management"};  // maps domain key -> human-readable label for display
function domainLabel(key) { return DOMAIN_LABELS[key] || key || ""; }

// The real LARE is FOUR separate, independently timed sections, each with its
// own real scored-item count and its own 3-hour exam clock (confirmed from
// CLARB's own 2024 L.A.R.E. Orientation Guide: 90/85/90/70 scored items, 3hr
// exam time each). This project's book/answer-key/domain bundling matches
// ARE's combined-product precedent, and the simulator mirrors that same real
// per-section structure rather than only ever offering one blended pool.
const SECTIONS = [
  { key: null, name: "Mixed Practice (All Sections)",
    meta: `${SIM_Q_COUNT} questions across all 4 sections • 4:00:00`,
    count: SIM_Q_COUNT, seconds: 14400 },
  { key: "inventory_analysis_and_project_management",
    name: "Section 1: Inventory, Analysis and Project Management",
    meta: "90 questions • 3:00:00 (real section length)", count: 90, seconds: 10800 },
  { key: "planning_and_design", name: "Section 2: Planning and Design",
    meta: "85 questions • 3:00:00 (real section length)", count: 85, seconds: 10800 },
  { key: "construction_documentation_and_administration",
    name: "Section 3: Construction Documentation and Administration",
    meta: "90 questions • 3:00:00 (real section length)", count: 90, seconds: 10800 },
  { key: "grading_drainage_and_stormwater_management",
    name: "Section 4: Grading, Drainage and Stormwater Management",
    meta: "70 questions • 3:00:00 (real section length)", count: 70, seconds: 10800 },
];

let EXAM_SECONDS = 14400;
let ACTIVE_SECTION_NAME = "Mixed Practice (All Sections)";
let questions = [];
let state = {
  phase: "gate", answers: {}, flags: {},
  current: 1, timeLeft: EXAM_SECONDS,
  submitted: false, startTime: null,
};
let timerInterval = null;

// ── boot ──────────────────────────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", () => {
  restoreState();
  document.getElementById("access-gate").style.display = "flex";
  document.getElementById("mode-select").style.display = "none";
  document.getElementById("app").style.display = "none";
  setupAccessGate();
});

function setupModeSelect() {
  const list = document.getElementById("mode-list");
  list.innerHTML = "";
  SECTIONS.forEach(sec => {
    const btn = document.createElement("div");
    btn.className = "mode-btn";
    btn.innerHTML = `<span class="mode-name">${sec.name}</span><span class="mode-meta">${sec.meta}</span>`;
    btn.addEventListener("click", () => chooseMode(sec));
    list.appendChild(btn);
  });
  document.getElementById("access-gate").style.display = "none";
  document.getElementById("mode-select").style.display = "flex";
}

function chooseMode(sec) {
  const allQ = (window.EXAM_QUESTIONS || []).slice();
  const pool = sec.key ? allQ.filter(q => q.domain === sec.key) : allQ;
  questions = pickQuestions(pool, sec.count);
  EXAM_SECONDS = sec.seconds;
  ACTIVE_SECTION_NAME = sec.name;
  state = { phase: "exam", answers: {}, flags: {}, current: 1, timeLeft: EXAM_SECONDS,
            submitted: false, startTime: null };
  document.getElementById("mode-select").style.display = "none";
  startExam();
}

// Shuffle by UNIT, never by individual question. A cluster is several
// questions sharing one case or passage: they must stay together and in their
// authored order, because later questions refer back to the same material.
// Shuffling every question individually scatters them across the exam, so a
// candidate meets question 6 about a passage before ever seeing the passage.
// That bug reached CNPLE's LIVE site and only a real browser found it.
// Truncation is done on a unit boundary too, so a cluster is never cut in half.
function clusterId(q) {
  return q.cluster_id || q.case_id || q.passage_id || null;
}

function pickQuestions(all, limit) {
  const units = [], byId = new Map();
  for (const q of all) {
    const c = clusterId(q);
    if (!c) { units.push([q]); continue; }
    if (!byId.has(c)) { const u = []; byId.set(c, u); units.push(u); }
    byId.get(c).push(q);
  }
  shuffleUnits(units);

  const out = [];
  for (const u of units) {
    if (out.length + u.length > limit) continue;   // never split a cluster
    for (const q of u) out.push(q);
  }
  breakAnswerRuns(out);
  return out;
}

function shuffleUnits(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// Prevent 3+ consecutive same correct answer. Only ever swaps two STANDALONE
// questions: swapping a clustered one would undo the grouping above.
function breakAnswerRuns(arr) {
  const free = i => arr[i] && !clusterId(arr[i]);
  for (let i = 2; i < arr.length; i++) {
    if (arr[i].correct === arr[i-1].correct && arr[i].correct === arr[i-2].correct) {
      if (!free(i)) continue;
      for (let j = i + 1; j < arr.length; j++) {
        if (free(j) && arr[j].correct !== arr[i-1].correct) {
          [arr[i], arr[j]] = [arr[j], arr[i]];
          break;
        }
      }
    }
  }
}

// ── access gate ───────────────────────────────────────────────────────────────
function setupAccessGate() {
  const attempt = () => {
    const val = document.getElementById("access-code-input").value.trim().toUpperCase();
    if (val === ACCESS_CODE) {
      setupModeSelect();
    } else {
      const err = document.getElementById("access-error");
      err.textContent = "Incorrect access code. Please try again.";
      document.getElementById("access-code-input").value = "";
      document.getElementById("access-code-input").focus();
    }
  };
  document.getElementById("access-btn").addEventListener("click", attempt);
  document.getElementById("access-code-input").addEventListener("keydown",
    e => { if (e.key === "Enter") attempt(); });
}

// ── exam start ────────────────────────────────────────────────────────────────
function startExam() {
  if (state.submitted) {
    localStorage.removeItem(STORAGE_KEY);
    state = { phase: "gate", answers: {}, flags: {}, current: 1, timeLeft: EXAM_SECONDS, submitted: false, startTime: null };
  }
  document.getElementById("app").style.display = "flex";
  const barName = document.getElementById("bar-section-name");
  if (barName) barName.textContent = ACTIVE_SECTION_NAME;
  if (!state.startTime) state.startTime = Date.now();
  renderQuestion();
  startTimer();
  buildGrid();
  document.getElementById("submit-btn").addEventListener("click", confirmSubmit);
  document.getElementById("flag-btn").addEventListener("click",   toggleFlag);
  document.getElementById("prev-btn").addEventListener("click",   () => navigate(-1));
  document.getElementById("next-btn").addEventListener("click",   () => navigate(1));
  document.getElementById("map-btn").addEventListener("click",    openMapModal);
  document.getElementById("map-close").addEventListener("click",  closeMapModal);
  document.getElementById("map-backdrop").addEventListener("click", closeMapModal);
  document.addEventListener("keydown", keyHandler);
}

// ── timer ─────────────────────────────────────────────────────────────────────
function startTimer() {
  updateTimerDisplay();
  timerInterval = setInterval(() => {
    if (state.submitted) return;
    state.timeLeft = Math.max(0, EXAM_SECONDS - Math.floor((Date.now() - state.startTime) / 1000));
    updateTimerDisplay();
    if (state.timeLeft === 0) submitExam();
    saveState();
  }, 1000);
}

function updateTimerDisplay() {
  const h = Math.floor(state.timeLeft / 3600);
  const m = Math.floor((state.timeLeft % 3600) / 60);
  const s = state.timeLeft % 60;
  document.getElementById("timer-display").textContent =
    h > 0 ? `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`
           : `${m}:${String(s).padStart(2,"0")}`;
}

// ── render ─────────────────────────────────────────────────────────────────────
// Any renderer that injects content as HTML must escape it first. This helper
// was missing from the scaffold entirely, so every cluster/passage renderer
// copied in from a finished project threw ReferenceError on its first item.
function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// A cluster's shared text is shown above EVERY question in that cluster, so a
// candidate never has to page backwards to reread it. It scrolls inside its own
// box: unbounded, a 450 word passage pushes the stem and options below the fold.
function renderCluster(q) {
  const wrap = document.getElementById("q-cluster-wrap");
  if (!wrap) return;
  const text = q.cluster_text || q.case_text || q.passage_text || "";
  if (!text) { wrap.innerHTML = ""; wrap.style.display = "none"; return; }
  const body = String(text).split("\n").filter(l => l.trim())
    .map(l => `<p>${escapeHTML(l.trim())}</p>`).join("");
  wrap.innerHTML = `<div class="cluster-label">${CLUSTER_LABEL} `
                 + `${escapeHTML(clusterId(q) || "")}</div>`
                 + `<div class="cluster-body">${body}</div>`;
  wrap.style.display = "block";
}

// Item type helper. Missing/absent "type" means plain single-answer MCQ, the
// default for the vast majority of the bank. "sata" is CLARB's real
// Multiple Response item ("choose two"/"choose three"). "hot_spot" and
// "drag_place" are CLARB's real Hot Spot and Drag and Place item types: both
// render here as a click-the-labeled-point overlay on the question's own
// site/grading plan image (a dual-schema design -- the DOCX and the answer
// key treat them as an ordinary image-based MCQ with a fixed "Point A" /
// "Zone N" option list, so no separate code path was needed there; only the
// simulator needs a distinct render branch for the interactive click target).
function qType(q) { return q?.type || "mcq"; }
const SATA_LETTERS = ["A", "B", "C", "D", "E", "F", "G"];
function sataIsCorrect(userAns, correctArr) {
  const u = Array.isArray(userAns) ? userAns : [];
  const c = Array.isArray(correctArr) ? correctArr : [];
  return u.length === c.length && u.every(l => c.includes(l));
}
function isHotspotLike(q) {
  return qType(q) === "hot_spot" || qType(q) === "drag_place";
}

function renderHotspotImage(wrap, q, chosen, reviewMode) {
  const box = document.createElement("div");
  box.className = "hotspot-imgbox";
  const img = document.createElement("img");
  img.className = "q-image";
  img.src = q.image;
  img.alt = q.question || "";
  box.appendChild(img);

  Object.entries(q.zones || {}).forEach(([letter, z]) => {
    const zone = document.createElement("div");
    zone.className = "hotspot-zone";
    zone.style.left = z.left + "%";
    zone.style.top = z.top + "%";
    zone.style.width = z.width + "%";
    zone.style.height = z.height + "%";
    if (reviewMode) {
      if (letter === q.correct) zone.classList.add("hotspot-correct");
      else if (letter === chosen) zone.classList.add("hotspot-incorrect");
    } else {
      if (letter === chosen) zone.classList.add("hotspot-selected");
      zone.addEventListener("click", () => selectAnswer(state.current, letter));
    }
    box.appendChild(zone);
  });

  wrap.innerHTML = "";
  wrap.appendChild(box);
  if (!reviewMode) {
    const hint = document.createElement("p");
    hint.className = "hotspot-hint";
    hint.textContent = qType(q) === "drag_place"
      ? "Click or tap the numbered zone where this element belongs."
      : "Click or tap directly on the labeled point that answers the question.";
    wrap.appendChild(hint);
  }
}

function renderQuestion() {
  const q = questions[state.current - 1];
  if (!q) return;
  renderCluster(q);
  document.getElementById("q-counter").textContent = `Question ${state.current} of ${questions.length}`;
  document.getElementById("q-domain").textContent  = domainLabel(q.domain);
  document.getElementById("question-text").textContent = q.question;
  const imgWrap = document.getElementById("q-image-wrap");
  if (q.image && isHotspotLike(q)) {
    renderHotspotImage(imgWrap, q, state.answers[state.current]);
    imgWrap.style.display = "block";
  } else if (q.image) {
    imgWrap.innerHTML = `<img src="${q.image}" alt="" class="q-image">`;
    imgWrap.style.display = "block";
  } else {
    imgWrap.innerHTML = "";
    imgWrap.style.display = "none";
  }
  const fi = document.getElementById("q-flag-indicator");
  fi.style.display = state.flags[state.current] ? "inline-block" : "none";

  document.getElementById("explanation-box").style.display = "none";

  const ol = document.getElementById("options-list");
  ol.innerHTML = "";
  const chosen = state.answers[state.current];
  if (isHotspotLike(q)) {
    // The image itself carries the click targets; nothing to render as text.
  } else if (qType(q) === "sata") {
    const note = document.createElement("div");
    note.className = "sata-instruction";
    note.textContent = "Select all that apply";
    ol.appendChild(note);
    const chosenArr = Array.isArray(chosen) ? chosen : [];
    SATA_LETTERS.forEach(letter => {
      const text = q.options?.[letter];
      if (!text) return;
      const div = document.createElement("div");
      div.className = "option" + (chosenArr.includes(letter) ? " selected" : "");
      div.innerHTML = `<span class="opt-letter">${chosenArr.includes(letter) ? "☑" : "☐"}</span><span class="opt-text">${text}</span>`;
      div.addEventListener("click", () => toggleSataAnswer(state.current, letter));
      ol.appendChild(div);
    });
  } else {
    ["A", "B", "C", "D", "E"].forEach(letter => {
      const text = q.options?.[letter];
      if (!text) return;
      const div = document.createElement("div");
      div.className = "option" + (chosen === letter ? " selected" : "");
      div.innerHTML = `<span class="opt-letter">${letter}</span><span class="opt-text">${text}</span>`;
      div.addEventListener("click", () => selectAnswer(state.current, letter));
      ol.appendChild(div);
    });
  }

  // Scroll question panel to top on navigation
  const panel = document.querySelector(".question-panel");
  if (panel) panel.scrollTop = 0;

  updateProgress();
  updateGrid();
}

function selectAnswer(qNum, letter) {
  if (state.submitted) return;
  state.answers[qNum] = letter;
  renderQuestion();
  saveState();
}

function toggleSataAnswer(qNum, letter) {
  if (state.submitted) return;
  const cur = Array.isArray(state.answers[qNum]) ? state.answers[qNum].slice() : [];
  const i = cur.indexOf(letter);
  if (i === -1) cur.push(letter); else cur.splice(i, 1);
  if (cur.length === 0) delete state.answers[qNum];
  else state.answers[qNum] = cur;
  renderQuestion();
  saveState();
}

function navigate(dir) {
  const next = state.current + dir;
  if (next >= 1 && next <= questions.length) {
    state.current = next;
    renderQuestion();
  }
}

function toggleFlag() {
  state.flags[state.current] = !state.flags[state.current];
  renderQuestion();
  saveState();
}

function updateProgress() {
  const pct = Object.keys(state.answers).length / questions.length * 100;
  document.getElementById("progress-bar").style.width = pct + "%";
}

// ── question map modal ────────────────────────────────────────────────────────
function openMapModal() {
  updateGrid();
  document.getElementById("map-modal").style.display = "flex";
}

function closeMapModal() {
  document.getElementById("map-modal").style.display = "none";
}

// ── grid ──────────────────────────────────────────────────────────────────────
function buildGrid() {
  const grid = document.getElementById("q-grid");
  grid.innerHTML = "";
  for (let i = 1; i <= questions.length; i++) {
    const btn = document.createElement("button");
    btn.className = "grid-btn";
    btn.id = `gb-${i}`;
    btn.textContent = i;
    btn.addEventListener("click", () => {
      state.current = i;
      closeMapModal();
      renderQuestion();
    });
    grid.appendChild(btn);
  }
}

function updateGrid() {
  for (let i = 1; i <= questions.length; i++) {
    const btn = document.getElementById(`gb-${i}`);
    if (!btn) continue;
    btn.className = "grid-btn" +
      (state.answers[i]  ? " answered" : "") +
      (state.flags[i]    ? " flagged"  : "") +
      (state.current===i ? " active"   : "");
  }
}

// ── submit ────────────────────────────────────────────────────────────────────
function confirmSubmit() {
  const unanswered = questions.length - Object.keys(state.answers).length;
  if (unanswered > 0) {
    alert(`You must answer all ${questions.length} questions before submitting.\n\n${unanswered} question${unanswered > 1 ? "s" : ""} still unanswered.\n\nTap "Question Map" to find unanswered questions.`);
    return;
  }
  if (confirm("Submit your exam now?")) submitExam();
}

function submitExam() {
  clearInterval(timerInterval);
  state.submitted = true;
  saveState();
  showResults();
}

// ── results ───────────────────────────────────────────────────────────────────
function showResults() {
  document.getElementById("app").style.display = "none";
  document.getElementById("results-screen").style.display = "flex";

  let correct = 0;
  const domainStats = {};
  questions.forEach((q, idx) => {
    const num = idx + 1;
    const userAns = state.answers[num];
    const isRight = qType(q) === "sata"
      ? sataIsCorrect(userAns, q.correct)
      : userAns === q.correct;
    if (isRight) correct++;
    const dom = q.domain || "Other";
    if (!domainStats[dom]) domainStats[dom] = { correct: 0, total: 0 };
    domainStats[dom].total++;
    if (isRight) domainStats[dom].correct++;
  });

  const pct  = Math.round(correct / questions.length * 100);
  const passed = pct >= PASSING_PCT;
  document.getElementById("res-status").textContent = passed ? "PASS" : "FAIL";
  document.getElementById("res-status").style.color = passed ? "#059669" : "#DC2626";
  document.getElementById("res-score").textContent  = `${ACTIVE_SECTION_NAME}: ${correct} / ${questions.length} (${pct}%)`;

  const domDiv = document.getElementById("res-domains");
  domDiv.innerHTML = "";
  Object.entries(domainStats).forEach(([dom, s]) => {
    const dp = Math.round(s.correct / s.total * 100);
    domDiv.innerHTML += `<div class="res-domain-row">
      <span class="res-domain-name">${domainLabel(dom)}</span>
      <div class="res-domain-bar-wrap"><div class="res-domain-bar" style="width:${dp}%;background:#1B3A6B"></div></div>
      <span class="res-domain-pct">${dp}%</span>
    </div>`;
  });

  document.getElementById("res-review-btn").addEventListener("click", () => {
    state.submitted = true;
    document.getElementById("results-screen").style.display = "none";
    document.getElementById("app").style.display = "flex";
    renderReview();
  });
  document.getElementById("res-restart-btn").addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  });
}

function renderReview() {
  const ol = document.getElementById("options-list");
  const q  = questions[state.current - 1];
  if (!q) return;
  document.getElementById("q-counter").textContent = `Review, Question ${state.current} of ${questions.length}`;
  document.getElementById("question-text").textContent = q.question;
  const revImgWrap = document.getElementById("q-image-wrap");
  const userAns = state.answers[state.current];
  if (q.image && isHotspotLike(q)) {
    renderHotspotImage(revImgWrap, q, userAns, true);
    revImgWrap.style.display = "block";
  } else if (q.image) {
    revImgWrap.innerHTML = `<img src="${q.image}" alt="" class="q-image">`;
    revImgWrap.style.display = "block";
  } else {
    revImgWrap.innerHTML = "";
    revImgWrap.style.display = "none";
  }
  ol.innerHTML = "";
  if (isHotspotLike(q)) {
    // The image overlay above already shows correct/incorrect.
  } else if (qType(q) === "sata") {
    const correctSet = Array.isArray(q.correct) ? q.correct : [];
    const userSet = Array.isArray(userAns) ? userAns : [];
    const note = document.createElement("div");
    note.className = "sata-instruction";
    note.textContent = "Select all that apply";
    ol.appendChild(note);
    SATA_LETTERS.forEach(letter => {
      const text = q.options?.[letter];
      if (!text) return;
      const div = document.createElement("div");
      let cls = "option";
      if (correctSet.includes(letter)) cls += " correct";
      else if (userSet.includes(letter)) cls += " incorrect";
      div.className = cls;
      div.innerHTML = `<span class="opt-letter">${userSet.includes(letter) ? "☑" : "☐"}</span><span class="opt-text">${text}</span>`;
      ol.appendChild(div);
    });
  } else {
    ["A", "B", "C", "D", "E"].forEach(letter => {
      const text = q.options?.[letter];
      if (!text) return;
      const div = document.createElement("div");
      let cls = "option";
      if (letter === q.correct)      cls += " correct";
      else if (letter === userAns)   cls += " incorrect";
      div.className = cls;
      div.innerHTML = `<span class="opt-letter">${letter}</span><span class="opt-text">${text}</span>`;
      ol.appendChild(div);
    });
  }

  const box  = document.getElementById("explanation-box");
  const expl = document.getElementById("explanation-text");
  if (q.explanation) {
    expl.textContent = q.explanation;
    box.style.display = "block";
  } else {
    box.style.display = "none";
  }

  document.getElementById("prev-btn").onclick = () => { navigate(-1); renderReview(); };
  document.getElementById("next-btn").onclick = () => { navigate(1);  renderReview(); };
}

// ── persistence ───────────────────────────────────────────────────────────────
function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch(e) {}
}
function restoreState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) { const s = JSON.parse(saved); Object.assign(state, s); }
  } catch(e) {}
}

// ── keyboard ──────────────────────────────────────────────────────────────────
function keyHandler(e) {
  const letter = e.key.toUpperCase();
  const q = questions[state.current - 1];
  if (["A", "B", "C", "D", "E"].includes(letter) && !e.ctrlKey && !e.metaKey && q?.options?.[letter]
      && !isHotspotLike(q)) {
    if (qType(q) === "sata") toggleSataAnswer(state.current, letter);
    else selectAnswer(state.current, letter);
  }
  if (e.key === "ArrowRight" && state.current < questions.length) navigate(1);
  if (e.key === "ArrowLeft"  && state.current > 1)                navigate(-1);
  if (e.key === "Escape") closeMapModal();
}
