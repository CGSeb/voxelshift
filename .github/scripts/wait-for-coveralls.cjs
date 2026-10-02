// Coveralls posts a commit status asynchronously, after its upload action passes.
// Require a fresh result for the PR head, rather than a result from an older run.
module.exports = async function waitForCoveralls({
  github, context, core, startedAt,
  timeoutMs = 10 * 60 * 1000,
  pollIntervalMs = 15 * 1000,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const uploadedAt = Date.parse(startedAt);
  if (!Number.isFinite(uploadedAt)) {
    throw new Error('Missing Coveralls upload timestamp; unable to verify this run.');
  }
  const ref = context.payload.pull_request.head.sha;
  const deadline = now() + timeoutMs;
  let previousState;
  while (now() < deadline) {
    const { data: statuses } = await github.rest.repos.listCommitStatusesForRef({
      ...context.repo, ref, per_page: 100,
    });
    const status = statuses
      .filter((item) => item.context === 'coverage/coveralls'
        && Date.parse(item.created_at) >= uploadedAt)
      .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))[0];
    if (status?.state === 'success') {
      core.info(`Coveralls passed: ${status.description || ref}`);
      return;
    }
    if (status?.state === 'failure' || status?.state === 'error') {
      core.setFailed(`Coveralls ${status.state}: ${status.description || 'Coverage check failed.'}${status.target_url ? ` (${status.target_url})` : ''}`);
      return;
    }
    const state = status?.state || 'not yet reported';
    if (state !== previousState) {
      core.info(`Waiting for Coveralls on ${ref}: ${state}.`);
      previousState = state;
    }
    await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - now())));
  }
  core.setFailed('Timed out waiting for a fresh coverage/coveralls result. Check the Coveralls report and ensure USE STATUS API is enabled.');
};
