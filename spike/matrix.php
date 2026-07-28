<?php
/**
 * SPIKE matrix: does the attrs-as-truth format survive the real WordPress
 * save pipeline, for every kind of user, in both fallback variants?
 *
 * Run:  php spike/matrix.php            (variant A: no rebake)
 *       GOGH_REBAKE=1 php spike/matrix.php   (variant B: rebake on)
 *
 * Scenarios re-save the seed page's content through wp_update_post /
 * autosave / revision restore / duplicate as different users. KSES filters
 * attach automatically per user via kses_init on set_current_user, which is
 * the same mechanism multisite and DISALLOW_UNFILTERED_HTML environments
 * rely on — a user without unfiltered_html here is capability-identical to
 * a multisite admin or a hardened-host user.
 */

$_SERVER['HTTP_HOST']   = 'localhost';
$_SERVER['REQUEST_URI'] = '/';
require dirname( __DIR__, 4 ) . '/wp-load.php';
require_once ABSPATH . 'wp-admin/includes/post.php';
require_once ABSPATH . 'wp-admin/includes/user.php';

if ( getenv( 'GOGH_REBAKE' ) ) {
	add_filter( 'gogh_rebake_enabled', '__return_true' );
}
$variant = getenv( 'GOGH_REBAKE' ) ? 'B (rebake ON)' : 'A (no rebake)';

$seed_page = get_page_by_path( 'gogh-spike-matrix' );
if ( ! $seed_page ) {
	fwrite( STDERR, "seed page gogh-spike-matrix missing\n" );
	exit( 1 );
}
$seed = $seed_page->post_content;

// If variant B, pre-bake the seed the way a gogh publish would store it
if ( getenv( 'GOGH_REBAKE' ) ) {
	$data = gogh_rebake_post_data( array( 'post_content' => wp_slash( $seed ) ) );
	$seed = wp_unslash( $data['post_content'] );
}

// ---- users ----
$admin = 1;
$editor_id = username_exists( 'gogh_spike_editor' ) ?: wp_insert_user( array(
	'user_login' => 'gogh_spike_editor', 'user_pass' => wp_generate_password(), 'role' => 'editor',
) );
// a "filtered" editor: full editing rights, NO unfiltered_html — this is
// what every non-super-admin is on multisite, and everyone under
// DISALLOW_UNFILTERED_HTML
if ( ! get_role( 'gogh_filtered' ) ) {
	$caps = get_role( 'editor' )->capabilities;
	unset( $caps['unfiltered_html'] );
	add_role( 'gogh_filtered', 'Gogh Filtered Editor', $caps );
}
$filtered_id = username_exists( 'gogh_spike_filtered' ) ?: wp_insert_user( array(
	'user_login' => 'gogh_spike_filtered', 'user_pass' => wp_generate_password(), 'role' => 'gogh_filtered',
) );

function gogh_as( $user_id ) {
	wp_set_current_user( $user_id ); // kses_init re-evaluates filters per user
}

// ---- inspection ----
function gogh_inspect( $content ) {
	$blocks = parse_blocks( $content );
	$attrs_ok = false;
	foreach ( $blocks as $b ) {
		if ( 'gogh/section' === $b['blockName'] && ! empty( $b['attrs']['cssT'] ) && ! empty( $b['attrs']['model'] ) ) {
			$attrs_ok = true;
		}
	}
	$baked    = false !== strpos( $content, 'class="gogh-style"' );
	// corruption = css/json text VISIBLE to readers: outside style tags AND
	// outside block comments (attrs legitimately carry both)
	$no_style = preg_replace( '/<style[^>]*>.*?<\/style>/s', '', $content );
	$no_style = preg_replace( '/<!--.*?-->/s', '', $no_style );
	$splatter = false !== strpos( $no_style, 'display: grid' ) || false !== strpos( $no_style, '"version":' );
	return array( 'attrs' => $attrs_ok, 'baked' => $baked, 'splatter' => $splatter );
}

function gogh_render_checks( $content ) {
	$html  = do_blocks( $content );
	$style = false !== strpos( $html, 'class="gogh-style"' );
	$scoped = $style && false === strpos( $html, 'GOGHSCOPE' ) && preg_match( '/\.gogh-section\.gogh-sec-\d+/', $html );
	$model  = false !== strpos( $html, 'gogh-model' );
	return array( 'style' => $style, 'scoped' => (bool) $scoped, 'model_leak' => $model );
}

$rows = array();
function gogh_row( $name, $content ) {
	global $rows;
	$i = gogh_inspect( $content );
	$rows[] = array( $name, $i['attrs'] ? 'yes' : 'NO', $i['baked'] ? 'yes' : 'no', $i['splatter'] ? 'CORRUPT' : 'clean' );
	return $i;
}

function gogh_fresh_page( $seed, $as_user ) {
	gogh_as( 1 );
	$id = wp_insert_post( array( 'post_type' => 'page', 'post_status' => 'publish', 'post_title' => 'spike-tmp-' . wp_rand(), 'post_content' => wp_slash( $seed ) ) );
	gogh_as( $as_user );
	return $id;
}

echo "== gogh attrs-as-truth matrix — variant $variant ==\n\n";
gogh_row( 'seed (as stored)', $seed );

// 1. admin re-save
$id = gogh_fresh_page( $seed, $admin );
wp_update_post( array( 'ID' => $id, 'post_content' => wp_slash( $seed ) ) );
gogh_row( 'admin re-save', get_post( $id )->post_content );

// 2. single-site editor re-save (has unfiltered_html)
$id = gogh_fresh_page( $seed, $editor_id );
wp_update_post( array( 'ID' => $id, 'post_content' => wp_slash( $seed ) ) );
gogh_row( 'editor re-save (single-site)', get_post( $id )->post_content );

// 3. FILTERED user re-save (multisite admin / DISALLOW_UNFILTERED_HTML)
$id = gogh_fresh_page( $seed, $filtered_id );
wp_update_post( array( 'ID' => $id, 'post_content' => wp_slash( $seed ) ) );
$filtered_saved = get_post( $id )->post_content;
gogh_row( 'FILTERED re-save', $filtered_saved );

// 4. filtered save-of-a-filtered-save (does it stay stable?)
wp_update_post( array( 'ID' => $id, 'post_content' => wp_slash( $filtered_saved ) ) );
gogh_row( 'FILTERED second save', get_post( $id )->post_content );

// 5. autosave by filtered user
$id = gogh_fresh_page( $seed, $filtered_id );
$auto = wp_create_post_autosave( array( 'post_ID' => $id, 'post_content' => wp_slash( $seed ), 'post_type' => 'page', 'post_title' => 'a', 'post_excerpt' => '' ) );
$auto_post = is_wp_error( $auto ) ? null : get_post( $auto );
gogh_row( 'FILTERED autosave (the autosave row)', $auto_post ? $auto_post->post_content : '' );

// 6. revision restore by filtered user
$id = gogh_fresh_page( $seed, $admin );
wp_update_post( array( 'ID' => $id, 'post_content' => wp_slash( $seed . "\n<!-- rev2 -->" ) ) );
$revs = wp_get_post_revisions( $id );
$first = end( $revs );
gogh_as( $filtered_id );
if ( $first ) { wp_restore_post_revision( $first->ID ); }
gogh_row( 'FILTERED revision restore', get_post( $id )->post_content );

// 7. duplicate by filtered user
gogh_as( $filtered_id );
$dup = wp_insert_post( array( 'post_type' => 'page', 'post_status' => 'draft', 'post_title' => 'spike-dup', 'post_content' => wp_slash( $seed ) ) );
gogh_row( 'FILTERED duplicate (new post)', get_post( $dup )->post_content );

// ---- render checks on the filtered-saved content ----
gogh_as( $admin );
$r = gogh_render_checks( $filtered_saved );
echo "\nrender (plugin ACTIVE) of filtered-saved content:\n";
echo '  style emitted: ' . ( $r['style'] ? 'yes' : 'NO' ) . ' | scoped: ' . ( $r['scoped'] ? 'yes' : 'NO' ) . ' | model script leaked: ' . ( $r['model_leak'] ? 'YES' : 'no' ) . "\n";

// XSS probe: hostile cssT written by a filtered user must not reach markup
$evil = str_replace( '"cssT":"', '"cssT":"</style><script>alert(1)</script>', $seed );
$evil_html = do_blocks( $evil );
echo '  hostile cssT neutralised: ' . ( false === strpos( $evil_html, '<script>alert(1)</script>' ) ? 'yes' : 'NO — XSS!' ) . "\n";

// plugin INACTIVE: unregister and render the stored content raw
unregister_block_type( 'gogh/section' );
$off = do_blocks( $filtered_saved );
$off_style = false !== strpos( $off, 'class="gogh-style"' );
$no_style  = preg_replace( '/<style[^>]*>.*?<\/style>/s', '', $off );
$no_style  = preg_replace( '/<!--.*?-->/s', '', $no_style );
$off_splat = false !== strpos( $no_style, 'display: grid' ) || false !== strpos( $no_style, '"version":' );
echo "render (plugin INACTIVE) of filtered-saved content:\n";
echo '  baked style present: ' . ( $off_style ? 'yes (pixel-perfect)' : 'no (stacked fallback)' ) . ' | corruption: ' . ( $off_splat ? 'CORRUPT' : 'clean' ) . "\n";

// ---- table ----
echo "\n| scenario | attrs survive | baked style | content |\n|---|---|---|---|\n";
foreach ( $rows as $r2 ) {
	echo '| ' . implode( ' | ', $r2 ) . " |\n";
}

// cleanup temp pages
gogh_as( $admin );
foreach ( get_posts( array( 'post_type' => 'page', 's' => 'spike-tmp-', 'post_status' => 'any', 'numberposts' => 50 ) ) as $p ) {
	wp_delete_post( $p->ID, true );
}
if ( $dup ) { wp_delete_post( $dup, true ); }
echo "\n(temp pages cleaned)\n";
