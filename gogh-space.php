<?php
/**
 * gogh on a Spacefast space. Every space has a WordPress behind it, but the
 * space never hands WordPress the pages visitors ask for: only /wp-admin,
 * /wp-login.php, /wp-json, /wp-content and /wp-includes reach it (tested
 * 2026-10-14). So gogh offers the page itself through the REST API, the one
 * door that is not the admin, and the space's app asks for each page there:
 *
 *   visitor → space app (catch-all) → /wp-json/gogh/v1/view?path=/our-story/
 *           → WordPress draws /our-story/ as an ordinary page request
 *
 * With the owner's login cookie and ?gogh-edit=1 it draws the editor, so the
 * whole of gogh works on a space. And a site can be built there without
 * eval (which the space's WP-CLI refuses): `wp gogh boot <url>`, or the
 * option gogh_space_boot set to a site definition's address.
 *
 * @package gogh
 */

defined( 'ABSPATH' ) || exit;

// ---------- a page, drawn for whoever asked, through the REST door ----------
add_action( 'rest_api_init', function () {
	register_rest_route( 'gogh/v1', '/view', array(
		'methods'             => 'GET',
		// a visitor's page: what anyone may see at that address. Drafts and
		// private pages stay as WordPress decides for the person asking
		'permission_callback' => '__return_true',
		'args'                => array( 'path' => array( 'type' => 'string', 'default' => '/' ) ),
		'callback'            => 'gogh_space_view',
	) );
} );

function gogh_space_view( $req ) {
	$path = '/' . ltrim( (string) $req->get_param( 'path' ), '/' );
	// only a path on this site, never a scheme or a host
	if ( preg_match( '#^//|^/\w+:#', $path ) || false !== strpos( $path, "\n" ) ) {
		return new WP_Error( 'gogh_bad_path', 'Not a path on this site.', array( 'status' => 400 ) );
	}
	// the person, from their login cookie: REST forgets cookie logins that
	// carry no nonce (a guard for writes); a page view only reads, and the
	// editor it draws mints its own nonce for everything it saves
	$uid = wp_validate_auth_cookie( '', 'logged_in' );
	wp_set_current_user( $uid ? (int) $uid : 0 );

	// become an ordinary page request for that path
	$parts = wp_parse_url( $path );
	$query = array();
	if ( ! empty( $parts['query'] ) ) {
		parse_str( $parts['query'], $query );
	}
	$_SERVER['REQUEST_URI'] = $path;
	// WordPress reads PATH_INFO before REQUEST_URI, and here it still names
	// the REST route: without this every page answered 'not found'
	$_SERVER['PATH_INFO'] = '';
	unset( $_SERVER['ORIG_PATH_INFO'] );
	$_SERVER['QUERY_STRING'] = isset( $parts['query'] ) ? $parts['query'] : '';
	$_GET     = $query;
	$_REQUEST = $query;
	if ( ! defined( 'WP_USE_THEMES' ) ) {
		define( 'WP_USE_THEMES', true );
	}
	global $wp, $wp_query, $wp_the_query;
	$wp->query_vars       = array();
	$wp->matched_rule     = null;
	$wp->matched_query    = null;
	$wp_the_query         = new WP_Query();
	$wp_query             = $wp_the_query;
	// '/' is the home page, but WordPress never treats a REST request as the
	// home (WP_Query keeps is_home off under REST_REQUEST), so a site with a
	// chosen home page asks for that page by id
	$front = ( 'page' === get_option( 'show_on_front' ) ) ? (int) get_option( 'page_on_front' ) : 0;
	$home_req = function ( $qv ) use ( $front ) {
		return ( $front && empty( $qv ) ) ? array( 'page_id' => $front ) : $qv;
	};
	add_filter( 'request', $home_req );
	$wp->main();
	remove_filter( 'request', $home_req );

	// the REST server already promised JSON: this answer is a web page
	if ( ! headers_sent() ) {
		header_remove( 'X-Robots-Tag' );
		header_remove( 'Allow' );
		header( 'Content-Type: text/html; charset=' . get_option( 'blog_charset' ) );
		header( 'X-Gogh-View: 1' );
		status_header( is_404() ? 404 : 200 );
	}
	require ABSPATH . WPINC . '/template-loader.php';
	exit;
}

// ---------- building a site where eval is not allowed ----------
function gogh_space_boot_from( $url ) {
	$url = esc_url_raw( trim( (string) $url ) );
	if ( ! $url || 0 !== strpos( $url, 'https://' ) ) {
		return new WP_Error( 'gogh_bad_url', 'A site definition needs an https address.' );
	}
	$res = wp_remote_get( $url, array( 'timeout' => 30 ) );
	if ( is_wp_error( $res ) ) {
		return $res;
	}
	$body = wp_remote_retrieve_body( $res );
	$def  = json_decode( $body, true );
	// a Playground blueprint carries its definition as base64 in a runPHP step
	if ( is_array( $def ) && isset( $def['steps'] ) && ! isset( $def['pages'] ) ) {
		foreach ( (array) $def['steps'] as $st ) {
			if ( isset( $st['step'], $st['code'] ) && 'runPHP' === $st['step'] && preg_match( "/base64_decode\( '([A-Za-z0-9+\/=]+)' \)/", $st['code'], $m ) ) {
				$def = json_decode( base64_decode( $m[1] ), true ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_decode -- the blueprint's own payload
				break;
			}
		}
	}
	if ( ! is_array( $def ) || empty( $def['pages'] ) ) {
		return new WP_Error( 'gogh_bad_def', 'That address does not hold a gogh site definition.' );
	}
	// the build runs as the site's first administrator, as a blueprint does
	if ( ! get_current_user_id() ) {
		$admins = get_users( array( 'role' => 'administrator', 'number' => 1, 'fields' => 'ID' ) );
		if ( $admins ) {
			wp_set_current_user( (int) $admins[0] );
		}
	}
	if ( function_exists( 'set_time_limit' ) ) {
		@set_time_limit( 300 ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- pictures take a while
	}
	$r = gogh_site_def_boot( $def );
	if ( ! is_wp_error( $r ) ) {
		if ( ! empty( $def['name'] ) ) {
			update_option( 'blogname', sanitize_text_field( $def['name'] ) );
		}
		if ( ! empty( $def['tagline'] ) ) {
			update_option( 'blogdescription', sanitize_text_field( $def['tagline'] ) );
		}
		update_option( 'gogh_space_booted', array( 'url' => $url, 'at' => time() ), false );
	}
	return $r;
}

if ( defined( 'WP_CLI' ) && WP_CLI && class_exists( 'WP_CLI' ) ) {
	/**
	 * Build a site from a gogh site definition (or a Playground blueprint) at an address.
	 *
	 * ## OPTIONS
	 *
	 * <url>
	 * : An https address of a site definition or a gogh blueprint.
	 */
	WP_CLI::add_command( 'gogh boot', function ( $args ) {
		$r = gogh_space_boot_from( $args[0] );
		if ( is_wp_error( $r ) ) {
			WP_CLI::error( $r->get_error_message() );
		}
		WP_CLI::success( 'Built. Open the editor once to draw the pages.' );
	} );
}

// the door for hosts whose WP-CLI runs only core commands: set the option to
// an address and the next request builds it (once — the option goes first)
add_action( 'init', function () {
	$url = get_option( 'gogh_space_boot' );
	if ( ! $url || get_transient( 'gogh_space_booting' ) ) {
		return;
	}
	delete_option( 'gogh_space_boot' );
	set_transient( 'gogh_space_booting', 1, 10 * MINUTE_IN_SECONDS );
	$r = gogh_space_boot_from( $url );
	update_option( 'gogh_space_boot_result', is_wp_error( $r ) ? $r->get_error_message() : 'built', false );
	delete_transient( 'gogh_space_booting' );
}, 99 );
