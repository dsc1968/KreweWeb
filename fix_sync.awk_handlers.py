path = '/home/doug/kreweweb/Krewe/scripts/sync_schema.sh'
with open(path, 'r', encoding='utf-8') as f:
    s = f.read()

# 1) COMMENT ON: don't consume the following statement.
old_comment = "    /^COMMENT ON/ { while (getline && $0 !~ /;$/) {}; next }\n"
new_comment = "    /^COMMENT ON/ { if ($0 !~ /;$/) { while (getline && $0 !~ /;$/) {} } next }\n"
assert s.count(old_comment) == 1, 'comment block count=%d' % s.count(old_comment)
s = s.replace(old_comment, new_comment)

# 2) CREATE SEQUENCE: don't consume the following statement.
old_seq = "    /^CREATE SEQUENCE / { while (getline && $0 !~ /;$/) {}; next }\n"
new_seq = "    /^CREATE SEQUENCE / { if ($0 !~ /;$/) { while (getline && $0 !~ /;$/) {} } next }\n"
assert s.count(old_seq) == 1, 'seq block count=%d' % s.count(old_seq)
s = s.replace(old_seq, new_seq)

# 3) CREATE FUNCTION: stop at the closing dollar-quote line, not a non-matching
#    END...$$; regex (which never matched, so the while loop ate the rest of
#    the file and duplicated the final line).
old_fn = (
    "    # CREATE FUNCTION: make it CREATE OR REPLACE, pass the body through verbatim.\n"
    "    /^CREATE FUNCTION / || /^CREATE OR REPLACE FUNCTION / {\n"
    "      sub(/^CREATE FUNCTION /, \"CREATE OR REPLACE FUNCTION \")\n"
    "      print\n"
    "      while (getline && $0 !~ /END[[:space:]]*\\$\\;?$/) { print }\n"
    "      print\n"
    "      next\n"
    "    }\n"
)
new_fn = (
    "    # CREATE FUNCTION: make it CREATE OR REPLACE and replay the body verbatim.\n"
    "    # Stop at the closing dollar-quote line (pg_dump emits the body as $$ ... $$;\n"
    "    # or $$ LANGUAGE ...;). The opening \"AS $$\" never starts with $$ so it is\n"
    "    # never mistaken for the terminator.\n"
    "    /^CREATE FUNCTION / || /^CREATE OR REPLACE FUNCTION / {\n"
    "      sub(/^CREATE FUNCTION /, \"CREATE OR REPLACE FUNCTION \")\n"
    "      print\n"
    "      while (getline && $0 !~ /^[[:space:]]*\\$\\$/ && $0 !~ /^[[:space:]]*\\$[A-Za-z_]*\\$;?$/) { print }\n"
    "      print\n"
    "      next\n"
    "    }\n"
)
assert s.count(old_fn) == 1, 'fn block count=%d' % s.count(old_fn)
s = s.replace(old_fn, new_fn)

with open(path, 'w', encoding='utf-8') as f:
    f.write(s)
print('sync_schema.sh handlers updated')
