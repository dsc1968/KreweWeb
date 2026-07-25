p = 'backend/config/db.js'
s = open(p, encoding='utf-8').read()

marker = "  `);\n\n  // Ensure floats.id is unique."
assert s.count(marker) == 1, 'boundary marker count=%d' % s.count(marker)
start = s.index('  // Ensure floats.id is unique.')
idx = s.index(marker, start)
# Remove block 1 (and the blank line separating it from block 2), keeping block 2.
cut = idx + len("  `);\n\n")
s = s[:start] + s[cut:]

assert s.count('Ensure floats.id is unique') == 1, 'after=%d' % s.count('Ensure floats.id is unique')
assert 'pg_constraint con' not in s, 'pg_constraint version still present'
open(p, 'w', encoding='utf-8').write(s)
print('duplicate removed; one block remains (pg_index version)')
