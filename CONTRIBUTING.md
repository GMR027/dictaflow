# Contributing / Contribuir

```bash
git clone https://github.com/GMR027/dictaflow.git && cd dictaflow
npm install
node node_modules/electron/install.js   # if Electron did not download itself
npm run dev
npm run typecheck                        # must pass before opening a PR
```

- Keep changes focused; match the surrounding code style.
- No telemetry, no analytics, no hidden network calls. Every outgoing request must go through `src/main/netlog.ts` so it shows up in the Privacy tab.
- UI text is Spanish first; open an issue if you want to help with translations.
- Open an issue before large changes.

Security issues: please open a private security advisory on GitHub instead of a public issue.
