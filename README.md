# SnailType

A local-first typing practice web app. Track your typing speed and accuracy, review your weakest words, and improve over time — all data stays in your browser.

## Features

- **Typing test** (`index.html`) – Core typing practice session.
- **Slow mode** (`slow.html`) – Focused practice on problem words at a slower pace.
- **Stats** (`stats.html`) – View typing statistics, with the ability to export/import your data as JSON.
- **Options** (`options.html`) – Configure typing modes and preferences.

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

All user data (typing stats, settings) is stored locally in the browser (localStorage/IndexedDB). No server or account is required. Stats can be exported/imported as JSON from the Stats page.
