# NuncleNelson — Boundaries, Block Placement, Container Access

## Status: COMPLETE
All features implemented and deployed. See commits on `main`:
- `ebb5473` — Sleep mode (stops Claude API calls when server empty or NPC dead)
- `7e12192` — Boundaries, block placement, containers, proximity chat, goal-driven AI
- `84c3393` — Configurable spawn position

---

## What Was Implemented

### 1. Server-Side Boundary Enforcement (Forge Mod)
**Hard enforcement** — NPC physically cannot leave the boundary regardless of what triggers movement.

- `NunclePlayer.java`: Nullable `Double` fields `boundaryCenterX`, `boundaryCenterZ`, `boundaryRadius`
- **tick()**: Every tick, if outside boundary → teleport to edge, stop navigation, clear all targets
- **goTo()**: Clamp destination to boundary edge
- **follow()**: Stop following if target leaves boundary
- **doWander()**: Pick random destinations within boundary circle (absolute coords)
- **attack()**: Drop target if it leaves boundary
- **mine()**: Reject blocks outside boundary
- **placeBlock()**: Reject positions outside boundary
- Commands: `/nuncle boundary set <x> <z> <radius>`, `/nuncle boundary clear`, `/nuncle boundary info`
- Bot syncs boundary from `.env` to Forge mod on every spawn/respawn
- `NuncleObserver.java`: Boundary info included in `observe()` JSON for Claude

### 2. Block Placement
- `NunclePlayer.placeBlock(x, y, z, blockName)`: Boundary + distance check, finds matching `BlockItem` in inventory, uses `level.setBlock(pos, state, 3)`
- Command: `/nuncle place <x> <y> <z> <blockName>`
- Bot tool: `placeBlock` in `actions.ts`

### 3. Container Access
- `takeFromContainer(x, y, z, itemFilter, count)`: Takes items from `Container` block entities (chests, barrels, etc.)
- `putInContainer(x, y, z, itemName, count)`: Puts items from NPC inventory into containers
- Commands: `/nuncle take <x> <y> <z> [itemFilter] [count]`, `/nuncle put <x> <y> <z> <itemName> [count]`
- Bot tools: `takeFromContainer`, `putInContainer` in `actions.ts`

### 4. `/nunclewhere` Command
- Separate top-level command, no permission required (any player can use)
- Shows gold `[NuncleNelson]` prefix, aqua clickable coordinates (suggests `/tp @s X Y Z`), biome info
- Uses `ClickEvent` + `HoverEvent` for interactivity

### 5. Tab List Entry — SKIPPED
Deferred as experimental/fragile. `ClientboundPlayerInfoUpdatePacket` constructors in Forge 1.20.1 are tricky.

---

## Additional Features (Beyond Original Plan)

### Sleep Mode (`brain.ts`)
- NPC sleeps when: last player leaves, NPC dies
- NPC wakes when: player joins, chat near Nuncle, damage, respawn with players online
- **Zero Claude API calls** while sleeping — stops the 45s periodic timer entirely
- Chat announcements: `*yawns and curls up for a nap*` / `*wakes up and stretches*`
- `brain.start()` called once (not per respawn) to avoid duplicate listeners

### Proximity Chat (Forge Mod — `NuncleMod.java`)
- `ServerChatEvent` handler with `HEARING_RADIUS = 32.0` blocks
- Only logs `[NUNCLE] HEARD <player> <message>` if player is within range
- Bot-side `index.ts` switched from raw `<player> message` parsing to `HEARD` events

### `!nuncle` Summon Command (Forge Mod)
- Any player can type `!nuncle` in chat from anywhere
- If **no boundary** set: logs `[NUNCLE] SUMMONED` and Nuncle walks toward them
- If **boundary set**: auto-replies in chat with current location and boundary info (no Claude call)

### Goal-Driven AI (`brain.ts`)
- System prompt includes primary goal from `memory.goals.current` (default: "Find shelter away from monsters and dig a cave to live in")
- Claude must output 1-sentence reasoning before each tool use
- Reasoning logged: `AIBrain reason: <text>`

### Configurable Spawn Position
- `.env` vars: `AI_PLAYER_SPAWN_X`, `AI_PLAYER_SPAWN_Y`, `AI_PLAYER_SPAWN_Z`
- `bot.ts` sends `nuncle spawn X Y Z` if set, otherwise `nuncle spawn`
- `types.ts`: `spawnPosition: Position | null` on `AIPlayerConfig`

---

## Files Modified

| File | Changes |
|------|---------|
| `forge-mod/.../NunclePlayer.java` | Boundary fields + tick enforcement, placeBlock(), container methods |
| `forge-mod/.../NuncleCommands.java` | boundary, place, take, put commands + nunclewhere |
| `forge-mod/.../NuncleObserver.java` | Boundary info in observe() |
| `forge-mod/.../NuncleMod.java` | ServerChatEvent proximity filter, !nuncle summon |
| `forge-mod/build.gradle` | Version bump 1.0.0 → 1.1.0 |
| `src/ai-player/brain.ts` | Sleep mode, goal-driven prompt, reasoning logging |
| `src/ai-player/actions.ts` | placeBlock, takeFromContainer, putInContainer tools |
| `src/ai-player/index.ts` | HEARD events, boundary sync, brain.start() fix |
| `src/ai-player/bot.ts` | Spawn position support |
| `src/ai-player/types.ts` | spawnPosition field |
| `src/config.ts` | Spawn position env vars |

---

## Deployment Status

### Bot (vulture-bot)
Deployed and running. `.env` on VPS has:
```
AI_PLAYER_SPAWN_X=-2448
AI_PLAYER_SPAWN_Y=72
AI_PLAYER_SPAWN_Z=-233
AI_PLAYER_BOUNDARY_X=-2448
AI_PLAYER_BOUNDARY_Z=-233
AI_PLAYER_BOUNDARY_RADIUS=150
```

### Forge Mod
`nuncle-nelson-1.1.0.jar` built and deployed to `/opt/minecraft/server/mods/`.
Old `nuncle-nelson-1.0.0.jar` removed.

---

## Technical Reference

- Forge 1.20.1 with **official mappings** (not MCP/Yarn)
- Java package: `com.vulture.nuncle` (in `forge-mod/src/main/java/com/vulture/nuncle/`)
- TypeScript: `src/ai-player/`
- Bot-side `AIPlayerBot.sendCommand()` prefixes commands with `nuncle` automatically
- Container interface: `net.minecraft.world.Container` (NOT `IInventory`)
- Block placement: `BlockItem` + `level.setBlock(pos, state, 3)` (flags=3 = notify)
- Log events from mod: `[NUNCLE] HEARD|SUMMONED|DAMAGED|DIED|SAID|BOUNDARY_ENFORCED`

## Future Work
- Tab list entry (experimental — needs `ClientboundPlayerInfoUpdatePacket` research)
- Slack adapter
- More AI capabilities as needed
