require("dotenv").config();
const express = require("express");
const multer = require("multer");
const path = require("path");
const cors = require("cors");
const mammoth = require("mammoth");
const Anthropic = require("@anthropic-ai/sdk");
const { Document, Paragraph, TextRun, Packer, HeadingLevel, AlignmentType } = require("docx");
const PDFDocument = require("pdfkit");
const pdfParse = require("pdf-parse");

const app = express();
const PORT = process.env.PORT || 3000;
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const ALLOWED_MIME = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/zip",          // some browsers send this for .docx
  "application/octet-stream", // generic binary fallback
]);
const ALLOWED_EXT = new Set([".pdf", ".docx", ".doc"]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_MIME.has(file.mimetype) || ALLOWED_EXT.has(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF and DOCX files are allowed"));
    }
  },
});

function isPdf(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  return ext === ".pdf" || file.mimetype === "application/pdf";
}

async function extractText(file) {
  if (isPdf(file)) {
    const data = await pdfParse(file.buffer);
    return data.text;
  } else {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return result.value;
  }
}

const STOP_WORDS = new Set([
  "the","a","an","and","or","but","in","on","at","to","for","of","with","by","from","as","is","was",
  "are","were","be","been","being","have","has","had","do","does","did","will","would","could","should",
  "may","might","must","can","you","we","our","your","their","this","that","these","those","who","what",
  "which","when","where","how","why","all","any","each","every","both","few","more","most","other","some",
  "such","no","not","only","same","so","than","too","very","just","about","after","also","before","between",
  "come","day","even","first","give","good","here","high","into","its","know","like","look","make","new",
  "next","now","part","place","right","see","take","them","then","there","they","think","time","two","up",
  "use","want","well","work","year","him","his","her","she","he","it","us","me","my","i","job","position",
  "candidate","company","team","working","include","including","plus","years","experience","preferred",
  "required","requirements","responsibilities","ability","strong","excellent","must","able","knowledge",
  "opportunity","looking","seeking","join","help","support","ensure","provide","develop","manage","build",
  "create","design","implement","maintain","review","report","communicate","collaborate","responsible",
  "duties","tasks","role","following","please","apply","send","resume","cv","applications","employer",
  "letter","equal","considered","candidate","candidates","minimum","ideally","equivalent","etc","e.g","i.e"
]);

function extractJobKeywords(jobDesc) {
  const words = jobDesc.match(/\b[a-zA-Z][a-zA-Z0-9+#./]{1,}\b/g) || [];
  const freq = {};
  words.forEach((w) => {
    const lower = w.toLowerCase();
    if (!STOP_WORDS.has(lower) && lower.length > 2 && isNaN(lower)) {
      freq[lower] = (freq[lower] || 0) + 1;
    }
  });
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([word]) => word);
}

function generateTailoringTips(cvText, jobDesc, jobTitle) {
  const tips = [];
  const cvLower = cvText.toLowerCase();
  const jobLower = jobDesc.toLowerCase();

  // Job title in summary
  if (jobTitle) {
    const cvFirst600 = cvLower.substring(0, 600);
    if (!cvFirst600.includes(jobTitle.toLowerCase())) {
      tips.push(`Add "${jobTitle}" to your professional summary to immediately signal role alignment to recruiters and ATS`);
    }
  }

  // Years of experience requirement
  const expMatch = jobDesc.match(/(\d+)\+?\s*years?\s+(?:of\s+)?(?:experience|exp)/i);
  if (expMatch) {
    if (!/(\d+)\+?\s*years?\s+(?:of\s+)?(?:experience|exp)/i.test(cvText)) {
      tips.push(`The job requires ${expMatch[1]}+ years of experience — state your total years explicitly in your summary (e.g. "5+ years of experience in...")`);
    }
  }

  // Leadership / management
  if (/\b(lead|leadership|manage|manager|management|head|director|supervisor|oversee)\b/i.test(jobDesc) &&
      !/\b(led|lead|managed|supervised|oversaw|directed|headed)\b/i.test(cvText)) {
    tips.push("This role requires leadership — add concrete examples of leading teams, projects, or initiatives to your experience section");
  }

  // Remote work
  if (jobLower.includes("remote") && !cvLower.includes("remote")) {
    tips.push("This is a remote position — highlight experience working independently or managing your own schedule across time zones");
  }

  // Cross-functional collaboration
  if (/cross[\s-]?functional|stakeholder|collaboration/i.test(jobDesc) &&
      !/cross[\s-]?functional|stakeholder|collaborat/i.test(cvText)) {
    tips.push('The job emphasizes collaboration — add examples of cross-functional or stakeholder-facing projects to your experience');
  }

  // Communication skills
  if (jobLower.includes("communication") && !cvLower.includes("communication")) {
    tips.push('Add "strong communication skills" to your skills section — the job description specifically requires this');
  }

  // Degree requirement
  const degreeMatch = jobDesc.match(/\b(bachelor'?s?|master'?s?|phd|doctorate)\b/i);
  if (degreeMatch && !cvLower.includes(degreeMatch[1].toLowerCase())) {
    tips.push(`Ensure your Education section explicitly states your ${degreeMatch[1]} degree — the job posting lists this as a requirement`);
  }

  // Always include these practical tips
  tips.push("Reorder your Skills section to list the most job-relevant skills first — recruiters and ATS systems scan from the top");
  tips.push("Rewrite your summary using the job description's own language — this boosts ATS matching and shows you've read the role carefully");

  return tips.slice(0, 6);
}

function analyzeCV(text, jobKeywords) {
  const lowerText = text.toLowerCase();
  const scores = { contact: 0, summary: 0, experience: 0, education: 0, skills: 0, formatting: 0, keywords: 0 };
  const suggestions = [];

  // Contact (15 pts)
  if (/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(text)) scores.contact += 5;
  else suggestions.push("Add your email address to the contact section");

  if (/(\+?[\d][\d\s\-().]{8,})/.test(text)) scores.contact += 5;
  else suggestions.push("Add your phone number so recruiters can contact you");

  if (/linkedin\.com/i.test(text)) scores.contact += 5;
  else suggestions.push("Include your LinkedIn profile URL to strengthen your professional presence");

  // Summary (10 pts)
  if (["summary","objective","profile","about me","professional summary","career objective","overview"].some((kw) => lowerText.includes(kw))) {
    scores.summary = 10;
  } else {
    suggestions.push("Add a professional summary or objective at the top of your CV");
  }

  // Experience (25 pts)
  const hasExp = ["experience","employment","work history","career history","professional experience","work experience","positions held"].some((kw) => lowerText.includes(kw));
  if (hasExp) {
    scores.experience += 10;
    const verbCount = ["managed","led","developed","created","implemented","designed","improved","increased","reduced","built","launched","coordinated","achieved","delivered","executed","analyzed","collaborated","mentored","supervised","trained","spearheaded","optimized","automated","negotiated","generated"].filter((v) => lowerText.includes(v)).length;
    if (verbCount >= 5) scores.experience += 8;
    else if (verbCount >= 2) scores.experience += 4;
    else suggestions.push("Use strong action verbs (e.g., 'managed', 'developed', 'implemented') in your experience descriptions");

    if (/\d+\s*(%|percent|people|employees|team members|projects|years|months|clients|users|k|million|billion|\$)/i.test(text)) {
      scores.experience += 7;
    } else {
      suggestions.push("Quantify achievements with numbers (e.g., 'Increased revenue by 30%', 'Managed a team of 10')");
    }
  } else {
    suggestions.push("Add a Work Experience section with your professional history");
  }

  // Education (15 pts)
  if (["education","academic","degree","bachelor","master","phd","university","college","school","diploma","certificate","qualification"].some((kw) => lowerText.includes(kw))) {
    scores.education = 10;
    if (["bachelor","master","phd","b.sc","b.s.","m.sc","m.s.","mba","associate","honours","hnd","ond"].some((kw) => lowerText.includes(kw))) scores.education += 5;
    else suggestions.push("Specify your degree type (e.g., Bachelor's, Master's) in the Education section");
  } else {
    suggestions.push("Add an Education section with your academic qualifications");
  }

  // Skills (15 pts)
  if (["skills","competencies","technologies","tools","expertise","abilities","proficiencies"].some((kw) => lowerText.includes(kw))) {
    scores.skills = 10;
    const skillLines = text.split("\n").filter((line) => line.includes(",") || line.includes("|") || line.includes("•"));
    if (skillLines.length >= 2) scores.skills += 5;
    else suggestions.push("List more skills separated by commas or bullet points for better ATS readability");
  } else {
    suggestions.push("Add a dedicated Skills section listing your technical and soft skills");
  }

  // Formatting (10 pts)
  const wordCount = text.split(/\s+/).filter((w) => w.length > 0).length;
  if (wordCount >= 300 && wordCount <= 900) scores.formatting = 10;
  else if (wordCount >= 200) {
    scores.formatting = 6;
    if (wordCount < 300) suggestions.push("Your CV is brief — expand your experience descriptions for a stronger impression");
    if (wordCount > 900) suggestions.push("Consider condensing your CV to 1–2 pages for most roles");
  } else {
    scores.formatting = 2;
    suggestions.push("Your CV is very short — add more detail to your experience, skills, and education sections");
  }

  // Keywords (10 pts)
  let matchedKeywords = [], missingKeywords = [];
  if (jobKeywords && jobKeywords.length > 0) {
    const cleaned = jobKeywords.map((k) => k.trim()).filter((k) => k.length > 0);
    cleaned.forEach((kw) => {
      (lowerText.includes(kw.toLowerCase()) ? matchedKeywords : missingKeywords).push(kw);
    });
    scores.keywords = Math.round((matchedKeywords.length / cleaned.length) * 10);
    if (missingKeywords.length > 0) {
      suggestions.push(`Add these missing keywords: ${missingKeywords.slice(0, 5).join(", ")}`);
    }
  } else {
    scores.keywords = 5;
  }

  const totalScore = Math.min(Object.values(scores).reduce((a, b) => a + b, 0), 100);
  const overallAssessment = totalScore >= 80 ? "Excellent" : totalScore >= 65 ? "Good" : totalScore >= 45 ? "Fair" : "Needs Improvement";

  const strengths = [];
  if (scores.contact >= 10) strengths.push("Strong contact information");
  if (scores.experience >= 20) strengths.push("Well-described work experience");
  if (scores.education >= 15) strengths.push("Clear educational background");
  if (scores.skills >= 15) strengths.push("Comprehensive skills section");
  if (scores.keywords >= 8) strengths.push("Great keyword alignment with job description");

  return { totalScore, scores, suggestions, matchedKeywords, missingKeywords, wordCount, overallAssessment, strengths };
}

app.post("/api/analyze", upload.single("cv"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const jobTitle = (req.body.jobTitle || "").trim();
    const jobDescription = (req.body.jobDescription || "").trim();

    // Auto-extract keywords from job description, or fall back to manual keywords
    let jobKeywords = [];
    if (jobDescription) {
      jobKeywords = extractJobKeywords(jobDescription);
    } else if (req.body.keywords) {
      jobKeywords = req.body.keywords.split(",").map((k) => k.trim()).filter((k) => k);
    }

    const text = await extractText(req.file);
    if (!text || text.trim().length < 20) {
      return res.status(400).json({ error: "Could not extract readable text from the file. Ensure the file is not scanned/image-only." });
    }

    const analysis = analyzeCV(text, jobKeywords);

    let tailoringTips = [];
    let jobFitScore = null;
    if (jobDescription) {
      tailoringTips = generateTailoringTips(text, jobDescription, jobTitle);
      const total = analysis.matchedKeywords.length + analysis.missingKeywords.length;
      jobFitScore = total > 0 ? Math.round((analysis.matchedKeywords.length / total) * 100) : 0;
    }

    res.json({ success: true, filename: req.file.originalname, jobTitle, jobFitScore, tailoringTips, ...analysis });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to analyze CV" });
  }
});

app.post("/api/bulk-analyze", upload.single("cv"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    let jobs;
    try { jobs = JSON.parse(req.body.jobs || "[]"); } catch { return res.status(400).json({ error: "Invalid jobs data" }); }
    if (!jobs.length) return res.status(400).json({ error: "No jobs provided" });

    const text = await extractText(req.file);
    if (!text || text.trim().length < 20) return res.status(400).json({ error: "Could not extract readable text from the file." });

    const results = jobs.map((job, i) => {
      const jobDesc = (job.description || "").trim();
      const jobTitleStr = (job.title || `Job ${i + 1}`).trim();
      const keywords = jobDesc ? extractJobKeywords(jobDesc) : [];
      const analysis = analyzeCV(text, keywords);

      let tailoringTips = [], jobFitScore = null;
      if (jobDesc) {
        tailoringTips = generateTailoringTips(text, jobDesc, jobTitleStr);
        const total = analysis.matchedKeywords.length + analysis.missingKeywords.length;
        jobFitScore = total > 0 ? Math.round((analysis.matchedKeywords.length / total) * 100) : 0;
      }

      return { jobTitle: jobTitleStr, jobFitScore, totalScore: analysis.totalScore, scores: analysis.scores, matchedKeywords: analysis.matchedKeywords, missingKeywords: analysis.missingKeywords, suggestions: analysis.suggestions, strengths: analysis.strengths, tailoringTips, overallAssessment: analysis.overallAssessment };
    });

    results.sort((a, b) => b.jobFitScore - a.jobFitScore || b.totalScore - a.totalScore);
    res.json({ success: true, filename: req.file.originalname, results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to analyze" });
  }
});

app.post("/api/fix-cv", upload.single("cv"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === "your_api_key_here") {
      return res.status(503).json({ error: "AI fix is not configured. Add your ANTHROPIC_API_KEY to the .env file." });
    }

    const cvText = await extractText(req.file);
    if (!cvText || cvText.trim().length < 20) {
      return res.status(400).json({ error: "Could not extract readable text from the file." });
    }

    const jobTitle = (req.body.jobTitle || "").trim();
    const jobDescription = (req.body.jobDescription || "").trim();

    const jobContext = jobTitle || jobDescription
      ? `\n\nTARGET ROLE:\nJob Title: ${jobTitle || "Not specified"}\n${jobDescription ? `Job Description:\n${jobDescription}` : ""}\n\nImportant: Tailor the Professional Summary directly to this role. Weave in the job title and key requirements from the job description. Mirror the language used in the job posting throughout the CV.`
      : "";

    const prompt = `You are an expert CV/resume writer. Rewrite the CV below into a polished, professional version that will impress recruiters and pass ATS screening.

Rules:
- Write a strong Professional Summary (3–4 sentences) that clearly positions the person for this role, using the job title and key requirements
- EXPERIENCE SECTION — this is critical: expand every job entry with 4–6 strong bullet points. If the original has thin or vague bullets, generate realistic, detailed achievement-based bullets based on the person's job title, company, and industry. Use metrics and outcomes (e.g. "Increased team efficiency by 25% by implementing a new workflow system")
- Use strong action verbs: Led, Developed, Delivered, Optimised, Spearheaded, Implemented, Reduced, Grew, Managed, Designed, etc.
- SKILLS section: list both technical and soft skills relevant to the role
- Organise into sections: CONTACT INFORMATION | PROFESSIONAL SUMMARY | WORK EXPERIENCE | EDUCATION | SKILLS
- Use ALL CAPS for section headers
- Remove filler phrases: "responsible for", "duties included", "assisted with", "helped"
- Do NOT invent new jobs, companies, or qualifications — only expand what already exists
- Aim for 550–800 words total${jobContext}

Original CV:
${cvText}

Return ONLY the rewritten CV text with clear section headers. No explanation, no commentary, plain text only.`;

    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });

    const fixedCV = message.content[0].text;
    res.json({ success: true, fixedCV });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to fix CV" });
  }
});

function parseCvLines(text) {
  return text.split("\n").map(line => {
    const t = line.trim();
    if (!t) return { type: "empty" };
    if (/^[A-Z][A-Z\s\/&|]{2,}$/.test(t)) return { type: "header", text: t };
    if (/^[•\-\*]\s+/.test(t)) return { type: "bullet", text: t.replace(/^[•\-\*]\s+/, "") };
    return { type: "text", text: t };
  });
}

app.post("/api/download-cv", express.json({ limit: "2mb" }), async (req, res) => {
  try {
    const { text, format } = req.body;
    if (!text) return res.status(400).json({ error: "No CV text provided" });

    const lines = parseCvLines(text);

    if (format === "docx") {
      const children = lines.map(l => {
        if (l.type === "empty") return new Paragraph({ text: "" });
        if (l.type === "header") return new Paragraph({
          children: [new TextRun({ text: l.text, bold: true, size: 28, color: "4338CA" })],
          spacing: { before: 280, after: 80 },
          border: { bottom: { color: "C7D2FE", size: 6, space: 4, style: "single" } },
        });
        if (l.type === "bullet") return new Paragraph({
          children: [new TextRun({ text: l.text, size: 22 })],
          bullet: { level: 0 },
          spacing: { after: 40 },
        });
        return new Paragraph({
          children: [new TextRun({ text: l.text, size: 22 })],
          spacing: { after: 40 },
        });
      });

      const doc = new Document({
        styles: { default: { document: { run: { font: "Calibri" } } } },
        sections: [{ properties: { page: { margin: { top: 720, bottom: 720, left: 900, right: 900 } } }, children }],
      });
      const buf = await Packer.toBuffer(doc);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", "attachment; filename=\"improved-cv.docx\"");
      res.send(buf);

    } else if (format === "pdf") {
      const doc = new PDFDocument({ margin: 55, size: "A4" });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", "attachment; filename=\"improved-cv.pdf\"");
      doc.pipe(res);

      let firstHeader = true;
      for (const l of lines) {
        if (l.type === "empty") { doc.moveDown(0.4); continue; }
        if (l.type === "header") {
          if (!firstHeader) doc.moveDown(0.6);
          firstHeader = false;
          doc.font("Helvetica-Bold").fontSize(12).fillColor("#4338CA").text(l.text.toUpperCase());
          doc.moveTo(doc.page.margins.left, doc.y + 2)
             .lineTo(doc.page.width - doc.page.margins.right, doc.y + 2)
             .strokeColor("#C7D2FE").lineWidth(1).stroke();
          doc.moveDown(0.3);
          doc.fillColor("#000000");
        } else if (l.type === "bullet") {
          doc.font("Helvetica").fontSize(10).text(`• ${l.text}`, { indent: 12, lineGap: 2 });
        } else {
          doc.font("Helvetica").fontSize(10).fillColor("#111827").text(l.text, { lineGap: 2 });
        }
      }
      doc.end();
    } else {
      res.status(400).json({ error: "Invalid format. Use docx or pdf." });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Download failed" });
  }
});

app.listen(PORT, () => console.log(`CV Analyzer running on http://localhost:${PORT}`));
