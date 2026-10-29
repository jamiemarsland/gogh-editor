"""Find ruled rows that read wrong in gogh site definitions and starters.

Run from the plugin root:  python3 spike/check-rows.py --starters blueprint-*.json

A rule is a box whose background is a 1px line. Flags:
  cross  - the drawn line passes through a piece's words
  split  - pieces side by side in one row sit at different y
  uneven - the gaps between consecutive rules differ within a section
"""
import json, re, sys, base64, glob

def line_y(e):
    bg = e.get('boxBg') or ''
    if e.get('type') != 'box' or '1px' not in bg: return None
    if ') top' in bg: return e['y']
    if ') bottom' in bg: return e['y'] + e['h']
    return e['y'] + e['h'] / 2

def words(e):
    return e.get('type') in ('para', 'heading', 'button') or (e.get('type') == 'box' and not line_y(e) and e['w'] < 40)

def defs_from(path):
    raw = open(path).read()
    for m in re.finditer(r"base64_decode\( '([A-Za-z0-9+/=]+)'", raw):
        yield json.loads(base64.b64decode(m.group(1)))

def check(d):
    out = []
    for p in d.get('pages', []):
        for s in p.get('sections', []):
            els = s.get('els') or []
            rules = sorted(set(y for y in (line_y(e) for e in els) if y is not None))
            if not rules: continue
            tag = '%s / %s' % (p.get('title'), s.get('name'))
            for e in els:
                if not words(e) or e['type'] == 'box': continue
                for y in rules:
                    if e['y'] + 2 < y < e['y'] + e['h'] - 2:
                        out.append((tag, 'cross', '%r at y %s, rule at %s' % (e.get('text', '')[:24], e['y'], y)))
            # rows: text pieces whose x ranges don't overlap but sit within one rule band
            bands = [-1e9] + rules + [1e9]
            for a, b in zip(bands, bands[1:]):
                row = [e for e in els if words(e) and a <= e['y'] < b and e['type'] != 'box']
                ys = sorted(set(e['y'] for e in row))
                if len(ys) > 1 and len(row) > 2 and max(ys) - min(ys) < 48 and any(e['h'] <= 30 for e in row):
                    out.append((tag, 'split', 'band %s-%s: ys %s' % (a, b, ys)))
            if len(rules) > 2:
                gaps = sorted(set(round(b - a) for a, b in zip(rules, rules[1:])))
                if len(gaps) > 1 and max(gaps) - min(gaps) > 6:
                    out.append((tag, 'uneven', 'rule gaps %s' % gaps))
    return out

def starter_def(path):
    """A starter page's sections, as a one-page definition the checker reads."""
    raw, dec, secs, at = open(path).read(), json.JSONDecoder(), [], 0
    while True:
        at = raw.find('wp:gogh/section ', at)
        if at < 0: break
        try:
            attrs, end = dec.raw_decode(raw, at + len('wp:gogh/section '))
        except ValueError:
            at += 1; continue
        m = attrs.get('model') or {}
        secs.append({'name': attrs.get('scope'), 'els': m.get('elements') or [], 'minH': m.get('minH')})
        at = end
    return {'pages': [{'title': path.split('/')[-2] + '/' + path.split('/')[-1], 'sections': secs}]}

if __name__ == '__main__':
    bad = 0
    if '--starters' in sys.argv:
        for path in sorted(glob.glob('starters/*/*.html')):
            for tag, kind, msg in check(starter_def(path)):
                bad += 1
                print('%-40s %-6s %s' % (tag, kind, msg))
    for path in [a for a in sys.argv[1:] if not a.startswith('--')]:
        for d in defs_from(path) if path.startswith('blueprint') or '/blueprint' in path else [json.load(open(path))]:
            for tag, kind, msg in check(d):
                bad += 1
                print('%-28s %-34s %-6s %s' % (path.split('/')[-1], tag[:34], kind, msg))
    print('findings:', bad)
