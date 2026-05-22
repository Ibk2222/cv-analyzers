(function () {
  /* ─────────────── SHARED HELPERS ─────────────── */
  function isValidFile(file, showErr) {
    const allowed = ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
    const ext = file.name.split(".").pop().toLowerCase();
    if (!allowed.includes(file.type) && !["pdf", "docx"].includes(ext)) { showErr("Only PDF and DOCX files are supported."); return false; }
    if (file.size > 10 * 1024 * 1024) { showErr("File size must be under 10 MB."); return false; }
    return true;
  }
  function formatBytes(b) {
    if (b < 1024) return b + " B";
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + " KB";
    return (b / (1024 * 1024)).toFixed(1) + " MB";
  }
  function animateNumber(el, from, to, duration) {
    const start = performance.now();
    (function update(now) {
      const t = Math.min((now - start) / duration, 1);
      const e = 1 - Math.pow(1 - t, 3);
      el.textContent = Math.round(from + (to - from) * e);
      if (t < 1) requestAnimationFrame(update);
    })(performance.now());
  }
  function fitColor(pct) { return pct >= 70 ? "#10b981" : pct >= 40 ? "#f59e0b" : "#ef4444"; }
  function fitClass(pct) { return pct >= 70 ? "high" : pct >= 40 ? "mid" : "low"; }
  function scoreColor(s) { return s >= 80 ? "#22c55e" : s >= 65 ? "#6366f1" : s >= 45 ? "#f59e0b" : "#ef4444"; }
  function badgeClass(s) { return s >= 80 ? "badge-excellent" : s >= 65 ? "badge-good" : s >= 45 ? "badge-fair" : "badge-needs"; }

  const landingContent = document.getElementById("landingContent");

  /* ─────────────── MODE TABS ─────────────── */
  const tabSingle = document.getElementById("tabSingle");
  const tabBulk   = document.getElementById("tabBulk");
  const singleModeContent = document.getElementById("singleModeContent");
  const bulkModeContent   = document.getElementById("bulkModeContent");

  tabSingle.addEventListener("click", () => switchMode("single"));
  tabBulk.addEventListener("click",   () => switchMode("bulk"));

  function switchMode(mode) {
    if (mode === "single") {
      tabSingle.classList.add("is-active");
      tabBulk.classList.remove("is-active");
      singleModeContent.style.display = "block";
      bulkModeContent.style.display   = "none";
    } else {
      tabBulk.classList.add("is-active");
      tabSingle.classList.remove("is-active");
      bulkModeContent.style.display   = "block";
      singleModeContent.style.display = "none";
    }
  }

  /* ─────────────── SINGLE MODE ─────────────── */
  const dropZone      = document.getElementById("dropZone");
  const fileInput     = document.getElementById("fileInput");
  const fileSelected  = document.getElementById("fileSelected");
  const fileNameEl    = document.getElementById("fileName");
  const fileSizeEl    = document.getElementById("fileSize");
  const removeFile    = document.getElementById("removeFile");
  const analyzeBtn    = document.getElementById("analyzeBtn");
  const errorMsg      = document.getElementById("errorMsg");
  const results       = document.getElementById("results");
  const resetBtn      = document.getElementById("resetBtn");
  const jobTitle      = document.getElementById("jobTitle");
  const jobDescription = document.getElementById("jobDescription");

  let selectedFile = null;

  dropZone.addEventListener("click", () => fileInput.click());
  ["dragenter", "dragover"].forEach(ev => dropZone.addEventListener(ev, e => { e.preventDefault(); dropZone.classList.add("dragover"); }));
  ["dragleave", "drop"].forEach(ev => dropZone.addEventListener(ev, () => dropZone.classList.remove("dragover")));
  dropZone.addEventListener("drop", e => { e.preventDefault(); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });
  fileInput.addEventListener("change", () => { if (fileInput.files[0]) handleFile(fileInput.files[0]); });
  removeFile.addEventListener("click", clearFile);

  function handleFile(file) {
    if (!isValidFile(file, msg => { errorMsg.textContent = msg; errorMsg.style.display = "block"; })) return;
    selectedFile = file;
    errorMsg.style.display = "none";
    fileNameEl.textContent = file.name;
    fileSizeEl.textContent = formatBytes(file.size);
    dropZone.style.display = "none";
    fileSelected.style.display = "flex";
    analyzeBtn.disabled = false;
  }

  function clearFile() {
    selectedFile = null; fileInput.value = "";
    dropZone.style.display = "block"; fileSelected.style.display = "none";
    analyzeBtn.disabled = true; errorMsg.style.display = "none";
  }

  analyzeBtn.addEventListener("click", async () => {
    if (!selectedFile) return;
    const btnText   = analyzeBtn.querySelector(".btn-text");
    const btnLoader = analyzeBtn.querySelector(".btn-loader");
    btnText.style.display = "none"; btnLoader.style.display = "flex"; analyzeBtn.disabled = true;
    errorMsg.style.display = "none";

    const fd = new FormData();
    fd.append("cv", selectedFile);
    if (jobTitle.value.trim())       fd.append("jobTitle",       jobTitle.value.trim());
    if (jobDescription.value.trim()) fd.append("jobDescription", jobDescription.value.trim());

    try {
      const res  = await fetch("/api/analyze", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok || !data.success) { errorMsg.textContent = data.error || "Analysis failed."; errorMsg.style.display = "block"; return; }
      renderSingleResults(data);
    } catch { errorMsg.textContent = "Network error — is the server running?"; errorMsg.style.display = "block"; }
    finally  { btnText.style.display = ""; btnLoader.style.display = "none"; analyzeBtn.disabled = false; }
  });

  resetBtn.addEventListener("click", () => {
    results.style.display = "none";
    landingContent.style.display = "block";
    clearFile(); jobTitle.value = ""; jobDescription.value = "";
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  /* ── Single Results Renderer ── */
  function renderSingleResults(data) {
    landingContent.style.display = "none";
    results.style.display = "block";
    window.scrollTo({ top: 0, behavior: "smooth" });

    // Score ring
    const circle = document.getElementById("scoreCircle");
    circle.style.stroke = scoreColor(data.totalScore);
    setTimeout(() => {
      circle.style.strokeDashoffset = 427 - (data.totalScore / 100) * 427;
      animateNumber(document.getElementById("scoreNumber"), 0, data.totalScore, 1200);
    }, 100);

    // Badge
    const badge = document.getElementById("assessmentBadge");
    badge.textContent = data.overallAssessment;
    badge.className = "assessment-badge " + badgeClass(data.totalScore);

    document.getElementById("cvFilename").textContent  = data.filename;
    document.getElementById("wordCountText").textContent = data.wordCount + " words extracted";

    // Job Fit Banner
    const banner = document.getElementById("jobFitBanner");
    if (data.jobFitScore != null) {
      document.getElementById("jobFitRole").textContent  = data.jobTitle || "Target Role";
      document.getElementById("jobFitScore").textContent = data.jobFitScore + "%";
      const fill = document.getElementById("jobFitFill");
      fill.style.background = data.jobFitScore >= 70 ? "rgba(255,255,255,.9)" : data.jobFitScore >= 40 ? "rgba(251,191,36,.9)" : "rgba(252,165,165,.9)";
      setTimeout(() => { fill.style.width = data.jobFitScore + "%"; }, 150);
      banner.style.display = "flex";
    } else { banner.style.display = "none"; }

    // Tailoring
    const tc = document.getElementById("tailoringCard");
    if (data.tailoringTips && data.tailoringTips.length) {
      document.getElementById("tailoringList").innerHTML = data.tailoringTips.map(t => `<li>${t}</li>`).join("");
      tc.style.display = "block";
    } else { tc.style.display = "none"; }

    // Categories
    const cats = [
      { key:"contact",    label:"Contact Information", max:15 },
      { key:"summary",    label:"Summary / Objective", max:10 },
      { key:"experience", label:"Work Experience",     max:25 },
      { key:"education",  label:"Education",           max:15 },
      { key:"skills",     label:"Skills",              max:15 },
      { key:"formatting", label:"Length & Formatting", max:10 },
      { key:"keywords",   label:"Keyword Match",       max:10 },
    ];
    const catEl = document.getElementById("categories");
    catEl.innerHTML = cats.map(({ key, label, max }) => {
      const score = data.scores[key] || 0, pct = Math.round((score / max) * 100);
      return `<div class="category-item"><div class="cat-header"><span class="cat-name">${label}</span><span class="cat-score">${score}/${max}</span></div><div class="progress-bar"><div class="progress-fill ${fitClass(pct)}" data-pct="${pct}" style="width:0%"></div></div></div>`;
    }).join("");
    setTimeout(() => { catEl.querySelectorAll(".progress-fill").forEach(b => { b.style.width = b.dataset.pct + "%"; }); }, 150);

    // Strengths
    const sc = document.getElementById("strengthsCard");
    if (data.strengths && data.strengths.length) {
      document.getElementById("strengthsList").innerHTML = data.strengths.map(s => `<li>${s}</li>`).join("");
      sc.style.display = "block";
    } else { sc.style.display = "none"; }

    // Suggestions
    const sg = document.getElementById("suggestionsCard");
    if (data.suggestions && data.suggestions.length) {
      document.getElementById("suggestionsList").innerHTML = data.suggestions.map(s => `<li>${s}</li>`).join("");
      sg.style.display = "block";
    } else { sg.style.display = "none"; }

    // Keywords
    renderKeywordsSection(data.matchedKeywords || [], data.missingKeywords || []);
  }

  function renderKeywordsSection(matched, missing) {
    const kwCard = document.getElementById("keywordsCard");
    if (!matched.length && !missing.length) { kwCard.style.display = "none"; return; }

    const total = matched.length + missing.length;
    const pct   = total > 0 ? Math.round((matched.length / total) * 100) : 0;

    document.getElementById("kwMatchCount").textContent = matched.length;
    document.getElementById("kwTotalCount").textContent = total;
    document.getElementById("kwPctBadge").textContent   = pct + "%";
    document.getElementById("kwPctBadge").style.background = fitColor(pct);

    setTimeout(() => {
      const fill = document.getElementById("kwRateFill");
      fill.style.width = pct + "%";
      fill.style.background = pct >= 70 ? "linear-gradient(90deg,#10b981,#34d399)" : pct >= 40 ? "linear-gradient(90deg,#f59e0b,#fbbf24)" : "linear-gradient(90deg,#ef4444,#f87171)";
    }, 150);

    document.getElementById("matchedTags").innerHTML = matched.length
      ? matched.map(k => `<span class="tag tag-matched">${k}</span>`).join("")
      : `<span class="no-keywords">None matched</span>`;

    const panel = document.getElementById("missingPanel");
    if (missing.length) {
      document.getElementById("missingTags").innerHTML = missing.map(k => `<span class="tag tag-missing">${k}</span>`).join("");
      panel.style.display = "block";
    } else { panel.style.display = "none"; }

    kwCard.style.display = "block";
  }

  /* ─────────────── BULK MODE ─────────────── */
  const bulkDropZone     = document.getElementById("bulkDropZone");
  const bulkFileInput    = document.getElementById("bulkFileInput");
  const bulkFileSelected = document.getElementById("bulkFileSelected");
  const bulkFileNameEl   = document.getElementById("bulkFileName");
  const bulkFileSizeEl   = document.getElementById("bulkFileSize");
  const bulkRemoveFile   = document.getElementById("bulkRemoveFile");
  const bulkAnalyzeBtn   = document.getElementById("bulkAnalyzeBtn");
  const bulkErrorMsg     = document.getElementById("bulkErrorMsg");
  const bulkResults      = document.getElementById("bulkResults");
  const bulkResetBtn     = document.getElementById("bulkResetBtn");
  const addJobBtn        = document.getElementById("addJobBtn");
  const jobsList         = document.getElementById("jobsList");
  const jobsEmpty        = document.getElementById("jobsEmpty");
  const jobCountBadge    = document.getElementById("jobCountBadge");

  let bulkFile = null;
  let jobItems = [];   // [{ id, titleEl, descEl }]
  let jobIdSeq = 0;

  // Bulk file drop
  bulkDropZone.addEventListener("click", () => bulkFileInput.click());
  ["dragenter", "dragover"].forEach(ev => bulkDropZone.addEventListener(ev, e => { e.preventDefault(); bulkDropZone.classList.add("dragover"); }));
  ["dragleave", "drop"].forEach(ev => bulkDropZone.addEventListener(ev, () => bulkDropZone.classList.remove("dragover")));
  bulkDropZone.addEventListener("drop", e => { e.preventDefault(); if (e.dataTransfer.files[0]) handleBulkFile(e.dataTransfer.files[0]); });
  bulkFileInput.addEventListener("change", () => { if (bulkFileInput.files[0]) handleBulkFile(bulkFileInput.files[0]); });
  bulkRemoveFile.addEventListener("click", clearBulkFile);

  function handleBulkFile(file) {
    if (!isValidFile(file, msg => { bulkErrorMsg.textContent = msg; bulkErrorMsg.style.display = "block"; })) return;
    bulkFile = file;
    bulkErrorMsg.style.display = "none";
    bulkFileNameEl.textContent = file.name;
    bulkFileSizeEl.textContent = formatBytes(file.size);
    bulkDropZone.style.display = "none";
    bulkFileSelected.style.display = "flex";
    updateBulkBtn();
  }

  function clearBulkFile() {
    bulkFile = null; bulkFileInput.value = "";
    bulkDropZone.style.display = "block"; bulkFileSelected.style.display = "none";
    bulkErrorMsg.style.display = "none"; updateBulkBtn();
  }

  // Add / remove jobs
  addJobBtn.addEventListener("click", () => addJobItem());

  function addJobItem() {
    const id  = ++jobIdSeq;
    const div = document.createElement("div");
    div.className = "job-item";
    div.dataset.id = id;
    div.innerHTML = `
      <div class="job-item-hdr">
        <span class="job-item-num">Job #${jobItems.length + 1}</span>
        <button class="job-item-remove" data-id="${id}">Remove</button>
      </div>
      <input type="text" placeholder="Job title, e.g. Marketing Manager..." />
      <textarea rows="3" placeholder="Job description (optional) — paste for keyword matching & tailoring tips..."></textarea>`;

    div.querySelector(".job-item-remove").addEventListener("click", () => removeJobItem(id));
    jobsList.appendChild(div);
    jobItems.push({ id, el: div, titleEl: div.querySelector("input"), descEl: div.querySelector("textarea") });

    jobsEmpty.style.display = "none";
    renumberJobs();
    updateBulkBtn();
  }

  function removeJobItem(id) {
    const idx = jobItems.findIndex(j => j.id === id);
    if (idx === -1) return;
    jobItems[idx].el.remove();
    jobItems.splice(idx, 1);
    if (!jobItems.length) jobsEmpty.style.display = "flex";
    renumberJobs();
    updateBulkBtn();
  }

  function renumberJobs() {
    jobItems.forEach((j, i) => { j.el.querySelector(".job-item-num").textContent = `Job #${i + 1}`; });
    jobCountBadge.textContent = jobItems.length + " added";
  }

  function updateBulkBtn() {
    bulkAnalyzeBtn.disabled = !bulkFile || jobItems.length === 0;
  }

  // Bulk analyze
  bulkAnalyzeBtn.addEventListener("click", async () => {
    if (!bulkFile || !jobItems.length) return;

    const jobs = jobItems.map(j => ({
      title:       j.titleEl.value.trim() || j.descEl.value.trim().substring(0, 40) || "Untitled Job",
      description: j.descEl.value.trim(),
    }));

    if (!jobs.length) {
      bulkErrorMsg.textContent = "Please add at least one job.";
      bulkErrorMsg.style.display = "block"; return;
    }

    const btnText   = bulkAnalyzeBtn.querySelector(".btn-text");
    const btnLoader = bulkAnalyzeBtn.querySelector(".btn-loader");
    btnText.style.display = "none"; btnLoader.style.display = "flex"; bulkAnalyzeBtn.disabled = true;
    bulkErrorMsg.style.display = "none";

    const fd = new FormData();
    fd.append("cv", bulkFile);
    fd.append("jobs", JSON.stringify(jobs));

    try {
      const res  = await fetch("/api/bulk-analyze", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok || !data.success) { bulkErrorMsg.textContent = data.error || "Analysis failed."; bulkErrorMsg.style.display = "block"; return; }
      renderBulkResults(data);
    } catch { bulkErrorMsg.textContent = "Network error — is the server running?"; bulkErrorMsg.style.display = "block"; }
    finally  { btnText.style.display = ""; btnLoader.style.display = "none"; bulkAnalyzeBtn.disabled = false; }
  });

  bulkResetBtn.addEventListener("click", () => {
    bulkResults.style.display = "none";
    landingContent.style.display = "block";
    clearBulkFile();
    jobItems.forEach(j => j.el.remove());
    jobItems = []; jobIdSeq = 0;
    jobsEmpty.style.display = "flex";
    jobCountBadge.textContent = "0 added";
    updateBulkBtn();
    switchMode("bulk");
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  /* ── Bulk Results Renderer ── */
  function renderBulkResults(data) {
    landingContent.style.display = "none";
    bulkResults.style.display = "block";
    window.scrollTo({ top: 0, behavior: "smooth" });

    const r = data.results;
    document.getElementById("bulkSummaryText").textContent = `${r.length} job${r.length > 1 ? "s" : ""} analyzed for ${data.filename}`;
    document.getElementById("jobsAnalyzed").textContent    = r.length;

    const scoredFits = r.map(j => j.jobFitScore).filter(f => f !== null);
    document.getElementById("bestFitPct").textContent = scoredFits.length ? Math.max(...scoredFits) + "%" : "N/A";
    document.getElementById("avgFitPct").textContent  = scoredFits.length ? Math.round(scoredFits.reduce((a, b) => a + b, 0) / scoredFits.length) + "%" : "N/A";

    const container = document.getElementById("bulkJobCards");
    container.innerHTML = "";

    r.forEach((job, idx) => {
      const rank     = idx + 1;
      const hasFit   = job.jobFitScore !== null;
      const kTotal   = job.matchedKeywords.length + job.missingKeywords.length;
      const kPct     = kTotal > 0 ? Math.round((job.matchedKeywords.length / kTotal) * 100) : 0;
      const detailId = `bjd-${idx}`;

      const card = document.createElement("div");
      card.className = "r-card bulk-job-card";
      card.innerHTML = `
        <div class="bjc-rank-col ${rank === 1 && hasFit ? "rank-1" : ""}">
          <span class="rank-num">#${rank}</span>
          ${rank === 1 && hasFit ? '<span class="best-badge">Best</span>' : ""}
        </div>
        <div class="bjc-body">
          <div class="bjc-top">
            <div class="bjc-title-area">
              <h3>${escHtml(job.jobTitle)}</h3>
              <span class="bjc-assessment ${badgeClass(job.totalScore)}">${job.overallAssessment}</span>
            </div>
            <div class="bjc-scores">
              <div class="bjc-fit-score">
                <span class="fit-pct ${hasFit ? fitClass(job.jobFitScore) : "na"}">${hasFit ? job.jobFitScore + "%" : "N/A"}</span>
                <span>Job Fit</span>
              </div>
              <div class="scores-divider"></div>
              <div class="bjc-cv-score">
                <span class="cv-score-num">${job.totalScore}</span>
                <span>CV Score</span>
              </div>
            </div>
          </div>
          ${hasFit ? `<div class="bjc-kw-row">
            <span class="bjc-kw-text">${job.matchedKeywords.length}/${kTotal} keywords matched</span>
            <div class="progress-bar bjc-bar"><div class="progress-fill ${fitClass(kPct)}" style="width:${kPct}%"></div></div>
          </div>` : `<p class="bjc-no-jd">No job description provided — showing general CV score only</p>`}
          <button class="bjc-expand" data-detail="${detailId}">
            Show Details <span class="expand-arrow">↓</span>
          </button>
          <div class="bjc-details" id="${detailId}" style="display:none">
            ${job.tailoringTips && job.tailoringTips.length ? `
              <div>
                <h4>Tailoring Tips</h4>
                <ul class="bjc-detail-tips">${job.tailoringTips.map(t => `<li>${t}</li>`).join("")}</ul>
              </div>` : ""}
            ${job.missingKeywords.length ? `
              <div>
                <h4>Missing Keywords</h4>
                <div class="tags">${job.missingKeywords.map(k => `<span class="tag tag-missing">${escHtml(k)}</span>`).join("")}</div>
              </div>` : ""}
            ${job.matchedKeywords.length ? `
              <div>
                <h4>Matched Keywords</h4>
                <div class="tags">${job.matchedKeywords.map(k => `<span class="tag tag-matched">${escHtml(k)}</span>`).join("")}</div>
              </div>` : ""}
          </div>
        </div>`;

      card.querySelector(".bjc-expand").addEventListener("click", function () {
        const detail = document.getElementById(this.dataset.detail);
        const arrow  = this.querySelector(".expand-arrow");
        const open   = detail.style.display !== "none";
        detail.style.display = open ? "none" : "block";
        this.textContent = "";
        this.innerHTML   = (open ? "Show Details" : "Hide Details") + ' <span class="expand-arrow' + (open ? "" : " open") + '">↓</span>';
      });

      container.appendChild(card);
    });
  }

  function escHtml(str) {
    return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

})();
