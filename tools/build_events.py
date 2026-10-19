"""Single source of truth for the real programme. Run: python3 tools/build_events.py
Writes events.csv and refreshes the FINAL_EVENTS block inside Code.gs."""
import csv, json, re, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
HEAD = ['ID','Cup','Name','Type (Workshop/Selection/Both)','Workshop date (YYYY-MM-DD)','Workshop start (HH:MM)','Workshop end','Workshop venue',
        'Selection date (YYYY-MM-DD)','Selection start (HH:MM)','Selection end','Selection venue','About','Workshop slots (separate with |)']

def ev(id, cup, name, type, wd='', ws='', we='', wv='', sd='', ss='', se='', sv='', about='', slots=''):
    return [id, cup, name, type, wd, ws, we, wv, sd, ss, se, sv, about, slots]

EVENTS = [
 # Photography Cup
 ev('PHO1','Photography Cup','Open-for-All Workshops','Workshop', wv='Online', about='Open to all. Online workshops running throughout DP, dates to be announced.'),
 ev('PHO2','Photography Cup','Contingent Selection','Selection', sd='2026-10-28', about='Contingent selection. Time and venue to be announced.'),
 # Quiz Cup
 ev('QUI1','Quiz Cup','Quiz Week','Selection', sd='2026-10-28 to 2026-11-03', ss='18:00', sv='Bhatnagar Auditorium', about='Contingent selection. From 6 PM each day.'),
 # Digital Arts Cup
 ev('DIG1','Digital Arts Cup','Digital Illustration','Workshop', wd='2026-10-17, 2026-10-20', ws='10:00', we='11:00', wv='Online', about='Open to all.'),
 ev('DIG2','Digital Arts Cup','3D Sculpting','Workshop', wd='2026-10-23, 2026-10-26', ws='19:30', we='20:30', wv='Online', about='Open to all.'),
 ev('DIG3','Digital Arts Cup','Digital Arts','Selection', sd='2026-10-30', ss='17:30', se='20:30', sv='S301/302', about='Selection interview. Digital art task submission deadline: 29 Oct.'),
 # Fashion Cup
 ev('FAS1','Fashion Cup','Costume Design','Both', wd='2026-10-24', wv='Online', sd='2026-10-27', ss='17:30', se='20:30', sv='S301/302', about='Workshop is open to all.'),
 ev('FAS2','Fashion Cup','Fashion Designing','Workshop', wd='2026-10-24', wv='Online'),
 ev('FAS3','Fashion Cup','Fashion Photography','Workshop', wd='2026-10-27', wv='Offline', about='Offline workshop, no venue needed.'),
 ev('FAS4','Fashion Cup','Fashion','Selection', sd='2026-10-28 to 2026-10-29', ss='18:00', sv='Kalidas'),
 # Fine Arts Cup
 ev('FIN1','Fine Arts Cup','Sketching','Selection', sd='2026-10-27, 2026-10-28', ss='17:30', se='20:30', sv='S301/302'),
 ev('FIN2','Fine Arts Cup','Charcoal Art','Selection', sd='2026-10-28', ss='17:30', se='20:30', sv='S301/302'),
 ev('FIN3','Fine Arts Cup','Canvas Painting','Selection', sd='2026-10-29', ss='17:30', se='20:30', sv='S301/302'),
 # Filmmaking Arts Cup
 ev('FIL1','Filmmaking Arts Cup','Crew','Selection', sd='2026-10-27 to 2026-10-29', sv='VP Room (preferred)'),
 ev('FIL2','Filmmaking Arts Cup','Acting Auditions and Music Team','Selection', sd='2026-10-30 to 2026-11-03, 2026-11-09 to 2026-11-10', sv='VP Room (preferred)', about='Round 1: 30 Oct - 3 Nov. Round 2: 9 - 10 Nov.'),
 # Comedic Arts Cup
 ev('COM1','Comedic Arts Cup','Improv','Both', wd='2026-10-27', ws='18:00', we='22:00', wv='SN Bose / Raman / Bhatnagar', sd='2026-10-28', sv='SN Bose / Raman / Bhatnagar', about='Buffer dates for Improv selections: 29 Oct - 2 Nov.'),
 ev('COM2','Comedic Arts Cup','Stand-up','Selection', sd='2026-10-29 to 2026-11-02', sv='SN Bose / Raman / Bhatnagar', about='These dates also act as buffer dates for Improv selections.'),
 # Culinary Arts Cup
 ev('CUL1','Culinary Arts Cup','Culinary Arts','Selection', sd='2026-10-27 to 2026-10-29, 2026-11-02 to 2026-11-03', sv='Round 1: any classroom or auditorium. Round 2: Gymkhana Kitchen and ESR', about='Round 1: 27 - 29 Oct. Round 2: 2 - 3 Nov.'),
 ev('CUL2','Culinary Arts Cup','Mixology (with Open IIT)','Selection', sd='2026-10-30', about='Held together with Open IIT.'),
 # Dance Arts Cup
 ev('DAN1','Dance Arts Cup','Dance Arts','Selection', sd='2026-11-04 to 2026-11-05', ss='18:00', sv='Vikramshila V1 / V2 / V3 / V4', about='Contingent selection.'),
 # Literary Arts Cup
 ev('LIT1','Literary Arts Cup','English Slam Poetry','Selection', sd='2026-10-29 to 2026-10-30', sv='Main Building Auditoriums / Gargi / Maitreyee / Vikramshila Rooms'),
 ev('LIT2','Literary Arts Cup','Hindi Creative and English Poetry Writing','Selection', sd='2026-10-31', sv='Bhatnagar / Raman Auditorium', about='Writing event.'),
 ev('LIT3','Literary Arts Cup','Mushaira and Hindi Slam Poetry','Selection', sd='2026-10-31 to 2026-11-01', sv='Main Building Auditoriums / Gargi / Maitreyee / Vikramshila Rooms'),
 ev('LIT4','Literary Arts Cup','English Creative and Hindi Poetry Writing','Selection', sd='2026-11-01', sv='Bhatnagar / Raman Auditorium', about='Writing event.'),
 # Speaking Arts Cup
 ev('SPE1','Speaking Arts Cup','J-a-M','Both', wd='2026-10-27', wv='Any Main Building room', sd='2026-10-28 to 2026-10-29', sv='Two separate Main Building rooms'),
 ev('SPE2','Speaking Arts Cup','Cryptic','Both', wd='2026-10-28', wv='Separate Main Building room', sd='2026-10-29, 2026-10-30', sv='Prelims: separate Main Building room. Final round: any Main Building room', about='Prelims on 29 Oct, final round on 30 Oct.'),
 ev('SPE3','Speaking Arts Cup','Scrabble','Both', wd='2026-10-30', wv='Any Main Building room', sd='2026-10-31', sv='Open IIT-booked room or Main Building room', about='Selection is held together with Open IIT.'),
]
assert len({e[0] for e in EVENTS}) == len(EVENTS) and all(len(e) == 14 for e in EVENTS)
for e in EVENTS:
    t = e[3]
    assert t in ('Workshop','Selection','Both')
    if t == 'Workshop': assert not e[8], e[0]
    if t == 'Selection': assert not e[4], e[0]
    for i in (4, 8):
        assert re.fullmatch(r'(\d{4}-\d{2}-\d{2}( to \d{4}-\d{2}-\d{2})?)(, \d{4}-\d{2}-\d{2}( to \d{4}-\d{2}-\d{2})?)*|', e[i]), (e[0], e[i])

with open(root / 'events.csv', 'w', newline='', encoding='utf-8') as f:
    w = csv.writer(f); w.writerow(HEAD); w.writerows(EVENTS)

js = 'const FINAL_EVENTS = [\n' + ',\n'.join('  ' + json.dumps(e, ensure_ascii=False) for e in EVENTS) + '\n];'
cg = root / 'Code.gs'
src = cg.read_text(encoding='utf-8')
block = '// BEGIN FINAL EVENTS (generated by tools/build_events.py)\n' + js + '\n// END FINAL EVENTS'
if '// BEGIN FINAL EVENTS' in src:
    src = re.sub(r'// BEGIN FINAL EVENTS.*?// END FINAL EVENTS', lambda m: block, src, flags=re.S)
    cg.write_text(src, encoding='utf-8')
print(len(EVENTS), 'events,', len({e[1] for e in EVENTS}), 'cups')
