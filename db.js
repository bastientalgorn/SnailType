// Shared IndexedDB setup
const DB_NAME = 'TypingTestDB';
const DB_VERSION = 2;
let db;

const DEFAULT_MODES = {
    "sprint": {
        name: "Sprint",
        options: {
            minWordLength: 3,
            maxWordLength: 20,
            numWords: 25,
            repetition: 1,
            minWpm: 0,
            allowError: true,
            maxTestRepeat: 1,
            wpmReduction: 0,
            useFrequency: true,
            useErrorRate: false,
            favorNewWords: false,
            capitalize: 'no',
            normalizeErrorByLength: false,
            recordStats: true,
            mixedModeCount: 1
        }
    },
    "general": {
        name: "General",
        options: {
            minWordLength: 3,
            maxWordLength: 20,
            numWords: 50,
            repetition: 1,
            minWpm: 0,
            allowError: true,
            maxTestRepeat: 1,
            wpmReduction: 0,
            useFrequency: false,
            useErrorRate: false,
            favorNewWords: true,
            capitalize: 'no',
            normalizeErrorByLength: false,
            recordStats: true,
            mixedModeCount: 2
        }
    },
    "targeted": {
        name: "Focus",
        options: {
            minWordLength: 3,
            maxWordLength: 20,
            numWords: 3,
            repetition: 3,
            minWpm: 60,
            allowError: false,
            maxTestRepeat: 10,
            wpmReduction: 5,
            useFrequency: false,
            useErrorRate: true,
            favorNewWords: false,
            capitalize: 'no',
            normalizeErrorByLength: false,
            recordStats: true,
            mixedModeCount: 5
        }
    },
    "drill": {
        name: "Drill",
        options: {
            minWordLength: 3,
            maxWordLength: 20,
            numWords: 1,
            repetition: 10,
            minWpm: 80,
            allowError: false,
            maxTestRepeat: 10,
            wpmReduction: 5,
            useFrequency: false,
            useErrorRate: true,
            favorNewWords: false,
            capitalize: 'no',
            normalizeErrorByLength: false,
            recordStats: true,
            mixedModeCount: 5
        }
    },
    "chords": {
        name: "Chords",
        options: {
            minWordLength: 3,
            maxWordLength: 5,
            numWords: 1,
            repetition: 1,
            minWpm: 200,
            allowError: false,
            maxTestRepeat: 10,
            wpmReduction: 5,
            useFrequency: false,
            useErrorRate: false,
            favorNewWords: false,
            capitalize: 'no',
            normalizeErrorByLength: false,
            recordStats: false,
            mixedModeCount: 10
        }
    },
    "slow": {
        name: "Slow",
        options: {
            minWordLength: 3,
            maxWordLength: 20,
            numWords: 1,
            repetition: 1,
            minWpm: 40,
            allowError: false,
            maxTestRepeat: 100,
            wpmReduction: 0,
            useFrequency: false,
            useErrorRate: true,
            favorNewWords: false,
            capitalize: 'no',
            normalizeErrorByLength: false,
            recordStats: false,
            mixedModeCount: 1
        }
    },
    "mixed": {
        name: "Mixed"
    }
};

const DEFAULT_MIXED_TARGETED_COUNT = 5;

// Option field definitions (shared validation schema)
const OPTION_FIELDS = [
    { key: 'minWordLength', type: 'number', min: 1, max: 50 },
    { key: 'maxWordLength', type: 'number', min: 1, max: 50 },
    { key: 'numWords', type: 'number', min: 1, max: 1000 },
    { key: 'repetition', type: 'number', min: 1, max: 1000 },
    { key: 'minWpm', type: 'number', min: 0, max: 500 },
    { key: 'allowError', type: 'boolean' },
    { key: 'maxTestRepeat', type: 'number', min: 1, max: 100 },
    { key: 'wpmReduction', type: 'number', min: 0, max: 1000 },
    { key: 'useFrequency', type: 'boolean' },
    { key: 'useErrorRate', type: 'boolean' },
    { key: 'favorNewWords', type: 'boolean' },
    { key: 'capitalize', type: 'enum', values: ['no', 'yes', 'random'] },
    { key: 'normalizeErrorByLength', type: 'boolean' },
    { key: 'recordStats', type: 'boolean' },
    { key: 'mixedModeCount', type: 'number', min: 0, max: 100 }
];

// Reference default options (first mode's options as fallback for any field)
const REFERENCE_OPTIONS = DEFAULT_MODES["targeted"].options;

// Validate and sanitize a single options object. Always returns a valid object.
function sanitizeOptions(options) {
    if (!options || typeof options !== 'object') {
        return Object.assign({}, REFERENCE_OPTIONS);
    }

    const sanitized = {};
    for (const field of OPTION_FIELDS) {
        const val = options[field.key];
        const fallback = REFERENCE_OPTIONS[field.key];

        if (field.type === 'number') {
            const num = Number(val);
            if (!Number.isFinite(num) || !Number.isInteger(num)) {
                sanitized[field.key] = fallback;
            } else {
                sanitized[field.key] = Math.max(field.min, Math.min(field.max, num));
            }
        } else if (field.type === 'boolean') {
            if (typeof val === 'boolean') {
                sanitized[field.key] = val;
            } else if (val === 'true') {
                sanitized[field.key] = true;
            } else if (val === 'false') {
                sanitized[field.key] = false;
            } else {
                sanitized[field.key] = fallback;
            }
        } else if (field.type === 'enum') {
            if (field.values.includes(val)) {
                sanitized[field.key] = val;
            } else {
                sanitized[field.key] = fallback;
            }
        }
    }

    // Ensure min <= max word length
    if (sanitized.minWordLength > sanitized.maxWordLength) {
        sanitized.minWordLength = sanitized.maxWordLength;
    }

    // Clamp WPM reduction
    if (sanitized.maxTestRepeat > 1 && sanitized.wpmReduction > 0) {
        const maxAllowed = Math.floor(sanitized.minWpm / (sanitized.maxTestRepeat - 1));
        sanitized.wpmReduction = Math.min(sanitized.wpmReduction, maxAllowed);
    }

    return sanitized;
}

// Canonical key order — always enforced after sanitization
const MODE_ORDER = ['sprint', 'general', 'targeted', 'drill', 'chords', 'slow', 'mixed'];

// Validate and sanitize a full modes object. Always returns a valid modes dict.
function sanitizeModes(modes) {
    // Must be a non-null object with at least one key
    if (!modes || typeof modes !== 'object' || Array.isArray(modes)) {
        return JSON.parse(JSON.stringify(DEFAULT_MODES));
    }

    const sanitized = {};
    let count = 0;

    for (const [key, mode] of Object.entries(modes)) {
        if (count >= MODE_ORDER.length) break;
        if (!mode || typeof mode !== 'object') continue;

        const name = (typeof mode.name === 'string' && mode.name.trim() !== '')
            ? mode.name.trim()
            : key;

        sanitized[key] = {
            name: name,
            options: sanitizeOptions(mode.options)
        };
        count++;
    }

    // If nothing survived, return defaults
    if (count < 1) {
        return JSON.parse(JSON.stringify(DEFAULT_MODES));
    }

    // Enforce canonical key order
    const ordered = {};
    for (const key of MODE_ORDER) {
        if (sanitized[key]) ordered[key] = sanitized[key];
    }
    // Append any unknown keys after the canonical ones
    for (const key of Object.keys(sanitized)) {
        if (!ordered[key]) ordered[key] = sanitized[key];
    }

    return ordered;
}

// Initialize IndexedDB
async function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };

        request.onblocked = () => {
            console.warn('DB upgrade blocked — close other tabs using this app');
        };

        request.onupgradeneeded = (event) => {
            const database = event.target.result;

            if (!database.objectStoreNames.contains('wordStats')) {
                database.createObjectStore('wordStats', { keyPath: 'word' });
            }

            if (!database.objectStoreNames.contains('mistypedChars')) {
                database.createObjectStore('mistypedChars', { keyPath: 'id' });
            }

            if (!database.objectStoreNames.contains('settings')) {
                database.createObjectStore('settings', { keyPath: 'key' });
            }
        };
    });
}

// Get a setting from IndexedDB
async function getSetting(key) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['settings'], 'readonly');
        const store = transaction.objectStore('settings');
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result ? request.result.value : null);
        request.onerror = () => reject(request.error);
    });
}

// Save a setting to IndexedDB
async function saveSetting(key, value) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['settings'], 'readwrite');
        const store = transaction.objectStore('settings');
        const request = store.put({ key, value });
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

// Load modes from IndexedDB — always returns a valid, sanitized modes object
async function loadModes() {
    try {
        const saved = await getSetting('modes');
        if (saved) {
            // Merge saved modes with defaults to ensure new modes are always available
            const merged = { ...DEFAULT_MODES };
            for (const [key, mode] of Object.entries(saved)) {
                if (merged[key]) {
                    // Update existing mode's options while keeping default structure
                    merged[key] = {
                        name: mode.name || merged[key].name,
                        options: sanitizeOptions(mode.options)
                    };
                }
            }
            return merged;
        }
    } catch (e) {
        console.error('Failed to load modes from DB:', e);
    }
    return JSON.parse(JSON.stringify(DEFAULT_MODES));
}

// Save modes to IndexedDB — sanitizes before saving
async function saveModes(modes) {
    const sanitized = sanitizeModes(modes);
    await saveSetting('modes', sanitized);
}

// Load active mode key — always returns a valid key
async function loadActiveMode() {
    const modes = await loadModes();
    try {
        const key = await getSetting('activeMode');
        if (typeof key === 'string' && modes[key]) return key;
    } catch (e) {
        console.error('Failed to load active mode from DB:', e);
    }
    return Object.keys(modes)[0];
}

// Save active mode key
async function saveActiveMode(key) {
    await saveSetting('activeMode', key);
}

// Load mixed targeted count
async function loadMixedTargetedCount() {
    try {
        const count = await getSetting('mixedTargetedCount');
        if (typeof count === 'number' && count >= 1 && count <= 100) {
            return count;
        }
    } catch (e) {
        console.error('Failed to load mixedTargetedCount:', e);
    }
    return DEFAULT_MIXED_TARGETED_COUNT;
}

// Save mixed targeted count
async function saveMixedTargetedCount(count) {
    const sanitized = Math.max(1, Math.min(100, Math.floor(count)));
    await saveSetting('mixedTargetedCount', sanitized);
}

// Load mixed mode progress (which segment and how many tests done in it)
async function loadMixedProgress() {
    try {
        const progress = await getSetting('mixedProgress');
        if (progress && typeof progress === 'object') {
            const segmentIndex = Number(progress.segmentIndex);
            const testsDoneInSegment = Number(progress.testsDoneInSegment);
            return {
                segmentIndex: Number.isInteger(segmentIndex) && segmentIndex >= 0 ? segmentIndex : 0,
                testsDoneInSegment: Number.isInteger(testsDoneInSegment) && testsDoneInSegment >= 0 ? testsDoneInSegment : 0
            };
        }
    } catch (e) {
        console.error('Failed to load mixedProgress:', e);
    }
    return { segmentIndex: 0, testsDoneInSegment: 0 };
}

// Save mixed mode progress
async function saveMixedProgress(segmentIndex, testsDoneInSegment) {
    await saveSetting('mixedProgress', {
        segmentIndex: Math.max(0, Math.floor(segmentIndex) || 0),
        testsDoneInSegment: Math.max(0, Math.floor(testsDoneInSegment) || 0)
    });
}

// --- Sprint history ---------------------------------------------------------
// One entry per completed Sprint test: { wpm, accuracy } where accuracy is the
// share of keystrokes typed correctly, in 0..1. Kept in the settings store so
// no schema change is needed, and capped so the record can't grow without end.
const SPRINT_RUNS_MAX = 500;

async function loadSprintRuns() {
    try {
        const runs = await getSetting('sprintRuns');
        if (!Array.isArray(runs)) return [];
        return runs
            .map(r => ({ wpm: Number(r?.wpm), accuracy: Number(r?.accuracy) }))
            .filter(r => Number.isFinite(r.wpm) && Number.isFinite(r.accuracy));
    } catch (e) {
        console.error('Failed to load sprintRuns:', e);
        return [];
    }
}

// Append one run, dropping the oldest once the cap is reached
async function addSprintRun(wpm, accuracy) {
    const runs = await loadSprintRuns();
    runs.push({ wpm, accuracy });
    await saveSetting('sprintRuns', runs.slice(-SPRINT_RUNS_MAX));
}

async function clearSprintRuns() {
    await saveSetting('sprintRuns', []);
}

// --- Keystroke pair delays ---------------------------------------------------
// Histogram of the delay between every two consecutive keystrokes, keyed by
// the exact two-character pair typed (case-sensitive, e.g. "ab", "aB", " a").
// Pairs involving a non-printable keystroke (backspace, arrows, ...) are never
// recorded — see app.js, which breaks the chain whenever that happens.
//
// Delays are bucketed rather than stored individually, to keep the record a
// small, fixed-size table instead of an ever-growing log:
//   bin 0..15: [0-25), [25-50), ..., [375-400) ms
//   bin 16:    400ms and above
const CHAR_PAIR_BIN_SIZE = 25;
const CHAR_PAIR_BIN_COUNT = 17;

function delayToBinIndex(ms) {
    return Math.min(Math.floor(Math.max(ms, 0) / CHAR_PAIR_BIN_SIZE), CHAR_PAIR_BIN_COUNT - 1);
}

async function loadCharPairDelays() {
    try {
        const stored = await getSetting('charPairDelays');
        return (stored && typeof stored === 'object') ? stored : {};
    } catch (e) {
        console.error('Failed to load charPairDelays:', e);
        return {};
    }
}

// Merge one test's locally-accumulated pair counts into the stored totals.
// `counts` is { pair: [bin0, bin1, ...] }, same shape as the stored record.
async function mergeCharPairDelays(counts) {
    if (!counts || Object.keys(counts).length === 0) return;

    const stored = await loadCharPairDelays();
    mergeBinCounts(stored, counts);
    await saveSetting('charPairDelays', stored);
}

async function clearCharPairDelays() {
    await saveSetting('charPairDelays', {});
}

// Add `counts` (key -> bins) into `stored` (key -> bins) in place
function mergeBinCounts(stored, counts) {
    for (const [key, bins] of Object.entries(counts)) {
        const existing = stored[key] || new Array(CHAR_PAIR_BIN_COUNT).fill(0);
        for (let i = 0; i < CHAR_PAIR_BIN_COUNT; i++) existing[i] += bins[i] || 0;
        stored[key] = existing;
    }
}

// --- Per-word keystroke interval -------------------------------------------
// Average delay between keystrokes within a single occurrence of a word:
// (time of its last letter - time of its first letter) / (word.length - 1).
// Keyed by the word exactly as typed (case-sensitive, so "Hello" and "hello"
// are tracked separately). Uses the same 25ms bins as the pair delays, but is
// kept as its own record since it measures a different thing (overall pace
// across a whole word, not a single keystroke-to-keystroke gap).
async function loadWordDelays() {
    try {
        const stored = await getSetting('wordDelays');
        return (stored && typeof stored === 'object') ? stored : {};
    } catch (e) {
        console.error('Failed to load wordDelays:', e);
        return {};
    }
}

async function mergeWordDelays(counts) {
    if (!counts || Object.keys(counts).length === 0) return;

    const stored = await loadWordDelays();
    mergeBinCounts(stored, counts);
    await saveSetting('wordDelays', stored);
}

async function clearWordDelays() {
    await saveSetting('wordDelays', {});
}

// --- Keymap -----------------------------------------------------------------
// A 3x10 grid describing the physical layout of the letter keys.
// Row 0 = top row, row 1 = home row, row 2 = bottom row.
// Columns 0-4 are the left hand, columns 5-9 the right hand.
const KEYMAP_ROWS = 3;
const KEYMAP_COLS = 10;

const DEFAULT_KEYMAP = [
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';'],
    ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/']
];

// Ensure a keymap is always a 3x10 grid of single characters.
// Empty cells are allowed and preserved; only missing cells fall back to QWERTY.
function sanitizeKeymap(keymap) {
    const result = [];
    for (let r = 0; r < KEYMAP_ROWS; r++) {
        const row = [];
        for (let c = 0; c < KEYMAP_COLS; c++) {
            const raw = Array.isArray(keymap) && Array.isArray(keymap[r]) ? keymap[r][c] : undefined;
            if (typeof raw === 'string') {
                // A deliberate blank stays blank
                const value = raw.trim();
                row.push(value ? value.slice(0, 1).toLowerCase() : '');
            } else {
                row.push(DEFAULT_KEYMAP[r][c]);
            }
        }
        result.push(row);
    }
    return result;
}

// Check a keymap contains every letter of the alphabet at least once.
// Duplicates are allowed. Returns the sorted list of missing letters.
function findMissingLetters(keymap) {
    const present = new Set();
    for (const row of sanitizeKeymap(keymap)) {
        for (const char of row) {
            if (char) present.add(char);
        }
    }
    const missing = [];
    for (let i = 0; i < 26; i++) {
        const letter = String.fromCharCode(97 + i);
        if (!present.has(letter)) missing.push(letter);
    }
    return missing;
}

// Load keymap — always returns a valid 3x10 grid
async function loadKeymap() {
    try {
        const saved = await getSetting('keymap');
        if (saved) return sanitizeKeymap(saved);
    } catch (e) {
        console.error('Failed to load keymap from DB:', e);
    }
    return JSON.parse(JSON.stringify(DEFAULT_KEYMAP));
}

// Save keymap — sanitizes before saving.
// Rejects a keymap that is missing letters so the layout always covers a-z.
async function saveKeymap(keymap) {
    const missing = findMissingLetters(keymap);
    if (missing.length > 0) {
        const error = new Error(`Keymap is missing: ${missing.join(', ')}`);
        error.missingLetters = missing;
        throw error;
    }
    await saveSetting('keymap', sanitizeKeymap(keymap));
}

export { initDB, db, getSetting, saveSetting, loadModes, saveModes, loadActiveMode, saveActiveMode, loadMixedTargetedCount, saveMixedTargetedCount, loadMixedProgress, saveMixedProgress, loadSprintRuns, addSprintRun, clearSprintRuns, CHAR_PAIR_BIN_SIZE, CHAR_PAIR_BIN_COUNT, delayToBinIndex, loadCharPairDelays, mergeCharPairDelays, clearCharPairDelays, loadWordDelays, mergeWordDelays, clearWordDelays, loadKeymap, saveKeymap, sanitizeKeymap, findMissingLetters, sanitizeOptions, sanitizeModes, DEFAULT_MODES, DEFAULT_MIXED_TARGETED_COUNT, DEFAULT_KEYMAP, KEYMAP_ROWS, KEYMAP_COLS, OPTION_FIELDS };
