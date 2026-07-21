<?php
/**
 * Plugin Name: Gogh Editor
 * Description: A freeform canvas for WordPress — drag anything anywhere on your live page; Gogh publishes it back as clean, responsive core blocks that keep working even if the plugin is deactivated.
 * Version: 0.29.0
 * Author: Jamie Marsland
 * Author URI: https://pootlepress.com
 * License: GPLv2 or later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Requires at least: 6.5
 * Requires PHP: 7.4
 * Text Domain: gogh-editor
 */

defined( 'ABSPATH' ) || exit;

/**
 * gogh/section — a first-class block. STATIC save (no render_callback), so
 * pages keep rendering identically if the plugin is ever deactivated.
 */
add_action( 'init', function () {
	wp_register_script(
		'gogh-block',
		plugins_url( 'gogh-block.js', __FILE__ ),
		array( 'wp-blocks', 'wp-element', 'wp-block-editor' ),
		'0.29.2',
		true
	);
	register_block_type( 'gogh/section', array(
		'editor_script' => 'gogh-block',
	) );
} );

/**
 * Front-end editor: enqueue for users who can edit the current page.
 */
add_action( 'wp_enqueue_scripts', function () {
	if ( ! is_singular() ) {
		return;
	}
	$post      = get_post();
	$has_gogh  = $post && false !== strpos( $post->post_content, 'gogh-section' );
	// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only view toggle; editor assets are capability-gated below.
	$want_edit = isset( $_GET['gogh-edit'] );
	if ( ! $post || ( ! $has_gogh && ! $want_edit ) ) {
		return;
	}

	// for every visitor: neutralise theme spacing around gogh sections, even
	// on pages whose stored stylesheets predate this rule
	wp_register_style( 'gogh-base', false, array(), '0.29.2' );
	wp_enqueue_style( 'gogh-base' );
	wp_add_inline_style( 'gogh-base',
		'.gogh-wrap { margin-block: 0 !important; }' .
		'.entry-content:has(> .gogh-wrap) { margin-block: 0 !important; }'
	);

	if ( ! current_user_can( 'edit_post', $post->ID ) ) {
		return;
	}

	wp_enqueue_script( 'gogh-editor', plugins_url( 'gogh-editor.js', __FILE__ ), array(), '0.29.2', true );
	wp_enqueue_style( 'gogh-editor', plugins_url( 'gogh-editor.css', __FILE__ ), array(), '0.29.2' );

	// regression suite: /page/?gogh-test (editors only, never saves)
	// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only toggle enqueuing a test script for capability-checked editors.
	if ( isset( $_GET['gogh-test'] ) ) {
		wp_enqueue_script( 'gogh-tests', plugins_url( 'gogh-tests.js', __FILE__ ), array( 'gogh-editor' ), '0.29.2', true );
	}

	$rest_base = ( 'page' === $post->post_type ) ? 'pages' : 'posts';
	wp_localize_script( 'gogh-editor', 'GOGH', array(
		'postId'   => $post->ID,
		'restUrl'  => rest_url( 'wp/v2/' . $rest_base . '/' . $post->ID ),
		'mediaUrl' => rest_url( 'wp/v2/media' ),
		'canUpload' => current_user_can( 'upload_files' ),
		'modified' => get_post_modified_time( 'Y-m-d\TH:i:s', true, $post ),
		'nonce'    => wp_create_nonce( 'wp_rest' ),
	) );
} );

/**
 * Admin-bar entry point: "Edit with gogh" on any front-end page the user can
 * edit. On a page with no gogh content yet, the editor bootstraps a section.
 */
add_action( 'admin_bar_menu', function ( $bar ) {
	if ( is_admin() || ! is_singular() ) {
		return;
	}
	$post = get_post();
	if ( ! $post || ! current_user_can( 'edit_post', $post->ID ) ) {
		return;
	}
	$bar->add_node( array(
		'id'    => 'gogh-edit',
		'title' => '🎨 Edit with gogh',
		'href'  => add_query_arg( 'gogh-edit', '1', get_permalink( $post ) ),
	) );
}, 90 );

/**
 * Backend parity: inject the page's own generated gogh CSS into the block
 * editor iframe so the editor canvas renders the section like the front end.
 */
add_filter( 'block_editor_settings_all', function ( $settings, $context ) {
	$post = isset( $context->post ) ? $context->post : null;
	if ( ! $post || false === strpos( $post->post_content, 'gogh-section' ) ) {
		return $settings;
	}
	if ( ! preg_match_all( '/<style class="gogh-style">(.*?)<\/style>/s', $post->post_content, $m ) ) {
		return $settings;
	}

	$css = implode( "\n", $m[1] );

	// Editor-only adjustments:
	// 1. The group block's inner-blocks wrappers would break the grid —
	//    promote grandchildren into the grid with display:contents.
	// 2. Hide the leading Custom HTML block that carries the style + model.
	$css .= "\n"
		. '.gogh-section > .block-editor-inner-blocks,'
		. '.gogh-section > div:not([class]),'
		. '.gogh-section .block-editor-inner-blocks > .block-editor-block-list__layout { display: contents; }' . "\n"
		. '.is-root-container > [data-type="core/html"]:first-child { display: none; }' . "\n"
		// gogh/section blocks span the full editor canvas, like the front end
		. '.editor-styles-wrapper [data-type="gogh/section"],'
		. '.editor-styles-wrapper .wp-block:has(> .wp-block-gogh-section) {'
		. ' max-width: none !important; width: auto;'
		// kill the editor's block-gap margins so sections sit flush, like the front end
		. ' margin-block: 0 !important;'
		. ' margin-left: calc(-1 * var(--wp--style--root--padding-left, 0px)) !important;'
		. ' margin-right: calc(-1 * var(--wp--style--root--padding-right, 0px)) !important; }' . "\n"
		. '.gogh-wrap { margin-block: 0 !important; }' . "\n"
		// empty image/decoration groups: suppress Gutenberg's layout variation
		// picker and appender so the div renders with its gogh background
		. '.gogh-section .block-editor-block-variation-picker,'
		. '.gogh-section .wp-block-group__placeholder > .components-placeholder,'
		. '.gogh-section .block-list-appender { display: none !important; }';

	$settings['styles'][] = array( 'css' => $css );
	return $settings;
}, 10, 2 );
