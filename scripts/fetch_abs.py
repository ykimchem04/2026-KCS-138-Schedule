#!/usr/bin/env python3
"""
Pull the KCS 138 programme from kchem.org into data/abstracts.json.

The site runs a DataTables endpoint that returns every abstract in one POST —
title, authors, hall, time and the abstract body together — so unlike a page
scrape this is a single request and there is no per-talk fetching to resume.

    py scripts/fetch_abs.py

Two things shape this file.

**The endpoint is CSRF-protected.** A bare POST gets 403 and an HTML error page.
So we GET the search page first, keep the session cookie, and read the token out
of its <meta name="_csrf"> before posting.

**The payload carries personal contact data.** Every record ships the
presenter's email address and mobile number, plus the submitting admin's
account, CV image paths and authority list. None of that belongs in a published
programme, so this reads through an allowlist: fields are copied in by name and
everything else is dropped. A denylist would be the wrong shape here — a field
added upstream would start flowing through it silently, and the failure mode is
publishing a thousand researchers' phone numbers. Nothing filtered is written to
disk at any point, including as an intermediate file.
"""
import argparse
import json
import pathlib
import re
import sys

import requests

BASE = "https://kchem.org"
EVENT = "kcs138"
SEARCH_URL = f"{BASE}/conf/{EVENT}/abs/search"
LIST_URL = f"{BASE}/conf/{EVENT}/abs/getAbsListAjax?trackId=0"

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/129.0 Safari/537.36")

# --- the allowlist ----------------------------------------------------------
# Only these survive. Contact details (contactOfPresenterEmail,
# contactOfPresenterMobile, author email), CV images and the submitting
# account are deliberately absent and must stay absent.
ABS_FIELDS = ("submitId", "title", "content")
AUTHOR_FIELDS = ("name", "affiliation", "department", "countryCode",
                 "presenter", "corresponding", "order")
TIME_FIELDS = ("time", "day", "order", "code", "stringDayKo")

BANNED = re.compile(r"email|mobile|phone|contact|cv[A-Z]|username|authority",
                    re.IGNORECASE)

EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")
# 010-1234-5678, +82 10 1234 5678, (02) 880-1234 — loose on purpose.
PHONE = re.compile(r"(?:\+?\d{1,3}[\s.-]?)?\(?0\d{1,2}\)?[\s.-]?\d{3,4}[\s.-]?\d{4}\b")


def scrub(text):
    """Authors sometimes type a corresponding-author address into the abstract
    itself. That was written to be printed, but a published page is crawled in a
    way a programme book is not, so it comes out here too — and the audit below
    stays absolute instead of carrying an exception for the body text."""
    if not text:
        return text
    text = EMAIL.sub("[이메일 생략]", text)
    return PHONE.sub("[연락처 생략]", text)


def pick(src, fields):
    out = {}
    for f in fields:
        v = src.get(f)
        if v not in (None, ""):
            out[f] = v
    return out


def clean(row):
    """One API record -> one published record, by allowlist."""
    out = pick(row, ABS_FIELDS)
    for k in ("title", "content"):
        if k in out:
            out[k] = scrub(out[k])

    authors = []
    for a in row.get("societyEventKcsAbsAuthorList") or []:
        authors.append(pick(a, AUTHOR_FIELDS))
    authors.sort(key=lambda a: a.get("order", 99))
    out["authors"] = authors
    presenter = next((a for a in authors if a.get("presenter")), None)
    if presenter:
        out["presenter"] = presenter.get("name", "")
        out["affiliation"] = presenter.get("affiliation", "")

    track = row.get("societyEventKcsAbsTrack") or {}
    out["track"] = track.get("printTitle") or track.get("title") or ""
    out["division"] = track.get("department") or ""

    typ = row.get("societyEventKcsAbsType") or {}
    out["type"] = typ.get("titleEn") or typ.get("title") or ""
    out["typeKo"] = typ.get("title") or ""

    order = row.get("societyEventKcsAbsTrackOrder") or {}
    if order.get("abbrTitle"):
        out["trackCode"] = order["abbrTitle"]

    t = row.get("societyEventKcsAbsTime") or {}
    out.update(pick(t, TIME_FIELDS))
    hall = t.get("societyEventKcsHall") or {}
    out["hall"] = hall.get("hallCode") or hall.get("hallName") or ""
    return out


def audit(records):
    """Fail loudly rather than publish a field that should not be here."""
    bad = set()

    def walk(node, path):
        if isinstance(node, dict):
            for k, v in node.items():
                if BANNED.search(k):
                    bad.add(path + "." + k)
                walk(v, path + "." + k)
        elif isinstance(node, list):
            for item in node:
                walk(item, path + "[]")

    walk(records, "")
    if bad:
        sys.exit("refusing to write: contact-shaped fields present: "
                 + ", ".join(sorted(bad)))

    blob = json.dumps(records, ensure_ascii=False)
    hits = re.findall(r"[\w.+-]+@[\w-]+\.[\w.]+", blob)
    if hits:
        sys.exit(f"refusing to write: {len(hits)} email-shaped strings, "
                 f"e.g. {hits[0]}")


def fetch(length):
    s = requests.Session()
    s.headers["User-Agent"] = UA

    page = s.get(SEARCH_URL, timeout=30)
    page.raise_for_status()
    m = re.search(r'name="_csrf"\s+content="([^"]+)"', page.text)
    if not m:
        sys.exit("no CSRF token on the search page — has the site changed?")
    token = m.group(1)

    payload = {
        "draw": 1,
        "columns": [{"data": "submitId", "name": "submitId",
                     "searchable": True, "orderable": True,
                     "search": {"value": "", "regex": False}}],
        "order": [], "start": 0, "length": length,
        "search": {"value": "", "regex": False},
        "searchType": "전체",
    }
    r = s.post(LIST_URL, json=payload, timeout=120, headers={
        "X-CSRF-TOKEN": token,
        "X-Requested-With": "XMLHttpRequest",
        "Referer": SEARCH_URL,
    })
    r.raise_for_status()
    if "json" not in (r.headers.get("content-type") or ""):
        sys.exit(f"expected JSON, got {r.headers.get('content-type')} "
                 f"({r.status_code}) — token or session rejected")
    return r.json()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--length", type=int, default=2000,
                    help="page size; the endpoint returns all 1091 in one go")
    args = ap.parse_args()

    body = fetch(args.length)
    rows = body.get("data") or []
    total = body.get("recordsTotal")
    if not rows:
        sys.exit("no records returned")
    if total and len(rows) < total:
        sys.exit(f"got {len(rows)} of {total} — raise --length")

    records = [clean(r) for r in rows]
    audit(records)

    root = pathlib.Path(__file__).resolve().parent.parent
    out = root / "data/abstracts.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({
        "event": "KCS 138",
        "source": "kchem.org/conf/kcs138",
        "count": len(records),
        "abstracts": records,
    }, ensure_ascii=False, indent=1), encoding="utf-8")

    kinds = {}
    for r in records:
        kinds[r.get("type", "?")] = kinds.get(r.get("type", "?"), 0) + 1
    print(f"wrote {out.relative_to(root)}: {len(records)} abstracts")
    for k, v in sorted(kinds.items(), key=lambda x: -x[1]):
        print(f"  {v:>5}  {k}")


if __name__ == "__main__":
    main()
