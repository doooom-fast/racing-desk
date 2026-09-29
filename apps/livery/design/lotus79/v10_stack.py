# Shared layer stack for v10: file, colour, roughness (None = template gloss), label.
GHOST=[110,26,7]; DEEP=[168,42,12]; CORE=[220,55,20]; HOT=[255,122,26]; PALE=[255,176,103]
BASE=[10,10,10]
STACK = [
 ('v10_3_spine.png',          DEEP,  255,  'Spine stripe, torn edges - matte'),
 ('v10_2_chevron0.png',       DEEP,  None, 'Nose chevron 1'),
 ('v10_2_chevron1.png',       CORE,  None, 'Nose chevron 2'),
 ('v10_2_chevron2.png',       HOT,   None, 'Nose chevron 3'),
 ('v10_4_dissolveA.png',      CORE,  None, 'Sidepod ring dissolve A'),
 ('v10_4_dissolveB.png',      HOT,   None, 'Sidepod ring dissolve B'),
 ('v10_5_hashes.png',         PALE,  None, 'Lightning hash dissolve'),
 ('v10_7_speedsports.png',    CORE,  255,  'SPEEDSPORTS matte - outer decks'),
 ('v10_6_wordmark.png',       CORE,   None, 'DOOOOM wordmark - rear deck'),
 ('v10_9_nose.png',           CORE,   None, 'Nose lockup'),
 ('v10_9_wing.png',           CORE,  None, 'Rear wing - Blood Incantation'),
 ('v10_11_wing_under.png',    CORE,  None, 'Rear wing underside - DOOOOM'),
 ('v10_10_border.png',        DEEP,  255,  'Torn fringe border - flanks'),
 ('v10_8_sponsors_core.png',  CORE,  None, 'Sponsors - DEATH + Cisco'),
 ('v10_8_sponsors_hot.png',   CORE,   None, 'Sponsor - Liquid Death'),
]
