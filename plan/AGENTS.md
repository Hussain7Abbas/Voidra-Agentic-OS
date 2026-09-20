# Plan documentation rules

These rules extend the repository-root AGENTS.md for this directory.

- This directory contains implementation plans, not application code or claims of completed implementation.
- `main.md` is the canonical phase index. Keep its links, dependencies, decision register, and requirement coverage consistent with the phase files.
- Each phase document must state its outcome, prerequisites, scope, architecture/data decisions, implementable stories with relative points and acceptance criteria, unit tests, Playwright E2E scenarios, failure/recovery behavior, and exit criteria.
- Treat confirmed user requirements as required scope. Mark unanswered questions and proposed defaults explicitly; do not silently drop features when sequencing releases.
- Use Vitest as the proposed unit-test runner and Playwright as the required E2E framework. State which platform and test doubles are involved. Do not represent mocked OS/provider behavior as a successful real-device or paid-service test.
- Unit/E2E tests are future implementation work. Validate document links, coverage, and instruction-file pairs during this planning task; do not scaffold test code.
- Keep stories below 13 points, identify dependencies, and avoid interpreting points as calendar-time estimates.
- Maintain a sibling CLAUDE.md containing exactly @AGENTS.md for this instruction file.
