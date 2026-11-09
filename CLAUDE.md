# habla

Public A2→B1 Spanish practice app plus Valeria, a conversation partner.
- `app/index.html`: the public app, one self-contained file served by GitHub Pages. Config in `HABLA_CFG`. Storage keys start with `es_` (kept from the app's earlier life, so old backups restore).
- `valeria/valeria.html`: runs only as a claude.ai artifact (it calls Claude on the visitor's plan). Published at the URL in `HABLA_CFG.valeriaUrl`; republish that same artifact after changing the file. Config in `VCFG` and `MODES`.
- `desktop/`: the earlier Windows/Edge version. **Frozen**: security fixes only, no features.
- Test: `npm test` (offline).

Decisions already made:
- The app never makes network requests; its CSP sets `connect-src 'none'`. Only the Valeria handoff link leaves the page.
- Valeria → app data travels only in the `#import=` fragment of a link the learner taps. The app validates and caps it, shows it, and adds it only on the learner's tap. Treat it as untrusted input; everything rendered from it goes through `esc()`.
- Grammar rows (`A2` in the app, `ROWS` in Valeria) share ids; the tests fail if they drift.
- Security invariants for `desktop/`: the server binds 127.0.0.1 only and checks Host and Origin; Claude Code runs with no tools and `--safe-mode`; model and level are allowlisted before they reach the command line. Keep all three.

## Working rules for agents (shared across J's repos)

- **Public-safe by default.** Write everything as if this repo will be public tomorrow. No secrets or real personal data in code, config or history (keys go in env vars and GitHub secrets). No security through hidden code: anything that would be unsafe if the repo went public is a bug, so flag it.
- **PRs, never pushes to `main`.** Every change goes through a pull request. Claude merges it once CI is green and, for high-risk PRs, an independent review has passed; J gets a short summary instead of a review queue. Hold a PR for J only when it needs a decision or a look CI can't give (visuals, money, anything irreversible).
- **Every PR opens with a risk tier and a 60-second check.** First line: `Risk: low | medium | high`. Then what could break and the exact lines worth reading.
- **High risk = these paths, or anything that publishes or touches auth:** `.github/`, secrets and tokens, auth and host code, `wrangler.toml` or other deploy config, anything that makes something public. High-risk PRs get an independent review (a fresh agent that hasn't seen the work) before J is asked to merge.
- **No generated files in PRs.** Outputs that a workflow rebuilds stay out of PRs, so they can't collide with that workflow.
- **Small PRs.** One purpose each. Split anything J can't check from a phone in about a minute.
- **Check before explaining.** Read the log, run the test, open the file. A guess is labeled as a guess.
- **Include a ready-to-paste Claude Code prompt** in each PR, as the alternative to merging.
