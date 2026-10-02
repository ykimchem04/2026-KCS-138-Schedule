#!/usr/bin/env python3
"""
data/abstracts.json + data/fixed.tsv -> docs/data.json

The API gives one row per abstract and nothing above it: no sessions, no dates,
and a `time` column that is three different things at once. This turns that into
what a programme needs.

    py scripts/build_data.py

Three fixes happen here.

**`day` is an index, not a date.** It runs 2/3/4 for the three conference days —
the integer alone is meaningless, but every row also carries a Korean weekday,
so the mapping is checked against it rather than assumed.

**Posters have no clock time.** 776 of 1091 rows carry a session label
(발표III-VI) where a time should be. The clock times for those sessions are only
on the programme page, so they live in POSTER_SESSIONS below, keyed by the label
and checked against the divisions each session is supposed to hold.

**Five rows are typed wrong at source** — `09.00-09:40` with a period, and four
`10:05~10:25` with a tilde. Normalised, not dropped.

Sessions are derived: talks sharing a track, a day and a hall are one session,
spanning from the first start to the last end. The source never states that, but
it is what a person standing in a corridor needs.
"""
import csv
import io
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

# day index -> (ISO date, Korean weekday the source should agree with)
DAYS = {2: ("2026-10-28", "수"), 3: ("2026-10-29", "목"), 4: ("2026-10-30", "금")}

# Poster labels carry no time. These come from the programme page; the divisions
# are listed so a silent reshuffle upstream trips the check instead of moving
# two hundred posters to the wrong morning.
POSTER_SESSIONS = {
    "발표III": dict(n=1, day=2, start="10:00", end="12:00",
                    divisions={"Analytical Chemistry", "Material Chemistry",
                               "Environmental Energy"}),
    "발표IV": dict(n=2, day=2, start="14:00", end="16:00",
                   divisions={"Organic Chemistry", "Life Chemistry",
                              "Medicinal Chemistry"}),
    "발표V": dict(n=3, day=3, start="10:00", end="12:00",
                  divisions={"Physical Chemistry", "Electrochemistry",
                             "Chemistry Education"}),
    "발표VI": dict(n=4, day=3, start="14:30", end="16:30",
                   divisions={"Polymer Chemistry", "Inorganic Chemistry",
                              "Industrial Chemistry"}),
}

DIV_ABBR = {
    "Physical Chemistry": "PHYS", "Material Chemistry": "MAT",
    "Inorganic Chemistry": "INOR", "Organic Chemistry": "ORGN",
    "Analytical Chemistry": "ANAL", "Medicinal Chemistry": "MEDI",
    "Polymer Chemistry": "POLY", "Electrochemistry": "ELEC",
    "Life Chemistry": "LIFE", "Chemistry Education": "EDU",
    "Environmental Energy": "ENVR", "Industrial Chemistry": "IND", "KCS": "KCS",
}

# The API is English end to end - titles, affiliations, division names. At a
# Korean conference the obvious search is 고분자, and English-only data answers
# it with nothing, so the division names go into the index in both languages.
DIV_KO = {
    "PHYS": "물리화학", "MAT": "재료화학", "INOR": "무기화학",
    "ORGN": "유기화학", "ANAL": "분석화학", "MEDI": "의약화학",
    "POLY": "고분자화학", "ELEC": "전기화학", "LIFE": "생명화학",
    "EDU": "화학교육", "ENVR": "환경에너지", "IND": "공업화학",
    "KCS": "대한화학회",
}

TIME_RE = re.compile(r"^(\d{1,2})[:.](\d{2})\s*[-~–]\s*(\d{1,2})[:.](\d{2})$")


def parse_time(raw):
    m = TIME_RE.match((raw or "").strip())
    if not m:
        return None
    h1, m1, h2, m2 = (int(x) for x in m.groups())
    return f"{h1:02d}:{m1:02d}", f"{h2:02d}:{m2:02d}"


def infer_day(a, rows):
    """One row carries day 0 (a Monday, during a Wed-Fri conference) with an
    otherwise good time. Its track-mates in the same hall all agree on a day and
    its start is the previous talk's end, so take theirs rather than drop a real
    talk. Only when they are unanimous."""
    seen = {b.get("day") for b in rows
            if b is not a
            and b.get("track") == a.get("track")
            and b.get("hall") == a.get("hall")
            and b.get("day") in DAYS}
    return seen.pop() if len(seen) == 1 else None


def main():
    src = json.loads((ROOT / "data/abstracts.json").read_text(encoding="utf-8"))
    rows = src["abstracts"]

    items, unscheduled, bad_div, repaired = [], [], [], []
    for a in rows:
        day, label = a.get("day"), (a.get("time") or "").strip()
        poster = POSTER_SESSIONS.get(label)

        if not poster and day not in DAYS and parse_time(label):
            guess = infer_day(a, rows)
            if guess:
                repaired.append((a.get("code"), a.get("day"), guess))
                day = guess
                a = dict(a, day=guess, stringDayKo=DAYS[guess][1])

        if poster:
            if a.get("division") not in poster["divisions"]:
                bad_div.append((label, a.get("division"), a.get("code")))
            day = poster["day"]
            start, end = poster["start"], poster["end"]
        else:
            span = parse_time(label)
            if span is None or day not in DAYS:
                unscheduled.append(a)
                continue
            start, end = span

        date, weekday = DAYS[day]
        if a.get("stringDayKo") and a["stringDayKo"] != weekday:
            sys.exit(f"day {day} says {weekday} but {a.get('code')} says "
                     f"{a['stringDayKo']} - the day mapping has moved")

        items.append({
            "id": a["submitId"], "code": a.get("code", ""),
            "title": a.get("title", ""), "abstract": a.get("content", ""),
            "presenter": a.get("presenter", ""), "affiliation": a.get("affiliation", ""),
            "authors": [x.get("name", "") for x in a.get("authors", [])],
            "division": a.get("division", ""),
            "div": DIV_ABBR.get(a.get("division", ""), "KCS"),
            "divKo": DIV_KO.get(DIV_ABBR.get(a.get("division", ""), "KCS"), ""),
            "track": a.get("track", ""), "trackCode": a.get("trackCode", ""),
            "type": a.get("type", ""), "typeKo": a.get("typeKo", ""),
            "date": date, "start": start, "end": end,
            "hall": a.get("hall", ""),
            "poster": poster["n"] if poster else 0,
            "order": a.get("order", 0),
        })

    if bad_div:
        sys.exit(f"poster session divisions moved upstream: {bad_div[:3]}")

    # Sessions: same track, same day, same hall. The source never groups them,
    # but "which room, from when to when" is the question in a corridor.
    sessions = {}
    for it in items:
        if it["poster"]:
            continue
        key = (it["track"], it["date"], it["hall"])
        s = sessions.setdefault(key, {
            "track": it["track"], "trackCode": it["trackCode"],
            "division": it["division"], "div": it["div"],
            "date": it["date"], "hall": it["hall"],
            "start": it["start"], "end": it["end"], "n": 0,
        })
        s["start"] = min(s["start"], it["start"])
        s["end"] = max(s["end"], it["end"])
        s["n"] += 1
    sessions = sorted(sessions.values(), key=lambda s: (s["date"], s["start"], s["hall"]))

    fixed = []
    fx = ROOT / "data/fixed.tsv"
    if fx.exists():
        with io.open(fx, encoding="utf-8") as fh:
            fixed = [r for r in csv.DictReader(fh, delimiter="\t") if r.get("date")]

    posters = [{
        "n": v["n"], "label": k, "date": DAYS[v["day"]][0],
        "start": v["start"], "end": v["end"],
        "divisions": sorted(DIV_ABBR.get(d, d) for d in v["divisions"]),
        "count": sum(1 for it in items if it["poster"] == v["n"]),
    } for k, v in sorted(POSTER_SESSIONS.items(), key=lambda x: x[1]["n"])]

    out = {
        "event": {
            "name": "대한화학회 제138회 학술발표회",
            "nameEn": "KCS 138th General Meeting",
            "venue": "수원컨벤션센터", "source": "kchem.org/conf/kcs138",
        },
        "days": [{"date": d, "weekday": w, "n": n} for n, (d, w) in sorted(DAYS.items())],
        "divisions": sorted({(it["div"], it["division"], it["divKo"]) for it in items}),
        "halls": sorted({it["hall"] for it in items if it["hall"]}),
        "posterSessions": posters,
        "fixed": fixed,
        "sessions": sessions,
        "items": items,
    }
    dst = ROOT / "docs/data.json"
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")),
                   encoding="utf-8")

    print(f"wrote {dst.relative_to(ROOT)}: {len(items)} items, "
          f"{len(sessions)} sessions, {len(posters)} poster sessions")
    for code, was, now in repaired:
        print(f"  repaired {code}: day {was} -> {now}, from its track-mates")
    if unscheduled:
        print(f"  {len(unscheduled)} unscheduled, left out: "
              + ", ".join(repr(a.get('time')) for a in unscheduled[:4]))


if __name__ == "__main__":
    main()
