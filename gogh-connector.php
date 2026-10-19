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
	return $t;
}

// ---------- the page widget (an MCP app) ------------------------------------

const GOGH_PAGE_WIDGET_URI = 'ui://gogh/page.html';

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
			'description' => sprintf( 'Shows a page of %s (the person\'s own website) right here in the chat, not in a browser: when they say "open my home page", "show me the about page" or "let me edit the site", this is the tool. ', $site ) . 'The page is drawn exactly as visitors see it (with any changes not live yet). They can click any words to change them, drag sections to reorder them, remove a section, throw changes away or publish. Use it whenever the person wants to look at or work on a page. Their edits are saved as they go; you will see them with gogh_read_page.',
			'inputSchema' => array(
				'type'       => 'object',
				'properties' => array( 'page_id' => array( 'type' => 'integer', 'description' => 'The page. Leave out for the home page.' ) ),
			),
			'annotations' => array( 'readOnlyHint' => true ),
			'_meta'       => array( 'ui' => array( 'resourceUri' => GOGH_PAGE_WIDGET_URI ) ),
		),
	);
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
	);
	return array(
		'content'           => array( array( 'type' => 'text', 'text' => sprintf( 'Showing "%s" in the panel. The person can change words, move and remove sections, and publish there. Their edits are saved as they go; read the page again with gogh_read_page before changing it yourself.', $data['page']['title'] ) ) ),
		'structuredContent' => $data,
		'_meta'             => array( 'ui' => array( 'resourceUri' => GOGH_PAGE_WIDGET_URI ) ),
	);
}

function gogh_connector_read_resource( $uri ) {
	if ( GOGH_PAGE_WIDGET_URI !== $uri ) {
		return null;
	}
	$pub = gogh_connector_public_origin();
	return array( 'contents' => array( array(
		'uri'      => $uri,
		'mimeType' => 'text/html;profile=mcp-app',
		'text'     => (string) file_get_contents( __DIR__ . '/connector/page-widget.html' ),
		'_meta'    => array( 'ui' => array(
			'csp'           => array(
				'connectDomains'  => array( $pub ),
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
	$tools = gogh_connector_abilities();
	if ( ! isset( $tools[ $name ] ) ) {
		return array( 'content' => array( array( 'type' => 'text', 'text' => 'Unknown tool ' . $name ) ), 'isError' => true );
	}
	$a     = $tools[ $name ];
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
				'This is %1$s, a real WordPress site drawn with gogh, and you act as %2$s. Start with gogh_describe_site, then gogh_read_page for the page in question. When the person wants to see or work on a page, open it with gogh_open_page: they can edit it there themselves. Changes to a page are saved but not live: offer gogh_preview_page so the person can look, and use gogh_publish only when they say so. Remove sections or throw changes away only when asked.',
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
		return $ok( array( 'resources' => array( array( 'uri' => GOGH_PAGE_WIDGET_URI, 'name' => 'gogh page', 'description' => 'One page of the site, to edit in place.', 'mimeType' => 'text/html;profile=mcp-app' ) ) ) );
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
