"""Build the trainer models for Boplo Flight from FlightGear sources (GPL): one GLB per type with its textures inside.
Run: clone the repositories in TRAINERS into FG_SRC, then `FG_SRC=<folder> python3 build_trainers.py [ids...]`."""
import subprocess, json, os, sys
SP = os.path.dirname(os.path.abspath(__file__)); FG = os.environ.get('FG_SRC', SP + '/fg'); OUT = os.environ.get('OUT', os.path.join(SP, '../../dist/aircraft-models'))
FR = ['--gear-extra', r'^(roue[ADG]|cache[ADG]|axe[ADGB]+|troucache[ADG]|intcache[ADG])$', '--surf', 'ail=^aileron[DG]$', '--surf', 'flap=^volet[DG]$', '--surf', 'elev=^profondeur$', '--surf', 'rud=^direction$', '--surf', 'fan=^helice$']
L1 = 'Liveries/custom_callsign_1'
TRAINERS = [  # (Boplo id, repository, folder, model, extra arguments)
  ('c172', 'https://github.com/c172p-team/c172p', 'c172p/Models', 'c172-common.ac', ['--tex', f'fuselage.png={L1}/fuselage.png', '--tex', f'tail.png={L1}/tail.png', '--tex', f'wing.png={L1}/wing.png',
    '--drop', r'(?i)HotSpot|blocker|Propeller\.Fast|courtesy|BeaconOffX|^immat', '--surf', 'flap=^flaps$', '--surf', 'ail=^(left|right)aileron$', '--surf', 'elev=^elevator(left|right)$', '--surf', 'rud=^rudder_1$', '--surf', 'fan=^Propeller$']),
  ('c152', 'https://github.com/FGMEMBERS/c152', 'c152/Models', 'c152.ac', ['--drop', r'(?i)-int|_int$|Mount|cabin_floor|Switch|LightOn|On$|NavLight|LandingLight|TaxiLight|BeaconLight|propellerF|propellerR|cone_slow|^Cube|^Plane|^object|^ring',
    '--surf', 'flap=^[LR]Flap$', '--surf', 'ail=^(Left|Right)Aileron$', '--surf', 'elev=^Elevator$', '--surf', 'rud=^Rudder$', '--surf', 'fan=^propeller_slow$']),
  ('pa28', 'https://github.com/FGMEMBERS/PA28-161', 'PA28-161/Models', 'pa28-161.ac', ['--drop', r'(?i)Console|Carb|CH-Lever|Placard|RudderTrim|^Panel$|instrument|Compass|Throttle|Glareshield|Friction|Mixture|FuelValve|Bench|Seat|^Cabin$|DoorInterior|DoorLatch$|AC_Num|ParkingBrake|Bulb|NavLight|Beacon|Strobe',
    '--surf', 'flap=^(Left|Right)Flap$', '--surf', 'ail=^(Left|Right)Aileron$', '--surf', 'elev=^Stabilator$|^AntiServoTab$', '--surf', 'rud=^Rudder$', '--surf', 'fan=^Propeller$']),
  ('dr400', 'https://github.com/FGMEMBERS/dr400', 'dr400/Models', 'dr400.ac', ['--drop', r'(?i)propblur|propdisc|lampe|strobe|garmin|commandeflaps'] + FR),
  ('da40', 'https://github.com/FGMEMBERS/Diamond-DA40', 'Diamond-DA40/Models', 'da40.ac', ['--drop', r'(?i)propblur|propdisc'] + FR),
  ('da20', 'https://github.com/FGMEMBERS/Katana', 'Katana/Models', 'katana.ac', ['--drop', r'(?i)propblur|propdisc|tourlampe|vitrelampe'] + FR),
  ('cub', 'https://github.com/FGMEMBERS/J3Cub', 'J3Cub/Models', 'Cub.ac', ['--taildragger', '--drop', r'(?i)seat_|stick_|rudderpedal|floor_lever|^panel$|cabin_|fuel_gauge|primer|placard|handle_|GPSMount|_interior|propeller_fast|propeller_slow|^Cube|^Cylinder',
    '--surf', 'ail=^aileron_[lr]$', '--surf', 'elev=^elevator$', '--surf', 'rud=^rudder$', '--surf', r'fan=^propeller_[01]$|^propeller\.0']),
]
only = sys.argv[1:]; meta = {}
for mid, repo, folder, model, extra in TRAINERS:
    if only and mid not in only: continue
    out = f'{OUT}/{mid}.glb'
    r = subprocess.run(['python3', SP + '/ac2glb.py', out, model, '--maxtex', '1024'] + extra, cwd=f'{FG}/{folder}', capture_output=True, text=True)
    if r.returncode: print(r.stderr); sys.exit(1)
    m = json.load(open(f'{OUT}/{mid}.json')); os.remove(f'{OUT}/{mid}.json')
    meta[mid] = {k: (round(v, 2) if isinstance(v, float) else v) for k, v in m.items() if k != 'gearVerts'}
    subprocess.run(['python3', SP + '/gloss.py', out], check=True)
    print(mid, os.path.getsize(out) // 1024, 'KB', json.dumps(meta[mid]))
json.dump(meta, open(SP + '/trainers_meta.json', 'w'), indent=1)
