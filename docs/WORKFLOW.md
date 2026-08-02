# Visual-First Workflow

## Gate 0 — Reference lock

- Review `references/positive/` and `references/negative/`.
- Produce a one-page art bible: palette, materials, lighting, character scale, prop scale, camera framing, and UI tokens.
- Select approved asset families and reject incompatible assets before scene assembly.
- No gameplay implementation begins until these choices are explicit.

Pass condition: the art bible makes it possible to reject an asset or screenshot without subjective improvisation.

## Gate 1 — Asset proof

- Convert one ranger, representative crop stages, one rock set, one fence, and one portal landmark to GLB.
- Render them together under the target lighting.
- Repair materials, texture color space, normals, and scale in the asset pipeline—not with per-instance runtime hacks.

Pass condition: no white glow, missing texture, mismatched style, incorrect scale, or shader artifact.

## Gate 2 — Visual vertical slice

Build only:

- A compact authored hub clearing.
- The complete third-person player and camera.
- North/west/east portal landmarks, with one portal operational.
- One finished farm plot.
- One finished shop interaction.
- One forage pickup.
- Final-quality compact HUD and hotbar.

Take screenshots at 1920×1080, 16:10, and 1366×768. Review composition, readability, scale, material consistency, and navigation before adding more systems.

Pass condition: the slice looks like a shippable small game even if most activities are not present.

## Gate 3 — Interaction feel

- Movement, camera, collision, portal entry, focus highlight, pickup feedback, planting, harvesting, shop feedback, and inventory visibility.
- Add animation, sound, particles, and concise feedback where actions otherwise feel inert.

Pass condition: a player can understand and enjoy the slice without explanatory text.

## Gate 4 — Full feature expansion

- Complete hub, farm, forage, mine, buy shop, sell shop, stock exchange, inventory, round flow, settings, results, onboarding, and area audio.
- Preserve the approved composition and asset rules. New functionality cannot degrade the visual slice.

Pass condition: every required loop is playable end to end and all destinations have clear outbound and HOME navigation.

## Gate 5 — Multiplayer and production

- Authoritative player, inventory, farm claims, markets, restocks, and round state.
- Test host plus at least one remote client.
- Test reconnect, double claim, concurrent purchase, full inventory, and portal use.
- Optimize GLB/textures/audio; verify load progress and browser memory.
- Build production output and perform a clean browser smoke test.

Pass condition: functional checks and visual checks both pass. Neither substitutes for the other.

## Mandatory rejection checklist

Reject a build immediately if any are true:

- The player looks miniature relative to fences, counters, portals, or terrain.
- Bright materials clip to featureless white.
- The landscape resembles a flat empty lot or scattered asset showroom.
- UI panels overlap, drift, stretch, or dominate the play view.
- Functional information is expressed as paragraphs instead of icons and concise labels.
- Asset families visibly conflict in proportion, texture treatment, or detail density.
- A system works in logs but cannot be clearly understood and used in the rendered game.

