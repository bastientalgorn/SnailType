import { WORDS } from './words.js';
import { initDB, loadModes, saveModes, loadActiveMode, saveActiveMode, loadMixedProgress, saveMixedProgress, loadKeymap, DEFAULT_MODES, DEFAULT_KEYMAP } from './db.js';
import { initSlowMode } from './slow.js';

// Get current options (will be set after DB init)
let OPTIONS = {};

// Key of the mode currently being practiced ('sprint', 'chords', ...).
// In Mixed mode this is the key of the current segment, not 'mixed'.
let ACTIVE_MODE_KEY = null;

let db;

// Parse a bitfield string into { successes, failures }
function parseBitfield(bitfield) {
    if (!bitfield) return { successes: 0, failures: 0 };
    let failures = 0;
    for (const c of bitfield) {
        if (c === '0') failures++;
    }
    return { successes: bitfield.length - failures, failures };
}

// Append a result (true=success, false=failure) to a bitfield, capped at 50
function appendBitfield(bitfield, success) {
    const BITFIELD_MAX = 50;
    const updated = (bitfield || '') + (success ? '1' : '0');
    return updated.length > BITFIELD_MAX ? updated.slice(-BITFIELD_MAX) : updated;
}

// Get word statistics from IndexedDB
async function getWordStats() {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['wordStats'], 'readonly');
        const store = transaction.objectStore('wordStats');
        const request = store.getAll();
        
        request.onsuccess = () => {
            const stats = {};
            request.result.forEach(item => {
                if (typeof item.results === 'string') {
                    // New bitfield format
                    stats[item.word] = parseBitfield(item.results);
                } else {
                    // Legacy integer format
                    stats[item.word] = {
                        successes: item.successes || 0,
                        failures: item.failures || 0
                    };
                }
            });
            resolve(stats);
        };
        request.onerror = () => reject(request.error);
    });
}

// Save word statistics to IndexedDB (bitfield format)
async function saveWordStats(word, success) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['wordStats'], 'readwrite');
        const store = transaction.objectStore('wordStats');

        const getReq = store.get(word);
        getReq.onsuccess = () => {
            const existing = getReq.result;
            let currentBitfield = '';
            if (existing) {
                if (typeof existing.results === 'string') {
                    currentBitfield = existing.results;
                } else {
                    // Migrate from legacy integer format
                    const s = existing.successes || 0;
                    const f = existing.failures || 0;
                    const total = Math.min(s + f, 50);
                    if (total > 0) {
                        const legacyFailures = Math.round((f / (s + f)) * total);
                        currentBitfield = '1'.repeat(total - legacyFailures) + '0'.repeat(legacyFailures);
                    }
                }
            }
            const newBitfield = appendBitfield(currentBitfield, success);
            const putReq = store.put({ word, results: newBitfield });
            putReq.onsuccess = () => resolve();
            putReq.onerror = () => reject(putReq.error);
        };
        getReq.onerror = () => reject(getReq.error);
    });
}

// Get mistyped characters from IndexedDB
async function getMistypedChars() {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['mistypedChars'], 'readonly');
        const store = transaction.objectStore('mistypedChars');
        const request = store.get('mistypedChars');
        
        request.onsuccess = () => {
            resolve(request.result?.chars || '');
        };
        request.onerror = () => reject(request.error);
    });
}

// Save mistyped characters to IndexedDB
async function saveMistypedChars(chars) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['mistypedChars'], 'readwrite');
        const store = transaction.objectStore('mistypedChars');
        const request = store.put({ id: 'mistypedChars', chars });
        
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

// Add mistyped character
async function addMistypedChar(char) {
    let mistypedChars = await getMistypedChars();
    mistypedChars += char;
    
    // Keep only last 1000 characters
    if (mistypedChars.length > 1100) {
        mistypedChars = mistypedChars.slice(-1000);
    }
    
    await saveMistypedChars(mistypedChars);
}

// Per-character typing history, used for the "error rate per character" stat.
// Stored in the mistypedChars store under a separate key so no schema change
// is needed. Each character maps to a bitfield of its last CHAR_WINDOW
// keystrokes ('1' = typed correctly, '0' = mistyped), so the stat reflects
// recent performance rather than a lifetime average.
const CHAR_WINDOW = 1000;

// Read the raw per-character record, migrating the older cumulative
// {attempts, errors} format to bitfields on the way.
async function getCharResults() {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['mistypedChars'], 'readonly');
        const store = transaction.objectStore('mistypedChars');
        const request = store.get('charStats');

        request.onsuccess = () => {
            const record = request.result;

            if (record?.results && typeof record.results === 'object') {
                resolve({ ...record.results });
                return;
            }

            // Legacy format: rebuild an approximate bitfield from the totals.
            // Order within the window is unknown, so successes are placed
            // before failures; only the ratio is meaningful.
            const results = {};
            const attempts = record?.attempts || {};
            const errors = record?.errors || {};
            for (const [char, n] of Object.entries(attempts)) {
                const total = Math.min(n, CHAR_WINDOW);
                const fails = Math.min(Math.round(((errors[char] || 0) / n) * total), total);
                results[char] = '1'.repeat(total - fails) + '0'.repeat(fails);
            }
            resolve(results);
        };
        request.onerror = () => reject(request.error);
    });
}

// Collapse bitfields into { attempts, errors } counts per character
function summarizeCharResults(results) {
    const attempts = {};
    const errors = {};
    for (const [char, bits] of Object.entries(results)) {
        attempts[char] = bits.length;
        let fails = 0;
        for (const b of bits) if (b === '0') fails++;
        errors[char] = fails;
    }
    return { attempts, errors };
}

async function getCharStats() {
    return summarizeCharResults(await getCharResults());
}

// Append this test's per-character outcomes, keeping only the last
// CHAR_WINDOW keystrokes for each character.
async function mergeCharStats(outcomes) {
    if (Object.keys(outcomes).length === 0) return;

    const stored = await getCharResults();
    for (const [char, bits] of Object.entries(outcomes)) {
        const updated = (stored[char] || '') + bits;
        stored[char] = updated.length > CHAR_WINDOW ? updated.slice(-CHAR_WINDOW) : updated;
    }

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['mistypedChars'], 'readwrite');
        const store = transaction.objectStore('mistypedChars');
        const request = store.put({ id: 'charStats', results: stored });
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

// Calculate word interest score based on options and word stats.
// `randomize` is disabled by the debug panel so it can show the deterministic
// score (the random factor would differ from the one used during selection).
function getWordInterest(options, word, stats, randomize = true) {
    const success = stats.successes;
    const failure = stats.failures;
    
    let p = 1;
    
    if (options.useErrorRate) {
        if (failure == 0 && success == 0) {
            p = 0;
        } else {
            p = p * failure / (success + failure);
        }
    }
    
    // Boost score for words never practiced
    if (options.favorNewWords) {
        p = p / (1 + success + failure);
    }
    
    // Multiply by word frequency to prioritize common words
    if (options.useFrequency) {
        const frequency = WORDS[word] || 1;
        p = p * frequency;
    }

    // Randomize
    if (randomize) {
        p = p * Math.random();
    }

    return p;
}

// Format rows as a fixed-width text table.
// `headers` is an array of strings, `rows` an array of string arrays.
// `alignRight` lists the column indices to right-align.
function formatTable(headers, rows, alignRight = []) {
    const widths = headers.map((h, i) =>
        Math.max(h.length, ...rows.map(r => String(r[i] ?? '').length))
    );

    const pad = (text, i) => {
        const s = String(text ?? '');
        return alignRight.includes(i) ? s.padStart(widths[i]) : s.padEnd(widths[i]);
    };

    const lines = [headers.map(pad).join('  ')];
    lines.push(widths.map(w => '-'.repeat(w)).join('  '));
    for (const row of rows) {
        lines.push(row.map(pad).join('  '));
    }
    return lines;
}

// --- Finger usage -----------------------------------------------------------
// Maps each keymap column to a finger. Columns 0-4 are the left hand and 5-9
// the right hand; the index fingers each cover two columns (4 and 5).
const COLUMN_FINGER = [
    'L-pinky', 'L-ring', 'L-middle', 'L-index', 'L-index',
    'R-index', 'R-index', 'R-middle', 'R-ring', 'R-pinky'
];

// Active keyboard layout, loaded from the options (defaults to QWERTY).
let KEYMAP = DEFAULT_KEYMAP;

// char -> finger name, rebuilt whenever the keymap changes
let CHAR_TO_FINGER = {};

// Memoised isEligibleForChords() results, keyed by lowercased word.
// Invalidated whenever the keymap changes, since the answer depends on it.
let CHORD_ELIGIBILITY = new Map();

function rebuildCharToFinger() {
    CHAR_TO_FINGER = {};
    for (let r = 0; r < KEYMAP.length; r++) {
        for (let c = 0; c < KEYMAP[r].length; c++) {
            const char = KEYMAP[r][c];
            // Blank cells are positions the layout doesn't use
            if (char) CHAR_TO_FINGER[char] = COLUMN_FINGER[c];
        }
    }
    // Cached answers were computed against the previous layout
    CHORD_ELIGIBILITY.clear();
}

rebuildCharToFinger();

// Which finger types a given character, or null if it isn't in the keymap
function getFingerForChar(char) {
    return CHAR_TO_FINGER[String(char).toLowerCase()] || null;
}

// How many distinct fingers a word uses.
// Characters that aren't in the keymap are ignored.
function countFingers(word) {
    const fingers = new Set();
    for (const char of String(word).toLowerCase()) {
        const finger = CHAR_TO_FINGER[char];
        if (finger) fingers.add(finger);
    }
    return fingers.size;
}

// The set of distinct fingers a word uses (useful for same-hand / chord logic)
function getFingersForWord(word) {
    const fingers = new Set();
    for (const char of String(word).toLowerCase()) {
        const finger = CHAR_TO_FINGER[char];
        if (finger) fingers.add(finger);
    }
    return fingers;
}

// A word is eligible for Chords practice if it never asks the same finger to
// press two keys in a row. Consecutive same-finger keystrokes force a slow
// lift-and-move, so they can't be typed as a single rolling motion.
//
//   "need" -> false: 'e' then 'e' are both the left middle finger
//   "man"  -> true:  'm' and 'n' share the right index, but 'a' separates them
//
// Characters outside the keymap (digits, punctuation, ...) have no finger, so
// they break the run and are treated as a separator.
//
// Results are cached because the whole dictionary is scanned on every word
// selection; the cache is cleared by rebuildCharToFinger() when the layout
// changes.
function isEligibleForChords(word) {
    const key = String(word).toLowerCase();

    const cached = CHORD_ELIGIBILITY.get(key);
    if (cached !== undefined) return cached;

    let eligible = true;
    let previousFinger = null;

    for (const char of key) {
        const finger = CHAR_TO_FINGER[char] || null;
        if (finger !== null && finger === previousFinger) {
            eligible = false;
            break;
        }
        previousFinger = finger;
    }

    CHORD_ELIGIBILITY.set(key, eligible);
    return eligible;
}

// Select words to practice using Beta-Binomial model
async function selectWordsToPractice(n, minLength, maxLength) {
    const wordStats = await getWordStats();
    
    const wordSuccessProba = [];
    
    // WORDS is now a dictionary, so iterate over keys
    // Chords mode only practises words that can be rolled without asking the
    // same finger for two consecutive keys.
    const chordsOnly = ACTIVE_MODE_KEY === 'chords';

    for (const word of Object.keys(WORDS)) {
        if (minLength !== null && minLength > 0 && word.length < minLength) continue;
        if (maxLength !== null && maxLength > 0 && word.length > maxLength) continue;
        if (chordsOnly && !isEligibleForChords(word)) continue;
        
        const stats = wordStats[word.toLowerCase()] || { successes: 0, failures: 0 };
        const p = getWordInterest(OPTIONS, word, stats);
        
        wordSuccessProba.push({ word, p });
    }
    
    // Sort by probability (descending - highest failure probability first)
    wordSuccessProba.sort((a, b) => b.p - a.p);
    
    // Take top N words and shuffle
    const topWords = wordSuccessProba.slice(0, Math.min(n, wordSuccessProba.length)).map(item => item.word);
    
    // Shuffle
    for (let i = topWords.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [topWords[i], topWords[j]] = [topWords[j], topWords[i]];
    }
    
    return topWords;
}

// Update word statistics
async function updateWordStats(words, wordResults) {
    for (let i = 0; i < words.length; i++) {
        const word = words[i].toLowerCase();
        await saveWordStats(word, wordResults[i]);
    }
}

// Number of errors on a single letter at which the hint reaches full red
const HINT_MAX_ERRORS = 4;

// Colour for a letter that has been mistyped `count` times in previous
// attempts: white (no errors) -> yellow -> red (several errors).
function errorHintColor(count) {
    const t = Math.min(count / HINT_MAX_ERRORS, 1);
    let g = 255;
    let b = 255;
    if (t < 0.5) {
        // white -> yellow: drop the blue channel
        b = Math.round(255 * (1 - t * 2));
    } else {
        // yellow -> red: drop the green channel
        b = 0;
        g = Math.round(255 * (2 - t * 2));
    }
    return `rgb(255, ${g}, ${b})`;
}

// Display target text with 4-state coloring.
// `hintCounts` maps a lowercased word to a per-letter array of error counts,
// used to tint not-yet-typed letters that were mistyped earlier.
function displayTargetText(targetText, typedText, charEverWrong, hintCounts = {}) {
    const targetDiv = document.getElementById('target-text');
    targetDiv.innerHTML = '';
    
    const words = targetText.split(' ');
    let charIndex = 0;
    
    for (let wordIdx = 0; wordIdx < words.length; wordIdx++) {
        const word = words[wordIdx];
        const wordSpan = document.createElement('span');
        wordSpan.classList.add('word');
        
        // Add characters of the word
        const wordHints = hintCounts[word.toLowerCase()];
        for (let i = 0; i < word.length; i++) {
            const span = document.createElement('span');
            span.classList.add('char');
            const char = word[i];
            
            if (charIndex < typedText.length) {
                if (typedText[charIndex] === char) {
                    if (charEverWrong.has(charIndex)) {
                        span.classList.add('corrected');
                    } else {
                        span.classList.add('correct');
                    }
                } else {
                    span.classList.add('incorrect');
                }
            } else {
                span.classList.add('pending');
                // Hint: tint letters that were mistyped in earlier attempts
                const errors = wordHints ? wordHints[i] : 0;
                if (errors > 0) {
                    span.style.color = errorHintColor(errors);
                }
            }
            
            span.textContent = char;
            wordSpan.appendChild(span);
            charIndex++;
        }
        
        targetDiv.appendChild(wordSpan);
        
        // Add space after word (except last word)
        if (wordIdx < words.length - 1) {
            const spaceSpan = document.createElement('span');
            spaceSpan.classList.add('char');
            spaceSpan.classList.add('space-char');
            
            if (charIndex < typedText.length) {
                if (typedText[charIndex] === ' ') {
                    if (charEverWrong.has(charIndex)) {
                        spaceSpan.classList.add('corrected');
                    } else {
                        spaceSpan.classList.add('correct');
                    }
                } else {
                    spaceSpan.classList.add('incorrect');
                }
            } else {
                spaceSpan.classList.add('pending');
            }
            
            // Always show space as a box (empty content, styled by CSS)
            spaceSpan.innerHTML = '&nbsp;';
            
            targetDiv.appendChild(spaceSpan);
            charIndex++;
        }
    }

    // Purely visual trailing space: not part of targetText, never typed
    const trailingSpace = document.createElement('span');
    trailingSpace.classList.add('char', 'space-char', 'pending', 'trailing-space');
    trailingSpace.innerHTML = '&nbsp;';
    targetDiv.appendChild(trailingSpace);
}

// Display word statistics
async function displayWordStats(words, wordResults) {
    const statsDiv = document.getElementById('debug-display');
    statsDiv.innerHTML = '';
    
    const wordStats = await getWordStats();
    const uniqueWords = [...new Set(words.map(w => w.toLowerCase()))];
    const testStats = {};
    
    // Calculate test stats
    for (let i = 0; i < words.length; i++) {
        const word = words[i].toLowerCase();
        if (!testStats[word]) {
            testStats[word] = { successes: 0, failures: 0 };
        }
        if (wordResults[i]) {
            testStats[word].successes += 1;
        } else {
            testStats[word].failures += 1;
        }
    }
    
    // Display statistics (single block, matching the pre-test view)
    const lines = ['=== RESULTS ==='];
    const rows = uniqueWords.map(word => {
        const before = wordStats[word] || { successes: 0, failures: 0 };
        const delta = testStats[word] || { successes: 0, failures: 0 };
        const after = {
            successes: before.successes + delta.successes,
            failures: before.failures + delta.failures
        };
        const n = after.successes + after.failures;
        const errRate = n > 0 ? after.failures / n : null;

        return [
            word,
            `${delta.successes}/${delta.successes + delta.failures}`,
            `[${before.successes}, ${before.failures}]`,
            `[${after.successes}, ${after.failures}]`,
            String(n),
            errRate === null ? '-' : (errRate * 100).toFixed(0) + '%'
        ];
    });

    lines.push(...formatTable(
        ['word', 'this test', 'before', 'after', 'n', 'err%'],
        rows,
        [1, 2, 3, 4, 5]
    ));

    const statLine = document.createElement('div');
    statLine.classList.add('stat-line');
    statLine.textContent = lines.join('\n');
    statsDiv.appendChild(statLine);

    // The panel was cleared above, so restore the keystroke log
    if (typingTest) typingTest.renderKeyLog();
}

// Keys that are blocked while typing a test.
//
// The test engine assumes the typed text is append-only: handleInput() treats
// the last character of the input as "the character just typed" and indexes
// charEverWrong by absolute position. Anything that moves the caret or edits
// mid-string breaks that invariant, so those keys are suppressed.
//
// Printable characters are deliberately NOT filtered against the target text:
// a wrong keystroke must register as an error, that's the point of the app.
const BLOCKED_KEYS = new Set([
    'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
    'Home', 'End', 'PageUp', 'PageDown',
    'Delete', 'Enter'
]);

// Ctrl/Cmd combos that would corrupt the typed text (select-all, cut, paste,
// undo, redo). Everything else (Ctrl+R, Ctrl+T, devtools, ...) is left alone.
const BLOCKED_CTRL_KEYS = new Set(['a', 'x', 'v', 'z', 'y']);

// Modifier keys that are logged as part of a combo rather than on their own
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock']);

// Render a keydown event as a compact string for the keystroke log.
// Printable characters appear as-is; everything else uses the browser's own
// KeyboardEvent.key name in brackets, e.g. <backspace>, <arrowleft>.
function formatKeyForLog(e) {
    const isPrintable = e.key.length === 1;

    // Backspace is by far the most common non-printable key, so keep it short
    const name = e.key === 'Backspace' ? 'BS' : e.key.toLowerCase();

    const modifiers = [];
    if (e.ctrlKey) modifiers.push('ctrl');
    if (e.metaKey) modifiers.push('cmd');
    if (e.altKey) modifiers.push('alt');

    if (modifiers.length > 0) {
        return `<${modifiers.join('+')}+${name}>`;
    }

    return isPrintable ? e.key : `<${name}>`;
}

// Run typing test
class TypingTest {
    constructor() {
        this.targetText = '';
        this.typedText = '';
        this.startTime = null;
        this.charEverWrong = new Set();
        this.words = [];
        this.currentWpmThreshold = OPTIONS.minWpm;
        this.attemptCount = 0;
        this.tabbingAway = false;
        this.keyLog = [];  // [{ text, blocked }] keystrokes for the debug panel
        // word (lowercased) -> per-letter error counts, accumulated across the
        // attempts of the current test and used to colour hints on retries
        this.wordErrorCounts = {};
        // Per-character outcomes for the current test ('1' correct, '0'
        // mistyped), in typing order. Flushed to the DB when the test completes.
        this.charOutcomes = {};
        
        this.inputElement = document.getElementById('typing-input');
        this.resultsElement = document.getElementById('results');
        
        this.setupEventListeners();
    }
    
    setupEventListeners() {
        this.inputElement.addEventListener('input', (e) => this.handleInput(e));
        this.inputElement.addEventListener('paste', (e) => e.preventDefault());
        this.inputElement.addEventListener('drop', (e) => e.preventDefault());

        // Filter keys that would move the caret or edit mid-string
        this.inputElement.addEventListener('keydown', (e) => {
            // Record every keystroke (except bare modifiers) for the debug panel
            const logEntry = MODIFIER_KEYS.has(e.key)
                ? null
                : { text: formatKeyForLog(e), blocked: false };
            if (logEntry) {
                this.keyLog.push(logEntry);
                if (this.keyLog.length > 300) this.keyLog.shift();
            }

            // Tab is allowed through so the page stays keyboard-navigable.
            // Flag it so the blur handler below doesn't steal focus back.
            if (e.key === 'Tab') {
                this.tabbingAway = true;
                return;
            }

            if (BLOCKED_KEYS.has(e.key)) {
                if (logEntry) logEntry.blocked = true;
                e.preventDefault();
                return;
            }

            // Ctrl/Cmd + A/X/V/Z/Y
            if ((e.ctrlKey || e.metaKey) && BLOCKED_CTRL_KEYS.has(e.key.toLowerCase())) {
                if (logEntry) logEntry.blocked = true;
                e.preventDefault();
                return;
            }

            // Delete-word-backwards (Ctrl/Alt/Cmd + Backspace).
            // Handled manually rather than left to the browser: the native
            // behaviour can select/replace text in ways the append-only engine
            // rejects, so we compute the truncation ourselves.
            if (e.key === 'Backspace' && (e.ctrlKey || e.metaKey || e.altKey)) {
                e.preventDefault();
                this.deleteWordBackwards();
            }

            if (logEntry) this.renderKeyLog();
        });

        // A mouse click or drag-select can also move the caret, so pin it to the
        // end whenever the selection changes.
        const pinCaret = () => {
            const end = this.inputElement.value.length;
            if (this.inputElement.selectionStart !== end || this.inputElement.selectionEnd !== end) {
                this.inputElement.setSelectionRange(end, end);
            }
        };
        this.inputElement.addEventListener('click', pinCaret);
        this.inputElement.addEventListener('select', pinCaret);
        this.inputElement.addEventListener('focus', () => {
            // Clear a stale Tab flag (e.g. Tab pressed with nowhere to move to)
            this.tabbingAway = false;
            pinCaret();
        });
        this.inputElement.addEventListener('mouseup', pinCaret);

        // Focus input when clicking anywhere on the page (except buttons, links and debug display)
        document.addEventListener('click', (e) => {
            if (!e.target.matches('button, a, .debug-btn, .info-link') &&
                !e.target.closest('#debug-display')) {
                this.inputElement.focus();
            }
        });
        
        // Keep input focused, but not when the user is selecting text in the debug display
        document.addEventListener('blur', (e) => {
            if (e.target === this.inputElement) {
                // The user pressed Tab: let focus move on normally.
                if (this.tabbingAway) {
                    this.tabbingAway = false;
                    return;
                }
                setTimeout(() => {
                    const debugDisplay = document.getElementById('debug-display');
                    if (debugDisplay && debugDisplay.contains(document.activeElement)) return;
                    if (debugDisplay && debugDisplay.contains(document.getSelection()?.anchorNode)) return;
                    this.inputElement.focus();
                }, 0);
            }
        }, true);
    }
    
    // Delete back to the start of the current word (Ctrl/Alt/Cmd + Backspace).
    // Trailing spaces are consumed first, then the word before them — matching
    // the usual behaviour of text inputs.
    deleteWordBackwards() {
        if (this.typedText.length === 0) return;

        let end = this.typedText.length;
        while (end > 0 && this.typedText[end - 1] === ' ') end--;
        while (end > 0 && this.typedText[end - 1] !== ' ') end--;

        this.typedText = this.typedText.slice(0, end);
        this.inputElement.value = this.typedText;
        this.inputElement.setSelectionRange(end, end);

        // Erasing everything is a clean restart (see clearIfEmpty). Otherwise
        // charEverWrong is left untouched: a letter that was mistyped stays
        // flagged as "corrected" once retyped, as with a plain backspace.
        this.clearIfEmpty();
        this.renderTarget();
    }

    // Deleting everything back to an empty input restarts the attempt: the
    // timer and the error flags are cleared, so a fumbled start can be retried
    // from scratch rather than being penalised for the rest of the test.
    clearIfEmpty() {
        if (this.typedText.length > 0) return false;

        this.startTime = null;
        this.charEverWrong = new Set();
        this.charOutcomes = {};
        return true;
    }

    // Walk the word occurrences of the current attempt and record, for each
    // fully-typed occurrence, the index of its FIRST mistyped letter.
    // Returns { word: number[] } with one entry per letter index.
    collectAttemptErrorCounts() {
        const counts = {};
        let charIndex = 0;

        for (const word of this.words) {
            const end = charIndex + word.length;

            // Only count occurrences the user has already typed through,
            // otherwise a word would be scored before it has been attempted.
            if (this.typedText.length >= end) {
                for (let i = 0; i < word.length; i++) {
                    if (this.charEverWrong.has(charIndex + i)) {
                        const key = word.toLowerCase();
                        if (!counts[key]) counts[key] = new Array(word.length).fill(0);
                        counts[key][i]++;
                        break;  // only the first mistake of this occurrence
                    }
                }
            }

            charIndex = end + 1;  // +1 for the space
        }

        return counts;
    }

    // Merge `source` error counts into `target` (mutates target)
    static mergeErrorCounts(target, source) {
        for (const [word, letters] of Object.entries(source)) {
            if (!target[word]) target[word] = new Array(letters.length).fill(0);
            letters.forEach((n, i) => { target[word][i] += n; });
        }
        return target;
    }

    // Hints = errors from previous attempts + those of the attempt in progress,
    // so a repeated word is already tinted later in the same run.
    getHintCounts() {
        const combined = {};
        TypingTest.mergeErrorCounts(combined, this.wordErrorCounts);
        TypingTest.mergeErrorCounts(combined, this.collectAttemptErrorCounts());
        return combined;
    }

    renderTarget() {
        displayTargetText(this.targetText, this.typedText, this.charEverWrong, this.getHintCounts());
    }

    // Render the keystroke log at the top of the debug panel.
    // Rebuilt on demand because the debug panel is cleared on each redraw.
    renderKeyLog() {
        const statsDiv = document.getElementById('debug-display');
        if (!statsDiv) return;

        let block = statsDiv.querySelector('#key-log');
        if (!block) {
            block = document.createElement('div');
            block.id = 'key-log';
            block.classList.add('stat-line');
            statsDiv.insertBefore(block, statsDiv.firstChild);
        }

        block.innerHTML = '';

        const title = document.createElement('div');
        title.textContent = '=== KEYSTROKES ===';
        block.appendChild(title);

        const seq = document.createElement('div');
        seq.classList.add('key-log-sequence');
        for (const entry of this.keyLog) {
            const span = document.createElement('span');
            span.textContent = entry.text;
            if (entry.blocked) span.classList.add('key-blocked');
            seq.appendChild(span);
        }
        block.appendChild(seq);

        const spacer = document.createElement('div');
        spacer.textContent = '\u00a0';
        block.appendChild(spacer);
    }

    async displayInitialWordStats() {
        const statsDiv = document.getElementById('debug-display');
        statsDiv.innerHTML = '';
        
        const lines = [];

        // Mixed super-mode info
        if (isMixedModeActive && mixedPlaylist.length > 0) {
            lines.push('=== MIXED MODE ===');
            mixedPlaylist.forEach((seg, i) => {
                const count = seg.mode.options?.mixedModeCount || 1;
                const isCurrent = i === mixedSegmentIndex;
                const done = isCurrent ? mixedTestsDoneInSegment : (i < mixedSegmentIndex ? count : 0);
                const marker = isCurrent ? '▶' : ' ';
                lines.push(`${marker} [${i + 1}] ${seg.mode.name}: ${isCurrent ? done : ''}${isCurrent ? '/' : ''}${count} tests`);
            });
            lines.push('');
        }

        // Options
        lines.push('=== OPTIONS ===');
        for (const [key, val] of Object.entries(OPTIONS)) {
            lines.push(`${key}: ${val}`);
        }
        lines.push('');
        
        // Word stats
        const wordStats = await getWordStats();
        const uniqueWords = [...new Set(this.words.map(w => w.toLowerCase()))];

        lines.push('=== WORDS ===');
        const rows = uniqueWords.map(word => {
            const stats = wordStats[word] || { successes: 0, failures: 0 };
            const n = stats.successes + stats.failures;
            const errRate = n > 0 ? stats.failures / n : null;
            const freq = WORDS[word];
            const interest = getWordInterest(OPTIONS, word, stats, false);

            return [
                word,
                String(word.length),
                String(countFingers(word)),
                String(stats.successes),
                String(stats.failures),
                String(n),
                errRate === null ? '-' : (errRate * 100).toFixed(0) + '%',
                freq === undefined ? '-' : freq.toExponential(1),
                interest.toExponential(2)
            ];
        });

        lines.push(...formatTable(
            ['word', 'len', 'fing', 'ok', 'err', 'n', 'err%', 'freq', 'interest'],
            rows,
            [1, 2, 3, 4, 5, 6, 7, 8]
        ));
        lines.push('');
        
        const statLine = document.createElement('div');
        statLine.classList.add('stat-line');
        statLine.textContent = lines.join('\n');
        statsDiv.appendChild(statLine);

        this.renderKeyLog();
    }
    
    async startNewTest() {
        // Select words
        let practiceWords = await selectWordsToPractice(
            OPTIONS.numWords,
            OPTIONS.minWordLength,
            OPTIONS.maxWordLength
        );
        
        // Guard against empty word list
        if (practiceWords.length === 0) {
            practiceWords = ['the', 'and', 'for'];
        }
        
        // Apply capitalization
        if (OPTIONS.capitalize === 'yes') {
            practiceWords = practiceWords.map(w => w.charAt(0).toUpperCase() + w.slice(1));
        } else if (OPTIONS.capitalize === 'random') {
            practiceWords = practiceWords.map(w => Math.random() < 0.2 ? w.charAt(0).toUpperCase() + w.slice(1) : w);
        }
        
        // Repeat words
        this.words = [];
        for (let i = 0; i < OPTIONS.repetition; i++) {
            this.words.push(...practiceWords);
        }
        
        this.targetText = this.words.join(' ');
        this.typedText = '';
        this.startTime = null;
        this.charEverWrong = new Set();
        this.currentWpmThreshold = OPTIONS.minWpm;
        this.attemptCount = 0;
        this.keyLog = [];
        this.wordErrorCounts = {};
        this.charOutcomes = {};
        
        this.inputElement.value = '';
        this.inputElement.disabled = false;
        this.inputElement.focus();
        this.resultsElement.innerHTML = '';
        this.resultsElement.className = 'results';
        
        this.renderTarget();
        
        // Display initial word statistics (before test)
        await this.displayInitialWordStats();
    }
    
    handleInput(e) {
        const previous = this.typedText;
        this.typedText = e.target.value;

        // Safety net: the engine requires append-only edits at the end of the
        // string. If anything produced a mid-string edit (IME, mobile autofill,
        // an unblocked shortcut), reject it and restore the previous value.
        const isAppend = this.typedText.startsWith(previous);
        const isTruncation = previous.startsWith(this.typedText);
        if (!isAppend && !isTruncation) {
            this.typedText = previous;
            this.inputElement.value = previous;
            this.inputElement.setSelectionRange(previous.length, previous.length);
            return;
        }

        // Ignore leading space
        if (this.typedText.length === 1 && this.typedText[0] === ' ') {
            this.inputElement.value = '';
            this.typedText = '';
            this.clearIfEmpty();
            return;
        }

        // Erased everything: restart the attempt with a clean timer and no
        // errors recorded, then redraw so the hints drop back to neutral.
        if (this.typedText.length === 0) {
            this.clearIfEmpty();
            this.renderTarget();
            return;
        }
        
        // Limit input to target length
        if (this.typedText.length > this.targetText.length) {
            this.typedText = this.typedText.slice(0, this.targetText.length);
            this.inputElement.value = this.typedText;
        }
        
        // Start timer when typing begins (ensure it's always set)
        if (this.startTime === null && this.typedText.length > 0) {
            this.startTime = Date.now();
        }
        
        // Check current character
        if (this.typedText.length > 0 && this.typedText.length <= this.targetText.length) {
            const currentIndex = this.typedText.length - 1;
            const isCorrect = this.typedText[currentIndex] === this.targetText[currentIndex];
            const expected = this.targetText[currentIndex];

            // Only count a new keystroke, not the re-check that happens when
            // backspace shortens the text back onto an already-typed index.
            if (this.typedText.length > previous.length) {
                this.charOutcomes[expected] = (this.charOutcomes[expected] || '') + (isCorrect ? '1' : '0');
            }

            if (!isCorrect) {
                this.charEverWrong.add(currentIndex);
                addMistypedChar(this.targetText[currentIndex]);
            }
        }
        
        this.renderTarget();
        
        // Check if test is complete
        if (this.typedText.length === this.targetText.length && this.typedText === this.targetText) {
            this.completeTest();
        }
    }
    
    async completeTest() {
        this.inputElement.disabled = true;
        
        // Ensure startTime is set (fallback to prevent undefined WPM)
        if (this.startTime === null) {
            this.startTime = Date.now();
        }
        
        // Calculate results
        const elapsedTime = (Date.now() - this.startTime) / 1000;
        const elapsedMinutes = elapsedTime / 60;
        const numChars = this.targetText.length;
        const wpm = (numChars / 5) / elapsedMinutes;
        
        // Determine word results
        const wordResults = [];
        let charIndex = 0;
        
        for (const word of this.words) {
            let wordHadError = false;
            for (let i = 0; i < word.length; i++) {
                if (this.charEverWrong.has(charIndex + i)) {
                    wordHadError = true;
                    break;
                }
            }
            wordResults.push(!wordHadError);
            charIndex += word.length + 1; // +1 for space
        }
        
        const hadErrors = wordResults.some(r => !r);
        const errorCount = wordResults.filter(r => !r).length;
        const wpmRounded = Math.round(wpm);
        const wpmPassed = this.currentWpmThreshold === null || this.currentWpmThreshold === 0 || wpmRounded >= this.currentWpmThreshold;
        const errorPassed = OPTIONS.allowError || !hadErrors;
        const testPassed = wpmPassed && errorPassed;

        // Chords mode moves straight on after a success instead of waiting for Enter
        const autoAdvance = testPassed && ACTIVE_MODE_KEY === 'chords';

        // Display results
        if (testPassed) {
            this.resultsElement.className = 'results success';
            this.resultsElement.innerHTML = `
                <div class="result-metric">${wpm.toFixed(0)} WPM</div>
                <div class="result-metric">${errorCount} Error${errorCount !== 1 ? 's' : ''}</div>
                <div class="result-status success-text">✓ Success</div>
                <div class="result-next">${autoAdvance ? '' : 'Press Enter for next test'}</div>
            `;
        } else {
            this.resultsElement.className = 'results retry';
            let statusText = '✗ Failed';
            if (!wpmPassed) {
                statusText += ` (need ${this.currentWpmThreshold.toFixed(0)} WPM)`;
            }
            this.resultsElement.innerHTML = `
                <div class="result-metric">${wpm.toFixed(0)} WPM</div>
                <div class="result-metric">${errorCount} Error${errorCount !== 1 ? 's' : ''}</div>
                <div class="result-status retry-text">${statusText}</div>
                <div class="result-next">Press Enter to ${this.attemptCount >= OPTIONS.maxTestRepeat ? 'continue' : 'retry'}</div>
            `;
        }
        
        // Display word statistics
        await displayWordStats(this.words, wordResults);

        // Practice-only modes (recordStats: false) leave the saved statistics
        // untouched, so drilling the same word doesn't distort its error rate.
        if (OPTIONS.recordStats !== false) {
            await updateWordStats(this.words, wordResults);
            // Flush per-character outcomes for this attempt
            await mergeCharStats(this.charOutcomes);
        }

        // Reset either way so a retry doesn't double-count what was stored.
        this.charOutcomes = {};
        
        // Check if slow mode (numWords = 1)
        const isSlowMode = OPTIONS.numWords === 1;
        
        if (autoAdvance) {
            // Chords mode: show the success briefly, then start the next test
            setTimeout(() => this.nextTest(), 300);
        } else if (isSlowMode && !testPassed && this.attemptCount < OPTIONS.maxTestRepeat) {
            // Slow mode: auto-retry without Enter key
            this.attemptCount++;
            
            // Brief delay before resetting
            setTimeout(() => {
                // Fold this attempt's mistakes into the hint totals first:
                // collecting depends on typedText/charEverWrong, cleared below.
                TypingTest.mergeErrorCounts(this.wordErrorCounts, this.collectAttemptErrorCounts());
                this.typedText = '';
                this.startTime = null;
                this.charEverWrong = new Set();
                this.keyLog = [];
                this.inputElement.value = '';
                this.inputElement.disabled = false;
                this.inputElement.focus();
                this.resultsElement.innerHTML = '';
                this.resultsElement.className = 'results';
                this.renderTarget();
                this.renderKeyLog();
            }, 300);
        } else {
            // Normal mode or test passed: wait for Enter key to proceed
            const handleEnter = (e) => {
                if (e.key === 'Enter') {
                    document.removeEventListener('keydown', handleEnter);
                    
                    if (testPassed) {
                        this.nextTest();
                    } else {
                        this.attemptCount++;
                        
                        if (this.attemptCount >= OPTIONS.maxTestRepeat) {
                            this.nextTest();
                        } else {
                            // Progressive difficulty
                            if (errorPassed && !wpmPassed && OPTIONS.wpmReduction > 0) {
                                this.currentWpmThreshold = Math.max(0, this.currentWpmThreshold - OPTIONS.wpmReduction);
                            }
                            
                            // Reset for retry
                            // Fold this attempt's mistakes into the hint totals
                            // before the state they depend on is cleared.
                            TypingTest.mergeErrorCounts(this.wordErrorCounts, this.collectAttemptErrorCounts());
                            this.typedText = '';
                            this.startTime = null;
                            this.charEverWrong = new Set();
                            this.keyLog = [];
                            this.inputElement.value = '';
                            this.inputElement.disabled = false;
                            this.inputElement.focus();
                            this.resultsElement.innerHTML = '';
                            this.resultsElement.className = 'results';
                            this.renderTarget();
                            this.renderKeyLog();
                        }
                    }
                }
            };
            
            document.addEventListener('keydown', handleEnter);
        }
    }
    
    nextTest() {
        if (isMixedModeActive) {
            advanceMixed();
        } else {
            this.startNewTest();
        }
    }

    cleanup() {
        // No special cleanup needed for normal mode
        // Event listeners are one-time or will be overwritten
    }
}

// Initialize app
let currentSlowCleanup = null;
let isSlowModeActive = false;

// Mixed super-mode state
let isMixedModeActive = false;
let mixedPlaylist = []; // [{key, mode}] ordered, skipping count=0 and 'mixed'
let mixedSegmentIndex = 0;
let mixedTestsDoneInSegment = 0;
let typingTest = null; // module-level reference to the single TypingTest instance

function buildMixedPlaylist(modes) {
    return Object.entries(modes)
        .filter(([key, mode]) => key !== 'mixed' && mode.options && (mode.options.mixedModeCount || 0) > 0)
        .map(([key, mode]) => ({ key, mode }));
}

function applyMixedSegment() {
    const segment = mixedPlaylist[mixedSegmentIndex];
    OPTIONS = segment.mode.options;
    ACTIVE_MODE_KEY = segment.key;
    const isSlowSegment = segment.key === 'slow' || segment.mode.name?.toLowerCase() === 'slow';
    if (isSlowSegment) {
        selectWordsToPractice(1, OPTIONS.minWordLength, OPTIONS.maxWordLength).then(words => {
            const word = (words[0] || 'company').toLowerCase();
            enterSlowMode(word);
        });
    } else {
        if (isSlowModeActive) exitSlowMode();
        typingTest.startNewTest();
    }
}

function advanceMixed() {
    const segment = mixedPlaylist[mixedSegmentIndex];
    const count = segment.mode.options.mixedModeCount || 1;
    mixedTestsDoneInSegment++;
    if (mixedTestsDoneInSegment >= count) {
        mixedTestsDoneInSegment = 0;
        mixedSegmentIndex = (mixedSegmentIndex + 1) % mixedPlaylist.length;
    }
    saveMixedProgress(mixedSegmentIndex, mixedTestsDoneInSegment).catch(e => console.error('Failed to save mixed progress:', e));
    applyMixedSegment();
}

function stopMixedMode() {
    isMixedModeActive = false;
    mixedPlaylist = [];
    mixedSegmentIndex = 0;
    mixedTestsDoneInSegment = 0;
}

function enterSlowMode(word) {
    isSlowModeActive = true;

    // Hide normal test UI
    const testDisplay = document.getElementById('test-display');
    const inputArea = document.querySelector('.input-area');
    const results = document.getElementById('results');
    const debugDisplay = document.getElementById('debug-display');
    if (testDisplay) testDisplay.style.display = 'none';
    if (inputArea) inputArea.style.display = 'none';
    if (results) results.style.display = 'none';
    if (debugDisplay) debugDisplay.style.display = 'none';

    // Show slow mode UI
    const slowContainer = document.getElementById('slow-mode-container');
    if (slowContainer) slowContainer.style.display = '';

    // Cleanup previous slow mode if any
    if (currentSlowCleanup) {
        currentSlowCleanup();
        currentSlowCleanup = null;
    }

    // Reset status/counter text
    const slowStatus = document.getElementById('slowStatus');
    if (slowStatus) { slowStatus.textContent = 'Start typing when ready...'; slowStatus.className = 'slow-status'; }
    const slowCounter = document.getElementById('slowCounter');
    if (slowCounter) slowCounter.textContent = '0 reps';
    const timingDisplay = document.getElementById('timingDisplay');
    if (timingDisplay) timingDisplay.innerHTML = '';

    currentSlowCleanup = initSlowMode({
        word: word,
        initialWpm: 12,
        targetWpm: 30,
        ballId: 'ball',
        wordDisplayId: 'wordDisplay',
        statusId: 'slowStatus',
        counterId: 'slowCounter',
        timingDisplayId: 'timingDisplay',
        onComplete: (result) => {
            console.log('Slow mode completed!', result);
            const slowStatus = document.getElementById('slowStatus');
            if (slowStatus) {
                slowStatus.textContent = 'Done! Press Enter for next word.';
                slowStatus.className = 'slow-status success';
            }
            const handleEnter = async (e) => {
                if (e.key === 'Enter') {
                    document.removeEventListener('keydown', handleEnter);
                    if (isMixedModeActive) {
                        advanceMixed();
                    } else {
                        let words = await selectWordsToPractice(1, OPTIONS.minWordLength, OPTIONS.maxWordLength);
                        const nextWord = (words[0] || 'company').toLowerCase();
                        enterSlowMode(nextWord);
                    }
                }
            };
            document.addEventListener('keydown', handleEnter);
        }
    });
}

function exitSlowMode() {
    isSlowModeActive = false;

    if (currentSlowCleanup) {
        currentSlowCleanup();
        currentSlowCleanup = null;
    }

    // Hide slow mode UI
    const slowContainer = document.getElementById('slow-mode-container');
    if (slowContainer) slowContainer.style.display = 'none';
    const timingDisplay = document.getElementById('timingDisplay');
    if (timingDisplay) timingDisplay.innerHTML = '';

    // Show normal test UI
    const testDisplay = document.getElementById('test-display');
    const inputArea = document.querySelector('.input-area');
    const results = document.getElementById('results');
    const debugDisplay = document.getElementById('debug-display');
    if (testDisplay) testDisplay.style.display = '';
    if (inputArea) inputArea.style.display = '';
    if (results) results.style.display = '';
    if (debugDisplay) debugDisplay.style.display = '';
}

async function init() {
    // Setup navigation buttons immediately (no DB needed)
    const statsBtn = document.getElementById('stats-btn');
    if (statsBtn) {
        statsBtn.addEventListener('click', () => {
            window.location.href = 'stats.html';
        });
    }
    
    const optionsBtn = document.getElementById('options-btn');
    if (optionsBtn) {
        optionsBtn.addEventListener('click', () => {
            window.location.href = 'options.html';
        });
    }

    try {
        db = await initDB();
    } catch (e) {
        console.error('Failed to init DB:', e);
    }
    
    let startupKey = null;
    try {
        // Load options from active mode in DB
        const modes = await loadModes();
        startupKey = await loadActiveMode();
        if (modes[startupKey]) {
            OPTIONS = modes[startupKey].options || OPTIONS;
            ACTIVE_MODE_KEY = startupKey;
        }
    } catch (e) {
        console.error('Failed to load modes:', e);
    }

    try {
        // Load the user's keyboard layout so finger counts reflect it
        KEYMAP = await loadKeymap();
        rebuildCharToFinger();
    } catch (e) {
        console.error('Failed to load keymap:', e);
    }

    typingTest = new TypingTest();
    const test = typingTest;
    // Note: the actual test/mode is started at the end of init(), once the
    // mode buttons exist, so that slow/mixed can be restored correctly.
    
    // Setup debug button
    const debugBtn = document.getElementById('debug-btn');
    const wordStatsDiv = document.getElementById('debug-display');
    let debugMode = false;
    
    if (debugBtn && wordStatsDiv) {
        debugBtn.addEventListener('click', () => {
            debugMode = !debugMode;
            if (debugMode) {
                debugBtn.classList.add('active');
                wordStatsDiv.classList.add('visible');
            } else {
                debugBtn.classList.remove('active');
                wordStatsDiv.classList.remove('visible');
            }
        });
    }
    
    // Setup dynamic mode buttons
    const modeButtonsContainer = document.querySelector('.mode-buttons');
    if (modeButtonsContainer) {
        modeButtonsContainer.innerHTML = '';
        const modes = await loadModes();
        const activeMode = await loadActiveMode();
        for (const [key, mode] of Object.entries(modes)) {
            if (key === 'slow' || mode.name?.toLowerCase() === 'slow') continue;
            if (key === 'mixed' || mode.name?.toLowerCase() === 'mixed') continue;
            const btn = document.createElement('button');
            btn.classList.add('mode-btn');
            if (key === activeMode && !isSlowModeActive) btn.classList.add('active');
            btn.textContent = mode.name;
            btn.addEventListener('click', async () => {
                if (isMixedModeActive) stopMixedMode();
                if (isSlowModeActive) exitSlowMode();
                await saveActiveMode(key);
                OPTIONS = mode.options;
                ACTIVE_MODE_KEY = key;
                // Update active style
                modeButtonsContainer.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                test.startNewTest();
            });
            modeButtonsContainer.appendChild(btn);
        }

        // Add Slow button
        const slowBtn = document.createElement('button');
        slowBtn.classList.add('mode-btn');
        if (isSlowModeActive) slowBtn.classList.add('active');
        slowBtn.textContent = 'Slow';
        slowBtn.addEventListener('click', async () => {
            if (isSlowModeActive) return; // already in slow mode
            if (isMixedModeActive) stopMixedMode();
            await saveActiveMode('slow');
            modeButtonsContainer.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
            slowBtn.classList.add('active');
            // Pick first word from current selection
            let words = await selectWordsToPractice(1, OPTIONS.minWordLength, OPTIONS.maxWordLength);
            const word = (words[0] || 'company').toLowerCase();
            enterSlowMode(word);
        });
        modeButtonsContainer.appendChild(slowBtn);

        // Mixed button (only if 'mixed' key exists in modes) — full-width, below the row
        let mixedBtn = null;
        if (modes['mixed']) {
            mixedBtn = document.createElement('button');
            mixedBtn.classList.add('mode-btn', 'mode-btn-wide');
            mixedBtn.textContent = 'Mixed';
            mixedBtn.addEventListener('click', async () => {
                if (isMixedModeActive) return;
                if (isSlowModeActive) exitSlowMode();
                const freshModes = await loadModes();
                const playlist = buildMixedPlaylist(freshModes);
                if (playlist.length === 0) return;
                stopMixedMode();
                await saveActiveMode('mixed');
                // Resume the rotation where it was left off
                const progress = await loadMixedProgress();
                isMixedModeActive = true;
                mixedPlaylist = playlist;
                mixedSegmentIndex = progress.segmentIndex % playlist.length;
                const segCount = playlist[mixedSegmentIndex].mode.options.mixedModeCount || 1;
                mixedTestsDoneInSegment = Math.min(progress.testsDoneInSegment, segCount - 1);
                modeButtonsContainer.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
                mixedBtn.classList.add('active');
                applyMixedSegment();
            });
            modeButtonsContainer.appendChild(mixedBtn);
        }

        // --- Restore the previously active mode ---
        if (startupKey === 'mixed' && mixedBtn) {
            const playlist = buildMixedPlaylist(modes);
            if (playlist.length > 0) {
                const progress = await loadMixedProgress();
                isMixedModeActive = true;
                mixedPlaylist = playlist;
                // Clamp in case the playlist shrank since last session
                mixedSegmentIndex = progress.segmentIndex % playlist.length;
                const segCount = playlist[mixedSegmentIndex].mode.options.mixedModeCount || 1;
                mixedTestsDoneInSegment = Math.min(progress.testsDoneInSegment, segCount - 1);
                modeButtonsContainer.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
                mixedBtn.classList.add('active');
                applyMixedSegment();
            } else {
                test.startNewTest();
            }
        } else if (startupKey === 'slow') {
            modeButtonsContainer.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
            slowBtn.classList.add('active');
            const words = await selectWordsToPractice(1, OPTIONS.minWordLength, OPTIONS.maxWordLength);
            enterSlowMode((words[0] || 'company').toLowerCase());
        } else {
            test.startNewTest();
        }
    } else {
        test.startNewTest();
    }
}

init();
