# Final production-readiness pass

## Release verdict

`PRODUCTION CANDIDATE WITH KNOWN P2/P3 ISSUES`

The production build, deterministic economy suite, 1.6-million-sequence enhancement audit, six-client shared-state suite, minigame lifecycle tests, save persistence checks, and Git LFS integrity checks pass. No reproduced P0 or P1 remains. The known issues are load weight, one upstream deprecation warning on scene mounts, and unmeasured low-end/WAN performance.

## Tested revision

- Repository: `toastybaker/Project01Web3D`
- Branch: `codex/shared-mine-and-game-polish`
- Starting SHA: `b29f8fcdd2b9fb6b56e2b9a534040fc495d74ca3`
- Ending tested implementation SHA: `279a042318a299bf44c4140721864e98dde4336a`
- Implementation commit: `279a042 stabilize production match flow and balance`
- Node: `v20.14.0`; npm: `10.7.0`

Changed production areas: authoritative room/minigame timing and reset flow, save restoration, mine/farm/merchant regression coverage, jump/footstep feedback, responsive world labels, cooking balance, Forage Rush scene composition, production source-map policy, and recorded hub music. Eight browser screenshots were added as normal Git JPEGs rather than LFS pointers.

## Commands and automated results

| Command | Result |
|---|---|
| `npm ci` | PASS; lockfile install completed. Transitive `camera-controls` reports a Node 22 engine preference. |
| `npm run build` | PASS; 678 modules, CSS 12.36 kB gzip, main JS 425.11 kB gzip. |
| `npm run test:economy` | PASS; 12 commodity cycles, five stock models, 12 obtainable recipes, lottery EV 92.12%. |
| `npm run test:hour` | PASS; startup mining through Crystal route ends at 83,214,766 coins. |
| `npm run test:cooking-economy` | PASS; two-furnace late cooking peaks at 7,785,600 neutral operating profit/min. |
| `npm run test:minigames` | PASS; all three modes, temporary inventory isolation, restoration, and reward idempotency. |
| `npm run test:enhancement` | PASS; 8.8M Fortune rolls and all transaction/ward rules. |
| `npm run test:enhancement-distribution` | PASS; 100,000 full sequences per item, with and without wards (1.6M sequences). |
| `npm run test:merchant` | PASS; 10,000 schedules and 150,000 cycles. |
| `npm run test:minigame-rewards` | PASS; 100,000 cash-ordering samples and 700,000 reward/package rolls. |
| `npm run test:consumables` | PASS; use, invalid use, pause, duration/charges, and farm scope. |
| `npm run test:multiplayer` | PASS; six-player lobby, shared mine/farm/merchant, ready gate, pause/resume, and synchronized reset. |
| `git lfs fsck` | PASS; all committed LFS objects resolve. |
| `git diff --check` | PASS. |

The final full suite was rerun after the multiplayer fixes. The focused economy/build suite was rerun again after the evidence-based Melon Preserve correction.

## Browser and art gate

The production preview and server were used, not the Vite development server. Lobby, HUD, inventory, common/forage/farm/mine shops, stocks, cookbook/furnace, enhancement, merchant, player list, settings, travel, all minigame HUDs/results, and the final ledger were inspected.

| Viewport | Result |
|---|---|
| 1920×1080 | PASS; all major surfaces and three minigames fit without essential clipping. |
| 1440×900 | PASS; tall panels retain usable scroll paths and tooltips remain readable. |
| 1366×768 | PASS; HUD, hotbar, leaderboard, shop controls, and modal actions remain available. |
| 1280×720 | PASS; event objectives, leaderboard, timer, hotbar, and order controls remain separate. |

Forage Rush received one material composition correction: the delivery court is compact and visually framed by varied green trees and shrubs instead of reading as a sparse service plaza. The authored GLB was regenerated and cache-versioned. World-space shop labels now clamp into the viewport. The review avoided the negative-reference failures of floating flat platforms, full-screen instructional text, placeholder primitives, mismatched UI, and clipped primary actions.

Evidence:

- [Lobby — 1920×1080](final-production-pass/screenshots/01-lobby-1920x1080.jpg)
- [Hub — 1920×1080](final-production-pass/screenshots/02-hub-1920x1080.jpg)
- [Mining Rush — 1920×1080](final-production-pass/screenshots/03-mining-rush-1920x1080.jpg)
- [Kitchen Rush — 1920×1080](final-production-pass/screenshots/04-kitchen-rush-1920x1080.jpg)
- [Forage Rush — 1920×1080](final-production-pass/screenshots/05-forage-rush-1920x1080.jpg)
- [Mining Rush — 1280×720](final-production-pass/screenshots/06-mining-rush-1280x720.jpg)
- [Kitchen Rush — 1280×720](final-production-pass/screenshots/07-kitchen-rush-1280x720.jpg)
- [Forage Rush — 1280×720](final-production-pass/screenshots/08-forage-rush-1280x720.jpg)

Browser console: no uncaught exception or rejected promise was observed. Repeated scene mounts emit the upstream React Three Fiber `THREE.Clock` deprecation warning; it is documented below rather than hidden.

## Six-player multiplayer matrix

| Scenario | Result and evidence |
|---|---|
| Capacity and host controls | PASS; six clients share one room, seventh `joinById` is rejected, non-host start is ignored. |
| Host leaves before/during match | PASS; host reassigns in both states. |
| Match synchronization | PASS; all clients receive one seed, start time, and duration. |
| Shared mine contention | PASS; one simultaneous award, no replay award, common depletion, 28–35 s reroll, shared late-join generation. |
| Farm claim/action ownership | PASS; one owner, non-owner rejection, shared stage/rain, late-join snapshot, one harvest award. |
| Deeds | PASS; six personal deeds plus two globally contested expansion deeds; leader can own three farms. |
| Merchant final stock | PASS; one winner, shared sold-out state, idempotent retry, late-join cycle snapshot. |
| Minigame ready/disconnect | PASS; premature reward blocked, empty/abandoned gates clean up, paused late join and synchronized resume. |
| New Run | PASS; host-authoritative reset returns every connected client to a clean lobby and preserves only nickname. |

Normal inventory/economy authority intentionally remains client-side; this report does not claim cheat resistance.

## Economy and pacing

All values below use opportunity cost rather than gross food proceeds. Movement overhead is included in mining at 1.25 seconds per target; speculative stocks and exceptional market spikes are not treated as guaranteed income.

| Route | Setup / activation | Measured operating result | 60-minute evidence |
|---|---|---|---|
| Mining-only | 0; Iron 0.75M, Steel 4M, Crystal 18M | 0.230M starter; 0.412M Iron; 1.097M Steel; 2.895M Crystal per min | Focused 4/10/18/28-minute tier route ends at 83.21M. |
| Forage-first | 0; basket 0.5M; crate 3M; cart 12M | Full-load values: 0.120M / 0.484M / 1.350M / 3.402M | Flexible ingredient/material route; no fixed 60-minute return is claimed because shared sites and rare rolls are contested. |
| One-farm raw | Deed 2.5M plus seeds | 0.256–0.533M/min for a fully active 64-cell plot | Below mature mining/cooking as intended. |
| One-farm cooking | Deed + two furnaces = 5.5M, recipe unlock and ingredients additional | Best neutral opportunity-cost profit 7.786M/min; setup-only payback 0.71 operating minutes once supplied | Highest mature operating return; ingredient production, unlock time, demand, and queue management delay activation. |
| Farm + bought/traded forage | Same 5.5M core setup | Same 7.786M/min calculation already deducts ingredient sale opportunity cost | Trading changes sourcing, not the validated operating margin. |
| Enhanced Harvest Charm | Charm plus enhancement materials/coins | +6 median coin cost 5.79M without wards; 3.96M with wards, excluding material/ward value | Improves crop inputs only; no duplicate yield application found. |
| Mixed mining → cooking | Mining funds the 5.5M core setup and later ingredients | Transitions from 0.230–1.097M/min to 4.64–7.79M/min late recipes | Supported by the two validated models; no zero-travel perfect-play claim. |
| Stock-assisted | Price-gated waves, finite supply | Stochastic; tested price ranges span 2.77×–11.08× max/min by company | Not counted as guaranteed progression or minigame reward value. |
| Enhancement-heavy | Tier-specific costs and materials | +3 common; +4 meaningful; +5 attainable; +6 median 4.36M–13.03M by item without wards | 100k-sequence distributions per item support the intended scarcity curve. |

Cooking is the highest sustainable late-game net-return activity in the neutral two-furnace model. The audit initially measured Melon Preserve at about 10.1M/min; its multiplier/time were corrected to 7.786M/min because that was a reproducible dominant route, not a preference-based rebalance.

Minigame rewards remain deterministic for a reward key, cash placement ordering is strict, catch-up cannot reverse the order, and item rewards do not subtract from cash. Merchant purchases and minigame rewards are intentionally excluded from guaranteed route totals.

## Enhancement distribution highlights

- +3 median coin cost ranges from 0.24M (starter pickaxe) to 0.70M (top tools).
- +4 median ranges from 0.50M to 1.49M.
- +5 median ranges from 1.46M to 4.35M without wards.
- +6 median ranges from 4.36M to 13.03M without wards; wards reduce coin/material variance but consume a median of about six eligible wards through +6.
- +7 expected costs remain exceptional; +8 and above are not normal one-hour outcomes.

The complete per-item mean/median/P10/P90 output is produced by `npm run test:enhancement-distribution`.

## Confirmed defects fixed

| Severity | Reproduction/root cause | Fix and regression evidence |
|---|---|---|
| P1 | Match time, farm growth, merchant cycles, and late-join clocks advanced while minigames paused. | Server shifts authoritative time and broadcasts synchronized match state; ready/disconnect regression passes. |
| P1 | Empty ready gates or all-manual-leave events could leave resource timers paused; finish messages could settle before gameplay began. | Every terminal path clears gates/timers and resumes once; premature reward and abandonment tests pass. |
| P1 | New Run cleared only one browser and rejoined the completed server room. | Host-authoritative synchronized room reset plus in-match host reassignment; six-client regression passes. |
| P1 | Neutral Melon Preserve sustained ~10.1M/min and invalidated the intended late-game ceiling. | Changed only its multiplier/time; cooking audit now passes at 7.786M/min. |
| P2 | Completed minigame/session state was absent from save persistence. | Persisted both and added reload assertions. |
| P2 | Failed merchant request IDs accumulated without a bound. | Bounded per-client result cache to 64 entries. |
| P2 | Held jump repeated and continued under modal/session locks; steps were loud/repetitive. | Edge-triggered locked jump plus quieter randomized/cropped footsteps and separate jump/land gains. |
| P2 | Mine/shop HTML labels could leave the viewport at square resolutions. | Added clamped overlay positioning. |
| P2 | Forage Rush read sparse and unlike the main forage scene. | Re-authored compact court framing and regenerated the scene; 1920 and 1280 captures pass. |
| P2 | Hub Sicilienne sounded synthetic/MIDI-like. | Replaced it with the DuPage Symphony Orchestra recording and corrected UTF-8 credits. |

## Remaining risks

Confirmed P2/P3 issues:

- Eight scene GLBs total about 117.7 MB; the current production output is about 179.5 MB before network compression/cache effects. Local warm navigation is smooth, but asset compression/code splitting remains a later deployment task.
- The main JavaScript chunk is 425.11 kB gzip and triggers Vite's chunk-size warning.
- React Three Fiber creates a deprecated `THREE.Clock` on each Canvas mount, producing one warning per scene mount. This is dependency noise, not a gameplay failure.
- The requested C418/Lena Raine soundtrack masters are not in the repository. Zone/event routing is ready, and the hub now uses an actual licensed orchestral recording; commercial tracks require user-supplied authorized files before wiring.

Unmeasured concerns:

- Cold-load time, memory retention, FPS on low-end integrated GPUs, six-avatar FPS, and WAN WebSocket volume were not instrumented with production telemetry. Local production-browser matrix testing found no severe collapse.
- `joinOrCreate` can create another room when the first six-player room is full; direct joining of the full room is rejected. That is acceptable matchmaking behavior but not a global single-room cap.
- Broader inventory/economy authority is client-side by product decision and is not cheat-proof.

## Final state

- Build: PASS
- Full automated suite: PASS
- Six-client core flows: PASS
- Save/reload and synchronized new-run reset: PASS
- All three minigames and restoration: PASS
- Match completion/reward idempotency: PASS
- Git LFS integrity and ordinary screenshot blobs: PASS
- Known P0/P1: none reproduced after fixes

`PRODUCTION CANDIDATE WITH KNOWN P2/P3 ISSUES`
