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
    
    const data = {
        words: wordStats,
        mistyped_chars: mistypedChars
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
        const transaction = db.transaction(['wordStats', 'mistypedChars'], 'readwrite');
        
        const wordStatsStore = transaction.objectStore('wordStats');
        const mistypedCharsStore = transaction.objectStore('mistypedChars');
        
        wordStatsStore.clear();
        mistypedCharsStore.clear();
        
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

// Initialize page
async function init() {
    try {
        await initDB();
    } catch (e) {
        console.error('Failed to init DB in stats.js:', e);
        return;
    }
    await displayCharDistribution();
    await displayWordProblems();
    await displayWordTable();
    
    // Setup export button
    document.getElementById('export-btn').addEventListener('click', exportData);
    
    // Setup clear button
    document.getElementById('clear-btn').addEventListener('click', clearAllData);
}

init();
