#!/usr/bin/env python3
"""
extract.py — pull the mechanically-derivable facts out of the Gogh source.

Everything here is a fact that changes when the plugin changes: version numbers,
design constants, UI labels, toast copy, template names, hook names, the WebMCP
tool signatures, the __gogh API surface. These are exactly the things a help bot
gets confidently wrong once the source moves on.

Output:
  kb.facts.json  — structured, for audit.py
  kb.facts.md    — the generated appendix that gets bolted onto the knowledge base

Run from anywhere; paths resolve relative to the plugin root (the parent of
this file's directory), which is where gogh.php lives.
"""

import html
import json
import re
import sys
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
HERE = pathlib.Path(__file__).resolve().parent


# ----------------------------------------------------------------- utilities

def read(name):
    p = ROOT / name
    if not p.exists():
        sys.exit(f'extract.py: cannot find {p} — run this from inside the plugin repo')
    return p.read_text(encoding='utf-8')


JS_ESCAPES = {'n': '\n', 't': '\t', 'r': '\r', "'": "'", '"': '"', '\\': '\\', '/': '/', 'b': '\b', 'f': '\f'}


def unescape(s):
    """Decode the \\uXXXX / \\' escapes the source uses for non-ASCII copy."""
    out, i = [], 0
    while i < len(s):
        c = s[i]
        if c == '\\' and i + 1 < len(s):
            nxt = s[i + 1]
            if nxt == 'u' and i + 5 < len(s) + 1:
                try:
                    out.append(chr(int(s[i + 2:i + 6], 16)))
                    i += 6
                    continue
                except ValueError:
                    pass
            if nxt in JS_ESCAPES:
                out.append(JS_ESCAPES[nxt])
                i += 2
                continue
        out.append(c)
        i += 1
    return ''.join(out)


def balanced(src, start, opener='{', closer='}'):
    """
    Return the balanced block beginning at the opener at/after `start`.
    Skips string literals and comments so braces inside copy do not confuse it.
    """
    i = src.index(opener, start)
    depth, j = 0, i
    while j < len(src):
        c = src[j]
        if c in '\'"`':
            q, j = c, j + 1
            while j < len(src) and src[j] != q:
                j += 2 if src[j] == '\\' else 1
            j += 1
            continue
        if c == '/' and j + 1 < len(src):
            if src[j + 1] == '/':
                j = src.find('\n', j)
                if j == -1:
                    break
                continue
            if src[j + 1] == '*':
                j = src.find('*/', j) + 2
                continue
        if c == opener:
            depth += 1
        elif c == closer:
            depth -= 1
            if depth == 0:
                return src[i:j + 1]
        j += 1
    raise ValueError('unbalanced block')


def split_top_objects(block):
    """Split a JS array literal into its top-level { ... } members."""
    out, i = [], 0
    while True:
        try:
            k = block.index('{', i)
        except ValueError:
            return out
        obj = balanced(block, k)
        out.append(obj)
        i = k + len(obj)


def uniq(seq):
    seen, out = set(), []
    for x in seq:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out


# ----------------------------------------------------------------- extractors

def meta(php, readme, js):
    def hdr(field, src=php):
        m = re.search(r'^\s*\*?\s*' + field + r':\s*(.+?)\s*$', src, re.M)
        return m.group(1) if m else None

    asset = re.search(r"'(\d+\.\d+\.\d+[\w.-]*)'", js[:4000])
    return {
        'plugin_version':   hdr('Version'),
        'requires_wp':      hdr('Requires at least'),
        'requires_php':     hdr('Requires PHP'),
        'text_domain':      hdr('Text Domain'),
        'readme_stable_tag': hdr('Stable tag', readme),
        'readme_tested_up_to': hdr('Tested up to', readme),
        'asset_version':    re.search(r"'([\d.]+-\w+)'", php).group(1) if re.search(r"'([\d.]+-\w+)'", php) else None,
    }


def constants(js):
    """The one `var TOL = 8, MIN_H = 560, ...` line, plus the named magic numbers."""
    out = {}
    m = re.search(r'var\s+(TOL\s*=\s*\d+(?:\s*,\s*\w+\s*=\s*\d+)+)\s*;', js)
    if m:
        for pair in m.group(1).split(','):
            k, v = pair.split('=')
            out[k.strip()] = int(v.strip())

    # Anchored one-off numbers. Each entry: (label, regex with one numeric group).
    # Anchors are chosen to be distinctive enough that a match is the real thing;
    # a miss shows up as null in the report rather than a wrong number.
    anchors = [
        ('autosave_interval_ms',   r'setInterval\(function[\s\S]{0,4000}?\n  \},\s*(\d{4,})\s*\)'),
        ('history_cap',            r'history\.length\s*>\s*(\d+)'),
        ('mobile_breakpoint_px',   r'@container \(max-width:\s*(\d+)px\)'),
        ('min_resize_w',           r'if \(nw < (\d+)\)'),
        ('min_resize_h',           r'if \(nh < (\d+)\)'),
        ('section_min_h',          r'Math\.min\(\s*4000\s*,\s*Math\.max\(\s*(\d+)'),
        ('section_max_h',          r'Math\.min\(\s*(4000)\s*,\s*Math\.max'),
        # (the 250px live mobile mirror was removed in v0.99.197 — the phone
        # preview in the design view replaced it)
        ('phone_preview_w',        r'PHONE_W\s*=\s*(\d+)'),
        ('drag_threshold_px',      r'pendingDrag\.x\)\s*\+\s*Math\.abs\([^)]*pendingDrag\.y\)\s*<\s*(\d+)'),
        ('rotation_snap_deg',      r'snap15\s*=\s*Math\.round\(deg\s*/\s*(\d+)\)'),
        ('rotation_magnet_deg',    r'Math\.abs\(deg\s*-\s*snap15\)\s*<\s*(\d+)'),
        ('toast_ttl_ms',           r'ttl\s*\|\|\s*(?:TOAST_TTL\[kind\]\s*\|\|\s*)?(\d{3,})'),
    ]
    for label, rx in anchors:
        m = re.search(rx, js)
        val = next((g for g in (m.groups() if m else ()) if g is not None), None)
        out[label] = int(val) if val is not None else None
    return out


def templates(js):
    block = balanced(js, js.index('var TEMPLATES'), '[', ']')
    out = []
    for obj in split_top_objects(block):
        head = obj[:400]
        name = re.search(r"name:\s*'([^']*)'", head)
        if not name:
            continue
        minh = re.search(r'minH:\s*(\d+)', head)
        out.append({
            'name': unescape(name.group(1)),
            'starter': bool(re.search(r'starter:\s*true', head)),
            'retired': bool(re.search(r'retired:\s*true', head)),
            'minH': int(minh.group(1)) if minh else None,
        })
    return out


def shapes(js):
    block = balanced(js, js.index('var SHAPE_DEFS'), '[', ']')
    return [
        {'key': unescape(k), 'label': unescape(l)}
        for k, l in re.findall(r"key:\s*'([^']+)',\s*label:\s*'([^']+)'", block)
    ]


def dividers(js):
    """
    Read the transition picker's own list rather than DIVIDER_PATHS: `melt` is a
    gradient fade with no SVG path, so it exists in the picker but not in PATHS.
    """
    anchor = js.index("label: 'Melt'")
    block = balanced(js, js.rindex('[', 0, anchor), '[', ']')
    pairs = re.findall(r"key:\s*'(\w+)',\s*label:\s*'([^']+)'", block)
    return [{'key': k, 'label': unescape(l)} for k, l in pairs]


def gogh_api(js):
    """Top-level keys of the window.__gogh object literal."""
    block = balanced(js, js.index('window.__gogh'))
    keys, depth, i = [], 0, 0
    while i < len(block):
        c = block[i]
        if c in '\'"`':
            q, i = c, i + 1
            while i < len(block) and block[i] != q:
                i += 2 if block[i] == '\\' else 1
            i += 1
            continue
        if c == '/' and i + 1 < len(block):
            if block[i + 1] == '/':
                i = block.find('\n', i)
                if i == -1:
                    break
                continue
            if block[i + 1] == '*':
                i = block.find('*/', i) + 2
                continue
        if c in '{[(':
            depth += 1
        elif c in '}])':
            depth -= 1
        elif depth == 1:
            m = re.match(r"[\s,]*'?([A-Za-z_$][\w$]*)'?\s*:", block[i:])
            if m:
                keys.append(m.group(1))
                i += m.end()
                continue
        i += 1
    # `build` is attached after the literal, so pick it up separately
    if re.search(r'__gogh\.build\s*=', js):
        keys.append('build')
    return uniq(keys)


def mcp_tools(webmcp):
    """Parse the TOOLS array by balancing each member, so one tool's `required`
    can never be read off the next one."""
    out = []
    tools_block = balanced(webmcp, webmcp.index('var TOOLS'), '[', ']')
    for obj in split_top_objects(tools_block):
        m = re.search(r"name:\s*'(gogh_\w+)'", obj)
        if not m:
            continue
        desc = re.search(r"description:\s*'((?:[^'\\]|\\.)*)'", obj)
        req = re.search(r"required:\s*\[([^\]]*)\]", obj)
        props = re.search(r'properties:\s*\{', obj)
        params = []
        if props:
            pblock = balanced(obj, props.start())
            # properties may be one-per-line or all on one line
            params = re.findall(r"[{,]\s*(\w+):\s*\{\s*type:", pblock)
        out.append({
            'name': m.group(1),
            'description': unescape(desc.group(1)) if desc else None,
            'params': params,
            'required': [x.strip().strip("'\"") for x in req.group(1).split(',') if x.strip()] if req else [],
        })
    return out


def ui_strings(js):
    # Two ways a label reaches the screen, and both have to be read.
    #
    # Tooltips are title="…" attributes. Toolbar and palette labels are plain
    # text nodes inside their button — "Site style" and "Page style" are the
    # standing examples. Reading only the attributes made the audit announce
    # those two as REMOVED the moment they stopped being tooltips, which is a
    # false alarm of the worst kind: the bot then tells people a button they
    # are looking at does not exist.
    titles = [unescape(t) for t in re.findall(r'title="([^"]{2,90})"', js)]

    # Text sitting directly before a closing </button> or </a>. Quotes and
    # braces are excluded so this cannot straddle a string-concatenation seam
    # or swallow a template expression.
    labels = [
        unescape(t).strip()
        for t in re.findall(r'>([^<>{}\'"]{2,90}?)</(?:button|a)>', js)
    ]
    # Icon-only controls (↺, ⋯, ✏️) carry no prose; a label needs real words.
    # Filtered after unescaping, so a \uXXXX arrow is judged on the character
    # it becomes rather than on the letters in its escape sequence.
    labels = [t for t in labels if len(re.findall(r'[A-Za-z]', t)) >= 2]

    # Entities are how the source writes a literal &; the KB tells the bot to
    # quote these verbatim, so it must carry "Publish & close", not "&amp;".
    seen = uniq(html.unescape(t) for t in titles + labels)

    toasts = uniq(unescape(t) for t in re.findall(r"toast\(\s*'((?:[^'\\]|\\.){4,140})'", js))
    return sorted(seen), sorted(toasts)


def php_surface(php):
    hooks = []
    for m in re.finditer(r"add_(action|filter)\(\s*'([^']+)'\s*,(.*?)\)\s*;", php, re.S):
        tail = m.group(3)
        prio = re.search(r',\s*(\d+)\s*(?:,\s*\d+\s*)?$', tail.rstrip())
        hooks.append({
            'kind': m.group(1),
            'hook': m.group(2),
            'priority': int(prio.group(1)) if prio else 10,
        })
    return {
        'hooks': hooks,
        'filters_exposed': uniq(re.findall(r"apply_filters\(\s*'([^']+)'", php)),
        'rest_routes': [
            f"{a}/{b}" for a, b in re.findall(r"register_rest_route\(\s*'([^']+)'\s*,\s*'/?([^']+)'", php)
        ],
        'capabilities': uniq(re.findall(r"current_user_can\(\s*'([^']+)'", php)),
        'query_switches': uniq(re.findall(r"\$_GET\[\s*'([^']+)'", php)),
        'block_name': (re.search(r"register_block_type\(\s*'([^']+)'", php) or [None, None])[1],
    }


def js_surface(js, webmcp):
    return {
        'element_types': uniq(re.findall(
            r"case '(\w+)'", balanced(js, js.index('function buildElBlocks')))),
        'add_element_kinds': sorted(uniq(re.findall(r'data-add="(\w+)"', js))),
        'rest_endpoints': sorted(uniq(re.findall(r"wp/v2/([a-z-]+(?:/[a-z-]+)?)", js))),
        'query_switches': sorted(uniq(re.findall(r"gogh-(edit|mcp|test|convert|ps)\b", js))),
        'ready_event': bool(re.search(r"CustomEvent\('gogh:ready'\)", js)),
        'mcp_gate': bool(re.search(r'modelContext', webmcp)),
    }


def block_attrs(blockjs):
    """v3 attributes and the v2 deprecation, from gogh-block.js."""
    attrs = re.findall(r"^\s*(\w+):\s*\{\s*type:\s*'(\w+)'", blockjs, re.M)
    return {
        'v3_attributes': uniq([a for a, _ in attrs]),
        'has_deprecation': 'deprecated' in blockjs,
        'block_title': (re.search(r"title:\s*'([^']+)'", blockjs) or [None, None])[1],
    }


# ----------------------------------------------------------------- main

def collect():
    php     = read('gogh.php')
    js      = read('gogh-editor.js')
    webmcp  = read('gogh-webmcp.js')
    blockjs = read('gogh-block.js')
    readme  = read('readme.txt')
    tests   = read('gogh-tests.js') if (ROOT / 'gogh-tests.js').exists() else ''

    titles, toasts = ui_strings(js)

    return {
        'meta': meta(php, readme, js),
        'constants': constants(js),
        'templates': templates(js),
        'shapes': shapes(js),
        'dividers': dividers(js),
        'gogh_api': gogh_api(js),
        'mcp_tools': mcp_tools(webmcp),
        'ui_titles': titles,
        'toasts': toasts,
        'php': php_surface(php),
        'js': js_surface(js, webmcp),
        'block': block_attrs(blockjs),
        'test_count': len(re.findall(r"\btest\(\s*'", tests)),
    }


def to_markdown(f):
    L = []
    w = L.append

    w('# Generated facts appendix')
    w('')
    w('Everything in this section is extracted mechanically from the Gogh source on every release. '
      'It is regenerated, never hand-edited. **Where this appendix conflicts with the prose above, '
      'this appendix is correct** — the prose may lag a release behind.')
    w('')

    m = f['meta']
    w('## Current release')
    w('')
    w(f"- Plugin version: **{m['plugin_version']}**")
    w(f"- Requires WordPress **{m['requires_wp']}+**, PHP **{m['requires_php']}+**")
    w(f"- Text domain: `{m['text_domain']}`")
    w(f"- readme.txt Stable tag: `{m['readme_stable_tag']}` · Tested up to: `{m['readme_tested_up_to']}`")
    if m['readme_stable_tag'] and m['plugin_version'] and m['readme_stable_tag'] != m['plugin_version']:
        w(f"- Note: the readme Stable tag (`{m['readme_stable_tag']}`) does not match the plugin header "
          f"version (`{m['plugin_version']}`). Quote the plugin header version.")
    w('')

    w('## Design constants')
    w('')
    w('| Constant | Value |')
    w('|---|---|')
    for k, v in f['constants'].items():
        if v is not None:
            w(f'| `{k}` | {v} |')
    w('')

    w('## Section templates')
    w('')
    live = [t for t in f['templates'] if t['starter'] and not t['retired']]
    other = [t for t in f['templates'] if not t['starter'] and not t['retired'] and not t['name'].startswith('__')]
    retired = [t for t in f['templates'] if t['retired']]
    w('Shown in the picker: ' + ', '.join(f"**{t['name']}**" for t in live) + '.')
    if other:
        w('')
        w('Non-starter (surfaced elsewhere): ' + ', '.join(f"**{t['name']}**" for t in other) + '.')
    if retired:
        w('')
        w('Retired — never shown, do not mention: ' + ', '.join(t['name'] for t in retired) + '.')
    w('')

    w('## Shapes and dividers')
    w('')
    w('Shapes: ' + ', '.join(f"`{s['key']}` ({s['label']})" for s in f['shapes']) + '.')
    w('')
    w('Divider shapes (plus "None"): ' + ', '.join(f"`{d['key']}` ({d['label']})" for d in f['dividers']) + '.')
    w('')

    w('## Elements')
    w('')
    w('Element types that survive a publish: ' + ', '.join(f'`{t}`' for t in f['js']['element_types']) + '. '
      'Anything else added from the block editor is lost on the next Gogh publish.')
    w('')
    w('"Add element" palette items: ' + ', '.join(f'`{k}`' for k in f['js']['add_element_kinds']) + '.')
    w('')

    w('## WebMCP tools')
    w('')
    w('| Tool | Params | Required |')
    w('|---|---|---|')
    for t in f['mcp_tools']:
        params = ', '.join(f'`{p}`' for p in t['params']) or '—'
        req = ', '.join(f'`{r}`' for r in t['required']) or '—'
        w(f"| `{t['name']}` | {params} | {req} |")
    w('')

    w('## `window.__gogh` members')
    w('')
    w(', '.join(f'`{k}`' for k in f['gogh_api']) + '.')
    w('')

    p = f['php']
    w('## WordPress surface')
    w('')
    w(f"Block: `{p['block_name']}` · v3 attributes: " + ', '.join(f'`{a}`' for a in f['block']['v3_attributes']) + '.')
    w('')
    w('| Hook | Kind | Priority |')
    w('|---|---|---|')
    for h in p['hooks']:
        w(f"| `{h['hook']}` | {h['kind']} | {h['priority']} |")
    w('')
    w('Filters exposed for third parties: ' + ', '.join(f'`{x}`' for x in p['filters_exposed']) + '.')
    w('')
    w('REST routes registered: ' + ', '.join(f'`{r}`' for r in p['rest_routes']) + '.')
    w('')
    w('Core REST endpoints used by the editor: ' + ', '.join(f'`wp/v2/{e}`' for e in f['js']['rest_endpoints']) + '.')
    w('')
    w('Capability checks in PHP: ' + ', '.join(f'`{c}`' for c in p['capabilities']) + '.')
    w('')
    w('Query-string switches: ' + ', '.join(f'`?gogh-{s}`' for s in f['js']['query_switches']) + '.')
    w('')

    w('## Exact UI labels (tooltips and button titles)')
    w('')
    w('These are the real strings in the current build. Use them verbatim; never paraphrase a label.')
    w('')
    for t in f['ui_titles']:
        w(f'- "{t}"')
    w('')

    w('## Exact toast and message copy')
    w('')
    for t in f['toasts']:
        w(f'- "{t}"')
    w('')

    w(f"## Test suite\n\n`{f['test_count']}` tests, run by appending `?gogh-test` to any Gogh page URL "
      f"while logged in with edit rights on that page.")
    w('')

    return '\n'.join(L)


if __name__ == '__main__':
    facts = collect()
    (HERE / 'kb.facts.json').write_text(json.dumps(facts, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    (HERE / 'kb.facts.md').write_text(to_markdown(facts) + '\n', encoding='utf-8')

    missing = [k for k, v in facts['constants'].items() if v is None]
    print(f"extract: v{facts['meta']['plugin_version']} · "
          f"{len(facts['templates'])} templates · {len(facts['mcp_tools'])} MCP tools · "
          f"{len(facts['gogh_api'])} API members · {len(facts['ui_titles'])} labels · "
          f"{len(facts['toasts'])} toasts · {facts['test_count']} tests")
    if missing:
        print('extract: WARNING — anchors did not match, value recorded as null: ' + ', '.join(missing))
        print('         (a source refactor probably moved them; fix the anchor in extract.py)')
