#!/usr/bin/env python3
"""Three blueprints on the Mētis theme (WordPress/metis), one per style:
Halyard (a band, Aeolia), Maron (a wine bar, Ismarus), The Long Border (a podcast, Ogygia).
Writes spike/site-def-metis-<id>.json and blueprint-metis-<id>.json into the gogh worktree given as argv[1]."""
import json, base64, sys, os
WT = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser('~/gogh/release-789')
METIS_REF = '915e5e126c94c71024be9f95afb45a6aefd60554'

def U(i, w=1600): return f'https://images.unsplash.com/photo-{i}?w={w}&q=80&fm=jpg&fit=max'
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
def cards(x, y, w, h, items, layout='g3', role=0, bg=None):
    return {'type': 'cards', 'x': x, 'y': y, 'w': w, 'h': h, 'cards': {
        'items': items, 'feat': -1, 'layout': layout, 'look': 'panel', 'pic': 'square', 'act': 'none', 'align': 'left', 'round': 1, 'titles': 1,
        'extras': {'price': 0, 'role': role, 'k': 0, 'n': 0},
        'type': {'t': {'tf': {'fs': 20, 'fw': 700}, 'body': 1}, 'd': {'tf': {'fs': 15}}, 'role': {'tf': {'fs': 13, 'col': soft(66)}}},
        'box': {'look': 'panel', 'gap': 12, 'minH': h, 'bg': bg or C(6), 'radius': 16, 'pad': 24}}}
def stat(n, label, x, y, w=220):
    return [hd(n, x, y, w, 48, 'x-large'), pa(label, x, y + 48, w, 24, 13)]
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
    sec('Hero', 720, [
      eb('New album · out 6 March', 80, 72, 440),
      hd('Slack Water', 80, 120, 560, 216, '__disp-s'),
      pa('Ten songs about leaving a harbour town and coming back to it, written in a net loft over one long winter. The second record from Halyard.', 80, 360, 460, 96, 18),
      bt('Hear the record', 80, 504, 200, '/music/'), bt('Tour dates', 296, 504, 160, '/tour/', True),
      im('1608319917470-9d9179430f8d', 640, 48, 480, 576, 'A singer mid-song under purple stage light'),
      pa('Morwenna, The Poly, Falmouth', 640, 624, 480, 24, 13, 'right'),
    ]),
    sec('Spring tour', 792, [
      eb('On the road', 80, 96, 440), hd('The spring tour', 80, 144, 640, 72),
      pa('<a href="/tour/">All ten dates →</a>', 760, 168, 360, 24, 15, 'right', fw=600, m={'hidden': True}),
      ledger(80, 264, 1040, tour[:5], k=1, role=1),
      bt('See every date', 80, 672, 200, '/tour/', True),
    ]),
    sec('The record', 720, [
      im('1603048588665-791ca8aea617', 80, 96, 480, 480, 'A black vinyl record turning on a turntable'),
      eb('The record', 640, 120, 440), hd('Ten songs, one winter, no click track.', 640, 168, 480, 168),
      pa('We recorded it live in a room, the four of us facing each other, in six days. What you hear is what happened. It comes on heavy black vinyl with a lyric sheet, or wherever you listen.', 640, 360, 460, 120),
      bt('Buy the vinyl · £24', 640, 504, 232, '/music/'),
    ], background=C(7)),
    sec('Live', 576, [
      hd('“The best night out in a harbour town since the fleet came in.”', 160, 192, 880, 144, '2-x-large', 'center', color='theme-1'),
      pa('Tidelines magazine, on the Falmouth launch', 160, 360, 880, 24, 14, 'center', color='theme-1'),
    ], image=U('1632054553195-bfd7034fee25', 2000), background=C(2), tint=62),
    sec('The band', 792, [
      eb('Who we are', 80, 96, 440), hd('Four people and a van.', 80, 144, 480, 72),
      pa('Morwenna Pascoe sings and plays guitar. Jago Trethewey plays the other guitar, louder. Kit Hallam plays bass and drives. Dev Sandhu plays drums and never stops talking.', 80, 240, 460, 168),
      pa('We met working summer jobs on the same quay in 2019. The van is called Doris.', 80, 432, 460, 96),
      rule(80, 576, 480), *stat('2', 'records', 80, 600, 140), *stat('214', 'shows', 240, 600, 140), *stat('1', 'van, just', 400, 600, 160),
      im('1481886756534-97af88ccb438', 640, 96, 480, 600, 'A band rehearsing in a small studio'),
    ]),
    sec('Hear it first', 432, [
      eb('The list', 160, 96, 880, None, 'center'), hd('Hear it first.', 160, 144, 880, 72, '3-x-large', 'center'),
      pa('New songs, early tickets and the odd photograph of Doris broken down. About once a month.', 320, 240, 560, 48, 17, 'center'),
      bt('Join the list', 500, 312, 200, 'mailto:hello@halyard.example'),
    ], background=C(6)),
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
    sec('Hero', 720, [
      eb('Wine bar & bottle shop · Margate', 80, 72, 440),
      hd('Wine with nothing added and nothing to prove.', 80, 120, 540, 288, '__disp-s'),
      pa('A hundred and forty bottles from people who farm their own grapes, twelve of them open by the glass. Drink in at the long table or take one home.', 80, 432, 460, 96, 18),
      bt('See the list', 80, 552, 176, '/the-list/'), bt('Find us', 272, 552, 136, '/visit/', True),
      im('1596641069082-b1d5ac2b6fc1', 640, 48, 480, 576, 'Wooden chairs and tables in front of shelves of wine'),
    ]),
    sec('By the glass', 792, [
      eb('Open this week', 80, 96, 440), hd('By the glass', 80, 144, 640, 72),
      pa('<a href="/the-list/">The whole list →</a>', 760, 168, 360, 24, 15, 'right', fw=600, m={'hidden': True}),
      ledger(80, 264, 1040, glass, price=1),
      pa('125ml. Every bottle on the shelf can be opened for £8 corkage.', 80, 672, 640, 24, 14),
    ]),
    sec('Drink in or take away', 720, [
      im('1558670460-cad0c19b1840', 80, 96, 480, 528, 'White wine being poured at a table of friends'),
      eb('How it works', 640, 120, 440), hd('Drink in, or take it home.', 640, 168, 480, 120),
      pa('Everything on the shelf has a price on the neck. Take it home at that price, or add £8 and we will open it here with bread, anchovies and whatever cheese came in.', 640, 312, 460, 120),
      rule(640, 456, 480), *stat('140', 'bottles', 640, 480, 140), *stat('12', 'by the glass', 800, 480, 140), *stat('£8', 'corkage', 960, 480, 160),
    ], background=C(6)),
    sec('Why', 576, [
      hd('“Good wine is grapes, time and somebody paying attention.”', 160, 192, 880, 144, '2-x-large', 'center'),
      pa('Ines Maron, who chooses the bottles', 160, 360, 880, 24, 14, 'center'),
    ], image=U('1537640538966-79f369143f8f', 2000), background=C(1), tint=70),
    sec('This month', 648, [
      eb('At the long table', 80, 96, 440), hd('This month', 80, 144, 640, 72),
      ledger(80, 264, 1040, [
        {'k': 'Thu 5', 't': 'Meet the grower: Domaine des Quatre Vents', 'd': 'Six wines and the person who made them', 'role': '£28'},
        {'k': 'Sun 15', 't': 'Orange wine, start to finish', 'd': 'A tasting for people who are not sure yet', 'role': '£22'},
        {'k': 'Thu 19', 't': 'Oysters and Muscadet', 'd': 'Whitstable natives, shucked at the bar', 'role': 'Walk in'},
        {'k': 'Sat 28', 't': 'Bottle swap', 'd': 'Bring one you love, leave with one you have never heard of', 'role': 'Free'},
      ], k=1, role=1),
    ]),
    sec('Find us', 648, [
      eb('Find us', 80, 120, 440), hd('Northdown Road, by the sea.', 80, 168, 480, 120),
      pa('Wednesday and Thursday, 4 to 10<br>Friday and Saturday, 12 to 11<br>Sunday, 12 to 6', 80, 312, 440, 96),
      pa('No bookings under six. Dogs welcome, children until seven.', 80, 432, 440, 48, 15),
      bt('Plan a visit', 80, 504, 168, '/visit/', True),
      {'type': 'embed', 'x': 640, 'y': 96, 'w': 480, 'h': 456, 'url': 'https://www.google.com/maps?q=Northdown+Road,+Cliftonville,+Margate&output=embed', 'radius': 16},
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
      eb('A podcast · every other Thursday', 80, 72, 440),
      hd('The Long Border', 80, 120, 540, 216, '__disp-s'),
      pa('Two gardeners visit people who grow things, in glasshouses, on allotments and up against north-facing walls, and ask them how it is going.', 80, 360, 460, 96, 18),
      bt('Latest episode', 80, 504, 192, '/?name=episode-48'), bt('All episodes', 288, 504, 176, '/episodes/', True),
      im('1758562954971-7808c31fa98f', 640, 48, 480, 576, 'A microphone on a wooden table beside an armchair and candles'),
    ]),
    sec('Latest episode', 648, [
      im('1675449215007-def921b7c0ca', 80, 96, 520, 456, 'A brick and glass Victorian greenhouse'),
      eb('Episode 48 · 52 min', 680, 120, 440), hd('The greenhouse that paid for itself', 680, 168, 440, 168),
      pa('Margaret Ashby reglazed a derelict Victorian glasshouse one pane at a time. Forty years of tomatoes later, she shows us round in November, when it is the only warm place for miles.', 680, 360, 420, 120),
      bt('Listen now', 680, 504, 160, '/?name=episode-48'),
    ], background=C(6)),
    {'take': 'Latest posts', 'name': 'Recent episodes', 'heading': 'Recent episodes', 'posts': {'look': 'ledger', 'count': 5, 'show': {'date': True, 'excerpt': False}}},
    sec('Listen', 360, [
      eb('Wherever you listen', 160, 72, 880, None, 'center'), hd('Free, every other Thursday.', 160, 120, 880, 72, '3-x-large', 'center'),
      bt('Apple Podcasts', 208, 240, 184, '#', True), bt('Spotify', 408, 240, 184, '#', True), bt('Pocket Casts', 608, 240, 184, '#', True), bt('RSS feed', 808, 240, 184, '/feed/', True),
    ], background=C(8)),
    sec('Your hosts', 792, [
      eb('Your hosts', 80, 96, 440), hd('Two gardeners, one microphone.', 80, 144, 720, 72),
      im('1724556295070-5f8bff2c7f3f', 80, 264, 224, 312, 'Ruth Calder in her garden'),
      hd('Ruth Calder', 336, 288, 248, 48, 'large', tf={'fs': 26, 'lh': 1.15}),
      pa('Thirty years a head gardener, now tending a long border of her own in Shropshire. Asks the awkward questions.', 336, 360, 248, 168, 15),
      im('1759497860802-9cba5782b455', 624, 264, 224, 312, 'Tomasz Nowak on his allotment'),
      hd('Tomasz Nowak', 880, 288, 240, 48, 'large', tf={'fs': 26, 'lh': 1.15}),
      pa('Grows vegetables on a no-dig allotment in Leeds and writes about soil. Brings the biscuits.', 880, 360, 240, 168, 15),
      rule(80, 624, 1040), *stat('48', 'episodes', 80, 648, 200), *stat('31', 'gardens visited', 360, 648, 200), *stat('0', 'adverts', 640, 648, 200), *stat('2019', 'since', 920, 648, 200),
    ]),
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
