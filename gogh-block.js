/* gogh/section — the section as a first-class Gutenberg block.
 *
 * v3 (attrs as truth): the block's ATTRIBUTES carry the layout — the editing
 * model and the stylesheet compiled to a scope-templated string (cssT). The
 * saved markup bakes the scoped stylesheet for deactivation safety, but it is
 * a PROJECTION: regenerated from the attributes by every save (and by the
 * server-side rebake when KSES strips it). No model <script> in markup — the
 * model lives in the attributes only.
 *
 * v2 blocks (style + model script in markup, no attributes) validate against
 * the deprecation below and migrate to v3 on their next save.
 */
(function (blocks, element, blockEditor) {
  'use strict';

  var el = element.createElement;
  var InnerBlocks = blockEditor.InnerBlocks;

  function scopedCss(a) {
    return String(a.cssT || '').replace(/GOGHSCOPE/g, a.scope || '');
  }
  // gogh publishes the section div with the design's own class (model m.cls,
  // the editor's userCls rule) and a one-page anchor as its id; save() must
  // write the same, or the block editor calls those sections invalid
  function sectionCls(a) {
    var m = a.model && a.model.m;
    return String((m && m.cls) || '').split(/\s+/).filter(function (c) {
      return /^[a-z][a-z0-9-]{0,40}$/i.test(c) && !/^gogh-/i.test(c) && !/^wp-/i.test(c);
    }).slice(0, 4).join(' ');
  }
  function sectionDivProps(a) {
    var cls = sectionCls(a);
    var anchor = a.model && typeof a.model.anchor === 'string' ? a.model.anchor : '';
    var p = { className: 'gogh-section ' + (a.scope || '') + (cls ? ' ' + cls : ''), 'data-gogh-scope': a.scope || '' };
    if (anchor) p.id = anchor;
    return p;
  }

  var v2attributes = {
    css: { type: 'string', source: 'text', selector: 'style.gogh-style', default: '' },
    model: { type: 'string', source: 'text', selector: 'script.gogh-model', default: '' },
    scope: {
      type: 'string',
      source: 'attribute',
      selector: '.gogh-section',
      attribute: 'data-gogh-scope',
      default: '',
    },
  };

  function v2save(props) {
    var a = props.attributes;
    return el('div', { className: 'wp-block-gogh-section alignfull gogh-wrap' },
      el('style', { className: 'gogh-style', dangerouslySetInnerHTML: { __html: a.css || '' } }),
      el('script', {
        type: 'application/json',
        className: 'gogh-model',
        dangerouslySetInnerHTML: { __html: a.model || '' },
      }),
      el('div', {
        className: 'gogh-section ' + (a.scope || ''),
        'data-gogh-scope': a.scope || '',
      }, el(InnerBlocks.Content))
    );
  }

  blocks.registerBlockType('gogh/section', {
    title: 'gogh Section',
    description: 'A freeform gogh layout. Edit visually on the front end with gogh, or edit the blocks inside right here.',
    icon: 'art',
    category: 'design',
    supports: {
      html: false,
      customClassName: false,
    },
    // plain (unsourced) attributes serialize into the block comment — the
    // KSES-safe home. Anything NOT declared here is DROPPED by Gutenberg on
    // save, so every stored field must be declared.
    attributes: {
      v: { type: 'number', default: 3 },
      scope: { type: 'string', default: '' },
      model: { type: 'object' },
      cssT: { type: 'string', default: '' },
    },

    edit: function (props) {
      var a = props.attributes;
      // freshly inserted section (no model yet): point the user at the live
      // page, where gogh actually does its editing
      if (!a.model) {
        var link = '';
        try { link = window.wp.data.select('core/editor').getPermalink() || ''; } catch (e) {}
        var href = link ? link + (link.indexOf('?') === -1 ? '?' : '&') + 'gogh-edit=1' : '';
        return el('div', {
          className: 'wp-block-gogh-section gogh-wrap',
          style: {
            padding: '56px 24px', textAlign: 'center',
            border: '1.5px dashed #7ea8ff', borderRadius: '14px',
            background: 'rgba(126, 168, 255, 0.06)',
          },
        },
          el('p', { style: { fontWeight: 700, fontSize: '15px', margin: '0 0 6px' } }, '🎨 gogh section'),
          el('p', { style: { margin: '0 0 16px', opacity: 0.75 } },
            'Design this section by dragging elements directly on the live page.'),
          href ? el('a', { className: 'components-button is-primary', href: href }, 'Edit with gogh') : null
        );
      }
      return el('div', { className: 'wp-block-gogh-section alignfull gogh-wrap' },
        el('style', { className: 'gogh-style', dangerouslySetInnerHTML: { __html: scopedCss(a) } }),
        el('div', sectionDivProps(a), el(InnerBlocks, { templateLock: false }))
      );
    },

    save: function (props) {
      var a = props.attributes;
      return el('div', { className: 'wp-block-gogh-section alignfull gogh-wrap' },
        el('style', { className: 'gogh-style', dangerouslySetInnerHTML: { __html: scopedCss(a) } }),
        el('div', sectionDivProps(a), el(InnerBlocks.Content))
      );
    },

    deprecated: [
      {
        // before the section div carried its class and anchor: markup the
        // block editor itself saved keeps validating, then takes the new save
        attributes: {
          v: { type: 'number', default: 3 },
          scope: { type: 'string', default: '' },
          model: { type: 'object' },
          cssT: { type: 'string', default: '' },
        },
        save: function (props) {
          var a = props.attributes;
          return el('div', { className: 'wp-block-gogh-section alignfull gogh-wrap' },
            el('style', { className: 'gogh-style', dangerouslySetInnerHTML: { __html: scopedCss(a) } }),
            el('div', { className: 'gogh-section ' + (a.scope || ''), 'data-gogh-scope': a.scope || '' }, el(InnerBlocks.Content))
          );
        },
      },
      {
        attributes: v2attributes,
        save: v2save,
        migrate: function (a, innerBlocks) {
          var scope = a.scope || '';
          var model = null;
          try { model = JSON.parse(a.model || 'null'); } catch (e) {}
          if (model && model.version) model.version = 3;
          var cssT = scope ? String(a.css || '').split(scope).join('GOGHSCOPE') : String(a.css || '');
          return [ { v: 3, scope: scope, model: model, cssT: cssT }, innerBlocks ];
        },
      },
    ],
  });
})(window.wp.blocks, window.wp.element, window.wp.blockEditor);
