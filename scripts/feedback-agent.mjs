#!/usr/bin/env node

/**
 * Feedback triage helper for Jigsaw Together.
 *
 * Commands:
 * - triage: fetch reports, classify, optionally write triage back
 * - seed-pr: create/push a branch with a fix brief, and open a draft PR
 *
 * Usage:
 *   node scripts/feedback-agent.mjs triage --limit 50 --dry-run
 *   node scripts/feedback-agent.mjs triage --limit 50 --apply --reviewer "cursor-agent"
 *   node scripts/feedback-agent.mjs seed-pr --id <feedbackId>
 */

import { execSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const BASE_URL = process.env.FEEDBACK_BASE_URL || 'http://localhost:3000';
const TOKEN = process.env.FEEDBACK_ADMIN_TOKEN || '';

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      out._.push(a);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function hasAny(text, keywords) {
  const t = (text || '').toLowerCase();
  return keywords.some(k => t.includes(k));
}

function classify(item) {
  const text = `${item.type || ''} ${item.message || ''} ${item.context || ''}`.toLowerCase();

  const bugWords = ['bug', 'broken', 'error', 'crash', 'stuck', 'freeze', 'doesn\'t', 'cant', 'cannot', 'wrong'];
  const ideaWords = ['idea', 'suggest', 'feature', 'would be nice', 'please add', 'improve'];
  const highWords = ['crash', 'cannot', 'can\'t', 'blocked', 'data loss', 'payment', 'security', 'login fail'];
  const mediumWords = ['lag', 'slow', 'ui glitch', 'misaligned', 'hard to use', 'confusing'];
  const lowWords = ['typo', 'copy', 'text', 'small', 'minor', 'polish'];

  let decision = 'not_actionable';
  if ((item.type || '').toLowerCase() === 'bug' || hasAny(text, bugWords)) decision = 'bug';
  else if (hasAny(text, ideaWords) || (item.type || '').toLowerCase() === 'idea' || (item.type || '').toLowerCase() === 'feedback') decision = 'idea';

  let severity = 'low';
  if (hasAny(text, highWords)) severity = 'high';
  else if (hasAny(text, mediumWords)) severity = 'medium';
  else if (hasAny(text, lowWords)) severity = 'low';
  if (decision === 'idea') severity = 'low';
  if (decision === 'not_actionable') severity = 'low';

  const autoFixCandidate = decision === 'bug' && (severity === 'low' || severity === 'medium');
  const notes = autoFixCandidate
    ? 'Likely reproducible bug. Start with UI/state flow around reported screen.'
    : decision === 'bug'
      ? 'Potential severe bug; needs manual reproduction and verification.'
      : decision === 'idea'
        ? 'Product suggestion; triage with roadmap.'
        : 'Not enough actionable detail.';

  return { decision, severity, autoFixCandidate, notes };
}

async function apiGet(pathname) {
  const headers = TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};
  const res = await fetch(`${BASE_URL}${pathname}`, { headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GET ${pathname} failed: ${res.status} ${text}`);
  }
  return res.json();
}

async function apiPost(pathname, payload) {
  const headers = {
    'Content-Type': 'application/json',
    ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
  };
  const res = await fetch(`${BASE_URL}${pathname}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`POST ${pathname} failed: ${res.status} ${text}`);
  }
  return res.json();
}

function safe(str) {
  return (str || '').replace(/[^\w\-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase();
}

function run(cmd) {
  return execSync(cmd, { stdio: 'pipe', encoding: 'utf8' }).trim();
}

async function cmdTriage(args) {
  const limit = Number(args.limit || 50);
  const apply = !!args.apply;
  const reviewer = String(args.reviewer || 'feedback-agent');

  const data = await apiGet(`/api/feedback-list?limit=${limit}`);
  const items = Array.isArray(data.items) ? data.items : [];

  const candidates = items.filter(i => !i?.triage?.status || i.triage.status === 'new');
  console.log(`Fetched ${items.length} feedback items, triaging ${candidates.length} new.`);

  let bugCount = 0;
  let ideaCount = 0;
  let autoFixCount = 0;

  for (const item of candidates) {
    const c = classify(item);
    if (c.decision === 'bug') bugCount++;
    if (c.decision === 'idea') ideaCount++;
    if (c.autoFixCandidate) autoFixCount++;

    const status = c.decision === 'not_actionable' ? 'ignored' : 'triaged';
    const note = `${c.notes} Screen=${item?.meta?.screen || 'unknown'} Path=${item?.meta?.path || 'unknown'}`;

    console.log(`- ${item.id} [${c.decision}/${c.severity}] autoFix=${c.autoFixCandidate ? 'yes' : 'no'}`);
    console.log(`  ${String(item.message || '').slice(0, 120)}`);

    if (apply) {
      await apiPost('/api/feedback-triage', {
        id: item.id,
        status,
        decision: c.decision,
        severity: c.severity,
        notes: note,
        reviewer,
      });
    }
  }

  console.log('');
  console.log(`Summary: bugs=${bugCount}, ideas=${ideaCount}, auto-fix-candidates=${autoFixCount}`);
  if (!apply) {
    console.log('Dry run only. Use --apply to persist triage decisions.');
  }
}

async function cmdSeedPr(args) {
  const id = String(args.id || '').trim();
  if (!id) throw new Error('--id is required');

  const data = await apiGet('/api/feedback-list?limit=200');
  const items = Array.isArray(data.items) ? data.items : [];
  const item = items.find(i => i.id === id);
  if (!item) throw new Error(`Feedback item not found: ${id}`);

  const category = safe(item.type || 'feedback');
  const branch = `feedback/${id.slice(0, 8)}-${category}`;
  const fileDir = path.join(process.cwd(), 'docs', 'feedback-fixes');
  const filePath = path.join(fileDir, `${id}.md`);

  const title = (item.message || 'Feedback report').slice(0, 72);
  const body = [
    `# Feedback Fix Brief`,
    ``,
    `- Feedback ID: \`${id}\``,
    `- Type: \`${item.type || 'unknown'}\``,
    `- Created: \`${new Date(item.createdAt || Date.now()).toISOString()}\``,
    `- Screen: \`${item?.meta?.screen || 'unknown'}\``,
    `- URL: ${item?.meta?.url || 'n/a'}`,
    `- Puzzle ID: \`${item?.meta?.puzzleId || 'n/a'}\``,
    `- Room ID: \`${item?.meta?.roomId || 'n/a'}\``,
    ``,
    `## User report`,
    `${item.message || ''}`,
    ``,
    `## Context`,
    `${item.context || 'n/a'}`,
    ``,
    `## Fix checklist`,
    `- [ ] Reproduce issue`,
    `- [ ] Implement fix`,
    `- [ ] Add/update tests where possible`,
    `- [ ] Verify on affected screen`,
    `- [ ] Update this file with root cause + resolution`,
    ``,
  ].join('\n');

  run(`git checkout -b ${branch}`);
  await mkdir(fileDir, { recursive: true });
  await writeFile(filePath, body, 'utf8');
  run(`git add "${filePath}"`);
  run(`git commit -m "Add fix brief for feedback ${id}"`);
  run(`git push -u origin ${branch}`);

  const prTitle = `Investigate feedback: ${title}`;
  const prBody = [
    '## Summary',
    `- Seeded from feedback item \`${id}\``,
    `- Added a fix brief at \`docs/feedback-fixes/${id}.md\``,
    '',
    '## Test plan',
    '- [ ] Reproduce from report',
    '- [ ] Implement and verify fix',
    '- [ ] Confirm no regressions',
  ].join('\n');

  run(`gh pr create --draft --title "${prTitle.replace(/"/g, "'")}" --body "${prBody.replace(/"/g, "'")}"`);

  await apiPost('/api/feedback-triage', {
    id,
    status: 'in_progress',
    decision: 'bug',
    severity: item?.triage?.severity || null,
    notes: `PR seeded from automation branch ${branch}`,
    reviewer: 'feedback-agent',
  });

  console.log(`Seeded PR for feedback ${id} on branch ${branch}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];

  if (!cmd || ['help', '--help', '-h'].includes(cmd)) {
    console.log('Usage:');
    console.log('  node scripts/feedback-agent.mjs triage --limit 50 [--apply --reviewer "name"]');
    console.log('  node scripts/feedback-agent.mjs seed-pr --id <feedbackId>');
    process.exit(0);
  }

  if (!TOKEN) {
    throw new Error('FEEDBACK_ADMIN_TOKEN is required');
  }

  if (cmd === 'triage') await cmdTriage(args);
  else if (cmd === 'seed-pr') await cmdSeedPr(args);
  else throw new Error(`Unknown command: ${cmd}`);
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});

