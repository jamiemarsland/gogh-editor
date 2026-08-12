<?php
/**
 * Plugin Name: Gogh Story Pack
 * Description: Scrollytelling for gogh — scenes that unfold as you scroll. The first add-on pack.
 * Version: 0.1.0
 * Author: Jamie Marsland
 *
 * A pack contributes, never patches: it registers a splash kind through
 * gogh's public door (window.gogh.registerSplash) and decorates at view
 * time. Saved output is pure core blocks — deactivate this pack and the
 * story still stands as full-bleed images with words; only the pinning
 * rests. That is the pack law, inherited from core.
 */
defined( 'ABSPATH' ) || exit;

// Melt: a photo whose edges dissolve into whatever lives behind it.
// A block STYLE, not a block — the saved markup stays a pure core
// image wearing one class; the mask is ours to serve.
add_action( 'init', function () {
	register_block_style( 'core/image', array(
		'name'  => 'gogh-melt',
		'label' => __( 'Melt into the background', 'gogh-story' ),
	) );
	// the gasp family: one-shot entrances + one slow breath
	foreach ( array( 'core/image', 'core/group', 'core/heading', 'core/paragraph', 'core/cover' ) as $bt ) {
		register_block_style( $bt, array( 'name' => 'gogh-rise', 'label' => __( 'Rise on entry', 'gogh-story' ) ) );
		register_block_style( $bt, array( 'name' => 'gogh-unveil', 'label' => __( 'Unveil on entry', 'gogh-story' ) ) );
	}
	register_block_style( 'core/image', array( 'name' => 'gogh-breathe', 'label' => __( 'Breathe (slow zoom)', 'gogh-story' ) ) );
} );

add_action( 'wp_enqueue_scripts', function () {
	// the composer only matters where gogh's write room lives; the view
	// styles matter wherever a story might render
	wp_enqueue_style( 'gogh-scrolly', plugins_url( 'scrolly.css', __FILE__ ), array(), '0.1.0' );
	wp_enqueue_script( 'gogh-scrolly', plugins_url( 'scrolly.js', __FILE__ ), array(), '0.1.0', true );
} );
