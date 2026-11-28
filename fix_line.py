lines = open(r'C:\PERSO\TYP_000\app.js', 'r', encoding='utf-8').readlines()
for i, line in enumerate(lines):
    if "attempts, %%" in line or "'':  attempts" in line or "attempts," in line and "fail" in line and "statLine.textContent" in lines[i-1] if i > 0 else False:
        print(f'Line {i}: {repr(line)}')

# Find the broken statLine.textContent in displayWordStats (around line 295-300)
for i, line in enumerate(lines):
    if i > 280 and i < 310 and 'statLine.textContent' in line:
        print(f'Found at line {i}: {repr(line)}')
        fixed = "        statLine.textContent = `'${word}': ${bitfield.length} attempts, ${failRate}% fail | test: +${delta.successes}ok +${delta.failures}err`;\n"
        lines[i] = fixed
        print(f'Fixed to: {repr(fixed)}')
        break

open(r'C:\PERSO\TYP_000\app.js', 'w', encoding='utf-8').writelines(lines)
print('Done')
