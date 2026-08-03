# Project 01 — Art Bible

## Intent

Project 01 should read as a small, friendly woodland game before it reads as a feature list. The target is simple Roblox-like clarity with authored storybook composition: broad shapes, readable routes, soft materials, and very little text. Complexity is earned only when it makes play smoother.

## World language

- **Silhouette:** rounded low-poly masses; crooked trunks; clustered canopies; broad portal openings; no raw primitive placeholders.
- **Palette:** moss `#66733a`, fern `#3f5a32`, bark `#644733`, soil `#765138`, warm stone `#94826a`, parchment `#f3e4bd`, ink `#263027`.
- **Materials:** rough and natural. Ground, bark, stone, cloth, and crops stay below 0.05 metalness and above 0.72 roughness. Portal color is tinted glass, never white emission.
- **Lighting:** warm late-morning sun, cool sky fill, soft fog, and contact shadows. Saturation remains restrained.
- **Composition:** a clear center, three compass routes, dense perimeter framing, and landmarks visible from the spawn camera. Repetition is clustered and varied rather than evenly scattered.

## Scale sheet

| Element | Fixed size |
| --- | --- |
| Ranger | 1.75 m tall |
| Camera target | 1.15 m above feet |
| Camera distance | 6.2 m, 3.2 m above target |
| Fence | 1.1 m tall |
| Shop counter | 0.95 m tall |
| Portal clear opening | 3.2 m wide × 3.35 m high |
| Main path | 3.4–4.2 m wide |
| Interaction reach | 2.5 m |

The starting view is third-person, behind and above the complete Ranger. The Ranger is the source of scale; environment dimensions do not drift to fit a screenshot.

## Interface tokens

- Nunito Sans/system humanist fallback, 700–900 weight.
- Glass-dark modules with warm ivory text; 10–14 px radius; 8 px spacing unit.
- Nine icon-only hotbar slots; one focused interaction chip; no tutorial panel.
- Panels occupy at most the central 56% of a 1920×1080 frame and collapse cleanly at 1366×768.
- Functional text is live DOM text. Generated images never contain instructions or labels.

## Rejection rules

Reject frames with clipped white materials, empty flat acreage, oversized UI, first-person framing, repeated booth layouts, miniature player scale, stretched textures, paragraph prompts, or mixed illustration families. The generated woodland albedo is used only as a restrained surface layer; existing Quaternius characters/crops and existing item icons remain the core asset family.
