/* gogh/section — the section as a first-class Gutenberg block.
 *
 * STATIC block by design: save() writes the stylesheet and the layout model
 * into the block's own markup, so pages render pixel-identically even with
 * the plugin deactivated (unregistered blocks render their saved HTML).
 */
(function (blocks, element, blockEditor) {
  'use strict';

  var el = element.createElement;
  var InnerBlocks = blockEditor.InnerBlocks;

  blocks.registerBlockType('gogh/section', {
    title: 'gogh Section',
    description: 'A freeform gogh layout. Edit visually on the front end with gogh, or edit the blocks inside right here.',
    icon: 'art',
    category: 'design',
    supports: {
      html: false,
      customClassName: false,
    },
    attributes: {
      css: { type: 'string', source: 'text', selector: 'style.gogh-style', default: '' },
      model: { type: 'string', source: 'text', selector: 'script.gogh-model', default: '' },
      scope: {
        type: 'string',
        source: 'attribute',
        selector: '.gogh-section',
        attribute: 'data-gogh-scope',
        default: '',
      },
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
        el('style', { className: 'gogh-style', dangerouslySetInnerHTML: { __html: a.css || '' } }),
        el('div', {
          className: 'gogh-section ' + (a.scope || ''),
          'data-gogh-scope': a.scope || '',
        }, el(InnerBlocks, { templateLock: false }))
      );
    },

    save: function (props) {
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
    },
  });
})(window.wp.blocks, window.wp.element, window.wp.blockEditor);
