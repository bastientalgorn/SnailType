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
            minWpm: 60,
            allowError: true,
            maxTestRepeat: 1,
            wpmReduction: 0,
            useFrequency: true,
            useErrorRate: false,
            favorNewWords: false,
            capitalize: 'no',
            normalizeErrorByLength: false,
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
            minWpm: 60,
            allowError: true,
            maxTestRepeat: 1,
            wpmReduction: 0,
            useFrequency: false,
            useErrorRate: false,
            favorNewWords: true,
            capitalize: 'no',
            normalizeErrorByLength: false,
            mixedModeCount: 2
        }
    },
    "targeted": {
        name: "Targeted",
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
            mixedModeCount: 5
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
const MODE_ORDER = ['sprint', 'general', 'targeted', 'drill', 'slow', 'mixed'];

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

export { initDB, db, getSetting, saveSetting, loadModes, saveModes, loadActiveMode, saveActiveMode, loadMixedTargetedCount, saveMixedTargetedCount, loadMixedProgress, saveMixedProgress, sanitizeOptions, sanitizeModes, DEFAULT_MODES, DEFAULT_MIXED_TARGETED_COUNT, OPTION_FIELDS };
