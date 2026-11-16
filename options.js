import { initDB, loadModes, saveModes, loadKeymap, saveKeymap, findMissingLetters, DEFAULT_MODES, DEFAULT_KEYMAP, KEYMAP_ROWS, KEYMAP_COLS, OPTION_FIELDS, sanitizeOptions } from './db.js';

// UI labels and descriptions for option fields (extends the schema from db.js)
const OPTION_UI = {
    minWordLength: { label: 'Min Word Length', desc: 'Minimum word length to practice' },
    maxWordLength: { label: 'Max Word Length', desc: 'Maximum word length to practice' },
    numWords: { label: 'Number of Words', desc: 'Number of unique words per test' },
    repetition: { label: 'Repetitions', desc: 'How many times each word appears (N/A for Slow)' },
    minWpm: { label: 'Target WPM', desc: 'Target typing speed (for Slow: speed to reach before exiting)' },
    allowError: { label: 'Allow Errors', desc: 'Allow mistakes and still pass (N/A for Slow)', choices: [{ value: 'false', text: 'No' }, { value: 'true', text: 'Yes' }] },
    maxTestRepeat: { label: 'Max Repeats', desc: 'Max retry attempts (for Slow: max word repetitions before exiting)' },
    wpmReduction: { label: 'WPM Reduction', desc: 'WPM reduction per retry (N/A for Slow)' },
    useFrequency: { label: 'Use Word Frequency', desc: 'Prioritize common words based on frequency data', choices: [{ value: 'true', text: 'Yes' }, { value: 'false', text: 'No' }] },
    useErrorRate: { label: 'Use Error Rate', desc: 'Focus on words with higher error rates', choices: [{ value: 'true', text: 'Yes' }, { value: 'false', text: 'No' }] },
    favorNewWords: { label: 'Favor New Words', desc: 'Prioritize words you haven\'t practiced yet', choices: [{ value: 'true', text: 'Yes' }, { value: 'false', text: 'No' }] },
    capitalize: { label: 'Capitalize', desc: 'Word capitalization', choices: [{ value: 'no', text: 'No' }, { value: 'yes', text: 'Yes' }, { value: 'random', text: 'Random' }] },
    normalizeErrorByLength: { label: 'Normalize Error by Length', desc: 'Divide error rate by word length', choices: [{ value: 'true', text: 'Yes' }, { value: 'false', text: 'No' }] },
    recordStats: { label: 'Record Stats', desc: 'Save this mode\'s results to your statistics. Turn off for pure practice modes.', choices: [{ value: 'true', text: 'Yes' }, { value: 'false', text: 'No' }] },
    mixedModeCount: { label: 'Tests in Mixed Mode', desc: 'Number of tests of this mode when in Mixed super-mode (0 to skip)' }
};

// Build the modes table
async function buildTable() {
    const container = document.getElementById('modes-table-container');
    const modes = await loadModes();
    // One column per mode (exclude Mixed, which has no options of its own)
    const modeKeys = Object.keys(modes).filter(k => k !== 'mixed');

    const table = document.createElement('table');
    table.classList.add('modes-table');

    // Header row: empty cell + one column per mode
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    const emptyTh = document.createElement('th');
    emptyTh.textContent = 'Option';
    headerRow.appendChild(emptyTh);
    for (const key of modeKeys) {
        const th = document.createElement('th');
        th.textContent = modes[key].name;
        headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');

    // Option rows
    for (const field of OPTION_FIELDS) {
        const ui = OPTION_UI[field.key] || { label: field.key };
        const row = document.createElement('tr');
        const labelTd = document.createElement('td');
        labelTd.classList.add('option-label-cell');
        const labelSpan = document.createElement('span');
        labelSpan.textContent = ui.label;
        labelTd.appendChild(labelSpan);
        if (ui.desc) {
            const descSpan = document.createElement('span');
            descSpan.classList.add('option-desc');
            descSpan.textContent = ui.desc;
            labelTd.appendChild(descSpan);
        }
        row.appendChild(labelTd);

        for (const key of modeKeys) {
            const td = document.createElement('td');
            const val = modes[key].options[field.key];

            // Skip mixedTargetedCount for non-mixed modes (won't appear in main table)
            if (field.key === 'mixedTargetedCount') {
                continue;
            }

            // Slow mode: mark certain fields as N/A
            if (key === 'slow' && ['repetition', 'allowError', 'wpmReduction'].includes(field.key)) {
                td.textContent = 'N/A';
                td.style.color = '#666';
                td.style.textAlign = 'center';
                row.appendChild(td);
                continue;
            }            if (field.type === 'number') {
                const input = document.createElement('input');
                input.type = 'number';
                input.min = field.min;
                input.max = field.max;
                input.value = val;
                input.dataset.modeKey = key;
                input.dataset.field = field.key;
                input.classList.add('mode-input');
                td.appendChild(input);
            } else if (field.type === 'boolean' || field.type === 'enum') {
                const select = document.createElement('select');
                select.dataset.modeKey = key;
                select.dataset.field = field.key;
                select.classList.add('mode-input');
                const choices = ui.choices || (field.type === 'boolean'
                    ? [{ value: 'false', text: 'No' }, { value: 'true', text: 'Yes' }]
                    : field.values.map(v => ({ value: v, text: v })));
                for (const choice of choices) {
                    const opt = document.createElement('option');
                    opt.value = choice.value;
                    opt.textContent = choice.text;
                    if (String(val) === choice.value) opt.selected = true;
                    select.appendChild(opt);
                }
                td.appendChild(select);
            }
            row.appendChild(td);
        }
        tbody.appendChild(row);
    }

    table.appendChild(tbody);
    container.innerHTML = '';
    container.appendChild(table);
}

// Read all values from the table and return modes object
async function readTableValues() {
    const modes = await loadModes();
    const modeKeys = Object.keys(modes);
    const inputs = document.querySelectorAll('.mode-input');

    for (const input of inputs) {
        const key = input.dataset.modeKey;
        const field = input.dataset.field;
        if (field === '_NAME_') {
            modes[key].name = input.value.trim() || modes[key].name;
        } else {
            const fieldDef = OPTION_FIELDS.find(f => f.key === field);
            if (fieldDef && fieldDef.type === 'number') {
                modes[key].options[field] = input.value;
            } else if (fieldDef) {
                // boolean or enum
                let v = input.value;
                if (v === 'true') v = true;
                else if (v === 'false') v = false;
                modes[key].options[field] = v;
            }
        }
    }

    return modes;
}

// Build the 3x10 keymap grid
async function buildKeymap() {
    const container = document.getElementById('keymap-grid');
    if (!container) return;
    const keymap = await loadKeymap();

    // Move focus to the Nth key in the grid (flat index, so it wraps across rows)
    const focusKey = (index) => {
        const keys = container.querySelectorAll('.keymap-key');
        if (index >= 0 && index < keys.length) {
            keys[index].focus();
            keys[index].select();
            return true;
        }
        return false;
    };

    container.innerHTML = '';
    for (let r = 0; r < KEYMAP_ROWS; r++) {
        const rowDiv = document.createElement('div');
        rowDiv.classList.add('keymap-row');
        for (let c = 0; c < KEYMAP_COLS; c++) {
            const flatIndex = r * KEYMAP_COLS + c;
            const input = document.createElement('input');
            input.type = 'text';
            input.maxLength = 1;
            input.value = keymap[r][c];
            input.dataset.row = r;
            input.dataset.col = c;
            input.classList.add('keymap-key');
            if (!input.value) input.classList.add('keymap-empty');
            // Visually separate the left and right hands
            if (c === 5) input.classList.add('keymap-gap');

            const markEmpty = () => input.classList.toggle('keymap-empty', input.value === '');

            // Typing a character advances to the next key, wrapping to the next row
            input.addEventListener('input', () => {
                input.value = input.value.trim().slice(0, 1).toLowerCase();
                markEmpty();
                validateKeymap();
                if (input.value) focusKey(flatIndex + 1);
            });

            input.addEventListener('keydown', (e) => {
                if (e.key === ' ' || e.key === 'Delete') {
                    // Blank this key out and move on
                    e.preventDefault();
                    input.value = '';
                    markEmpty();
                    validateKeymap();
                    focusKey(flatIndex + 1);
                } else if (e.key === 'Backspace' && input.value === '') {
                    // Already empty: step back to the previous key
                    e.preventDefault();
                    focusKey(flatIndex - 1);
                } else if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    focusKey(flatIndex + 1);
                } else if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    focusKey(flatIndex - 1);
                } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    focusKey(flatIndex + KEYMAP_COLS);
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    focusKey(flatIndex - KEYMAP_COLS);
                }
            });

            input.addEventListener('focus', () => input.select());
            rowDiv.appendChild(input);
        }
        container.appendChild(rowDiv);
    }
    validateKeymap();
}

// Show which letters are missing from the grid. Returns true when valid.
function validateKeymap() {
    const warning = document.getElementById('keymap-warning');
    const missing = findMissingLetters(readKeymapValues());
    if (warning) {
        warning.textContent = missing.length
            ? `Missing letter${missing.length > 1 ? 's' : ''}: ${missing.join(' ')}`
            : '';
        warning.classList.toggle('visible', missing.length > 0);
    }
    return missing.length === 0;
}

// Read the keymap grid into a 3x10 array
function readKeymapValues() {
    const keymap = [];
    for (let r = 0; r < KEYMAP_ROWS; r++) {
        keymap.push(new Array(KEYMAP_COLS).fill(''));
    }
    for (const input of document.querySelectorAll('.keymap-key')) {
        const r = Number(input.dataset.row);
        const c = Number(input.dataset.col);
        if (keymap[r]) keymap[r][c] = input.value;
    }
    return keymap;
}

// Show toast notification
function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('visible');
    setTimeout(() => {
        toast.classList.remove('visible');
    }, 2000);
}

// Initialize page
async function init() {
    try {
        await initDB();
        const modes = await loadModes();
        // Debug: dump modes
        const debugDiv = document.getElementById('debug-output');
        if (debugDiv) {
            debugDiv.textContent = JSON.stringify(modes, null, 2);
        }
        await buildTable();
        await buildKeymap();
    } catch (e) {
        const debugDiv = document.getElementById('debug-output');
        if (debugDiv) {
            debugDiv.textContent = 'ERROR: ' + e.message + '\n' + e.stack;
        }
        console.error('Options init error:', e);
    }

    document.getElementById('save-btn').addEventListener('click', async () => {
        if (!validateKeymap()) {
            const missing = findMissingLetters(readKeymapValues());
            showToast(`Cannot save: keymap is missing ${missing.join(' ')}`);
            return;
        }
        const modes = await readTableValues();
        await saveModes(modes);  // saveModes sanitizes before saving
        await saveKeymap(readKeymapValues());
        await buildTable(); // Refresh to show sanitized values
        await buildKeymap();
        // Debug: dump saved modes
        const debugDiv = document.getElementById('debug-output');
        if (debugDiv) {
            const savedModes = await loadModes();
            debugDiv.textContent = 'SAVED:\n' + JSON.stringify(savedModes, null, 2);
        }
        showToast('Options saved!');
    });

    document.getElementById('reset-btn').addEventListener('click', async () => {
        await saveModes(JSON.parse(JSON.stringify(DEFAULT_MODES)));
        await saveKeymap(JSON.parse(JSON.stringify(DEFAULT_KEYMAP)));
        await buildTable();
        await buildKeymap();
        showToast('Options reset!');
    });
}

init();
