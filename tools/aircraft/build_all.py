"""Build the airliner models for Boplo Flight from FlightGear sources: glTF + livery textures."""
import subprocess, json, os, sys, shutil, struct
SP = os.path.dirname(os.path.abspath(__file__)); FG = os.environ.get('FG_SRC', SP + '/fg'); OUT = os.environ.get('OUT', os.path.join(SP, '../../dist/aircraft-models'))
E = 'Engines/Models'
A320 = open(SP + '/a320parts.txt').read().split()
A320 = [p.replace('$E', E) for p in A320]
L8 = 'Models/Liveries/748I'
PLANES = [
  ('a320', FG + '/A320-family', A320 + ['--texdirs', 'Models,Models/LandingGears', '--keep', 'Cockpit|Intake', '--mirror', '--gear-extra', r'^(D_STRUCT\.L|FITTING)$'], 'NWA', [('A320-NWA.png', 'cfg320.json'), ('NWA.png', 'cfg320e.json')]),
  ('b737', FG + '/737-800/Models', ['737-800.ac', 'LWing.ac', 'RWing.ac', 'VertStab.ac', 'HorzStab.ac', 'winglet.ac', 'nosegear.ac'], '737-800', [('737-800.png', 'cfg737.json')]),
  ('b787', FG + '/787-8/Models', ['787-8.ac'], 'BOE', [('BOE.png', 'cfg787.json')]),
  ('a350', FG + '/A350XWB/Models', ['A350XWB-900.ac', '--maxtex', '1024', '--gear-extra', '^lamps$'], 'a350xwb', [('a350xwb.png', 'cfg350.json')]),
  ('b748', FG + '/747-8i', ['Models/747-8i.ac', 'Models/747-8i_gear.ac', '--gear-extra', '^Mesh[68]$', '--tex', f'fuselage.png={L8}/GREEN_fuselage.png', '--tex', f'turbofan.png={L8}/VRG_turbofan_white.png', '--tex', f'wings.png={L8}/wings.png', '--texdirs', 'Models'], 'fuselage|turbofan', [('GREEN_fuselage.png', 'cfg748.json'), ('VRG_turbofan_white.png', 'cfg748e.json')]),
  ('e175', FG + '/E-jet-family/Models', ['erj175.ac'], 'blank175|blank', [('blank175.png', 'cfg175.json'), ('blank.png', 'cfg175e.json')]),
  ('c750', FG + '/CitationX/Models', ['CitationX.ac', '--tex', 'livery1.png=Liveries/Blank.png', '--gear', r'(?i)wheel|shock|strut|tarm|geardoor|gear|well|damper', '--drop', r'^(Cabin\.lwrdoor|step|LHspeedbrake|RHspeedbrake|Land1|Land2|Taxi|Bcn1|Bcn2|Strb1|Strb2|redlamp\..*)$'], 'Blank', [('Blank.png', 'cfgc750.json')]),
]
SURF = {'a320': [('flap', '^Flap[LR][12]$'), ('ail', '^Aileron[LR]$'), ('elev', '^Elevator[LR]$'), ('rud', '^Rudder_1$'), ('spoil', '^Spoiler[LR]\\d$'), ('fan', '^fanWheel$|^blades$')], 'b737': [('flap', '^(rh)?(aft)?flap[IO]/B$'), ('ail', '^[lr]haileron$'), ('elev', '^[lr]helevator$'), ('rud', '^rudder$'), ('spoil', '^spoiler\\d+$'), ('fan', '^fan2?$')], 'b787': [('flap', '^[lr]h(ibflap|ibflapa|obflapa|obflapb)$'), ('ail', '^[lr]h(ib|ob)aileron$'), ('elev', '^[lr]helevator$'), ('rud', '^rudder$'), ('spoil', '^[lr]h(ib|ob)?spoiler[ab]$'), ('fan', '^eng[12]fan$')], 'a350': [('flap', '^flap\\d+$'), ('ail', '^aileron\\d$'), ('elev', '^elevator\\.\\d$'), ('rud', '^rudder$'), ('fan', '^fan_eng\\d$')], 'b748': [('flap', '^(doubleflaps_\\d|external_flap)_[LR]$'), ('ail', '^aileron(_int)?_[LR]$'), ('elev', '^elevator_(left|right)$'), ('rud', '^rudder_1$'), ('spoil', '^speedbrake_\\d_[LR]$'), ('fan', '^blades_\\d$')], 'e175': [('flap', '^flap\\.[lr]\\.\\d$'), ('ail', '^aileron\\.[lr]$'), ('elev', '^elevator\\.[lr]$'), ('rud', '^rudder$'), ('spoil', '^spoiler\\.[lr]\\.\\d$'), ('fan', '^fan\\.[lr]$')], 'c750': [('flap', '^[LR]HFlap[01]$'), ('ail', '^[LR]HAileron$'), ('elev', '^[LR]Helevator$'), ('rud', '^Rudder_1$'), ('spoil', '^[LR]H(spoiler|speedbrake)$'), ('fan', '^[LR]Hfan$')]}
only = sys.argv[1:]
os.makedirs(OUT, exist_ok=True)
summary = {}
for mid, cwd, args, dump, livs in PLANES:
    if only and mid not in only: continue
    glb = f'{FG}/{mid}.glb'
    r = subprocess.run(['python3', SP + '/ac2glb.py', glb] + args + ['--dump', dump] + [x for k, rx in SURF.get(mid, []) for x in ('--surf', f'{k}={rx}')], cwd=cwd, capture_output=True, text=True)
    if r.returncode: print(r.stderr); sys.exit(1)
    print([l for l in r.stdout.splitlines() if l.startswith('SURF')])
    meta = json.load(open(f'{FG}/{mid}.json'))
    os.makedirs(f'{OUT}/{mid}', exist_ok=True)
    reps = []
    for i, (tex, cfgf) in enumerate(livs):
        cfg = json.load(open(SP + '/' + cfgf)); cfg['npz'] = f'fg/{mid}_uv.npz'; cfg['meta'] = f'fg/{mid}.json'; cfg['tex'] = tex; cfg['id'] = mid; cfg['suffix'] = f'_{i}'; cfg['out'] = 'liv'
        json.dump(cfg, open(f'{SP}/_cfg.json', 'w'))
        r = subprocess.run(['python3', SP + '/paint.py', f'{SP}/_cfg.json'], cwd=SP, capture_output=True, text=True)
        if r.returncode: print(r.stderr); sys.exit(1)
        for lid in ['boplo', 'northwind', 'solair', 'fjord', 'verde', 'plain']:
            shutil.copy(f'{SP}/liv/{mid}_{i}-{lid}.jpg', f'{OUT}/{mid}/{lid}-{i}.jpg')
        # a tiny placeholder replaces the livery texture inside the model; the simulator loads the livery chosen
        from PIL import Image
        Image.new('RGB', (8, 8), (240, 242, 245)).save(f'{SP}/_ph.jpg', quality=80)
        reps.append(f'{tex}={SP}/_ph.jpg')
    subprocess.run(['python3', SP + '/swap.py', glb, f'{OUT}/{mid}.glb'] + reps, check=True)
    subprocess.run(['python3', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'gloss.py'), f'{OUT}/{mid}.glb'], check=True)  # glossy paint, glass and metal
    meta['tex'] = [t for t, _ in livs]
    summary[mid] = {k: (round(v, 2) if isinstance(v, float) else v) for k, v in meta.items()}
    print(mid, os.path.getsize(f'{OUT}/{mid}.glb') // 1024, 'KB', json.dumps(summary[mid]))
json.dump(summary, open(SP + '/models_meta.json', 'w'), indent=1)
