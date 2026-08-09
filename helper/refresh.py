#!/usr/bin/env python3
"""
refresh.py — one command: re-extract the facts, rebuild the KB, audit the prose.

    python3 helper/refresh.py

Exit codes (chosen so CI can treat them differently):
  0  clean — facts regenerated, prose agrees with the source
  1  facts regenerated, but the prose has drifted and needs a human
  2  the extractor itself broke — a source refactor moved something it anchors on

Only 2 should fail a release. A 1 means the bot still answers correctly (the
appendix is authoritative) but somebody should tidy the prose.
"""

import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent


def run(script):
    r = subprocess.run([sys.executable, str(HERE / script)], cwd=HERE)
    return r.returncode


def main():
    if run('extract.py') != 0:
        print('refresh: extract failed')
        return 2
    if run('build.py') != 0:
        print('refresh: build failed')
        return 2

    code = run('audit.py')
    print({
        0: 'refresh: clean — prose and source agree',
        1: f'refresh: prose drift — see {HERE.name}/kb.audit.md (the bot is still correct; '
           'the appendix carries the current facts)',
        2: f'refresh: EXTRACTOR BROKEN — see {HERE.name}/kb.audit.md, fix the anchors in extract.py',
    }.get(code, f'refresh: audit exited {code}'))
    return code


if __name__ == '__main__':
    sys.exit(main())
