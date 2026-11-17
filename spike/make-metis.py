#!/usr/bin/env python3
"""Six blueprints on the Mētis theme (WordPress/metis), one per style:
Halyard (a band, Aeolia), Maron (a wine bar, Ismarus), The Long Border (a podcast, Ogygia),
Adaeze Cole (a consultant, Ithaca), Nell Ashdown (a printmaker, Aeaea), Undertow (a club night, Cimmeria).
Each home page is a different SHAPE: a poster, a wine list, cards, a document with margin labels,
a bento wall, a type-only flyer.
Writes spike/site-def-metis-<id>.json and blueprint-metis-<id>.json into the gogh worktree given as argv[1]."""
import json, base64, sys, os
WT = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser('~/gogh/release-789')
METIS_REF = '915e5e126c94c71024be9f95afb45a6aefd60554'

def U(i, w=1600, mono=False): return f'https://images.unsplash.com/photo-{i}?w={w}&q=80&fm=jpg&fit=max' + ('&sat=-100' if mono else '')
def C(n): return f'var(--wp--preset--color--theme-{n})'
INK = 'var(--wp--preset--color--contrast, #111)'
def soft(p): return f'color-mix(in srgb, {INK} {p}%, transparent)'

def eb(t, x, y, w=440, color=None, align=None):
    e = {'type': 'para', 'x': x, 'y': y, 'w': w, 'h': 24, 'text': t, 'tf': {'fs': 12, 'fw': 600, 'ls2': 0.2, 'tt': 'uppercase'}}
    if color: e['color'] = color
    if align: e['align'] = align
    return e
def hd(t, x, y, w, h, fs='3-x-large', align=None, **k):
    e = {'type': 'heading', 'x': x, 'y': y, 'w': w, 'h': h, 'text': t, 'fs': fs}
    if align: e['align'] = align
    e.update(k); return e
def pa(t, x, y, w, h, fs=17, align=None, **k):
    e = {'type': 'para', 'x': x, 'y': y, 'w': w, 'h': h, 'text': t, 'tf': {'fs': fs}}
    if align: e['align'] = align
    for kk, v in k.items():
        if kk in ('fw',): e['tf'][kk] = v
        else: e[kk] = v
    return e
def bt(t, x, y, w, href, ghost=False):
    e = {'type': 'button', 'x': x, 'y': y, 'w': w, 'h': 48, 'text': t, 'href': href}
    if ghost: e['ghost'] = True
    return e
def im(i, x, y, w, h, alt, radius=16, **k):
    e = {'type': 'image', 'x': x, 'y': y, 'w': w, 'h': h, 'src': U(i), 'alt': alt, 'radius': radius}
    e.update(k); return e
def rule(x, y, w):
    return {'type': 'box', 'x': x, 'y': y, 'w': w, 'h': 24, 'boxBg': 'linear-gradient(color-mix(in srgb, currentColor 24%, transparent), color-mix(in srgb, currentColor 24%, transparent)) top / 100% 1px no-repeat'}
def ledger(x, y, w, items, k=0, price=0, role=0):
    typ = {'t': {'tf': {'fs': 17, 'fw': 600}, 'body': 1}, 'd': {'tf': {'fs': 15, 'col': soft(66)}}}
    if k: typ['k'] = {'tf': {'fs': 15, 'fw': 600}}
    if price: typ['price'] = {'tf': {'fs': 17}}
    if role: typ['role'] = {'tf': {'fs': 15, 'col': soft(66)}}
    return {'type': 'cards', 'x': x, 'y': y, 'w': w, 'h': len(items) * 72 + 24, 'cards': {
        'layout': 'ledger', 'look': 'open', 'pic': 'none', 'act': 'none', 'titles': 1,
        'extras': {'k': k, 'price': price, 'role': role, 'n': 0}, 'items': items, 'type': typ,
        'box': {'look': 'open', 'pad': 18, 'gap': 4, 'ruleCol': soft(20)}}}
def cards(x, y, w, h, items, layout='g3', role=0, bg=None, price=0):
    return {'type': 'cards', 'x': x, 'y': y, 'w': w, 'h': h, 'cards': {
        'items': items, 'feat': -1, 'layout': layout, 'look': 'panel', 'pic': 'square', 'act': 'none', 'align': 'left', 'round': 1, 'titles': 1,
        'extras': {'price': price, 'role': role, 'k': 0, 'n': 0},
        'type': {'t': {'tf': {'fs': 20, 'fw': 700}, 'body': 1}, 'd': {'tf': {'fs': 15}}, 'price': {'tf': {'fs': 15, 'fw': 600}}, 'role': {'tf': {'fs': 13, 'col': soft(66)}}},
        'box': {'look': 'panel', 'gap': 12, 'minH': h, 'bg': bg or C(6), 'radius': 16, 'pad': 24}}}
def stat(n, label, x, y, w=220):
    return [hd(n, x, y, w, 48, 'x-large'), pa(label, x, y + 48, w, 24, 13)]
def tile(x, y, kicker, title, text, href, link, bg, h=312):
    return {'type': 'box', 'x': x, 'y': y, 'w': 320, 'h': h, 'boxBg': bg, 'radius': 20, 'kids': [
        eb(kicker, 28, 28, 264), hd(title, 28, 64, 264, 72, 'large', tf={'fs': 26, 'lh': 1.15}),
        pa(text, 28, 148, 264, h - 220, 15), pa('<a href="' + href + '">' + link + '</a>', 28, h - 56, 264, 24, 15, fw=600)]}
def sec(name, minH, els, **k):
    s = {'name': name, 'minH': minH, 'els': els}; s.update(k); return s
def page(title, sections, **k):
    p = {'title': title, 'template': 'page-no-title', 'sections': sections}; p.update(k); return p

def footer(lines, small):
    cols = ''.join(
        '<!-- wp:column -->\n<div class="wp-block-column"><!-- wp:heading {"level":4,"fontSize":"small"} -->\n<h4 class="wp-block-heading has-small-font-size">' + h + '</h4>\n<!-- /wp:heading -->\n\n<!-- wp:paragraph {"fontSize":"small"} -->\n<p class="has-small-font-size">' + b + '</p>\n<!-- /wp:paragraph --></div>\n<!-- /wp:column -->\n\n'
        for h, b in lines)
    return ('<!-- wp:group {"tagName":"footer","style":{"spacing":{"padding":{"top":"var:preset|spacing|70","bottom":"var:preset|spacing|60"},"margin":{"top":"0","bottom":"0"}},"background":{"gradient":"var:preset|gradient|gradient-8"}},"layout":{"type":"constrained"}} -->\n'
            '<footer class="wp-block-group" style="margin-top:0;margin-bottom:0;padding-top:var(--wp--preset--spacing--70);padding-bottom:var(--wp--preset--spacing--60)"><!-- wp:columns {"align":"wide"} -->\n<div class="wp-block-columns alignwide">'
            '<!-- wp:column {"width":"40%"} -->\n<div class="wp-block-column" style="flex-basis:40%"><!-- wp:site-title {"level":0,"fontSize":"x-large"} /-->\n\n<!-- wp:site-tagline {"fontSize":"small"} /--></div>\n<!-- /wp:column -->\n\n'
            + cols +
            '</div>\n<!-- /wp:columns -->\n\n<!-- wp:paragraph {"align":"wide","fontSize":"x-small","style":{"spacing":{"margin":{"top":"var:preset|spacing|60"}}}} -->\n<p class="alignwide has-x-small-font-size" style="margin-top:var(--wp--preset--spacing--60)">' + small + '</p>\n<!-- /wp:paragraph --></footer>\n<!-- /wp:group -->\n')

SITES = {}

# ---------------------------------------------------------------- Halyard (Aeolia)
tour = [
 {'k': '6 Mar', 't': 'Falmouth · The Poly', 'd': 'Album launch, with Greyhen', 'role': 'Sold out'},
 {'k': '8 Mar', 't': 'Bristol · The Louisiana', 'd': 'Doors 7.30', 'role': 'Last few'},
 {'k': '12 Mar', 't': 'Manchester · Band on the Wall', 'd': 'Doors 7.00', 'role': 'Tickets'},
 {'k': '14 Mar', 't': 'Glasgow · Mono', 'd': 'Doors 7.30, all ages', 'role': 'Tickets'},
 {'k': '15 Mar', 't': 'Newcastle · The Cluny', 'd': 'Doors 7.30', 'role': 'Tickets'},
 {'k': '19 Mar', 't': 'Leeds · Brudenell Social Club', 'd': 'Doors 7.30', 'role': 'Tickets'},
 {'k': '21 Mar', 't': 'London · Omeara', 'd': 'Doors 7.00', 'role': 'Last few'},
 {'k': '22 Mar', 't': 'Brighton · Komedia', 'd': 'Doors 7.30', 'role': 'Tickets'},
 {'k': '27 Mar', 't': 'Cardiff · Clwb Ifor Bach', 'd': 'Doors 7.00', 'role': 'Tickets'},
 {'k': '28 Mar', 't': 'Exeter · Phoenix', 'd': 'The last night, with Greyhen', 'role': 'Tickets'},
]
tracks = [
 {'k': '01', 't': 'Slack Water', 'role': '3:42'}, {'k': '02', 't': 'Carrick Roads', 'role': '4:10'},
 {'k': '03', 't': 'The Last Ferry Is a Rumour', 'role': '3:28'}, {'k': '04', 't': 'Storm Glass', 'role': '5:02'},
 {'k': '05', 't': 'Small Hours, Big Sea', 'role': '3:55'}, {'k': '06', 't': 'Annie on the Night Shift', 'role': '4:21'},
 {'k': '07', 't': 'Dead Reckoning', 'role': '3:37'}, {'k': '08', 't': 'Postcards I Never Sent', 'role': '4:48'},
 {'k': '09', 't': 'Harbour Lights', 'role': '2:59'}, {'k': '10', 't': 'Home on the Flood', 'role': '6:14'},
]
SITES['band'] = {
 'title': 'Halyard — a band on Mētis', 'desc': 'A four-piece from Falmouth on the new Mētis theme in its Aeolia style: the new album up top, the spring tour as a ruled list of dates, the record with its track list, and a page for the music.',
 'def': {
  'name': 'Halyard', 'tagline': 'Four people and a van, from Falmouth.', 'variation': 'Aeolia',
  'chrome': {'header_part': 'header-a', 'footer_part': 'footer-c'},
  'pages': [
   page('Home', [
    sec('Hero', 792, [
      eb('Halyard · new album · out 6 March', 160, 216, 880, 'theme-1', 'center'),
      hd('Slack Water', 80, 264, 1040, 216, '__max', 'center', color='theme-1', tf={'fs2': 11, 'fsMin': 44, 'lh': 1}),
      pa('Ten songs about leaving a harbour town and coming back to it, written in a net loft over one long winter.', 320, 504, 560, 72, 19, 'center', color='theme-1'),
      {**bt('Hear the record', 392, 624, 200, '/music/'), 'btnBg': 'theme-7', 'btnText': 'theme-2'},
      {**bt('Tour dates', 608, 624, 200, '/tour/'), 'btnBg': 'theme-1', 'btnText': 'theme-2'},
    ], image=U('1632054553195-bfd7034fee25', 2000), background=C(2), tint=52),
    sec('Three ways in', 504, [
      tile(80, 96, 'Listen', 'Ten songs, forty-two minutes', 'Recorded live in six days. On heavy black vinyl, or wherever you listen.', '/music/', 'The record →', C(7)),
      tile(440, 96, 'See us', 'Ten nights in March', 'Falmouth to Glasgow and back, with our friends Greyhen. Three are nearly gone.', '/tour/', 'Tour dates →', C(8)),
      tile(800, 96, 'Stay close', 'A letter, once a month', 'New songs, early tickets and the odd photograph of the van broken down.', 'mailto:hello@halyard.example', 'Join the list →', C(9)),
    ]),
    sec('Spring tour', 792, [
      eb('On the road', 80, 96, 440), hd('The spring tour', 80, 144, 640, 72),
      pa('<a href="/tour/">All ten dates →</a>', 760, 168, 360, 24, 15, 'right', fw=600, m={'hidden': True}),
      ledger(80, 264, 1040, tour[:5], k=1, role=1),
      bt('See every date', 80, 672, 200, '/tour/', True),
    ], background=C(6)),
    sec('The band', 936, [
      im('1481886756534-97af88ccb438', 80, 96, 1040, 480, 'A band rehearsing in a small studio'),
      hd('Four people and a van.', 80, 624, 400, 144, '3-x-large'),
      pa('Morwenna Pascoe sings and plays guitar. Jago Trethewey plays the other guitar, louder.', 520, 624, 280, 144, 16),
      pa('Kit Hallam plays bass and drives. Dev Sandhu plays drums and never stops talking.', 840, 624, 280, 144, 16),
      pa('We met working summer jobs on the same quay in 2019. The van is called Doris.', 520, 792, 600, 48, 16),
    ]),
    sec('The record', 720, [
      eb('The record', 80, 144, 440), hd('Ten songs, one winter, no click track.', 80, 192, 480, 168),
      pa('We recorded it live in a room, the four of us facing each other. What you hear is what happened. It comes with a lyric sheet and a photograph of Doris.', 80, 384, 460, 120),
      bt('Buy the vinyl · £24', 80, 528, 232, '/music/'),
      im('1603048588665-791ca8aea617', 640, 96, 480, 480, 'A black vinyl record turning on a turntable', 240),
    ], background=C(10)),
   ], slug='home', front=True, menu=False),
   page('Tour', [
    sec('Tour', 1128, [
      eb('Spring 2027', 80, 72, 440), hd('On the road', 80, 120, 720, 144, '__disp-s'),
      pa('Ten nights in March with our friends Greyhen. Every show is standing, and under-18s are welcome with an adult unless it says otherwise.', 80, 288, 560, 72, 18),
      ledger(80, 384, 1040, tour, k=1, role=1),
    ]),
    sec('Bring us to your town', 432, [
      hd('Not coming near you?', 160, 120, 880, 72, '3-x-large', 'center'),
      pa('Tell us where and who runs the best small room there. We read all of it, and we have a van.', 320, 216, 560, 48, 17, 'center'),
      bt('Write to us', 500, 288, 200, 'mailto:hello@halyard.example'),
    ], background=C(8)),
   ], slug='tour'),
   page('Music', [
    sec('Slack Water', 1128, [
      eb('Album · 2027', 80, 72, 440), hd('Slack Water', 80, 120, 480, 144, '__disp-s'),
      pa('Recorded live in six days at a net loft in Penryn. Ten songs, forty-two minutes.', 80, 288, 440, 72, 18),
      bt('Buy the vinyl · £24', 80, 384, 232, 'mailto:hello@halyard.example'), bt('Stream it', 328, 384, 144, '#', True),
      im('1458560871784-56d23406c091', 80, 480, 440, 440, 'A needle resting on a spinning record'),
      ledger(640, 96, 480, tracks, k=1, role=1),
    ]),
    sec('Earlier', 576, [
      eb('Before this', 80, 96, 440), hd('Earlier records', 80, 144, 640, 72),
      ledger(80, 264, 1040, [
        {'k': '2024', 't': 'Lee Shore', 'd': 'The first album. Eleven songs, recorded in a chapel', 'role': 'LP · £20'},
        {'k': '2022', 't': 'Quay Songs', 'd': 'Four songs on a cassette we dubbed ourselves', 'role': 'EP · sold out'},
        {'k': '2021', 't': 'Doris', 'd': 'A single about a van', 'role': 'Digital'},
      ], k=1, role=1),
    ], background=C(6)),
   ], slug='music'),
  ],
  'footer': footer([('Booking', 'Kit drives and answers the email:<br><a href="mailto:hello@halyard.example">hello@halyard.example</a>'), ('Next', '6 March · Falmouth<br>8 March · Bristol<br>12 March · Manchester')], '© 2026 Halyard · Made in Falmouth, played everywhere the van will go'),
 }}

# ---------------------------------------------------------------- Maron (Ismarus)
glass = [
 {'t': 'Pét-nat rosé, Loire', 'd': 'Cloudy, strawberry, gone too quickly', 'price': '£8'},
 {'t': 'Skin-contact Rkatsiteli, Kakheti', 'd': 'Amber, tea and dried apricot, from a clay qvevri', 'price': '£9'},
 {'t': 'Aligoté, Burgundy', 'd': 'Lemon, salt and a bit of grip', 'price': '£9'},
 {'t': 'Chilled Gamay, Beaujolais', 'd': 'Light, crunchy, straight from the fridge', 'price': '£8'},
 {'t': 'Mencía, Ribeira Sacra', 'd': 'Dark fruit and smoke off a slate hillside', 'price': '£10'},
]
SITES['wine'] = {
 'title': 'Maron — a wine bar on Mētis', 'desc': 'A natural wine bar and bottle shop in Margate on the new Mētis theme in its wine-dark Ismarus style: the week\'s glasses as a priced list, the growers, events and a map.',
 'def': {
  'name': 'Maron', 'tagline': 'Wine bar & bottle shop, Margate.', 'variation': 'Ismarus',
  'chrome': {'header_part': 'header-a', 'footer_part': 'footer-c'},
  'pages': [
   page('Home', [
    sec('Hero', 648, [
      eb('Wine bar & bottle shop · Margate', 160, 120, 880, None, 'center'),
      hd('Wine with nothing added and nothing to prove.', 160, 168, 880, 240, '__disp-s', 'center'),
      pa('A hundred and forty bottles from people who farm their own grapes, twelve of them open by the glass.', 320, 432, 560, 72, 18, 'center'),
      bt('See the list', 424, 528, 168, '/the-list/'), bt('Find us', 608, 528, 168, '/visit/', True),
    ]),
    sec('The room', 576, [
      im('1596641069082-b1d5ac2b6fc1', 80, 0, 1040, 504, 'Wooden chairs and tables in front of shelves of wine'),
    ]),
    sec('By the glass', 792, [
      eb('Open this week', 200, 96, 800, None, 'center'), hd('By the glass', 200, 144, 800, 72, '3-x-large', 'center'),
      ledger(200, 264, 800, glass, price=1),
      pa('125ml. <a href="/the-list/">The whole list →</a>', 200, 672, 800, 24, 14, 'center'),
    ], background=C(6)),
    sec('How it works', 504, [
      rule(80, 96, 320), hd('Drink in.', 80, 120, 320, 48, 'x-large'),
      pa('Sit at the long table. Every bottle on the shelf can be opened for £8 corkage, with bread, anchovies and whatever cheese came in.', 80, 192, 320, 168, 16),
      rule(440, 96, 320), hd('Take it home.', 440, 120, 320, 48, 'x-large'),
      pa('Everything has its price on the neck. Tell us what is for dinner and how much you want to spend, and we will find it.', 440, 192, 320, 168, 16),
      rule(800, 96, 320), hd('Ask us.', 800, 120, 320, 48, 'x-large'),
      pa('We have tasted all of it and will open nearly anything for a taste. Nobody here will make you say “minerality”.', 800, 192, 320, 168, 16),
    ]),
    sec('Why', 576, [
      hd('“Good wine is grapes, time and somebody paying attention.”', 160, 192, 880, 144, '2-x-large', 'center'),
      pa('Ines Maron, who chooses the bottles', 160, 360, 880, 24, 14, 'center'),
    ], image=U('1537640538966-79f369143f8f', 2000), background=C(1), tint=70),
    sec('This month', 648, [
      eb('At the long table', 200, 96, 800, None, 'center'), hd('This month', 200, 144, 800, 72, '3-x-large', 'center'),
      tile(80, 264, 'Thursday 5 · £28', 'Meet the grower', 'Domaine des Quatre Vents: six wines and the person who made them.', '/visit/', 'Ask about a seat →', C(6), 288),
      tile(440, 264, 'Sunday 15 · £22', 'Orange wine, start to finish', 'A tasting for people who are not sure about it yet.', '/visit/', 'Ask about a seat →', C(6), 288),
      tile(800, 264, 'Thursday 19 · walk in', 'Oysters and Muscadet', 'Whitstable natives, shucked at the bar until they run out.', '/visit/', 'Find us →', C(6), 288),
    ]),
    sec('Find us', 864, [
      eb('Find us', 200, 96, 800, None, 'center'), hd('Northdown Road, by the sea.', 200, 144, 800, 72, '3-x-large', 'center'),
      pa('Wednesday and Thursday, 4 to 10 · Friday and Saturday, 12 to 11 · Sunday, 12 to 6', 200, 240, 800, 48, 16, 'center'),
      {'type': 'embed', 'x': 80, 'y': 336, 'w': 1040, 'h': 432, 'url': 'https://www.google.com/maps?q=Northdown+Road,+Cliftonville,+Margate&output=embed', 'radius': 16},
    ], background=C(8)),
   ], slug='home', front=True, menu=False),
   page('The list', [
    sec('The list', 432, [
      eb('Changes every Wednesday', 80, 72, 440), hd('The list', 80, 120, 720, 144, '__disp-s'),
      pa('Twelve open at a time. Glasses are 125ml; ask for a taste of anything before you choose.', 80, 288, 560, 72, 18),
    ]),
    sec('Sparkling and orange', 576, [hd('Sparkling & orange', 80, 72, 640, 72), ledger(80, 168, 1040, [
        glass[0], {'t': 'Col fondo Prosecco, Veneto', 'd': 'Bottle-fermented, dry, yeasty, nothing like the other kind', 'price': '£8'},
        glass[1], {'t': 'Macerated Pinot Gris, Alsace', 'd': 'Copper-coloured, rose hip and blood orange', 'price': '£10'}], price=1)], background=C(6)),
    sec('White', 576, [hd('White', 80, 72, 640, 72), ledger(80, 168, 1040, [
        glass[2], {'t': 'Muscadet sur lie, Loire', 'd': 'Sea spray and lemon pith; ask about the oysters', 'price': '£7'},
        {'t': 'Chenin Blanc, Swartland', 'd': 'Old bush vines, baked apple and beeswax', 'price': '£9'},
        {'t': 'Assyrtiko, Santorini', 'd': 'Volcanic, salty, sharp as a tack', 'price': '£11'}], price=1)]),
    sec('Red', 576, [hd('Red', 80, 72, 640, 72), ledger(80, 168, 1040, [
        glass[3], glass[4], {'t': 'Frappato, Sicily', 'd': 'Pale, floral, a red for a hot day', 'price': '£9'},
        {'t': 'Syrah, northern Rhône', 'd': 'Black olive and pepper, the serious one', 'price': '£12'}], price=1)], background=C(6)),
   ], slug='the-list'),
   page('Visit', [
    sec('Visit', 720, [
      eb('Visit', 80, 96, 440), hd('Come and find us', 80, 144, 480, 216, '__disp-s'),
      pa('168 Northdown Road, Cliftonville, Margate CT9 2QN. Ten minutes on foot from the station, two from the sea.', 80, 384, 440, 96, 18),
      pa('Wednesday and Thursday, 4 to 10<br>Friday and Saturday, 12 to 11<br>Sunday, 12 to 6', 80, 480, 440, 96),
      {'type': 'embed', 'x': 640, 'y': 96, 'w': 480, 'h': 528, 'url': 'https://www.google.com/maps?q=Northdown+Road,+Cliftonville,+Margate&output=embed', 'radius': 16},
    ]),
    sec('The room', 648, [
      im('1541401154946-62f8d84bd284', 80, 96, 520, 456, 'Plates of food and bottles of wine on a table'),
      eb('Private tastings', 680, 144, 440), hd('The long table seats fourteen.', 680, 192, 440, 120),
      pa('Birthdays, work dos and people who just want to learn something. Six wines, a plate of things to eat and someone to talk you through it. From £30 a head.', 680, 336, 420, 120),
      bt('Ask about a date', 680, 480, 200, 'mailto:hello@maron.example'),
    ], background=C(6)),
   ], slug='visit'),
  ],
  'footer': footer([('Open', 'Wed &amp; Thu 4–10<br>Fri &amp; Sat 12–11<br>Sun 12–6'), ('Find us', '168 Northdown Road<br>Margate CT9 2QN<br><a href="mailto:hello@maron.example">hello@maron.example</a>')], '© 2026 Maron · Over-18s only at the bar · Please drink like you have somewhere to be tomorrow'),
 }}

# ---------------------------------------------------------------- The Long Border (Ogygia)
def ep(n, title, date, mins, img, excerpt, body):
    return {'title': f'{n}. {title}', 'slug': f'episode-{n}', 'date': date, 'cats': ['Episodes'], 'image': U(img), 'excerpt': f'{mins} min · {excerpt}',
            'content': ''.join(f'<!-- wp:paragraph --><p>{p}</p><!-- /wp:paragraph -->' for p in body)}
eps = [
 ep(48, 'The greenhouse that paid for itself', '2026-11-12', 52, '1675449215007-def921b7c0ca', 'A Victorian glasshouse, forty years of tomatoes and one very patient restoration.',
    ['Margaret Ashby bought a derelict Victorian glasshouse with the house attached to it, and spent four winters reglazing it one pane at a time. We walk through it with her in November, when it is the only warm place for miles.',
     'She tells us what she grows under glass and what she has given up on, why she heats only one bay, and how selling tomato plants at the gate each May paid for every pane.',
     '<strong>In this episode:</strong> reglazing with reclaimed glass · the one bay worth heating · tomatoes that earn their keep · what to sow under cover in November.']),
 ep(47, 'No-dig, ten years on', '2026-10-29', 41, '1590682680695-43b964a3ae17', 'What a decade without a spade did to one allotment’s soil, and to its owner’s back.',
    ['Tomasz gave up digging his allotment ten years ago. Ruth, who has always been sceptical, comes to look at the soil and brings a spade just in case.',
     'We talk about where the compost comes from, what the slugs think of it, and which crops never took to it.',
     '<strong>In this episode:</strong> a year’s compost in numbers · carrots, the exception · weeds after ten years · Ruth changes her mind about one thing.']),
 ep(46, 'A border for a dry summer', '2026-10-15', 47, '1750832615155-60aba40dd5ed', 'Planting for the weather we have now: gravel, grasses and nothing watered after June.',
    ['After three dry summers, Ruth dug out the long border the show is named after and started again. She explains what went, what stayed and what she planted into six inches of gravel.',
     '<strong>In this episode:</strong> plants that never needed the hose · planting small · the first year looks terrible · what the bees made of it.']),
 ep(45, 'The seed swap', '2026-10-01', 38, '1611843467160-25afb8df1074', 'A village hall, two hundred envelopes and a bean nobody can name.',
    ['Every autumn a village hall in Herefordshire fills with trestle tables and brown envelopes. We spend a morning there, asking people what they brought and why they keep growing it.',
     '<strong>In this episode:</strong> saving seed without fuss · the bean with no name · what to swap if you have nothing yet.']),
 ep(44, 'Leave it standing', '2026-09-17', 44, '1782116987482-df05274c10f1', 'A walk round a garden that is not cut back until March.',
    ['Head gardener Colm Rafferty stopped cutting his borders back in autumn fifteen years ago. On the first cold morning of autumn he shows us why: seed heads, spiders’ webs and a great many goldfinches.',
     '<strong>In this episode:</strong> what stands up and what collapses · the March cut-back · leaving it for the birds.']),
 ep(43, 'An allotment at eighty', '2026-09-03', 49, '1775568109786-18598bf7b294', 'Sixty years on the same plot, and what Doreen would tell a beginner.',
    ['Doreen Whitlock took on plot 14 in 1966 and still walks down to it most mornings. She shows us round, feeds us raspberries from the freezer and tells Tomasz he is planting his leeks wrong.',
     '<strong>In this episode:</strong> sixty years of one notebook · raised beds, late in life · the three things worth growing if you only grow three.']),
]
SITES['podcast'] = {
 'title': 'The Long Border — a podcast on Mētis', 'desc': 'A gardening podcast on the new Mētis theme in its deep-green Ogygia style: the latest episode up top, every episode a real post, the two hosts, and where to listen.',
 'def': {
  'name': 'The Long Border', 'tagline': 'A podcast about gardens and the people who make them.', 'variation': 'Ogygia',
  'chrome': {'header_part': 'header-a', 'footer_part': 'footer-c'},
  'pages': [
   page('Home', [
    sec('Hero', 720, [
      eb('A podcast · every other Thursday', 80, 120, 440),
      hd('The Long Border', 80, 168, 500, 216, '__disp-s'),
      pa('Two gardeners visit people who grow things, in glasshouses, on allotments and up against north-facing walls, and ask them how it is going.', 80, 408, 460, 120, 17),
      bt('All episodes', 80, 552, 176, '/episodes/', True),
      {'type': 'box', 'x': 640, 'y': 72, 'w': 480, 'h': 552, 'boxBg': C(6), 'radius': 24, 'kids': [
        im('1675449215007-def921b7c0ca', 24, 24, 432, 240, 'A brick and glass Victorian greenhouse', 12),
        eb('Latest · episode 48 · 52 min', 24, 288, 432),
        hd('The greenhouse that paid for itself', 24, 324, 432, 72, 'large', tf={'fs': 26, 'lh': 1.15}),
        pa('Margaret Ashby reglazed a derelict glasshouse one pane at a time. Forty years of tomatoes later, she shows us round.', 24, 408, 432, 72, 14),
        bt('Listen now', 24, 480, 160, '/?name=episode-48'),
      ]},
    ]),
    {'take': 'Latest posts', 'name': 'Recent episodes', 'heading': 'Recent episodes', 'posts': {'look': 'cards', 'count': 3, 'show': {'date': True, 'excerpt': True}}},
    sec('Listen', 360, [
      eb('Wherever you listen', 160, 72, 880, None, 'center'), hd('Free, every other Thursday.', 160, 120, 880, 72, '3-x-large', 'center'),
      bt('Apple Podcasts', 208, 240, 184, '#', True), bt('Spotify', 408, 240, 184, '#', True), bt('Pocket Casts', 608, 240, 184, '#', True), bt('RSS feed', 808, 240, 184, '/feed/', True),
    ], background=C(8)),
    sec('Your hosts', 720, [
      eb('Your hosts', 160, 96, 880, None, 'center'), hd('Two gardeners, one microphone.', 160, 144, 880, 72, '3-x-large', 'center'),
      im('1724556295070-5f8bff2c7f3f', 240, 264, 216, 216, 'Ruth Calder in her garden', 108),
      hd('Ruth Calder', 168, 504, 360, 48, 'large', 'center', tf={'fs': 26, 'lh': 1.15}),
      pa('Thirty years a head gardener, now tending a long border of her own in Shropshire. Asks the awkward questions.', 168, 552, 360, 96, 15, 'center'),
      im('1759497860802-9cba5782b455', 744, 264, 216, 216, 'Tomasz Nowak on his allotment', 108),
      hd('Tomasz Nowak', 672, 504, 360, 48, 'large', 'center', tf={'fs': 26, 'lh': 1.15}),
      pa('Grows vegetables on a no-dig allotment in Leeds and writes about soil. Brings the biscuits.', 672, 552, 360, 96, 15, 'center'),
    ]),
    sec('In numbers', 288, [
      *stat('48', 'episodes', 80, 96, 200), *stat('31', 'gardens visited', 360, 96, 200), *stat('0', 'adverts', 640, 96, 200), *stat('2019', 'since', 920, 96, 200),
    ], background=C(6)),
    sec('The letter', 432, [
      eb('Between episodes', 160, 96, 880, None, 'center'), hd('A letter from the potting shed.', 160, 144, 880, 72, '3-x-large', 'center'),
      pa('What we are sowing this fortnight, who is on next, and one thing a listener taught us.', 320, 240, 560, 48, 17, 'center'),
      bt('Get the letter', 500, 312, 200, 'mailto:hello@thelongborder.example'),
    ], background=C(11)),
   ], slug='home', front=True, menu=False),
   {'title': 'Episodes', 'slug': 'episodes', 'blog': True},
   page('About', [
    sec('About', 720, [
      eb('About the show', 80, 96, 440), hd('We go and look.', 80, 144, 480, 216, '__disp-s'),
      pa('The Long Border started in 2019 as two friends arguing about dahlias in a car. It is still mostly that, but now we record it, and we arrive somewhere.', 80, 384, 460, 96, 18),
      pa('Every episode is one garden and the person who made it. No studio, no adverts, no top tips. Listeners pay for the petrol.', 80, 480, 460, 96),
      im('1623136299195-570a06bdae6b', 640, 96, 480, 528, 'A greenhouse full of green plants'),
    ]),
    sec('Come on the show', 432, [
      hd('Know a garden we should see?', 160, 120, 880, 72, '3-x-large', 'center'),
      pa('It does not have to be grand. Our favourite episode was recorded in a back yard in Hull.', 320, 216, 560, 48, 17, 'center'),
      bt('Tell us about it', 500, 288, 200, 'mailto:hello@thelongborder.example'),
    ], background=C(6)),
   ], slug='about'),
  ],
  'posts': eps, 'blog_look': 'ledger',
  'footer': footer([('Listen', 'Every other Thursday<br>Free, with no adverts<br><a href="/feed/">RSS feed</a>'), ('Write', 'Tell us about a garden:<br><a href="mailto:hello@thelongborder.example">hello@thelongborder.example</a>')], '© 2026 The Long Border · Recorded in other people’s gardens'),
 }}

# ---------------------------------------------------------------- Adaeze Cole (Ithaca): a document with labels in the margin
LX, CX, CW = 80, 360, 760   # the label column, the content column and its width
def lab(t, y): return eb(t, LX, y, 240)
def numrow(n, title, text, y):
    return [rule(CX, y, CW), hd(n, CX, y + 24, 96, 48, 'x-large'), hd(title, CX + 120, y + 24, 640, 48, 'x-large'), pa(text, CX + 120, y + 84, 600, 72, 16)]
work = [
 {'k': '2026', 't': 'Tideline', 'd': 'Scheduling software, 34 people. Rebuilt planning so releases stopped slipping', 'role': 'Six months'},
 {'k': '2026', 't': 'Marrow & Rye', 'd': 'Meal kits, 22 people. One weekly meeting replaced eleven', 'role': 'Ten weeks'},
 {'k': '2025', 't': 'Fieldnote', 'd': 'Research tools, 41 people. Hired and settled a first head of operations', 'role': 'Four months'},
 {'k': '2025', 't': 'Common Thread', 'd': 'Repair cafés, 12 staff and 300 volunteers. A rota that survives holidays', 'role': 'Eight weeks'},
 {'k': '2024', 't': 'Lumen Bikes', 'd': 'E-bike maker, 28 people. Support moved from the founder’s phone to a team', 'role': 'Five months'},
]
SITES['consultant'] = {
 'title': 'Adaeze Cole — a consultant on Mētis', 'desc': 'An operations consultant on the new Mētis theme in its Ithaca style, laid out like a document: a label in the margin, the words beside it. What she does in three numbered lines, the numbers, recent work as a ruled list.',
 'def': {
  'name': 'Adaeze Cole', 'tagline': 'Operations for companies that grew faster than their habits.', 'variation': 'Ithaca',
  'chrome': {'header_part': 'header-a', 'footer_part': 'footer-c'},
  'pages': [
   page('Home', [
    sec('Opening', 720, [
      lab('Adaeze Cole<br>Operations · Bristol', 120),
      hd('I help thirty-person companies stop running like ten-person ones.', CX, 96, CW, 336, '__disp-s'),
      pa('The habits that got you here were built for a room where everyone could hear everyone. I spend a few months inside the company and leave it with ones that fit.', CX, 456, 600, 96, 18),
      bt('Book a first call', CX, 576, 200, '/start/'), bt('See recent work', CX + 216, 576, 200, '/work/', True),
    ]),
    sec('What I do', 720, [
      lab('What I do', 96),
      *numrow('01', 'Listen for two weeks.', 'I sit in the meetings, read the tickets and talk to everyone, including the people who have stopped saying it out loud.', 72),
      *numrow('02', 'Change three things.', 'Never thirty. Usually how work gets planned, who decides, and one meeting that has to go.', 264),
      *numrow('03', 'Stay until it holds.', 'New habits fail in week five. I am still there in week twelve, and then I am not needed.', 456),
    ], background=C(6)),
    sec('In numbers', 288, [
      lab('In numbers', 108),
      *stat('41', 'companies since 2017', CX, 96, 220), *stat('11 weeks', 'the usual stay', CX + 260, 96, 220), *stat('3', 'changes, never thirty', CX + 520, 96, 220),
    ], background=C(8)),
    sec('Said afterwards', 504, [
      lab('Said afterwards', 108),
      hd('“We thought we needed a reorganisation. We needed one calendar and someone to tell us so.”', CX, 96, CW, 216, '2-x-large'),
      pa('Jonah Reyes, founder, Tideline', CX, 336, 600, 24, 15),
      pa('<a href="/work/">What happened at Tideline →</a>', CX, 384, 600, 24, 15, fw=600),
    ]),
    sec('Recent work', 576, [
      lab('Recent work', 108),
      ledger(CX, 72, CW, work[:4], k=1, role=1),
      bt('All the work', CX, 432, 176, '/work/', True),
    ], background=C(6)),
    sec('About', 648, [
      lab('About', 108),
      im('1573496359142-b8d87734a5a2', CX, 96, 300, 400, 'Adaeze Cole'),
      hd('Ten years running operations, eight helping other people do it.', CX + 340, 96, 420, 168, 'x-large'),
      pa('I ran operations at two software companies as they went from a dozen people to two hundred, and made most of the mistakes I now get paid to spot.', CX + 340, 288, 420, 120, 16),
      pa('I work alone, with one company at a time, mostly in the south-west and always partly in the room.', CX + 340, 408, 420, 72, 16),
    ]),
    sec('Next', 504, [
      lab('Next', 132),
      hd('The first call is free, and you leave with a list.', CX, 120, CW, 144, '3-x-large'),
      pa('Forty minutes. You tell me what hurts, I tell you the three things I would look at first, and whether I am the right person to look.', CX, 288, 600, 72, 17),
      {**bt('Book a first call', CX, 372, 200, '/start/'), 'btnBg': 'theme-2', 'btnText': 'theme-1'},
    ], background=C(10)),
   ], slug='home', front=True, menu=False),
   page('Work', [
    sec('Work', 864, [
      lab('Work', 108),
      hd('Recent work', CX, 72, CW, 144, '__disp-s'),
      pa('One company at a time since 2017. These are the ones happy to be named.', CX, 240, 600, 48, 18),
      ledger(CX, 336, CW, work, k=1, role=1),
    ]),
    sec('Tideline', 648, [
      lab('In detail<br>Tideline, 2026', 108),
      hd('Releases had slipped for five quarters running.', CX, 96, CW, 120, '2-x-large'),
      pa('Thirty-four people, one roadmap and four places where work was promised. Nobody was late on purpose; nobody could see the whole of it.', CX, 240, 360, 168, 16),
      pa('We moved planning into one calendar, gave each team a say in what it could carry, and ended the Monday meeting. The next three releases shipped on the day.', CX + 400, 240, 360, 168, 16),
      *stat('5 → 0', 'late releases', CX, 456, 220), *stat('11 → 1', 'weekly meetings', CX + 260, 456, 220), *stat('6 months', 'start to finish', CX + 520, 456, 220),
    ], background=C(6)),
    sec('The room', 648, [
      lab('How it looks', 108),
      im('1623652554515-91c833e3080e', CX, 96, 370, 400, 'A hand placing yellow sticky notes on a wall'),
      im('1532622785990-d2c36a76f5a6', CX + 390, 96, 370, 400, 'Two people drawing on a whiteboard'),
      pa('Mostly it looks like this: a wall, some pens and the people who do the work.', CX, 520, 600, 48, 15),
    ]),
   ], slug='work'),
   page('Start', [
    sec('Start', 720, [
      lab('Start', 108),
      hd('How it starts', CX, 72, CW, 144, '__disp-s'),
      pa('I take on four companies a year. The next opening is in February.', CX, 240, 600, 48, 18),
      ledger(CX, 336, CW, [
        {'k': 'One', 't': 'A call', 'd': 'Forty minutes, free. You leave with the three things I would look at first', 'role': 'This week'},
        {'k': 'Two', 't': 'A week inside', 'd': 'I meet everyone and write up what I see, in plain words', 'role': 'Fixed fee'},
        {'k': 'Three', 't': 'The work', 'd': 'Two or three days a week, for as long as it takes to hold', 'role': '8 to 24 weeks'},
      ], k=1, role=1),
      bt('Write to me', CX, 624, 176, 'mailto:hello@adaezecole.example'),
    ]),
    sec('Fit', 432, [
      lab('Not for everyone', 108),
      hd('I am probably wrong for you if…', CX, 96, CW, 72, 'x-large'),
      pa('…you are under fifteen people (you need a good office manager), over a hundred and fifty (you need a firm), or looking for someone to deliver bad news you have already decided on.', CX, 192, 600, 120, 17),
    ], background=C(11)),
   ], slug='start'),
  ],
  'footer': footer([('Write', '<a href="mailto:hello@adaezecole.example">hello@adaezecole.example</a><br>Bristol, and wherever you are'), ('Next opening', 'February<br>Four companies a year')], '© 2026 Adaeze Cole · Operations'),
 }}

# ---------------------------------------------------------------- Nell Ashdown (Aeaea): a bento wall, then three big words
def ctile(x, y, w, h, kicker, title, link, href, bg, fs=26):
    return {'type': 'box', 'x': x, 'y': y, 'w': w, 'h': h, 'boxBg': bg, 'radius': 24, 'kids': [
        eb(kicker, 24, 24, w - 48), hd(title, 24, 60, w - 48, h - 132, 'large', tf={'fs': fs, 'lh': 1.15}),
        pa('<a href="' + href + '">' + link + '</a>', 24, h - 48, w - 48, 24, 15, fw=600)]}
def bigword(word, text, link, href, y):
    return [rule(80, y, 1040), hd(word, 80, y + 24, 640, 120, '__max', tf={'fs2': 8.667, 'fsMin': 40, 'lh': 1}),
            pa(text, 760, y + 36, 360, 72, 16), pa('<a href="' + href + '">' + link + '</a>', 760, y + 120, 360, 24, 15, fw=600)]
prints = [
 {'t': 'Heron, low tide', 'd': 'Two-colour linocut, 30 × 40cm, edition of 40', 'price': '£85', 'img': U('1777751006387-558bdf78a02e', 1200), 'alt': 'A colourful print lying on an old printing press'},
 {'t': 'Kitchen alphabet', 'd': 'Wood type on cream stock, A3, edition of 60', 'price': '£45', 'img': U('1792978081649-c2291ec95b50', 1200), 'alt': 'Wooden letterpress type blocks laid out flat'},
 {'t': 'Small stamps, set of six', 'd': 'Hand-cut rubber stamps in a card box, with an ink pad', 'price': '£35', 'img': U('1790949242560-44106f36b0f1', 1200), 'alt': 'Rubber stamps, ink and paper on a green cutting mat'},
]
classes = [
 {'k': 'Sat 12 Dec', 't': 'Lino for beginners', 'd': 'Cut and print a two-colour card. Everything provided, including lunch', 'role': '3 places'},
 {'k': 'Sun 13 Dec', 't': 'Print your own wrapping paper', 'd': 'Stamps, rollers and a very long table. Children welcome with an adult', 'role': 'Full'},
 {'k': 'Sat 16 Jan', 't': 'Lino for beginners', 'd': 'The same day again, for everyone who missed December', 'role': '8 places'},
 {'k': 'Sat 30 Jan', 't': 'Reduction printing', 'd': 'One block, four colours, no way back. For people who have cut lino before', 'role': '6 places'},
]
SITES['maker'] = {
 'title': 'Nell Ashdown — a printmaker on Mētis', 'desc': 'A printmaker, illustrator and teacher on the new Mētis theme in its warm Aeaea style: a wall of pictures and coloured tiles up top, her three trades as three big words, prints for sale as cards and the next workshops as a ruled list.',
 'def': {
  'name': 'Nell Ashdown', 'tagline': 'Prints, pictures and workshops, from a shed in Hebden Bridge.', 'variation': 'Aeaea',
  'chrome': {'header_part': 'header-a', 'footer_part': 'footer-c'},
  'pages': [
   page('Home', [
    sec('Wall', 1008, [
      eb('Printmaker · illustrator · teacher', 80, 84, 520),
      hd('Nell Ashdown makes pictures by hand.', 80, 120, 520, 288, '__disp-s'),
      pa('Linocuts, drawings for books and magazines, and Saturday workshops, all from a shed in Hebden Bridge.', 80, 432, 480, 72, 17),
      im('1730134426941-1def6b725da3', 640, 72, 480, 432, 'Hands carving a block with a cutting tool', 24),
      ctile(80, 528, 248, 384, 'In the shop', 'New prints from £35, posted flat.', 'See the prints →', '/prints/', C(7)),
      im('1784807742828-33e7526ca2ea', 352, 528, 376, 384, 'Black ink, a roller and a tube on a wooden table', 24),
      ctile(752, 528, 368, 180, 'Next workshop · Sat 12 Dec', 'Lino for beginners', 'Three places left →', '/workshops/', C(8), 24),
      im('1777831244837-d123cce81e11', 752, 732, 368, 180, 'Colourful artwork and books laid out on a table', 24),
    ]),
    sec('Three trades', 720, [
      *bigword('Prints', 'Linocuts in small editions, cut and printed by me on a press older than my grandmother.', 'Visit the shop →', '/prints/', 72),
      *bigword('Pictures', 'Illustration for books, magazines and the odd beer label. Drawn in pencil first, always.', 'Ask about a commission →', 'mailto:hello@nellashdown.example', 264),
      *bigword('Workshops', 'A Saturday, eight people, one long table. You go home with something you printed.', 'See the dates →', '/workshops/', 456),
    ], background=C(6)),
    sec('New in the shop', 792, [
      eb('New in the shop', 80, 96, 440), hd('Fresh off the press', 80, 144, 640, 72),
      cards(80, 264, 1040, 432, prints, price=1, bg=C(1)),
    ], background=C(12)),
    sec('About', 432, [
      im('1730134427007-31d9db377e52', 80, 108, 216, 216, 'Nell cutting paper with scissors', 108),
      hd('I trained as an illustrator, fell for lino in 2016 and never quite came back.', 360, 96, 760, 168, '2-x-large'),
      pa('Now I do both, and teach the bit in between: how to draw something simple enough to cut.', 360, 288, 600, 48, 17),
    ]),
    sec('Workshops', 648, [
      eb('In the shed', 80, 96, 440), hd('Coming up', 80, 144, 640, 72),
      ledger(80, 264, 1040, classes[:3], k=1, role=1),
      bt('All workshops', 80, 528, 184, '/workshops/', True),
    ], background=C(8)),
    sec('The letter', 432, [
      eb('Once a month', 160, 96, 880, None, 'center'), hd('New prints go to the list first.', 160, 144, 880, 72, '3-x-large', 'center'),
      pa('One email a month: what is on the press, workshop dates before they are public, and a drawing.', 320, 240, 560, 48, 17, 'center'),
      bt('Join the list', 500, 312, 200, 'mailto:hello@nellashdown.example'),
    ], background=C(7)),
   ], slug='home', front=True, menu=False),
   page('Prints', [
    sec('Prints', 432, [
      eb('The shop', 80, 72, 440), hd('Prints', 80, 120, 720, 144, '__disp-s'),
      pa('Every print is cut, inked and pulled by hand, then signed and numbered in pencil. Posted flat within the week.', 80, 288, 560, 72, 18),
    ]),
    sec('For sale', 1224, [
      cards(80, 72, 1040, 432, prints, price=1, bg=C(6)),
      cards(80, 576, 1040, 432, [
        {'t': 'Allotment in March', 'd': 'Three-colour reduction linocut, 40 × 50cm, edition of 25', 'price': '£140', 'img': U('1777831244837-d123cce81e11', 1200), 'alt': 'Colourful artwork and books laid out on a table'},
        {'t': 'Ink & roller', 'd': 'Single-colour linocut, A4, open edition', 'price': '£38', 'img': U('1784807742828-33e7526ca2ea', 1200), 'alt': 'Black ink, a roller and a tube on a wooden table'},
        {'t': 'A block of your own', 'd': 'A cut block and one proof, for people who want to print it themselves', 'price': '£60', 'img': U('1730134426941-1def6b725da3', 1200), 'alt': 'Hands carving a block with a cutting tool'},
      ], price=1, bg=C(6)),
      pa('To buy one, <a href="mailto:hello@nellashdown.example">write to me</a> with its name. I will send a payment link and post it flat.', 80, 1104, 720, 48, 16),
    ]),
   ], slug='prints'),
   page('Workshops', [
    sec('Workshops', 936, [
      eb('In the shed', 80, 72, 440), hd('Workshops', 80, 120, 720, 144, '__disp-s'),
      pa('Saturdays, ten till four, eight people. £85 with materials and lunch. You need no drawing at all.', 80, 288, 560, 72, 18),
      ledger(80, 408, 1040, classes, k=1, role=1),
      bt('Ask for a place', 80, 744, 200, 'mailto:hello@nellashdown.example'),
    ]),
    sec('Groups', 432, [
      hd('Eight of you? Have the shed to yourselves.', 160, 120, 880, 72, '3-x-large', 'center'),
      pa('Birthdays, hen dos and teams who need a day without screens. Any Sunday, from £560.', 320, 216, 560, 48, 17, 'center'),
      bt('Ask about a date', 500, 288, 200, 'mailto:hello@nellashdown.example'),
    ], background=C(9)),
   ], slug='workshops'),
  ],
  'footer': footer([('Find me', 'The shed behind 14 Market Street<br>Hebden Bridge HX7<br>Open Saturdays, 10–4'), ('Write', '<a href="mailto:hello@nellashdown.example">hello@nellashdown.example</a><br>Commissions open from January')], '© 2026 Nell Ashdown · Everything on this site was cut by hand, except the site'),
 }}

# ---------------------------------------------------------------- Undertow (Cimmeria): a flyer, all type
def info(label, value, x, y, w=236):
    # a tile, so label and value stay together when the row stacks on a phone. (A box whose ground is only
    # a hairline is read as a light ground by the contrast sentinel, which then turns its words dark.)
    return [{'type': 'box', 'x': x, 'y': y, 'w': w, 'h': 96, 'boxBg': C(9), 'radius': 0, 'kids': [
        eb(label, 20, 20, w - 40), hd(value, 20, 44, w - 40, 36, 'large', tf={'fs': 20, 'lh': 1.2})]}]
def datetile(x, y, month, day, who, note):
    return {'type': 'box', 'x': x, 'y': y, 'w': 248, 'h': 312, 'boxBg': C(9), 'radius': 0, 'kids': [
        eb(month, 24, 24, 200), hd(day, 24, 48, 200, 120, 'large', tf={'fs': 104, 'lh': 1}),
        hd(who, 24, 192, 200, 48, 'large', tf={'fs': 20, 'lh': 1.2}), pa(note, 24, 252, 200, 24, 13)]}
room1 = [
 {'k': '23:00', 't': 'Saoirse K', 'd': 'Resident. Opens slow, dub and broken beat'},
 {'k': '01:00', 't': 'Mala Fide', 'd': 'Guest, from Bristol. Three hours'},
 {'k': '04:00', 't': 'Ottoline', 'd': 'Resident. Closes'},
]
room2 = [
 {'k': '23:30', 't': 'Tenderfoot', 'd': 'Ambient and low, for sitting down'},
 {'k': '01:30', 't': 'Big Ears Sound', 'd': 'Reggae sevens, all vinyl'},
 {'k': '03:30', 't': 'Open decks', 'd': 'Bring two records. Ask at the bar'},
]
SITES['club'] = {
 'title': 'Undertow — a club night on Mētis', 'desc': 'A monthly club night in a Leeds basement on the new Mētis theme in its black-and-white Cimmeria style: a flyer made of type, the night as a two-room timetable, the next dates as big numbers and the house rules.',
 'def': {
  'name': 'Undertow', 'tagline': 'First Friday of the month. A basement in Leeds.', 'variation': 'Cimmeria',
  'chrome': {'header_part': 'header-a', 'footer_part': 'footer-c'},
  'pages': [
   page('Home', [
    sec('Flyer', 792, [
      eb('First Friday of every month · Leeds', 80, 96, 640),
      hd('Undertow', 80, 144, 1040, 216, '__max', tf={'fs2': 13.5, 'fsMin': 40, 'lh': 0.9, 'tt': 'uppercase', 'ls2': -0.04}),
      pa('Bass music in a low room with a proper system. Two rooms, three hundred people, no phones on the floor.', 80, 384, 520, 72, 19),
      bt('Get tickets', 80, 480, 184, '/dates/'), bt('What to expect', 280, 480, 200, '/info/', True),
      *info('Next', 'Fri 4 December', 80, 600), *info('Doors', '11pm till 5', 348, 600), *info('Where', 'Hope Vaults, LS2', 616, 600), *info('In', '£8 before midnight', 884, 600),
    ]),
    sec('Inside', 384, [
      im('1578736641330-3155e606cd40', 80, 0, 248, 336, 'People dancing in a dark room', 2, src=U('1578736641330-3155e606cd40', 900, True)),
      im('1470225620780-dba8ba36b745', 344, 0, 248, 336, 'The silhouette of a DJ at the decks', 2, src=U('1470225620780-dba8ba36b745', 900, True)),
      im('1545128485-c400e7702796', 608, 0, 248, 336, 'A crowd in a small club', 2, src=U('1545128485-c400e7702796', 900, True)),
      im('1571266028243-d220c6a7edbf', 872, 0, 248, 336, 'A DJ mixer lit up in the dark', 2, src=U('1571266028243-d220c6a7edbf', 900, True)),
    ]),
    sec('The night', 648, [
      eb('Friday 4 December', 80, 96, 440), hd('Who is on, and when', 80, 144, 720, 72),
      hd('Room one', 80, 264, 500, 48, 'large', tf={'fs': 22}), ledger(80, 312, 500, room1, k=1),
      hd('Room two', 620, 264, 500, 48, 'large', tf={'fs': 22}), ledger(620, 312, 500, room2, k=1),
    ], background=C(6)),
    sec('Dates', 648, [
      eb('In the diary', 80, 96, 440), hd('Next four', 80, 144, 640, 72),
      datetile(80, 264, 'December', '04', 'Mala Fide', 'Bristol · 3 hours'),
      datetile(344, 264, 'January', '08', 'Residents only', 'All night, £5 in'),
      datetile(608, 264, 'February', '05', 'Kessler Twins', 'Berlin · live set'),
      datetile(872, 264, 'March', '05', 'Fifth birthday', 'Guests to be named'),
    ]),
    sec('House rules', 576, [
      eb('House rules', 160, 96, 880, None, 'center'),
      hd('No phones on the floor.', 160, 144, 880, 72, '2-x-large', 'center'),
      hd('Look after each other.', 160, 228, 880, 72, '2-x-large', 'center'),
      hd('No guest list, no dress code.', 160, 312, 880, 72, '2-x-large', 'center'),
      pa('If someone is making your night worse, tell anyone in a white T-shirt. We will deal with it, and you will not be asked to explain twice.', 320, 420, 560, 72, 16, 'center'),
    ], background=C(6)),
    sec('See you there', 576, [
      hd('See you at the front.', 160, 192, 880, 96, '3-x-large', 'center'),
      pa('Friday 4 December · Hope Vaults, Leeds · 11pm till 5', 160, 300, 880, 24, 16, 'center'),
      bt('Get tickets', 508, 360, 184, '/dates/'),
    ], image=U('1483821838526-8d9756a6e1ed', 2000, True), background=C(1), tint=62),
   ], slug='home', front=True, menu=False),
   page('Dates', [
    sec('Dates', 864, [
      eb('First Fridays', 80, 72, 440), hd('Dates', 80, 120, 720, 144, '__max', tf={'fs2': 10, 'fsMin': 44, 'lh': 0.95, 'tt': 'uppercase', 'ls2': -0.03}),
      pa('Tickets are £8 before midnight and £12 after, on the door or by email. Three hundred in and that is the room full.', 80, 288, 560, 72, 18),
      ledger(80, 408, 1040, [
        {'k': 'Fri 4 Dec', 't': 'Mala Fide', 'd': 'Bristol. Three hours in room one, with Saoirse K and Ottoline', 'role': 'Tickets'},
        {'k': 'Fri 8 Jan', 't': 'Residents only', 'd': 'All night long, both rooms. £5 in, all night', 'role': 'On the door'},
        {'k': 'Fri 5 Feb', 't': 'Kessler Twins', 'd': 'Berlin. A live set, their first in the north', 'role': 'Tickets'},
        {'k': 'Fri 5 Mar', 't': 'Fifth birthday', 'd': 'Guests to be named. It will sell out', 'role': 'Soon'},
      ], k=1, role=1),
      bt('Email for tickets', 80, 744, 216, 'mailto:door@undertow.example'),
    ]),
    sec('Before', 576, [
      eb('Played here', 80, 96, 440), hd('Five years of guests', 80, 144, 640, 72),
      pa('Mala Fide · Kessler Twins · Ottoline · Big Ears Sound · Halfmoon · DJ Persimmon · Low Tide Collective · Saoirse K · Tenderfoot · The Night Bus · Odd Sock · Brine · Aunt Maud · Little Engine · Wren &amp; Co.', 80, 264, 1040, 168, 22),
    ], background=C(6)),
   ], slug='dates'),
   page('Info', [
    sec('Info', 720, [
      eb('Before you come', 80, 96, 440), hd('Info', 80, 144, 480, 144, '__max', tf={'fs2': 10, 'fsMin': 44, 'lh': 0.95, 'tt': 'uppercase', 'ls2': -0.03}),
      pa('Hope Vaults is under the railway arches on Hope Street, Leeds LS2. Look for the white door with no sign. Ten minutes from the station, night buses outside.', 80, 312, 440, 120, 18),
      pa('Over-18s. Bring ID.<br>Cloakroom £2. Earplugs free at the bar.<br>Step-free by the side door: ask anyone on the door.', 80, 456, 440, 96),
      {'type': 'embed', 'x': 640, 'y': 96, 'w': 480, 'h': 528, 'url': 'https://www.google.com/maps?q=Leeds+railway+station&output=embed', 'radius': 0},
    ]),
    sec('Asked a lot', 576, [
      eb('Asked a lot', 80, 96, 440), hd('Before you ask', 80, 144, 640, 72),
      ledger(80, 264, 1040, [
        {'t': 'Can I come alone?', 'd': 'A third of the room does. Say so at the door and we will point you at the friendly end of the bar'},
        {'t': 'Why no phones?', 'd': 'Because it is better. Stickers go over the cameras at the door. Text outside, or in room two'},
        {'t': 'Can I play?', 'd': 'Open decks in room two from half past three. Bring two records, ask at the bar'},
      ]),
    ], background=C(6)),
   ], slug='info'),
  ],
  'footer': footer([('Next', 'Friday 4 December<br>11pm till 5<br>£8 before midnight'), ('Door', 'Hope Vaults, Hope Street<br>Leeds LS2<br><a href="mailto:door@undertow.example">door@undertow.example</a>')], '© 2026 Undertow · Over-18s · Look after each other'),
 }}


CREDITS = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'metis-credits.json'))) if os.path.exists(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'metis-credits.json')) else {}
def used(o, acc):
    if isinstance(o, dict):
        for v in o.values(): used(v, acc)
    elif isinstance(o, list):
        for v in o: used(v, acc)
    elif isinstance(o, str) and 'images.unsplash.com/photo-' in o:
        acc.append(o.split('photo-')[1].split('?')[0])
    return acc

for sid, s in SITES.items():
    d = s['def']
    seen = []
    for i in used(d, []):
        c = CREDITS.get(i)
        if c and c not in seen: seen.append(c)
    if seen: d['credits'] = seen
    json.dump(d, open(f'{WT}/spike/site-def-metis-{sid}.json', 'w'), indent=1, ensure_ascii=False)
    blob = base64.b64encode(json.dumps(d, ensure_ascii=False).encode()).decode()
    extra = ''
    if sid == 'podcast':
        extra = ("wp_update_user( array( 'ID' => 1, 'display_name' => 'Ruth & Tomasz', 'nickname' => 'Ruth & Tomasz' ) );\n"
                 "wp_update_term( 1, 'category', array( 'name' => 'Notes', 'slug' => 'notes' ) );\n")
    code = ("<?php\nrequire '/wordpress/wp-load.php';\nupdate_option( 'gogh_booted_as', 'metis-" + sid + "' );\nwp_set_current_user( 1 );\n"
            "try { wp_trash_post( 1 ); } catch ( \\Throwable $e ) {}\ntry { wp_trash_post( 2 ); } catch ( \\Throwable $e ) {}\n" + extra +
            "$def = json_decode( base64_decode( '" + blob + "' ), true );\n$r = gogh_site_def_boot( $def );\n"
            "if ( is_wp_error( $r ) ) { error_log( 'gogh metis boot: ' . $r->get_error_message() ); }\n")
    bp = {
     '$schema': 'https://playground.wordpress.net/blueprint-schema.json',
     'meta': {'title': s['title'], 'description': s['desc'], 'author': 'jamiemarsland', 'categories': ['Site']},
     'landingPage': '/?gogh-edit=1&gogh-build=1',
     'preferredVersions': {'php': '8.2', 'wp': 'latest'},
     'features': {'networking': True}, 'login': True,
     'steps': [
      {'step': 'installTheme', 'themeData': {'resource': 'git:directory', 'url': 'https://github.com/WordPress/metis', 'ref': METIS_REF, 'refType': 'commit', 'path': '/'}, 'options': {'activate': True, 'targetFolderName': 'metis'}},
      {'step': 'installPlugin', 'pluginData': {'resource': 'url', 'url': 'https://raw.githubusercontent.com/jamiemarsland/gogh-demo/main/gogh-playground.zip'}, 'options': {'activate': True}},
      {'step': 'runPHP', 'code': code},
      {'step': 'setSiteOptions', 'options': {'blogname': d['name'], 'blogdescription': d['tagline']}},
     ]}
    json.dump(bp, open(f'{WT}/blueprint-metis-{sid}.json', 'w'), indent=1, ensure_ascii=False)
    n = sum(len(p.get('sections', [])) for p in d['pages'])
    print(sid, len(d['pages']), 'pages', n, 'sections', len(json.dumps(d)), 'bytes', len(seen), 'credits')
