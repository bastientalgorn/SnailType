import { WORDS } from './words.js';
import { initDB, loadModes, saveModes, loadActiveMode, saveActiveMode, loadMixedProgress, saveMixedProgress, DEFAULT_MODES } from './db.js';
import { initSlowMode } from './slow.js';

// Get current options (will be set after DB init)
let OPTIONS = {};

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

// Calculate word interest score based on options and word stats
function getWordInterest(options, word, stats) {
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
    p = p * Math.random(); 

    return p;
}

// Select words to practice using Beta-Binomial model
async function selectWordsToPractice(n, minLength, maxLength) {
    const wordStats = await getWordStats();
    
    const wordSuccessProba = [];
    
    // WORDS is now a dictionary, so iterate over keys
    for (const word of Object.keys(WORDS)) {
        if (minLength !== null && minLength > 0 && word.length < minLength) continue;
        if (maxLength !== null && maxLength > 0 && word.length > maxLength) continue;
        
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

// Display target text with 4-state coloring
function displayTargetText(targetText, typedText, charEverWrong) {
    const targetDiv = document.getElementById('target-text');
    targetDiv.innerHTML = '';
    
    const words = targetText.split(' ');
    let charIndex = 0;
    
    for (let wordIdx = 0; wordIdx < words.length; wordIdx++) {
        const word = words[wordIdx];
        const wordSpan = document.createElement('span');
        wordSpan.classList.add('word');
        
        // Add characters of the word
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
    
    // Display statistics
    for (const word of uniqueWords) {
        const before = wordStats[word] || { successes: 0, failures: 0 };
        const delta = testStats[word] || { successes: 0, failures: 0 };
        const after = {
            successes: before.successes + delta.successes,
            failures: before.failures + delta.failures
        };
        
        const statLine = document.createElement('div');
        statLine.classList.add('stat-line');
        statLine.textContent = `'${word}': [${before.successes}, ${before.failures}] + [${delta.successes}, ${delta.failures}] → [${after.successes}, ${after.failures}]`;
        statsDiv.appendChild(statLine);
    }
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
            // Tab is allowed through so the page stays keyboard-navigable.
            // Flag it so the blur handler below doesn't steal focus back.
            if (e.key === 'Tab') {
                this.tabbingAway = true;
                return;
            }

            if (BLOCKED_KEYS.has(e.key)) {
                e.preventDefault();
                return;
            }

            // Ctrl/Cmd + A/X/V/Z/Y
            if ((e.ctrlKey || e.metaKey) && BLOCKED_CTRL_KEYS.has(e.key.toLowerCase())) {
                e.preventDefault();
                return;
            }

            // Delete-word-backwards (Ctrl/Alt/Cmd + Backspace)
            if (e.key === 'Backspace' && (e.ctrlKey || e.metaKey || e.altKey)) {
                e.preventDefault();
            }
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
        for (const [key, val] of Object.entries(OPTIONS)) {
            lines.push(`${key}: ${val}`);
        }
        lines.push('');
        
        // Word stats
        const wordStats = await getWordStats();
        const uniqueWords = [...new Set(this.words.map(w => w.toLowerCase()))];
        
        for (const word of uniqueWords) {
            const stats = wordStats[word] || { successes: 0, failures: 0 };
            const interest = getWordInterest(OPTIONS, word, stats);
            lines.push(`'${word}': [${stats.successes}, ${stats.failures}] interest=${interest.toExponential(2)}`);
        }
        
        const statLine = document.createElement('div');
        statLine.classList.add('stat-line');
        statLine.textContent = lines.join('\n');
        statsDiv.appendChild(statLine);
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
        
        this.inputElement.value = '';
        this.inputElement.disabled = false;
        this.inputElement.focus();
        this.resultsElement.innerHTML = '';
        this.resultsElement.className = 'results';
        
        displayTargetText(this.targetText, this.typedText, this.charEverWrong);
        
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
            
            if (!isCorrect) {
                this.charEverWrong.add(currentIndex);
                addMistypedChar(this.targetText[currentIndex]);
            }
        }
        
        displayTargetText(this.targetText, this.typedText, this.charEverWrong);
        
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
        
        // Display results
        if (testPassed) {
            this.resultsElement.className = 'results success';
            this.resultsElement.innerHTML = `
                <div class="result-metric">${wpm.toFixed(0)} WPM</div>
                <div class="result-metric">${errorCount} Error${errorCount !== 1 ? 's' : ''}</div>
                <div class="result-status success-text">✓ Success</div>
                <div class="result-next">Press Enter for next test</div>
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
        
        // Update statistics
        await updateWordStats(this.words, wordResults);
        
        // Check if slow mode (numWords = 1)
        const isSlowMode = OPTIONS.numWords === 1;
        
        if (isSlowMode && !testPassed && this.attemptCount < OPTIONS.maxTestRepeat) {
            // Slow mode: auto-retry without Enter key
            this.attemptCount++;
            
            // Brief delay before resetting
            setTimeout(() => {
                this.typedText = '';
                this.startTime = null;
                this.charEverWrong = new Set();
                this.inputElement.value = '';
                this.inputElement.disabled = false;
                this.inputElement.focus();
                this.resultsElement.innerHTML = '';
                this.resultsElement.className = 'results';
                displayTargetText(this.targetText, this.typedText, this.charEverWrong);
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
                            this.typedText = '';
                            this.startTime = null;
                            this.charEverWrong = new Set();
                            this.inputElement.value = '';
                            this.inputElement.disabled = false;
                            this.inputElement.focus();
                            this.resultsElement.innerHTML = '';
                            this.resultsElement.className = 'results';
                            displayTargetText(this.targetText, this.typedText, this.charEverWrong);
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
        }
    } catch (e) {
        console.error('Failed to load modes:', e);
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
