# Knowledge-base audit — plugin v0.99.23

_14 finding(s) suppressed by `kb.audit-ignore.txt`._

## DRIFT (1)

The prose states something the source contradicts. Fix these first — the bot will contradict itself, since the appendix carries the correct value.

- plugin version is **0.99.23**, prose says **0.96.5**

## STALE (68)

The prose names something that no longer exists.

- __gogh member "addElementAt" was removed in this release, but the prose still describes it
- __gogh member "addHtmlSection" was removed in this release, but the prose still describes it
- __gogh member "addSection" was removed in this release, but the prose still describes it
- __gogh member "addShape" was removed in this release, but the prose still describes it
- __gogh member "applyTextLink" was removed in this release, but the prose still describes it
- __gogh member "buildBlocks" was removed in this release, but the prose still describes it
- __gogh member "buildV3" was removed in this release, but the prose still describes it
- __gogh member "chromeEdits" was removed in this release, but the prose still describes it
- __gogh member "cleanInline" was removed in this release, but the prose still describes it
- __gogh member "clearVariationPreview" was removed in this release, but the prose still describes it
- __gogh member "closePanel" was removed in this release, but the prose still describes it
- __gogh member "closeSide" was removed in this release, but the prose still describes it
- __gogh member "convertBlock" was removed in this release, but the prose still describes it
- __gogh member "convertChrome" was removed in this release, but the prose still describes it
- __gogh member "deleteSection" was removed in this release, but the prose still describes it
- __gogh member "duplicateSection" was removed in this release, but the prose still describes it
- __gogh member "explode" was removed in this release, but the prose still describes it
- __gogh member "fontSizes" was removed in this release, but the prose still describes it
- __gogh member "gatherRawUnits" was removed in this release, but the prose still describes it
- __gogh member "initStoredEdits" was removed in this release, but the prose still describes it
- __gogh member "insertGoghPattern" was removed in this release, but the prose still describes it
- __gogh member "isDirty" was removed in this release, but the prose still describes it
- __gogh member "measure" was removed in this release, but the prose still describes it
- __gogh member "mergeContent" was removed in this release, but the prose still describes it
- __gogh member "mirror" was removed in this release, but the prose still describes it
- __gogh member "moveSection" was removed in this release, but the prose still describes it
- __gogh member "multi" was removed in this release, but the prose still describes it
- __gogh member "navLinkMarkup" was removed in this release, but the prose still describes it
- __gogh member "openMenuManager" was removed in this release, but the prose still describes it
- __gogh member "openPageStylePanel" was removed in this release, but the prose still describes it
- __gogh member "openPicker" was removed in this release, but the prose still describes it
- __gogh member "openSecBgPanel" was removed in this release, but the prose still describes it
- __gogh member "openShapePanel" was removed in this release, but the prose still describes it
- __gogh member "openSide" was removed in this release, but the prose still describes it
- __gogh member "parseNavModel" was removed in this release, but the prose still describes it
- __gogh member "parseTopBlocks" was removed in this release, but the prose still describes it
- __gogh member "pending" was removed in this release, but the prose still describes it
- __gogh member "previewVariation" was removed in this release, but the prose still describes it
- __gogh member "publish" was removed in this release, but the prose still describes it
- __gogh member "pushState" was removed in this release, but the prose still describes it
- __gogh member "readingOrder" was removed in this release, but the prose still describes it
- __gogh member "reflowPush" was removed in this release, but the prose still describes it
- __gogh member "renderSection" was removed in this release, but the prose still describes it
- __gogh member "reorderNavRaw" was removed in this release, but the prose still describes it
- __gogh member "reorderSection" was removed in this release, but the prose still describes it
- __gogh member "resequenceToDom" was removed in this release, but the prose still describes it
- __gogh member "resolve" was removed in this release, but the prose still describes it
- __gogh member "resolveAll" was removed in this release, but the prose still describes it
- __gogh member "restore" was removed in this release, but the prose still describes it
- __gogh member "sanitizePastedHtml" was removed in this release, but the prose still describes it
- __gogh member "scan" was removed in this release, but the prose still describes it
- __gogh member "sections" was removed in this release, but the prose still describes it
- __gogh member "serialize" was removed in this release, but the prose still describes it
- __gogh member "serializeNavModel" was removed in this release, but the prose still describes it
- __gogh member "setEditing" was removed in this release, but the prose still describes it
- __gogh member "setFontSize" was removed in this release, but the prose still describes it
- __gogh member "setSecBg" was removed in this release, but the prose still describes it
- __gogh member "shapeDefs" was removed in this release, but the prose still describes it
- __gogh member "showHbar" was removed in this release, but the prose still describes it
- __gogh member "showTip" was removed in this release, but the prose still describes it
- __gogh member "startChromeCycle" was removed in this release, but the prose still describes it
- __gogh member "stepFontSize" was removed in this release, but the prose still describes it
- __gogh member "stickyRawToggle" was removed in this release, but the prose still describes it
- __gogh member "storedEdits" was removed in this release, but the prose still describes it
- __gogh member "syncModelFromMarkup" was removed in this release, but the prose still describes it
- __gogh member "templates" was removed in this release, but the prose still describes it
- __gogh member "toast" was removed in this release, but the prose still describes it
- __gogh member "zoom" was removed in this release, but the prose still describes it

## MISSING (9)

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

## What changed since the last knowledge-base build

Use this as the checklist for updating the prose — and as a sanity check on the release itself.

- version: 0.99.15 → 0.99.23
- added exposed filter: "gogh_helper_url"
- added REST route: "gogh/v1/type-scale"
- removed __gogh member: "addElementAt"
- removed __gogh member: "addElementToSection"
- removed __gogh member: "addHtmlSection"
- removed __gogh member: "addSection"
- removed __gogh member: "addShape"
- removed __gogh member: "applyTextLink"
- removed __gogh member: "bindChromeTest"
- removed __gogh member: "bindPending"
- removed __gogh member: "bindStoredTest"
- removed __gogh member: "brandToVariation"
- removed __gogh member: "buildBlocks"
- removed __gogh member: "buildV3"
- removed __gogh member: "chromeEdits"
- removed __gogh member: "cleanInline"
- removed __gogh member: "clearVariationPreview"
- removed __gogh member: "closePanel"
- removed __gogh member: "closeSide"
- removed __gogh member: "composeFeaturedProduct"
- removed __gogh member: "contrastRatio"
- removed __gogh member: "contrastSentinel"
- removed __gogh member: "convertBlock"
- removed __gogh member: "convertChrome"
- removed __gogh member: "convertStash"
- removed __gogh member: "cssColorToHex"
- removed __gogh member: "deleteSection"
- removed __gogh member: "deleteSectionRaw"
- removed __gogh member: "duplicateSection"
- removed __gogh member: "effectiveBgHex"
- removed __gogh member: "explode"
- removed __gogh member: "fontSizes"
- removed __gogh member: "gatherRawUnits"
- removed __gogh member: "goghHasNativeContent"
- removed __gogh member: "initStoredEdits"
- removed __gogh member: "insertGoghPattern"
- removed __gogh member: "isDirty"
- removed __gogh member: "markSwatchLegibility"
- removed __gogh member: "measure"
- removed __gogh member: "mergeContent"
- removed __gogh member: "mirror"
- removed __gogh member: "moveSection"
- removed __gogh member: "multi"
- removed __gogh member: "navLinkMarkup"
- removed __gogh member: "openBrandForm"
- removed __gogh member: "openMenuManager"
- removed __gogh member: "openPageStylePanel"
- removed __gogh member: "openPicker"
- removed __gogh member: "openSecAdd"
- removed __gogh member: "openSecBgPanel"
- removed __gogh member: "openShapePanel"
- removed __gogh member: "openSide"
- removed __gogh member: "parseNavModel"
- removed __gogh member: "parseTopBlocks"
- removed __gogh member: "pending"
- removed __gogh member: "previewVariation"
- removed __gogh member: "publish"
- removed __gogh member: "pushState"
- removed __gogh member: "readingOrder"
- removed __gogh member: "reflowPush"
- removed __gogh member: "renderSection"
- removed __gogh member: "reorderNavRaw"
- removed __gogh member: "reorderSection"
- removed __gogh member: "resequenceToDom"
- removed __gogh member: "resolve"
- removed __gogh member: "resolveAll"
- removed __gogh member: "restore"
- removed __gogh member: "sanitizePastedHtml"
- removed __gogh member: "scan"
- removed __gogh member: "sections"
- removed __gogh member: "serialize"
- removed __gogh member: "serializeNavModel"
- removed __gogh member: "setEditing"
- removed __gogh member: "setFontSize"
- removed __gogh member: "setSecBg"
- removed __gogh member: "shapeDefs"
- removed __gogh member: "showGuides"
- removed __gogh member: "showHbar"
- removed __gogh member: "showTip"
- removed __gogh member: "startChromeCycle"
- removed __gogh member: "stepFontSize"
- removed __gogh member: "stickyRawToggle"
- removed __gogh member: "storedEdits"
- removed __gogh member: "syncModelFromMarkup"
- removed __gogh member: "templates"
- removed __gogh member: "toast"
- removed __gogh member: "wrapImageIntoText"
- removed __gogh member: "wrapTargetIdx"
- removed __gogh member: "zoom"
- added UI label: "' + escAttr(t.name) + '"
- added UI label: "' + hp[1] + ' — ' + hp[2] + ' units"
- added UI label: "Colour & more ⌄"
- added UI label: "Fill screen"
- added UI label: "Fill the screen"
- added UI label: "Help — ask gogh anything"
- added UI label: "Rearrange — same pieces, new shapes"
- added UI label: "gogh help"
- added toast: "Could not rescale the type — "
- added toast: "Nothing to rearrange yet — add a couple of elements first."
- added toast: "Rearranged — same pieces, new shape."
- added toast: "Unpublished page changes will be lost when the "
- added toast: "gogh helper: "
