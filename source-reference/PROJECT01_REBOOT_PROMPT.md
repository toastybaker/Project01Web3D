# Project 01 Reboot — Implementation Brief

Implement a complete private first-person multiplayer Unity game for 2–8 friends in this existing WorldForge project. This is one game, not a generalized game-making framework. Work directly and keep the implementation simple enough for a three-hour bounded run.

This is a full replacement of the visible game. Rebuild the hub flow, farming area and interactions, mine scene and mining presentation, foraging placement, specialist shops, stock interface, HUD, hotbar, inventory presentation, settings, results, audio presentation, navigation, and first-time player experience. Do not place the old UI, old farm, old mine, old booths, or old visible interaction layer into the reboot scenes. A feature is not complete merely because an old backend script exists.

## Reuse instead of rebuilding

Keep individual network/gameplay backend classes only after confirming that their behavior fits this specification. Rewire or rewrite them when necessary, and create the complete new player-facing implementation under `Assets/Project01Reboot/`. Do not repair, extend, duplicate, or reference the rejected old map, HUD, farm scene, mine scene, character, world generators, outdoor booths, or casino from the reboot scenes.

Use the imported TriForge URP forest demo at `Assets/TriForge Assets/Fantasy Worlds - DEMO Content/Scenes/URP/fwOF_FreeDemo_OldForest.unity` as the authored world foundation. Duplicate it into the reboot area before editing it.

- The starting hub is one attractive existing open clearing in the demo. Adapt it lightly with specialist NPC interaction points and short, readable routes. It does not need a fabricated settlement or extra houses.
- Foraging occupies another naturally distinct section of the same forest demo, reached by a short path. Preserve the authored terrain, vegetation, lighting, and composition; do not scatter a new forest.
- The farm may use another suitable clearing or a compact connected scene. Use existing Quaternius crop stages and the existing generated item icons.
- The mine is a separate compact enclosed scene made from existing cave pieces and matching rocks/props. It is not a giant exploratory cave.

## Match structure

Host chooses 30, 45, 60, or 90 minutes; default 60. All players begin together in the forest clearing. The final shared departure occurs when time expires. Rank players by current cash only; unsold crops, ores, items, deeds, and stocks do not score. One player cannot end the round early. Show rankings, activity earnings, and rematch/return options.

## Activities and strategy

Farming has exactly eight limited, tradable deeds. A player may own multiple plots. Arrange four plots loosely on each side of an entry route, with closer plots offering a mild convenience advantage without looking like a 2x4 table. Specialist farm NPC sells deeds and several seeds. Crops differ in seed price, growth time, yield, and base sale value. Crop prices respond to recent supply, demand, weather/cycle effects, and bounded seeded randomness. Deeds are transferred through player-to-player offers rather than a fixed resale button.

Mining uses several compact roughly 5x5 chambers connected by short branches. Mineable ore appears frequently in readable clusters on walls and ground, respawns at randomized eligible points after a short delay, and supports near-continuous mining with little walking. Deeper chambers have better probabilities for valuable ores. Three recognizable pickaxe tiers improve mining speed; progression is not a long tunnel, hard gate, or row of debug nodes. The mine needs coherent cave enclosure, supports/lamps, atmosphere, ambience, and clear exits.

Foraging rewards observation without long downtime. Populate natural habitats with fruit, mushrooms, herbs, flowers, berries, occasional seeds, and rare finds. Select among authored eligible locations per match so finds change without looking randomly scattered. Common resources sustain steady early income; rare finds and natural discoveries reward learning the forest. Do not use glowing waypoint objects, quest markers, checklists, or formal contracts.

Stocks use recognizable fictionalized display names based on Samsung, Apple, Google, Nvidia, and Tesla. Each begins in a stable readable price range, while hidden drift direction, volatility, and occasional shocks are independently randomized per match. The broker provides price history and continuous buy/sell. A hidden information NPC appears at one of several authored spots and offers limited, incomplete hints about markets, weather, or opportunities—never guaranteed answers or a tutorial dump.

The dynamic commodity economy must create intentional tradeoffs among stable farming, accessible mining, exploratory foraging, and stock risk. Do not add mechanics merely to inflate scope.

Each activity is handled by an appropriate specialist NPC: the farm NPC manages deeds, seeds, crops, and farm services; the mine NPC sells pickaxes/supplies and buys ore; a fitting woodland buyer purchases forage; the broker handles stocks; and the general shop sells only common cross-activity goods. Present them as readable characters/interactions integrated into the clearing, not debug booths or floating labels.

## Player experience

Use responsive first-person movement at a normal human eye height. Provide a permanent return-to-hub item. Implement a nine-slot Minecraft-style hotbar for physical tools and goods; cash, deeds, and stocks are tracked separately. Number keys and mouse wheel select slots. Show the held item unobtrusively when practical; omit an animation rather than ship a broken one.

The HUD is concise and asset-driven: current cash, round clock, next market/shop update time, hotbar, selected stack count, and contextual interaction feedback. Prices belong inside specialist shop panels, not permanently on screen. Shops use icons and authored panels: left click buys one, Shift-left buys ten, right click sells one, Shift-right sells all where applicable. Minimize explanatory text. Include settings for sensitivity, audio, controls, English, and natural casual Korean localization.

Do not invent or draw the UI skin. Use `Assets/WorldForge/External/KenneyUIAdventure/Sprites/` as the single UI component family, restricted primarily to its brown/beige panels, buttons, slots, progress elements, and small neutral accents. Use the matching prepared copies under `Assets/WorldForge/Resources/UI/Adventure/` where convenient. Use `Assets/WorldForge/Resources/UI/Items/` for item artwork. Use Nunito for English and Noto Sans KR for Korean; do not use Fredoka, default TMP, the rejected neon-green `UI/Woodland` family, or the unrelated `UI/Fantasy` border experiment.

Assemble one deliberate responsive Canvas prefab in the Editor, not a runtime-generated UI. Its persistent layout is fixed: compact coin icon and cash at the upper left, round clock at the upper center, next economy update as a smaller secondary line, and nine evenly spaced asset-backed hotbar slots at the bottom center. Show one short interaction prompt just above the hotbar only while in range. Do not add full-width banners, objective essays, activity labels, permanent control hints, or decorative floating text.

Specialist shops open as one centered asset-backed panel with a clear NPC/activity title, a compact icon grid, icon-first item cards, price/stock beneath each icon, and a close control. Stocks use the same family with a readable chart region rather than a separate visual theme. Settings, inventory, results, and localization screens must reuse the same panel/button/slot language. Configure sprites as 9-sliced where appropriate so the UI uses the authored borders instead of stretched artwork or code-drawn rectangles.

Use area-specific music/ambience and interaction sounds with sensible volume/cooldowns. Preserve visual coherence with the TriForge forest; no generic AI neon, visible primitives, floating instruction labels, childish placeholder character, or raw website-like UI.

## Technical finish

Make interactions server-authoritative where competition or ownership matters. Verify host/join with two local clients, all major transactions, farm ownership, shared resource state, timer/results, rematch, and a Windows friends build. Build settings should include only the reboot scenes. Keep the final build reasonably sized; do not ship unused old demo/test scenes or avoidable asset folders.

For each major destination, inspect it once from the actual player Game view and test its core interaction. If a chosen asset clearly fails, replace it instead of micro-tweaking. Finish with a factual list of completed systems, build path/size, validation performed, and any `SOL BLOCKERS`; do not claim unfinished work is complete.
