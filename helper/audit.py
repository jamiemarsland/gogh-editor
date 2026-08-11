#!/usr/bin/env python3
"""
audit.py — find places where the hand-written prose has fallen behind the source.

The generated appendix (kb.facts.md) always carries the current truth, so the bot
is never *wrong* about a fact. But prose that still describes last release's
behaviour is confusing, and prose that never mentions a new feature means the bot
can't help with it. This script finds both.

Tiers:
  DRIFT    prose states something the source contradicts       → fix the prose
  STALE    prose names something that no longer exists         → fix the prose
  MISSING  source has something the prose never mentions       → write prose
  QUOTE    prose quotes copy not found verbatim in the source  → check by hand

Exit codes:
  0  clean
  1  prose drift found (report written; the facts appendix is still correct)
  2  the extractor itself is broken — an anchor stopped matching
"""

import json
import re
import subprocess
import sys
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent

PROSE = HERE / 'kb.prose.md'
FACTS = HERE / 'kb.facts.json'
REPORT = HERE / 'kb.audit.md'


def norm(s):
    r"""
    Normalise for comparison: the source writes typographic punctuation as \uXXXX
    escapes and the prose writes it directly (or as ASCII), so a raw compare
    produces false drift on every apostrophe and em-dash.
    """
    for a, b in (('\u2019', "'"), ('\u2018', "'"), ('\u201c', '"'), ('\u201d', '"'),
                 ('\u2014', '-'), ('\u2013', '-'), ('\u2026', '...'), ('\u00a0', ' ')):
        s = s.replace(a, b)
    return re.sub(r'\s+', ' ', s).strip().lower()


def load_ignores():
    """
    One substring per line; a finding containing any of them is suppressed.
    This exists so a known-fine finding does not train people to ignore the
    whole report.
    """
    p = HERE / 'kb.audit-ignore.txt'
    if not p.exists():
        return []
    return [l.strip() for l in p.read_text(encoding='utf-8').splitlines()
            if l.strip() and not l.startswith('#')]


SOURCES = ('gogh-editor.js', 'gogh.php', 'gogh-block.js', 'gogh-webmcp.js',
           'gogh-tests.js', 'readme.txt', 'blueprint.json', 'spike/matrix.php')


def load_source_haystack():
    """
    Everything a UI string or a quoted rationale could legitimately live in, with
    JS escapes decoded and comment prefixes stripped. The prefix strip matters:
    the prose quotes design rationale out of wrapped `//` and ` * ` comments, and
    without it every such quote reads as drift.
    """
    from extract import unescape
    parts = []
    for name in SOURCES:
        p = ROOT / name
        if p.exists():
            txt = unescape(p.read_text(encoding='utf-8'))
            txt = re.sub(r'^\s*(?://+|\*|#)\s?', ' ', txt, flags=re.M)
            parts.append(txt)
    return '\n'.join(parts)


def previous_facts():
    """
    The committed kb.facts.json from the last build, via git.

    This is what makes rename detection possible. A removed tool, a reworded
    button label or a dropped template is invisible to any check that only looks
    at the current source — you have to know what was there before. Returns None
    on the first run or outside a git checkout, and the diff is simply skipped.
    """
    try:
        root = subprocess.run(['git', 'rev-parse', '--show-toplevel'],
                              capture_output=True, text=True, cwd=HERE, check=True).stdout.strip()
        rel = FACTS.resolve().relative_to(pathlib.Path(root).resolve())
        blob = subprocess.run(['git', 'show', f'HEAD:{rel.as_posix()}'],
                              capture_output=True, text=True, cwd=root, check=True).stdout
        return json.loads(blob)
    except Exception:
        return None


def name_sets(f):
    """Flatten a facts blob into comparable {namespace: set(names)}."""
    return {
        'WebMCP tool':    {t['name'] for t in f['mcp_tools']},
        'exposed filter': set(f['php']['filters_exposed']),
        'WP hook':        {h['hook'] for h in f['php']['hooks']},
        'REST route':     set(f['php']['rest_routes']),
        'capability':     set(f['php']['capabilities']),
        'template':       {t['name'] for t in f['templates'] if t['starter'] and not t['retired']},
        'shape':          {s['key'] for s in f['shapes']},
        'divider':        {d['key'] for d in f['dividers']},
        'element type':   set(f['js']['element_types']),
        '__gogh member':  set(f['gogh_api']),
        'UI label':       set(f['ui_titles']),
        'toast':          set(f['toasts']),
    }


def main():
    if not FACTS.exists():
        sys.exit('audit.py: kb.facts.json missing — run extract.py first')

    facts = json.loads(FACTS.read_text(encoding='utf-8'))
    prose = PROSE.read_text(encoding='utf-8')
    src = load_source_haystack()

    findings = {'DRIFT': [], 'STALE': [], 'MISSING': [], 'QUOTE': []}

    # --- 0. extractor health -------------------------------------------------
    broken = [k for k, v in facts['constants'].items() if v is None]

    # --- 1. constants stated in the prose ------------------------------------
    # Only checks constants the prose actually quotes, in the forms it uses them.
    const_patterns = {
        'TOL': [r'`TOL`\s*\(?(\d+)', r'TOL\s*=\s*(\d+)'],
        'SNAP': [r'SNAP\s*=\s*(\d+)', r'snap threshold is \*\*(\d+)'],
        'BASE': [r'BASE\s*=\s*(\d+)', r'the \*\*(\d+)px\*\* grid'],
        'W': [r'W\s*=\s*(\d+)'],
        'MIN_H': [r'MIN_H\s*=\s*(\d+)'],
        'PAD': [r'PAD\s*=\s*(\d+)'],
        'mobile_breakpoint_px': [r'max-width:\s*(\d+)px'],
        'history_cap': [r'capped at \*\*(\d+)\*\*'],
        'autosave_interval_ms': [r'Every \*\*(\d+) seconds\*\*'],
        'drag_threshold_px': [r'[Dd]rag threshold is (\d+)px'],
        'rotation_snap_deg': [r'\*\*(\d+)° increments'],
        'mirror_width_px': [r'(\d+)px-wide live mobile'],
    }
    for key, pats in const_patterns.items():
        want = facts['constants'].get(key)
        if want is None:
            continue
        for pat in pats:
            for m in re.finditer(pat, prose):
                got = int(m.group(1))
                # the autosave anchor is in ms, the prose says seconds
                cmp = want // 1000 if key == 'autosave_interval_ms' else want
                if got != cmp:
                    findings['DRIFT'].append(
                        f'`{key}` is **{cmp}** in source, prose says **{got}** '
                        f'(near: "{prose[max(0, m.start()-45):m.start()+45].strip()}")')

    # --- 2. version ----------------------------------------------------------
    ver = facts['meta']['plugin_version']
    for m in re.finditer(r'version \*\*(\d+\.\d+\.\d+)\*\*|plugin version (\d+\.\d+\.\d+)', prose):
        got = m.group(1) or m.group(2)
        if got != ver:
            findings['DRIFT'].append(f'plugin version is **{ver}**, prose says **{got}**')

    # --- 3. namespaced names: stale + missing --------------------------------
    # Every gogh_* identifier that legitimately exists anywhere in the source.
    # The prose names PHP functions, filters and MCP tools interchangeably, so
    # the stale check is "does this identifier exist at all", not "is it a tool".
    known_gogh = set(re.findall(r'\bgogh_[a-z_]+\b', src))

    namespaces = [
        ('WebMCP tool',    [t['name'] for t in facts['mcp_tools']],            None),
        ('exposed filter', facts['php']['filters_exposed'],                    None),
        ('WP hook',        [h['hook'] for h in facts['php']['hooks']],         None),
        ('template',       [t['name'] for t in facts['templates'] if t['starter'] and not t['retired']], None),
        ('shape',          [s['key'] for s in facts['shapes']],                None),
        ('divider',        [d['key'] for d in facts['dividers']],              None),
        ('element type',   facts['js']['element_types'],                       None),
        ('__gogh member',  facts['gogh_api'],                                  None),
    ]

    for label, names, scan in namespaces:
        for n in names:
            # word-boundary search so `box` doesn't match "boxes" only
            if not re.search(r'(?<![\w-])' + re.escape(n) + r'(?![\w-])', prose):
                findings['MISSING'].append(f'{label} `{n}` exists in source but is never mentioned in the prose')
        if scan:
            for m in sorted(set(re.findall(scan, prose))):
                if m not in names:
                    findings['STALE'].append(f'prose mentions {label} `{m}`, which is not in the source')

    for ident in sorted(set(re.findall(r'\bgogh_[a-z_]+\b', prose))):
        if ident not in known_gogh:
            findings['STALE'].append(f'prose mentions `{ident}`, which does not exist anywhere in the source')

    # retired templates must not be presented as available
    live_names = {t['name'] for t in facts['templates'] if t['starter'] and not t['retired']}
    for t in facts['templates']:
        if t['retired'] and t['name'] not in live_names and re.search(r'\*\*' + re.escape(t['name']) + r'\*\*', prose):
            findings['STALE'].append(
                f'template "{t["name"]}" is retired (never shown in the picker) but the prose bolds it as if live')

    # --- 4. quoted UI copy ---------------------------------------------------
    # Any double-quoted run of ≥12 chars containing a space. Anything not found
    # verbatim in the source is worth a human look — it is either paraphrased
    # copy (fine) or copy that changed (not fine).
    src_n = norm(src)
    for m in re.finditer(r'[\u201c"]([^\u201d"\n]{12,120})[\u201d"]', prose):
        q = m.group(1).strip()
        # not UI copy: placeholders, markdown fragments, code, our own FAQ headings
        if (' ' not in q or q.endswith('?')
                or any(c in q for c in '<>`*')
                or q.startswith(('.', ',', ')'))):
            continue
        if norm(q) in src_n:
            continue
        findings['QUOTE'].append(q)

    # --- 5. diff against the last build --------------------------------------
    changes = []
    prev = previous_facts()
    if prev:
        old, new = name_sets(prev), name_sets(facts)
        for ns in new:
            for gone in sorted(old[ns] - new[ns]):
                changes.append(f'removed {ns}: "{gone}"')
                # a removed name the prose still talks about is a real problem
                if gone in prose:
                    findings['STALE'].append(
                        f'{ns} "{gone}" was removed in this release, but the prose still describes it')
            for new_name in sorted(new[ns] - old[ns]):
                changes.append(f'added {ns}: "{new_name}"')

        for k, v in facts['constants'].items():
            ov = prev.get('constants', {}).get(k)
            if ov is not None and v is not None and ov != v:
                changes.append(f'constant `{k}`: {ov} → {v}')

        ov = prev.get('meta', {}).get('plugin_version')
        if ov and ov != ver:
            changes.insert(0, f'version: {ov} → {ver}')

    # --- suppress known-fine findings ---------------------------------------
    ignores = load_ignores()
    suppressed = 0
    for tier in findings:
        kept = [f for f in findings[tier] if not any(ig in f for ig in ignores)]
        suppressed += len(findings[tier]) - len(kept)
        findings[tier] = kept

    # --- report --------------------------------------------------------------
    total = sum(len(v) for v in findings.values())
    L = [f'# Knowledge-base audit — plugin v{ver}', '']
    if broken:
        L += ['## Extractor broken', '',
              'These anchors stopped matching, so the fact is missing from the appendix entirely. '
              'A refactor almost certainly moved the code; fix the anchor in `extract.py`.', '']
        L += [f'- `{k}`' for k in broken] + ['']
    if suppressed:
        L += [f'_{suppressed} finding(s) suppressed by `kb.audit-ignore.txt`._', '']
    if not total:
        L += ['No prose drift found. The prose and the source agree.', '']
    for tier, blurb in [
        ('DRIFT',   'The prose states something the source contradicts. Fix these first — the bot will '
                    'contradict itself, since the appendix carries the correct value.'),
        ('STALE',   'The prose names something that no longer exists.'),
        ('MISSING', 'The source has something the prose never explains. The bot knows the name from the '
                    'appendix but cannot say what it is for.'),
        ('QUOTE',   'Quoted copy not found verbatim in the source. Paraphrases are fine; changed UI copy is not.'),
    ]:
        if findings[tier]:
            L += [f'## {tier} ({len(findings[tier])})', '', blurb, '']
            L += [f'- {x}' for x in findings[tier]] + ['']

    if changes:
        L += ['## What changed since the last knowledge-base build', '',
              'Use this as the checklist for updating the prose — and as a sanity check '
              'on the release itself.', '']
        L += [f'- {c}' for c in changes] + ['']
    elif prev is None:
        L += ['_No previous `kb.facts.json` in git, so no release-to-release diff this run. '
              'Commit it and the next build will list exactly what changed._', '']

    REPORT.write_text('\n'.join(L), encoding='utf-8')

    counts = ' · '.join(f'{k} {len(v)}' for k, v in findings.items())
    print(f'audit: {counts} · {len(changes)} changed since last build' + (f' ({suppressed} ignored)' if suppressed else '') + f' → {REPORT.name}')

    if broken:
        print('audit: FAIL — extractor anchors broken, facts are incomplete')
        return 2
    return 1 if total else 0


if __name__ == '__main__':
    sys.exit(main())
