# Codebase Issue Task Proposals (2026-04-20)

This document proposes four targeted tasks discovered during a quick repo walkthrough: one typo fix, one bug fix, one documentation discrepancy fix, and one test improvement.

## 1) Typo fix task (spelling consistency in comments)

**Issue observed**
- `js/shared/studio-deck.js` uses "behaviour" in multiple JSDoc comments while adjacent project docs and comments mostly use US spelling ("behavior").

**Evidence**
- `js/shared/studio-deck.js`: lines 383, 418, 435

**Proposed task**
- Normalize these comment spellings from `behaviour` to `behavior` for consistency with the rest of the repo’s dominant spelling.

**Acceptance criteria**
- All three comment occurrences in `js/shared/studio-deck.js` use `behavior`.
- No runtime code path changes (comments-only edit).

---

## 2) Bug fix task (gallery create flow can get stuck on thrown request errors)

**Issue observed**
- In `js/pages/index/studio.js`, `handleGenerate()` and `handleSave()` await API helpers without `try/finally` guards.
- If `apiAiGenerateImage(...)` or `apiAiSaveImage(...)` throws (network failure, aborted request, unexpected exception), button states may not reset and the UI can stay disabled.

**Evidence**
- `js/pages/index/studio.js`: generation path around lines 128-132; save path around lines 179-190.

**Proposed task**
- Wrap both async flows in `try/catch/finally`.
- In `finally`, always restore button states (`disabled=false`, default labels).
- In `catch`, surface a safe generic user error message (`Generation failed. Please try again.` / `Save failed. Please try again.`), while logging detailed errors to console for debugging.

**Acceptance criteria**
- Generate/save buttons always re-enable after success, API error response, or thrown exception.
- UI does not remain in a perpetual "Generating…" or "Saving…" state after exceptions.

---

## 3) Code comment/documentation discrepancy task (stale audit doc references)

**Issue observed**
- `docs/privacy-compliance-audit.md` references files/paths that are not present in this repository snapshot (e.g., `experiments/*` pages and `workers/crypto/src/index.js`).
- This makes the audit doc unreliable as an operational reference.

**Evidence**
- `docs/privacy-compliance-audit.md`: lines 4, 11, 27.

**Proposed task**
- Reconcile this document with the current repo layout:
  - Remove or annotate historical references to missing paths.
  - Replace with current equivalents where applicable.
  - Add a short "validated on" note with the repo date/commit.

**Acceptance criteria**
- Every file path listed in "Files" sections resolves in the repo, or is explicitly marked as historical context.
- Manual follow-up steps align to existing worker names and directory structure.

---

## 4) Test improvement task (add regression test for thrown generate/save errors)

**Issue observed**
- Existing `Image Studio (authenticated)` Playwright coverage validates successful generation paths and model restrictions.
- There is no explicit UI regression test that simulates a thrown fetch/request error and verifies the buttons recover.

**Evidence**
- `tests/auth-admin.spec.js`: `Image Studio (authenticated)` suite starts at line 1868; generation happy-path checks around lines 1889-1892 and 1921-1923.

**Proposed task**
- Add one test in `tests/auth-admin.spec.js` that forces `/api/ai/generate-image` (and optionally save endpoint) to fail via route abort/throw.
- Assert:
  - Button text resets from "Generating…" / "Saving…".
  - Button becomes enabled again.
  - Error message is visible.

**Acceptance criteria**
- New test fails against current behavior if UI remains stuck.
- New test passes after the bug fix in task #2.
