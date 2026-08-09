<?php
/**
 * Gogh Helper — link from the plugin to the hosted bot.
 *
 * Drop this into gogh.php (or require it), set GOGH_HELPER_URL to your deployed
 * Worker, and a "?" button appears next to Undo/Redo in the side palette.
 *
 * The link carries the running plugin version, so the bot answers for the
 * release the person actually has rather than assuming the newest one. It also
 * carries from=editor, which tells the bot they are mid-task and to lead with
 * the action rather than the explanation.
 *
 * Opens in a new tab on purpose: the canvas may hold unpublished changes, and
 * navigating away from it would trip the leave-confirmation.
 */

defined( 'ABSPATH' ) || exit;

/**
 * Your deployed Worker, no trailing slash. Leave empty to hide the button
 * entirely — that is the default, so this file is inert until you set it.
 */
if ( ! defined( 'GOGH_HELPER_URL' ) ) {
	define( 'GOGH_HELPER_URL', '' );
}

/**
 * The URL the help button points at.
 *
 * Filterable so a site can point at its own deployment, or swap in a docs page.
 */
function gogh_helper_url() {
	$base = apply_filters( 'gogh_helper_url', GOGH_HELPER_URL );
	if ( ! $base ) {
		return '';
	}
	return add_query_arg(
		array(
			'v'    => '0.96.5', // keep in step with the plugin header
			'from' => 'editor',
		),
		untrailingslashit( $base )
	);
}

/**
 * Expose it to the editor. gogh-editor.js reads GOGH.helperUrl and, when it is
 * present, renders the "?" in the side palette footer.
 */
add_filter( 'gogh_localize', function ( $data ) {
	$url = gogh_helper_url();
	if ( $url ) {
		$data['helperUrl'] = $url;
	}
	return $data;
} );

/**
 * If you would rather not touch the localize array, this adds the button from
 * the outside once the editor has booted. Same result, no core edit.
 */
add_action( 'wp_footer', function () {
	$url = gogh_helper_url();
	if ( ! $url || ! is_singular() ) {
		return;
	}
	$post = get_queried_object();
	if ( ! $post instanceof WP_Post || ! current_user_can( 'edit_post', $post->ID ) ) {
		return;
	}
	?>
	<script>
	( function () {
		var URL_ = <?php echo wp_json_encode( $url ); ?>;
		document.addEventListener( 'gogh:ready', function () {
			// The palette footer holds Undo/Redo; the help button sits alongside.
			var foot = document.querySelector( '.gogh-side .gogh-side-foot' )
				|| document.querySelector( '.gogh-side' );
			if ( ! foot || foot.querySelector( '.gogh-help-btn' ) ) {
				return;
			}
			var a = document.createElement( 'a' );
			a.className = 'gogh-help-btn';
			a.href = URL_;
			a.target = '_blank';
			a.rel = 'noopener';
			a.title = 'Ask the Gogh helper';
			a.textContent = '?';
			a.style.cssText =
				'display:grid;place-items:center;width:28px;height:28px;border-radius:8px;' +
				'text-decoration:none;font-weight:600;cursor:pointer;';
			foot.appendChild( a );
		}, { once: true } );
	}() );
	</script>
	<?php
} );
