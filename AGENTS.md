# Project 01 Web 3D — Binding Instructions

## Authority

The current user prompt, this file, and `docs/DIRECTION.md` are authoritative. The copied Unity prompt is historical source material only. Do not treat Unity scenes, prefabs, runtime layout, generated boards, or C# presentation code as implementation references.

## Non-negotiable quality bar

- This is a polished stylized 3D game, not a systems demo.
- Build the environment as authored Blender/GLB scenes. Runtime code loads scenes and drives behavior; it does not compose the visible world from primitives or hundreds of hard-coded transforms.
- No visible cubes, capsules, flat-color placeholder geometry, billboarded world art, glowing white materials, mismatched asset families, stretched UI textures, raw debug text, or tutorial paragraphs in the player view.
- Use one coherent visual family: warm storybook forest, readable silhouettes, restrained saturation, natural material response, and consistent low-poly/stylized detail.
- Use the positive references in `references/positive/` as the minimum world-quality target.
- Treat every frame in `references/negative/` as a rejection test. Do not imitate its scale, UI density, lighting, layout, materials, or composition.
- Human scale is fixed: player 1.75 m; fence 1.05–1.2 m; counter 0.9–1.0 m; doorway 2.1–2.3 m; portal clear opening at least 2.4 m wide and 2.7 m high.
- Camera is third-person, with the complete character visible. Movement, collision, camera obstruction, and interaction reach must feel correct before content expansion.
- UI is responsive HTML/CSS over the canvas. It uses icons first, short labels only when necessary, high-weight readable type, consistent spacing, and no generated typography.
- Image generation may create clean 2D emblems, decorative panels, or missing icon art. Reject outputs with extra corners, fake text, unnecessary clips, inconsistent borders, or ornamental clutter.
- Do not declare completion from unit tests, logs, or transaction success. Completion requires visual Game-view/browser screenshots, hands-on interaction, responsive-layout checks, and a production build.

## Production order

1. Lock the art bible, camera, scale sheet, lighting, and UI tokens.
2. Deliver one polished vertical slice: hub clearing, one portal, one farm plot, one NPC shop, one forage pickup, compact HUD/hotbar, and character movement.
3. Obtain visual approval before expanding the world or backend.
4. Add complete farm, foraging, mine, shops, stocks, inventory, round flow, settings, results, audio, onboarding, and multiplayer.
5. Optimize assets, validate supported resolutions, and build.

## Review discipline

- Capture 1920×1080 and 16:10 screenshots at every visual gate.
- Compare each gate against both positive and negative reference folders.
- State which negative-frame failures were avoided.
- Make at most two materially different corrections to a blocked visual approach. If both fail, record the issue and change approach instead of polishing the same failure.
- Keep a deliberately skeptical visual review pass separate from implementation judgment. Its findings are evidence, not automatic commands.

