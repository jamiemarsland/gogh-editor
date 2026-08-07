# Generated facts appendix

Everything in this section is extracted mechanically from the Gogh source on every release. It is regenerated, never hand-edited. **Where this appendix conflicts with the prose above, this appendix is correct** — the prose may lag a release behind.

## Current release

- Plugin version: **0.96.5**
- Requires WordPress **6.5+**, PHP **7.4+**
- Text domain: `gogh-editor`
- readme.txt Stable tag: `0.26.0` · Tested up to: `7.0`
- Note: the readme Stable tag (`0.26.0`) does not match the plugin header version (`0.96.5`). Quote the plugin header version.

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
| `mirror_width_px` | 250 |
| `mirror_design_px` | 360 |
| `drag_threshold_px` | 4 |
| `rotation_snap_deg` | 15 |
| `rotation_magnet_deg` | 5 |
| `toast_ttl_ms` | 4500 |

## Section templates

Shown in the picker: **Hero**, **Feature cards**, **Big statement**, **Quote**, **Call to action**, **Article**, **Photo cards**, **Gallery**, **Get in touch**.

Non-starter (surfaced elsewhere): **Start from scratch**.

Retired — never shown, do not mention: Hero, Hero — centered, Split, Features, Call to action, Feature cards (classic).

## Shapes and dividers

Shapes: `square` (Square), `rounded` (Rounded), `circle` (Circle), `pill` (Pill), `arch` (Arch), `tri` (Triangle), `diamond` (Diamond), `blob` (Blob).

Divider shapes (plus "None"): `wave` (Wave), `curve` (Curve), `slant` (Slant), `peaks` (Peaks), `brush` (Brush), `torn` (Torn), `melt` (Melt).

## Elements

Element types that survive a publish: `heading`, `para`, `button`, `image`, `badge`, `box`, `widget`, `exp`. Anything else added from the block editor is lost on the next Gogh publish.

"Add element" palette items: `badge`, `button`, `card`, `exp`, `heading`, `image`, `para`, `posts`, `write`.

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

`mirror`, `explode`, `multi`, `zoom`, `reorderSection`, `reorderNavRaw`, `stickyRawToggle`, `insertGoghPattern`, `addHtmlSection`, `startChromeCycle`, `openPicker`, `navLinkMarkup`, `chromeEdits`, `bindChromeTest`, `pending`, `storedEdits`, `previewVariation`, `clearVariationPreview`, `initStoredEdits`, `bindStoredTest`, `sections`, `showHbar`, `openShapePanel`, `openSecBgPanel`, `scan`, `addSection`, `renderSection`, `pushState`, `templates`, `resolveAll`, `reflowPush`, `measure`, `resolve`, `serialize`, `syncModelFromMarkup`, `cleanInline`, `showTip`, `applyTextLink`, `readingOrder`, `toast`, `publish`, `isDirty`, `parseTopBlocks`, `convertBlock`, `convertChrome`, `restore`, `setEditing`, `deleteSection`, `moveSection`, `duplicateSection`, `openSide`, `closeSide`, `fontSizes`, `setFontSize`, `stepFontSize`, `setSecBg`, `buildBlocks`, `buildV3`, `mergeContent`, `closePanel`, `addElementAt`, `addShape`, `shapeDefs`, `resequenceToDom`, `gatherRawUnits`, `parseNavModel`, `serializeNavModel`, `sanitizePastedHtml`, `openPageStylePanel`, `openMenuManager`, `build`.

## WordPress surface

Block: `gogh/section` · v3 attributes: `css`, `model`, `scope`, `v`, `cssT`.

| Hook | Kind | Priority |
|---|---|---|
| `init` | action | 10 |
| `init` | action | 10 |
| `upload_mimes` | filter | 10 |
| `wp_insert_post_data` | filter | 20 |
| `wp_enqueue_scripts` | action | 10 |
| `rest_api_init` | action | 10 |
| `enqueue_block_assets` | action | 10 |
| `admin_bar_menu` | action | 10 |
| `block_editor_settings_all` | filter | 10 |

Filters exposed for third parties: `gogh_rebake_enabled`, `gogh_webmcp_enabled`, `gogh_convert_enabled`.

REST routes registered: `gogh/v1/render`.

Core REST endpoints used by the editor: `wp/v2/blocks`, `wp/v2/posts`, `wp/v2/template-parts`.

Capability checks in PHP: `unfiltered_html`, `edit_post`, `upload_files`, `edit_theme_options`, `edit_posts`.

Query-string switches: `?gogh-convert`, `?gogh-edit`, `?gogh-ps`, `?gogh-test`.

## Exact UI labels (tooltips and button titles)

These are the real strings in the current build. Use them verbatim; never paraphrase a label.

- "' + d.label + '"
- "' + p.slug + '"
- "' + sh.label + '"
- "A card — drop elements inside and they stay together, even on mobile"
- "Add a page to this menu"
- "All options"
- "Back to the palette"
- "Background image"
- "Bring forward"
- "Close"
- "Cycle theme font sizes"
- "Delete (Del)"
- "Delete saved section"
- "Delete section"
- "Duplicate (or Alt-drag)"
- "Duplicate section"
- "Finish editing"
- "Grid: show and snap"
- "Hide"
- "Keep this layout (updates every page)"
- "Link text (⌘K)"
- "Live mobile preview"
- "Make it freeform"
- "Manage this menu — reorder, nest, swap menus"
- "Move down"
- "Move up"
- "None"
- "Page style"
- "Put it back"
- "Redo (⇧⌘Z)"
- "Remove"
- "Remove from Your sections"
- "Remove from menu"
- "Save this section to reuse"
- "Send backward"
- "Show the next layout"
- "Site style"
- "Start writing — a reading column, cursor ready"
- "Text alignment"
- "Text colour"
- "Theme default"
- "Undo (⌘Z)"
- "Updates every page"
- "Upload a self-contained HTML experience — it runs sandboxed"
- "Whole page — reorder sections"
- "Your latest posts, live"

## Exact toast and message copy

- "Added to the card — it moves and stacks with it now."
- "Backup restored — publish when ready."
- "Button updated."
- "Could not add that section."
- "Could not apply that style."
- "Could not delete that section."
- "Could not open the layout panel."
- "Could not preview that layout — "
- "Could not restore it."
- "Could not save that section."
- "Could not switch the "
- "Could not update the "
- "Editing the site "
- "Experience added — it runs sandboxed; visitors can interact once published."
- "Icon link updated."
- "Image swapped."
- "Link removed — the text stays."
- "Link updated."
- "Linked."
- "Menu order updated — every page gets it."
- "Menu switched — every page shows it."
- "Out of the card — it’s a free element again."
- "Publish failed: "
- "Publish your changes first — changing the page style reloads the page."
- "Removed from the card."
- "Section moved."
- "Site "
- "That saved section can’t be read."
- "That section can’t move past other stored content yet."
- "The backup could not be read."
- "Theme style applied: "
- "This "
- "Upload failed — .html uploads need admin rights."
- "Uploading experience…"
- "You have unpublished changes — switching the "
- "gogh backed up unpublished work from an earlier session."
- "gogh can’t safely swap this image."
- "gogh could not change the page style — "
- "gogh could not create that page."
- "gogh could not save the menu — "
- "gogh could not switch the menu — "
- "gogh couldn’t find that icon in the stored markup."
- "gogh couldn’t identify that icon."
- "gogh couldn’t restore it."
- "gogh couldn’t safely update this image in the saved markup."
- "gogh couldn’t save that menu order."
- "gogh found nothing it can edit in this section."
- "gogh: preview of “"
- "“"
- "✨ “"

## Test suite

`104` tests, run by appending `?gogh-test` to any Gogh page URL while logged in with edit rights on that page.

