const express = require("express");
const multer = require("multer");
const path = require("path");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword",
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF and DOCX files are allowed"));
    }
  },
});

async function extractText(file) {
  if (file.mimetype === "application/pdf") {
    const pdfParse = require("pdf-parse");
    const data = await pdfParse(file.buffer);
    return data.text;
  } else {
    const mammoth = require("mammoth");
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return result.value;
  }
}

function analyzeCV(text, jobKeywords) {
  const lowerText = text.toLowerCase();
  const scores = { contact: 0, summary: 0, experience: 0, education: 0, skills: 0, formatting: 0, keywords: 0 };
  const suggestions = [];

  // Contact Information (15 pts)
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
  const phoneRegex = /(\+?[\d][\d\s\-().]{8,})/;
  const linkedinRegex = /linkedin\.com/i;

  if (emailRegex.test(text)) scores.contact += 5;
  else suggestions.push("Add your email address to the contact section");

  if (phoneRegex.test(text)) scores.contact += 5;
  else suggestions.push("Add your phone number so recruiters can contact you");

  if (linkedinRegex.test(text)) scores.contact += 5;
  else suggestions.push("Include your LinkedIn profile URL to strengthen your professional presence");

  // Summary/Objective (10 pts)
  const summaryKws = ["summary", "objective", "profile", "about me", "professional summary", "career objective", "overview"];
  if (summaryKws.some((kw) => lowerText.includes(kw))) {
    scores.summary = 10;
  } else {
    suggestions.push("Add a professional summary or objective at the top of your CV");
  }

  // Work Experience (25 pts)
  const expKws = ["experience", "employment", "work history", "career history", "professional experience", "work experience", "positions held"];
  const hasExp = expKws.some((kw) => lowerText.includes(kw));

  if (hasExp) {
    scores.experience += 10;

    const actionVerbs = ["managed", "led", "developed", "created", "implemented", "designed", "improved", "increased", "reduced", "built", "launched", "coordinated", "achieved", "delivered", "executed", "analyzed", "collaborated", "mentored", "supervised", "trained", "spearheaded", "optimized", "automated", "negotiated", "generated"];
    const verbCount = actionVerbs.filter((v) => lowerText.includes(v)).length;

    if (verbCount >= 5) scores.experience += 8;
    else if (verbCount >= 2) scores.experience += 4;
    else suggestions.push("Use strong action verbs (e.g., 'managed', 'developed', 'implemented') in your experience descriptions");

    const quantRegex = /\d+\s*(%|percent|people|employees|team members|projects|years|months|clients|users|k|million|billion|\$)/i;
    if (quantRegex.test(text)) {
      scores.experience += 7;
    } else {
      suggestions.push("Quantify achievements with numbers (e.g., 'Increased revenue by 30%', 'Managed a team of 10')");
    }
  } else {
    suggestions.push("Add a Work Experience section with your professional history");
  }

  // Education (15 pts)
  const eduKws = ["education", "academic", "degree", "bachelor", "master", "phd", "university", "college", "school", "diploma", "certificate", "qualification"];
  const hasEdu = eduKws.some((kw) => lowerText.includes(kw));

  if (hasEdu) {
    scores.education = 10;
    const degreeKws = ["bachelor", "master", "phd", "b.sc", "b.s.", "m.sc", "m.s.", "mba", "associate", "honours", "hnd", "ond"];
    if (degreeKws.some((kw) => lowerText.includes(kw))) scores.education += 5;
    else suggestions.push("Specify your degree type (e.g., Bachelor's, Master's) in the Education section");
  } else {
    suggestions.push("Add an Education section with your academic qualifications");
  }

  // Skills (15 pts)
  const skillKws = ["skills", "competencies", "technologies", "tools", "expertise", "abilities", "proficiencies"];
  const hasSkills = skillKws.some((kw) => lowerText.includes(kw));

  if (hasSkills) {
    scores.skills = 10;
    const skillLines = text.split("\n").filter((line) => line.includes(",") || line.includes("|") || line.includes("•"));
    if (skillLines.length >= 2) scores.skills += 5;
    else suggestions.push("List more skills separated by commas or bullet points for better ATS readability");
  } else {
    suggestions.push("Add a dedicated Skills section listing your technical and soft skills");
  }

  // Formatting / Length (10 pts)
  const wordCount = text.split(/\s+/).filter((w) => w.length > 0).length;
  if (wordCount >= 300 && wordCount <= 900) {
    scores.formatting = 10;
  } else if (wordCount >= 200) {
    scores.formatting = 6;
    if (wordCount < 300) suggestions.push("Your CV is brief — expand your experience descriptions for a stronger impression");
    if (wordCount > 900) suggestions.push("Consider condensing your CV to 1–2 pages for most roles");
  } else {
    scores.formatting = 2;
    suggestions.push("Your CV is very short — add more detail to your experience, skills, and education sections");
  }

  // Keyword Matching (10 pts)
  let matchedKeywords = [];
  let missingKeywords = [];

  if (jobKeywords && jobKeywords.length > 0) {
    const cleanedKws = jobKeywords.map((k) => k.trim()).filter((k) => k.length > 0);
    cleanedKws.forEach((kw) => {
      if (lowerText.includes(kw.toLowerCase())) matchedKeywords.push(kw);
      else missingKeywords.push(kw);
    });

    const matchRate = cleanedKws.length > 0 ? matchedKeywords.length / cleanedKws.length : 0;
    scores.keywords = Math.round(matchRate * 10);

    if (missingKeywords.length > 0) {
      const topMissing = missingKeywords.slice(0, 5).join(", ");
      suggestions.push(`Add these missing keywords from the job description: ${topMissing}`);
    }
  } else {
    scores.keywords = 5;
  }

  const totalScore = Math.min(Object.values(scores).reduce((a, b) => a + b, 0), 100);
  const overallAssessment =
    totalScore >= 80 ? "Excellent" : totalScore >= 65 ? "Good" : totalScore >= 45 ? "Fair" : "Needs Improvement";

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

    const jobKeywords = req.body.keywords
      ? req.body.keywords.split(",").map((k) => k.trim()).filter((k) => k)
      : [];

    const text = await extractText(req.file);
    if (!text || text.trim().length < 20) {
      return res.status(400).json({ error: "Could not extract readable text from the file. Ensure the file is not scanned/image-only." });
    }

    const analysis = analyzeCV(text, jobKeywords);
    res.json({ success: true, filename: req.file.originalname, ...analysis });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to analyze CV" });
  }
});

app.listen(PORT, () => console.log(`CV Analyzer running on http://localhost:${PORT}`));
