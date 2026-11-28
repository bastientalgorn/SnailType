// Script to generate substrings.js: trigrams, tetragrams, and pentagrams
// with aggregated frequency from words.js
import { WORDS } from './words.js';
import fs from 'fs';

const map = Object.create(null);

for (const [word, freq] of Object.entries(WORDS)) {
    for (let L = 3; L <= 5; L++) {
        if (word.length < L) continue;
        for (let i = 0; i + L <= word.length; i++) {
            const sub = word.substring(i, i + L);
            map[sub] = (map[sub] || 0) + freq;
        }
    }
}

// Sort by frequency descending
const entries = Object.entries(map).sort((a, b) => b[1] - a[1]);

let out = '// Auto-generated substring frequency list (trigrams, tetragrams, pentagrams)\n';
out += '// Generated from words.js by generate_substrings.js\n';
out += 'export const SUBSTRINGS = {\n';
for (const [sub, freq] of entries) {
    out += `    "${sub}": ${freq},\n`;
}
out += '};\n';

fs.writeFileSync(new URL('./substrings.js', import.meta.url), out, 'utf8');
console.log(`Wrote ${entries.length} substrings to substrings.js`);
