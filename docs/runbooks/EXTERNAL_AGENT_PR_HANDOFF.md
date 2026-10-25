# External-agent PR handoff

Load only for external PR authoring, intake, merge or release-only tasks. This
procedure adds no authority and does not replace the main-only release runbook.

## Roles and authority

`Systemingenieur` and other authoring agents implement scoped changes, add relevant
tests and push task branches/PRs. They must not push `main`, merge or enable
auto-merge, release/deploy, change production state, or bypass local hooks. A shared
GitHub username, agent recommendation or green check is not owner authorization.

Local Codex accepts existing work on the owner's development computer. It owns
integration, risk-proportional local validation and explicitly authorized release,
not a second implementation. Preserve unrelated local and remote work, existing
history constraints, credentials, protected reviews and publication locks.

## Author handoff

Keep the PR description compact; link evidence instead of pasting transcripts:

- PR/head SHA, purpose, changed surfaces and intended behavior changes.
- Exact executed commands, outcomes and report locations tied to that SHA; separate
  author-reported results from verifiable artifacts and skipped/manual checks.
- Known risks, existing failures with baseline evidence, required deployment,
  configuration/migration dependencies, rollback limits and remaining approvals.

Use the existing PR description when sufficient. Ask only for a missing material
field, not a second full report. Never put secrets or private test data in the PR.

## Local acceptance without duplicate work

Read the handoff, diff, applicable instructions, relevant tests/contracts and existing
findings once. Check scope, behavior, integration and test adequacy. Expand only
for a concrete defect, high-risk dependency, missing proof, conflict or failed gate.
Agent provenance is neither a defect nor proof of correctness. Do not launch another
cloud/parallel review or a repository-wide audit by default. Reuse existing findings;
resolve their actual cause rather than recreating the review.

Assess the whole unpublished range from the verified published baseline, including
other merges/local work, and use the existing selector. Review newly changed deltas
rather than rereading unchanged files. Keep required accounting/auth/security and
runtime-specific coverage; small diffs are not automatically low risk.

Author claims guide test selection but cannot replace required local acceptance.
Reuse only evidence the existing verifier accepts for matching source/base,
selection, dependencies/toolchain, commands and report/artifact identities. Rerun
missing or invalidated coverage, not already accepted unchanged suites. Preserve
failures, skips and retry-only outcomes; a neutral/error review is not a pass.
An allegedly pre-existing failure is not waived without checking relevance and
required-gate status. Do not weaken selectors, checks, permissions or review gates.

## Task modes

Preparation/intake: integrate a scoped local candidate safely, follow hook and
pre-commit requirements, and use `npm run release:preflight`. No remote merge,
`main` push or production publication. Retain the candidate and checkpoint.

Merge-only: explicit owner authorization for named PRs permits only that stage,
after applicable acceptance. It does not authorize deployment. Recheck PR head,
remote base and tested integration before changing remote history; stop on drift.

Release-only: an explicit owner instruction to merge and publish named PRs permits
those stages, without unrelated feature work. Commit the scoped integrated candidate
and use `npm run release:local` under the existing main-only release runbook; reuse
accepted preflight evidence. Do not use a parallel deploy/manual Worker shortcut,
auto-merge, duplicate Full dispatch or bypass protected owner approval. Revalidate
changed inputs after source/base drift. A blocker permits no unrequested redesign;
report it and repair only within already-authorized scope.

## Compact completion

Report PR/candidate identity, decisive findings, reused/new checks, unresolved gaps,
and the actual merge/publication state or next approval. Keep transient SHA/status
and test evidence in the PR or existing checkpoint, not in permanent instructions.
Automatic GitHub review settings are separate from these rules; do not change them
or request extra paid/cloud reviews without authorization.
