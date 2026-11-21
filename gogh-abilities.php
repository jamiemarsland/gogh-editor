<?php
/**
 * gogh's abilities: what an agent may ask of a gogh site, through WordPress's
 * Abilities API (6.9+) — and so through its REST routes (wp-abilities/v1) and
 * any MCP adapter in front of them. James: 'what would the first cut let
 * folks do?' Read the site, restyle it, stock the shop, publish — everything
 * that happens on the server. Drawing a page stays in the editor: gogh lays
 * pages out in the browser, so an agent here describes and dresses a site,
 * it does not rearrange one.
 *
 * Every ability asks WordPress who may run it; an agent can do no more than
 * the person it acts for.
 *
 * @package gogh
 */

defined( 'ABSPATH' ) || exit;

// ---------- helpers the abilities share -------------------------------------

// words a person reads, from gogh's stored HTML: no tags, no runs of space
function gogh_ab_words( $html, $max = 240 ) {
	$t = trim( preg_replace( '/\s+/u', ' ', html_entity_decode( wp_strip_all_tags( str_replace( array( '<br>', '<br/>', '<br />' ), ' ', (string) $html ) ), ENT_QUOTES, 'UTF-8' ) ) );
	return mb_strlen( $t ) > $max ? rtrim( mb_substr( $t, 0, $max - 1 ) ) . '…' : $t;
}

// a page's gogh sections, read from the model each section block carries
// (the same v3 comment the editor's History reads)
function gogh_ab_sections_of( $content ) {
	$out = array();
	foreach ( parse_blocks( (string) $content ) as $b ) {
		if ( 'gogh/section' !== $b['blockName'] || empty( $b['attrs']['model']['elements'] ) || ! is_array( $b['attrs']['model']['elements'] ) ) {
			continue;
		}
		$md  = $b['attrs']['model'];
		$els = array();
		$walk = function ( $list ) use ( &$walk, &$els ) {
			foreach ( $list as $e ) {
				if ( ! is_array( $e ) || empty( $e['type'] ) ) {
					continue;
				}
				$one = array( 'type' => (string) $e['type'] );
				if ( ! empty( $e['text'] ) ) {
					$one['text'] = gogh_ab_words( $e['text'] );
				}
				if ( ! empty( $e['href'] ) ) {
					$one['link'] = esc_url_raw( (string) $e['href'] );
				}
				if ( ! empty( $e['alt'] ) ) {
					$one['picture'] = gogh_ab_words( $e['alt'], 120 );
				} elseif ( 'image' === $e['type'] ) {
					$one['picture'] = '';
				}
				if ( 'widget' === $e['type'] && ! empty( $e['shop'] ) ) {
					$one['type'] = ( isset( $e['shop']['kind'] ) && 'categories' === $e['shop']['kind'] ) ? 'shop categories' : 'product grid';
				} elseif ( 'widget' === $e['type'] && ! empty( $e['posts'] ) ) {
					$one['type'] = 'post grid';
				}
				if ( 'box' !== $e['type'] || isset( $one['text'] ) || isset( $one['link'] ) ) {
					$els[] = $one;
				}
				if ( ! empty( $e['kids'] ) && is_array( $e['kids'] ) ) {
					$walk( $e['kids'] );
				}
			}
		};
		$walk( $md['elements'] );
		$sec = array( 'pieces' => $els );
		if ( ! empty( $md['bg'] ) ) {
			$sec['background'] = (string) $md['bg'];
		}
		if ( ! empty( $md['theme'] ) ) {
			$sec['theme'] = (string) $md['theme'];
		}
		if ( ! empty( $md['bgImage'] ) ) {
			$sec['background_picture'] = esc_url_raw( (string) $md['bgImage'] );
		}
		$out[] = $sec;
	}
	return $out;
}

// the backup the editor keeps of changes that are not live yet: the
// newest autosave, when it is newer than the page and says something else
function gogh_ab_pending_backup( $post ) {
	$a = wp_get_post_autosave( $post->ID );
	if ( ! $a || strtotime( $a->post_modified_gmt ) <= strtotime( $post->post_modified_gmt ) ) {
		return null;
	}
	return trim( (string) $a->post_content ) !== trim( (string) $post->post_content ) ? $a : null;
}

// a slug from a stored preset reference, either form
function gogh_ab_slug( $v, $kind ) {
	return ( is_string( $v ) && preg_match( '/preset(?:\||--)' . preg_quote( $kind, '/' ) . '(?:\||--)([a-z0-9-]+)/', $v, $m ) ) ? $m[1] : '';
}

// the theme's looks, sorted into whole looks, colour sets and type pairs
function gogh_ab_looks() {
	$looks = array( 'whole' => array(), 'colours' => array(), 'fonts' => array() );
	if ( ! class_exists( 'WP_Theme_JSON_Resolver' ) ) {
		return $looks;
	}
	foreach ( WP_Theme_JSON_Resolver::get_style_variations() as $v ) {
		if ( empty( $v['title'] ) ) {
			continue;
		}
		$set    = isset( $v['settings'] ) && is_array( $v['settings'] ) ? $v['settings'] : array();
		$styles = isset( $v['styles'] ) && is_array( $v['styles'] ) ? $v['styles'] : array();
		$has_c  = ! empty( $set['color'] );
		$has_t  = ! empty( $set['typography'] ) || ! empty( $styles['typography'] );
		$kind   = ( $has_c && ! $has_t ) ? 'colours' : ( ( $has_t && ! $has_c ) ? 'fonts' : 'whole' );
		$looks[ $kind ][] = (string) $v['title'];
	}
	return $looks;
}

function gogh_ab_text_sizes() {
	return array( 'snug' => 90, 'regular' => 100, 'airy' => 110, 'grand' => 120 );
}

// ---------- the abilities ----------------------------------------------------

add_action( 'wp_abilities_api_categories_init', function () {
	if ( ! function_exists( 'wp_register_ability_category' ) ) {
		return;
	}
	wp_register_ability_category( 'gogh', array(
		'label'       => __( 'gogh site design', 'gogh-editor' ),
		'description' => __( 'Read a gogh site, change its colours, fonts and text size, stock its shop and publish its pages.', 'gogh-editor' ),
	) );
} );

add_action( 'wp_abilities_api_init', function () {
	if ( ! function_exists( 'wp_register_ability' ) ) {
		return;
	}
	$mcp = array( 'public' => true );

	wp_register_ability( 'gogh/describe-site', array(
		'label'               => __( 'Describe the site', 'gogh-editor' ),
		'description'         => __( 'The site\'s pages and what is on each one, section by section: headings, words, buttons and where they link, pictures, product and post grids. Says which page is the home page and which pages have changes that are not live yet. Read this before changing anything.', 'gogh-editor' ),
		'category'            => 'gogh',
		'input_schema'        => array(
			'type'                 => 'object',
			'properties'           => array(
				'page_id' => array( 'type' => 'integer', 'description' => 'Only this page. Leave out for every page.' ),
			),
			'additionalProperties' => false,
			'default'              => array(), // called with nothing: every page
		),
		'output_schema'       => array( 'type' => 'object' ),
		'execute_callback'    => function ( $input = null ) {
			$input = is_array( $input ) ? $input : array();
			$front = 'page' === get_option( 'show_on_front' ) ? (int) get_option( 'page_on_front' ) : 0;
			$args  = array( 'post_type' => 'page', 'post_status' => array( 'publish', 'draft', 'private' ), 'numberposts' => 60, 'orderby' => 'menu_order title', 'order' => 'ASC' );
			if ( ! empty( $input['page_id'] ) ) {
				$args['include'] = array( (int) $input['page_id'] );
			}
			$pages = array();
			foreach ( get_posts( $args ) as $p ) {
				if ( ! current_user_can( 'edit_post', $p->ID ) ) {
					continue;
				}
				$secs = gogh_ab_sections_of( $p->post_content );
				$one  = array(
					'id'     => (int) $p->ID,
					'title'  => html_entity_decode( get_the_title( $p ), ENT_QUOTES, 'UTF-8' ),
					'url'    => get_permalink( $p ),
					'status' => $p->post_status,
				);
				if ( $p->ID === $front ) {
					$one['home'] = true;
				}
				$wc = function_exists( 'wc_get_page_id' ) ? array_search( (int) $p->ID, array_map( 'intval', array( 'shop' => wc_get_page_id( 'shop' ), 'cart' => wc_get_page_id( 'cart' ), 'checkout' => wc_get_page_id( 'checkout' ), 'account' => wc_get_page_id( 'myaccount' ) ) ), true ) : false;
				if ( $wc ) {
					$one['woocommerce'] = $wc;
				}
				$one['made_with_gogh'] = (bool) $secs;
				if ( $secs ) {
					$one['sections'] = $secs;
				}
				if ( gogh_ab_pending_backup( $p ) ) {
					$one['unpublished_changes'] = true;
				}
				$pages[] = $one;
			}
			$site = array(
				'name'    => html_entity_decode( get_bloginfo( 'name' ), ENT_QUOTES, 'UTF-8' ),
				'tagline' => html_entity_decode( get_bloginfo( 'description' ), ENT_QUOTES, 'UTF-8' ),
				'url'     => home_url( '/' ),
				'theme'   => wp_get_theme()->get( 'Name' ),
			);
			if ( class_exists( 'WooCommerce' ) ) {
				$counts       = wp_count_posts( 'product' );
				$site['shop'] = array(
					'products'   => (int) ( isset( $counts->publish ) ? $counts->publish : 0 ),
					'categories' => array_values( array_map( function ( $t ) { return html_entity_decode( $t->name, ENT_QUOTES, 'UTF-8' ); }, (array) get_terms( array( 'taxonomy' => 'product_cat', 'hide_empty' => false, 'exclude' => array( (int) get_option( 'default_product_cat' ) ) ) ) ) ),
				);
			}
			return array( 'site' => $site, 'pages' => $pages );
		},
		'permission_callback' => function () {
			return current_user_can( 'edit_pages' );
		},
		'meta'                => array(
			'show_in_rest' => true,
			'annotations'  => array( 'readonly' => true, 'destructive' => false, 'idempotent' => true ),
			'mcp'          => $mcp,
		),
	) );

	wp_register_ability( 'gogh/design-map', array(
		'label'               => __( 'Read the design', 'gogh-editor' ),
		'description'         => __( 'The site\'s colours and what each is for (page background, words, links, headings, button fill and words), its fonts, its text size, the looks the theme offers (whole looks, colour sets, font pairs) and the owner\'s brief. Use the names here with gogh/apply-style.', 'gogh-editor' ),
		'category'            => 'gogh',
		'output_schema'       => array( 'type' => 'object' ),
		'execute_callback'    => function () {
			$gs   = function_exists( 'wp_get_global_styles' ) ? wp_get_global_styles() : array();
			$pick = function ( $path ) use ( $gs ) {
				$v = $gs;
				foreach ( $path as $k ) {
					if ( ! is_array( $v ) || ! isset( $v[ $k ] ) ) {
						return '';
					}
					$v = $v[ $k ];
				}
				return gogh_ab_slug( $v, 'color' );
			};
			$jobs = array(
				'page background' => $pick( array( 'color', 'background' ) ),
				'words'           => $pick( array( 'color', 'text' ) ),
				'links'           => $pick( array( 'elements', 'link', 'color', 'text' ) ),
				'headings'        => $pick( array( 'elements', 'heading', 'color', 'text' ) ),
				'button fill'     => $pick( array( 'elements', 'button', 'color', 'background' ) ),
				'button words'    => $pick( array( 'elements', 'button', 'color', 'text' ) ),
			);
			$colours = array();
			$pal     = wp_get_global_settings( array( 'color', 'palette' ) );
			foreach ( array( 'theme', 'custom' ) as $origin ) {
				foreach ( (array) ( isset( $pal[ $origin ] ) ? $pal[ $origin ] : array() ) as $p ) {
					if ( empty( $p['slug'] ) ) {
						continue;
					}
					$for = array_keys( $jobs, $p['slug'], true );
					$colours[ $p['slug'] ] = array( 'slug' => $p['slug'], 'name' => isset( $p['name'] ) ? $p['name'] : $p['slug'], 'colour' => isset( $p['color'] ) ? $p['color'] : '', 'used_for' => $for ? $for : array( 'free: sections, highlights' ) );
				}
			}
			$fonts = array();
			$fams  = wp_get_global_settings( array( 'typography', 'fontFamilies' ) );
			foreach ( array( 'theme', 'custom' ) as $origin ) {
				foreach ( (array) ( isset( $fams[ $origin ] ) ? $fams[ $origin ] : array() ) as $f ) {
					if ( ! empty( $f['slug'] ) ) {
						$fonts[ $f['slug'] ] = isset( $f['name'] ) ? $f['name'] : $f['slug'];
					}
				}
			}
			$body_font = isset( $gs['typography']['fontFamily'] ) ? gogh_ab_slug( $gs['typography']['fontFamily'], 'font-family' ) : '';
			$head_font = isset( $gs['elements']['heading']['typography']['fontFamily'] ) ? gogh_ab_slug( $gs['elements']['heading']['typography']['fontFamily'], 'font-family' ) : '';
			$scale     = (int) get_option( 'gogh_type_scale', 100 );
			$size_name = array_search( $scale, gogh_ab_text_sizes(), true );
			return array(
				'colours'      => array_values( $colours ),
				'fonts'        => array(
					'body'      => $body_font ? ( isset( $fonts[ $body_font ] ) ? $fonts[ $body_font ] : $body_font ) : '',
					// no font of their own: headings wear the body's
					'headings'  => $head_font ? ( isset( $fonts[ $head_font ] ) ? $fonts[ $head_font ] : $head_font ) : ( $body_font ? ( isset( $fonts[ $body_font ] ) ? $fonts[ $body_font ] : $body_font ) : '' ),
					'available' => array_values( $fonts ),
				),
				'text_size'    => $size_name ? $size_name : (string) $scale,
				'current_look' => (string) get_option( 'gogh_active_style', '' ),
				'looks'        => gogh_ab_looks(),
				'brief'        => (string) get_option( 'gogh_site_brief', '' ),
			);
		},
		'permission_callback' => function () {
			return current_user_can( 'edit_theme_options' );
		},
		'meta'                => array(
			'show_in_rest' => true,
			'annotations'  => array( 'readonly' => true, 'destructive' => false, 'idempotent' => true ),
			'mcp'          => $mcp,
		),
	) );

	wp_register_ability( 'gogh/set-brief', array(
		'label'               => __( 'Save the site\'s brief', 'gogh-editor' ),
		'description'         => __( 'Who the site is for, how it should sound and what to avoid, in the owner\'s words (up to 1500 characters). gogh\'s own assistant reads it before it writes anything. An empty brief clears it.', 'gogh-editor' ),
		'category'            => 'gogh',
		'input_schema'        => array(
			'type'                 => 'object',
			'properties'           => array( 'brief' => array( 'type' => 'string', 'maxLength' => 1500 ) ),
			'required'             => array( 'brief' ),
			'additionalProperties' => false,
		),
		'output_schema'       => array( 'type' => 'object' ),
		'execute_callback'    => function ( $input ) {
			$brief = trim( sanitize_textarea_field( mb_substr( (string) ( is_array( $input ) && isset( $input['brief'] ) ? $input['brief'] : '' ), 0, 1500 ) ) );
			if ( '' === $brief ) {
				delete_option( 'gogh_site_brief' );
			} else {
				update_option( 'gogh_site_brief', $brief, false );
			}
			return array( 'brief' => $brief );
		},
		'permission_callback' => function () {
			return current_user_can( 'edit_theme_options' );
		},
		'meta'                => array(
			'show_in_rest' => true,
			'annotations'  => array( 'readonly' => false, 'destructive' => false, 'idempotent' => true ),
			'mcp'          => $mcp,
		),
	) );

	wp_register_ability( 'gogh/apply-style', array(
		'label'               => __( 'Change the colours, fonts or text size', 'gogh-editor' ),
		'description'         => __( 'Puts on one of the theme\'s looks by name (a whole look, a colour set or a font pair, as listed by gogh/design-map) and/or sets the text size everywhere: snug, regular, airy or grand. The change is live straight away on every page.', 'gogh-editor' ),
		'category'            => 'gogh',
		'input_schema'        => array(
			'type'                 => 'object',
			'properties'           => array(
				'look'      => array( 'type' => 'string', 'description' => 'The name of a look, colour set or font pair from gogh/design-map.' ),
				'text_size' => array( 'type' => 'string', 'enum' => array_keys( gogh_ab_text_sizes() ) ),
			),
			'additionalProperties' => false,
		),
		'output_schema'       => array( 'type' => 'object' ),
		'execute_callback'    => function ( $input ) {
			$input = is_array( $input ) ? $input : array();
			$look  = isset( $input['look'] ) ? trim( (string) $input['look'] ) : '';
			$size  = isset( $input['text_size'] ) ? (string) $input['text_size'] : '';
			if ( '' === $look && '' === $size ) {
				return new WP_Error( 'gogh_nothing_to_do', __( 'Name a look or a text size.', 'gogh-editor' ), array( 'status' => 400 ) );
			}
			$done = array();
			if ( '' !== $look ) {
				$all   = gogh_ab_looks();
				$names = array_merge( $all['whole'], $all['colours'], $all['fonts'] );
				$match = '';
				foreach ( $names as $n ) {
					if ( 0 === strcasecmp( $n, $look ) ) {
						$match = $n;
					}
				}
				if ( '' === $match ) {
					return new WP_Error( 'gogh_unknown_look', sprintf( /* translators: %s: the looks the theme offers */ __( 'This theme has no look by that name. It offers: %s.', 'gogh-editor' ), implode( ', ', $names ) ), array( 'status' => 400 ) );
				}
				// a whole look replaces the last one; a colour set or a font
				// pair is worn over what the site has (the Site styles rows)
				$whole = in_array( $match, $all['whole'], true );
				gogh_starter_apply_styles( $whole ? array( 'variation' => $match ) : array( 'variations' => array( $match ) ) );
				if ( ! $whole ) {
					update_option( 'gogh_active_style', $match );
				}
				$done['look'] = $match;
			}
			// the next read in this request must see the new styles
			if ( class_exists( 'WP_Theme_JSON_Resolver' ) ) {
				WP_Theme_JSON_Resolver::clean_cached_data();
			}
			if ( function_exists( 'wp_clean_theme_json_cache' ) ) {
				wp_clean_theme_json_cache();
			}
			if ( '' !== $size ) {
				$sizes = gogh_ab_text_sizes();
				update_option( 'gogh_type_scale', $sizes[ $size ] );
				$done['text_size'] = $size;
			}
			return $done;
		},
		'permission_callback' => function () {
			return current_user_can( 'edit_theme_options' );
		},
		'meta'                => array(
			'show_in_rest' => true,
			'annotations'  => array( 'readonly' => false, 'destructive' => false, 'idempotent' => true ),
			'mcp'          => $mcp,
		),
	) );

	$product = array(
		'type'       => 'object',
		'properties' => array(
			'name'        => array( 'type' => 'string' ),
			'price'       => array( 'type' => 'number' ),
			'sale'        => array( 'type' => 'number' ),
			'category'    => array( 'type' => 'string', 'description' => 'A category slug.' ),
			'image'       => array( 'type' => 'string', 'description' => 'A picture address (https).' ),
			'short'       => array( 'type' => 'string', 'description' => 'One or two sentences.' ),
			'description' => array( 'type' => 'string' ),
			'attributes'  => array( 'type' => 'object', 'description' => 'attribute slug → list of term slugs, e.g. {"size": ["classic", "grand"]}' ),
			'variations'  => array( 'type' => 'array', 'items' => array( 'type' => 'object' ), 'description' => 'One per option: {"attributes": {"size": "grand"}, "price": 58}' ),
		),
		'required'   => array( 'name' ),
	);
	wp_register_ability( 'gogh/set-up-shop', array(
		'label'               => __( 'Stock the shop', 'gogh-editor' ),
		'description'         => __( 'Adds WooCommerce categories, attributes (sizes, colours) and products in one go, with prices, pictures from their addresses and options. A product whose name is already in the shop is left as it is. Needs WooCommerce.', 'gogh-editor' ),
		'category'            => 'gogh',
		'input_schema'        => array(
			'type'                 => 'object',
			'properties'           => array(
				'categories' => array( 'type' => 'array', 'items' => array(
					'type'       => 'object',
					'properties' => array( 'name' => array( 'type' => 'string' ), 'slug' => array( 'type' => 'string' ), 'image' => array( 'type' => 'string' ), 'description' => array( 'type' => 'string' ) ),
					'required'   => array( 'name' ),
				) ),
				'attributes' => array( 'type' => 'array', 'items' => array(
					'type'       => 'object',
					'properties' => array( 'name' => array( 'type' => 'string' ), 'slug' => array( 'type' => 'string' ), 'terms' => array( 'type' => 'array', 'items' => array( 'type' => 'string' ) ) ),
					'required'   => array( 'name' ),
				) ),
				'products'   => array( 'type' => 'array', 'items' => $product, 'maxItems' => 40 ),
			),
			'additionalProperties' => false,
		),
		'output_schema'       => array( 'type' => 'object' ),
		'execute_callback'    => function ( $input ) {
			if ( ! class_exists( 'WooCommerce' ) ) {
				return new WP_Error( 'gogh_no_shop', __( 'WooCommerce is not active on this site.', 'gogh-editor' ), array( 'status' => 400 ) );
			}
			$input  = is_array( $input ) ? $input : array();
			$before = (int) wp_count_posts( 'product' )->publish;
			$terms  = (int) wp_count_terms( array( 'taxonomy' => 'product_cat', 'hide_empty' => false ) );
			gogh_starter_apply_shop( '', array(
				'categories' => isset( $input['categories'] ) ? (array) $input['categories'] : array(),
				'attributes' => isset( $input['attributes'] ) ? (array) $input['attributes'] : array(),
				'products'   => isset( $input['products'] ) ? (array) $input['products'] : array(),
			) );
			wp_cache_delete( _count_posts_cache_key( 'product' ), 'counts' ); // wp_count_posts caches per request
			return array(
				'products_added'   => max( 0, (int) wp_count_posts( 'product' )->publish - $before ),
				'categories_added' => max( 0, (int) wp_count_terms( array( 'taxonomy' => 'product_cat', 'hide_empty' => false ) ) - $terms ),
				'shop'             => function_exists( 'wc_get_page_id' ) ? get_permalink( wc_get_page_id( 'shop' ) ) : '',
			);
		},
		'permission_callback' => function () {
			return current_user_can( 'manage_woocommerce' );
		},
		'meta'                => array(
			'show_in_rest' => true,
			'annotations'  => array( 'readonly' => false, 'destructive' => false, 'idempotent' => false ),
			'mcp'          => $mcp,
		),
	) );

	wp_register_ability( 'gogh/publish', array(
		'label'               => __( 'Publish a page', 'gogh-editor' ),
		'description'         => __( 'Makes one page\'s changes live: the changes made in the editor and not yet published (gogh/describe-site marks them unpublished_changes), and a draft page goes live. Ask the person first: visitors see the result at once.', 'gogh-editor' ),
		'category'            => 'gogh',
		'input_schema'        => array(
			'type'                 => 'object',
			'properties'           => array( 'page_id' => array( 'type' => 'integer' ) ),
			'required'             => array( 'page_id' ),
			'additionalProperties' => false,
		),
		'output_schema'       => array( 'type' => 'object' ),
		'execute_callback'    => function ( $input ) {
			$id   = is_array( $input ) && isset( $input['page_id'] ) ? (int) $input['page_id'] : 0;
			$post = $id ? get_post( $id ) : null;
			if ( ! $post || 'page' !== $post->post_type ) {
				return new WP_Error( 'gogh_no_page', __( 'There is no page with that id.', 'gogh-editor' ), array( 'status' => 404 ) );
			}
			$backup = gogh_ab_pending_backup( $post );
			// page_template '' leaves the page's template as it is: a template
			// the theme no longer has would otherwise fail the whole update
			$update = array( 'ID' => $id, 'page_template' => '' );
			if ( $backup ) {
				$update['post_content'] = wp_slash( $backup->post_content );
			}
			if ( 'publish' !== $post->post_status ) {
				$update['post_status'] = 'publish';
			}
			if ( 2 === count( $update ) ) {
				return array( 'published' => false, 'page' => get_permalink( $id ), 'note' => __( 'Nothing to publish: the page is live and matches the editor.', 'gogh-editor' ) );
			}
			$r = wp_update_post( $update, true );
			if ( is_wp_error( $r ) ) {
				return $r;
			}
			if ( $backup ) {
				wp_delete_post_revision( $backup->ID ); // live now: no backup to offer back
			}
			return array( 'published' => true, 'page' => get_permalink( $id ), 'changes' => (bool) $backup, 'went_live' => isset( $update['post_status'] ) );
		},
		'permission_callback' => function ( $input = null ) {
			$id = is_array( $input ) && isset( $input['page_id'] ) ? (int) $input['page_id'] : 0;
			return $id ? current_user_can( 'publish_pages' ) && current_user_can( 'edit_post', $id ) : current_user_can( 'publish_pages' );
		},
		'meta'                => array(
			'show_in_rest' => true,
			'annotations'  => array( 'readonly' => false, 'destructive' => false, 'idempotent' => true ),
			'mcp'          => $mcp,
		),
	) );
} );
