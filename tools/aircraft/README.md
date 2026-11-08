# Airliner models for the simulator

The airliners in the simulator (`dist/aircraft-models/`) are built from FlightGear aircraft, which are licensed under the GNU GPL v2:

| Boplo id | Model | Source |
|---|---|---|
| a320 | A320 family | https://github.com/FGMEMBERS/A320-family |
| b737 | 737-800 | https://github.com/FGMEMBERS/737-800 |
| b787 | 787-8 | https://github.com/FGMEMBERS/787-8 |
| a350 | A350 XWB | https://github.com/FGMEMBERS/A350XWB |
| b748 | 747-8i | https://github.com/FGMEMBERS/747-8i |
| e175 | E175 | https://github.com/FGMEMBERS/E-jet-family |
| c750 | Citation X | https://github.com/FGMEMBERS/CitationX |

The converted models and liveries are released under the same licence (GPL v2).

How they are made:

1. `ac2glb.py` reads the AC3D exterior files (with the FlightGear XML offsets for multi-part models), drops lights, interiors and other FlightGear-only parts, re-axes to glTF (+Y up, +Z forward, +X left wing), puts the origin on the fuselage axis just ahead of the main gear, groups the landing gear into a node named `gear`, and writes a GLB plus a JSON of key dimensions and a UV/position dump of the livery textures.
2. `paint.py` paints each Boplo livery onto the livery texture using each texel's 3D position (fuselage, fin, engines, belly, cheatline, tail art and titles), on top of the FlightGear paint kit (`xcf.py` reads GIMP files).
3. `build_all.py` runs both for every aircraft, writes `dist/aircraft-models/<id>.glb` with a placeholder in place of each livery texture, and `dist/aircraft-models/<id>/<livery>-<n>.jpg` for each livery. The simulator (`dist/flight-jets.js`) drops the chosen livery into the model at load time.

Run: clone the FlightGear repositories above into a folder, then `FG_SRC=<that folder> python3 build_all.py` (needs numpy and Pillow).

# Trainer models

Most trainers are FlightGear aircraft too, converted by `build_trainers.py` (same `ac2glb.py`, with each model's textures kept inside the GLB):

| Boplo id | Model | Source | Licence |
|---|---|---|---|
| c172 | Cessna 172P (Custom Callsign 1 livery) | https://github.com/c172p-team/c172p | GPL v2 |
| c152 | Cessna 152 | https://github.com/FGMEMBERS/c152 | GPL v2 |
| pa28 | Piper PA-28-161 | https://github.com/FGMEMBERS/PA28-161 | GPL v2 (FlightGear base package) |
| dr400 | Robin DR400 | https://github.com/FGMEMBERS/dr400 | GPL v2 |
| da40 | Diamond DA40 | https://github.com/FGMEMBERS/Diamond-DA40 | GPL v2 |
| da20 | Diamond DA20 Katana | https://github.com/FGMEMBERS/Katana | GPL v2 |
| cub | Piper J-3 Cub | https://github.com/FGMEMBERS/J3Cub | GPL v3 |

The Tecnam P2008 and Cirrus SR20 have no usable FlightGear model, so they are still built in code (`dist/flight-aircraft.js`), with the 3D cockpit.
Interiors are left out: in the cockpit view these models show the 2D instrument panel. The picker images in `dist/aircraft/` are renders of the same models.

Run: clone the repositories above into a folder, then `FG_SRC=<that folder> python3 build_trainers.py [ids]`.
