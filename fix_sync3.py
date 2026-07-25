path = '/home/doug/kreweweb/Krewe/scripts/sync_schema.sh'
with open(path, 'r', encoding='utf-8') as f:
    s = f.read()

old_comment = "    /^COMMENT ON/ { while (getline && $0 !~ /;$/) {}; next }\n"
new_comment = "    /^COMMENT ON/ { if ($0 !~ /;$/) { while (getline && $0 !~ /;$/) {} } next }\n"
assert s.count(old_comment) == 1, 'comment=%d' % s.count(old_comment)
s = s.replace(old_comment, new_comment)

old_seq = "    /^CREATE SEQUENCE / { while (getline && $0 !~ /;$/) {}; next }\n"
new_seq = "    /^CREATE SEQUENCE / { if ($0 !~ /;$/) { while (getline && $0 !~ /;$/) {} } next }\n"
assert s.count(old_seq) == 1, 'seq=%d' % s.count(old_seq)
s = s.replace(old_seq, new_seq)

old_cmt = "    # CREATE FUNCTION: make it CREATE OR REPLACE, pass the body through verbatim.\n"
new_cmt = (
    "    # CREATE FUNCTION: make it CREATE OR REPLACE and replay the body verbatim.\n"
    "    # Stop at the closing dollar-quote line (pg_dump emits the body as $$ ... $$;\n"
    "    # or $$ LANGUAGE ...;). The opening \"AS $$\" never starts with $$ so it is\n"
    "    # never mistaken for the terminator.\n"
)
assert s.count(old_cmt) == 1, 'cmt=%d' % s.count(old_cmt)
s = s.replace(old_cmt, new_cmt)

old_fn = "      while (getline && $0 !~ /END[[:space:]]*\\$\\;?$/) { print }\n"
new_fn = "      while (getline && $0 !~ /^[[:space:]]*\\$\\$/ && $0 !~ /^[[:space:]]*\\$[A-Za-z_]*\\$;?$/) { print }\n"
assert s.count(old_fn) == 1, 'fn=%d' % s.count(old_fn)
s = s.replace(old_fn, new_fn)

with open(path, 'w', encoding='utf-8') as f:
    f.write(s)
print('sync_schema.sh handlers updated OK')
