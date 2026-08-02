# Direction

## Product

Project 01 is a compact social economy game in a warm woodland setting. Players meet in a common hub, travel through clearly marked compass-distributed portals, claim separated farms, grow and sell crops, forage, mine, trade stocks, and regroup for timed rounds.

The experience should feel like a small authored place—not a collection of activity boxes. Each destination needs a readable entrance, a strong landmark, a deliberate path, environmental framing, and an obvious return route.

## Visual direction

- Stylized storybook 3D with believable proportions and soft natural materials.
- Dense forest framing around curated clearings; grass and ground variation remain visible outside gameplay footprints.
- Warm hub and forage lighting, brighter open farm light, cooler restrained mine lighting.
- One asset language per scene. Quaternius crops/characters are approved candidates. The TriForge forest overview is a quality/composition reference, not cleared source geometry for redistribution.
- Avoid bloom-heavy lighting, white emissive clipping, enormous props, dead flat terrain, random asset scattering, and repeated identical booths.

## World layout

- Hub is the social center.
- North portal: foraging.
- West portal: farming.
- East portal: mine.
- Portal destinations use a large icon/emblem above the opening, not explanatory paragraphs.
- Portals have broad, flat approaches with no collision snagging.
- Every activity zone has a prominent HOME portal returning to the hub.
- Farm area has an outer boundary and eight separated claimable farms in a loose 2×4 arrangement. Each farm has its own fence, gate, sign, and 8×8 or 10×10 planting grid, with enough landscape spacing that neighboring players are not visually stacked together.

## Character and camera

- Third-person complete character, approximately 1.75 m tall.
- Camera starts behind and above the player, never inside the mesh.
- World proportions are derived from the player, not adjusted by eye after placement.
- Interactions should be reachable without pixel hunting; highlight only the focused object.

## Interface

- Responsive DOM overlay, designed at 1920×1080 and verified at 16:10 and 1366×768.
- Compact separate top modules: current time, next restock, cash, and menu.
- Nine icon-only hotbar slots. No printed slot numbers.
- `E` opens a 9×4 inventory showing item icons and quantities; no drag/drop requirement for the first release.
- Shop tiles are large squares with item icon, price, and availability. Buy and sell NPCs are separate. Farm shop sells seeds and one farm deed; produce belongs in sell inventory.
- Stock exchange uses recognizable company marks. Left click buys and right click sells without on-screen instructional prose.
- Settings and results are concise, aligned, and readable. Close controls are a clear `×`.
- Use a sturdy humanist sans-serif such as Nunito Sans for all live text. Never bake functional text into generated images.

## Audio

- Hub and foraging: Fauré’s *Sicilienne* for flute and piano, quietly looped.
- Farm and mine use distinct chamber-music tracks.
- Forest and cave ambience are area-specific and independently mixed.
- Master, music, ambience, and effects volumes must be controlled and persisted.

## Technical direction

- Vite + React + TypeScript.
- Three.js through React Three Fiber and Drei.
- Rapier for player/world collision.
- Zustand for local UI/session state.
- Colyseus with a TypeScript authoritative server for multiplayer state.
- Blender-authored zone files exported as optimized GLB. Use Meshopt/Draco and KTX2 where useful.
- DOM/CSS UI over the WebGL canvas; no world UI generated procedurally.
- Data-driven item, shop, crop, stock, and round definitions shared between client and server.

