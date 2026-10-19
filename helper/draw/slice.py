"""Find gogh-editor.js's top-level declarations (two-space indent inside the
IIFE) and the closure of names a set of roots needs."""
import re, pathlib, sys

SRC = pathlib.Path(__file__).resolve().parents[2] / 'gogh-editor.js'

def decls(lines):
    out = {}  # name -> (start, end) inclusive line indexes
    i, n = 0, len(lines)
    while i < n:
        L = lines[i]
        m = re.match(r'  function (\w+)\s*\(', L)
        if m:
            j = i
            if not L.rstrip().endswith('}') or L.count('{') != L.count('}'):
                j = i + 1
                while j < n and lines[j].rstrip() != '  }':
                    j += 1
            out.setdefault(m.group(1), (i, j)); i = j + 1; continue
        m = re.match(r'  var (\w+)\s*=', L)
        if m:
            j = i
            if not L.rstrip().endswith(';'):
                j = i + 1
                while j < n and not re.match(r'  [\]\}\)][\]\}\)]*;?\s*$', lines[j]) and not re.match(r'  [\]\}\)].*;\s*$', lines[j]):
                    j += 1
            for nm in re.findall(r'(?:^  var |,\s*)(\w+)\s*=', L):
                out.setdefault(nm, (i, j))
            out.setdefault(m.group(1), (i, j)); i = j + 1; continue
        i += 1
    return out

def strip(code):
    code = re.sub(r'//[^\n]*', '', code)
    code = re.sub(r"'(?:\\.|[^'\\\n])*'", "''", code)
    code = re.sub(r'"(?:\\.|[^"\\\n])*"', '""', code)
    return code

def idents(code):
    code = strip(code)
    names = set(re.findall(r'(?<![\w.$])([A-Za-z_$][\w$]*)', code))
    return names

def closure(lines, D, roots, stubs):
    want, todo = set(), list(roots)
    while todo:
        nm = todo.pop()
        if nm in want or nm in stubs or nm not in D: continue
        want.add(nm)
        a, b = D[nm]
        for x in idents('\n'.join(lines[a:b + 1])):
            if x in D and x not in want and x not in stubs: todo.append(x)
    return want

if __name__ == '__main__':
    lines = SRC.read_text().split('\n')
    D = decls(lines)
    roots = sys.argv[1].split(',')
    stubs = set(sys.argv[2].split(',')) if len(sys.argv) > 2 else set()
    W = closure(lines, D, roots, stubs)
    tot = sum(D[n][1] - D[n][0] + 1 for n in set(W))
    print(len(D), 'decls;', len(W), 'needed;', tot, 'lines')
    big = sorted(W, key=lambda n: -(D[n][1] - D[n][0]))[:40]
    print(' '.join('%s:%d' % (n, D[n][1] - D[n][0] + 1) for n in big))

def why(lines, D, roots, stubs, target):
    # breadth-first parent chain from the roots to target
    from collections import deque
    par, q = {r: None for r in roots}, deque(roots)
    while q:
        nm = q.popleft()
        if nm == target: break
        if nm not in D or nm in stubs: continue
        a, b = D[nm]
        for x in idents('\n'.join(lines[a:b + 1])):
            if x in D and x not in par and x not in stubs:
                par[x] = nm; q.append(x)
    path, x = [], target
    while x is not None and x in par: path.append(x); x = par[x]
    return ' <- '.join(path)
