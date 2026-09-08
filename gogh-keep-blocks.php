<?php
/**
 * Plugin Name: Gogh — keep the blocks
 * Description: Left behind when Gogh is deactivated so its sections stay ordinary, editable blocks in the block editor. Removes itself when Gogh is active again.
 * Version: 1.0
 *
 * Gogh's "deactivation safety" promise: pages render the same and every
 * piece stays a real core block. This file keeps the WRAPPER known to the
 * editor too, so the block editor shows "gogh Section" with its inner blocks
 * instead of "Unsupported" and a Keep-as-HTML button that would flatten them.
 *
 * Copied into wp-content/mu-plugins by Gogh's deactivation hook; deleted by
 * its activation hook (and by itself, the moment it sees Gogh active).
 */

defined( 'ABSPATH' ) || exit;

add_action( 'init', function () {
	if ( defined( 'GOGH_VERSION' ) ) {
		// Gogh is back: it registers the real blocks — this helper must go
		if ( is_writable( __FILE__ ) ) {
			@unlink( __FILE__ );
		}
		return;
	}
	if ( ! function_exists( 'register_block_type' ) ) {
		return;
	}
	// the editor-side twin of gogh-block.js: same name, same attributes, the
	// SAME save markup (validation depends on it), inner blocks editable
	wp_register_script( 'gogh-keep-blocks', false, array( 'wp-blocks', 'wp-element', 'wp-block-editor' ), '1.0', true );
	wp_add_inline_script( 'gogh-keep-blocks', <<<'JS'
(function (blocks, element, blockEditor) {
  var el = element.createElement, InnerBlocks = blockEditor.InnerBlocks;
  function scopedCss(a) { return String(a.cssT || '').replace(/GOGHSCOPE/g, a.scope || ''); }
  function wrap(a, inner) {
    return el('div', { className: 'wp-block-gogh-section alignfull gogh-wrap' },
      el('style', { className: 'gogh-style', dangerouslySetInnerHTML: { __html: scopedCss(a) } }),
      el('div', { className: 'gogh-section ' + (a.scope || ''), 'data-gogh-scope': a.scope || '' }, inner));
  }
  var v2attributes = {
    css: { type: 'string', source: 'text', selector: 'style.gogh-style', default: '' },
    model: { type: 'string', source: 'text', selector: 'script.gogh-model', default: '' },
    scope: { type: 'string', source: 'attribute', selector: '.gogh-section', attribute: 'data-gogh-scope', default: '' }
  };
  function v2save(props) {
    var a = props.attributes;
    return el('div', { className: 'wp-block-gogh-section alignfull gogh-wrap' },
      el('style', { className: 'gogh-style', dangerouslySetInnerHTML: { __html: a.css || '' } }),
      el('script', { type: 'application/json', className: 'gogh-model', dangerouslySetInnerHTML: { __html: a.model || '' } }),
      el('div', { className: 'gogh-section ' + (a.scope || ''), 'data-gogh-scope': a.scope || '' }, el(InnerBlocks.Content)));
  }
  blocks.registerBlockType('gogh/section', {
    title: 'gogh Section',
    description: 'A section designed with Gogh. Gogh is not active, so the blocks inside are edited here.',
    icon: 'art',
    category: 'design',
    supports: { html: false, customClassName: false },
    attributes: { v: { type: 'number', default: 3 }, scope: { type: 'string', default: '' }, model: { type: 'object' }, cssT: { type: 'string', default: '' } },
    edit: function (props) { return wrap(props.attributes, el(InnerBlocks, { templateLock: false })); },
    save: function (props) { return wrap(props.attributes, el(InnerBlocks.Content)); },
    deprecated: [{ attributes: v2attributes, save: v2save, migrate: function (a, innerBlocks) {
      var scope = a.scope || ''; var model = null;
      try { model = JSON.parse(a.model || 'null'); } catch (e) {}
      if (model && model.version) model.version = 3;
      var cssT = scope ? String(a.css || '').split(scope).join('GOGHSCOPE') : String(a.css || '');
      return [{ v: 3, scope: scope, model: model, cssT: cssT }, innerBlocks];
    } }]
  });
  blocks.registerBlockType('gogh/form', {
    title: 'Form (Gogh)',
    icon: 'email',
    category: 'widgets',
    attributes: { heading: { type: 'string', default: '' }, button: { type: 'string', default: '' } },
    edit: function () {
      return el('div', { style: { padding: '24px', border: '1.5px dashed #999', borderRadius: '10px', opacity: 0.8 } },
        el('strong', null, 'Gogh form'), el('p', { style: { margin: '6px 0 0' } }, 'This form sends messages when the Gogh plugin is active. It is kept here so nothing is lost.'));
    },
    save: function () { return null; }
  });
})(window.wp.blocks, window.wp.element, window.wp.blockEditor);
JS
	);
	// the canvas rules the editor needs for a section to lay out: without
	// them the grid collapses to a sliver (the scoped stylesheet sizes in
	// container units, so the wrapper must BE a container)
	register_block_type( 'gogh/section', array( 'editor_script' => 'gogh-keep-blocks' ) );
	// the form is dynamic: with Gogh away it renders nothing, but stays a
	// known block so reactivating Gogh finds it exactly where it was
	register_block_type( 'gogh/form', array(
		'editor_script'   => 'gogh-keep-blocks',
		'render_callback' => '__return_empty_string',
		'attributes'      => array(
			'heading' => array( 'type' => 'string', 'default' => '' ),
			'button'  => array( 'type' => 'string', 'default' => '' ),
		),
	) );
}, 5 );
// the editor canvas rules, exactly as the plugin shipped them at the moment
// it was deactivated (Gogh writes them in when it leaves this file behind)
add_action( 'enqueue_block_assets', function () {
	if ( defined( 'GOGH_VERSION' ) || ! is_admin() ) {
		return;
	}
	$css = '/*GOGH_EDITOR_CANVAS_CSS*/';
	if ( '' === $css || 0 === strpos( $css, '/*GOGH' ) ) {
		$css = '.gogh-wrap { min-width: 100%; margin-block: 0 !important; } .gogh-section > .wp-block-group { padding: 0 !important; box-sizing: border-box; } .gogh-section > * { box-sizing: border-box; }';
	}
	wp_register_style( 'gogh-keep-blocks-canvas', false, array(), '1.0' );
	wp_enqueue_style( 'gogh-keep-blocks-canvas' );
	wp_add_inline_style( 'gogh-keep-blocks-canvas', $css );
} );
// the block editor's own adjustments for a section (the inner-blocks wrapper
// flattened into the grid, full canvas width), as the plugin shipped them
add_filter( 'block_editor_settings_all', function ( $settings ) {
	if ( defined( 'GOGH_VERSION' ) ) {
		return $settings;
	}
	$css = '/*GOGH_EDITOR_FLATTEN_CSS*/';
	if ( '' === $css || 0 === strpos( $css, '/*GOGH' ) ) {
		$css = '.gogh-section > .block-editor-inner-blocks, .gogh-section > div:not([class]), .gogh-section .block-editor-block-list__layout > div:not([class]), .gogh-section .block-editor-inner-blocks > .block-editor-block-list__layout { display: contents; }';
	}
	$settings['styles'][] = array( 'css' => $css );
	return $settings;
} );
