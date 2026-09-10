# Generated facts appendix

Everything in this section is extracted mechanically from the Gogh source on every release. It is regenerated, never hand-edited. **Where this appendix conflicts with the prose above, this appendix is correct** — the prose may lag a release behind.

## Current release

- Plugin version: **0.99.459**
- Requires WordPress **6.5+**, PHP **7.4+**
- Text domain: `gogh-editor`
- readme.txt Stable tag: `0.26.0` · Tested up to: `7.0`
- Note: the readme Stable tag (`0.26.0`) does not match the plugin header version (`0.99.459`). Quote the plugin header version.

## Design constants

| Constant | Value |
|---|---|
| `TOL` | 8 |
| `MIN_H` | 560 |
| `PAD` | 72 |
| `SNAP` | 6 |
| `BASE` | 8 |
| `W` | 1200 |
| `autosave_interval_ms` | 15000 |
| `history_cap` | 60 |
| `mobile_breakpoint_px` | 700 |
| `min_resize_w` | 60 |
| `min_resize_h` | 32 |
| `section_min_h` | 160 |
| `section_max_h` | 4000 |
| `phone_preview_w` | 390 |
| `drag_threshold_px` | 4 |
| `rotation_snap_deg` | 15 |
| `rotation_magnet_deg` | 5 |
| `toast_ttl_ms` | 4500 |

## Section templates

Shown in the picker: **Hero**, **Cover**, **Big statement**, **Story**, **Numbers**, **Article**, **Featured product**, **Bestsellers**, **Editorial split**, **Columns of links**, **Featured and links**, **Picture doors**, **Categories in the menu**, **Featured product in the menu**, **Shop the look**, **New in**, **Sale**, **Categories**, **Feature cards**, **Pricing**, **Quote**, **Testimonials**, **Call to action**, **Get in touch**, **Profile card**, **Job card**, **Place card**, **Photo wall**, **Carousel**, **FAQ**, **Tabs**, **Gallery**, **Photo cards**, **Portfolio**, **Menu**, **Team**.

Non-starter (surfaced elsewhere): **Start from scratch**.

## Shapes and dividers

Shapes: `square` (Square), `rounded` (Rounded), `circle` (Circle), `pill` (Pill), `arch` (Arch), `tri` (Triangle), `diamond` (Diamond), `blob` (Blob).

Divider shapes (plus "None"): `curve` (Curve), `sweep` (Sweep), `dunes` (Dunes), `arch` (Arch), `sheet` (Sheet), `melt` (Melt), `mist` (Mist).

## Elements

Element types that survive a publish: `heading`, `para`, `button`, `image`, `video`, `badge`, `box`, `widget`, `exp`. Anything else added from the block editor is lost on the next Gogh publish.

"Add element" palette items: `badge`, `button`, `card`, `exp`, `form`, `heading`, `image`, `para`, `posts`, `products`, `video`, `write`.

## WebMCP tools

| Tool | Params | Required |
|---|---|---|
| `gogh_page_overview` | — | — |
| `gogh_list_layouts` | — | — |
| `gogh_add_section` | `layout` | `layout` |
| `gogh_paste_html` | `html` | `html` |
| `gogh_add_element` | `type`, `text`, `section` | `type` |
| `gogh_add_shape` | `shape`, `color`, `section` | `shape` |
| `gogh_set_section_background` | `section`, `color` | `section`, `color` |
| `gogh_edit_text` | `find`, `replace` | `find`, `replace` |
| `gogh_delete_section` | `section` | `section` |
| `gogh_publish` | — | — |

## `window.__gogh` members

`build`.

## WordPress surface

Block: `gogh/section` · v3 attributes: `css`, `model`, `scope`, `v`, `cssT`.

| Hook | Kind | Priority |
|---|---|---|
| `init` | action | 10 |
| `init` | action | 10 |
| `init` | action | 10 |
| `init` | action | 10 |
| `load-post-new.php` | action | 10 |
| `admin_menu` | action | 10 |
| `admin_bar_menu` | action | 10 |
| `get_edit_post_link` | filter | 10 |
| `page_row_actions` | filter | 10 |
| `post_row_actions` | filter | 10 |
| `template_redirect` | action | 10 |
| `wp_enqueue_scripts` | action | 10 |
| `init` | action | 10 |
| `body_class` | filter | 10 |
| `render_block_core/post-template` | filter | 10 |
| `body_class` | filter | 10 |
| `body_class` | filter | 10 |
| `init` | action | 10 |
| `init` | action | 10 |
| `manage_gogh_message_posts_columns` | filter | 10 |
| `manage_gogh_message_posts_custom_column` | action | 10 |
| `get_edit_post_link` | filter | 10 |
| `post_row_actions` | filter | 10 |
| `admin_menu` | action | 10 |
| `views_edit-gogh_message` | filter | 10 |
| `admin_post_gogh_messages_csv` | action | 10 |
| `admin_post_gogh_form_message` | action | 10 |
| `admin_post_nopriv_gogh_form_message` | action | 10 |
| `wp_enqueue_scripts` | action | 10 |
| `body_class` | filter | 10 |
| `render_block_core/navigation` | filter | 10 |
| `template_redirect` | action | 302 |
| `save_post_gogh_panel` | action | 10 |
| `render_block_core/navigation-link` | filter | 10 |
| `wp_trim_words` | filter | 10 |
| `render_block_data` | filter | 10 |
| `render_block_core/group` | filter | 10 |
| `pre_render_block` | filter | 1 |
| `render_block_woocommerce/product-collection` | filter | 10 |
| `render_block_woocommerce/product-collection` | filter | 10 |
| `wp_enqueue_scripts` | action | 10 |
| `init` | action | 10 |
| `body_class` | filter | 10 |
| `wp_enqueue_scripts` | action | 10 |
| `body_class` | filter | 10 |
| `wp_insert_post_empty_content` | filter | 10 |
| `trashed_post` | action | 10 |
| `init` | action | 10 |
| `rest_api_init` | action | 10 |
| `init` | action | 10 |
| `init` | action | 10 |
| `get_block_templates` | filter | 10 |
| `body_class` | filter | 10 |
| `admin_post_gogh_shop_layout` | action | 10 |
| `add_meta_boxes_product` | action | 10 |
| `admin_enqueue_scripts` | action | 10 |
| `admin_body_class` | filter | 10 |
| `enter_title_here` | filter | 10 |
| `admin_notices` | action | 10 |
| `admin_menu` | action | 1 |
| `admin_title` | filter | 10 |
| `admin_bar_menu` | action | 10 |
| `render_block_core/group` | filter | 10 |
| `admin_post_gogh_product_related` | action | 10 |
| `admin_post_gogh_product_layout_all` | action | 10 |
| `admin_post_gogh_blog_layout` | action | 10 |
| `admin_post_gogh_post_layout` | action | 10 |
| `admin_post_gogh_post_layout_all` | action | 10 |
| `get_post_metadata` | filter | 10 |
| `admin_post_gogh_product_layout` | action | 10 |
| `safe_style_css` | filter | 10 |
| `wp_kses_allowed_html` | filter | 10 |
| `get_block_templates` | filter | 10 |
| `rest_api_init` | action | 10 |
| `rest_api_init` | action | 10 |
| `rest_pre_insert_wp_template_part` | filter | 10 |
| `rest_pre_insert_wp_navigation` | filter | 10 |
| `init` | action | 10 |
| `upload_mimes` | filter | 10 |
| `wp_insert_post_data` | filter | 20 |
| `save_post` | action | 10 |
| `wp_head` | action | 10 |
| `wp_enqueue_scripts` | action | 10 |
| `wp_enqueue_scripts` | action | 10 |
| `rest_api_init` | action | 10 |
| `enqueue_block_assets` | action | 10 |
| `admin_bar_menu` | action | 10 |
| `admin_bar_menu` | action | 10 |
| `admin_bar_menu` | action | 10 |
| `wp_insert_post` | action | 10 |
| `block_editor_settings_all` | filter | 10 |

Filters exposed for third parties: `gogh_default_editor`, `gogh_claims_post`, `gogh_labs_ask`, `gogh_rebake_enabled`, `gogh_schema`, `gogh_schema_enabled`, `gogh_webmcp_enabled`, `gogh_convert_enabled`, `gogh_helper_url`.

REST routes registered: `gogh/v1/version`, `gogh/v1/starter`, `gogh/v1/type-scale`, `gogh/v1/blog-style`, `gogh/v1/motion`, `gogh/v1/ask`, `gogh/v1/imagine-exp`, `gogh/v1/ask-key`, `gogh/v1/menu-style`, `gogh/v1/first-minute`, `gogh/v1/ask-log`, `gogh/v1/active-style`, `wp/v2/gogh-product/(?P<id>\d+)`, `wp/v2/gogh-product/(?P<id>\d+)/autosaves`, `gogh/v1/pattern`, `gogh/v1/render`.

Core REST endpoints used by the editor: `wp/v2/blocks`, `wp/v2/posts`, `wp/v2/template-parts`.

Capability checks in PHP: `edit_posts`, `edit_post`, `edit_theme_options`, `edit_others_posts`, `edit_products`, `manage_options`, `upload_files`, `unfiltered_html`, `activate_plugins`, `install_plugins`, `manage_woocommerce`, `publish_pages`.

Query-string switches: `?gogh-edit`, `?gogh-ps`, `?gogh-test`.

## Exact UI labels (tooltips and button titles)

These are the real strings in the current build. Use them verbatim; never paraphrase a label.

- "' + d.label + '"
- "' + d.title.replace(/"
- "' + escAttr(e.alt || 'Video') + '"
- "' + escAttr(l.name) + '"
- "' + escAttr(o[2]) + '"
- "' + escAttr(t.name) + '"
- "' + hp[1] + ' — ' + hp[2] + ' units"
- "' + m[2] + '"
- "' + p.slug + '"
- "' + sh.label + '"
- "' + whereTip(it.where !== 'desktop', 'phone') + '"
- "' + whereTip(it.where !== 'phone', 'desktop') + '"
- "+ Link"
- "+ Page"
- "A card — drop pieces inside and they stay together, even on mobile"
- "A video — upload one, or paste a YouTube or Vimeo link"
- "AG"
- "Aa"
- "Add"
- "Add a category ↗"
- "Add a page to this menu"
- "Add a product ↗"
- "Add link"
- "Add something to this section"
- "Add to page"
- "Adjust spacing"
- "All options"
- "Apply"
- "As typed"
- "Auto"
- "Back"
- "Background & look"
- "Badge"
- "Bold"
- "Bring forward"
- "Browse them all →"
- "Button"
- "Cancel"
- "Card"
- "Close"
- "Copy machine version"
- "Copy style — then click other text to paint it"
- "Copy summary to share"
- "Create"
- "Custom colour"
- "Custom text colour"
- "Cycle theme font sizes"
- "Dark"
- "Delete (Del)"
- "Delete saved section"
- "Delivery & returns"
- "Desktop"
- "Desktop menu"
- "Discard changes"
- "Done"
- "Duplicate (or Alt-drag)"
- "Everything"
- "Experience"
- "Featured product"
- "Fill screen"
- "Fill the screen"
- "Fill the width — size the text to its box"
- "Find us"
- "Forget the key"
- "Form"
- "Get in touch"
- "Go"
- "Grid: show and snap"
- "Heading"
- "Help — ask gogh anything"
- "Home"
- "How Google and AI read this page"
- "Image"
- "Imagine"
- "Italic"
- "I’ll find my own way"
- "Journal"
- "Keep editing"
- "Keep this layout (updates every page)"
- "Keeps your changes on every page"
- "Left"
- "Light"
- "Link"
- "Link text (⌘K)"
- "Make it freeform"
- "Manage categories ↗"
- "Manage products"
- "Manage products ↗"
- "Manage this menu — reorder, nest, swap menus"
- "Most loved"
- "Move down"
- "Move down in the phone stack"
- "Move earlier"
- "Move later"
- "Move left"
- "Move right"
- "Move up"
- "Move up in the phone stack"
- "Move, duplicate, save, delete…"
- "My account"
- "Name, email and a message — straight into your own site, no plugin"
- "New in"
- "None"
- "On sale"
- "One product, hero-sized — a card with a real add-to-cart button"
- "Open interactive experience"
- "Open your products in WordPress"
- "Original"
- "Our story"
- "Outline"
- "Peek at pages"
- "Phone menu"
- "Phone — see and tune the mobile layout"
- "Posts"
- "Products"
- "Publish"
- "Publish & close"
- "Put it back"
- "Questions"
- "Redo (⇧⌘Z)"
- "Remove"
- "Remove from Your sections"
- "Remove from menu"
- "Remove image"
- "Remove link (keep the text)"
- "Remove poster"
- "Remove this ' + labels.one + '"
- "Remove this photo"
- "Remove this slide"
- "Remove video"
- "Right"
- "Roll another take of this design"
- "Save"
- "Save brand"
- "Save description"
- "See all →"
- "Send backward"
- "Shape"
- "Show the next layout"
- "Six looks derived from your brand — hover to wear one, tap Remix again for six more"
- "Solid"
- "Start writing — a reading column, cursor ready"
- "Switch design"
- "Switch it on"
- "Text"
- "Text alignment"
- "Text colour"
- "The gogh build this tab is running"
- "The header rides along as visitors scroll"
- "Theme default"
- "Try another"
- "UPPERCASE"
- "Undo"
- "Undo (⌘Z)"
- "Unwrap — back to freeform"
- "Updates every page"
- "Upload a self-contained HTML experience — it runs sandboxed"
- "Upload an .html file instead"
- "Use this design"
- "Use this layout"
- "Video"
- "Where this item shows"
- "Which take of this design is on the page"
- "Write"
- "Your latest posts, live"
- "Your latest products, live — prices and add to cart included"
- "ag"
- "get one here"
- "gogh help"
- "lowercase"
- "pick from the shelf"
- "re-centre"
- "×"
- "← All layouts"
- "↕ Spacing…"
- "▶ Auto-play"
- "⛶ Click to enlarge"
- "✦ Remix"
- "✨ Make draggable"
- "✨ Make it freeform"

## Exact toast and message copy

- "Added to the card — it moves and stacks with it now."
- "Back to freeform — drag it anywhere."
- "Backup restored — publish when ready."
- "Button updated."
- "Could not add that section."
- "Could not apply that style."
- "Could not delete that section."
- "Could not open the "
- "Could not open the layout panel."
- "Could not preview that layout — "
- "Could not rescale the type — "
- "Could not restore it."
- "Could not save that section."
- "Could not save the motion style."
- "Could not save the name — try again."
- "Could not save the page, so the "
- "Could not switch the "
- "Could not update the "
- "Editing the site "
- "Guard: "
- "Icon link updated."
- "Image swapped."
- "It has to show somewhere — remove it instead if you don’t want it."
- "Keep your changes with Done, or undo them with Cancel."
- "Kept — "
- "Link removed — the text stays."
- "Link updated."
- "Linked."
- "Logo set — your image now leads the header."
- "Logo size saved."
- "Made the card’s words readable on its background."
- "Mega menu removed — it is in the trash if you change your mind."
- "Menu order updated — every page gets it."
- "Menu switched — every page shows it."
- "Mobile menu: "
- "Name size saved."
- "Nothing to rearrange yet — add a couple of pieces first."
- "Out of the card — it’s its own piece again."
- "Publish failed: "
- "Publish your changes first — changing the page style reloads the page."
- "Removed from the card."
- "Saved — search results and AI answers now quote your words ✓"
- "Saving your page changes, then updating the "
- "Section moved."
- "Section removed — publish to make it real."
- "Site "
- "Site name restored — click it to rename."
- "Site name saved."
- "Style copied — click other text to paint it. Esc finishes."
- "That saved section can’t be read."
- "That section can’t move past other stored content yet."
- "That’s gogh. Everything else is just more of this."
- "The backup could not be read."
- "The description could not be saved — try again."
- "The name didn’t save — try again."
- "Theme style applied: "
- "This "
- "This header has no menu button to open."
- "This mega menu drops from “"
- "This page is “"
- "Unpublished page changes will be lost when the "
- "Upload failed — .html uploads need admin rights."
- "Uploading experience…"
- "Wrapped — the words flow around it now. Click the image to adjust."
- "Your site is now called “"
- "gogh backed up unpublished work from an earlier session."
- "gogh can’t safely swap this image."
- "gogh could not change the page style — "
- "gogh could not create that page."
- "gogh could not keep the menu style — "
- "gogh could not make a mega menu — "
- "gogh could not make a phone menu — "
- "gogh could not rename the site — that needs an admin login."
- "gogh could not save the menu — "
- "gogh could not save your brand — "
- "gogh could not set the logo — "
- "gogh could not switch back — "
- "gogh could not switch the design — "
- "gogh could not switch the menu — "
- "gogh couldn’t find that icon in the stored markup."
- "gogh couldn’t identify that icon."
- "gogh couldn’t restore it."
- "gogh couldn’t safely update this image in the saved markup."
- "gogh couldn’t save that menu order."
- "gogh found nothing it can edit in this section."
- "gogh helper: "
- "gogh: preview of “"
- "“"
- "✨ “"

## Test suite

`263` tests, run by appending `?gogh-test` to any Gogh page URL while logged in with edit rights on that page.

