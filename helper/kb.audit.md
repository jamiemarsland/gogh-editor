# Knowledge-base audit — plugin v0.99.75

_14 finding(s) suppressed by `kb.audit-ignore.txt`._

## DRIFT (1)

The prose states something the source contradicts. Fix these first — the bot will contradict itself, since the appendix carries the correct value.

- plugin version is **0.99.75**, prose says **0.96.5**

## MISSING (16)

The source has something the prose never explains. The bot knows the name from the appendix but cannot say what it is for.

- exposed filter `gogh_helper_url` exists in source but is never mentioned in the prose
- WP hook `admin_post_gogh_product_layout_all` exists in source but is never mentioned in the prose
- WP hook `admin_post_gogh_product_layout` exists in source but is never mentioned in the prose
- WP hook `safe_style_css` exists in source but is never mentioned in the prose
- WP hook `wp_kses_allowed_html` exists in source but is never mentioned in the prose
- WP hook `get_block_templates` exists in source but is never mentioned in the prose
- WP hook `rest_pre_insert_wp_template_part` exists in source but is never mentioned in the prose
- WP hook `rest_pre_insert_wp_navigation` exists in source but is never mentioned in the prose
- WP hook `admin_post_gogh_new_page` exists in source but is never mentioned in the prose
- template `Story` exists in source but is never mentioned in the prose
- template `Numbers` exists in source but is never mentioned in the prose
- template `Pricing` exists in source but is never mentioned in the prose
- template `Carousel` exists in source but is never mentioned in the prose
- template `FAQ` exists in source but is never mentioned in the prose
- template `Tabs` exists in source but is never mentioned in the prose
- template `Portfolio` exists in source but is never mentioned in the prose

## What changed since the last knowledge-base build

Use this as the checklist for updating the prose — and as a sanity check on the release itself.

- version: 0.99.74 → 0.99.75
- added template: "Carousel"
- added UI label: "Move left"
- added UI label: "Move right"
- added UI label: "Remove this slide"
