# NuncleNelson — Boundaries, Block Placement, Container Access

## Status: NOT STARTED
All code below is planned but not yet implemented. Pick up from step 1.

---

## Context
NuncleNelson can currently be led outside his area by following players, wandering randomly, or if Claude gets confused. The boundary system only exists as a soft clamp on `goToPosition` in the bot — wander, follow, mine, and attack all ignore it. We need **hard server-side enforcement** in the Forge mod so the NPC physically cannot leave a defined area, regardless of what Claude does.

Additionally, Nuncle currently can't place blocks or interact with containers, limiting what tasks we can give him. We're adding both capabilities plus a `/nunclewhere` command for players and tab list visibility.

---

## Files to Modify

| File | Changes |
|------|---------|
| `forge-mod/src/main/java/com/vulture/nuncle/NunclePlayer.java` | Boundary fields + tick enforcement, placeBlock(), container methods, tab list |
| `forge-mod/src/main/java/com/vulture/nuncle/NuncleCommands.java` | boundary, place, take, put, nunclewhere commands |
| `forge-mod/src/main/java/com/vulture/nuncle/NuncleObserver.java` | Boundary info in observe() |
| `forge-mod/src/main/java/com/vulture/nuncle/NuncleMod.java` | PlayerLoggedInEvent for tab list |
| `src/ai-player/actions.ts` | placeBlock, takeFromContainer, putInContainer tools |
| `src/ai-player/index.ts` | Boundary sync on startup |
| `forge-mod/build.gradle` | Version bump 1.0.0 → 1.1.0 |

## Implementation Order
1. Boundary enforcement (safety first)
2. Place blocks
3. Container access
4. `/nunclewhere` command
5. Tab list entry (experimental)

---

## 1. Server-Side Boundary Enforcement (Forge Mod)

### `NunclePlayer.java`
- Add fields: `boundaryCenterX`, `boundaryCenterZ`, `boundaryRadius` (all `Double`, nullable)
- Add methods: `setBoundary(x, z, radius)`, `clearBoundary()`, `getBoundaryInfo()`
- Add helpers: `isInsideBoundary(x, z)`, `clampToBoundary(x, z)` — returns `double[]` clamped point on circle edge

**Hard enforcement in `tick()`** — every tick, if NPC is outside boundary:
- Teleport to boundary edge, stop navigation, clear follow/wander/attack targets
- This catches ALL cases: admin `/tp`, pathfinding drift, anything

```java
// In tick(), right after isAlive() check:
if (boundaryCenterX != null) {
    if (!isInsideBoundary(npc.getX(), npc.getZ())) {
        double[] clamped = clampToBoundary(npc.getX(), npc.getZ());
        npc.teleportTo(clamped[0], npc.getY(), clamped[1]);
        npc.getNavigation().stop();
        followTarget = null;
        wandering = false;
        attackTarget = null;
        NuncleMod.LOGGER.info("[NUNCLE] BOUNDARY_ENFORCED teleported back");
    }
}
```

**Enforce in every movement method:**
- `goTo()` — clamp destination to boundary edge, log if clamped
- `follow()` tick section — stop following if target leaves boundary area (with a small margin)
- `doWander()` — pick random destinations within boundary circle (absolute, not relative to NPC)
- `attack()` tick section — drop target if it leaves boundary
- `mine()` — reject blocks outside boundary
- `placeBlock()` — reject positions outside boundary (new method, see below)

### `NuncleCommands.java`
```
/nuncle boundary set <x> <z> <radius>   — configure boundary (op only)
/nuncle boundary clear                   — remove boundary (op only)
/nuncle boundary info                    — show current boundary
```

### Bot-side sync (`src/ai-player/index.ts`)
After `bot.connect()`, in the `spawned` handler, send boundary config to the mod:
```typescript
bot.on('spawned', async () => {
    // Sync boundary from .env config to Forge mod
    if (config.boundary) {
        const { centerX, centerZ, radius } = config.boundary;
        await bot.sendCommand(`boundary set ${centerX} ${centerZ} ${radius}`);
        logger.info(`Boundary synced: center=(${centerX},${centerZ}) radius=${radius}`);
    }
    brain.start();
    logger.info('AI Player brain activated');
});
```

### `NuncleObserver.java`
Include boundary info in `observe()` JSON so Claude knows its limits:
```json
{
  "self": { ... },
  "boundary": { "centerX": 100, "centerZ": 200, "radius": 150, "distanceFromEdge": 42 }
}
```

---

## 2. Place Blocks

### `NunclePlayer.java` — new method `placeBlock(int x, int y, int z, String blockName)`
- Boundary check first, then distance check (6 blocks)
- Check target pos is air or replaceable (`state.canBeReplaced()`)
- Iterate inventory to find matching `BlockItem` — match against `blockName` fuzzy
- `level.setBlock(pos, block.defaultBlockState(), 3)` — flags=3 means notify neighbors + clients
- Shrink the item stack by 1

```java
public String placeBlock(int x, int y, int z, String blockName) {
    if (!isAlive()) return "NuncleNelson is not spawned";

    BlockPos pos = new BlockPos(x, y, z);

    // Boundary check
    if (boundaryCenterX != null && !isInsideBoundary(x, z)) {
        return "Cannot place block outside boundary";
    }

    // Distance check
    double dist = npc.position().distanceTo(Vec3.atCenterOf(pos));
    if (dist > 6.0) {
        npc.getNavigation().moveTo(x, y + 1, z, 1.0);
        return "Too far to place block (" + (int) dist + " blocks). Moving closer.";
    }

    ServerLevel level = (ServerLevel) npc.level();
    BlockState currentState = level.getBlockState(pos);
    if (!currentState.canBeReplaced()) {
        return "Cannot place block at " + x + " " + y + " " + z + " — position is not empty";
    }

    // Find matching BlockItem in inventory
    for (int i = 0; i < npc.getInventory().getContainerSize(); i++) {
        ItemStack stack = npc.getInventory().getItem(i);
        if (stack.isEmpty()) continue;
        if (!(stack.getItem() instanceof BlockItem blockItem)) continue;

        String itemName = stack.getItem().getDescriptionId()
            .replace("item.minecraft.", "").replace("block.minecraft.", "");
        if (!itemName.toLowerCase().contains(blockName.toLowerCase())) continue;

        // Place it
        level.setBlock(pos, blockItem.getBlock().defaultBlockState(), 3);
        stack.shrink(1);
        if (stack.isEmpty()) npc.getInventory().setItem(i, ItemStack.EMPTY);
        return "Placed " + itemName + " at " + x + " " + y + " " + z;
    }

    return "No " + blockName + " blocks in inventory";
}
```

**Import needed:** `net.minecraft.world.item.BlockItem`

### `NuncleCommands.java`
```
/nuncle place <x> <y> <z> <blockName>
```
Uses IntegerArgumentType for x/y/z, StringArgumentType.word() for blockName.

### `src/ai-player/actions.ts`
Add tool:
```typescript
{
    name: 'placeBlock',
    description: 'Place a block from your inventory at a specific position. Must be within 6 blocks and position must be empty.',
    input_schema: {
        type: 'object',
        properties: {
            x: { type: 'number', description: 'X coordinate' },
            y: { type: 'number', description: 'Y coordinate' },
            z: { type: 'number', description: 'Z coordinate' },
            blockName: { type: 'string', description: 'Block name to place (e.g. "cobblestone", "oak_planks")' },
        },
        required: ['x', 'y', 'z', 'blockName'],
    },
},
```

In `ActionExecutor.execute()`:
```typescript
case 'placeBlock':
    return await this.bot.sendCommand(
        `place ${Math.round(args.x)} ${Math.round(args.y)} ${Math.round(args.z)} ${args.blockName}`
    );
```

---

## 3. Container Access

### `NunclePlayer.java` — two new methods

**`takeFromContainer(int x, int y, int z, @Nullable String itemFilter, int count)`**
- Boundary + distance check (6 blocks)
- `level.getBlockEntity(pos)` → check if it implements `Container` interface
- Iterate container slots, find matching items (fuzzy name match if filter given, all if null)
- Transfer to villager inventory via `npc.getInventory().addItem()`
- Handle: full inventory → partial transfer, empty container, non-container block
- Call `container.setChanged()` after modifications

```java
public String takeFromContainer(int x, int y, int z, @Nullable String itemFilter, int count) {
    if (!isAlive()) return "NuncleNelson is not spawned";

    BlockPos pos = new BlockPos(x, y, z);
    if (boundaryCenterX != null && !isInsideBoundary(x, z)) {
        return "Container is outside boundary";
    }

    double dist = npc.position().distanceTo(Vec3.atCenterOf(pos));
    if (dist > 6.0) {
        npc.getNavigation().moveTo(x, y, z, 1.0);
        return "Too far (" + (int) dist + " blocks). Moving closer.";
    }

    ServerLevel level = (ServerLevel) npc.level();
    var be = level.getBlockEntity(pos);
    if (!(be instanceof Container container)) {
        return "No container at " + x + " " + y + " " + z;
    }

    List<String> taken = new ArrayList<>();
    int remaining = count;

    for (int i = 0; i < container.getContainerSize() && remaining > 0; i++) {
        ItemStack stack = container.getItem(i);
        if (stack.isEmpty()) continue;

        String name = stack.getItem().getDescriptionId()
            .replace("item.minecraft.", "").replace("block.minecraft.", "");
        if (itemFilter != null && !name.toLowerCase().contains(itemFilter.toLowerCase())) continue;

        int toTake = Math.min(remaining, stack.getCount());
        ItemStack toInsert = stack.copy();
        toInsert.setCount(toTake);
        ItemStack leftover = npc.getInventory().addItem(toInsert);
        int actuallyTaken = toTake - leftover.getCount();

        if (actuallyTaken > 0) {
            stack.shrink(actuallyTaken);
            if (stack.isEmpty()) container.setItem(i, ItemStack.EMPTY);
            taken.add(actuallyTaken + "x " + name);
            remaining -= actuallyTaken;
        }

        if (!leftover.isEmpty()) {
            taken.add("(inventory full)");
            break;
        }
    }

    container.setChanged();

    if (taken.isEmpty()) {
        return itemFilter != null ? "No " + itemFilter + " in container" : "Container is empty";
    }
    return "Took: " + String.join(", ", taken);
}
```

**`putInContainer(int x, int y, int z, String itemName, int count)`**
- Same boundary + distance checks
- Find matching items in villager inventory
- Transfer to container: merge into existing stacks first, then empty slots
- `container.setChanged()` after modifications

```java
public String putInContainer(int x, int y, int z, String itemName, int count) {
    if (!isAlive()) return "NuncleNelson is not spawned";

    BlockPos pos = new BlockPos(x, y, z);
    if (boundaryCenterX != null && !isInsideBoundary(x, z)) {
        return "Container is outside boundary";
    }

    double dist = npc.position().distanceTo(Vec3.atCenterOf(pos));
    if (dist > 6.0) {
        npc.getNavigation().moveTo(x, y, z, 1.0);
        return "Too far (" + (int) dist + " blocks). Moving closer.";
    }

    ServerLevel level = (ServerLevel) npc.level();
    var be = level.getBlockEntity(pos);
    if (!(be instanceof Container container)) {
        return "No container at " + x + " " + y + " " + z;
    }

    List<String> put = new ArrayList<>();
    int remaining = count;

    for (int i = 0; i < npc.getInventory().getContainerSize() && remaining > 0; i++) {
        ItemStack stack = npc.getInventory().getItem(i);
        if (stack.isEmpty()) continue;

        String name = stack.getItem().getDescriptionId()
            .replace("item.minecraft.", "").replace("block.minecraft.", "");
        if (!name.toLowerCase().contains(itemName.toLowerCase())) continue;

        int toMove = Math.min(remaining, stack.getCount());
        // Try to insert into container (merge first, then empty slots)
        ItemStack toInsert = stack.copy();
        toInsert.setCount(toMove);

        // Simple: try each container slot
        int moved = 0;
        for (int j = 0; j < container.getContainerSize() && moved < toMove; j++) {
            ItemStack cSlot = container.getItem(j);
            if (cSlot.isEmpty()) {
                int amt = Math.min(toMove - moved, container.getMaxStackSize());
                ItemStack newStack = toInsert.copy();
                newStack.setCount(amt);
                container.setItem(j, newStack);
                moved += amt;
            } else if (ItemStack.isSameItemSameTags(cSlot, toInsert)) {
                int space = cSlot.getMaxStackSize() - cSlot.getCount();
                int amt = Math.min(toMove - moved, space);
                cSlot.grow(amt);
                moved += amt;
            }
        }

        if (moved > 0) {
            stack.shrink(moved);
            if (stack.isEmpty()) npc.getInventory().setItem(i, ItemStack.EMPTY);
            put.add(moved + "x " + name);
            remaining -= moved;
        }
    }

    container.setChanged();

    if (put.isEmpty()) {
        return "No " + itemName + " in inventory (or container is full)";
    }
    return "Put: " + String.join(", ", put);
}
```

**Import needed:** `net.minecraft.world.Container`

### `NuncleCommands.java`
```
/nuncle take <x> <y> <z> [itemFilter] [count]     — default count=64
/nuncle put <x> <y> <z> <itemName> [count]         — default count=64
```

### `src/ai-player/actions.ts`
Add tools:
```typescript
{
    name: 'takeFromContainer',
    description: 'Take items from a container (chest, barrel, etc.) at a position. Must be within 6 blocks.',
    input_schema: {
        type: 'object',
        properties: {
            x: { type: 'number', description: 'X coordinate of container' },
            y: { type: 'number', description: 'Y coordinate of container' },
            z: { type: 'number', description: 'Z coordinate of container' },
            itemFilter: { type: 'string', description: 'Item name to filter for (optional — takes all if omitted)' },
            count: { type: 'number', description: 'Max items to take (default 64)' },
        },
        required: ['x', 'y', 'z'],
    },
},
{
    name: 'putInContainer',
    description: 'Put items from your inventory into a container (chest, barrel, etc.) at a position. Must be within 6 blocks.',
    input_schema: {
        type: 'object',
        properties: {
            x: { type: 'number', description: 'X coordinate of container' },
            y: { type: 'number', description: 'Y coordinate of container' },
            z: { type: 'number', description: 'Z coordinate of container' },
            itemName: { type: 'string', description: 'Item name to deposit (e.g. "cobblestone")' },
            count: { type: 'number', description: 'Max items to put (default 64)' },
        },
        required: ['x', 'y', 'z', 'itemName'],
    },
},
```

In `ActionExecutor.execute()`:
```typescript
case 'takeFromContainer': {
    const filter = args.itemFilter ? ` ${args.itemFilter}` : '';
    const count = args.count ?? 64;
    return await this.bot.sendCommand(
        `take ${Math.round(args.x)} ${Math.round(args.y)} ${Math.round(args.z)}${filter} ${count}`
    );
}
case 'putInContainer': {
    const count = args.count ?? 64;
    return await this.bot.sendCommand(
        `put ${Math.round(args.x)} ${Math.round(args.y)} ${Math.round(args.z)} ${args.itemName} ${count}`
    );
}
```

---

## 4. `/nunclewhere` Command

### `NuncleCommands.java`
Register as a **separate top-level command** (not under `/nuncle`) with **no permission requirement**:

```java
// In register(), add SEPARATE from the /nuncle tree:
dispatcher.register(Commands.literal("nunclewhere")
    .executes(NuncleCommands::nuncleWhere));
```

Implementation:
```java
private static int nuncleWhere(CommandContext<CommandSourceStack> ctx) {
    NunclePlayer mgr = NuncleMod.getNpcManager();
    Villager npc = mgr.getNpc();
    if (npc == null || !npc.isAlive()) {
        ctx.getSource().sendSuccess(() -> Component.literal("NuncleNelson is not currently spawned"), false);
        return 1;
    }

    int x = (int) npc.getX();
    int y = (int) npc.getY();
    int z = (int) npc.getZ();
    String biome = ((ServerLevel) npc.level()).getBiome(npc.blockPosition())
        .unwrapKey().map(k -> k.location().getPath().replace("_", " ")).orElse("unknown");

    Component coords = Component.literal(x + " " + y + " " + z)
        .withStyle(style -> style
            .withColor(ChatFormatting.AQUA)
            .withClickEvent(new ClickEvent(ClickEvent.Action.SUGGEST_COMMAND, "/tp @s " + x + " " + y + " " + z))
            .withHoverEvent(new HoverEvent(HoverEvent.Action.SHOW_TEXT, Component.literal("Click to teleport")))
        );

    Component msg = Component.literal("[")
        .append(Component.literal(NuncleMod.NPC_NAME).withStyle(ChatFormatting.GOLD))
        .append(Component.literal("] at "))
        .append(coords)
        .append(Component.literal(" (" + biome + ")").withStyle(ChatFormatting.GRAY));

    ctx.getSource().sendSuccess(() -> msg, false);
    return 1;
}
```

**Imports needed:** `net.minecraft.network.chat.ClickEvent`, `net.minecraft.network.chat.HoverEvent`

---

## 5. Tab List Entry (Experimental — implement last)

### `NunclePlayer.java`
- Static UUID: `UUID.nameUUIDFromBytes("NuncleNelson".getBytes())`
- `addToTabList()` — send `ClientboundPlayerInfoUpdatePacket` with fake `GameProfile` to all players
- `removeFromTabList()` — send `ClientboundPlayerInfoRemovePacket`
- Call `addToTabList()` after spawn, `removeFromTabList()` on despawn/death
- Gold display name in tab list

### `NuncleMod.java`
- Add `PlayerLoggedInEvent` handler to resend tab entry to newly joining players

**Note:** This is the most fragile feature. The packet constructors for `ClientboundPlayerInfoUpdatePacket` are tricky in Forge 1.20.1 with official mappings. May need `EnumSet` of `Action` flags. If it doesn't compile cleanly, skip it and revisit later.

---

## Verification Checklist
1. `npm run build` — TypeScript compiles
2. `cd forge-mod && ./gradlew build` — mod compiles, produces jar
3. Deploy + manual RCON testing:
   - `/nuncle boundary set 0 0 100` then `/nuncle goto 500 64 500` → clamped
   - `/tp @e[name=NuncleNelson] 500 64 500` → snaps back next tick
   - `/nuncle place X Y Z cobblestone` → places block
   - `/nuncle take X Y Z` on a chest → transfers items
   - `/nunclewhere` as normal player → clickable coords
   - Tab key shows NuncleNelson in player list

---

## Current File Contents Reference

All source files are on `main` branch at commit `1df5c97`. The package is:
- **Java:** `com.vulture.nuncle` (in `forge-mod/src/main/java/com/vulture/nuncle/`)
- **TypeScript:** `src/ai-player/`

Key things a new Claude instance needs to know:
- Forge 1.20.1 with **official mappings** (not MCP/Yarn)
- Villager NPC controlled via RCON commands → Forge mod executes actions server-side
- Bot-side `AIPlayerBot.sendCommand()` prefixes commands with `nuncle` automatically
- `build.gradle` version should bump from `1.0.0` to `1.1.0`
- The `.env` has `AI_PLAYER_BOUNDARY_CENTER_X`, `AI_PLAYER_BOUNDARY_CENTER_Z`, `AI_PLAYER_BOUNDARY_RADIUS`
- Container interface in 1.20.1: `net.minecraft.world.Container` (NOT `IInventory`)

## Deploy After Implementation
```bash
# Local:
git push origin main

# On VPS (as root):
deploy-bot
sudo systemctl restart vulture-bot

# Build and deploy the Forge mod:
cd /opt/minecraft/bot/forge-mod && ./gradlew build
sudo cp build/libs/nuncle-nelson-1.1.0.jar /opt/minecraft/server/mods/
sudo rm /opt/minecraft/server/mods/nuncle-nelson-1.0.0.jar
sudo systemctl restart minecraft
```

## Dynmap Note
- Dynmap full render may still be running. Config at `/opt/minecraft/server/dynmap/configuration.txt`
- Default: `tiles-rendered-at-once: 2`
- Cancel render in-game: `/dynmap cancelrender world` (for each world)
- `dynmap reload` is NOT valid — config changes need MC restart
