// ============================================================================
// SLOW TYPING MODE - Metronome-style typing with bouncing ball
// ============================================================================

export function initSlowMode(config = {}) {
    // Configuration with defaults
    const WORD = config.word || "company";
    const TARGET_WPM = config.targetWpm || 30;
    const WPM_MIN = 6;
    const WPM_STEP = 2;

    // Single source of truth for speed
    let wpm = config.initialWpm || 12;

    // Derived: period in seconds per letter
    function getPeriod() { return 12 / wpm; }

    // State variables
    let currentLetterIndex = 0;
    let currentRepetition = 0;
    let isActive = true;
    let hasStartedTyping = false;
    let startTime = 0;
    let animationFrameId = null;
    let targetTime = 0;
    let ballFromIndex = 0;
    let ballToIndex = 0;
    let ballJumpStartTime = 0;
    let performanceCounter = 0;
    let letterTimings = [];
    
    // DOM element IDs (can be customized via config)
    const ballId = config.ballId || 'ball';
    const wordDisplayId = config.wordDisplayId || 'wordDisplay';
    const statusId = config.statusId || 'status';
    const counterId = config.counterId || 'counter';
    const timingDisplayId = config.timingDisplayId || 'timingDisplay';
    const wpmDisplayId = config.wpmDisplayId || 'wpmDisplay';
    
    // Get DOM references
    const ball = document.getElementById(ballId);
    const wordDisplay = document.getElementById(wordDisplayId);
    const status = document.getElementById(statusId);
    const counter = document.getElementById(counterId);
    const timingDisplay = document.getElementById(timingDisplayId);
    const wpmDisplay = document.getElementById(wpmDisplayId);
    
    function updateWPMDisplay() {
        if (wpmDisplay) wpmDisplay.textContent = wpm + ' WPM';
    }
    
    function getLetterPosition(letterIndex) {
        if (letterIndex < 0 || letterIndex >= WORD.length) {
            return { x: 150, y: 150 };
        }
        
        const wordDisplayRect = wordDisplay.getBoundingClientRect();
        const containerRect = document.querySelector('.metronome-container').getBoundingClientRect();
        
        const tempDiv = document.createElement('div');
        tempDiv.style.position = 'absolute';
        tempDiv.style.visibility = 'hidden';
        tempDiv.style.fontSize = '48px';
        tempDiv.style.fontFamily = "'Courier New', monospace";
        tempDiv.style.letterSpacing = '10px';
        
        const wordDisplayCenter = wordDisplayRect.left + wordDisplayRect.width / 2;
        
        tempDiv.textContent = WORD;
        document.body.appendChild(tempDiv);
        const fullWordWidth = tempDiv.offsetWidth;
        document.body.removeChild(tempDiv);
        
        const wordStartX = wordDisplayCenter - fullWordWidth / 2;
        
        tempDiv.textContent = WORD.substring(0, letterIndex);
        document.body.appendChild(tempDiv);
        const beforeWidth = tempDiv.offsetWidth;
        document.body.removeChild(tempDiv);
        
        tempDiv.textContent = WORD[letterIndex];
        document.body.appendChild(tempDiv);
        const charWidth = tempDiv.offsetWidth;
        document.body.removeChild(tempDiv);
        
        const letterCenterX = wordStartX + beforeWidth + charWidth / 2;
        const relativeX = letterCenterX - containerRect.left;
        
        return { x: relativeX, y: 150 };
    }
    
    function updateWordDisplay() {
        const typed = WORD.substring(0, currentLetterIndex);
        const current = currentLetterIndex < WORD.length ? WORD[currentLetterIndex] : '';
        const remaining = WORD.substring(currentLetterIndex + 1);
        
        wordDisplay.innerHTML = 
            `<span class="typed">${typed}</span>` +
            `<span class="current">${current}</span>` +
            `<span class="remaining">${remaining}</span>`;
    }
    
    function updateCounter() {
        if (counter) counter.textContent = `${currentRepetition} reps | ${wpm} / ${TARGET_WPM} WPM`;
    }

    function positiveThreshold() {
        return Math.ceil(wpm * WORD.length / 10);
    }

    function updateTimingDisplay() {
        if (!timingDisplay) return;
        const counterDisplay = `<div class="counter-entry">Counter: ${performanceCounter} / +${positiveThreshold()}/-10</div>`;
        const timingEntries = letterTimings.map(entry =>
            `<div class="timing-entry">${entry.letter} : ${entry.time} T</div>`
        ).join('');
        timingDisplay.innerHTML = counterDisplay + timingEntries;
    }

    // Called when the ball wraps back to the start of the word
    function evaluateAndUpdateWPM() {
        if (performanceCounter >= positiveThreshold()) {
            wpm = wpm + WPM_STEP;
            performanceCounter = 0;
            updateWPMDisplay();
            updateCounter();
            updateTimingDisplay();
        } else if (performanceCounter <= -10) {
            wpm = Math.max(WPM_MIN, wpm - WPM_STEP);
            performanceCounter = 0;
            updateWPMDisplay();
            updateCounter();
            updateTimingDisplay();
        }
    }
    
    function animateBall(timestamp) {
        if (!isActive) return;

        const period = getPeriod();

        if (!hasStartedTyping) {
            const firstPos = getLetterPosition(0);
            ball.style.top = '250px';
            ball.style.left = firstPos.x + 'px';
            ball.style.transform = 'translateX(-50%)';
            animationFrameId = requestAnimationFrame(animateBall);
            return;
        }
        
        const elapsed = (performance.now() - startTime) / 1000;
        
        if (elapsed >= ballJumpStartTime + period && ballToIndex !== currentLetterIndex) {
            const newFrom = ballToIndex;
            const newTo = currentLetterIndex;

            // Ball wrapping back to start — evaluate counter and update WPM
            if (newTo < newFrom) {
                evaluateAndUpdateWPM();
            }

            ballFromIndex = newFrom;
            ballToIndex = newTo;
            ballJumpStartTime = elapsed;
        }
        
        const jumpElapsed = elapsed - ballJumpStartTime;
        const phase = Math.min(jumpElapsed / period, 1.0);
        
        const fromPos = getLetterPosition(ballFromIndex);
        const toPos = getLetterPosition(ballToIndex);
        
        const isBigJump = ballToIndex < ballFromIndex;
        
        if (phase < 1.0) {
            const height = -4 * Math.pow(phase - 0.5, 2) + 1;
            const peakHeight = isBigJump ? 20 : 135;
            const bottomPosition = 250;
            const topPosition = bottomPosition - (bottomPosition - peakHeight) * height;
            const leftPosition = fromPos.x + (toPos.x - fromPos.x) * phase;
            
            ball.style.top = topPosition + 'px';
            ball.style.left = leftPosition + 'px';
            ball.style.transform = 'translateX(-50%)';
        } else {
            ball.style.top = '250px';
            ball.style.left = toPos.x + 'px';
            ball.style.transform = 'translateX(-50%)';
        }
        
        animationFrameId = requestAnimationFrame(animateBall);
    }
    
    function handleKeyPress(event) {
        if (!isActive) return;
        
        const key = event.key.toLowerCase();
        const expectedKey = WORD[currentLetterIndex];
        
        if (key !== expectedKey) {
            if (key.length === 1 && key >= 'a' && key <= 'z') {
                const elapsed = hasStartedTyping ? (performance.now() - startTime) / 1000 : 0;
                const timeInT = (elapsed / getPeriod()).toFixed(2);
                letterTimings.push({ letter: key + ' (wrong)', time: timeInT });
                
                if (status) {
                    status.textContent = 'Wrong letter! Expected: ' + expectedKey.toUpperCase();
                    status.className = 'status error';
                }
                
                performanceCounter -= 2;
                updateTimingDisplay();
            }
            return;
        }
        
        const keypressTime = (performance.now() - startTime) / 1000;
        const period = getPeriod();
        
        if (!hasStartedTyping) {
            hasStartedTyping = true;
            startTime = performance.now();
            targetTime = period;
            
            letterTimings.push({ letter: expectedKey, time: '0.00' });
            updateTimingDisplay();
            
            currentLetterIndex++;
            ballFromIndex = 0;
            ballToIndex = 1;
            ballJumpStartTime = 0;
            
            if (status) {
                status.textContent = '';
                status.className = 'status';
            }
            
            updateWordDisplay();
            return;
        }
        
        const earlyThreshold = targetTime - 0.25 * period;
        const lateThreshold = targetTime + 0.25 * period;
        
        if (keypressTime < earlyThreshold) {
            const timeInT = (keypressTime / period).toFixed(2);
            letterTimings.push({ letter: expectedKey + ' (too early)', time: timeInT });
            updateTimingDisplay();
            if (status) {
                status.textContent = 'Too early! Wait for the beat.';
                status.className = 'status error';
            }
            
            performanceCounter -= 2;
            updateTimingDisplay();
            return;
        }
        
        const timeInT = (keypressTime / period).toFixed(2);
        letterTimings.push({ letter: expectedKey, time: timeInT });
        
        if (status) {
            status.textContent = '';
            status.className = 'status';
        }
        
        performanceCounter += 1;
        updateTimingDisplay();
        
        if (keypressTime < lateThreshold) {
            targetTime = targetTime + period;
        } else {
            targetTime = keypressTime + period;
        }
        
        currentLetterIndex++;
        
        if (currentLetterIndex >= WORD.length) {
            currentRepetition++;
            updateCounter();
            
            if (wpm >= TARGET_WPM) {
                isActive = false;
                cancelAnimationFrame(animationFrameId);
                if (status) {
                    status.textContent = `🎉 Target ${TARGET_WPM} WPM Reached!`;
                    status.className = 'status success';
                }
                wordDisplay.innerHTML = `<span class="typed">${WORD}</span>`;
                
                if (config.onComplete) {
                    config.onComplete({ word: WORD, wpm, repetitions: currentRepetition });
                }
            } else {
                currentLetterIndex = 0;
                updateWordDisplay();
            }
        } else {
            updateWordDisplay();
        }
    }
    
    // Initialize
    document.addEventListener('keydown', handleKeyPress);
    
    updateWordDisplay();
    updateCounter();
    updateWPMDisplay();
    
    if (ball) {
        const initialPos = getLetterPosition(0);
        ball.style.left = initialPos.x + 'px';
        ball.style.transform = 'translateX(-50%)';
        ballJumpStartTime = 0;
    }
    
    startTime = performance.now();
    animationFrameId = requestAnimationFrame(animateBall);
    
    // Return cleanup function
    return function cleanup() {
        document.removeEventListener('keydown', handleKeyPress);
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
        }
        isActive = false;
    };
}
