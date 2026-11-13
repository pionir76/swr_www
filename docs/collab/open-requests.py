#!/usr/bin/env python3
"""List request/notice documents that are waiting on one team.

Usage: open-requests.py <backend|frontend|build> [--hook]

Scans swr_web/docs/**/*.md for a YAML-style front matter block such as

    ---
    from: frontend
    to: backend
    status: open            # open | done
    waiting_on: backend     # who has to act next
    reply: docs/backend-xxx-response.md
    ---

and prints the documents whose status is not "done" and whose waiting_on
is the given team. With --hook the result is printed as SessionStart hook
JSON; nothing is printed when there is nothing to do.

See docs/collab/README.md for the rules.
"""
import json
import pathlib
import sys

DOCS = pathlib.Path(__file__).resolve().parent.parent
ROOT = DOCS.parent


def front_matter(path):
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeDecodeError):
        return None
    if not lines or lines[0].strip() != "---":
        return None
    meta = {}
    for line in lines[1:40]:
        if line.strip() == "---":
            return meta
        key, sep, value = line.partition(":")
        if sep:
            meta[key.strip()] = value.split("#", 1)[0].strip()
    return None


def title(path):
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return path.stem


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    hook = "--hook" in sys.argv
    if len(args) != 1 or args[0] not in ("backend", "frontend", "build"):
        sys.exit(__doc__)
    team = args[0]

    items = []
    for path in sorted(DOCS.rglob("*.md")):
        meta = front_matter(path)
        if not meta or meta.get("status") == "done" or meta.get("waiting_on") != team:
            continue
        rel = path.relative_to(ROOT).as_posix()
        line = f"- {rel} — {title(path)} (from {meta.get('from', '?')}, status {meta.get('status', '?')})"
        if meta.get("reply"):
            line += f", reply: {meta['reply']}"
        items.append(line)

    if not items:
        return
    text = f"Collaboration docs waiting on {team} (swr_web/docs, rules: docs/collab/README.md):\n" + "\n".join(items)
    if hook:
        print(json.dumps({
            "systemMessage": f"{len(items)} collaboration doc(s) waiting on {team}",
            "hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": text},
        }, ensure_ascii=False))
    else:
        print(text)


if __name__ == "__main__":
    main()
