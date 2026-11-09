# Habla

Spanish practice for learners moving from A2 to B1. Grammar you can check yourself on, verb drills out loud, notes from your conversations, and Valeria, a conversation partner who runs a little café in Mexico City.

**Open it:** https://leftbrain847.github.io/habla/ (no account, nothing to install; add it to your home screen).

## What's in it

| Tab | What it does |
|---|---|
| **Hoy** | Builds a 15, 30 or 45 minute session from what you've practiced least. **Guía** explains a balanced day and the grammar order from A2 to B1. |
| **Aprende** | 67 A2 grammar rows in five clusters. Hear the examples, say them, then grade yourself (under 1 s, within 2 s, slower, missed). **Reglas** holds short rules for common slips. |
| **Practica** | Warmup lines to read aloud, a sentence builder that checks structure, and rapid verb reps. |
| **Habla** | Pick a mode and a grammar target, then talk with Valeria. |
| **Notas** | Words and corrections from tutors, classes and Valeria, with spaced review. |

Your data stays in your browser. **Notas → ⋮ → Copy full backup** moves it to another device.

## Valeria

Valeria lives in [`valeria/valeria.html`](valeria/valeria.html) and runs as a Claude artifact, because that's how a page can talk to Claude without anyone's API key: each visitor signs in to Claude and it uses their own plan. The free plan works.

- **Ensaya:** she steers the chat toward one grammar target. No corrections.
- **Ensaya + repaso:** the same, with your mistakes collected for the end.
- **Libre:** open conversation; she recasts what you got wrong.

When you finish, **Save to my notes** opens the app with the chat packed into the link (`#import=…`). The app shows what arrived and adds it to Notas only when you tap **Add**. Nothing goes through a server.

## How it's built

- `app/index.html`: the whole app in one file. No build step, no dependencies, no network: its CSP blocks every connection.
- `valeria/valeria.html`: the Valeria artifact. Settings live in the `VCFG` and `MODES` objects at the top of its script; the app's live in `HABLA_CFG`.
- `desktop/`: the earlier Windows version (local Whisper speech recognition, voice detection, streaming speech, a localhost-only server). Frozen; see [`desktop/README.md`](desktop/README.md).

## Test

```
npm test
```

Offline. Checks that both pages' scripts parse, that the app loads nothing from other sites, that the app and Valeria agree on their links and grammar targets, that no personal data ships, and that the desktop server only answers localhost.

## License

MIT
