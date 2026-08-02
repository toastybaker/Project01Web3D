# Salvage Manifest

## Included for production evaluation

- `public/assets/ui/items/`: 25 existing item icons covering crops, seeds, tools, forage, ores, money, deeds, and stock certificates.
- `public/assets/brands/`: recognizable stock-company marks.
- `public/assets/audio/`: area music and ambience plus the existing credit record.
- `source-assets/3d/crops/`: 30 Quaternius CC0 crop-stage FBX files for lettuce, mushroom, pumpkin, tomato, and watermelon.
- `source-assets/3d/characters/`: male/female ranger models, ranger textures, and the CC0 animation library source.
- `source-assets/licenses/`: retained provenance and license text.
- Gameplay concepts: hub portals, separated claimable farms, crop growth/harvest/sale, forage, mine, buy/sell shops, stock exchange, timed restock, inventory, round results, settings, and area audio.
- `source-reference/backend-csharp/`: selected working economy, inventory, crop, stock, round, interaction, and player-state code retained only to preserve rules and edge cases during the TypeScript server rewrite.

Source FBX files must be converted and visually approved as GLB before entering `public/assets/3d/generated/`.

## Included only as references

- `references/positive/world-foundation/`: the forest density, lighting, palette, and authored composition target.
- `references/negative/owner-frames/`: the four owner-supplied failure screenshots.
- `references/negative/unity-captures/`: every retained reboot implementation frame. These are rejection examples, not layouts to preserve.
- `source-reference/PROJECT01_REBOOT_PROMPT.md`: historical requirements to extract behavior from, never visual implementation.
- The C# backend reference is not browser-compatible and must not dictate rendering, scene structure, UI, or networking architecture.

## Explicitly not salvaged

- Unity scenes and prefabs.
- Runtime-generated world placement.
- Reboot C# UI and scene-construction code.
- Generated parchment board atlases and fantasy stock symbols.
- Unity materials and render-pipeline configuration.
- The failed booth, portal, fence, farm, and HUD compositions.
- TriForge source models or textures. Only overview images were copied because redistribution rights for raw source assets were not established here.
