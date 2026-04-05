import assert from 'node:assert/strict';

async function run() {
  process.env.FIREBASE_DB_URL = 'https://example.firebaseio.com';
  process.env.FIREBASE_DB_SECRET = 'firebase-secret';

  process.env.GITHUB_TOKEN = 'github-token';
  process.env.GITHUB_REPO = 'owner/repo';
  delete process.env.CURSOR_API_KEY; // avoid Cursor agent calls in tests

  const { default: handler } = await import('../api/feedback.js');

  const calls = [];
  const patchBodies = [];
  const reqBodyTypes = [];

  global.fetch = async (url, opts = {}) => {
    calls.push({ url, opts });

    // Firebase write (initial feedback submit)
    if (url.includes('/feedback.json') && opts.method === 'POST') {
      return {
        ok: true,
        json: async () => ({ name: 'fb_1' }),
      };
    }

    // Firebase PATCHes to store triage info
    if (url.includes('/feedback/fb_1.json') && opts.method === 'PATCH') {
      const body = JSON.parse(opts.body || '{}');
      patchBodies.push(body);
      reqBodyTypes.push(body?.triage?.github?.type || null);
      return { ok: true, json: async () => ({}) };
    }

    // GitHub issue creation (expected for idea/feedback)
    if (url === 'https://api.github.com/repos/owner/repo/issues' && opts.method === 'POST') {
      const body = JSON.parse(opts.body || '{}');
      return {
        ok: true,
        json: async () => ({ html_url: 'https://github.com/owner/repo/issues/1', ...body }),
      };
    }

    // Guardrail: PR paths should not be used for idea submissions.
    if (url.includes('/pulls') || url.includes('/git/ref/heads')) {
      throw new Error(`Unexpected GitHub automation call in test: ${url}`);
    }

    throw new Error(`Unexpected fetch in test: ${url} ${opts.method || 'GET'}`);
  };

  const req = {
    method: 'POST',
    query: {},
    body: {
      type: 'idea',
      message: 'Long idea message that should trigger GitHub issue creation for landing feedback. Please add improvements to the UX.',
      context: 'Screen: landing · Path: /',
      url: 'https://example.com/',
      path: '/',
      puzzleId: 'p_1',
      roomId: null,
      screen: 'landing',
      userAgent: 'test-agent',
    },
  };

  const res = {
    statusCode: null,
    body: null,
    setHeader() {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(obj) {
      this.body = obj;
      return this;
    },
  };

  await handler(req, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.id, 'fb_1');

  const githubIssueCalls = calls.filter(c => c.url === 'https://api.github.com/repos/owner/repo/issues');
  assert.ok(githubIssueCalls.length >= 1, 'Expected GitHub /issues POST call');

  const firstIssueCall = githubIssueCalls[0];
  const issuePayload = JSON.parse(firstIssueCall.opts.body || '{}');
  assert.ok(String(issuePayload.title).includes('Idea needs confirmation'), 'Expected idea-specific issue title');

  // At least one Firebase PATCH should include github.type=issue.
  const hasIssueType = patchBodies.some(b => b?.triage?.github?.type === 'issue');
  assert.ok(hasIssueType, 'Expected feedback triage to record github.type="issue"');

  // Ensure no PR creation paths were triggered.
  assert.ok(!calls.some(c => c.url.includes('/pulls')), 'Did not expect GitHub /pulls calls');

  console.log('feedback-github-automation: all tests passed');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
