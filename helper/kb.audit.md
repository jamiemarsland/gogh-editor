# Knowledge-base audit — plugin v0.99.144

_13 finding(s) suppressed by `kb.audit-ignore.txt`._

## DRIFT (1)

The prose states something the source contradicts. Fix these first — the bot will contradict itself, since the appendix carries the correct value.

- plugin version is **0.99.144**, prose says **0.96.5**

## STALE (1)

The prose names something that no longer exists.

- toast "You have unpublished changes — switching the " was removed in this release, but the prose still describes it

## MISSING (22)

The source has something the prose never explains. The bot knows the name from the appendix but cannot say what it is for.

- exposed filter `gogh_helper_url` exists in source but is never mentioned in the prose
- WP hook `template_redirect` exists in source but is never mentioned in the prose
- WP hook `trashed_post` exists in source but is never mentioned in the prose
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
- template `Profile card` exists in source but is never mentioned in the prose
- template `Job card` exists in source but is never mentioned in the prose
- template `Place card` exists in source but is never mentioned in the prose
- template `Photo wall` exists in source but is never mentioned in the prose
- template `Carousel` exists in source but is never mentioned in the prose
- template `FAQ` exists in source but is never mentioned in the prose
- template `Tabs` exists in source but is never mentioned in the prose
- template `Portfolio` exists in source but is never mentioned in the prose

## What changed since the last knowledge-base build

Use this as the checklist for updating the prose — and as a sanity check on the release itself.

- version: 0.99.143 → 0.99.144
- removed toast: "You have unpublished changes — switching the "
- added toast: "Could not save the page, so the "
- added toast: "Saving your page changes, then updating the "
