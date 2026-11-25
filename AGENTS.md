# AGENTS.md

## Project rules

- Never run `git commit`, `git push`, or any git command that changes history. The user reviews and commits.
- Never commit secrets. Only `.env.example` is tracked; `.env` is gitignored.
- Install only the dependencies the current step actually uses.
- TypeScript strict mode is always on. Keep code simple and commented only where the "why" is not obvious.
- At the end of each step, run build, lint and tests, and report the results honestly.
