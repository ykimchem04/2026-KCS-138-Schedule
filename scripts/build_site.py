#!/usr/bin/env python3
"""
scripts/site_head.html + scripts/site_app.js + docs/data.json -> docs/index.html

    py scripts/build_data.py && py scripts/build_site.py

data.json is inlined. It is 2.5MB of mostly abstract text, which GitHub Pages
serves gzipped at a fraction of that, and inlining is what lets a copy saved to
a phone keep working with no network at the venue - the one place the site has
to work and the one place the wifi does not.
"""
import pathlib
import sys

root = pathlib.Path(__file__).resolve().parent.parent
head = (root / "scripts/site_head.html").read_text(encoding="utf-8")
app = (root / "scripts/site_app.js").read_text(encoding="utf-8")

data_path = root / "docs/data.json"
if not data_path.exists():
    sys.exit("docs/data.json missing - run scripts/build_data.py first")
data = data_path.read_text(encoding="utf-8")
if "</script" in data.lower():
    sys.exit("data.json contains a closing script tag - refusing to inline it")

out = root / "docs/index.html"
out.write_text(
    head + "\n<script>\nconst DATA = " + data + ";\n" + app + "\n</script>\n</body>\n</html>\n",
    encoding="utf-8")
print(f"built {out.relative_to(root)}, {out.stat().st_size / 1024:,.0f} KB")
