<?php
/**
 * gogh's page abilities: read a page as sections and pieces, change words,
 * move and remove sections, preview and throw away changes — on the person's
 * real site, from an agent (James, 2026-10-19: "could someone use this on a
 * real site … change text, rearrange sections … all within Claude").
 *
 * The first abilities (gogh-abilities.php) describe and dress a site; these
 * change what is on a page, carefully:
 *
 * - A gogh section is one gogh/section block. Its model lists every piece
 *   (elements, in order), and piece N is drawn by the inner block wearing
 *   gogh-el-N. Changing words changes both, so the editor and the page agree.
 * - Changes are never live at once. They go into the page's autosave — the
 *   same "changes not published yet" the editor keeps and gogh/publish makes
 *   live — so the person can look first (gogh/preview-page) and throw them
 *   away (gogh/discard-changes).
 * - Drawing a NEW section needs gogh's layout code, which runs in a browser;
 *   that belongs to the page widget, not here.
 *
 * @package gogh
 */

defined( 'ABSPATH' ) || exit;

// ---------- helpers ---------------------------------------------------------

// the post lock and the autosave live with wp-admin; a REST call has neither
function gogh_pg_admin_post() {
	if ( ! function_exists( 'wp_check_post_lock' ) || ! function_exists( 'wp_create_post_autosave' ) ) {
		require_once ABSPATH . 'wp-admin/includes/post.php';
	}
}

// the page as it stands for the person: their pending changes if any, else
// what is live
function gogh_pg_current( $post ) {
	$pending = function_exists( 'gogh_ab_pending_backup' ) ? gogh_ab_pending_backup( $post ) : null;
	return $pending ? (string) $pending->post_content : (string) $post->post_content;
}

// the page's top-level blocks that are real (the parser's whitespace between
// blocks is not a section)
function gogh_pg_blocks( $content ) {
	return array_values( array_filter( parse_blocks( (string) $content ), function ( $b ) {
		return ! empty( $b['blockName'] ) || '' !== trim( (string) $b['innerHTML'] );
	} ) );
}

function gogh_pg_save_blocks( $blocks ) {
	return implode( "\n\n", array_map( 'serialize_block', $blocks ) );
}

// keep the change pending: a live page gets an autosave (what the editor's
// History and gogh/publish already treat as "not live yet"); a draft page
// is simply updated
function gogh_pg_keep( $post, $content ) {
	gogh_pg_admin_post();
	if ( 'publish' === $post->post_status || 'private' === $post->post_status ) {
		$r = wp_create_post_autosave( wp_slash( array(
			'post_ID'      => $post->ID,
			'post_title'   => $post->post_title,
			'post_excerpt' => $post->post_excerpt,
			'post_content' => $content,
		) ) );
		return is_wp_error( $r ) ? $r : true;
	}
	$r = wp_update_post( wp_slash( array( 'ID' => $post->ID, 'post_content' => $content, 'page_template' => '' ) ), true );
	return is_wp_error( $r ) ? $r : true;
}

function gogh_pg_page( $input ) {
	$id   = is_array( $input ) && isset( $input['page_id'] ) ? (int) $input['page_id'] : 0;
	$post = $id ? get_post( $id ) : null;
	if ( ! $post || 'page' !== $post->post_type ) {
		return new WP_Error( 'gogh_no_page', __( 'There is no page with that id.', 'gogh-editor' ), array( 'status' => 404 ) );
	}
	gogh_pg_admin_post();
	if ( wp_check_post_lock( $post->ID ) ) {
		$who = get_userdata( wp_check_post_lock( $post->ID ) );
		return new WP_Error( 'gogh_locked', sprintf(
			/* translators: %s: a person's name */
			__( '%s has this page open in the editor right now. Try again when they are done, so neither of you loses work.', 'gogh-editor' ),
			$who ? $who->display_name : __( 'Someone', 'gogh-editor' )
		), array( 'status' => 409 ) );
	}
	return $post;
}

// words a person may give a piece: plain words, line breaks, and the few
// inline marks gogh's own words carry
function gogh_pg_clean_words( $words ) {
	$w = str_replace( array( "\r\n", "\r" ), "\n", (string) $words );
	$w = wp_kses( $w, array( 'br' => array(), 'strong' => array(), 'em' => array(), 'b' => array(), 'i' => array(), 'a' => array( 'href' => true ) ) );
	return nl2br( trim( $w ), false );
}

// a piece's role in a section, as a person would name it
function gogh_pg_role( $e, $els ) {
	$t = isset( $e['type'] ) ? $e['type'] : '';
	if ( 'heading' === $t ) {
		return 'heading';
	}
	if ( 'button' === $t ) {
		return 'button';
	}
	if ( 'image' === $t ) {
		return 'picture';
	}
	if ( 'para' === $t ) {
		// an eyebrow is the short line above the heading
		$text = wp_strip_all_tags( isset( $e['text'] ) ? $e['text'] : '' );
		foreach ( $els as $h ) {
			if ( isset( $h['type'] ) && 'heading' === $h['type'] && isset( $h['y'], $e['y'] ) && $e['y'] < $h['y'] && mb_strlen( $text ) <= 60 ) {
				return 'eyebrow';
			}
		}
		return 'text';
	}
	if ( 'badge' === $t ) {
		return 'badge';
	}
	if ( 'widget' === $t ) {
		return ! empty( $e['cards'] ) ? 'cards' : ( ! empty( $e['posts'] ) ? 'post grid' : 'widget' );
	}
	return $t;
}

const GOGH_PG_WORDY = array( 'heading', 'para', 'button', 'badge' );

// a section written by gogh's own code in the page panel: exactly one
// gogh/section block, or nothing. (The content then goes through the same
// save path as the editor's, filters and all.)
function gogh_pg_one_section( $markup ) {
	$blocks = gogh_pg_blocks( (string) $markup );
	if ( 1 !== count( $blocks ) || 'gogh/section' !== $blocks[0]['blockName'] || empty( $blocks[0]['attrs']['model']['elements'] ) ) {
		return new WP_Error( 'gogh_not_a_section', __( 'That is not a gogh section. New sections come from the page panel.', 'gogh-editor' ), array( 'status' => 400 ) );
	}
	return $blocks[0];
}

// pictures a new section may wear: the media library's newest, then the
// ones the site's pages already use (a site built from a definition may
// have no library at all)
function gogh_pg_pictures() {
	$imgs = array();
	$bgs  = array();
	foreach ( get_posts( array( 'post_type' => 'attachment', 'post_mime_type' => 'image', 'numberposts' => 30, 'orderby' => 'date', 'order' => 'DESC' ) ) as $a ) {
		$u = wp_get_attachment_image_url( $a->ID, 'large' );
		if ( $u ) {
			$imgs[] = $u;
			$m = wp_get_attachment_metadata( $a->ID );
			if ( ! empty( $m['width'] ) && ! empty( $m['height'] ) && $m['width'] >= 1200 && $m['width'] > $m['height'] ) {
				$bgs[] = $u;
			}
		}
	}
	foreach ( get_posts( array( 'post_type' => 'page', 'post_status' => array( 'publish', 'draft' ), 'numberposts' => 30 ) ) as $p ) {
		if ( ! preg_match_all( '/"(?:src|bgImage|img)":"([^"]+\.(?:jpe?g|png|webp|avif))"/i', $p->post_content, $m ) ) {
			continue;
		}
		foreach ( $m[1] as $u ) {
			$u = str_replace( '\\/', '/', $u );
			if ( false === strpos( $u, 'demo-assets' ) ) {
				$imgs[] = $u;
				$bgs[]  = $u;
			}
		}
	}
	return array( 'imgs' => array_values( array_unique( $imgs ) ), 'bgs' => array_values( array_unique( $bgs ) ) );
}

// ---------- the abilities ---------------------------------------------------

add_action( 'wp_abilities_api_init', function () {
	if ( ! function_exists( 'wp_register_ability' ) ) {
		return;
	}
	$mcp  = array( 'public' => true );
	$page = array( 'type' => 'integer', 'description' => 'The page, by id (gogh/describe-site lists them).' );
	$sec  = array( 'type' => 'integer', 'description' => 'The section, counting from 1 at the top of the page.' );
	$can  = function ( $input = null ) {
		$id = is_array( $input ) && isset( $input['page_id'] ) ? (int) $input['page_id'] : 0;
		return $id ? current_user_can( 'edit_post', $id ) : current_user_can( 'edit_pages' );
	};

	wp_register_ability( 'gogh/read-page', array(
		'label'               => __( 'Read a page', 'gogh-editor' ),
		'description'         => __( 'One page, section by section, as it stands now (with any changes that are not live yet): each section\'s design, and its pieces numbered in order with their role (eyebrow, heading, text, button, picture, cards) and words. Use the section and piece numbers with gogh/change-words, gogh/move-section and gogh/remove-section.', 'gogh-editor' ),
		'category'            => 'gogh',
		'input_schema'        => array(
			'type'                 => 'object',
			'properties'           => array( 'page_id' => $page ),
			'required'             => array( 'page_id' ),
			'additionalProperties' => false,
		),
		'output_schema'       => array( 'type' => 'object' ),
		'execute_callback'    => function ( $input ) {
			$id   = (int) $input['page_id'];
			$post = get_post( $id );
			if ( ! $post || 'page' !== $post->post_type ) {
				return new WP_Error( 'gogh_no_page', __( 'There is no page with that id.', 'gogh-editor' ), array( 'status' => 404 ) );
			}
			$sections = array();
			foreach ( gogh_pg_blocks( gogh_pg_current( $post ) ) as $k => $b ) {
				$one = array( 'section' => $k + 1 );
				if ( 'gogh/section' !== $b['blockName'] ) {
					$one['kind']  = 'other';
					$one['block'] = $b['blockName'] ? $b['blockName'] : 'html';
					$one['words'] = gogh_ab_words( render_block( $b ), 160 );
					$sections[]   = $one;
					continue;
				}
				$md  = isset( $b['attrs']['model'] ) && is_array( $b['attrs']['model'] ) ? $b['attrs']['model'] : array();
				$els = isset( $md['elements'] ) && is_array( $md['elements'] ) ? $md['elements'] : array();
				if ( ! empty( $md['m']['tpl'] ) ) {
					$one['design'] = (string) $md['m']['tpl'];
					if ( ! empty( $md['m']['face'] ) ) {
						$one['design_take'] = (int) $md['m']['face'];
					}
				}
				if ( ! empty( $md['anchor'] ) ) {
					$one['anchor'] = (string) $md['anchor'];
				}
				if ( ! empty( $md['bgImage'] ) ) {
					$one['background_picture'] = (string) $md['bgImage'];
				}
				$pieces = array();
				foreach ( $els as $i => $e ) {
					if ( ! is_array( $e ) || empty( $e['type'] ) || ( 'box' === $e['type'] && empty( $e['kids'] ) && empty( $e['text'] ) ) ) {
						continue;
					}
					$p = array( 'piece' => $i + 1, 'role' => gogh_pg_role( $e, $els ) );
					if ( ! empty( $e['text'] ) ) {
						$p['words'] = gogh_ab_words( $e['text'], 600 );
					}
					if ( ! empty( $e['href'] ) ) {
						$p['link'] = (string) $e['href'];
					}
					if ( 'image' === $e['type'] ) {
						$p['picture'] = ! empty( $e['alt'] ) ? gogh_ab_words( $e['alt'], 120 ) : '';
						if ( ! empty( $e['src'] ) ) {
							$p['src'] = (string) $e['src'];
						}
					}
					if ( ! empty( $e['cards']['items'] ) && is_array( $e['cards']['items'] ) ) {
						$p['cards'] = array_map( function ( $it ) {
							$c = array();
							foreach ( array( 't' => 'title', 'd' => 'text', 'k' => 'eyebrow', 'role' => 'role', 'n' => 'name', 'price' => 'price', 'link' => 'button' ) as $from => $to ) {
								if ( ! empty( $it[ $from ] ) ) {
									$c[ $to ] = gogh_ab_words( $it[ $from ], 300 );
								}
							}
							if ( ! empty( $it['img'] ) ) {
								$c['src'] = (string) $it['img'];
							}
							return $c;
						}, $e['cards']['items'] );
					}
					$p['can_change_words'] = in_array( $e['type'], GOGH_PG_WORDY, true );
					$pieces[]              = $p;
				}
				$one['pieces'] = $pieces;
				$sections[]    = $one;
			}
			return array(
				'page'                => array( 'id' => $id, 'title' => html_entity_decode( get_the_title( $post ), ENT_QUOTES, 'UTF-8' ), 'url' => get_permalink( $post ), 'status' => $post->post_status ),
				'unpublished_changes' => (bool) gogh_ab_pending_backup( $post ),
				'sections'            => $sections,
			);
		},
		'permission_callback' => $can,
		'meta'                => array(
			'show_in_rest' => true,
			'annotations'  => array( 'readonly' => true, 'destructive' => false, 'idempotent' => true ),
			'mcp'          => $mcp,
		),
	) );

	wp_register_ability( 'gogh/change-words', array(
		'label'               => __( 'Change words', 'gogh-editor' ),
		'description'         => __( 'New words for one piece (a heading, a paragraph, an eyebrow, a button) on a page. Saved as a change that is not live yet: the person can look with gogh/preview-page, and gogh/publish makes it live. Keep the length close to the old words unless asked; a line break is a newline. Words inside a set of cards are not changed here yet.', 'gogh-editor' ),
		'category'            => 'gogh',
		'input_schema'        => array(
			'type'                 => 'object',
			'properties'           => array(
				'page_id' => $page,
				'section' => $sec,
				'piece'   => array( 'type' => 'integer', 'description' => 'The piece, by its number in gogh/read-page.' ),
				'words'   => array( 'type' => 'string', 'description' => 'The new words. Plain text; <strong>, <em> and <a href> are kept.' ),
			),
			'required'             => array( 'page_id', 'section', 'piece', 'words' ),
			'additionalProperties' => false,
		),
		'output_schema'       => array( 'type' => 'object' ),
		'execute_callback'    => function ( $input ) {
			$post = gogh_pg_page( $input );
			if ( is_wp_error( $post ) ) {
				return $post;
			}
			$blocks = gogh_pg_blocks( gogh_pg_current( $post ) );
			$k      = (int) $input['section'] - 1;
			$n      = (int) $input['piece'];
			if ( ! isset( $blocks[ $k ] ) || 'gogh/section' !== $blocks[ $k ]['blockName'] ) {
				return new WP_Error( 'gogh_no_section', __( 'That section is not a gogh section on this page. Read the page again for the numbers.', 'gogh-editor' ), array( 'status' => 400 ) );
			}
			$els = isset( $blocks[ $k ]['attrs']['model']['elements'] ) ? $blocks[ $k ]['attrs']['model']['elements'] : array();
			if ( ! isset( $els[ $n - 1 ] ) || ! in_array( $els[ $n - 1 ]['type'], GOGH_PG_WORDY, true ) ) {
				return new WP_Error( 'gogh_no_words', __( 'That piece has no words to change here. Read the page again for the numbers.', 'gogh-editor' ), array( 'status' => 400 ) );
			}
			$words = gogh_pg_clean_words( $input['words'] );
			if ( '' === trim( wp_strip_all_tags( $words ) ) ) {
				return new WP_Error( 'gogh_empty', __( 'A piece needs some words. To take a piece away, use the editor.', 'gogh-editor' ), array( 'status' => 400 ) );
			}
			$old   = $els[ $n - 1 ]['text'];
			$class = 'gogh-el-' . $n;
			$done  = false;
			foreach ( $blocks[ $k ]['innerBlocks'] as $j => $ib ) {
				if ( ! preg_match( '/class="[^"]*\b' . preg_quote( $class, '/' ) . '\b/', (string) $ib['innerHTML'] ) ) {
					continue;
				}
				if ( 'core/buttons' === $ib['blockName'] && ! empty( $ib['innerBlocks'][0] ) ) {
					$btn  = $ib['innerBlocks'][0];
					$html = preg_replace( '/(<a\b[^>]*wp-block-button__link[^>]*>)(.*?)(<\/a>)/s', '$1' . str_replace( array( '\\', '$' ), array( '\\\\', '\\$' ), $words ) . '$3', (string) $btn['innerHTML'], 1, $c );
					if ( $c ) {
						$btn['innerHTML']    = $html;
						$btn['innerContent'] = array( $html );
						$blocks[ $k ]['innerBlocks'][ $j ]['innerBlocks'][0] = $btn;
						$done = true;
					}
				} else {
					$html = preg_replace( '/^(\s*<(p|h[1-6]|span|div)\b[^>]*>)(.*)(<\/\2>\s*)$/s', '$1' . str_replace( array( '\\', '$' ), array( '\\\\', '\\$' ), $words ) . '$4', (string) $ib['innerHTML'], 1, $c );
					if ( $c ) {
						$blocks[ $k ]['innerBlocks'][ $j ]['innerHTML']    = $html;
						$blocks[ $k ]['innerBlocks'][ $j ]['innerContent'] = array( $html );
						$done = true;
					}
				}
				break;
			}
			if ( ! $done ) {
				return new WP_Error( 'gogh_not_drawn', __( 'That piece is not drawn the way gogh expects, so its words were left alone. Change them in the editor.', 'gogh-editor' ), array( 'status' => 409 ) );
			}
			$blocks[ $k ]['attrs']['model']['elements'][ $n - 1 ]['text'] = $words;
			$r = gogh_pg_keep( $post, gogh_pg_save_blocks( $blocks ) );
			if ( is_wp_error( $r ) ) {
				return $r;
			}
			return array( 'changed' => true, 'was' => gogh_ab_words( $old, 300 ), 'now' => gogh_ab_words( $words, 300 ), 'live' => false, 'note' => __( 'Saved, not live yet. gogh/publish makes it live.', 'gogh-editor' ) );
		},
		'permission_callback' => $can,
		'meta'                => array(
			'show_in_rest' => true,
			'annotations'  => array( 'readonly' => false, 'destructive' => false, 'idempotent' => true ),
			'mcp'          => $mcp,
		),
	) );

	wp_register_ability( 'gogh/move-section', array(
		'label'               => __( 'Move a section', 'gogh-editor' ),
		'description'         => __( 'Moves one section of a page to a new place, counting from 1 at the top. Saved as a change that is not live yet.', 'gogh-editor' ),
		'category'            => 'gogh',
		'input_schema'        => array(
			'type'                 => 'object',
			'properties'           => array(
				'page_id' => $page,
				'section' => $sec,
				'to'      => array( 'type' => 'integer', 'description' => 'Where it should end up, counting from 1 at the top.' ),
			),
			'required'             => array( 'page_id', 'section', 'to' ),
			'additionalProperties' => false,
		),
		'output_schema'       => array( 'type' => 'object' ),
		'execute_callback'    => function ( $input ) {
			$post = gogh_pg_page( $input );
			if ( is_wp_error( $post ) ) {
				return $post;
			}
			$blocks = gogh_pg_blocks( gogh_pg_current( $post ) );
			$from   = (int) $input['section'] - 1;
			$to     = max( 0, min( count( $blocks ) - 1, (int) $input['to'] - 1 ) );
			if ( ! isset( $blocks[ $from ] ) ) {
				return new WP_Error( 'gogh_no_section', __( 'There is no section with that number on this page.', 'gogh-editor' ), array( 'status' => 400 ) );
			}
			if ( $from === $to ) {
				return array( 'moved' => false, 'note' => __( 'It is already there.', 'gogh-editor' ) );
			}
			$one = array_splice( $blocks, $from, 1 );
			array_splice( $blocks, $to, 0, $one );
			$r = gogh_pg_keep( $post, gogh_pg_save_blocks( $blocks ) );
			return is_wp_error( $r ) ? $r : array( 'moved' => true, 'section' => $to + 1, 'live' => false, 'note' => __( 'Saved, not live yet. Section numbers have changed: read the page again before the next change.', 'gogh-editor' ) );
		},
		'permission_callback' => $can,
		'meta'                => array(
			'show_in_rest' => true,
			'annotations'  => array( 'readonly' => false, 'destructive' => false, 'idempotent' => false ),
			'mcp'          => $mcp,
		),
	) );

	wp_register_ability( 'gogh/remove-section', array(
		'label'               => __( 'Remove a section', 'gogh-editor' ),
		'description'         => __( 'Takes one section off a page. Saved as a change that is not live yet, so gogh/discard-changes brings it back until it is published. Say which section it is (its heading) and ask before removing.', 'gogh-editor' ),
		'category'            => 'gogh',
		'input_schema'        => array(
			'type'                 => 'object',
			'properties'           => array( 'page_id' => $page, 'section' => $sec ),
			'required'             => array( 'page_id', 'section' ),
			'additionalProperties' => false,
		),
		'output_schema'       => array( 'type' => 'object' ),
		'execute_callback'    => function ( $input ) {
			$post = gogh_pg_page( $input );
			if ( is_wp_error( $post ) ) {
				return $post;
			}
			$blocks = gogh_pg_blocks( gogh_pg_current( $post ) );
			$k      = (int) $input['section'] - 1;
			if ( ! isset( $blocks[ $k ] ) ) {
				return new WP_Error( 'gogh_no_section', __( 'There is no section with that number on this page.', 'gogh-editor' ), array( 'status' => 400 ) );
			}
			if ( 1 === count( $blocks ) ) {
				return new WP_Error( 'gogh_last', __( 'That is the only section on the page. A page keeps at least one.', 'gogh-editor' ), array( 'status' => 400 ) );
			}
			array_splice( $blocks, $k, 1 );
			$r = gogh_pg_keep( $post, gogh_pg_save_blocks( $blocks ) );
			return is_wp_error( $r ) ? $r : array( 'removed' => true, 'live' => false, 'note' => __( 'Saved, not live yet. gogh/discard-changes brings it back; section numbers have changed.', 'gogh-editor' ) );
		},
		'permission_callback' => $can,
		'meta'                => array(
			'show_in_rest' => true,
			'annotations'  => array( 'readonly' => false, 'destructive' => true, 'idempotent' => false ),
			'mcp'          => $mcp,
		),
	) );

	$section_markup = array( 'type' => 'string', 'description' => 'The section\'s blocks, as written by gogh\'s page panel.' );

	wp_register_ability( 'gogh/add-section', array(
		'label'               => __( 'Add a section', 'gogh-editor' ),
		'description'         => __( 'Puts a new section, drawn by gogh\'s page panel from one of its designs, onto a page. Saved as a change that is not live yet.', 'gogh-editor' ),
		'category'            => 'gogh',
		'input_schema'        => array(
			'type'                 => 'object',
			'properties'           => array(
				'page_id' => $page,
				'at'      => array( 'type' => 'integer', 'description' => 'Where it goes, counting from 1 at the top. Leave out for the end of the page.' ),
				'blocks'  => $section_markup,
			),
			'required'             => array( 'page_id', 'blocks' ),
			'additionalProperties' => false,
		),
		'output_schema'       => array( 'type' => 'object' ),
		'execute_callback'    => function ( $input ) {
			$post = gogh_pg_page( $input );
			if ( is_wp_error( $post ) ) {
				return $post;
			}
			$one = gogh_pg_one_section( $input['blocks'] );
			if ( is_wp_error( $one ) ) {
				return $one;
			}
			$blocks = gogh_pg_blocks( gogh_pg_current( $post ) );
			$at     = isset( $input['at'] ) ? max( 0, min( count( $blocks ), (int) $input['at'] - 1 ) ) : count( $blocks );
			array_splice( $blocks, $at, 0, array( $one ) );
			$r = gogh_pg_keep( $post, gogh_pg_save_blocks( $blocks ) );
			return is_wp_error( $r ) ? $r : array( 'added' => true, 'section' => $at + 1, 'live' => false );
		},
		'permission_callback' => $can,
		'meta'                => array(
			'show_in_rest' => true,
			'annotations'  => array( 'readonly' => false, 'destructive' => false, 'idempotent' => false ),
			'mcp'          => array( 'public' => true, 'app_only' => true ),
		),
	) );

	wp_register_ability( 'gogh/replace-section', array(
		'label'               => __( 'Change a section\'s design', 'gogh-editor' ),
		'description'         => __( 'Swaps one section for the same words in another of gogh\'s designs, drawn by the page panel. Saved as a change that is not live yet.', 'gogh-editor' ),
		'category'            => 'gogh',
		'input_schema'        => array(
			'type'                 => 'object',
			'properties'           => array( 'page_id' => $page, 'section' => $sec, 'blocks' => $section_markup ),
			'required'             => array( 'page_id', 'section', 'blocks' ),
			'additionalProperties' => false,
		),
		'output_schema'       => array( 'type' => 'object' ),
		'execute_callback'    => function ( $input ) {
			$post = gogh_pg_page( $input );
			if ( is_wp_error( $post ) ) {
				return $post;
			}
			$one = gogh_pg_one_section( $input['blocks'] );
			if ( is_wp_error( $one ) ) {
				return $one;
			}
			$blocks = gogh_pg_blocks( gogh_pg_current( $post ) );
			$k      = (int) $input['section'] - 1;
			if ( ! isset( $blocks[ $k ] ) ) {
				return new WP_Error( 'gogh_no_section', __( 'There is no section with that number on this page.', 'gogh-editor' ), array( 'status' => 400 ) );
			}
			// the section keeps its place in a one-page menu
			if ( ! empty( $blocks[ $k ]['attrs']['model']['anchor'] ) && empty( $one['attrs']['model']['anchor'] ) ) {
				$one['attrs']['model']['anchor'] = $blocks[ $k ]['attrs']['model']['anchor'];
			}
			$blocks[ $k ] = $one;
			$r = gogh_pg_keep( $post, gogh_pg_save_blocks( $blocks ) );
			return is_wp_error( $r ) ? $r : array( 'changed' => true, 'live' => false );
		},
		'permission_callback' => $can,
		'meta'                => array(
			'show_in_rest' => true,
			'annotations'  => array( 'readonly' => false, 'destructive' => false, 'idempotent' => true ),
			'mcp'          => array( 'public' => true, 'app_only' => true ),
		),
	) );

	wp_register_ability( 'gogh/discard-changes', array(
		'label'               => __( 'Throw away changes', 'gogh-editor' ),
		'description'         => __( 'Throws away a page\'s changes that are not live yet, so it is exactly as visitors see it. Ask first.', 'gogh-editor' ),
		'category'            => 'gogh',
		'input_schema'        => array(
			'type'                 => 'object',
			'properties'           => array( 'page_id' => $page ),
			'required'             => array( 'page_id' ),
			'additionalProperties' => false,
		),
		'output_schema'       => array( 'type' => 'object' ),
		'execute_callback'    => function ( $input ) {
			$post = gogh_pg_page( $input );
			if ( is_wp_error( $post ) ) {
				return $post;
			}
			$pending = gogh_ab_pending_backup( $post );
			if ( ! $pending ) {
				return array( 'discarded' => false, 'note' => __( 'There were no changes waiting.', 'gogh-editor' ) );
			}
			wp_delete_post_revision( $pending->ID );
			return array( 'discarded' => true );
		},
		'permission_callback' => $can,
		'meta'                => array(
			'show_in_rest' => true,
			'annotations'  => array( 'readonly' => false, 'destructive' => true, 'idempotent' => true ),
			'mcp'          => $mcp,
		),
	) );

	wp_register_ability( 'gogh/preview-page', array(
		'label'               => __( 'Preview a page', 'gogh-editor' ),
		'description'         => __( 'A link that shows the page with its changes that are not live yet, for the person to look at before publishing. It works for two hours, for anyone who has it.', 'gogh-editor' ),
		'category'            => 'gogh',
		'input_schema'        => array(
			'type'                 => 'object',
			'properties'           => array( 'page_id' => $page ),
			'required'             => array( 'page_id' ),
			'additionalProperties' => false,
		),
		'output_schema'       => array( 'type' => 'object' ),
		'execute_callback'    => function ( $input ) {
			$id   = (int) $input['page_id'];
			$post = get_post( $id );
			if ( ! $post || 'page' !== $post->post_type ) {
				return new WP_Error( 'gogh_no_page', __( 'There is no page with that id.', 'gogh-editor' ), array( 'status' => 404 ) );
			}
			$token = wp_generate_password( 24, false );
			set_transient( 'gogh_pv_' . $token, $id, 2 * HOUR_IN_SECONDS );
			return array( 'preview' => add_query_arg( 'gogh-preview', $token, get_permalink( $id ) ), 'unpublished_changes' => (bool) gogh_ab_pending_backup( $post ) );
		},
		'permission_callback' => $can,
		'meta'                => array(
			'show_in_rest' => true,
			'annotations'  => array( 'readonly' => true, 'destructive' => false, 'idempotent' => false ),
			'mcp'          => $mcp,
		),
	) );
} );

// a preview link shows the page with its pending changes, to anyone holding
// the token, for two hours — nothing else about the site changes
add_filter( 'the_posts', function ( $posts, $q ) {
	if ( is_admin() || empty( $_GET['gogh-preview'] ) || ! $q->is_main_query() || 1 !== count( $posts ) ) {
		return $posts;
	}
	$token = preg_replace( '/[^A-Za-z0-9]/', '', (string) wp_unslash( $_GET['gogh-preview'] ) );
	$id    = $token ? (int) get_transient( 'gogh_pv_' . $token ) : 0;
	if ( ! $id || (int) $posts[0]->ID !== $id || ! function_exists( 'gogh_ab_pending_backup' ) ) {
		return $posts;
	}
	$pending = gogh_ab_pending_backup( $posts[0] );
	$content = $pending ? $pending->post_content : $posts[0]->post_content;
	// the page widget needs to know which drawn part is which section: a
	// marker comment before each top-level block (comments draw nothing)
	if ( ! empty( $_GET['gogh-widget'] ) ) {
		$parts = array();
		foreach ( gogh_pg_blocks( $content ) as $k => $b ) {
			$parts[] = '<!--gogh-sec:' . ( $k + 1 ) . '-->' . "\n" . serialize_block( $b );
		}
		$content = implode( "\n\n", $parts ) . "\n<!--gogh-sec:end-->";
	}
	$posts[0]               = clone $posts[0];
	$posts[0]->post_content = $content;
	if ( ! headers_sent() ) {
		nocache_headers();
		header( 'X-Robots-Tag: noindex' );
		// the page widget fetches this from inside the chat's sandbox
		header( 'Access-Control-Allow-Origin: *' );
	}
	return $posts;
}, 10, 2 );

// the page widget draws the preview inside the chat's sandbox, where a font
// only loads if its server says it may (CORS) — and plain font files do
// not. So in a widget preview, fonts are served through this route
add_action( 'init', function () {
	if ( empty( $_GET['gogh-font'] ) ) {
		return;
	}
	$rel  = ltrim( str_replace( array( '..', '\\' ), '', (string) wp_unslash( $_GET['gogh-font'] ) ), '/' );
	$file = realpath( ABSPATH . $rel );
	$root = realpath( WP_CONTENT_DIR );
	$type = array( 'woff2' => 'font/woff2', 'woff' => 'font/woff', 'ttf' => 'font/ttf', 'otf' => 'font/otf' );
	$ext  = strtolower( pathinfo( (string) $file, PATHINFO_EXTENSION ) );
	if ( ! $file || ! $root || 0 !== strpos( $file, $root . DIRECTORY_SEPARATOR ) || ! isset( $type[ $ext ] ) || ! is_readable( $file ) ) {
		status_header( 404 );
		exit;
	}
	header( 'Content-Type: ' . $type[ $ext ] );
	header( 'Access-Control-Allow-Origin: *' );
	header( 'Cache-Control: public, max-age=86400' );
	header( 'Content-Length: ' . filesize( $file ) );
	readfile( $file );
	exit;
}, 0 );

// a widget preview's fonts point at that route
add_action( 'template_redirect', function () {
	if ( ( empty( $_GET['gogh-preview'] ) || empty( $_GET['gogh-widget'] ) ) && empty( $_GET['gogh-editor'] ) ) {
		return;
	}
	ob_start( function ( $html ) {
		$home = untrailingslashit( home_url() );
		$host = preg_replace( '~^https?://~', '', $home );
		$out = preg_replace_callback( '~url\\(\\s*([\'"]?)((?:https?://' . preg_quote( $host, '~' ) . ')?/(wp-content/[^\'")\\s?#]+\\.(?:woff2?|ttf|otf)))[^\'")]*\\1\\s*\\)~i', function ( $m ) use ( $home ) {
			return 'url(' . $m[1] . $home . '/?gogh-font=' . rawurlencode( $m[3] ) . $m[1] . ')';
		}, $html );
		if ( null !== $out ) {
			// the page's font preload hints point at the same files
			$pre = preg_replace_callback( '~(<link\\b[^>]*\\bhref=)([\'"])(?:https?://' . preg_quote( $host, '~' ) . ')?/(wp-content/[^\'"?#]+\\.(?:woff2?|ttf|otf))\\2~i', function ( $m ) use ( $home ) {
				return $m[1] . $m[2] . $home . '/?gogh-font=' . rawurlencode( $m[3] ) . $m[2];
			}, $out );
			$out = null === $pre ? $out : $pre;
		}
		return null === $out ? $html : $out; // never lose the page to a pattern
	} );
} );

// a preview reached through another address (a tunnel, a proxy) stays
// there: WordPress would otherwise send it to the site's own address
add_filter( 'redirect_canonical', function ( $to ) {
	return empty( $_GET['gogh-preview'] ) ? $to : false;
} );
