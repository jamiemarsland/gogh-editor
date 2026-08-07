# Knowledge-base audit — plugin v0.99.15

_16 finding(s) suppressed by `kb.audit-ignore.txt`._

## DRIFT (1)

The prose states something the source contradicts. Fix these first — the bot will contradict itself, since the appendix carries the correct value.

- plugin version is **0.99.15**, prose says **0.96.5**

## STALE (3)

The prose names something that no longer exists.

- UI label "Finish editing" was removed in this release, but the prose still describes it
- UI label "Page style" was removed in this release, but the prose still describes it
- UI label "Site style" was removed in this release, but the prose still describes it

## MISSING (25)

The source has something the prose never explains. The bot knows the name from the appendix but cannot say what it is for.

- WP hook `admin_post_gogh_product_layout_all` exists in source but is never mentioned in the prose
- WP hook `admin_post_gogh_product_layout` exists in source but is never mentioned in the prose
- WP hook `safe_style_css` exists in source but is never mentioned in the prose
- WP hook `wp_kses_allowed_html` exists in source but is never mentioned in the prose
- WP hook `get_block_templates` exists in source but is never mentioned in the prose
- WP hook `rest_pre_insert_wp_template_part` exists in source but is never mentioned in the prose
- WP hook `rest_pre_insert_wp_navigation` exists in source but is never mentioned in the prose
- WP hook `admin_post_gogh_new_page` exists in source but is never mentioned in the prose
- __gogh member `addElementToSection` exists in source but is never mentioned in the prose
- __gogh member `composeFeaturedProduct` exists in source but is never mentioned in the prose
- __gogh member `contrastSentinel` exists in source but is never mentioned in the prose
- __gogh member `openSecAdd` exists in source but is never mentioned in the prose
- __gogh member `showGuides` exists in source but is never mentioned in the prose
- __gogh member `goghHasNativeContent` exists in source but is never mentioned in the prose
- __gogh member `wrapImageIntoText` exists in source but is never mentioned in the prose
- __gogh member `wrapTargetIdx` exists in source but is never mentioned in the prose
- __gogh member `bindPending` exists in source but is never mentioned in the prose
- __gogh member `convertStash` exists in source but is never mentioned in the prose
- __gogh member `deleteSectionRaw` exists in source but is never mentioned in the prose
- __gogh member `contrastRatio` exists in source but is never mentioned in the prose
- __gogh member `brandToVariation` exists in source but is never mentioned in the prose
- __gogh member `cssColorToHex` exists in source but is never mentioned in the prose
- __gogh member `effectiveBgHex` exists in source but is never mentioned in the prose
- __gogh member `markSwatchLegibility` exists in source but is never mentioned in the prose
- __gogh member `openBrandForm` exists in source but is never mentioned in the prose

## What changed since the last knowledge-base build

Use this as the checklist for updating the prose — and as a sanity check on the release itself.

- version: 0.96.5 → 0.99.15
- added WP hook: "admin_post_gogh_new_page"
- added WP hook: "admin_post_gogh_product_layout"
- added WP hook: "admin_post_gogh_product_layout_all"
- added WP hook: "get_block_templates"
- added WP hook: "rest_pre_insert_wp_navigation"
- added WP hook: "rest_pre_insert_wp_template_part"
- added WP hook: "safe_style_css"
- added WP hook: "wp_kses_allowed_html"
- added REST route: "gogh/v1/active-style"
- added REST route: "gogh/v1/pattern"
- added REST route: "gogh/v1/starter"
- added REST route: "wp/v2/gogh-product/(?P<id>\d+)"
- added REST route: "wp/v2/gogh-product/(?P<id>\d+)/autosaves"
- added capability: "edit_others_posts"
- added capability: "manage_options"
- added capability: "publish_pages"
- added __gogh member: "addElementToSection"
- added __gogh member: "bindPending"
- added __gogh member: "brandToVariation"
- added __gogh member: "composeFeaturedProduct"
- added __gogh member: "contrastRatio"
- added __gogh member: "contrastSentinel"
- added __gogh member: "convertStash"
- added __gogh member: "cssColorToHex"
- added __gogh member: "deleteSectionRaw"
- added __gogh member: "effectiveBgHex"
- added __gogh member: "goghHasNativeContent"
- added __gogh member: "markSwatchLegibility"
- added __gogh member: "openBrandForm"
- added __gogh member: "openSecAdd"
- added __gogh member: "showGuides"
- added __gogh member: "wrapImageIntoText"
- added __gogh member: "wrapTargetIdx"
- removed UI label: "Finish editing"
- removed UI label: "Page style"
- removed UI label: "Site style"
- added UI label: "Add an element to this section"
- added UI label: "Back"
- added UI label: "Bold"
- added UI label: "Golden ratio guides"
- added UI label: "Italic"
- added UI label: "Link"
- added UI label: "One product, hero-sized — a card with a real add-to-cart button"
- added UI label: "Your latest products, live — prices and add to cart included"
- added toast: "Back to freeform — drag it anywhere."
- added toast: "Golden ratio guides off."
- added toast: "Golden ratio guides on — the gold lines mark the golden section. Drag anything near one and it’ll catch."
- added toast: "Logo set — your image now leads the header."
- added toast: "Logo size saved."
- added toast: "Section removed — publish to make it real."
- added toast: "Text title restored — click it to rename your site."
- added toast: "Wrapped — the words flow around it now. Click the image to adjust."
- added toast: "Your site is now called “"
- added toast: "gogh could not create the page — try again."
- added toast: "gogh could not rename the site — that needs an admin login."
- added toast: "gogh could not save your brand — "
- added toast: "gogh could not set the logo — "
- added toast: "gogh could not switch back — "
- added toast: "gogh could not switch the design — "
