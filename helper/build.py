#!/usr/bin/env python3
"""
build.py — assemble the knowledge base and the standalone tester.

  kb.prose.md  (hand-written)  ─┐
                                ├─→ gogh-kb.md ─→ gogh-helper.html
  kb.facts.md  (generated)     ─┘

The prose explains; the appendix is the current truth. The header written here
tells the model which wins when they disagree, which is what makes it safe for
the appendix to auto-update while the prose waits for a human.
"""

import hashlib
import json
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent

HEADER = """# Gogh Editor — Knowledge Base

This knowledge base has two parts.

**Part one is hand-written prose.** It explains how Gogh works and why it works
that way. It is thorough and was fact-checked against the source, but it is
maintained by a person and can lag a release behind.

**Part two is a generated appendix**, extracted mechanically from the Gogh source
on every release. It carries exact values: version numbers, design constants, UI
labels, toast copy, template names, hook names, tool signatures.

**When the two disagree, the appendix is correct.** Say so plainly if a user asks
about something where they conflict, rather than picking one silently. Quote UI
labels and message copy from the appendix, verbatim — those are the current
strings, and a paraphrased button label is the fastest way to lose a user's trust.

Generated for plugin version {version} · knowledge base {kbid}.

---

"""


def load_prompt():
    """
    Parse prompt.md into {persona, bridge, modes:{...}}. Section headers are
    `## persona`, `## bridge` and `## mode: <name>`; HTML comments are stripped.

    `bridge` is kept separate because it is only appended when the page is
    embedded in the editor — the standalone build must never promise buttons it
    cannot render.

    Both front ends get this same object, so the standalone build and the Worker
    can never disagree about what the bot is supposed to be.
    """
    raw = re.sub(r'<!--.*?-->', '', (HERE / 'prompt.md').read_text(encoding='utf-8'), flags=re.S)

    out = {'persona': '', 'bridge': '', 'modes': {}}
    section, buf = None, []

    def flush():
        if section is None:
            return
        text = '\n'.join(buf).strip()
        if section in ('persona', 'bridge'):
            out[section] = text
        else:
            out['modes'][section] = text

    for line in raw.splitlines():
        m = re.match(r'##\s+(?:(persona|bridge)|mode:\s*(\w+))\s*$', line.strip())
        if m:
            flush()
            section = m.group(1) or m.group(2)
            buf = []
            continue
        if section is not None:
            buf.append(line)
    flush()

    if not out['persona']:
        sys.exit('build.py: prompt.md has no "## persona" section')
    if 'auto' not in out['modes']:
        sys.exit('build.py: prompt.md must define "## mode: auto" — it is the fallback')
    if not out['bridge']:
        sys.exit('build.py: prompt.md has no "## bridge" section')
    return out


def js_string(text):
    """
    A JS string literal, with every "<" escaped as \\u003c. Not optional for the
    HTML build: the knowledge base contains "<!--" and "<script", which together
    push the HTML tokenizer into script-data-double-escaped state and swallow
    the rest of the file.
    """
    return json.dumps(text, ensure_ascii=False).replace('<', '\\u003c')


def main():
    prose_p, facts_p = HERE / 'kb.prose.md', HERE / 'kb.facts.md'
    for p in (prose_p, facts_p):
        if not p.exists():
            sys.exit(f'build.py: {p.name} missing — run extract.py first')

    facts = json.loads((HERE / 'kb.facts.json').read_text(encoding='utf-8'))
    version = facts['meta']['plugin_version']

    prose = prose_p.read_text(encoding='utf-8')
    appendix = facts_p.read_text(encoding='utf-8')

    # Drop the prose's own H1 — the header supplies one.
    if prose.startswith('# '):
        prose = prose.split('\n', 1)[1].lstrip('\n')

    body = prose.rstrip() + '\n\n---\n\n' + appendix.rstrip() + '\n'
    kbid = hashlib.sha1(body.encode()).hexdigest()[:7]
    kb = HEADER.format(version=version, kbid=kbid) + body

    (HERE / 'gogh-kb.md').write_text(kb, encoding='utf-8')

    # --- render both front ends from the one template ---
    prompt = load_prompt()
    prompt_lit = json.dumps(prompt, ensure_ascii=False).replace('<', '\\u003c')

    tpl = (HERE / 'template.html').read_text(encoding='utf-8')

    def render(kb_text, sub):
        out = (tpl
               .replace('__KB__', js_string(kb_text))
               .replace('__PROMPT__', prompt_lit)
               .replace('__KBV__', sub))
        for ph in ('__KB__', '__PROMPT__', '__KBV__'):
            if ph in out:
                sys.exit(f'build.py: placeholder {ph} did not substitute')
        return out

    # 1. standalone — KB inlined, visitor brings their own key
    standalone = render(kb, f'{kbid} \u00b7 plugin {version}')
    (HERE / 'gogh-helper.html').write_text(standalone, encoding='utf-8')

    # 2. hosted — an empty KB flips the page into Worker mode. The version line
    #    is filled in at runtime from /api/meta, so it only needs a placeholder.
    hosted = render('', 'connecting\u2026')

    built = None
    worker_src = HERE / 'worker' / 'worker.js'
    if worker_src.exists():
        dist = HERE / 'worker' / 'dist'
        dist.mkdir(parents=True, exist_ok=True)
        w = (worker_src.read_text(encoding='utf-8')
             .replace('__UI__', js_string(hosted))
             .replace('__PROMPT__', prompt_lit))
        for ph in ('__UI__', '__PROMPT__'):
            if ph in w:
                sys.exit(f'build.py: placeholder {ph} did not substitute in worker.js')
        built = dist / 'worker.js'
        built.write_text(w, encoding='utf-8')

    print(f'build: gogh-kb.md {len(kb):,} chars (~{len(kb)//4:,} tokens) \u00b7 '
          f'v{version} \u00b7 kb {kbid}')
    print(f'build: gogh-helper.html {len(standalone):,} bytes (standalone)')
    if built:
        print(f'build: worker/dist/worker.js {built.stat().st_size:,} bytes (hosted)')


if __name__ == '__main__':
    main()
