# Airliner models for the simulator

The airliners in the simulator (`dist/aircraft-models/`) are built from FlightGear aircraft, which are licensed under the GNU GPL v2:

| Boplo id | Model | Source |
|---|---|---|
| a320 | A320 family | https://github.com/FGMEMBERS/A320-family |
| b737 | 737-800 | https://github.com/FGMEMBERS/737-800 |
| b787 | 787-8 | https://github.com/FGMEMBERS/787-8 |
| a350 | A350 XWB | https://github.com/FGMEMBERS/A350XWB |
| b748 | 747-8i | https://github.com/FGMEMBERS/747-8i |

The converted models and liveries are released under the same licence (GPL v2).

How they are made:

1. `ac2glb.py` reads the AC3D exterior files (with the FlightGear XML offsets for multi-part models), drops lights, interiors and other FlightGear-only parts, re-axes to glTF (+Y up, +Z forward, +X left wing), puts the origin on the fuselage axis just ahead of the main gear, groups the landing gear into a node named `gear`, and writes a GLB plus a JSON of key dimensions and a UV/position dump of the livery textures.
2. `paint.py` paints each Boplo livery onto the livery texture using each texel's 3D position (fuselage, fin, engines, belly, cheatline, tail art and titles), on top of the FlightGear paint kit (`xcf.py` reads GIMP files).
3. `build_all.py` runs both for every aircraft, writes `dist/aircraft-models/<id>.glb` with a placeholder in place of each livery texture, and `dist/aircraft-models/<id>/<livery>-<n>.jpg` for each livery. The simulator (`dist/flight-jets.js`) drops the chosen livery into the model at load time.

Run: clone the FlightGear repositories above into a folder, then `FG_SRC=<that folder> python3 build_all.py` (needs numpy and Pillow).
