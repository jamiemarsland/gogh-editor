<?php
/**
 * Runs when Gogh is DELETED from the Plugins screen (never on deactivation).
 *
 * Nothing of yours is touched: pages, posts, media and the keep-the-look CSS
 * that lets designed pages render the same without Gogh all stay. What goes
 * is what only Gogh understands — its settings, and the small keep-the-blocks
 * helper it leaves in mu-plugins on deactivation (a plugin must not leave
 * code running once it has been deleted).
 */
if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}
$gogh_helper = trailingslashit( defined( 'WPMU_PLUGIN_DIR' ) ? WPMU_PLUGIN_DIR : WP_CONTENT_DIR . '/mu-plugins' ) . 'gogh-keep-blocks.php';
if ( file_exists( $gogh_helper ) ) {
	@unlink( $gogh_helper );
}
foreach ( array(
	'gogh_active_style',
	'gogh_ask_key',
	'gogh_ask_log',
	'gogh_ask_workspace',
	'gogh_blog_style',
	'gogh_brand',
	'gogh_category_layout',
	'gogh_first_minute_log',
	'gogh_menu_style',
	'gogh_motion',
	'gogh_product_related',
	'gogh_rewrite_stamp',
	'gogh_shop_layout',
	'gogh_type_scale',
	'gogh_keep_blocks_noted',
) as $gogh_opt ) {
	delete_option( $gogh_opt );
}
