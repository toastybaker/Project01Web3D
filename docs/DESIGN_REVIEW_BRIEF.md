# Project 01 — External Game-Design Review Brief

## Review goal

Review the current playable browser build as a cohesive game, not as a checklist of implemented features. Identify the smallest high-leverage changes that would make the first 60 minutes varied, readable, social, and worth replaying without overengineering the project or adding tutorial prose.

## Current game

Project 01 is a third-person warm-storybook social economy game. A shared woodland hub connects four main loops:

- Foraging: find fruit trees and rare discoveries, manage carry capacity, sell resources, and improve gathering equipment.
- Mining: explore a branching cave, hold to mine depth-weighted ore spawns, and progress through pickaxes with different speed and Fortune.
- Farming and cooking: own a deed-gated farm, plant and water crops, harvest, unlock recipes from Recipe Boxes, and queue dishes in furnaces.
- Economy and social play: area-specific shops, commodity prices, real-company-inspired stocks, lottery tickets, trading, weather, timed market corrections, a hidden information broker, and multiplayer minigames.

At minutes 20 and 40, the game chooses two different equalized 3D minigames from Mining Rush, Farm Kitchen Rush, and Forage Delivery Race. They reuse the main hotbar, inventory, tools, interactions, and art language while isolating temporary event data.

The intended session can continue past one hour, but the first hour must already contain meaningful decisions, progression, surprises, and social comparison. Long-term balances should support eventual fortunes around 100,000,000 without making early rewards meaningless or instantly multiplying net worth.

## Non-negotiables

- Cohesive warm storybook 3D art; no placeholders, mismatched icon families, procedural-looking prop scatter, or UI that feels like a systems demo.
- Minimal player-facing text. Teach through placement, icons, feedback, affordances, and short tooltips only where needed.
- Reuse existing systems and content. Prefer tuning, recombination, pacing, and one strong connective mechanic over new parallel frameworks.
- Third-person movement should stay smooth; walking between decisions should not dominate playtime.
- Progression and rewards require probability/time-based justification, not arbitrary intuition.
- Preserve meaningful player choice across foraging, mining, farming/cooking, stocks, trading, and minigames.
- Browser performance and implementation scope matter. Reject ideas whose cost is disproportionate to their likely fun.
- Do not propose manipulative retention systems, paid monetization, or long tutorials.

## What to inspect

Start with:

- `docs/DIRECTION.md`
- `docs/design-review/README.md` and its six current screenshots
- `src/game/config.ts`
- `src/game/economy.ts`
- `src/game/minigame.ts`
- `src/game/store.ts`
- `src/game/World.tsx`
- `src/App.tsx`
- `server/index.ts`
- `scripts/validate-hour.ts`
- `scripts/validate-minigames.ts`

Treat the current implementation as authoritative. Historical notes and old screenshots may describe already-fixed problems.

## Requested response

Act as a skeptical game director and economy designer. Return:

1. A concise diagnosis of the current one-hour experience, including likely boredom points and where decisions become repetitive.
2. A concrete 0–15, 15–30, 30–45, and 45–60 minute player timeline using the systems that already exist.
3. At most five prioritized design changes. For each, explain the player-facing benefit, how it reuses current systems, implementation risk, and the measurable balance assumption behind it.
4. One lightweight social or world-secret idea that creates stories between players without requiring a major new system.
5. An adversarial section: ideas that sound attractive but should be rejected because they add clutter, undermine progression, or exceed scope.

Do not write implementation code. Do not evaluate by feature count. Do not solve weak pacing by adding explanatory text. Prefer a few decisive recommendations over a large backlog.
