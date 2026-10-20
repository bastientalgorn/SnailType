# SnailType

A local-first typing practice web app. Track your typing speed and accuracy, review your weakest words, and improve over time — all data stays in your browser.

**Live site:** [https://bastientalgorn.github.io/SnailType/](https://bastientalgorn.github.io/SnailType/)

## Goal

SnailType's goal is to help you improve your typing by keeping track of the words you often type wrong, and giving you more practice on exactly those words — rather than generic random text.

## Features

- **Typing test** (`index.html`) – Core typing practice session.
- **Slow mode** (`slow.html`) – Focused practice on problem words at a slower pace.
- **Stats** (`stats.html`) – View typing statistics, with the ability to export/import your data as JSON.
- **Options** (`options.html`) – Configure typing modes and preferences.

## Practice Modes

| Mode | What it does |
| --- | --- |
| **Sprint** | Short runs of common words, weighted by how frequently they appear in English. No speed requirement — good for warming up. |
| **General** | Longer runs drawn from the whole word list, favouring words you haven't practised yet. No speed requirement. |
| **Targeted** | Small sets of your most error-prone words, each repeated a few times, with a target speed to beat. |
| **Drill** | A single problem word repeated many times at a high target speed, to build muscle memory. |
| **Slow** | One word at a time, typed in rhythm with a metronome that gradually speeds up. |
| **Mixed** | Cycles automatically through the other modes. Each mode's "Tests in Mixed Mode" option sets how many tests it contributes per rotation (0 to skip it). |

Every mode is fully configurable from the Options page — word length range, number of words, repetitions, target WPM, whether errors are allowed, and how words are selected.

## Project Structure

```
index.html      Main typing test page
options.html    Settings / options page
slow.html       Slow practice mode page
stats.html      Statistics page
app.js          Main app logic
options.js      Options page logic
slow.js         Slow mode logic
stats.js        Stats page logic
db.js           Local storage / IndexedDB persistence layer
words.js        Word list data
styles.css      Shared styles
```

## Running Locally

Since the app uses ES modules (`<script type="module">`), it needs to be served over HTTP rather than opened directly as a `file://` URL.

### Option 1: Python

```
python -m http.server 8000
```

Then open `http://localhost:8000` in your browser.

### Option 2: Node.js

```
npx serve .
```

## Data Storage

All user data (settings/options and typing stats) is stored **locally in your browser's IndexedDB**. No server, backend, or account is required, and nothing is sent anywhere — everything stays on your device. Stats can be exported/imported as JSON from the Stats page if you want to back them up or move them to another browser.

### What stats are collected

For each word you type, SnailType keeps a rolling history of your last **50 attempts** at that word, recorded as a success/failure outcome (i.e., whether you typed it correctly or made a mistake). This history is used to:

- Estimate your success probability for each word.
- Identify your weakest/most error-prone words.
- Prioritize those words for practice in the error-driven modes ("Targeted", "Drill" and "Slow").

No raw keystrokes, timestamps of individual keypresses, or personally identifying information are collected — only the per-word correct/incorrect outcome history described above, plus aggregate typing speed (WPM) and accuracy for each test session.
