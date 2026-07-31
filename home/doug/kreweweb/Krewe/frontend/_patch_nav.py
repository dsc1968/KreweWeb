import re, sys

path = '/home/doug/kreweweb/Krewe/frontend/script.js'
with open(path, 'r', encoding='utf-8') as f:
    src = f.read()

# 1) Convert the premature top-level IIFE (which ran BEFORE initHeaderState()
#    injected the .site-nav markup, so document.querySelector('.site-nav')
#    returned null and the toggle was never created) into a reusable function.
pattern = r"\(function \(\) \{\n  const nav = document\.querySelector\('\.site-nav'\);.*?\n\}\)\(\);"

new_fn = (
    "function initHamburgerNav() {\n"
    "  const headerInner = document.querySelector('.header-inner');\n"
    "  // Nav is injected into #nav-mount by initHeaderState(); if it isn't\n"
    "  // present yet, bail and let a later call (after injection) create it.\n"
    "  const nav = document.querySelector('.site-nav');\n"
    "  if (!nav || !headerInner) return;\n"
    "\n"
    "  // Don't create duplicate toggles on repeated init calls.\n"
    "  if (headerInner.querySelector('.nav-toggle')) return;\n"
    "\n"
    "  const btn = document.createElement('button');\n"
    "  btn.className = 'nav-toggle';\n"
    "  btn.setAttribute('aria-label', 'Toggle navigation');\n"
    "  btn.setAttribute('aria-expanded', 'false');\n"
    "  btn.innerHTML = '&#9776;';\n"
    "  headerInner.appendChild(btn);\n"
    "\n"
    "  btn.addEventListener('click', () => {\n"
    "    // Re-query in case the nav element was replaced (e.g. admin reorder).\n"
    "    const currentNav = document.querySelector('.site-nav');\n"
    "    if (!currentNav) return;\n"
    "    const open = currentNav.classList.toggle('is-open');\n"
    "    btn.setAttribute('aria-expanded', String(open));\n"
    "    btn.innerHTML = open ? '&times;' : '&#9776;';\n"
    "  });\n"
    "\n"
    "  // Close the nav when a nav link is tapped (mobile). Delegated so it\n"
    "  // keeps working even if the nav markup is rebuilt.\n"
    "  document.addEventListener('click', (e) => {\n"
    "    const currentNav = document.querySelector('.site-nav');\n"
    "    if (currentNav && currentNav.contains(e.target) && e.target.closest('a')) {\n"
    "      currentNav.classList.remove('is-open');\n"
    "      btn.setAttribute('aria-expanded', 'false');\n"
    "      btn.innerHTML = '&#9776;';\n"
    "    }\n"
    "  });\n"
    "}\n"
)

new_src, n1 = re.subn(pattern, new_fn, src, count=1, flags=re.DOTALL)
if n1 != 1:
    sys.exit('ERROR: IIFE replacement count = %d' % n1)

# 2) Call it at the end of initHeaderState() (after the nav is injected).
marker = "      headerInner.appendChild(actions);\n    }\n  }\n"
count = new_src.count(marker)
if count != 1:
    sys.exit('ERROR: initHeaderState tail marker found %d times' % count)
replacement = (
    "      headerInner.appendChild(actions);\n"
    "    }\n"
    "\n"
    "    // Build the mobile hamburger toggle now that #nav-mount is populated.\n"
    "    initHamburgerNav();\n"
    "  }\n"
)
new_src = new_src.replace(marker, replacement, 1)

with open(path, 'w', encoding='utf-8') as f:
    f.write(new_src)
print('patched OK')
