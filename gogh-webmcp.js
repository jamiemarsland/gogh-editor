/* gogh ↔ WebMCP bridge
 *
 * The page offers its own editing hands to any browser agent that speaks
 * navigator.modelContext (the W3C WebMCP proposal). Every tool is a thin
 * wrapper over the editor's __gogh API, so an agent can build a page the
 * same way a person does: add a section, paste HTML, drop a shape, recolour
 * a background, publish.
 *
 * Without WebMCP support the tools still exist on window.__goghMcp — the
 * test suite drives them there, and it doubles as a console demo:
 *   __goghMcp.call('gogh_add_section', { layout: 'Hero' })
 */
(function () {
  'use strict';
  var G = window.__gogh;
  if (!G) return;

  function contentSecs() {
    return G.sections().filter(function (s) { return !s.chrome; });
  }
  function ensureEditing() {
    if (!G.state.editing) G.setEditing(true);
  }
  function starterNames() {
    return G.templates().filter(function (t) { return t.starter && !t.retired; })
      .map(function (t) { return t.name; });
  }
  function findTemplate(name) {
    var want = String(name || '').trim().toLowerCase();
    if (!want) return null;
    return G.templates().filter(function (t) {
      return !t.retired && t.starter && t.name && t.name.toLowerCase().indexOf(want) !== -1;
    })[0] || null;
  }
  function secOf(e) {
    return G.sections().filter(function (s) { return s.els.indexOf(e) !== -1; })[0] || null;
  }
  function textOf(e) {
    return (e.text || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  // agents chain calls faster than the canvas scrolls — "the section in
  // view" is racy for them, so tools accept an explicit section index and
  // this moves a freshly placed element there, centred
  function settleInSection(e, sectionIdx, atBack) {
    if (sectionIdx == null) return;
    var target = contentSecs()[sectionIdx | 0];
    if (!target) return;
    var from = secOf(e);
    if (from && from !== target) {
      from.els.splice(from.els.indexOf(e), 1);
      if (atBack) target.els.unshift(e); else target.els.push(e);
      G.renderSection(from);
    }
    var H = Math.max(target.minH || 0, 300);
    target.els.forEach(function (o) { if (o !== e) H = Math.max(H, o.y + o.h); });
    e.x = Math.round((1200 - e.w) / 2);
    e.y = Math.max(8, Math.round((H - e.h) / 2));
    G.renderSection(target);
    G.pushState();
  }

  // a colour argument may be a theme palette slug or real CSS
  function cssColor(c) {
    var v = String(c || '').trim();
    if (!v) return null;
    return /^[a-z0-9-]+$/.test(v) && v.indexOf('#') === -1 && !/^(red|blue|green|black|white|transparent)$/.test(v)
      ? 'var(--wp--preset--color--' + v + ')' : v;
  }

  var TOOLS = [
    {
      name: 'gogh_page_overview',
      description: 'Describe the current page: every section, its elements and their text. Call this first to orient yourself.',
      schema: { type: 'object', properties: {} },
      run: function () {
        var lines = [];
        G.sections().forEach(function (s, i) {
          if (s.chrome) {
            lines.push('[' + i + '] site ' + s.chrome.area + ' (edit via the page, not these tools)');
            return;
          }
          var els = s.els.map(function (e) {
            var t = textOf(e);
            return e.type + (e.shape ? ':' + e.shape : '') + (t ? ' "' + t.slice(0, 48) + '"' : '');
          });
          lines.push('[' + i + '] section — ' + (els.length ? els.join('; ') : 'empty'));
        });
        lines.push('');
        lines.push('Unpublished changes: ' + (G.isDirty() ? 'yes — call gogh_publish when done' : 'no'));
        return lines.join('\n');
      },
    },
    {
      name: 'gogh_list_layouts',
      description: 'List the ready-made section layouts that gogh_add_section accepts.',
      schema: { type: 'object', properties: {} },
      run: function () {
        return 'Layouts: ' + starterNames().join(', ');
      },
    },
    {
      name: 'gogh_add_section',
      description: 'Add a ready-made section layout to the end of the page. Use gogh_list_layouts to see the options. The layouts are tuned for SHORT, punchy copy — headings of 2–6 words.',
      schema: {
        type: 'object',
        properties: { layout: { type: 'string', description: 'Layout name, e.g. "Hero" or "Get in touch"' } },
        required: ['layout'],
      },
      run: function (args) {
        ensureEditing();
        var tpl = findTemplate(args.layout);
        if (!tpl) return 'No layout matches "' + args.layout + '". Options: ' + starterNames().join(', ');
        G.addSection(tpl, G.sections().length);
        return 'Added a "' + tpl.name + '" section at position ' + (contentSecs().length - 1) + '.';
      },
    },
    {
      name: 'gogh_paste_html',
      description: 'Add a section from raw HTML markup. It lands as a real block, pixel-faithful; text stays editable.',
      schema: {
        type: 'object',
        properties: { html: { type: 'string', description: 'The HTML for the section, e.g. <section>…</section>' } },
        required: ['html'],
      },
      run: function (args) {
        if (!args.html || !String(args.html).trim()) return 'No HTML given.';
        ensureEditing();
        G.addHtmlSection(String(args.html), G.sections().length);
        return 'HTML section added to the end of the page.';
      },
    },
    {
      name: 'gogh_add_element',
      description: 'Add a single element (heading, para, button, image, badge) to the section currently in view, optionally with its text.',
      schema: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['heading', 'para', 'button', 'image', 'badge'] },
          text: { type: 'string', description: 'Text for the element (ignored for image)' },
          section: { type: 'number', description: 'Optional content-section index (from gogh_page_overview); defaults to the section in view' },
        },
        required: ['type'],
      },
      run: function (args) {
        ensureEditing();
        var kinds = ['heading', 'para', 'button', 'image', 'badge'];
        if (kinds.indexOf(args.type) === -1) return 'Unknown element type "' + args.type + '". Use: ' + kinds.join(', ');
        var e = G.addElementAt(args.type);
        if (args.text && args.type !== 'image') e.text = String(args.text);
        settleInSection(e, args.section, false);
        var sec = secOf(e);
        if (sec) {
          var oldH = e.h;
          G.renderSection(sec);
          G.measure(sec);
          G.reflowPush(sec, e, oldH);
          G.resolve(sec);
        }
        G.pushState();
        return 'Added a ' + args.type + (args.text ? ' saying "' + args.text + '"' : '') +
          ' in section ' + contentSecs().indexOf(sec) + '.';
      },
    },
    {
      name: 'gogh_add_shape',
      description: 'Add a decorative shape behind other elements (it joins the stack at the back). Shapes: square, rounded, circle, pill, arch, tri (triangle), diamond, blob.',
      schema: {
        type: 'object',
        properties: {
          shape: { type: 'string', description: 'square | rounded | circle | pill | arch | tri | diamond | blob' },
          color: { type: 'string', description: 'Optional theme palette slug (see the theme) or CSS colour' },
          section: { type: 'number', description: 'Optional content-section index (from gogh_page_overview); defaults to the section in view' },
        },
        required: ['shape'],
      },
      run: function (args) {
        ensureEditing();
        var want = String(args.shape || '').toLowerCase();
        var def = G.shapeDefs().filter(function (d) {
          return d.key === want || (d.label || '').toLowerCase().indexOf(want) === 0;
        })[0];
        if (!def) {
          return 'Unknown shape "' + args.shape + '". Options: ' +
            G.shapeDefs().map(function (d) { return d.key; }).join(', ');
        }
        var e = G.addShape(def);
        if (args.color) e.boxBg = /^[a-z0-9-]+$/.test(args.color) ? args.color : String(args.color);
        settleInSection(e, args.section, true);
        var sec = secOf(e);
        if (sec) G.renderSection(sec);
        G.pushState();
        return 'Added a ' + def.label.toLowerCase() + ' shape at the back of section ' +
          contentSecs().indexOf(sec) + '.';
      },
    },
    {
      name: 'gogh_set_section_background',
      description: 'Set a section\'s background colour. Sections are numbered by gogh_page_overview.',
      schema: {
        type: 'object',
        properties: {
          section: { type: 'number', description: 'Content-section index from gogh_page_overview' },
          color: { type: 'string', description: 'Theme palette slug or CSS colour; empty string clears it' },
        },
        required: ['section', 'color'],
      },
      run: function (args) {
        ensureEditing();
        var secs = contentSecs();
        var sec = secs[args.section | 0];
        if (!sec) return 'No content section ' + args.section + ' — the page has ' + secs.length + '.';
        sec.bg = cssColor(args.color);
        G.resolveAll();
        G.pushState();
        return 'Section ' + (args.section | 0) + ' background set to ' + (sec.bg || 'none') + '.';
      },
    },
    {
      name: 'gogh_edit_text',
      description: 'Find text on the page and replace it (headings, paragraphs, buttons, badges in gogh sections). Keep replacements about the same length as the original — headings want 2–6 words; long copy crowds these layouts.',
      schema: {
        type: 'object',
        properties: {
          find: { type: 'string' },
          replace: { type: 'string' },
        },
        required: ['find', 'replace'],
      },
      run: function (args) {
        ensureEditing();
        var find = String(args.find || '');
        if (!find) return 'Nothing to find.';
        var hits = 0;
        contentSecs().forEach(function (sec) {
          sec.els.forEach(function (e) {
            if (typeof e.text === 'string' && e.text.indexOf(find) !== -1) {
              // the human editing path re-measures and pushes neighbours
              // down when text grows — the tool must do the same or long
              // copy piles onto whatever sat below it
              var oldH = e.h;
              e.text = e.text.split(find).join(String(args.replace));
              hits++;
              G.renderSection(sec);
              G.measure(sec);
              G.reflowPush(sec, e, oldH);
              G.resolve(sec);
            }
          });
        });
        if (hits) G.pushState();
        var note = String(args.replace || '').length > find.length * 2 + 16
          ? ' Note: the new text is much longer than the old — these layouts are tuned for concise copy, so consider something shorter if it looks crowded.'
          : '';
        return hits ? 'Replaced ' + hits + ' occurrence(s) of "' + find + '".' + note
          : 'No editable element contains "' + find + '". Try gogh_page_overview to see the text on the page.';
      },
    },
    {
      name: 'gogh_publish',
      description: 'Publish the page: every change becomes clean responsive WordPress blocks on the live site.',
      schema: { type: 'object', properties: {} },
      run: function () {
        return G.publish().then(function () {
          return 'Published. The live page now carries the changes.';
        });
      },
    },
  ];

  var reg = {};
  TOOLS.forEach(function (t) { reg[t.name] = t; });
  // every invocation is logged loudly: "is the agent REALLY using WebMCP,
  // or just clicking around?" should be answerable from the console alone
  var CALLS = [];
  function logDone(t, args, via, ms, msg) {
    CALLS.push({ tool: t.name, args: args || {}, via: via, ms: Math.round(ms), at: new Date().toISOString() });
    console.info('%c[gogh] WebMCP call%c ' + t.name + ' (' + via + ', ' + Math.round(ms) + 'ms) → ' + String(msg).split('\n')[0],
      'background:#e8b04b;color:#141519;padding:1px 6px;border-radius:4px;font-weight:700', '');
  }
  function logged(t, args, via) {
    var t0 = performance.now();
    return Promise.resolve()
      .then(function () { return t.run(args || {}); })
      .then(function (msg) {
        logDone(t, args, via, performance.now() - t0, msg);
        return msg;
      });
  }
  window.__goghMcp = {
    tools: reg,
    calls: CALLS,
    call: function (name, args) {
      var t = reg[name];
      if (!t) throw new Error('unknown tool: ' + name);
      // synchronous tools answer synchronously (the suite depends on it);
      // only publish returns a promise
      var t0 = performance.now();
      var out = t.run(args || {});
      if (out && typeof out.then === 'function') {
        return out.then(function (msg) {
          logDone(t, args, 'console', performance.now() - t0, msg);
          return msg;
        });
      }
      logDone(t, args, 'console', performance.now() - t0, out);
      return out;
    },
  };

  var mc = navigator.modelContext;
  if (!mc) {
    console.info('[gogh] WebMCP: navigator.modelContext not present — tools available on __goghMcp only.');
    return;
  }
  var asDecl = function (t) {
    return {
      name: t.name,
      description: t.description,
      inputSchema: t.schema,
      execute: function (args) {
        return logged(t, args, 'webmcp')
          .then(function (msg) { return { content: [{ type: 'text', text: String(msg) }] }; })
          .catch(function (err) {
            return { content: [{ type: 'text', text: 'gogh error: ' + ((err && err.message) || err) }], isError: true };
          });
      },
    };
  };
  try {
    if (typeof mc.registerTool === 'function') {
      TOOLS.forEach(function (t) { mc.registerTool(asDecl(t)); });
    } else if (typeof mc.provideContext === 'function') {
      mc.provideContext({ tools: TOOLS.map(asDecl) });
    } else {
      console.info('[gogh] WebMCP: modelContext present but no known registration method.');
      return;
    }
    console.info('[gogh] WebMCP: ' + TOOLS.length + ' page-editing tools registered.');
  } catch (err) {
    console.warn('[gogh] WebMCP registration failed:', err);
  }
})();
