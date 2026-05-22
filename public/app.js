(function () {
  const dropZone = document.getElementById("dropZone");
  const fileInput = document.getElementById("fileInput");
  const fileSelected = document.getElementById("fileSelected");
  const fileName = document.getElementById("fileName");
  const fileSize = document.getElementById("fileSize");
  const removeFile = document.getElementById("removeFile");
  const analyzeBtn = document.getElementById("analyzeBtn");
  const errorMsg = document.getElementById("errorMsg");
  const results = document.getElementById("results");
  const uploadSection = document.getElementById("uploadSection");
  const landingContent = document.getElementById("landingContent");
  const resetBtn = document.getElementById("resetBtn");
  const keywords = document.getElementById("keywords");

  let selectedFile = null;

  // Drop zone click
  dropZone.addEventListener("click", () => fileInput.click());

  // Drag events
  ["dragenter", "dragover"].forEach((ev) => {
    dropZone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropZone.classList.add("dragover");
    });
  });
  ["dragleave", "drop"].forEach((ev) => {
    dropZone.addEventListener(ev, () => dropZone.classList.remove("dragover"));
  });

  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files.length > 0) handleFile(files[0]);
  });

  fileInput.addEventListener("change", () => {
    if (fileInput.files.length > 0) handleFile(fileInput.files[0]);
  });

  removeFile.addEventListener("click", clearFile);

  function handleFile(file) {
    const allowed = ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
    const ext = file.name.split(".").pop().toLowerCase();

    if (!allowed.includes(file.type) && !["pdf", "docx"].includes(ext)) {
      showError("Only PDF and DOCX files are supported.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      showError("File size must be under 10MB.");
      return;
    }

    selectedFile = file;
    hideError();
    fileName.textContent = file.name;
    fileSize.textContent = formatBytes(file.size);
    dropZone.style.display = "none";
    fileSelected.style.display = "flex";
    analyzeBtn.disabled = false;
  }

  function clearFile() {
    selectedFile = null;
    fileInput.value = "";
    dropZone.style.display = "block";
    fileSelected.style.display = "none";
    analyzeBtn.disabled = true;
    hideError();
  }

  analyzeBtn.addEventListener("click", async () => {
    if (!selectedFile) return;

    const btnText = analyzeBtn.querySelector(".btn-text");
    const btnLoader = analyzeBtn.querySelector(".btn-loader");
    btnText.style.display = "none";
    btnLoader.style.display = "flex";
    analyzeBtn.disabled = true;
    hideError();

    const formData = new FormData();
    formData.append("cv", selectedFile);

    const kwValue = keywords.value.trim();
    if (kwValue) formData.append("keywords", kwValue);

    try {
      const res = await fetch("/api/analyze", { method: "POST", body: formData });
      const data = await res.json();

      if (!res.ok || !data.success) {
        showError(data.error || "Analysis failed. Please try again.");
        return;
      }

      renderResults(data);
    } catch (e) {
      showError("Network error. Is the server running?");
    } finally {
      btnText.style.display = "";
      btnLoader.style.display = "none";
      analyzeBtn.disabled = false;
    }
  });

  resetBtn.addEventListener("click", () => {
    results.style.display = "none";
    landingContent.style.display = "block";
    clearFile();
    keywords.value = "";
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  function renderResults(data) {
    landingContent.style.display = "none";
    results.style.display = "block";
    window.scrollTo({ top: 0, behavior: "smooth" });

    // Score ring animation
    const circle = document.getElementById("scoreCircle");
    const circumference = 427;
    const offset = circumference - (data.totalScore / 100) * circumference;
    const scoreEl = document.getElementById("scoreNumber");

    // Color ring by score
    if (data.totalScore >= 80) circle.style.stroke = "#22c55e";
    else if (data.totalScore >= 65) circle.style.stroke = "#6366f1";
    else if (data.totalScore >= 45) circle.style.stroke = "#f59e0b";
    else circle.style.stroke = "#ef4444";

    setTimeout(() => {
      circle.style.strokeDashoffset = offset;
      animateNumber(scoreEl, 0, data.totalScore, 1200);
    }, 100);

    // Assessment badge
    const badge = document.getElementById("assessmentBadge");
    badge.textContent = data.overallAssessment;
    badge.className = "assessment-badge";
    if (data.totalScore >= 80) badge.classList.add("badge-excellent");
    else if (data.totalScore >= 65) badge.classList.add("badge-good");
    else if (data.totalScore >= 45) badge.classList.add("badge-fair");
    else badge.classList.add("badge-needs");

    document.getElementById("cvFilename").textContent = data.filename;
    document.getElementById("wordCountText").textContent = `${data.wordCount} words extracted`;

    // Categories
    const catConfig = [
      { key: "contact",     label: "Contact Information",  max: 15 },
      { key: "summary",     label: "Summary / Objective",  max: 10 },
      { key: "experience",  label: "Work Experience",       max: 25 },
      { key: "education",   label: "Education",             max: 15 },
      { key: "skills",      label: "Skills",                max: 15 },
      { key: "formatting",  label: "Length & Formatting",   max: 10 },
      { key: "keywords",    label: "Keyword Match",         max: 10 },
    ];

    const catContainer = document.getElementById("categories");
    catContainer.innerHTML = "";
    catConfig.forEach(({ key, label, max }) => {
      const score = data.scores[key] || 0;
      const pct = Math.round((score / max) * 100);
      const fillClass = pct >= 70 ? "high" : pct >= 40 ? "mid" : "low";
      catContainer.innerHTML += `
        <div class="category-item">
          <div class="cat-header">
            <span class="cat-name">${label}</span>
            <span class="cat-score">${score}/${max}</span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill ${fillClass}" data-pct="${pct}" style="width:0%"></div>
          </div>
        </div>`;
    });

    // Animate progress bars
    setTimeout(() => {
      document.querySelectorAll(".progress-fill").forEach((bar) => {
        bar.style.width = bar.dataset.pct + "%";
      });
    }, 150);

    // Strengths
    const strengthsCard = document.getElementById("strengthsCard");
    const strengthsList = document.getElementById("strengthsList");
    if (data.strengths && data.strengths.length > 0) {
      strengthsList.innerHTML = data.strengths.map((s) => `<li>${s}</li>`).join("");
      strengthsCard.style.display = "block";
    } else {
      strengthsCard.style.display = "none";
    }

    // Suggestions
    const sugCard = document.getElementById("suggestionsCard");
    const sugList = document.getElementById("suggestionsList");
    if (data.suggestions && data.suggestions.length > 0) {
      sugList.innerHTML = data.suggestions.map((s) => `<li>${s}</li>`).join("");
      sugCard.style.display = "block";
    } else {
      sugCard.style.display = "none";
    }

    // Keywords
    const kwCard = document.getElementById("keywordsCard");
    const hasMatched = data.matchedKeywords && data.matchedKeywords.length > 0;
    const hasMissing = data.missingKeywords && data.missingKeywords.length > 0;

    if (hasMatched || hasMissing) {
      const matched = data.matchedKeywords || [];
      const missing = data.missingKeywords || [];
      const total = matched.length + missing.length;
      const pct = total > 0 ? Math.round((matched.length / total) * 100) : 0;

      // Summary bar
      document.getElementById("kwMatchCount").textContent = matched.length;
      document.getElementById("kwTotalCount").textContent = total;
      document.getElementById("kwPctBadge").textContent = pct + "%";
      document.getElementById("kwPctBadge").style.background =
        pct >= 70 ? "#10b981" : pct >= 40 ? "#f59e0b" : "#ef4444";
      setTimeout(() => {
        document.getElementById("kwRateFill").style.width = pct + "%";
        document.getElementById("kwRateFill").style.background =
          pct >= 70 ? "linear-gradient(90deg,#10b981,#34d399)"
          : pct >= 40 ? "linear-gradient(90deg,#f59e0b,#fbbf24)"
          : "linear-gradient(90deg,#ef4444,#f87171)";
      }, 150);

      // Matched tags
      const matchedTags = document.getElementById("matchedTags");
      matchedTags.innerHTML = matched.length > 0
        ? matched.map((k) => `<span class="tag tag-matched">${k}</span>`).join("")
        : `<span class="no-keywords">None matched</span>`;

      // Missing panel
      const missingPanel = document.getElementById("missingPanel");
      const missingTags = document.getElementById("missingTags");
      if (missing.length > 0) {
        missingTags.innerHTML = missing.map((k) => `<span class="tag tag-missing">${k}</span>`).join("");
        missingPanel.style.display = "block";
      } else {
        missingPanel.style.display = "none";
      }

      kwCard.style.display = "block";
    } else {
      kwCard.style.display = "none";
    }
  }

  function animateNumber(el, from, to, duration) {
    const start = performance.now();
    function update(now) {
      const t = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      el.textContent = Math.round(from + (to - from) * ease);
      if (t < 1) requestAnimationFrame(update);
    }
    requestAnimationFrame(update);
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  function showError(msg) {
    errorMsg.textContent = msg;
    errorMsg.style.display = "block";
  }

  function hideError() {
    errorMsg.style.display = "none";
  }
})();
