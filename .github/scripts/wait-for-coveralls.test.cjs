const assert = require('node:assert/strict');
const { test } = require('node:test');
const waitForCoveralls = require('./wait-for-coveralls.cjs');

const startedAt = '2026-10-02T20:00:00Z';
const status = (state, overrides = {}) => ({
  context: 'coverage/coveralls', state,
  created_at: '2026-10-02T20:00:01Z',
  description: 'Coverage below 80%', ...overrides,
});

function fixture(responses) {
  let time = 0;
  const calls = [];
  const failures = [];
  const options = {
    startedAt,
    context: { repo: { owner: 'CGSeb', repo: 'voxelshift' }, payload: { pull_request: { head: { sha: 'pr-head-sha' } } } },
    github: { rest: { repos: { listCommitStatusesForRef: async (request) => {
      calls.push(request);
      return { data: responses[Math.min(calls.length - 1, responses.length - 1)] };
    } } } },
    core: { info() {}, setFailed(message) { failures.push(message); } },
    timeoutMs: 30, pollIntervalMs: 10,
    now: () => time,
    sleep: async (ms) => { time += ms; },
  };
  return { options, calls, failures };
}

test('waits for a fresh success on the PR head, ignoring an old success and the push context', async () => {
  const run = fixture([
    [status('success', { created_at: '2026-10-02T19:59:59Z' }), status('success', { context: 'coverage/coveralls (push)' })],
    [status('pending')], [status('success')],
  ]);
  await waitForCoveralls(run.options);
  assert.equal(run.calls.length, 3);
  assert.ok(run.calls.every((call) => call.ref === 'pr-head-sha'));
  assert.deepEqual(run.failures, []);
});

for (const state of ['failure', 'error']) {
  test(`fails the job when Coveralls reports ${state}`, async () => {
    const run = fixture([[status(state, { target_url: 'https://coveralls.io/builds/example' })]]);
    await waitForCoveralls(run.options);
    assert.equal(run.failures.length, 1);
    assert.match(run.failures[0], /Coverage below 80%/);
    assert.match(run.failures[0], /https:\/\/coveralls.io\/builds\/example/);
  });
}

test('uses the latest result when earlier statuses also exist', async () => {
  const run = fixture([[status('success'), status('failure', { created_at: '2026-10-02T20:00:02Z' })]]);
  await waitForCoveralls(run.options);
  assert.equal(run.failures.length, 1);
});

test('fails after a bounded wait if Coveralls never reports a result', async () => {
  const run = fixture([[]]);
  await waitForCoveralls(run.options);
  assert.equal(run.calls.length, 3);
  assert.match(run.failures[0], /Timed out/);
});

test('rejects an invalid upload timestamp instead of accepting an unrelated result', async () => {
  const run = fixture([[status('success')]]);
  await assert.rejects(waitForCoveralls({ ...run.options, startedAt: '' }), /timestamp/);
  assert.equal(run.calls.length, 0);
});
