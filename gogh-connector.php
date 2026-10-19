<?php
/**
 * The site's own connector: gogh answers MCP at /wp-json/gogh/v1/mcp, so a
 * person can add their real site to Claude (or any agent that speaks MCP)
 * and change it from the chat. The tools are gogh's abilities — the same
 * ones WordPress's Abilities API offers any agent — so there is one
 * implementation, and every call runs as the person, with their permissions.
 *
 * EXPERIMENT (branch explore/site-connector). Off unless switched on, and the
 * only sign-in so far is a STAND-IN: a long secret in the connector's address,
 * accepted only on a site whose environment type is "local". Real sign-in
 * (an approval screen, per-person keys) must replace it before this ever
 * reaches main. Paper: "gogh on your real site, from inside Claude".
 *
 * @package gogh
 */

defined( 'ABSPATH' ) || exit;

const GOGH_CONNECTOR_PROTOCOLS = array( '2025-06-18', '2025-03-26', '2024-11-05' );

// the stand-in: { hash, user } in an option, local sites only
function gogh_connector_standin_user( $key ) {
	if ( 'local' !== wp_get_environment_type() ) {
		return 0;
	}
	$c = get_option( 'gogh_connector_standin' );
	if ( ! is_array( $c ) || empty( $c['hash'] ) || empty( $c['user'] ) || ! is_string( $key ) || strlen( $key ) < 32 ) {
		return 0;
	}
	return hash_equals( (string) $c['hash'], hash( 'sha256', $key ) ) ? (int) $c['user'] : 0;
}

// switch the stand-in on for one person (wp eval / WP-CLI only); returns the
// connector address with its secret, which is shown once and never stored
function gogh_connector_standin_on( $user_id ) {
	if ( 'local' !== wp_get_environment_type() ) {
		return new WP_Error( 'gogh_not_local', 'The stand-in sign-in only works on a local site.' );
	}
	$u = get_userdata( (int) $user_id );
	if ( ! $u || ! user_can( $u, 'edit_pages' ) ) {
		return new WP_Error( 'gogh_no_user', 'That person cannot edit pages.' );
	}
	$key = wp_generate_password( 48, false );
	update_option( 'gogh_connector_standin', array( 'hash' => hash( 'sha256', $key ), 'user' => (int) $u->ID ), false );
	return add_query_arg( 'key', $key, rest_url( 'gogh/v1/mcp' ) );
}

function gogh_connector_standin_off() {
	delete_option( 'gogh_connector_standin' );
}

// gogh's abilities, as MCP tools: 'gogh/read-page' → 'gogh_read_page'
function gogh_connector_abilities() {
	if ( ! function_exists( 'wp_get_abilities' ) ) {
		return array();
	}
	$out = array();
	foreach ( wp_get_abilities() as $a ) {
		$name = $a->get_name();
		if ( 0 !== strpos( $name, 'gogh/' ) ) {
			continue;
		}
		$out[ str_replace( array( '/', '-' ), '_', $name ) ] = $a;
	}
	return $out;
}

function gogh_connector_tool( $tool, $a ) {
	$schema = $a->get_input_schema();
	if ( ! is_array( $schema ) || empty( $schema ) ) {
		$schema = array( 'type' => 'object', 'properties' => new stdClass() );
	}
	unset( $schema['default'] );
	if ( isset( $schema['properties'] ) && array() === $schema['properties'] ) {
		$schema['properties'] = new stdClass();
	}
	$meta = $a->get_meta();
	$ann  = isset( $meta['annotations'] ) && is_array( $meta['annotations'] ) ? $meta['annotations'] : array();
	$t    = array(
		'name'        => $tool,
		'title'       => $a->get_label(),
		'description' => $a->get_description(),
		'inputSchema' => $schema,
	);
	$hints = array();
	if ( isset( $ann['readonly'] ) ) {
		$hints['readOnlyHint'] = (bool) $ann['readonly'];
	}
	if ( isset( $ann['destructive'] ) ) {
		$hints['destructiveHint'] = (bool) $ann['destructive'];
	}
	if ( isset( $ann['idempotent'] ) ) {
		$hints['idempotentHint'] = (bool) $ann['idempotent'];
	}
	if ( $hints ) {
		$t['annotations'] = $hints;
	}
	if ( ! empty( $meta['mcp']['app_only'] ) ) {
		$t['_meta'] = array( 'ui' => array( 'visibility' => array( 'app' ) ) );
	}
	return $t;
}

// ---------- the page widget (an MCP app) ------------------------------------

// what a chat keeps is a small loader that never changes (connector/
// panel.html); the panel itself comes from the site each time it opens, so
// improving it needs no reconnecting
function gogh_connector_widget_uri() {
	return 'ui://gogh/panel.html';
}

// the panel's own code and styles, served to the loader
add_action( 'init', function () {
	$what = isset( $_GET['gogh-panel'] ) ? (string) $_GET['gogh-panel'] : '';
	if ( 'js' !== $what && 'css' !== $what && 'lib' !== $what ) {
		return;
	}
	$dir = __DIR__ . '/connector/';
	header( 'Access-Control-Allow-Origin: *' );
	header( 'Cache-Control: no-cache' );
	header( 'X-Robots-Tag: noindex' );
	if ( 'css' === $what ) {
		header( 'Content-Type: text/css; charset=utf-8' );
		readfile( $dir . 'panel.css' );
	} elseif ( 'lib' === $what ) {
		// html2canvas (MIT, vendor/html2canvas-LICENSE): the panel draws a
		// changed section as a small picture for the agent to look at
		header( 'Content-Type: text/javascript; charset=utf-8' );
		header( 'Cache-Control: public, max-age=86400' );
		readfile( $dir . 'vendor/html2canvas.min.js' );
	} else {
		header( 'Content-Type: text/javascript; charset=utf-8' );
		readfile( $dir . 'gogh-draw.js' );
		echo "\n;\n";
		readfile( $dir . 'panel.js' );
	}
	exit;
}, 0 );

// the address the connector was reached at: the site's own, or a tunnel's
// or proxy's in front of it — the widget must load the page from there
function gogh_connector_public_origin() {
	$host  = ! empty( $_SERVER['HTTP_X_FORWARDED_HOST'] ) ? $_SERVER['HTTP_X_FORWARDED_HOST'] : ( isset( $_SERVER['HTTP_HOST'] ) ? $_SERVER['HTTP_HOST'] : '' );
	$host  = preg_replace( '/[^A-Za-z0-9.:\-]/', '', explode( ',', (string) $host )[0] );
	$https = is_ssl() || ( ! empty( $_SERVER['HTTP_X_FORWARDED_PROTO'] ) && 'https' === strtolower( $_SERVER['HTTP_X_FORWARDED_PROTO'] ) ) || ( ! empty( $_SERVER['HTTP_CF_VISITOR'] ) && false !== strpos( $_SERVER['HTTP_CF_VISITOR'], 'https' ) );
	return $host ? ( $https ? 'https://' : 'http://' ) . $host : gogh_connector_site_origin();
}
function gogh_connector_site_origin() {
	$u = wp_parse_url( home_url( '/' ) );
	return $u['scheme'] . '://' . $u['host'] . ( isset( $u['port'] ) ? ':' . $u['port'] : '' );
}

function gogh_connector_app_tools() {
	$site = html_entity_decode( get_bloginfo( 'name' ), ENT_QUOTES, 'UTF-8' );
	return array(
		array(
			'name'        => 'gogh_open_page',
			'title'       => sprintf( 'Show a page of %s here in the chat', $site ),
			'description' => sprintf( 'Shows a page of %s (the person\'s own website) right here in the chat, not in a browser: when they say "open my home page", "show me the about page" or "let me edit the site", this is the tool. Then call gogh_prepare_choices for the page. ', $site ) . 'The page is drawn exactly as visitors see it (with any changes not live yet). They can click any words to change them, drag sections to reorder them, remove a section, throw changes away or publish. Use it whenever the person wants to look at or work on a page. Their edits are saved as they go; you will see them with gogh_read_page.',
			'inputSchema' => array(
				'type'       => 'object',
				'properties' => array( 'page_id' => array( 'type' => 'integer', 'description' => 'The page. Leave out for the home page.' ) ),
			),
			'annotations' => array( 'readOnlyHint' => true ),
			'_meta'       => array( 'ui' => array( 'resourceUri' => gogh_connector_widget_uri() ) ),
		),
		array(
			'name'        => 'gogh_prepare_choices',
			'title'       => 'Prepare questions for the page',
			'description' => 'Right after you open a page with gogh_open_page, and whenever the person says "more", prepare up to 8 questions for the panel. The panel asks them one at a time, each showing one section two ways: A is the section as it is now, B is your version. The person taps the one they like; that is how a beginner edits. Mostly WORDS (b with new eyebrow, heading, text, text2, button, button2: a real alternative, not a rewording), some shapes (b: { take, face } — another of gogh\'s designs, e.g. { take: "Cover" } for an opening) or ground (b: { ground: "dark" }). Questions in plain words a beginner understands ("How should your opening sound?"), short labels for each side ("Crafted" / "Everyday"), and one taste word for each side ("crafted" / "warm"). Follow the taste the panel reports. Do not change the page yourself while they choose.',
			'inputSchema' => array(
				'type'       => 'object',
				'properties' => array(
					'page_id' => array( 'type' => 'integer' ),
					'cards'   => array(
						'type'     => 'array',
						'maxItems' => 8,
						'items'    => array(
							'type'       => 'object',
							'properties' => array(
								'section_key' => array( 'type' => 'string', 'description' => 'Which section (key from gogh_read_page).' ),
								'question'    => array( 'type' => 'string' ),
								'hint'        => array( 'type' => 'string', 'description' => 'Optional, one short line under the question.' ),
								'label_a'     => array( 'type' => 'string' ),
								'label_b'     => array( 'type' => 'string' ),
								'taste_a'     => array( 'type' => 'string' ),
								'taste_b'     => array( 'type' => 'string' ),
								'b'           => array( 'type' => 'object', 'description' => 'Version B: new words (eyebrow, heading, text, text2, button, button2), and/or take + face, and/or ground ("dark").' ),
							),
							'required'   => array( 'section_key', 'question', 'label_a', 'label_b', 'b' ),
						),
					),
				),
				'required'   => array( 'page_id', 'cards' ),
			),
		),
		array(
			'name'        => 'gogh_explore',
			'title'       => 'Send versions to the explore view',
			'description' => 'When the person explores a section in the page panel (you will be asked in their message), write 3 to 5 genuinely different versions of its words — different angles, not rewordings — using the same fields it has now (eyebrow, heading, text, text2, button, button2), and one or two dials that describe how the versions differ, in the site\'s own language (e.g. low "Plain", high "Poetic"). For each dial give every version a score from 0 (low end) to 1 (high end), in the same order as versions. The panel draws every version in gogh\'s designs at once and the person plays with the dials and chooses by pointing; wait for their choice. Called again with new versions, it starts a new round.',
			'inputSchema' => array(
				'type'       => 'object',
				'properties' => array(
					'page_id'     => array( 'type' => 'integer' ),
					'section_key' => array( 'type' => 'string', 'description' => 'The section\'s key, from the request.' ),
					'versions'    => array( 'type' => 'array', 'maxItems' => 6, 'items' => array( 'type' => 'object', 'properties' => array( 'eyebrow' => array( 'type' => 'string' ), 'heading' => array( 'type' => 'string' ), 'text' => array( 'type' => 'string' ), 'text2' => array( 'type' => 'string' ), 'button' => array( 'type' => 'string' ), 'button2' => array( 'type' => 'string' ) ) ) ),
					'dials'       => array( 'type' => 'array', 'maxItems' => 2, 'items' => array( 'type' => 'object', 'properties' => array( 'low' => array( 'type' => 'string' ), 'high' => array( 'type' => 'string' ), 'scores' => array( 'type' => 'array', 'items' => array( 'type' => 'number' ) ) ), 'required' => array( 'low', 'high', 'scores' ) ) ),
				),
				'required'   => array( 'page_id', 'section_key', 'versions' ),
			),
		),
		array(
			'name'        => 'gogh_open_editor',
			'title'       => 'Open gogh\'s editor in the panel',
			'description' => 'Used by the page panel to open gogh\'s full editor, full screen, for one page.',
			'inputSchema' => array(
				'type'       => 'object',
				'properties' => array( 'page_id' => array( 'type' => 'integer' ) ),
				'required'   => array( 'page_id' ),
			),
			'_meta'       => array( 'ui' => array( 'visibility' => array( 'app' ) ) ),
		),
	);
}

// ---------- the full editor, inside the chat --------------------------------
//
// "Open the editor" in the panel shows gogh's real editor, full screen, in a
// frame of its own on the site's address — every feature, no new editing
// code. The frame has no WordPress login, so the panel asks for a short-lived
// editor pass: it signs that frame in as the person the connector acts for,
// for one page, for 30 minutes. (Experiment: it rides on the stand-in
// sign-in, and real sign-in must mint these passes before this ships.)

const GOGH_EDITOR_PASS_TTL = 1800;

function gogh_connector_editor_pass( $user_id, $page_id ) {
	$t = wp_generate_password( 40, false );
	set_transient( 'gogh_ed_' . hash( 'sha256', $t ), array( 'user' => (int) $user_id, 'page' => (int) $page_id ), GOGH_EDITOR_PASS_TTL );
	return $t;
}
function gogh_connector_pass_user( $t ) {
	if ( ! is_string( $t ) || strlen( $t ) < 32 || ! preg_match( '/^[A-Za-z0-9]+$/', $t ) ) {
		return 0;
	}
	$p = get_transient( 'gogh_ed_' . hash( 'sha256', $t ) );
	return is_array( $p ) && ! empty( $p['user'] ) ? (int) $p['user'] : 0;
}
// the pass arrives in the address once, then rides a cookie that lives only
// inside the chat's frame (partitioned), so the editor's own requests and
// page changes carry it
add_filter( 'determine_current_user', function ( $user ) {
	if ( $user ) {
		return $user;
	}
	$t = ! empty( $_GET['gogh-editor'] ) ? (string) $_GET['gogh-editor']
		: ( ! empty( $_SERVER['HTTP_X_GOGH_EDITOR'] ) ? (string) $_SERVER['HTTP_X_GOGH_EDITOR']
		: ( ! empty( $_COOKIE['gogh_editor'] ) ? (string) $_COOKIE['gogh_editor'] : '' ) );
	$u = $t ? gogh_connector_pass_user( $t ) : 0;
	if ( $u ) {
		$GLOBALS['gogh_editor_pass'] = $t;
		// the panel fetches the editor page itself, from the chat's sandbox
		if ( ! empty( $_GET['gogh-editor'] ) && ! headers_sent() ) {
			header( 'Access-Control-Allow-Origin: *' );
		}
	}
	if ( $u && ! empty( $_GET['gogh-editor'] ) && ! headers_sent() ) {
		header( 'Set-Cookie: gogh_editor=' . $t . '; Path=/; Max-Age=' . GOGH_EDITOR_PASS_TTL . '; Secure; HttpOnly; SameSite=None; Partitioned', false );
	}
	return $u ? $u : $user;
}, 30 );

// a page opened with a pass hands it to its own requests (a frame inside a
// chat may not keep cookies, and inside the panel the page has no address of
// its own): every request to the site — same-origin, the site's address, or a
// site-relative path — carries the pass as a header and goes to the site;
// links within the site carry it in the address; and the editor's switches
// ride GOGH_SEARCH
add_action( 'wp_head', function () {
	if ( empty( $GLOBALS['gogh_editor_pass'] ) ) {
		return;
	}
	$t    = $GLOBALS['gogh_editor_pass'];
	$site = gogh_connector_public_origin();
	$qs   = array();
	foreach ( array( 'gogh-edit', 'gogh-restore' ) as $k ) {
		if ( isset( $_GET[ $k ] ) ) {
			$qs[] = $k . '=' . rawurlencode( (string) $_GET[ $k ] );
		}
	}
	echo '<script>window.GOGH_SEARCH=' . wp_json_encode( implode( '&', $qs ) ) . ';window.GOGH_FONT_PROXY=' . wp_json_encode( $site ) . ';(function(t,S){' .
		'var away=location.origin!==S;' .
		'function fix(u){try{var x=new URL(u,away?S+"/":location.href);return{url:x,ours:x.origin===S||x.origin===location.origin};}catch(e){return null;}}' .
		'var f=window.fetch;window.fetch=function(i,o){var raw=typeof i==="string"?i:(i&&i.url);var r=raw?fix(raw):null;if(r&&r.ours){o=Object.assign({},o||{});var h=new Headers(o.headers||(typeof i!=="string"&&i.headers)||{});h.set("X-Gogh-Editor",t);o.headers=h;if(typeof i==="string"&&away)i=r.url.toString();}return f.call(window,i,o);};' .
		'var xo=XMLHttpRequest.prototype.open,xs=XMLHttpRequest.prototype.send;XMLHttpRequest.prototype.open=function(m,u){var r=fix(u);this.__goghOurs=!!(r&&r.ours);var a=[].slice.call(arguments);if(r&&r.ours&&away)a[1]=r.url.toString();return xo.apply(this,a);};XMLHttpRequest.prototype.send=function(){if(this.__goghOurs){try{this.setRequestHeader("X-Gogh-Editor",t);}catch(e){}}return xs.apply(this,arguments);};' .
		'document.addEventListener("click",function(e){var a=e.target.closest&&e.target.closest("a[href]");if(!a)return;var r=fix(a.getAttribute("href"));if(r&&r.ours&&!r.url.searchParams.get("gogh-editor")){r.url.searchParams.set("gogh-editor",t);a.href=r.url.toString();}},true);' .
		'})(' . wp_json_encode( $t ) . ',' . wp_json_encode( $site ) . ');</script>' . "\n";
}, 0 );

// a frame inside a sandboxed panel may have no origin of its own, so the
// editor's same-site requests arrive as cross-origin: let the pass through
add_filter( 'rest_allowed_cors_headers', function ( $h ) {
	$h[] = 'X-Gogh-Editor';
	return $h;
} );

function gogh_connector_open_editor( $args ) {
	$id   = isset( $args['page_id'] ) ? (int) $args['page_id'] : 0;
	$post = $id ? get_post( $id ) : null;
	if ( ! $post || ! current_user_can( 'edit_post', $id ) ) {
		return array( 'content' => array( array( 'type' => 'text', 'text' => 'There is no page with that id that you can edit.' ) ), 'isError' => true );
	}
	$pass = gogh_connector_editor_pass( get_current_user_id(), $id );
	$args = array( 'gogh-edit' => '1', 'gogh-editor' => $pass );
	// changes made in the panel and not live yet: the editor starts from them
	if ( function_exists( 'gogh_ab_pending_backup' ) && gogh_ab_pending_backup( $post ) ) {
		$args['gogh-restore'] = '1';
	}
	$url = add_query_arg( $args, get_permalink( $id ) );
	$url  = str_replace( gogh_connector_site_origin(), gogh_connector_public_origin(), $url );
	return array(
		'content'           => array( array( 'type' => 'text', 'text' => 'The editor is open in the panel.' ) ),
		'structuredContent' => array( 'editor' => $url, 'minutes' => GOGH_EDITOR_PASS_TTL / 60 ),
	);
}

// a round of versions for the explore view: plain words only, kept for an
// hour beside the page, picked up by the open panel through ?gogh-state
function gogh_connector_explore( $args ) {
	$id = isset( $args['page_id'] ) ? (int) $args['page_id'] : 0;
	if ( ! $id || ! current_user_can( 'edit_post', $id ) ) {
		return array( 'content' => array( array( 'type' => 'text', 'text' => 'There is no page with that id that you can edit.' ) ), 'isError' => true );
	}
	$fields   = array( 'eyebrow', 'heading', 'text', 'text2', 'button', 'button2' );
	$versions = array();
	foreach ( array_slice( isset( $args['versions'] ) && is_array( $args['versions'] ) ? $args['versions'] : array(), 0, 6 ) as $v ) {
		$one = array();
		foreach ( $fields as $f ) {
			if ( isset( $v[ $f ] ) && is_scalar( $v[ $f ] ) && '' !== trim( (string) $v[ $f ] ) ) {
				$one[ $f ] = mb_substr( sanitize_text_field( (string) $v[ $f ] ), 0, 400 );
			}
		}
		if ( $one ) {
			$versions[] = $one;
		}
	}
	if ( ! $versions ) {
		return array( 'content' => array( array( 'type' => 'text', 'text' => 'Send at least one version with words.' ) ), 'isError' => true );
	}
	$dials = array();
	foreach ( array_slice( isset( $args['dials'] ) && is_array( $args['dials'] ) ? $args['dials'] : array(), 0, 2 ) as $d ) {
		if ( empty( $d['low'] ) || empty( $d['high'] ) ) {
			continue;
		}
		$scores = array();
		foreach ( $versions as $k => $unused ) {
			$scores[] = isset( $d['scores'][ $k ] ) ? max( 0, min( 1, (float) $d['scores'][ $k ] ) ) : 0.5;
		}
		$dials[] = array( 'low' => mb_substr( sanitize_text_field( (string) $d['low'] ), 0, 30 ), 'high' => mb_substr( sanitize_text_field( (string) $d['high'] ), 0, 30 ), 'scores' => $scores );
	}
	$prev  = get_transient( 'gogh_explore_' . $id );
	$round = is_array( $prev ) && isset( $prev['round'] ) ? (int) $prev['round'] + 1 : 1;
	set_transient( 'gogh_explore_' . $id, array(
		'key'      => sanitize_key( (string) ( isset( $args['section_key'] ) ? $args['section_key'] : '' ) ),
		'versions' => $versions,
		'dials'    => $dials,
		'round'    => $round,
		'at'       => time(),
	), HOUR_IN_SECONDS );
	return array( 'content' => array( array( 'type' => 'text', 'text' => sprintf( 'The panel is drawing %d versions (round %d). Wait for the person to choose, or to ask for more like one of them.', count( $versions ), $round ) ) ) );
}

// a deck of questions for the panel: plain data only, kept two hours beside
// the page, picked up by the open panel through ?gogh-state
function gogh_connector_prepare_choices( $args ) {
	$id = isset( $args['page_id'] ) ? (int) $args['page_id'] : 0;
	if ( ! $id || ! current_user_can( 'edit_post', $id ) ) {
		return array( 'content' => array( array( 'type' => 'text', 'text' => 'There is no page with that id that you can edit.' ) ), 'isError' => true );
	}
	$txt   = function ( $v, $n ) { return is_scalar( $v ) ? mb_substr( sanitize_text_field( (string) $v ), 0, $n ) : ''; };
	$cards = array();
	foreach ( array_slice( isset( $args['cards'] ) && is_array( $args['cards'] ) ? $args['cards'] : array(), 0, 8 ) as $c ) {
		if ( ! is_array( $c ) || empty( $c['section_key'] ) || empty( $c['question'] ) || empty( $c['b'] ) || ! is_array( $c['b'] ) ) {
			continue;
		}
		$b = array();
		foreach ( array( 'eyebrow', 'heading', 'text', 'text2', 'button', 'button2' ) as $f ) {
			if ( isset( $c['b'][ $f ] ) && '' !== $txt( $c['b'][ $f ], 400 ) ) {
				$b[ $f ] = $txt( $c['b'][ $f ], 400 );
			}
		}
		if ( ! empty( $c['b']['take'] ) && function_exists( 'gogh_pg_clean_designed' ) && in_array( $c['b']['take'], GOGH_PG_TAKES, true ) ) {
			$b['take'] = (string) $c['b']['take'];
		}
		if ( ! empty( $c['b']['face'] ) ) {
			$b['face'] = $txt( $c['b']['face'], 40 );
		}
		if ( isset( $c['b']['ground'] ) && 'dark' === $c['b']['ground'] ) {
			$b['ground'] = 'dark';
		}
		if ( ! $b ) {
			continue;
		}
		$cards[] = array(
			'key'  => sanitize_key( (string) $c['section_key'] ),
			'q'    => $txt( $c['question'], 140 ),
			'hint' => isset( $c['hint'] ) ? $txt( $c['hint'], 140 ) : '',
			'la'   => $txt( isset( $c['label_a'] ) ? $c['label_a'] : 'As it is', 30 ),
			'lb'   => $txt( isset( $c['label_b'] ) ? $c['label_b'] : 'New', 30 ),
			'ta'   => isset( $c['taste_a'] ) ? $txt( $c['taste_a'], 20 ) : '',
			'tb'   => isset( $c['taste_b'] ) ? $txt( $c['taste_b'], 20 ) : '',
			'b'    => $b,
			'from' => 'claude',
		);
	}
	if ( ! $cards ) {
		return array( 'content' => array( array( 'type' => 'text', 'text' => 'Send at least one card with a section_key, a question, labels and a version b.' ) ), 'isError' => true );
	}
	$prev  = get_transient( 'gogh_deck_' . $id );
	$round = is_array( $prev ) && isset( $prev['round'] ) ? (int) $prev['round'] + 1 : 1;
	set_transient( 'gogh_deck_' . $id, array( 'cards' => $cards, 'round' => $round, 'at' => time() ), 2 * HOUR_IN_SECONDS );
	return array( 'content' => array( array( 'type' => 'text', 'text' => sprintf( 'The panel will ask these %d questions one at a time (round %d). Wait for the person; the panel tells you their taste as they choose.', count( $cards ), $round ) ) ) );
}

function gogh_connector_open_page( $args ) {
	$id = isset( $args['page_id'] ) ? (int) $args['page_id'] : 0;
	if ( ! $id && 'page' === get_option( 'show_on_front' ) ) {
		$id = (int) get_option( 'page_on_front' );
	}
	$post = $id ? get_post( $id ) : null;
	if ( ! $post || 'page' !== $post->post_type || ! current_user_can( 'edit_post', $post->ID ) ) {
		return array( 'content' => array( array( 'type' => 'text', 'text' => 'There is no page with that id that you can edit.' ) ), 'isError' => true );
	}
	$pv = wp_get_ability( 'gogh/preview-page' )->execute( array( 'page_id' => $post->ID ) );
	if ( is_wp_error( $pv ) ) {
		return array( 'content' => array( array( 'type' => 'text', 'text' => $pv->get_error_message() ) ), 'isError' => true );
	}
	$site  = gogh_connector_site_origin();
	$pub   = gogh_connector_public_origin();
	// this is now the page's newest panel: older ones will say so
	if ( preg_match( '/gogh-preview=([A-Za-z0-9]+)/', $pv['preview'], $tm ) ) {
		set_transient( 'gogh_pv_latest_' . $post->ID, $tm[1], 2 * HOUR_IN_SECONDS );
	}
	$pages = array();
	foreach ( get_posts( array( 'post_type' => 'page', 'post_status' => array( 'publish', 'draft', 'private' ), 'numberposts' => 60, 'orderby' => 'menu_order title', 'order' => 'ASC' ) ) as $p ) {
		if ( current_user_can( 'edit_post', $p->ID ) ) {
			$pages[] = array( 'id' => (int) $p->ID, 'title' => html_entity_decode( get_the_title( $p ), ENT_QUOTES, 'UTF-8' ) );
		}
	}
	$data = array(
		'page'                => array( 'id' => (int) $post->ID, 'title' => html_entity_decode( get_the_title( $post ), ENT_QUOTES, 'UTF-8' ), 'status' => $post->post_status ),
		'pages'               => $pages,
		'preview'             => add_query_arg( 'gogh-widget', '1', str_replace( $site, $pub, $pv['preview'] ) ),
		'site_origin'         => $site,
		'public_origin'       => $pub,
		'unpublished_changes' => $pv['unpublished_changes'],
		'can_publish'         => current_user_can( 'publish_pages' ),
		'pictures'            => gogh_pg_pictures(),
		// sections described in words, waiting for the panel to draw them
		'compose'             => json_decode( (string) get_post_meta( $post->ID, '_gogh_compose', true ), true ),
		'changes'             => function_exists( 'gogh_pg_changes_public' ) ? gogh_pg_changes_public( $post->ID ) : array(),
	);
	return array(
		'content'           => array( array( 'type' => 'text', 'text' => sprintf( 'Showing "%s" in the panel. The person can change words, move and remove sections, and publish there. Their edits are saved as they go; read the page again with gogh_read_page before changing it yourself.', $data['page']['title'] ) ) ),
		'structuredContent' => $data,
		'_meta'             => array( 'ui' => array( 'resourceUri' => gogh_connector_widget_uri() ) ),
	);
}

function gogh_connector_read_resource( $uri ) {
	if ( 0 !== strpos( $uri, 'ui://gogh/' ) ) {
		return null;
	}
	$pub = gogh_connector_public_origin();
	return array( 'contents' => array( array(
		'uri'      => $uri,
		'mimeType' => 'text/html;profile=mcp-app',
		'text'     => (string) file_get_contents( __DIR__ . '/connector/panel.html' ),
		'_meta'    => array( 'ui' => array(
			'csp'           => array(
				'connectDomains'  => array( $pub ),
				'baseUriDomains'  => array( $pub ),
				'frameDomains'    => array( $pub ),
				'resourceDomains' => array( $pub, 'https://fonts.googleapis.com', 'https://fonts.gstatic.com', 'https://images.unsplash.com', 'https://raw.githubusercontent.com' ),
			),
			'prefersBorder' => true,
		) ),
	) ) );
}

function gogh_connector_call( $name, $args ) {
	if ( 'gogh_open_page' === $name ) {
		return gogh_connector_open_page( $args );
	}
	if ( 'gogh_explore' === $name ) {
		return gogh_connector_explore( $args );
	}
	if ( 'gogh_prepare_choices' === $name ) {
		return gogh_connector_prepare_choices( $args );
	}
	if ( 'gogh_open_editor' === $name ) {
		return gogh_connector_open_editor( $args );
	}
	$tools = gogh_connector_abilities();
	if ( ! isset( $tools[ $name ] ) ) {
		return array( 'content' => array( array( 'type' => 'text', 'text' => 'Unknown tool ' . $name ) ), 'isError' => true );
	}
	$a = $tools[ $name ];
	// the page panel marks its calls: those changes are the person's own
	if ( is_array( $args ) && array_key_exists( '_panel', $args ) ) {
		$GLOBALS['gogh_change_by'] = $args['_panel'] ? 'you' : '';
		unset( $args['_panel'] );
	}
	$input = ( is_array( $args ) && $args ) ? $args : null;
	$r     = $a->execute( $input );
	if ( is_wp_error( $r ) ) {
		return array( 'content' => array( array( 'type' => 'text', 'text' => $r->get_error_message() ) ), 'isError' => true );
	}
	$out = array( 'content' => array( array( 'type' => 'text', 'text' => wp_json_encode( $r, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT ) ) ) );
	if ( is_array( $r ) && $r && array_keys( $r ) !== range( 0, count( $r ) - 1 ) ) {
		$out['structuredContent'] = $r;
	}
	return $out;
}

function gogh_connector_message( $msg ) {
	if ( ! is_array( $msg ) || ! isset( $msg['jsonrpc'] ) || '2.0' !== $msg['jsonrpc'] ) {
		return array( 'jsonrpc' => '2.0', 'id' => null, 'error' => array( 'code' => -32600, 'message' => 'Invalid request' ) );
	}
	if ( ! array_key_exists( 'id', $msg ) ) {
		return null; // a notification
	}
	$id     = $msg['id'];
	$method = isset( $msg['method'] ) ? (string) $msg['method'] : '';
	$params = isset( $msg['params'] ) && is_array( $msg['params'] ) ? $msg['params'] : array();
	$ok     = function ( $result ) use ( $id ) {
		return array( 'jsonrpc' => '2.0', 'id' => $id, 'result' => $result );
	};
	$err    = function ( $code, $message ) use ( $id ) {
		return array( 'jsonrpc' => '2.0', 'id' => $id, 'error' => array( 'code' => $code, 'message' => $message ) );
	};
	if ( 'initialize' === $method ) {
		$want = isset( $params['protocolVersion'] ) ? (string) $params['protocolVersion'] : '';
		$site = html_entity_decode( get_bloginfo( 'name' ), ENT_QUOTES, 'UTF-8' );
		return $ok( array(
			'protocolVersion' => in_array( $want, GOGH_CONNECTOR_PROTOCOLS, true ) ? $want : GOGH_CONNECTOR_PROTOCOLS[0],
			'capabilities'    => array( 'tools' => array( 'listChanged' => false ), 'resources' => array( 'listChanged' => false ) ),
			'serverInfo'      => array( 'name' => 'gogh · ' . $site, 'version' => defined( 'GOGH_VERSION' ) ? GOGH_VERSION : '1' ),
			'instructions'    => sprintf(
				'This is %1$s, a real WordPress site drawn with gogh, and you act as %2$s. Start with gogh_describe_site, then gogh_read_page for the page in question. Right after opening a page with gogh_open_page, prepare questions for it with gogh_prepare_choices: that is how a beginner edits, by tapping the version they like. When the person explores a section in the panel, answer with gogh_explore (versions of its words and dials), not with a change. When the person wants to see or work on a page, open it with gogh_open_page: they can edit it there themselves, and the open panel redraws by itself when you change the page (no need to open it again). The panel tells you what they are pointing at: when they say "this", "here" or "it", that is what they mean. Address sections by their key (section_key), which stays the same when sections move. Every change goes into the page\'s change list with who made it; gogh_undo_change takes back the latest. After a change the panel also shows you a small picture of the section that changed: look at it the way a designer would (words too long for the design, words hard to read on a picture, a section that now feels crowded) and say so or fix it. Changes to a page are saved but not live: offer gogh_preview_page so the person can look, and use gogh_publish only when they say so. Remove sections or throw changes away only when asked.',
				$site,
				wp_get_current_user()->display_name
			),
		) );
	}
	if ( 'ping' === $method ) {
		return $ok( new stdClass() );
	}
	if ( 'tools/list' === $method ) {
		$list = array();
		foreach ( gogh_connector_abilities() as $tool => $a ) {
			$list[] = gogh_connector_tool( $tool, $a );
		}
		return $ok( array( 'tools' => array_merge( gogh_connector_app_tools(), $list ) ) );
	}
	if ( 'resources/list' === $method ) {
		return $ok( array( 'resources' => array( array( 'uri' => gogh_connector_widget_uri(), 'name' => 'gogh page', 'description' => 'One page of the site, to edit in place.', 'mimeType' => 'text/html;profile=mcp-app' ) ) ) );
	}
	if ( 'resources/templates/list' === $method ) {
		return $ok( array( 'resourceTemplates' => array() ) );
	}
	if ( 'resources/read' === $method ) {
		$r = gogh_connector_read_resource( isset( $params['uri'] ) ? (string) $params['uri'] : '' );
		return $r ? $ok( $r ) : $err( -32002, 'Resource not found' );
	}
	if ( 'tools/call' === $method ) {
		$name = isset( $params['name'] ) ? (string) $params['name'] : '';
		$args = isset( $params['arguments'] ) && is_array( $params['arguments'] ) ? $params['arguments'] : array();
		return $ok( gogh_connector_call( $name, $args ) );
	}
	return $err( -32601, 'Method not found: ' . $method );
}

// the site's own pictures, for the panel's snapshot: a canvas only lets a
// picture into the image it makes when the picture's server says other
// origins may use it, and plain files do not (html2canvas's proxy protocol:
// ?url=…&responseType=…). Pictures under wp-content on this site only.
add_action( 'rest_api_init', function () {
	register_rest_route( 'gogh/v1', '/img', array(
		'methods'             => 'GET',
		'permission_callback' => '__return_true',
		'callback'            => function ( WP_REST_Request $req ) {
			$u    = wp_parse_url( (string) $req->get_param( 'url' ) );
			$path = isset( $u['path'] ) ? rawurldecode( $u['path'] ) : '';
			$file = $path && 0 === strpos( $path, '/wp-content/' ) ? realpath( ABSPATH . ltrim( $path, '/' ) ) : false;
			$root = realpath( WP_CONTENT_DIR );
			$type = array( 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp', 'gif' => 'image/gif', 'avif' => 'image/avif', 'svg' => 'image/svg+xml' );
			$ext  = strtolower( pathinfo( (string) $file, PATHINFO_EXTENSION ) );
			if ( ! $file || ! $root || 0 !== strpos( $file, $root . DIRECTORY_SEPARATOR ) || ! isset( $type[ $ext ] ) || ! is_readable( $file ) ) {
				return new WP_Error( 'gogh_no_picture', 'No such picture.', array( 'status' => 404 ) );
			}
			header( 'Content-Type: ' . $type[ $ext ] );
			header( 'Access-Control-Allow-Origin: *' );
			header( 'Cache-Control: public, max-age=86400' );
			readfile( $file );
			exit;
		},
	) );
} );

add_action( 'rest_api_init', function () {
	register_rest_route( 'gogh/v1', '/mcp', array(
		array(
			'methods'             => 'POST',
			'permission_callback' => function ( WP_REST_Request $req ) {
				$key  = (string) ( $req->get_param( 'key' ) ? $req->get_param( 'key' ) : $req->get_header( 'x-gogh-key' ) );
				$user = gogh_connector_standin_user( $key );
				if ( ! $user ) {
					return new WP_Error( 'gogh_connector_closed', 'This site\'s gogh connector is not switched on, or the address is wrong.', array( 'status' => 401 ) );
				}
				wp_set_current_user( $user );
				return true;
			},
			'callback'            => function ( WP_REST_Request $req ) {
				$body = json_decode( $req->get_body(), true );
				if ( null === $body ) {
					return new WP_REST_Response( array( 'jsonrpc' => '2.0', 'id' => null, 'error' => array( 'code' => -32700, 'message' => 'Parse error' ) ), 400 );
				}
				$batch = isset( $body[0] );
				$out   = array();
				foreach ( $batch ? $body : array( $body ) as $msg ) {
					$r = gogh_connector_message( $msg );
					if ( null !== $r ) {
						$out[] = $r;
					}
				}
				if ( ! $out ) {
					return new WP_REST_Response( null, 202 );
				}
				$res = new WP_REST_Response( $batch ? $out : $out[0], 200 );
				$res->header( 'Cache-Control', 'no-store' );
				return $res;
			},
		),
		array(
			// no server-to-client stream: this connector only answers
			'methods'             => 'GET',
			'permission_callback' => '__return_true',
			'callback'            => function () {
				return new WP_REST_Response( array( 'error' => 'POST JSON-RPC here.' ), 405 );
			},
		),
	) );
} );
