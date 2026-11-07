# AGENTS.md

## Shipping

Personal project. These rules replace the global "ask before commit, push or PR" defaults.

- Base branch: `main`. One branch per issue or change, named `<issue>-<slug>` when there is
  an issue.
- Commit in small steps. Push the branch and open a PR into `main` without asking, once the
  checks pass locally. Don't stack PRs.
- Don't merge. Simon merges.
- PR media: before/after screenshots when the UI changed, none otherwise. Don't ask.
- "hold" or "check first" means: stop before the next push or PR and wait.
- Don't stop to ask which option to take. Pick your recommended one, note it (in the PR body
  under "Decisions", or in the commit message), and go on. Stop and ask only before: deleting
  or dropping data, a release or package publish, a manual production deploy, spending money,
  or sending email or messages to anyone.
