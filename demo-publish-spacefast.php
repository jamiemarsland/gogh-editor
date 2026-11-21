<?php
/**
 * Put this site on the web: a static copy of a gogh site, published to
 * Spacefast from WordPress itself. A blueprint writes this file into
 * mu-plugins (it carries no plugin header on purpose: it lives in gogh's
 * folder, and only gogh.php may have one).
 *
 * A Playground site lives in one browser tab and is gone when the tab
 * closes. This gives its owner a button: every page is drawn the way a
 * signed-out visitor sees it, saved as <path>/index.html beside the files
 * it uses, and sent to Spacefast's publish door with no account. Spacefast
 * answers with a private link to the live copy and a link to claim it; an
 * unclaimed copy stays up for about 33 hours.
 *
 * What a static copy cannot do: forms, search, comments, a shop. It is for
 * sites that are pages and pictures.
 *
 * Why PHP does the sending: Spacefast answers browser calls only from its
 * own address, so a page inside Playground cannot publish by itself; PHP's
 * requests leave Playground by another door and are accepted (tested
 * 2026-11-21).
 *
 * @package gogh
 */

defined( 'ABSPATH' ) || exit;

function gogh_sf_dir() {
	$up = wp_get_upload_dir();
	return trailingslashit( $up['basedir'] ) . 'gogh-spacefast';
}
function gogh_sf_rmdir( $dir ) {
	if ( ! is_dir( $dir ) ) {
		return;
	}
	foreach ( new RecursiveIteratorIterator( new RecursiveDirectoryIterator( $dir, FilesystemIterator::SKIP_DOTS ), RecursiveIteratorIterator::CHILD_FIRST ) as $f ) {
		$f->isDir() ? rmdir( $f->getPathname() ) : unlink( $f->getPathname() ); // phpcs:ignore WordPress.WP.AlternativeFunctions
	}
	rmdir( $dir ); // phpcs:ignore WordPress.WP.AlternativeFunctions
}
// the site's address without its last slash, and the folder part of it
// (Playground serves a site under /scope:…; a static copy lives at the root)
function gogh_sf_home() {
	return untrailingslashit( home_url() );
}
function gogh_sf_home_path() {
	return untrailingslashit( (string) wp_parse_url( home_url( '/' ), PHP_URL_PATH ) );
}

// every address a visitor can reach: where WordPress serves it (view) and
// where its file goes in the copy (out)
function gogh_sf_pages() {
	$pretty = (bool) get_option( 'permalink_structure' );
	$hp     = gogh_sf_home_path();
	$front  = 'page' === get_option( 'show_on_front' ) ? (int) get_option( 'page_on_front' ) : 0;
	// the address WordPress is asked for, without the folder the site sits in
	// (Playground's /scope:… is not part of any page's own address)
	$rel    = function ( $url ) use ( $hp ) {
		$p    = wp_parse_url( $url );
		$path = isset( $p['path'] ) ? $p['path'] : '/';
		if ( '' !== $hp && 0 === strpos( $path, $hp ) ) {
			$path = substr( $path, strlen( $hp ) );
		}
		return ( '' === $path ? '/' : $path ) . ( isset( $p['query'] ) ? '?' . $p['query'] : '' );
	};
	$out    = array( array( 'view' => $rel( home_url( '/' ) ), 'out' => '/', 'id' => $front, 'slug' => '' ) );
	foreach ( get_posts( array( 'post_type' => array( 'page', 'post' ), 'post_status' => 'publish', 'numberposts' => 200, 'orderby' => 'ID', 'order' => 'ASC' ) ) as $p ) {
		if ( (int) $p->ID === $front ) {
			continue;
		}
		$link = get_permalink( $p );
		$path = $pretty ? substr( (string) wp_parse_url( $link, PHP_URL_PATH ), strlen( $hp ) ) : '/' . ( 'page' === $p->post_type ? get_page_uri( $p ) : $p->post_name ) . '/';
		$out[] = array( 'view' => $rel( $link ), 'out' => trailingslashit( $path ), 'id' => (int) $p->ID, 'slug' => $p->post_name );
	}
	foreach ( get_categories( array( 'hide_empty' => true ) ) as $cat ) {
		$link  = get_category_link( $cat );
		$path  = $pretty ? substr( (string) wp_parse_url( $link, PHP_URL_PATH ), strlen( $hp ) ) : '/category/' . $cat->slug . '/';
		$out[] = array( 'view' => $rel( $link ), 'out' => trailingslashit( $path ), 'id' => 0, 'slug' => '', 'cat' => (int) $cat->term_id );
	}
	return $out;
}

// a page as WordPress drew it → a page that works as a file at the root of
// any host: this site's address taken off every link, WordPress's query
// links turned into real addresses, and the hints for a live WordPress gone
function gogh_sf_rewrite( $html, $pages ) {
	$home = gogh_sf_home();
	$hp   = gogh_sf_home_path();
	$html = preg_replace( '#<link\b[^>]*rel=["\'](?:https://api\.w\.org/|EditURI|alternate|shortlink|pingback|wlwmanifest|profile)["\'][^>]*>\s*#i', '', $html );
	// the address, written plainly and the way JSON writes it
	$html = str_replace( array( $home, str_replace( '/', '\/', $home ) ), '', $html );
	if ( '' !== $hp ) {
		$html = preg_replace( '#(["\'(=,\s])' . preg_quote( $hp, '#' ) . '/#', '$1/', $html );
		$html = str_replace( str_replace( '/', '\/', $hp ) . '\/', '\/', $html );
	}
	// ?page_id=5, ?p=9 and ?name=rooms become the page's own folder
	foreach ( $pages as $pg ) {
		$forms = array();
		if ( ! empty( $pg['id'] ) ) {
			$forms[] = '/?page_id=' . $pg['id'];
			$forms[] = '/?p=' . $pg['id'];
		}
		if ( ! empty( $pg['slug'] ) ) {
			$forms[] = '/?name=' . $pg['slug'];
			$forms[] = '/?pagename=' . $pg['slug'];
		}
		if ( ! empty( $pg['cat'] ) ) {
			$forms[] = '/?cat=' . $pg['cat'];
		}
		foreach ( $forms as $f ) {
			$html = preg_replace( '#(["\'])' . preg_quote( $f, '#' ) . '(?=["\'\#])#', '$1' . $pg['out'], $html );
		}
	}
	return preg_replace( '#<head([^>]*)>#i', "<head$1>\n<!-- A static copy of a WordPress site, made by gogh. -->", $html, 1 );
}
// the files a page names on this site: stylesheets, scripts, fonts, pictures
function gogh_sf_assets_in( $text ) {
	$found = array();
	if ( preg_match_all( '#(?<=["\'(=,\s])/(?:wp-content|wp-includes)/[^"\'\s)<>\\\\?\#]+#', str_replace( '\/', '/', $text ), $m ) ) {
		foreach ( $m[0] as $p ) {
			$found[ rawurldecode( html_entity_decode( $p ) ) ] = true;
		}
	}
	return array_keys( $found );
}
// a path in the copy → the file on this server, only inside WordPress's folder
function gogh_sf_file( $path ) {
	$real = realpath( untrailingslashit( ABSPATH ) . $path );
	$root = realpath( ABSPATH );
	return ( $real && $root && 0 === strpos( $real, $root ) && is_file( $real ) && ! preg_match( '#\.(php|phtml|htaccess|sqlite|sql|log)$#i', $real ) ) ? $real : '';
}

// one address, drawn inside this request the way a signed-out visitor's
// visit draws it, and handed back as a string. (gogh's own view door does
// the same and then ends the request; here the page is needed back, and a
// buffer's closing callback does not run when php-wasm exits.)
function gogh_sf_draw( $path ) {
	// a visitor, not the person pressing the button: no toolbar, no editor
	$_COOKIE = array();
	wp_set_current_user( 0 );
	add_filter( 'show_admin_bar', '__return_false', 999 );
	add_filter( 'comments_open', '__return_false', 999 );
	$parts = wp_parse_url( $path );
	$query = array();
	if ( ! empty( $parts['query'] ) ) {
		parse_str( $parts['query'], $query );
	}
	$_SERVER['REQUEST_URI'] = gogh_sf_home_path() . $path;
	$_SERVER['PATH_INFO']   = ''; // it still names the REST route, and WordPress reads it first
	unset( $_SERVER['ORIG_PATH_INFO'] );
	$_SERVER['QUERY_STRING'] = isset( $parts['query'] ) ? $parts['query'] : '';
	$_GET     = $query;
	$_REQUEST = $query;
	if ( ! defined( 'WP_USE_THEMES' ) ) {
		define( 'WP_USE_THEMES', true );
	}
	global $wp, $wp_query, $wp_the_query;
	$wp->query_vars    = array();
	$wp->matched_rule  = null;
	$wp->matched_query = null;
	$wp_the_query      = new WP_Query();
	$wp_query          = $wp_the_query;
	// '/' is the home page, but a REST request is never "home" to WordPress
	$front    = 'page' === get_option( 'show_on_front' ) ? (int) get_option( 'page_on_front' ) : 0;
	$home_req = function ( $qv ) use ( $front ) {
		return ( $front && empty( $qv ) ) ? array( 'page_id' => $front ) : $qv;
	};
	add_filter( 'request', $home_req );
	$wp->main();
	remove_filter( 'request', $home_req );
	if ( is_404() ) {
		return '';
	}
	ob_start();
	require ABSPATH . WPINC . '/template-loader.php';
	return (string) ob_get_clean();
}

add_action( 'rest_api_init', function () {
	$can = function () {
		return current_user_can( 'manage_options' );
	};
	// 1. begin: an empty folder, and the list of addresses to draw
	register_rest_route( 'gogh-sf/v1', '/start', array(
		'methods'             => 'POST',
		'permission_callback' => $can,
		'callback'            => function () {
			gogh_sf_rmdir( gogh_sf_dir() );
			wp_mkdir_p( gogh_sf_dir() );
			$pages = gogh_sf_pages();
			file_put_contents( gogh_sf_dir() . '/.pages.json', wp_json_encode( $pages ) ); // phpcs:ignore WordPress.WP.AlternativeFunctions
			return array( 'pages' => count( $pages ), 'names' => wp_list_pluck( $pages, 'out' ) );
		},
	) );
	// 2. one page per request (WordPress prints a page's styles once per
	// request, so each page needs a request of its own), drawn for a visitor
	register_rest_route( 'gogh-sf/v1', '/page', array(
		'methods'             => 'GET',
		'permission_callback' => $can,
		'args'                => array( 'n' => array( 'type' => 'integer', 'required' => true ) ),
		'callback'            => function ( $req ) {
			$pages = json_decode( (string) @file_get_contents( gogh_sf_dir() . '/.pages.json' ), true ); // phpcs:ignore
			$n     = (int) $req->get_param( 'n' );
			if ( ! is_array( $pages ) || ! isset( $pages[ $n ] ) ) {
				return new WP_Error( 'gogh_sf_page', 'Nothing to draw.', array( 'status' => 400 ) );
			}
			$pg = $pages[ $n ];
			$html = gogh_sf_draw( $pg['view'] );
			if ( strlen( $html ) < 200 || false === stripos( $html, '</html>' ) ) {
				return array( 'ok' => false, 'out' => $pg['out'] );
			}
			$html = gogh_sf_rewrite( $html, $pages );
			$file = gogh_sf_dir() . $pg['out'] . 'index.html';
			wp_mkdir_p( dirname( $file ) );
			file_put_contents( $file, $html ); // phpcs:ignore WordPress.WP.AlternativeFunctions
			return array( 'ok' => true, 'out' => $pg['out'], 'bytes' => strlen( $html ) );
		},
	) );
	// 3. gather the files the pages name, and hand everything to Spacefast
	register_rest_route( 'gogh-sf/v1', '/publish', array(
		'methods'             => 'POST',
		'permission_callback' => $can,
		'callback'            => 'gogh_sf_publish',
	) );
} );

// a font or a picture as a data: address (text), or '' when it is too big or not there
function gogh_sf_data_uri( $path, $max = 3145728 ) {
	$src = gogh_sf_file( $path );
	if ( '' === $src || filesize( $src ) > $max ) {
		return '';
	}
	$types = array( 'woff2' => 'font/woff2', 'woff' => 'font/woff', 'ttf' => 'font/ttf', 'otf' => 'font/otf', 'png' => 'image/png', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'gif' => 'image/gif', 'webp' => 'image/webp', 'avif' => 'image/avif' );
	$ext   = strtolower( pathinfo( $src, PATHINFO_EXTENSION ) );
	return isset( $types[ $ext ] ) ? 'data:' . $types[ $ext ] . ';base64,' . base64_encode( (string) file_get_contents( $src ) ) : ''; // phpcs:ignore
}
// a picture as a text file: an SVG that holds it. Playground's PHP cannot
// send raw picture bytes (anything that is not valid UTF-8 never leaves),
// and an SVG with the picture inside works wherever the picture did
function gogh_sf_svg_wrap( $path ) {
	$src = gogh_sf_file( $path );
	$uri = gogh_sf_data_uri( $path );
	$dim = $src ? @getimagesize( $src ) : false; // phpcs:ignore
	if ( '' === $uri || ! $dim || empty( $dim[0] ) || empty( $dim[1] ) ) {
		return '';
	}
	return '<svg xmlns="http://www.w3.org/2000/svg" width="' . (int) $dim[0] . '" height="' . (int) $dim[1] . '" viewBox="0 0 ' . (int) $dim[0] . ' ' . (int) $dim[1] . '"><image width="' . (int) $dim[0] . '" height="' . (int) $dim[1] . '" href="' . $uri . '"/></svg>';
}
function gogh_sf_fold( $abs ) {
	$parts = array();
	foreach ( explode( '/', $abs ) as $seg ) {
		if ( '..' === $seg ) {
			array_pop( $parts );
		} elseif ( '.' !== $seg && '' !== $seg ) {
			$parts[] = $seg;
		}
	}
	return '/' . implode( '/', $parts );
}

function gogh_sf_publish() {
	$dir   = gogh_sf_dir();
	$files = array(); // path in the copy => its text
	if ( ! is_dir( $dir ) ) {
		return new WP_Error( 'gogh_sf_empty', 'No pages were drawn.', array( 'status' => 400 ) );
	}
	$pages = array();
	foreach ( new RecursiveIteratorIterator( new RecursiveDirectoryIterator( $dir, FilesystemIterator::SKIP_DOTS ) ) as $f ) {
		if ( 'index.html' === $f->getFilename() ) {
			$pages[ ltrim( substr( $f->getPathname(), strlen( $dir ) ), '/' ) ] = (string) file_get_contents( $f->getPathname() ); // phpcs:ignore
		}
	}
	if ( ! isset( $pages['index.html'] ) ) {
		return new WP_Error( 'gogh_sf_empty', 'The home page was not drawn.', array( 'status' => 400 ) );
	}
	$font_re = '#\.(?:woff2?|ttf|otf)$#i';
	$img_re  = '#\.(?:png|jpe?g|gif|webp|avif)$#i';
	// the fonts the pages really use, once, in a stylesheet of their own
	// (a theme prints every face it ships; the copy carries the ones in use)
	$all  = implode( "\n", $pages );
	$bare = preg_replace( '#@font-face\s*\{[^}]*\}#i', '', $all );
	$used = array();
	if ( preg_match_all( '#font-family\s*:\s*([^;}]+)#i', $bare, $fm ) ) {
		foreach ( $fm[1] as $decl ) {
			foreach ( explode( ',', $decl ) as $name ) {
				$used[ strtolower( trim( $name, " \t\n\r\"'" ) ) ] = true;
			}
		}
	}
	if ( preg_match_all( '#--wp--preset--font-family--([a-z0-9-]+)\s*:\s*([^;}]+)#i', $all, $vm ) ) {
		foreach ( $vm[1] as $k => $slug ) {
			if ( false !== strpos( $bare, 'var(--wp--preset--font-family--' . $slug ) ) {
				foreach ( explode( ',', $vm[2][ $k ] ) as $name ) {
					$used[ strtolower( trim( $name, " \t\n\r\"'" ) ) ] = true;
				}
			}
		}
	}
	$faces = array();
	if ( preg_match_all( '#@font-face\s*\{[^}]*\}#i', $all, $ff ) ) {
		foreach ( array_unique( $ff[0] ) as $face ) {
			if ( ! preg_match( '#font-family\s*:\s*["\']?([^;"\']+)#i', $face, $n ) || empty( $used[ strtolower( trim( $n[1] ) ) ] ) ) {
				continue;
			}
			$ok   = true;
			$face = preg_replace_callback( '#url\((["\']?)([^)"\']+)\1\)#i', function ( $u ) use ( &$ok ) {
				$d = gogh_sf_data_uri( strtok( html_entity_decode( $u[2] ), '?#' ), 409600 );
				if ( '' === $d ) {
					$ok = false;
				}
				return 'url(' . $d . ')';
			}, $face );
			if ( $ok ) {
				$faces[] = $face;
			}
		}
	}
	// a few stylesheets of about half a megabyte each: small enough to send
	// in one part, few enough that a page does not ask for twenty files at once
	$sheets = array();
	$sheet  = '';
	foreach ( $faces as $face ) {
		if ( '' !== $sheet && strlen( $sheet ) + strlen( $face ) > 500 * KB_IN_BYTES ) {
			$sheets[ '_gogh/fonts-' . ( count( $sheets ) + 1 ) . '.css' ] = $sheet;
			$sheet = '';
		}
		$sheet .= $face . "\n";
	}
	if ( '' !== $sheet ) {
		$sheets[ '_gogh/fonts-' . ( count( $sheets ) + 1 ) . '.css' ] = $sheet;
	}
	foreach ( $sheets as $sp => $st ) {
		$files[ $sp ] = $st;
	}
	foreach ( $pages as $path => $html ) {
		$html = preg_replace( '#@font-face\s*\{[^}]*\}#i', '', $html );
		// a hint to fetch a font file early means nothing once fonts live in the stylesheet
		$html = preg_replace( '#<link\b[^>]*\bas=["\']font["\'][^>]*>\s*#i', '', $html );
		if ( $faces ) {
			$links = '';
			foreach ( array_keys( $sheets ) as $sheet ) {
				$links .= '<link rel="stylesheet" href="/' . $sheet . '" />' . "\n";
			}
			$html = preg_replace( '#</head>#i', $links . '</head>', $html, 1 );
		}
		// one size of each of the site's own pictures is enough for a copy
		$html           = preg_replace_callback( '#<img\b[^>]*>#i', function ( $m ) {
			return preg_match( '#\ssrc=["\']/wp-content/#i', $m[0] ) ? preg_replace( '#\s(?:srcset|sizes)=(["\'])[^"\']*\1#i', '', $m[0] ) : $m[0];
		}, $html );
		$pages[ $path ] = $html;
	}

	// the files the pages name, and the files their stylesheets point at
	$queue = array();
	foreach ( $pages as $html ) {
		$queue = array_merge( $queue, gogh_sf_assets_in( $html ) );
	}
	$done    = array();
	$renamed = array(); // a picture's address => the address of the SVG that holds it
	$left    = array(); // what could not travel
	while ( $queue ) {
		$p = array_shift( $queue );
		if ( isset( $done[ $p ] ) ) {
			continue;
		}
		$done[ $p ] = true;
		$src        = gogh_sf_file( $p );
		if ( '' === $src ) {
			continue;
		}
		if ( preg_match( $img_re, $p ) ) {
			$svg = gogh_sf_svg_wrap( $p );
			if ( '' === $svg ) {
				$left[] = basename( $p );
				continue;
			}
			$files[ ltrim( $p, '/' ) . '.svg' ] = $svg;
			$renamed[ $p ]                      = $p . '.svg';
			continue;
		}
		if ( preg_match( $font_re, $p ) ) {
			continue; // fonts travel inside the stylesheets that name them
		}
		if ( ! preg_match( '#\.(?:css|js|mjs|json|svg|txt|xml|map)$#i', $p ) ) {
			$left[] = basename( $p );
			continue;
		}
		$text = (string) file_get_contents( $src ); // phpcs:ignore
		if ( preg_match( '#\.css$#i', $p ) ) {
			$text = preg_replace_callback( '#url\((["\']?)(?!data:|https?:|//|\#)([^)"\'?\#]+)([^)"\']*)\1\)#i', function ( $u ) use ( $p, &$queue, $font_re, $img_re ) {
				$abs = gogh_sf_fold( '/' === $u[2][0] ? $u[2] : dirname( $p ) . '/' . $u[2] );
				if ( preg_match( $font_re, $abs ) ) {
					$d = gogh_sf_data_uri( $abs, 409600 );
					return $d ? 'url(' . $d . ')' : $u[0];
				}
				$queue[] = $abs;
				return preg_match( $img_re, $abs ) ? 'url(' . $abs . '.svg)' : 'url(' . $abs . $u[3] . ')';
			}, $text );
		}
		$files[ ltrim( $p, '/' ) ] = $text;
	}
	// pages last: every picture they name now lives at its SVG's address
	foreach ( $pages as $path => $html ) {
		foreach ( $renamed as $from => $to ) {
			$html = preg_replace( '#' . preg_quote( $from, '#' ) . '(?![\w.-])#', $to, $html );
			$html = str_replace( str_replace( '/', '\/', $from ), str_replace( '/', '\/', $to ), $html );
		}
		$files[ $path ] = $html;
	}
	$bytes = 0;
	foreach ( $files as $path => $text ) {
		// only what is valid text can leave Playground
		if ( ! mb_check_encoding( $text, 'UTF-8' ) ) {
			unset( $files[ $path ] );
			$left[] = basename( $path );
			continue;
		}
		$bytes += strlen( $text );
	}
	if ( $bytes > 40 * MB_IN_BYTES || count( $files ) > 900 ) {
		return new WP_Error( 'gogh_sf_big', sprintf( 'This site is too big to send from here (%d files, %s).', count( $files ), size_format( $bytes ) ), array( 'status' => 413 ) );
	}
	$types = array( 'html' => 'text/html; charset=utf-8', 'css' => 'text/css; charset=utf-8', 'js' => 'text/javascript; charset=utf-8', 'mjs' => 'text/javascript; charset=utf-8', 'json' => 'application/json', 'svg' => 'image/svg+xml', 'xml' => 'application/xml', 'txt' => 'text/plain; charset=utf-8', 'map' => 'application/json' );
	// Playground's way out carries about a megabyte at a time, so the copy
	// goes in parts: the files first, the pages last (a visitor never meets a
	// page whose files have not arrived). A file too big for one part stays behind.
	$part_max = 700 * KB_IN_BYTES;
	$parts    = array( array() );
	$size     = 0;
	$order    = array_merge( array_diff( array_keys( $files ), array_keys( $pages ) ), array_keys( $pages ) );
	foreach ( $order as $path ) {
		$len = strlen( $files[ $path ] ) + 300;
		if ( $len > $part_max ) {
			$left[] = basename( $path );
			continue;
		}
		if ( $size + $len > $part_max && $parts[ count( $parts ) - 1 ] ) {
			$parts[] = array();
			$size    = 0;
		}
		$parts[ count( $parts ) - 1 ][] = $path;
		$size += $len;
	}
	$send = function ( $paths, $payload, $key ) use ( $files, $types ) {
		$b    = 'gogh' . wp_generate_password( 24, false );
		$body = "--$b\r\nContent-Disposition: form-data; name=\"payload\"\r\nContent-Type: application/json\r\n\r\n" . wp_json_encode( $payload ) . "\r\n";
		foreach ( $paths as $path ) {
			$ext   = strtolower( pathinfo( $path, PATHINFO_EXTENSION ) );
			$body .= "--$b\r\nContent-Disposition: form-data; name=\"" . str_replace( '"', '', $path ) . '"; filename="' . str_replace( '"', '', $path ) . "\"\r\nContent-Type: " . ( isset( $types[ $ext ] ) ? $types[ $ext ] : 'text/plain' ) . "\r\n\r\n" . $files[ $path ] . "\r\n";
		}
		$body   .= "--$b--\r\n";
		// 'Expect' empty: for a big body WordPress asks the server to say 'go
		// on' first, and Playground's way out cannot hold that conversation
		$headers = array( 'Content-Type' => 'multipart/form-data; boundary=' . $b, 'Accept' => 'application/json', 'Expect' => '' );
		if ( $key ) {
			$headers['Authorization'] = 'Bearer ' . $key;
			// Playground's way out drops Authorization unless it is asked to carry it
			$headers['X-Cors-Proxy-Allowed-Request-Headers'] = 'Authorization';
		}
		return wp_remote_post( 'https://api.spacefast.com/v1/publish', array( 'headers' => $headers, 'body' => $body, 'timeout' => 120 ) );
	};
	$title = wp_specialchars_decode( get_bloginfo( 'name' ), ENT_QUOTES );
	$read  = function ( $resp ) {
		if ( is_wp_error( $resp ) ) {
			return new WP_Error( 'gogh_sf_send', 'Spacefast could not be reached: ' . $resp->get_error_message(), array( 'status' => 502 ) );
		}
		$code = (int) wp_remote_retrieve_response_code( $resp );
		$json = json_decode( wp_remote_retrieve_body( $resp ), true );
		$data = isset( $json['data'] ) && is_array( $json['data'] ) ? $json['data'] : array();
		if ( $code >= 400 || empty( $data['space']['id'] ) ) {
			$why = isset( $json['error']['message'] ) ? $json['error']['message'] : ( isset( $json['message'] ) ? $json['message'] : 'HTTP ' . $code . ' ' . substr( wp_strip_all_tags( (string) wp_remote_retrieve_body( $resp ) ), 0, 180 ) );
			return new WP_Error( 'gogh_sf_refused', 'Spacefast did not take the site: ' . sanitize_text_field( $why ), array( 'status' => 502 ) );
		}
		return $data;
	};
	// the same site published again goes to the same place, while its key lasts
	$had  = get_option( 'gogh_sf_receipt' );
	$had  = ( is_array( $had ) && ! empty( $had['spaceId'] ) && ! empty( $had['key'] ) ) ? $had : null;
	$data = null;
	$rec  = $had;
	foreach ( $parts as $pi => $paths ) {
		$got = null;
		if ( $rec ) {
			$got = $read( $send( $paths, array( 'publishMode' => 'additive', 'spaceId' => $rec['spaceId'] ), $rec['key'] ) );
			if ( is_wp_error( $got ) && 0 === $pi && $had ) {
				// the old copy is gone or its key has run out: start a new one
				$rec = null;
				$had = null;
				$got = null;
			}
		}
		if ( null === $got ) {
			$got = $read( $send( $paths, array( 'publishMode' => 'additive', 'space' => array( 'title' => $title ) ), '' ) );
		}
		if ( is_wp_error( $got ) ) {
			return new WP_Error( $got->get_error_code(), $got->get_error_message() . ' (part ' . ( $pi + 1 ) . ' of ' . count( $parts ) . ')', array( 'status' => 502 ) );
		}
		$data = $got;
		if ( ! $rec ) {
			$claim = isset( $data['claim'] ) && is_array( $data['claim'] ) ? $data['claim'] : array();
			$open  = '';
			foreach ( array( isset( $claim['url'] ) ? $claim['url'] : '', isset( $data['access']['url'] ) ? $data['access']['url'] : '' ) as $u ) {
				if ( $u && false !== strpos( $u, '/__/' ) ) {
					$open = $u;
				}
			}
			$rec = array(
				'spaceId' => $data['space']['id'],
				'key'     => isset( $claim['key'] ) ? $claim['key'] : ( isset( $claim['token'] ) ? $claim['token'] : '' ),
				'open'    => $open ? $open : ( isset( $data['space']['liveUrl'] ) ? $data['space']['liveUrl'] : '' ),
				'claim'   => isset( $claim['claimUrl'] ) ? $claim['claimUrl'] : ( ( isset( $claim['url'] ) && false !== strpos( $claim['url'], '/claim' ) ) ? $claim['url'] : '' ),
				'expires' => isset( $claim['expiresAt'] ) ? $claim['expiresAt'] : '',
				'host'    => isset( $data['space']['defaultHostname'] ) ? $data['space']['defaultHostname'] : '',
			);
			if ( '' === $rec['key'] ) {
				return new WP_Error( 'gogh_sf_key', 'Spacefast took the first part but gave no key to send the rest.', array( 'status' => 502 ) );
			}
		}
	}
	if ( isset( $data['claim']['expiresAt'] ) ) {
		$rec['expires'] = $data['claim']['expiresAt'];
	}
	update_option( 'gogh_sf_receipt', $rec, false );
	gogh_sf_rmdir( $dir );
	return array(
		'open'    => esc_url_raw( $rec['open'] ),
		'claim'   => esc_url_raw( $rec['claim'] ),
		'expires' => $rec['expires'],
		'host'    => $rec['host'],
		'files'   => count( $order ),
		'bytes'   => $bytes,
		'parts'   => count( $parts ),
		'left'    => array_values( array_unique( $left ) ),
		'again'   => (bool) $had,
	);
}

// ---------- the button, for the site's owner only ----------
add_action( 'wp_footer', function () {
	if ( ! current_user_can( 'manage_options' ) || is_admin() ) {
		return;
	}
	$cfg = array( 'rest' => esc_url_raw( rest_url( 'gogh-sf/v1/' ) ), 'nonce' => wp_create_nonce( 'wp_rest' ), 'name' => wp_specialchars_decode( get_bloginfo( 'name' ), ENT_QUOTES ) );
	?>
<style>
.gogh-sf-btn{position:fixed;left:18px;bottom:18px;z-index:999990;font:600 13px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;background:#1c1e24;color:#fff;border:0;border-radius:999px;padding:11px 16px;cursor:pointer;box-shadow:0 6px 20px -8px rgba(0,0,0,.5)}
.gogh-sf-btn:hover{background:#2c2f38}
.gogh-sf-wrap{position:fixed;inset:0;z-index:1000002;background:rgba(15,17,22,.45);display:flex;align-items:center;justify-content:center;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;color:#1c1e24}
.gogh-sf-card{background:#fff;border-radius:16px;padding:26px 28px;width:min(440px,92vw);box-shadow:0 30px 80px -30px rgba(0,0,0,.6)}
.gogh-sf-card h3{margin:0 0 6px;font:600 20px/1.25 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;color:#1c1e24}
.gogh-sf-card p{margin:0 0 14px;color:#4a4e57}
.gogh-sf-bar{height:6px;border-radius:99px;background:#eceef2;overflow:hidden;margin:14px 0 8px}
.gogh-sf-bar i{display:block;height:100%;width:0;background:#1c1e24;transition:width .3s ease}
.gogh-sf-step{font-size:13px;color:#6b6f78;min-height:20px}
.gogh-sf-acts{display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;margin-top:18px}
.gogh-sf-acts a,.gogh-sf-acts button{font:600 13px/1.3 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;border-radius:999px;padding:9px 16px;cursor:pointer;border:1px solid #d7dae2;background:#fff;color:#1c1e24;text-decoration:none}
.gogh-sf-acts .is-main{background:#1c1e24;color:#fff;border-color:#1c1e24}
.gogh-sf-small{font-size:13px;color:#6b6f78;margin:10px 0 0}
</style>
<button type="button" class="gogh-sf-btn">Put this site on the web</button>
<script>
(function () {
  var C = <?php echo wp_json_encode( $cfg ); ?>;
  var btn = document.querySelector('.gogh-sf-btn');
  function api(path, method) {
    return fetch(C.rest + path, { method: method || 'GET', credentials: 'same-origin', headers: { 'X-WP-Nonce': C.nonce } })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j && j.message ? j.message : 'HTTP ' + r.status); return j; }); });
  }
  function el(html) { var d = document.createElement('div'); d.innerHTML = html; return d.firstChild; }
  function esc(s) { var d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }
  btn.addEventListener('click', function () {
    var wrap = el('<div class="gogh-sf-wrap" role="dialog" aria-label="Put this site on the web"><div class="gogh-sf-card">' +
      '<h3>Put ' + esc(C.name) + ' on the web</h3>' +
      '<p>A copy of this site, as visitors see it, goes to Spacefast. You get a private link to it straight away.</p>' +
      '<p class="gogh-sf-small">It is a snapshot: pages and pictures. Forms, search and shops stay behind.</p>' +
      '<div class="gogh-sf-run" hidden><div class="gogh-sf-bar"><i></i></div><div class="gogh-sf-step" aria-live="polite"></div></div>' +
      '<div class="gogh-sf-acts"><button type="button" class="gogh-sf-no">Not now</button><button type="button" class="is-main gogh-sf-go">Publish</button></div>' +
      '</div></div>');
    document.body.appendChild(wrap);
    var close = function () { wrap.remove(); };
    wrap.querySelector('.gogh-sf-no').addEventListener('click', close);
    wrap.addEventListener('click', function (e) { if (e.target === wrap) close(); });
    wrap.querySelector('.gogh-sf-go').addEventListener('click', function () {
      var run = wrap.querySelector('.gogh-sf-run'), bar = run.querySelector('i'), step = run.querySelector('.gogh-sf-step');
      wrap.querySelector('.gogh-sf-acts').hidden = true; run.hidden = false;
      step.textContent = 'Listing the pages…';
      api('start', 'POST').then(function (s) {
        var i = 0, missed = [];
        var next = function () {
          if (i >= s.pages) return Promise.resolve();
          step.textContent = 'Drawing ' + (s.names[i] === '/' ? 'the home page' : s.names[i]) + '…';
          bar.style.width = Math.round((i / (s.pages + 1)) * 100) + '%';
          return api('page?n=' + i).then(function (r) { if (!r || !r.ok) missed.push(s.names[i]); }, function () { missed.push(s.names[i]); })
            .then(function () { i++; return next(); });
        };
        return next().then(function () {
          step.textContent = 'Sending it to Spacefast…';
          bar.style.width = '92%';
          return api('publish', 'POST').then(function (r) { r.missed = missed; return r; });
        });
      }).then(function (r) {
        var when = r.expires ? new Date(r.expires) : null;
        var card = wrap.querySelector('.gogh-sf-card');
        card.innerHTML = '<h3>' + esc(C.name) + ' is on the web</h3>' +
          '<p>' + (r.again ? 'The copy is updated, at the same link.' : 'Your copy is live at a private link.') + ' It stays up' + (when && !isNaN(when) ? ' until ' + esc(when.toLocaleString([], { weekday: 'long', hour: 'numeric', minute: '2-digit' })) : ' for about a day') + '. Claim it and it is yours to keep.</p>' +
          '<p class="gogh-sf-small">Changed something? Publish again and the copy updates.</p>' +
          (r.missed && r.missed.length ? '<p class="gogh-sf-small">Not copied: ' + esc(r.missed.join(', ')) + '</p>' : '') +
          (r.left && r.left.length ? '<p class="gogh-sf-small">Left behind (too big, or not a kind that can travel): ' + esc(r.left.slice(0, 6).join(', ')) + (r.left.length > 6 ? ' and ' + (r.left.length - 6) + ' more' : '') + '</p>' : '') +
          '<div class="gogh-sf-acts"><button type="button" class="gogh-sf-no">Close</button>' +
          (r.claim ? '<a href="' + esc(r.claim) + '" target="_blank" rel="noopener">Claim it</a>' : '') +
          '<a class="is-main" href="' + esc(r.open) + '" target="_blank" rel="noopener">Open the site</a></div>';
        card.querySelector('.gogh-sf-no').addEventListener('click', close);
      }).catch(function (e) {
        var card = wrap.querySelector('.gogh-sf-card');
        card.innerHTML = '<h3>That did not work</h3><p>' + esc(e && e.message ? e.message : 'Something went wrong.') + '</p>' +
          '<div class="gogh-sf-acts"><button type="button" class="is-main gogh-sf-no">Close</button></div>';
        card.querySelector('.gogh-sf-no').addEventListener('click', close);
      });
    });
  });
})();
</script>
	<?php
}, 99 );
