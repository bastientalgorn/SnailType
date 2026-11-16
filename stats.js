// IndexedDB setup
const DB_NAME = 'TypingTestDB';
const DB_VERSION = 2;
let db;

// Initialize IndexedDB
async function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            
            if (!db.objectStoreNames.contains('wordStats')) {
                db.createObjectStore('wordStats', { keyPath: 'word' });
            }
            
            if (!db.objectStoreNames.contains('mistypedChars')) {
                db.createObjectStore('mistypedChars', { keyPath: 'id' });
            }
            
            if (!db.objectStoreNames.contains('settings')) {
                db.createObjectStore('settings', { keyPath: 'key' });
            }
        };
    });
}

// Get all word statistics
const BITFIELD_MAX = 50;

function parseBitfield(bitfield) {
    if (!bitfield) return { successes: 0, failures: 0, total: 0 };
    const total = bitfield.length;
    let failures = 0;
    for (const c of bitfield) {
        if (c === '0') failures++;
    }
    return { successes: total - failures, failures, total };
}

async function getWordStats() {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['wordStats'], 'readonly');
        const store = transaction.objectStore('wordStats');
        const request = store.getAll();

        request.onsuccess = () => {
            const stats = {};
            request.result.forEach(item => {
                // New format: item.results is a bitfield string
                // Old format fallback: item.successes / item.failures
                if (typeof item.results === 'string') {
                    stats[item.word] = item.results;
                } else {
                    const s = item.successes || 0;
                    const f = item.failures || 0;
                    const total = Math.min(s + f, BITFIELD_MAX);
                    if (total === 0) {
                        stats[item.word] = '';
                    } else {
                        const failures = Math.round((f / (s + f)) * total);
                        stats[item.word] = '1'.repeat(total - failures) + '0'.repeat(failures);
                    }
                }
            });
            resolve(stats);
        };
        request.onerror = () => reject(request.error);
    });
}// Get mistyped characters
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

// Per-character typing history: each character maps to a bitfield of its last
// CHAR_WINDOW keystrokes ('1' correct, '0' mistyped), so the error rate
// reflects recent performance rather than a lifetime average.
const CHAR_WINDOW = 1000;

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

            // Legacy cumulative format: rebuild an approximate bitfield
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

// Get per-character attempt/error counts over the rolling window
async function getCharStats() {
    const results = await getCharResults();
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

// Display character error distribution
async function displayCharDistribution() {
    const mistypedChars = await getMistypedChars();
    const charDistDiv = document.getElementById('char-distribution');
    
    if (mistypedChars.length === 0) {
        charDistDiv.innerHTML = '<p class="empty-state">No mistyped characters recorded yet. Start practicing to see your statistics!</p>';
        return;
    }
    
    // Count character frequencies
    const charCounts = {};
    for (const char of mistypedChars) {
        charCounts[char] = (charCounts[char] || 0) + 1;
    }
    
    // Calculate percentages and sort
    const total = mistypedChars.length;
    const charStats = Object.entries(charCounts).map(([char, count]) => ({
        char,
        count,
        percentage: (count / total) * 100
    }));
    
    charStats.sort((a, b) => b.percentage - a.percentage);
    
    // Take top 20 for readability
    const top20 = charStats.slice(0, 20);
    
    // Create horizontal bar chart
    const chartWidth = 800;
    const barHeight = 25;
    const padding = { top: 20, right: 80, bottom: 40, left: 60 };
    const chartHeight = padding.top + padding.bottom + (top20.length * barHeight);
    const plotWidth = chartWidth - padding.left - padding.right;
    
    const maxPercentage = Math.max(...top20.map(s => s.percentage));
    
    // Create SVG
    charDistDiv.innerHTML = '';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', chartWidth);
    svg.setAttribute('height', chartHeight);
    svg.classList.add('char-chart');
    
    // Create bars
    top20.forEach((stat, i) => {
        const barWidth = (stat.percentage / maxPercentage) * plotWidth;
        const y = padding.top + i * barHeight;
        
        // Bar
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', padding.left);
        rect.setAttribute('y', y + 2);
        rect.setAttribute('width', barWidth);
        rect.setAttribute('height', barHeight - 4);
        rect.setAttribute('fill', '#f44336');
        rect.setAttribute('opacity', '0.8');
        rect.classList.add('chart-bar');
        
        // Add hover effect data
        rect.setAttribute('data-char', stat.char === ' ' ? '⎵' : stat.char);
        rect.setAttribute('data-percentage', stat.percentage.toFixed(2));
        rect.setAttribute('data-count', `${stat.count}/${total}`);
        
        svg.appendChild(rect);
        
        // Y-axis label (character)
        const displayChar = stat.char === ' ' ? '⎵' : stat.char;
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', padding.left - 10);
        label.setAttribute('y', y + barHeight / 2 + 5);
        label.setAttribute('text-anchor', 'end');
        label.setAttribute('fill', '#ffffff');
        label.setAttribute('font-size', '14');
        label.setAttribute('font-family', 'Courier New, monospace');
        label.textContent = `'${displayChar}'`;
        svg.appendChild(label);
        
        // Percentage label at end of bar
        const percentLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        percentLabel.setAttribute('x', padding.left + barWidth + 5);
        percentLabel.setAttribute('y', y + barHeight / 2 + 5);
        percentLabel.setAttribute('text-anchor', 'start');
        percentLabel.setAttribute('fill', '#ffffff');
        percentLabel.setAttribute('font-size', '12');
        percentLabel.textContent = `${stat.percentage.toFixed(1)}%`;
        svg.appendChild(percentLabel);
    });
    
    // Y-axis
    const yAxis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    yAxis.setAttribute('x1', padding.left);
    yAxis.setAttribute('y1', padding.top);
    yAxis.setAttribute('x2', padding.left);
    yAxis.setAttribute('y2', chartHeight - padding.bottom);
    yAxis.setAttribute('stroke', '#666');
    yAxis.setAttribute('stroke-width', '2');
    svg.appendChild(yAxis);
    
    // X-axis
    const xAxis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    xAxis.setAttribute('x1', padding.left);
    xAxis.setAttribute('y1', chartHeight - padding.bottom);
    xAxis.setAttribute('x2', chartWidth - padding.right);
    xAxis.setAttribute('y2', chartHeight - padding.bottom);
    xAxis.setAttribute('stroke', '#666');
    xAxis.setAttribute('stroke-width', '2');
    svg.appendChild(xAxis);
    
    // Y-axis label
    const yLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    yLabel.setAttribute('x', -(chartHeight / 2));
    yLabel.setAttribute('y', 20);
    yLabel.setAttribute('text-anchor', 'middle');
    yLabel.setAttribute('fill', '#999');
    yLabel.setAttribute('font-size', '14');
    yLabel.setAttribute('transform', 'rotate(-90)');
    yLabel.textContent = 'Characters';
    svg.appendChild(yLabel);
    
    // X-axis label
    const xLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    xLabel.setAttribute('x', chartWidth / 2);
    xLabel.setAttribute('y', chartHeight - 10);
    xLabel.setAttribute('text-anchor', 'middle');
    xLabel.setAttribute('fill', '#999');
    xLabel.setAttribute('font-size', '14');
    xLabel.textContent = 'Error Rate (%)';
    svg.appendChild(xLabel);
    
    // X-axis ticks
    const numTicks = 5;
    for (let i = 0; i <= numTicks; i++) {
        const percentage = (maxPercentage / numTicks) * i;
        const x = padding.left + (plotWidth / numTicks) * i;
        
        const tick = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        tick.setAttribute('x1', x);
        tick.setAttribute('y1', chartHeight - padding.bottom);
        tick.setAttribute('x2', x);
        tick.setAttribute('y2', chartHeight - padding.bottom + 5);
        tick.setAttribute('stroke', '#666');
        tick.setAttribute('stroke-width', '1');
        svg.appendChild(tick);
        
        const tickLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        tickLabel.setAttribute('x', x);
        tickLabel.setAttribute('y', chartHeight - padding.bottom + 20);
        tickLabel.setAttribute('text-anchor', 'middle');
        tickLabel.setAttribute('fill', '#999');
        tickLabel.setAttribute('font-size', '12');
        tickLabel.textContent = percentage.toFixed(1);
        svg.appendChild(tickLabel);
    }
    
    charDistDiv.appendChild(svg);
    
    // Add tooltip functionality
    const bars = svg.querySelectorAll('.chart-bar');
    const tooltip = document.createElement('div');
    tooltip.classList.add('chart-tooltip');
    tooltip.style.display = 'none';
    charDistDiv.appendChild(tooltip);
    
    bars.forEach(bar => {
        bar.addEventListener('mouseenter', (e) => {
            const char = e.target.getAttribute('data-char');
            const percentage = e.target.getAttribute('data-percentage');
            const count = e.target.getAttribute('data-count');
            
            tooltip.innerHTML = `<strong>'${char}'</strong><br>${percentage}% (${count})`;
            tooltip.style.display = 'block';
            
            e.target.setAttribute('opacity', '1');
        });
        
        bar.addEventListener('mousemove', (e) => {
            tooltip.style.left = (e.pageX + 10) + 'px';
            tooltip.style.top = (e.pageY - 30) + 'px';
        });
        
        bar.addEventListener('mouseleave', (e) => {
            tooltip.style.display = 'none';
            e.target.setAttribute('opacity', '0.8');
        });
    });
}

// Display top 20 problematic words
async function displayWordProblems() {
    const wordStats = await getWordStats();
    const wordProblemsDiv = document.getElementById('word-problems');
    
    if (Object.keys(wordStats).length === 0) {
        wordProblemsDiv.innerHTML = '<p class="empty-state">No word statistics recorded yet.</p>';
        return;
    }
    
    // Calculate error probability for each word
    const wordProbabilities = [];
    
    for (const [word, bitfield] of Object.entries(wordStats)) {
        const { successes, failures, total: totalAttempts } = parseBitfield(bitfield);

        if (totalAttempts > 0) {
            // Simple error rate: failures / total attempts
            const errorRate = (failures / totalAttempts) * 100;
            wordProbabilities.push({
                word,
                errorRate,
                success: successes,
                failure: failures,
                total: totalAttempts
            });
        }
    }    // Sort by error rate (descending - highest error rate first)
    wordProbabilities.sort((a, b) => b.errorRate - a.errorRate);
    
    // Take top 20
    const top20 = wordProbabilities.slice(0, 20);
    
    // Create horizontal bar chart
    const chartWidth = 800;
    const barHeight = 25;
    const padding = { top: 20, right: 80, bottom: 40, left: 200 };
    const chartHeight = padding.top + padding.bottom + (top20.length * barHeight);
    const plotWidth = chartWidth - padding.left - padding.right;
    
    const maxErrorRate = Math.max(...top20.map(w => w.errorRate));
    
    // Create SVG
    wordProblemsDiv.innerHTML = '';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', chartWidth);
    svg.setAttribute('height', chartHeight);
    svg.classList.add('word-chart');
    
    // Create bars
    top20.forEach((item, i) => {
        const barWidth = (item.errorRate / maxErrorRate) * plotWidth;
        const y = padding.top + i * barHeight;
        
        // Bar
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', padding.left);
        rect.setAttribute('y', y + 2);
        rect.setAttribute('width', barWidth);
        rect.setAttribute('height', barHeight - 4);
        rect.setAttribute('fill', '#f44336');
        rect.setAttribute('opacity', '0.8');
        rect.classList.add('chart-bar');
        
        // Add hover effect data
        rect.setAttribute('data-word', item.word);
        rect.setAttribute('data-error-rate', item.errorRate.toFixed(2));
        rect.setAttribute('data-stats', `${item.failure} errors in ${item.total} attempts`);
        
        svg.appendChild(rect);
        
        // Y-axis label (word)
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', padding.left - 10);
        label.setAttribute('y', y + barHeight / 2 + 5);
        label.setAttribute('text-anchor', 'end');
        label.setAttribute('fill', '#ffffff');
        label.setAttribute('font-size', '14');
        label.setAttribute('font-family', 'Courier New, monospace');
        label.textContent = `'${item.word}'`;
        svg.appendChild(label);
        
        // Error rate label at end of bar
        const percentLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        percentLabel.setAttribute('x', padding.left + barWidth + 5);
        percentLabel.setAttribute('y', y + barHeight / 2 + 5);
        percentLabel.setAttribute('text-anchor', 'start');
        percentLabel.setAttribute('fill', '#ffffff');
        percentLabel.setAttribute('font-size', '12');
        percentLabel.textContent = `${item.errorRate.toFixed(1)}%`;
        svg.appendChild(percentLabel);
    });
    
    // Y-axis
    const yAxis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    yAxis.setAttribute('x1', padding.left);
    yAxis.setAttribute('y1', padding.top);
    yAxis.setAttribute('x2', padding.left);
    yAxis.setAttribute('y2', chartHeight - padding.bottom);
    yAxis.setAttribute('stroke', '#666');
    yAxis.setAttribute('stroke-width', '2');
    svg.appendChild(yAxis);
    
    // X-axis
    const xAxis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    xAxis.setAttribute('x1', padding.left);
    xAxis.setAttribute('y1', chartHeight - padding.bottom);
    xAxis.setAttribute('x2', chartWidth - padding.right);
    xAxis.setAttribute('y2', chartHeight - padding.bottom);
    xAxis.setAttribute('stroke', '#666');
    xAxis.setAttribute('stroke-width', '2');
    svg.appendChild(xAxis);
    
    // Y-axis label
    const yLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    yLabel.setAttribute('x', -(chartHeight / 2));
    yLabel.setAttribute('y', 20);
    yLabel.setAttribute('text-anchor', 'middle');
    yLabel.setAttribute('fill', '#999');
    yLabel.setAttribute('font-size', '14');
    yLabel.setAttribute('transform', 'rotate(-90)');
    yLabel.textContent = 'Words';
    svg.appendChild(yLabel);
    
    // X-axis label
    const xLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    xLabel.setAttribute('x', chartWidth / 2);
    xLabel.setAttribute('y', chartHeight - 10);
    xLabel.setAttribute('text-anchor', 'middle');
    xLabel.setAttribute('fill', '#999');
    xLabel.setAttribute('font-size', '14');
    xLabel.textContent = 'Error Rate (%)';
    svg.appendChild(xLabel);
    
    // X-axis ticks
    const numTicks = 5;
    for (let i = 0; i <= numTicks; i++) {
        const errorRate = (maxErrorRate / numTicks) * i;
        const x = padding.left + (plotWidth / numTicks) * i;
        
        const tick = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        tick.setAttribute('x1', x);
        tick.setAttribute('y1', chartHeight - padding.bottom);
        tick.setAttribute('x2', x);
        tick.setAttribute('y2', chartHeight - padding.bottom + 5);
        tick.setAttribute('stroke', '#666');
        tick.setAttribute('stroke-width', '1');
        svg.appendChild(tick);
        
        const tickLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        tickLabel.setAttribute('x', x);
        tickLabel.setAttribute('y', chartHeight - padding.bottom + 20);
        tickLabel.setAttribute('text-anchor', 'middle');
        tickLabel.setAttribute('fill', '#999');
        tickLabel.setAttribute('font-size', '12');
        tickLabel.textContent = errorRate.toFixed(1);
        svg.appendChild(tickLabel);
    }
    
    wordProblemsDiv.appendChild(svg);
    
    // Add tooltip functionality
    const bars = svg.querySelectorAll('.chart-bar');
    const tooltip = document.createElement('div');
    tooltip.classList.add('chart-tooltip');
    tooltip.style.display = 'none';
    wordProblemsDiv.appendChild(tooltip);
    
    bars.forEach(bar => {
        bar.addEventListener('mouseenter', (e) => {
            const word = e.target.getAttribute('data-word');
            const errorRate = e.target.getAttribute('data-error-rate');
            const stats = e.target.getAttribute('data-stats');
            
            tooltip.innerHTML = `<strong>'${word}'</strong><br>${errorRate}% error rate<br>${stats}`;
            tooltip.style.display = 'block';
            
            e.target.setAttribute('opacity', '1');
        });
        
        bar.addEventListener('mousemove', (e) => {
            tooltip.style.left = (e.pageX + 10) + 'px';
            tooltip.style.top = (e.pageY - 30) + 'px';
        });
        
        bar.addEventListener('mouseleave', (e) => {
            tooltip.style.display = 'none';
            e.target.setAttribute('opacity', '0.8');
        });
    });
}

// Export data as JSON
async function exportData() {
    const wordStats = await getWordStats();
    const mistypedChars = await getMistypedChars();
    const charStats = await getCharStats();
    
    const data = {
        words: wordStats,
        mistyped_chars: mistypedChars,
        char_stats: charStats
    };
    
    const dataStr = JSON.stringify(data, null, 4);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `typing-stats-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Clear all data from IndexedDB
async function clearAllData() {
    if (!confirm('Are you sure you want to clear all typing data? This action cannot be undone.')) {
        return;
    }
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['wordStats', 'mistypedChars', 'settings'], 'readwrite');
        
        const wordStatsStore = transaction.objectStore('wordStats');
        const mistypedCharsStore = transaction.objectStore('mistypedChars');
        
        wordStatsStore.clear();
        mistypedCharsStore.clear();
        // Only the sprint history is statistics; the other settings are options
        transaction.objectStore('settings').delete('sprintRuns');
        
        transaction.oncomplete = () => {
            alert('All data has been cleared!');
            // Refresh the page to show empty state
            window.location.reload();
            resolve();
        };
        
        transaction.onerror = () => reject(transaction.error);
    });
}

// Display all words statistics table
async function displayWordTable() {
    const wordStats = await getWordStats();
    const tableContainer = document.getElementById('word-table-container');
    
    if (Object.keys(wordStats).length === 0) {
        tableContainer.innerHTML = '<p class="empty-state">No word statistics recorded yet.</p>';
        return;
    }
    
    // Import WORDS for frequency lookup
    const { WORDS } = await import('./words.js');
    
    // Calculate statistics for all words
    const wordData = [];
    
    for (const [word, bitfield] of Object.entries(wordStats)) {
        const { successes, failures, total: totalAttempts } = parseBitfield(bitfield);
        const frequency = WORDS[word.toLowerCase()] || 0; // Get frequency from WORDS dictionary

        if (totalAttempts > 0) {
            const probaFail = (failures / totalAttempts) * 100;
            const probaFailFreq = probaFail * frequency;

            wordData.push({
                word,
                success: successes,
                failure: failures,
                frequency,
                probaFail,
                probaFailFreq
            });
        }
    }    // Sort state
    let currentSort = { column: 'probaFailFreq', ascending: false };
    
    // Function to sort and render table
    function renderTable(data, sortColumn, ascending) {
        // Sort data
        const sortedData = [...data].sort((a, b) => {
            let aVal = a[sortColumn];
            let bVal = b[sortColumn];
            
            // String comparison for word column
            if (sortColumn === 'word') {
                return ascending ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
            }
            
            // Numeric comparison for other columns
            return ascending ? aVal - bVal : bVal - aVal;
        });
        
        // Create table
        tableContainer.innerHTML = '';
        const table = document.createElement('table');
        table.classList.add('word-table');
        
        // Table header
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        
        const columns = [
            { key: 'word', label: 'Word' },
            { key: 'success', label: 'Success' },
            { key: 'failure', label: 'Fail' },
            { key: 'frequency', label: 'Frequency' },
            { key: 'probaFail', label: 'Proba Fail (%)' },
            { key: 'probaFailFreq', label: 'Proba Fail × Frequency' }
        ];
        
        columns.forEach(col => {
            const th = document.createElement('th');
            th.classList.add('sortable');
            if (sortColumn === col.key) {
                th.classList.add('sorted');
                th.classList.add(ascending ? 'asc' : 'desc');
            }
            
            // Use textContent for label and create span for arrow
            th.textContent = col.label + ' ';
            const arrow = document.createElement('span');
            arrow.classList.add('sort-arrow');
            arrow.textContent = sortColumn === col.key ? (ascending ? '▲' : '▼') : '⇅';
            th.appendChild(arrow);
            
            th.addEventListener('click', () => {
                const newAscending = sortColumn === col.key ? !ascending : false;
                currentSort = { column: col.key, ascending: newAscending };
                renderTable(data, col.key, newAscending);
            });
            
            headerRow.appendChild(th);
        });
        
        thead.appendChild(headerRow);
        table.appendChild(thead);
        
        // Table body
        const tbody = document.createElement('tbody');
        for (const item of sortedData) {
            const row = document.createElement('tr');
            
            // Format frequency as "X.XXe+XX" to maintain sort order
            let freqStr;
            if (item.frequency === 0) {
                freqStr = '0.00e+00';
            } else {
                const exp = Math.floor(Math.log10(item.frequency));
                const mantissa = item.frequency / Math.pow(10, exp);
                freqStr = `${mantissa.toFixed(2)}e${exp >= 0 ? '+' : ''}${exp.toString().padStart(2, '0')}`;
            }
            
            // Use textContent to prevent XSS
            const wordCell = document.createElement('td');
            wordCell.classList.add('word-cell');
            wordCell.textContent = item.word;
            row.appendChild(wordCell);
            
            const successCell = document.createElement('td');
            successCell.textContent = item.success;
            row.appendChild(successCell);
            
            const failureCell = document.createElement('td');
            failureCell.textContent = item.failure;
            row.appendChild(failureCell);
            
            const freqCell = document.createElement('td');
            freqCell.textContent = freqStr;
            row.appendChild(freqCell);
            
            const probaFailCell = document.createElement('td');
            probaFailCell.textContent = item.probaFail.toFixed(2);
            row.appendChild(probaFailCell);
            
            const probaFailFreqCell = document.createElement('td');
            probaFailFreqCell.textContent = item.probaFailFreq.toExponential(2);
            row.appendChild(probaFailFreqCell);
            
            tbody.appendChild(row);
        }
        table.appendChild(tbody);
        
        tableContainer.appendChild(table);
    }
    
    // Initial render (sorted by probaFailFreq descending)
    renderTable(wordData, currentSort.column, currentSort.ascending);
}

// Display per-character error rate: of all the times a character was typed,
// what share of those keystrokes were wrong.
async function displayCharErrorRate() {
    const { attempts, errors } = await getCharStats();
    const container = document.getElementById('char-error-rate');

    // Ignore characters with too few samples: a single miss out of 2 tries
    // would otherwise show up as a 50% error rate.
    const MIN_ATTEMPTS = 10;

    const stats = Object.entries(attempts)
        .filter(([, n]) => n >= MIN_ATTEMPTS)
        .map(([char, n]) => ({
            char,
            attempts: n,
            errors: errors[char] || 0,
            percentage: ((errors[char] || 0) / n) * 100
        }))
        .sort((a, b) => b.percentage - a.percentage)
        .slice(0, 20);

    if (stats.length === 0) {
        container.innerHTML = `<p class="empty-state">Not enough data yet — each character needs at least ${MIN_ATTEMPTS} attempts. Keep practicing!</p>`;
        return;
    }

    const SVG_NS = 'http://www.w3.org/2000/svg';
    const make = (tag, attrs) => {
        const el = document.createElementNS(SVG_NS, tag);
        for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
        return el;
    };

    const chartWidth = 800;
    const barHeight = 25;
    const padding = { top: 20, right: 110, bottom: 40, left: 60 };
    const chartHeight = padding.top + padding.bottom + (stats.length * barHeight);
    const plotWidth = chartWidth - padding.left - padding.right;
    const maxPercentage = Math.max(...stats.map(s => s.percentage));

    container.innerHTML = '';
    const svg = make('svg', { width: chartWidth, height: chartHeight });
    svg.classList.add('char-chart');

    stats.forEach((stat, i) => {
        const barWidth = maxPercentage > 0 ? (stat.percentage / maxPercentage) * plotWidth : 0;
        const y = padding.top + i * barHeight;
        const displayChar = stat.char === ' ' ? '⎵' : stat.char;

        const rect = make('rect', {
            x: padding.left,
            y: y + 2,
            width: barWidth,
            height: barHeight - 4,
            fill: '#ff9800',
            opacity: '0.8',
            'data-char': displayChar,
            'data-percentage': stat.percentage.toFixed(2),
            'data-count': `${stat.errors}/${stat.attempts}`
        });
        rect.classList.add('chart-bar');
        svg.appendChild(rect);

        const label = make('text', {
            x: padding.left - 10,
            y: y + barHeight / 2 + 5,
            'text-anchor': 'end',
            fill: '#ffffff',
            'font-size': '14',
            'font-family': 'Courier New, monospace'
        });
        label.textContent = `'${displayChar}'`;
        svg.appendChild(label);

        const valueLabel = make('text', {
            x: padding.left + barWidth + 5,
            y: y + barHeight / 2 + 5,
            'text-anchor': 'start',
            fill: '#ffffff',
            'font-size': '12'
        });
        valueLabel.textContent = `${stat.percentage.toFixed(1)}%  (${stat.errors}/${stat.attempts})`;
        svg.appendChild(valueLabel);
    });

    svg.appendChild(make('line', {
        x1: padding.left, y1: padding.top,
        x2: padding.left, y2: chartHeight - padding.bottom,
        stroke: '#666', 'stroke-width': '2'
    }));
    svg.appendChild(make('line', {
        x1: padding.left, y1: chartHeight - padding.bottom,
        x2: chartWidth - padding.right, y2: chartHeight - padding.bottom,
        stroke: '#666', 'stroke-width': '2'
    }));

    const xLabel = make('text', {
        x: chartWidth / 2,
        y: chartHeight - 10,
        'text-anchor': 'middle',
        fill: '#999',
        'font-size': '14'
    });
    xLabel.textContent = 'Error Rate (%)';
    svg.appendChild(xLabel);

    const numTicks = 5;
    for (let i = 0; i <= numTicks; i++) {
        const x = padding.left + (plotWidth / numTicks) * i;
        svg.appendChild(make('line', {
            x1: x, y1: chartHeight - padding.bottom,
            x2: x, y2: chartHeight - padding.bottom + 5,
            stroke: '#666', 'stroke-width': '1'
        }));
        const tickLabel = make('text', {
            x, y: chartHeight - padding.bottom + 20,
            'text-anchor': 'middle',
            fill: '#999',
            'font-size': '12'
        });
        tickLabel.textContent = ((maxPercentage / numTicks) * i).toFixed(1);
        svg.appendChild(tickLabel);
    }

    container.appendChild(svg);

    // Tooltip
    const tooltip = document.createElement('div');
    tooltip.classList.add('chart-tooltip');
    tooltip.style.display = 'none';
    container.appendChild(tooltip);

    svg.querySelectorAll('.chart-bar').forEach(bar => {
        bar.addEventListener('mouseenter', (e) => {
            tooltip.innerHTML = `<strong>'${e.target.getAttribute('data-char')}'</strong><br>` +
                `${e.target.getAttribute('data-percentage')}% wrong (${e.target.getAttribute('data-count')})`;
            tooltip.style.display = 'block';
            e.target.setAttribute('opacity', '1');
        });
        bar.addEventListener('mousemove', (e) => {
            const rect = container.getBoundingClientRect();
            tooltip.style.left = `${e.clientX - rect.left + 15}px`;
            tooltip.style.top = `${e.clientY - rect.top + 15}px`;
        });
        bar.addEventListener('mouseleave', (e) => {
            tooltip.style.display = 'none';
            e.target.setAttribute('opacity', '0.8');
        });
    });
}

// --- Sprint history ---------------------------------------------------------
// Create an SVG element with the given attributes
const SVG_NS = 'http://www.w3.org/2000/svg';
function make(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
}

// Each completed Sprint test stores { wpm, accuracy } (accuracy in 0..1) under
// the 'sprintRuns' key of the settings store, written by app.js.
async function getSprintRuns() {
    return new Promise((resolve) => {
        let transaction;
        try {
            transaction = db.transaction(['settings'], 'readonly');
        } catch (e) {
            // Older databases may not have the settings store yet
            resolve([]);
            return;
        }
        const request = transaction.objectStore('settings').get('sprintRuns');
        request.onsuccess = () => {
            const runs = request.result?.value;
            if (!Array.isArray(runs)) {
                resolve([]);
                return;
            }
            resolve(runs
                .map(r => ({ wpm: Number(r?.wpm), accuracy: Number(r?.accuracy) }))
                .filter(r => Number.isFinite(r.wpm) && Number.isFinite(r.accuracy)));
        };
        request.onerror = () => resolve([]);
    });
}

// Build an <svg> with the usual dark-theme axes and return the pieces callers
// need to place points: the element, the plot box and two value->pixel scales.
function createPlot({ width, height, padding, xMax, yMax }) {
    const svg = make('svg', { width, height });
    svg.classList.add('char-chart');

    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const x0 = padding.left;
    const y0 = height - padding.bottom;

    // Axes
    svg.appendChild(make('line', {
        x1: x0, y1: padding.top, x2: x0, y2: y0, stroke: '#666', 'stroke-width': '2'
    }));
    svg.appendChild(make('line', {
        x1: x0, y1: y0, x2: width - padding.right, y2: y0, stroke: '#666', 'stroke-width': '2'
    }));

    return {
        svg,
        x: v => x0 + (xMax > 0 ? (v / xMax) * plotWidth : 0),
        y: v => y0 - (yMax > 0 ? (v / yMax) * plotHeight : 0),
        plotWidth,
        plotHeight,
        x0,
        y0
    };
}

// Axis label helper
function addAxisLabel(svg, text, attrs) {
    const label = make('text', { fill: '#999', 'font-size': '13', ...attrs });
    label.textContent = text;
    svg.appendChild(label);
}

// Speed and accuracy of every Sprint run, in the order they were typed.
// Two independent scales share the plot: WPM on the left, accuracy on the right.
async function displaySprintHistory() {
    const container = document.getElementById('sprint-history');
    if (!container) return;

    const runs = await getSprintRuns();
    if (runs.length === 0) {
        container.innerHTML = '<p class="empty-state">No sprint runs recorded yet. Complete a Sprint test to see your progress!</p>';
        return;
    }

    const width = 800;
    const height = 320;
    const padding = { top: 20, right: 60, bottom: 50, left: 60 };

    // WPM is scaled against the best run ever, accuracy always against 100%
    const bestWpm = Math.max(...runs.map(r => r.wpm));
    const wpmMax = Math.max(bestWpm, 1);

    const plot = createPlot({
        width, height, padding,
        xMax: Math.max(runs.length - 1, 1),
        yMax: 1
    });

    // Horizontal gridlines, labelled in WPM on the left and % on the right
    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
        const frac = i / ticks;
        const y = plot.y(frac);
        plot.svg.appendChild(make('line', {
            x1: plot.x0, y1: y, x2: width - padding.right, y2: y,
            stroke: '#333', 'stroke-width': '1'
        }));
        addAxisLabel(plot.svg, (wpmMax * frac).toFixed(0), {
            x: plot.x0 - 8, y: y + 4, 'text-anchor': 'end', fill: '#4CAF50'
        });
        addAxisLabel(plot.svg, `${(frac * 100).toFixed(0)}%`, {
            x: width - padding.right + 8, y: y + 4, 'text-anchor': 'start', fill: '#2196F3'
        });
    }

    // Both series are normalised to 0..1 so they can share the same plot box
    const wpmPoints = runs.map((r, i) => ({ x: plot.x(i), y: plot.y(r.wpm / wpmMax) }));
    const accPoints = runs.map((r, i) => ({ x: plot.x(i), y: plot.y(r.accuracy) }));

    // Dots only: connecting lines imply a continuity between runs that isn't
    // there, and they get noisy once there are more than a handful.
    for (const p of wpmPoints) {
        plot.svg.appendChild(make('circle', { cx: p.x, cy: p.y, r: 3, fill: '#4CAF50' }));
    }
    for (const p of accPoints) {
        plot.svg.appendChild(make('circle', { cx: p.x, cy: p.y, r: 3, fill: '#2196F3' }));
    }

    addAxisLabel(plot.svg, `Sprint runs (oldest to newest, ${runs.length} total)`, {
        x: width / 2, y: height - 12, 'text-anchor': 'middle'
    });

    container.innerHTML = '';
    container.appendChild(plot.svg);

    const legend = document.createElement('p');
    legend.classList.add('section-hint');
    legend.innerHTML = '<span style="color:#4CAF50">\u25cf WPM</span> &nbsp;&nbsp; ' +
        '<span style="color:#2196F3">\u25cf Accuracy</span>';
    container.appendChild(legend);
}

// Every Sprint run as a point, to show how speed trades off against accuracy
async function displaySprintScatter() {
    const container = document.getElementById('sprint-scatter');
    if (!container) return;

    const runs = await getSprintRuns();
    if (runs.length === 0) {
        container.innerHTML = '<p class="empty-state">No sprint runs recorded yet.</p>';
        return;
    }

    const width = 800;
    const height = 360;
    const padding = { top: 20, right: 30, bottom: 50, left: 60 };

    const wpmMax = Math.max(Math.max(...runs.map(r => r.wpm)), 1);

    const plot = createPlot({ width, height, padding, xMax: 1, yMax: wpmMax });

    // Accuracy rarely drops far, so the x axis still spans the full 0-100%
    const ticks = 5;
    for (let i = 0; i <= ticks; i++) {
        const frac = i / ticks;
        const x = plot.x(frac);
        plot.svg.appendChild(make('line', {
            x1: x, y1: plot.y0, x2: x, y2: plot.y0 + 5, stroke: '#666', 'stroke-width': '1'
        }));
        addAxisLabel(plot.svg, `${(frac * 100).toFixed(0)}%`, {
            x, y: plot.y0 + 20, 'text-anchor': 'middle'
        });

        const y = plot.y(wpmMax * frac);
        plot.svg.appendChild(make('line', {
            x1: plot.x0, y1: y, x2: width - padding.right, y2: y,
            stroke: '#333', 'stroke-width': '1'
        }));
        addAxisLabel(plot.svg, (wpmMax * frac).toFixed(0), {
            x: plot.x0 - 8, y: y + 4, 'text-anchor': 'end'
        });
    }

    // Older runs are faded so the recent ones stand out
    runs.forEach((r, i) => {
        plot.svg.appendChild(make('circle', {
            cx: plot.x(r.accuracy),
            cy: plot.y(r.wpm),
            r: 4,
            fill: '#4CAF50',
            opacity: (0.25 + 0.75 * (i / Math.max(runs.length - 1, 1))).toFixed(2)
        }));
    });

    addAxisLabel(plot.svg, 'Accuracy', {
        x: width / 2, y: height - 12, 'text-anchor': 'middle'
    });
    addAxisLabel(plot.svg, 'WPM', {
        x: 16, y: height / 2, 'text-anchor': 'middle',
        transform: `rotate(-90 16 ${height / 2})`
    });

    container.innerHTML = '';
    container.appendChild(plot.svg);
}

// Initialize page
async function init() {
    try {
        await initDB();
    } catch (e) {
        console.error('Failed to init DB in stats.js:', e);
        return;
    }
    await displaySprintHistory();
    await displaySprintScatter();
    await displayCharDistribution();
    await displayCharErrorRate();
    await displayWordProblems();
    await displayWordTable();
    
    // Setup export button
    document.getElementById('export-btn').addEventListener('click', exportData);
    
    // Setup clear button
    document.getElementById('clear-btn').addEventListener('click', clearAllData);
}

init();
