import re
p = 'scripts/sync_schema.sh'
s = open(p, encoding='utf-8').read()

start_literal = "  /^ALTER TABLE ONLY [^ ]+/ && !/ADD/ {"
pattern = re.compile(re.escape(start_literal) + r".*?\n  \}\n", re.S)
assert pattern.search(s), 'ALTER handler block not found'

new_block = '''  /^ALTER TABLE ONLY [^ ]+/ && !/ADD/ {
    # Buffer the header; emit an idempotent DO block when the following line
    # is an ADD CONSTRAINT. A state variable (not getline) is used so we never
    # consume or duplicate the statement that follows the constraint.
    pendingAlter = $0
    next
  }
  pendingAlter != "" && /^[[:space:]]*ADD CONSTRAINT/ {
    rest = $0
    sub(/^[[:space:]]*ADD CONSTRAINT /, "", rest)
    cname = rest; sub(/ .*$/, "", cname)
    n = split(pendingAlter, p, " "); tbl = p[4]
    if (rest ~ /PRIMARY KEY/) { pendingAlter = ""; next }   # redundant PK from CREATE TABLE
    print "DO $$"
    print "BEGIN"
    print "  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '"'"'" cname "'"'"' AND conrelid = '"'"'" tbl "'"'"'::regclass) THEN"
    print "    " pendingAlter " ADD CONSTRAINT " rest
    print "  END IF;"
    print "END $$;"
    pendingAlter = ""
    next
  }
  pendingAlter != "" {
    # Header seen but the next line was not an ADD CONSTRAINT (defensive).
    print pendingAlter
    pendingAlter = ""
  }
'''
s2 = pattern.sub(new_block, s, count=1)
assert s2 != s, 'no replacement made'
open(p, 'w', encoding='utf-8').write(s2)
print('ALTER handler replaced with state-variable version')
