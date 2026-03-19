/**
 * Collects in-game feedback and bug reports.
 *
 * POST /api/feedback
 * Body: {
 *   type: 'bug' | 'idea' | 'other',
 *   message: string,
 *   contact?: string,
 *   context?: string,
 *   url?: string,
 *   path?: string,
 *   puzzleId?: string,
 *   roomId?: string,
 *   screen?: string,
 *   userAgent?: string
 * }
 *
 * Stores under: feedback/{autoId}
 */

function fbPost(path, value) {
  const { FIREBASE_DB_URL: url, FIREBASE_DB_SECRET: s } = process.env;
  if (!url || !s) {
    throw new Error('Missing Firebase env vars');
  }
  return fetch(`${url}/${path}.json?auth=${s}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
}

function fbPatch(path, value) {
  const { FIREBASE_DB_URL: url, FIREBASE_DB_SECRET: s } = process.env;
  if (!url || !s) {
    throw new Error('Missing Firebase env vars');
  }
  return fetch(`${url}/${path}.json?auth=${s}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
}

function safeStr(str) {
  return String(str || '');
}

function hasAny(text, keywords) {
  const t = (text || '').toLowerCase();
  return keywords.some(k => t.includes(k));
}

function triageBugReport(report, mode) {
  // Heuristic classifier (we can never truly reproduce here), tuned for "aggressive" PR/issue creation.
  const text = `${report.type || ''} ${report.message || ''} ${report.context || ''}`.toLowerCase();

  const bugWords = ['bug', 'broken', 'error', 'crash', 'stuck', 'freeze', "doesn't", "cant", 'cannot', 'wrong'];
  const ideaWords = ['idea', 'suggest', 'feature', 'would be nice', 'please add', 'improve', 'feedback'];
  const highWords = ['crash', 'cannot', "can't", 'blocked', 'data loss', 'payment', 'security', 'login fail'];
  const mediumWords = ['lag', 'slow', 'ui glitch', 'misaligned', 'hard to use', 'confusing'];
  const lowWords = ['typo', 'copy', 'text', 'small', 'minor', 'polish'];

  let decision = 'not_actionable';
  if ((report.type || '').toLowerCase() === 'bug' || hasAny(text, bugWords)) decision = 'bug';
  else if (hasAny(text, ideaWords)) decision = 'idea';

  let severity = 'low';
  if (hasAny(text, highWords)) severity = 'high';
  else if (hasAny(text, mediumWords)) severity = 'medium';
  else if (hasAny(text, lowWords)) severity = 'low';
  if (decision === 'idea') severity = 'low';
  if (decision === 'not_actionable') severity = 'low';

  const hasReproSteps = hasAny(text, ['steps', 'to reproduce', 'repro', 'expected', 'should happen', 'instead of']);
  const hasSpecifics = Boolean(report?.meta?.puzzleId || report?.meta?.roomId || report?.screen || report?.context);
  const hasConcreteErrors = hasAny(text, bugWords) || hasAny(text, ['not working', 'broken', 'doesnt work', 'fails']);
  const hasLength = safeStr(report?.message || '').trim().length >= 60;
  const hasUncertainty = hasAny(text, ['not sure', 'maybe', 'i think', 'seems', 'probably']);

  const aggressive = mode === 'aggressive';
  const tuning = aggressive
    ? { base: 0.25, decisionBug: 0.35, repro: 0.35, specifics: 0.2, errors: 0.25, len: 0.15, uncertainty: 0.05 }
    : { base: 0.2, decisionBug: 0.25, repro: 0.25, specifics: 0.15, errors: 0.2, len: 0.1, uncertainty: 0.1 };

  let confidence = tuning.base;
  if (decision === 'bug') confidence += tuning.decisionBug;
  if (hasReproSteps) confidence += tuning.repro;
  if (hasSpecifics) confidence += tuning.specifics;
  if (hasConcreteErrors) confidence += tuning.errors;
  if (hasLength) confidence += tuning.len;
  if (hasUncertainty) confidence -= tuning.uncertainty;
  confidence = Math.max(0, Math.min(1, confidence));

  const autoFixCandidate = decision === 'bug' && confidence >= (aggressive ? 0.45 : 0.55) && (severity === 'low' || severity === 'medium');

  // Confirmation buckets (proxy for "comfortable creating PR")
  let confirmationBucket = 'unconfirmed';
  if (decision === 'bug' && confidence >= (aggressive ? 0.55 : 0.7)) confirmationBucket = 'likely_confirmed';
  else if (decision === 'bug' && confidence >= (aggressive ? 0.35 : 0.45)) confirmationBucket = 'needs_more_info';
  else if (decision === 'bug') confirmationBucket = 'not_actionable';

  const screen = report?.meta?.screen || report?.screen || 'unknown';
  const path = report?.meta?.path || report?.path || 'unknown';

  let decisionForTriage = decision;
  if (decision === 'bug') {
    if (confirmationBucket === 'likely_confirmed') decisionForTriage = 'bug';
    else if (confirmationBucket === 'needs_more_info') decisionForTriage = 'question';
    else decisionForTriage = 'not_actionable';
  }
  if (decision === 'idea') decisionForTriage = 'idea';

  let helpMessage = '';
  if (decision === 'idea') {
    helpMessage = 'Suggestion looks actionable. Consider UX/product improvement and add it to the roadmap.';
  } else if (decisionForTriage === 'not_actionable') {
    helpMessage = 'Not enough detail to be sure it is a bug. Request: exact steps, expected vs actual behavior, and whether it happens consistently.';
  } else if (decisionForTriage === 'question') {
    helpMessage = [
      'This *might* be a real bug, but the report lacks enough specifics to confidently identify the root cause.',
      'Please request:',
      '- 3-5 exact steps to reproduce',
      '- what the user expected vs what happened',
      '- whether it reproduces every time or intermittently',
      '- screenshot/screen recording if possible',
    ].join(' ');
  } else {
    helpMessage = 'High confidence this is a real bug based on the report contents. Please reproduce using the context and implement the fix.';
  }

  const notes = [
    `Confidence=${Math.round(confidence * 100)}% (${confirmationBucket}).`,
    `Screen=${screen} Path=${path}.`,
    helpMessage,
    autoFixCandidate ? 'Auto-fix candidate: start by checking UI/state flow for the reported screen.' : '',
  ].filter(Boolean).join(' ');

  return { decision: decisionForTriage, originalDecision: decision, severity, confidence, confirmationBucket, autoFixCandidate, notes };
}

function getGithubConfig() {
  const token = process.env.GITHUB_TOKEN || '';
  const repoSlug = process.env.GITHUB_REPO || ''; // "owner/name"
  if (!token || !repoSlug) return null;
  const [owner, repo] = repoSlug.split('/');
  if (!owner || !repo) return null;
  return {
    token,
    owner,
    repo,
    baseBranch: process.env.GITHUB_BASE_BRANCH || 'main',
  };
}

function getCursorConfig() {
  const apiKey = process.env.CURSOR_API_KEY || '';
  if (!apiKey) return null;
  return {
    apiKey,
    model: process.env.CURSOR_MODEL || 'default',
  };
}

async function githubRequest(cfg, method, endpoint, body) {
  const url = `https://api.github.com${endpoint}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github+json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GitHub ${method} ${endpoint} failed: ${res.status} ${text}`);
  }
  return res.json();
}

async function cursorLaunchAgentOnPR(cursorCfg, prUrl, promptText) {
  if (!cursorCfg) return null;

  const auth = Buffer.from(`${cursorCfg.apiKey}:`).toString('base64');

  const res = await fetch('https://api.cursor.com/v0/agents', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt: { text: promptText },
      model: cursorCfg.model,
      source: { prUrl },
      target: { autoCreatePr: false },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Cursor agent launch failed: ${res.status} ${text}`);
  }
  return res.json();
}

async function ensureBranch(cfg, branchName) {
  const refEndpoint = `/repos/${cfg.owner}/${cfg.repo}/git/ref/heads/${encodeURIComponent(branchName)}`;
  try {
    const existing = await githubRequest(cfg, 'GET', refEndpoint);
    return existing?.object?.sha || null;
  } catch {
    // fallthrough: create
  }

  const baseRef = await githubRequest(cfg, 'GET', `/repos/${cfg.owner}/${cfg.repo}/git/ref/heads/${cfg.baseBranch}`);
  const sha = baseRef?.object?.sha;
  if (!sha) throw new Error('Could not resolve base branch SHA');

  try {
    await githubRequest(cfg, 'POST', `/repos/${cfg.owner}/${cfg.repo}/git/refs`, {
      ref: `refs/heads/${branchName}`,
      sha,
    });
  } catch (err) {
    // Ignore "already exists" race.
    if (!String(err.message || '').includes('Reference already exists')) throw err;
  }
  return sha;
}

function encodeBase64(content) {
  return Buffer.from(String(content || ''), 'utf8').toString('base64');
}

function buildFixBriefMarkdown(feedbackId, report) {
  const title = safeStr(report?.message).slice(0, 120);
  return [
    `# Feedback Fix Brief`,
    ``,
    `- Feedback ID: \`${feedbackId}\``,
    `- Type: \`${report?.type || 'unknown'}\``,
    `- CreatedAt: \`${new Date(report?.createdAt || Date.now()).toISOString()}\``,
    `- Screen: \`${report?.meta?.screen || 'unknown'}\``,
    `- Puzzle ID: \`${report?.meta?.puzzleId || 'n/a'}\``,
    `- Room ID: \`${report?.meta?.roomId || 'n/a'}\``,
    `- URL: ${report?.meta?.url || 'n/a'}`,
    ``,
    `## User report`,
    `${safeStr(report?.message || '')}`,
    ``,
    `## Context`,
    `${safeStr(report?.context || 'n/a')}`,
    ``,
    `## Fix checklist`,
    `- [ ] Reproduce issue (confirm root cause)`,
    `- [ ] Implement fix`,
    `- [ ] Add/update tests where possible`,
    `- [ ] Verify on affected screens`,
    `- [ ] Close out related feedback`,
    ``,
    `---`,
    `Auto-seeded by \`Jigsaw Together\` feedback triage agent.`,
    ``,
    `## Suggested next steps`,
    `- Start by checking the reported screen UI/state flow.`,
    `- Compare expected vs actual behavior and inspect snapping/locks if relevant.`,
    `- Confirm any regression around the last known change.`,
    ``,
    `> Seed title: ${title}`,
  ].join('\n');
}

async function createGithubPR(cfg, feedbackId, report, triage) {
  const branchName = `feedback/${feedbackId.slice(0, 8)}-auto-fix`;
  await ensureBranch(cfg, branchName);

  const filePath = `docs/feedback-fixes/${feedbackId}.md`;
  const content = buildFixBriefMarkdown(feedbackId, report);

  const fileResp = await githubRequest(cfg, 'PUT', `/repos/${cfg.owner}/${cfg.repo}/contents/${filePath}`, {
    message: `Seed fix brief for feedback ${feedbackId}`,
    content: encodeBase64(content),
    branch: branchName,
  });

  const shortTitle = safeStr(report?.message || 'Bug report').slice(0, 72);
  const prTitle = `Investigate bug: ${shortTitle}`;

  const body = [
    `## Summary`,
    `- Seeded from feedback report \`${feedbackId}\``,
    `- Screen: \`${report?.meta?.screen || 'unknown'}\``,
    `- Confidence: ${Math.round(triage.confidence * 100)}% (${triage.confirmationBucket})`,
    ``,
    `## User report`,
    safeStr(report?.message || ''),
    ``,
    `## Context`,
    safeStr(report?.context || 'n/a'),
    ``,
    `## Agent notes`,
    safeStr(triage.notes || ''),
    ``,
    `---`,
    `This PR is a scaffold. Implementers should reproduce locally, then commit the actual fix.`,
  ].join('\n');

  const pr = await githubRequest(cfg, 'POST', `/repos/${cfg.owner}/${cfg.repo}/pulls`, {
    title: prTitle,
    head: branchName,
    base: cfg.baseBranch,
    body,
    draft: true,
  });

  return pr?.html_url || pr?.url || null;
}

async function createGithubIssue(cfg, feedbackId, report, triage) {
  const shortTitle = safeStr(report?.message || 'Bug report').slice(0, 72);
  const title = `Bug report needs confirmation: ${shortTitle}`;

  const body = [
    `## Feedback report`,
    `- Feedback ID: \`${feedbackId}\``,
    `- Type: \`${report?.type || 'unknown'}\``,
    `- Screen: \`${report?.meta?.screen || 'unknown'}\``,
    `- URL: ${report?.meta?.url || 'n/a'}`,
    ``,
    `### What the user said`,
    safeStr(report?.message || ''),
    ``,
    `### Context captured at submission`,
    safeStr(report?.context || 'n/a'),
    ``,
    `## Agent triage`,
    safeStr(triage.notes || ''),
    ``,
    `## Why no PR was opened`,
    `- The agent could not confidently identify the root cause from the submission alone.`,
    `- Please ask for missing repro steps if you can reproduce manually.`,
  ].join('\n');

  const issue = await githubRequest(cfg, 'POST', `/repos/${cfg.owner}/${cfg.repo}/issues`, {
    title,
    body,
  });

  return issue?.html_url || issue?.url || null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    type,
    message,
    contact,
    context,
    url,
    path,
    puzzleId,
    roomId,
    screen,
    userAgent,
  } = req.body || {};

  const trimmedMessage = (message || '').trim();
  const kind = (type || 'bug').toLowerCase();

  if (!trimmedMessage) {
    return res.status(400).json({ error: 'Message is required' });
  }

  const allowedTypes = new Set(['bug', 'idea', 'feedback', 'other']);
  const storedType = allowedTypes.has(kind) ? kind : 'other';

  const now = Date.now();

  try {
    const payload = {
      type: storedType,
      message: trimmedMessage,
      contact: (contact || '').trim() || null,
      context: (context || '').trim() || null,
      meta: {
        url: url || null,
        path: path || null,
        puzzleId: puzzleId || null,
        roomId: roomId || null,
        screen: screen || null,
        userAgent: userAgent || null,
      },
      createdAt: now,
    };

    const postRes = await fbPost('feedback', payload);
    const postData = await postRes.json().catch(() => ({}));
    const feedbackId = postData?.name;

    if (!feedbackId) {
      return res.status(201).json({ ok: true, id: null });
    }

    // Auto-triage + GitHub automation (Option 1: run immediately on submission)
    // Only triggers for bug submissions.
    const mode = process.env.FEEDBACK_AGENT_MODE || 'aggressive';
    if (storedType === 'bug') {
      const triage = triageBugReport({ ...payload, createdAt: now }, mode);
      const githubCfg = getGithubConfig();

      const triageWrite = {
        status: 'triaged',
        decision: triage.decision,
        severity: triage.severity,
        confidence: triage.confidence,
        confirmationBucket: triage.confirmationBucket,
        notes: triage.notes,
        agent: 'github-auto-triage',
        updatedAt: Date.now(),
      };

      // Best-effort: update triage in Firebase first (even if GitHub fails).
      await fbPatch(`feedback/${feedbackId}`, { triage: triageWrite });

      if (githubCfg) {
        try {
          const minConfidenceForAutomation = 0.25;
          if (triage.confidence < minConfidenceForAutomation) return res.status(201).json({ ok: true, id: feedbackId });

          const shouldOpenPR = triage.confirmationBucket === 'likely_confirmed';

          if (shouldOpenPR) {
            const prUrl = await createGithubPR(githubCfg, feedbackId, { ...payload, createdAt: now }, triage);

            // If Cursor is configured, ask it to implement the fix directly on this draft PR.
            const cursorCfg = getCursorConfig();
            if (cursorCfg) {
              try {
                const promptText = [
                  'You are a coding agent working in this repository.',
                  'Implement a fix for the bug described below.',
                  '',
                  'Bug report:',
                  safeStr(payload.message || ''),
                  '',
                  'Context:',
                  safeStr(payload.context || 'n/a'),
                  '',
                  `Feedback id: ${feedbackId}`,
                  `Screen: ${payload?.meta?.screen || 'unknown'}`,
                  `Path: ${payload?.meta?.path || 'unknown'}`,
                  '',
                  'Triage notes from the submission agent:',
                  safeStr(triage.notes || ''),
                  '',
                  'Requirements:',
                  '- Update code so the bug is fixed.',
                  '- Add or update tests if this repo has a relevant test harness (otherwise add a small sanity check where appropriate).',
                  '- Keep changes focused.',
                  '- Update docs/feedback-fixes/' + feedbackId + '.md with a short summary of what you changed and why.',
                ].join('\n');

                const agent = await cursorLaunchAgentOnPR(cursorCfg, prUrl, promptText);
                await fbPatch(`feedback/${feedbackId}`, {
                  triage: {
                    ...triageWrite,
                    github: { prUrl: prUrl || null, type: 'pr' },
                    cursor: { agentId: agent?.id || null, type: 'cursor-cloud-agent' },
                  },
                });
              } catch (err) {
                // Cursor is best-effort; keep the GitHub draft PR scaffold even if this fails.
                console.error('Cursor automation failed', err);
              }
            } else {
            await fbPatch(`feedback/${feedbackId}`, {
              triage: {
                ...triageWrite,
                github: { prUrl: prUrl || null, type: 'pr' },
              },
            });
            }
          } else {
            const issueUrl = await createGithubIssue(githubCfg, feedbackId, { ...payload, createdAt: now }, triage);
            await fbPatch(`feedback/${feedbackId}`, {
              triage: {
                ...triageWrite,
                github: { issueUrl: issueUrl || null, type: 'issue' },
              },
            });
          }
        } catch (err) {
          console.error('GitHub automation failed', err);
          // Don't fail the user submission because of GitHub.
        }
      }
    }

    return res.status(201).json({ ok: true, id: feedbackId });
  } catch (err) {
    console.error('Failed to write feedback', err);
    return res.status(500).json({ error: 'Failed to save feedback' });
  }
}

