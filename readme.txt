=== Gogh Canvas ===
Contributors: jamiemarsland
Tags: page builder, canvas, drag and drop, design, blocks
Requires at least: 6.5
Tested up to: 7.0
Requires PHP: 7.4
Stable tag: 0.25.2
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

A freeform canvas for WordPress. Drag anything anywhere on your live page — Gogh publishes it back as clean, responsive core blocks.

== Description ==

Gogh Canvas turns the front end of your site into the design surface. There is no separate builder screen and no copy‑paste step: the live page **is** the canvas.

Drag headings, text, buttons, images and badges anywhere you like. Behind the scenes Gogh solves your freeform layout into a clean, responsive CSS grid and saves it back as **real WordPress core blocks** — headings, paragraphs, buttons and images your theme already knows how to style.

**Design freedom that respects your theme**

* Typography, colours and button styles come from your theme's Global Styles — switch style variations and Gogh pages re‑skin instantly.
* Text sizes step through your theme's font‑size presets instead of free‑scaling, so pages stay on your design system.
* Text and button colours are chosen from your theme palette, never invented.

**A canvas that feels like a design tool**

* Smart alignment guides, snapping, live spacing labels and equal‑spacing snap.
* Alt‑drag to duplicate, Shift to lock an axis, ⌘/Ctrl for free drag, arrow‑key nudging.
* Section templates (heroes, features, calls to action), section background images and shaped dividers.
* Layer ordering, rotation, undo/redo, and a Canva‑style selection box.

**Convert what you already have**

Open any existing page and click *Make freeform* on a Gutenberg section — Gogh measures the rendered layout and recreates it as a freeform section, pixel‑faithful, with every element now draggable. Text, links, image IDs, alignment and colours all carry over.

**Two editors, one page**

Edits made in the block editor (copy tweaks, colour changes) are adopted by Gogh automatically. Designers arrange in Gogh, writers polish in Gutenberg — nobody's work gets overwritten.

**Safe by design**

* Nothing is published until you press Publish — work in progress is continuously backed up to a WordPress autosave revision, with crash recovery.
* Pages are saved as static core blocks plus a stylesheet inside the page itself. **Deactivate the plugin and your pages keep rendering exactly the same.** No lock‑in, ever.
* Mobile layouts are generated automatically with a reading‑order algorithm that keeps each card's image, text and button together.

= Current limitations (beta) =

* Gogh sections support headings, paragraphs, buttons, images and badges. Other block types added inside a Gogh section from the block editor are not yet preserved on the next Gogh publish.
* Inline rich‑text formatting (bold, links inside paragraphs) is flattened to plain text when edited on the canvas.
* Modern browsers are required: Gogh's output uses container queries, `:has()` and `color-mix()`.

== Frequently Asked Questions ==

= Does my page break if I deactivate the plugin? =

No. Gogh saves static core blocks and ships the generated stylesheet inside the page content itself. Pages render identically with the plugin off.

= Does it work with my theme? =

Gogh inherits typography, colours and button styles from your theme's Global Styles and offers your theme's palette and font presets in its controls. It is designed for block themes.

= Where is the editor? =

On the front end. Visit any page while logged in (with edit rights) and click "Edit with Gogh" — in the admin bar or the corner button.

== Changelog ==

= 0.25 =
* Automatic mobile reading order keeps cards intact (XY‑cut linearisation).
* Publish status chip, autosave backup with crash recovery, graceful exit flow.
* Text colour, button background/text/hover colours from the theme palette.
* Text alignment controls; SVG toolbar icons.
* "Make freeform" — convert existing Gutenberg sections to Gogh sections.
* Onboarding: admin‑bar entry point, block‑editor placeholder, section templates including two heroes.
* Gutenberg edits are reconciled into Gogh's model at load.

= 0.1–0.18 =
* Freeform → responsive grid solver, front‑end live editing, snapping and smart guides, section management, dividers and background images, theme inheritance, font‑preset stepping, deactivation‑safe gogh/section block.
