# Knowledge-base audit — plugin v0.99.15

_16 finding(s) suppressed by `kb.audit-ignore.txt`._

## DRIFT (1)

The prose states something the source contradicts. Fix these first — the bot will contradict itself, since the appendix carries the correct value.

- plugin version is **0.99.15**, prose says **0.96.5**

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

- added UI label: "+ Link"
- added UI label: "+ Page"
- added UI label: "Add link"
- added UI label: "Add to page"
- added UI label: "Apply"
- added UI label: "Badge"
- added UI label: "Button"
- added UI label: "Cancel"
- added UI label: "Card"
- added UI label: "Create"
- added UI label: "Discard changes"
- added UI label: "Experience"
- added UI label: "Featured product"
- added UI label: "Heading"
- added UI label: "Image"
- added UI label: "Keep editing"
- added UI label: "Left"
- added UI label: "Open interactive experience"
- added UI label: "Outline"
- added UI label: "Page style"
- added UI label: "Peek at pages"
- added UI label: "Posts"
- added UI label: "Products"
- added UI label: "Publish"
- added UI label: "Publish & close"
- added UI label: "Remove image"
- added UI label: "Remove link (keep the text)"
- added UI label: "Right"
- added UI label: "Save"
- added UI label: "Save brand"
- added UI label: "See all →"
- added UI label: "Shape"
- added UI label: "Site designs"
- added UI label: "Site style"
- added UI label: "Solid"
- added UI label: "Switch design"
- added UI label: "Text"
- added UI label: "Unwrap — back to freeform"
- added UI label: "Use a text title instead"
- added UI label: "Use this design"
- added UI label: "Use this layout"
- added UI label: "Write"
- added UI label: "← All layouts"
- added UI label: "✏️ Edit with gogh"
- added UI label: "✨ Make freeform"
