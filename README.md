# Habla

A voice conversation partner for practicing Mexican Spanish. You speak, Valeria listens, answers out loud, and waits for you.

Runs on your own Windows PC in Microsoft Edge. Conversation is powered by your Claude subscription through Claude Code, so there is no extra cost.

## What you need

- Windows with Microsoft Edge
- Node.js 18 or newer (`node --version`)
- Claude Code installed and signed in (`claude --version`, then run `claude` once to sign in). Requires a Pro or Max plan.
- Headphones (strongly recommended, so the mic doesn't hear Valeria)

## Run it

Double-click **`start.cmd`**. It starts the server and opens Edge at http://localhost:3000.

Or from a terminal in this folder:

```
npm start
```

then open http://localhost:3000 in Edge.

1. Click **Start conversation** and allow the microphone.
2. The first start downloads the Whisper speech model once.
3. Valeria says hello. Answer in Spanish. Pause for a moment when you finish and she replies.

Keep the terminal window open while you practice. Close it (or press Ctrl+C) to stop.

## How it works

```
mic → voice detection → Whisper (in Edge) → server.js → Claude Code → reply streams back
                                                           ↓
                                  Edge voice speaks each sentence as it arrives
```

| Piece | Where it runs | Notes |
|---|---|---|
| Voice detection | Edge | Decides when you've stopped talking. Adjust "Wait after you stop talking" in Settings. |
| Speech to text | Edge (Whisper) or Microsoft online | Whisper runs on your GPU (WebGPU) or CPU. Edge built-in is the fallback. |
| Conversation | Claude Code on your PC | One long-running session, no tools, in an empty temp folder. |
| Voice | Edge | Uses Edge's Spanish voices. "Online (Natural)" voices sound best. |

The mic is off while Valeria thinks and talks. Press **Esc** or **Stop voice** to cut her off.

## Test

```
npm test
```

Offline: checks every script parses and that the server refuses other hosts and sites.

## Settings

Open with the sliders icon (top right).

- **Your level**: A1 to C1. Changes how Valeria talks.
- **Model source**: Claude Code (default), Ollama (fully local), or an Anthropic API key (paid; set `ANTHROPIC_API_KEY` before starting).
- **Claude model**: Haiku is fastest, Sonnet is the default, Opus is smartest but slowest.
- **Speech recognition**: Whisper or Edge built-in. Whisper model size: tiny, base (default), small.
- **Voice and speed** for Valeria.
- **Show response timings**: shows how long each step took, under the text box.

## Troubleshooting

| Problem | Fix |
|---|---|
| `npm` says "running scripts is disabled" | Use `start.cmd`, or run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` in PowerShell once. |
| "Claude Code wasn't found" | Open a new terminal, check `claude --version`. If it isn't found, add `%USERPROFILE%\.local\bin` to your user PATH. You can also set `CLAUDE_BIN` to the full path of `claude.exe`. |
| "Claude Code isn't signed in" | Run `claude`, sign in, type `/exit`, restart Habla. |
| Valeria hears herself | Use headphones, or lower mic sensitivity. |
| She cuts you off mid-sentence | Raise "Wait after you stop talking" in Settings. |
| She doesn't notice you talking | Raise mic sensitivity. |
| Whisper won't load | Habla switches to Edge's built-in recognition for that session. Check your internet connection (the model downloads from Hugging Face the first time). |
| Robotic voice | Pick a voice with "Online (Natural)" in its name in Settings. |
| Port 3000 is busy | Close the other Habla window, or run `set PORT=3001` then `npm start`. |

The terminal prints how long each reply took. The browser console (F12) prints the full timing for each turn.

## Privacy

- The server only accepts connections from your own PC (127.0.0.1) and rejects requests from other websites.
- Claude Code runs with all tools disabled, so it can only talk. It cannot run commands or read files.
- Nothing is saved. Reloading the page starts a new conversation.
- What leaves your PC: your conversation text goes to Anthropic (Claude). With Edge's online voices, Valeria's replies go to Microsoft to be spoken. With Edge built-in recognition, your audio goes to Microsoft. With Whisper, your audio stays on your PC.

## Files

```
server.js              local server and API routes
lib/claude-code.js     long-running Claude Code session (stream-json)
lib/providers.js       Ollama and Anthropic API alternatives
lib/prompt.js          Valeria's persona and teaching rules
public/                the app: UI, mic capture, Whisper worker, voice
start.cmd              double-click launcher for Windows
```
