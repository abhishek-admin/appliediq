/**
 * emailTemplates.js
 *
 * Follow-up email generation — two modes:
 *   1. Static template (no API key required)
 *   2. Gemini-powered email (requires API key in settings)
 *
 * Email rules (from GEMINI.md — non-negotiable):
 *   - Subject: "Follow-up: [Job Title] Application – [Applicant Name]"
 *   - Body: under 120 words, no filler
 *   - Opening line: state role and date applied — nothing else
 *   - Value line: one specific, verifiable claim about relevant experience
 *   - Close: ask for status update OR next step — not both
 *   - Signature: Name + LinkedIn URL only
 *   - Tone: professional, confident, not desperate
 *   - No "I hope this email finds you well"
 *   - No "I know you're busy" or "just wanted to check in"
 *   - No bullet points
 *   - No apology for following up
 */

/**
 * Generate a static follow-up email from template.
 * @param {Object} params
 * @param {string} params.jobTitle
 * @param {string} params.company
 * @param {string} params.appliedDate  — ISO date string
 * @param {string} params.userName
 * @param {string} params.linkedinUrl
 * @param {string} [params.hiringManagerName]
 * @param {string} [params.currentRole]
 * @param {string} [params.yearsOfExperience]
 * @returns {{ subject: string, body: string }}
 */
function generateStaticEmail({
  jobTitle,
  company,
  appliedDate,
  userName,
  linkedinUrl,
  hiringManagerName,
  currentRole,
  yearsOfExperience,
}) {
  const dateStr = new Date(appliedDate).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  const addressee =
    hiringManagerName && hiringManagerName.trim()
      ? `Hi ${hiringManagerName.trim()},`
      : 'Hi Hiring Team,';

  const subject = `Follow-up: ${jobTitle} Application – ${userName}`;

  const experienceLine =
    yearsOfExperience && currentRole
      ? `I bring ${yearsOfExperience} years of experience as ${currentRole}, with hands-on expertise in test automation frameworks, CI/CD integration, and quality engineering at scale.`
      : `I bring demonstrated experience in test automation, API testing, and quality engineering at scale.`;

  const body = `${addressee}

I applied for the ${jobTitle} position at ${company} on ${dateStr} and wanted to follow up on my application status.

${experienceLine}

Could you let me know where things stand in the process?

${userName}
${linkedinUrl || ''}`.trim();

  return { subject, body };
}

/**
 * Generate a Gemini-powered follow-up email.
 * @param {Object} params — same as generateStaticEmail
 * @param {string} apiKey — Gemini API key
 * @returns {Promise<{ subject: string, body: string }>}
 */
async function generateGeminiEmail(params, apiKey, model) {
  const {
    jobTitle,
    company,
    appliedDate,
    userName,
    linkedinUrl,
    hiringManagerName,
    currentRole,
    yearsOfExperience,
    source,
    notes,
  } = params;

  const dateStr = new Date(appliedDate).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  const systemPrompt = `You are a seasoned recruiter and senior software engineer with 12+ years of combined experience across talent acquisition at product-based tech companies and hands-on software quality engineering.

You assist job applicants — specifically Senior SDETs and Quality Engineers — in generating follow-up emails.

Email rules — non-negotiable:
- Subject line format: "Follow-up: [Job Title] Application – [Applicant Name]"
- Body: under 120 words. No filler sentences. No "I hope this email finds you well."
- Opening line: State the role and date applied. Nothing else.
- Value line: One sentence. A specific, verifiable claim about the applicant's relevant experience. Not a generic claim.
- Close: Ask for a status update or next step. Not both.
- Signature: Name + LinkedIn URL. That's it.
- Tone: Professional. Confident. Not desperate. Not deferential.
- Do NOT use phrases like "I know you're busy" or "just wanted to check in"
- Do NOT apologize for following up
- Do NOT use bullet points
- If hiring manager name is unknown, address to "Hiring Team"

Return ONLY valid JSON in this exact format:
{"subject": "...", "body": "..."}`;

  const userPrompt = `Generate a follow-up email for this application:
- Job Title: ${jobTitle}
- Company: ${company}
- Applied Date: ${dateStr}
- Source: ${source || 'LinkedIn'}
- Applicant Name: ${userName}
- LinkedIn URL: ${linkedinUrl || ''}
- Current Role: ${currentRole || 'Senior SDET'}
- Years of Experience: ${yearsOfExperience || '5+'}
- Hiring Manager Name: ${hiringManagerName || 'unknown'}
- Notes: ${notes || 'none'}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model || 'gemini-2.5-flash-preview-04-17'}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 512,
          responseMimeType: 'application/json',
        },
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error: ${response.status} — ${err}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty response from Gemini');

  try {
    return JSON.parse(text);
  } catch {
    // Try to extract JSON from text if wrapped in markdown
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('Could not parse Gemini response as JSON');
  }
}

/**
 * Main entry: generate follow-up email, Gemini if API key available, else static.
 */
async function generateFollowUpEmail(params, apiKey, model) {
  if (apiKey && apiKey.trim()) {
    try {
      return await generateGeminiEmail(params, apiKey.trim(), model);
    } catch (err) {
      console.warn('Gemini email failed, falling back to static template:', err.message);
    }
  }
  return generateStaticEmail(params);
}
