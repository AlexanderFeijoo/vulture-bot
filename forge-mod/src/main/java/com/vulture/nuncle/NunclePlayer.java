package com.vulture.nuncle;

import net.minecraft.ChatFormatting;
import net.minecraft.core.BlockPos;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.Container;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.item.ItemEntity;
import net.minecraft.world.entity.npc.Villager;
import net.minecraft.world.entity.npc.VillagerType;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.Vec3;
import net.minecraftforge.event.entity.living.LivingDamageEvent;
import net.minecraftforge.event.entity.living.LivingDeathEvent;

import javax.annotation.Nullable;
import java.util.ArrayList;
import java.util.List;

public class NunclePlayer {
    private final MinecraftServer server;
    private Villager npc;

    // Movement state
    private ServerPlayer followTarget;
    private boolean wandering;
    private int wanderCooldown;

    // Attack state
    private LivingEntity attackTarget;

    // Thinking state
    private boolean thinking;
    private int thinkingParticleTick;

    // Boundary state
    @Nullable private Double boundaryCenterX;
    @Nullable private Double boundaryCenterZ;
    @Nullable private Double boundaryRadius;

    // Announcement timer (~10 min = 12000 ticks)
    private static final int LOCATION_ANNOUNCE_INTERVAL = 12000;
    private int locationAnnounceTick;

    public NunclePlayer(MinecraftServer server) {
        this.server = server;
    }

    public boolean isAlive() {
        return npc != null && npc.isAlive();
    }

    @Nullable
    public Villager getNpc() {
        return npc;
    }

    // --- Boundary methods ---

    public String setBoundary(double x, double z, double radius) {
        this.boundaryCenterX = x;
        this.boundaryCenterZ = z;
        this.boundaryRadius = radius;
        NuncleMod.LOGGER.info("[NUNCLE] BOUNDARY_SET center=({},{}) radius={}", (int) x, (int) z, (int) radius);
        return "Boundary set: center (" + (int) x + ", " + (int) z + ") radius " + (int) radius;
    }

    public String clearBoundary() {
        this.boundaryCenterX = null;
        this.boundaryCenterZ = null;
        this.boundaryRadius = null;
        NuncleMod.LOGGER.info("[NUNCLE] BOUNDARY_CLEARED");
        return "Boundary cleared";
    }

    public String getBoundaryInfo() {
        if (boundaryCenterX == null) {
            return "No boundary set";
        }
        String info = "Boundary: center (" + boundaryCenterX.intValue() + ", " + boundaryCenterZ.intValue() +
            ") radius " + boundaryRadius.intValue();
        if (isAlive()) {
            double dist = distFromBoundaryCenter(npc.getX(), npc.getZ());
            info += " | NPC is " + (int) dist + " blocks from center (" +
                (int) (boundaryRadius - dist) + " from edge)";
        }
        return info;
    }

    private boolean isInsideBoundary(double x, double z) {
        if (boundaryCenterX == null) return true;
        return distFromBoundaryCenter(x, z) <= boundaryRadius;
    }

    private double distFromBoundaryCenter(double x, double z) {
        double dx = x - boundaryCenterX;
        double dz = z - boundaryCenterZ;
        return Math.sqrt(dx * dx + dz * dz);
    }

    /** Clamp a point to the boundary edge. Returns {x, z}. */
    private double[] clampToBoundary(double x, double z) {
        if (boundaryCenterX == null) return new double[]{x, z};
        double dx = x - boundaryCenterX;
        double dz = z - boundaryCenterZ;
        double dist = Math.sqrt(dx * dx + dz * dz);
        if (dist <= boundaryRadius) return new double[]{x, z};
        double scale = boundaryRadius / dist;
        return new double[]{boundaryCenterX + dx * scale, boundaryCenterZ + dz * scale};
    }

    // --- Spawn/despawn ---

    public String spawn(double x, double y, double z) {
        if (npc != null && npc.isAlive()) {
            return "NuncleNelson is already spawned at " +
                (int) npc.getX() + " " + (int) npc.getY() + " " + (int) npc.getZ();
        }

        ServerLevel level = server.overworld();
        npc = new Villager(EntityType.VILLAGER, level, VillagerType.PLAINS);
        npc.setCustomName(Component.literal(NuncleMod.NPC_NAME));
        npc.setCustomNameVisible(true);
        npc.moveTo(x, y, z, 0.0F, 0.0F);
        npc.setInvulnerable(false);
        npc.setPersistenceRequired();
        npc.setNoAi(false);

        // Clear default villager AI, add idle look
        npc.goalSelector.removeAllGoals(g -> true);
        npc.goalSelector.addGoal(10, new net.minecraft.world.entity.ai.goal.LookAtPlayerGoal(
            npc, ServerPlayer.class, 8.0F));
        npc.goalSelector.addGoal(11, new net.minecraft.world.entity.ai.goal.RandomLookAroundGoal(npc));

        level.addFreshEntity(npc);
        locationAnnounceTick = 0;

        NuncleMod.LOGGER.info("[NUNCLE] SPAWNED {} {} {}",
            (int) x, (int) y, (int) z);

        broadcastAnnouncement(NuncleMod.NPC_NAME + " has arrived at " +
            (int) x + " " + (int) y + " " + (int) z);

        return "NuncleNelson spawned at " + (int) x + " " + (int) y + " " + (int) z;
    }

    public String spawnAtWorldSpawn() {
        ServerLevel level = server.overworld();
        BlockPos spawn = level.getSharedSpawnPos();
        return spawn(spawn.getX() + 0.5, spawn.getY(), spawn.getZ() + 0.5);
    }

    public String despawn() {
        if (npc == null || !npc.isAlive()) {
            return "NuncleNelson is not spawned";
        }
        npc.discard();
        npc = null;
        followTarget = null;
        attackTarget = null;
        wandering = false;
        thinking = false;
        NuncleMod.LOGGER.info("[NUNCLE] DESPAWNED");
        return "NuncleNelson despawned";
    }

    // --- Chat ---

    public String chat(String message) {
        if (!isAlive()) return "NuncleNelson is not spawned";

        Component chatMsg = Component.empty()
            .append(Component.literal("<"))
            .append(Component.literal(NuncleMod.NPC_NAME).withStyle(ChatFormatting.GOLD))
            .append(Component.literal("> " + message));
        server.getPlayerList().broadcastSystemMessage(chatMsg, false);

        NuncleMod.LOGGER.info("[NUNCLE] SAID {}", message);
        return "Said: " + message;
    }

    // --- Movement (boundary-aware) ---

    public String goTo(double x, double y, double z) {
        if (!isAlive()) return "NuncleNelson is not spawned";
        followTarget = null;
        wandering = false;
        attackTarget = null;

        // Clamp destination to boundary
        double[] clamped = clampToBoundary(x, z);
        boolean wasClamped = clamped[0] != x || clamped[1] != z;

        boolean started = npc.getNavigation().moveTo(clamped[0], y, clamped[1], 1.0);
        String dest = (int) clamped[0] + " " + (int) y + " " + (int) clamped[1];
        if (wasClamped) {
            NuncleMod.LOGGER.info("[NUNCLE] BOUNDARY_CLAMPED goto from ({},{}) to ({},{})",
                (int) x, (int) z, (int) clamped[0], (int) clamped[1]);
        }
        if (started) {
            return wasClamped ? "Moving to " + dest + " (clamped to boundary)" : "Moving to " + dest;
        }
        return "Cannot pathfind to " + dest;
    }

    public String follow(String playerName) {
        if (!isAlive()) return "NuncleNelson is not spawned";

        ServerPlayer target = server.getPlayerList().getPlayerByName(playerName);
        if (target == null) {
            return "Player " + playerName + " not found";
        }

        followTarget = target;
        wandering = false;
        attackTarget = null;
        return "Following " + playerName;
    }

    public String wander() {
        if (!isAlive()) return "NuncleNelson is not spawned";
        followTarget = null;
        attackTarget = null;
        wandering = true;
        wanderCooldown = 0;
        doWander();
        return "Wandering randomly";
    }

    public String stay() {
        if (!isAlive()) return "NuncleNelson is not spawned";
        followTarget = null;
        wandering = false;
        attackTarget = null;
        npc.getNavigation().stop();
        return "Staying in place";
    }

    public String lookAt(double x, double y, double z) {
        if (!isAlive()) return "NuncleNelson is not spawned";
        npc.getLookControl().setLookAt(x, y, z);
        return "Looking at " + (int) x + " " + (int) y + " " + (int) z;
    }

    public String attack(String entityType) {
        if (!isAlive()) return "NuncleNelson is not spawned";

        AABB area = npc.getBoundingBox().inflate(16.0);
        List<Entity> nearby = npc.level().getEntities(npc, area);

        LivingEntity closest = null;
        double closestDist = Double.MAX_VALUE;

        for (Entity e : nearby) {
            if (!(e instanceof LivingEntity le)) continue;
            String name = EntityType.getKey(e.getType()).getPath();
            if (!name.equals(entityType)) continue;
            // Skip targets outside boundary
            if (!isInsideBoundary(e.getX(), e.getZ())) continue;
            double dist = npc.distanceTo(e);
            if (dist < closestDist) {
                closest = le;
                closestDist = dist;
            }
        }

        if (closest == null) {
            return "No " + entityType + " found nearby";
        }

        attackTarget = closest;
        followTarget = null;
        wandering = false;
        return "Attacking " + entityType + " (" + (int) closestDist + " blocks away)";
    }

    // --- Mining (boundary-aware) ---

    public String mine(int x, int y, int z) {
        if (!isAlive()) return "NuncleNelson is not spawned";

        if (!isInsideBoundary(x, z)) {
            return "Cannot mine outside boundary";
        }

        ServerLevel level = (ServerLevel) npc.level();
        BlockPos pos = new BlockPos(x, y, z);
        BlockState state = level.getBlockState(pos);

        if (state.isAir()) {
            return "No block at " + x + " " + y + " " + z;
        }

        double dist = npc.position().distanceTo(Vec3.atCenterOf(pos));
        if (dist > 6.0) {
            npc.getNavigation().moveTo(x, y + 1, z, 1.0);
            return "Too far to mine (" + (int) dist + " blocks). Moving closer.";
        }

        String blockName = state.getBlock().getDescriptionId();
        boolean broken = level.destroyBlock(pos, true, npc);
        if (broken) {
            return "Mined " + blockName + " at " + x + " " + y + " " + z;
        }
        return "Failed to mine block at " + x + " " + y + " " + z;
    }

    // --- Block placement (boundary-aware) ---

    public String placeBlock(int x, int y, int z, String blockName) {
        if (!isAlive()) return "NuncleNelson is not spawned";

        if (!isInsideBoundary(x, z)) {
            return "Cannot place block outside boundary";
        }

        BlockPos pos = new BlockPos(x, y, z);
        double dist = npc.position().distanceTo(Vec3.atCenterOf(pos));
        if (dist > 6.0) {
            npc.getNavigation().moveTo(x, y + 1, z, 1.0);
            return "Too far to place block (" + (int) dist + " blocks). Moving closer.";
        }

        ServerLevel level = (ServerLevel) npc.level();
        BlockState currentState = level.getBlockState(pos);
        if (!currentState.canBeReplaced()) {
            return "Cannot place block at " + x + " " + y + " " + z + " - position is not empty";
        }

        // Find matching BlockItem in inventory
        for (int i = 0; i < npc.getInventory().getContainerSize(); i++) {
            ItemStack stack = npc.getInventory().getItem(i);
            if (stack.isEmpty()) continue;
            if (!(stack.getItem() instanceof BlockItem blockItem)) continue;

            String itemName = stack.getItem().getDescriptionId()
                .replace("item.minecraft.", "").replace("block.minecraft.", "");
            if (!itemName.toLowerCase().contains(blockName.toLowerCase())) continue;

            level.setBlock(pos, blockItem.getBlock().defaultBlockState(), 3);
            stack.shrink(1);
            if (stack.isEmpty()) npc.getInventory().setItem(i, ItemStack.EMPTY);
            return "Placed " + itemName + " at " + x + " " + y + " " + z;
        }

        return "No " + blockName + " blocks in inventory";
    }

    // --- Item pickup/drop ---

    public String pickup(@Nullable String itemFilter) {
        if (!isAlive()) return "NuncleNelson is not spawned";

        AABB area = npc.getBoundingBox().inflate(6.0);
        List<Entity> entities = npc.level().getEntities(npc, area);

        List<String> pickedUp = new ArrayList<>();
        for (Entity e : entities) {
            if (!(e instanceof ItemEntity itemEntity)) continue;
            if (!itemEntity.isAlive()) continue;

            ItemStack stack = itemEntity.getItem();
            String itemName = stack.getItem().getDescriptionId()
                .replace("item.minecraft.", "").replace("block.minecraft.", "");

            if (itemFilter != null && !itemFilter.isEmpty()
                && !itemName.toLowerCase().contains(itemFilter.toLowerCase())) {
                continue;
            }

            ItemStack remainder = npc.getInventory().addItem(stack.copy());
            if (remainder.getCount() < stack.getCount()) {
                int taken = stack.getCount() - remainder.getCount();
                if (remainder.isEmpty()) {
                    itemEntity.discard();
                } else {
                    itemEntity.setItem(remainder);
                }
                pickedUp.add(taken + "x " + itemName);
            }
        }

        if (pickedUp.isEmpty()) {
            return itemFilter != null ? "No " + itemFilter + " found nearby" : "No items found nearby";
        }
        return "Picked up: " + String.join(", ", pickedUp);
    }

    public String dropItem(String itemName) {
        if (!isAlive()) return "NuncleNelson is not spawned";

        for (int i = 0; i < npc.getInventory().getContainerSize(); i++) {
            ItemStack stack = npc.getInventory().getItem(i);
            if (stack.isEmpty()) continue;

            String name = stack.getItem().getDescriptionId()
                .replace("item.minecraft.", "").replace("block.minecraft.", "");
            if (!name.toLowerCase().contains(itemName.toLowerCase())) continue;

            // Drop the whole stack
            npc.getInventory().removeItem(i, stack.getCount());
            ItemEntity dropped = new ItemEntity(
                npc.level(), npc.getX(), npc.getY(), npc.getZ(), stack);
            npc.level().addFreshEntity(dropped);
            return "Dropped " + stack.getCount() + "x " + name;
        }

        return "No " + itemName + " in inventory";
    }

    // --- Container access (boundary-aware) ---

    public String takeFromContainer(int x, int y, int z, @Nullable String itemFilter, int count) {
        if (!isAlive()) return "NuncleNelson is not spawned";

        if (!isInsideBoundary(x, z)) {
            return "Container is outside boundary";
        }

        BlockPos pos = new BlockPos(x, y, z);
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
            if (itemFilter != null && !itemFilter.isEmpty()
                && !name.toLowerCase().contains(itemFilter.toLowerCase())) continue;

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

    public String putInContainer(int x, int y, int z, String itemName, int count) {
        if (!isAlive()) return "NuncleNelson is not spawned";

        if (!isInsideBoundary(x, z)) {
            return "Container is outside boundary";
        }

        BlockPos pos = new BlockPos(x, y, z);
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
            ItemStack template = stack.copy();

            // Try to insert into container — merge first, then empty slots
            int moved = 0;
            for (int j = 0; j < container.getContainerSize() && moved < toMove; j++) {
                ItemStack cSlot = container.getItem(j);
                if (cSlot.isEmpty()) {
                    int amt = Math.min(toMove - moved, container.getMaxStackSize());
                    ItemStack newStack = template.copy();
                    newStack.setCount(amt);
                    container.setItem(j, newStack);
                    moved += amt;
                } else if (ItemStack.isSameItemSameTags(cSlot, template)) {
                    int space = cSlot.getMaxStackSize() - cSlot.getCount();
                    int amt = Math.min(toMove - moved, space);
                    if (amt > 0) {
                        cSlot.grow(amt);
                        moved += amt;
                    }
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

    // --- Thinking indicator ---

    public String setThinking(boolean value) {
        if (!isAlive()) return "NuncleNelson is not spawned";
        this.thinking = value;
        if (value) {
            npc.setCustomName(Component.literal(NuncleMod.NPC_NAME + " ")
                .append(Component.literal("...").withStyle(ChatFormatting.GRAY)));
            thinkingParticleTick = 0;
        } else {
            npc.setCustomName(Component.literal(NuncleMod.NPC_NAME));
        }
        return value ? "Thinking started" : "Thinking stopped";
    }

    // --- Tick logic ---

    public void tick() {
        if (!isAlive()) return;

        // === BOUNDARY ENFORCEMENT (hard, every tick) ===
        if (boundaryCenterX != null && !isInsideBoundary(npc.getX(), npc.getZ())) {
            double[] clamped = clampToBoundary(npc.getX(), npc.getZ());
            npc.teleportTo(clamped[0], npc.getY(), clamped[1]);
            npc.getNavigation().stop();
            followTarget = null;
            wandering = false;
            attackTarget = null;
            NuncleMod.LOGGER.info("[NUNCLE] BOUNDARY_ENFORCED teleported back to ({},{})",
                (int) clamped[0], (int) clamped[1]);
        }

        // Periodic location announcement
        locationAnnounceTick++;
        if (locationAnnounceTick >= LOCATION_ANNOUNCE_INTERVAL) {
            locationAnnounceTick = 0;
            String biome = ((ServerLevel) npc.level()).getBiome(npc.blockPosition())
                .unwrapKey().map(k -> k.location().getPath()).orElse("unknown");
            broadcastAnnouncement(NuncleMod.NPC_NAME + " is at " +
                (int) npc.getX() + " " + (int) npc.getY() + " " + (int) npc.getZ() +
                " (" + biome.replace("_", " ") + ")");
        }

        // Thinking particles
        if (thinking) {
            thinkingParticleTick++;
            if (thinkingParticleTick % 10 == 0) {
                ServerLevel level = (ServerLevel) npc.level();
                level.sendParticles(
                    ParticleTypes.HAPPY_VILLAGER,
                    npc.getX(), npc.getY() + npc.getBbHeight() + 0.5, npc.getZ(),
                    5, 0.3, 0.2, 0.3, 0.0);
            }
        }

        // Follow target (boundary-aware)
        if (followTarget != null) {
            if (!followTarget.isAlive() || followTarget.hasDisconnected()) {
                followTarget = null;
            } else if (!isInsideBoundary(followTarget.getX(), followTarget.getZ())) {
                // Target left our boundary — stop following
                followTarget = null;
                npc.getNavigation().stop();
            } else {
                double dist = npc.distanceTo(followTarget);
                if (dist > 3.0) {
                    npc.getNavigation().moveTo(followTarget, 1.0);
                } else {
                    npc.getLookControl().setLookAt(followTarget);
                }
            }
        }

        // Attack target (boundary-aware)
        if (attackTarget != null) {
            if (!attackTarget.isAlive()) {
                attackTarget = null;
            } else if (!isInsideBoundary(attackTarget.getX(), attackTarget.getZ())) {
                // Target left our boundary — disengage
                attackTarget = null;
                npc.getNavigation().stop();
            } else {
                double dist = npc.distanceTo(attackTarget);
                if (dist > 2.5) {
                    npc.getNavigation().moveTo(attackTarget, 1.2);
                } else {
                    npc.getLookControl().setLookAt(attackTarget);
                    npc.doHurtTarget(attackTarget);
                }
            }
        }

        // Wander
        if (wandering && npc.getNavigation().isDone()) {
            wanderCooldown--;
            if (wanderCooldown <= 0) {
                doWander();
                wanderCooldown = 100 + npc.getRandom().nextInt(200); // 5-15 seconds
            }
        }
    }

    private void doWander() {
        if (boundaryCenterX != null) {
            // Wander within boundary — pick random point inside the circle
            double angle = npc.getRandom().nextDouble() * Math.PI * 2;
            double dist = npc.getRandom().nextDouble() * boundaryRadius;
            double x = boundaryCenterX + Math.cos(angle) * dist;
            double z = boundaryCenterZ + Math.sin(angle) * dist;
            int y = npc.level().getHeight(
                net.minecraft.world.level.levelgen.Heightmap.Types.MOTION_BLOCKING_NO_LEAVES,
                (int) x, (int) z);
            npc.getNavigation().moveTo(x, y, z, 1.0);
        } else {
            // No boundary — wander relative to NPC position
            double angle = npc.getRandom().nextDouble() * Math.PI * 2;
            double dist = 20 + npc.getRandom().nextDouble() * 30;
            double x = npc.getX() + Math.cos(angle) * dist;
            double z = npc.getZ() + Math.sin(angle) * dist;
            int y = npc.level().getHeight(
                net.minecraft.world.level.levelgen.Heightmap.Types.MOTION_BLOCKING_NO_LEAVES,
                (int) x, (int) z);
            npc.getNavigation().moveTo(x, y, z, 1.0);
        }
    }

    // --- Announcements ---

    private void broadcastAnnouncement(String message) {
        Component msg = Component.literal("[")
            .append(Component.literal(NuncleMod.NPC_NAME).withStyle(ChatFormatting.GOLD))
            .append(Component.literal("] "))
            .append(Component.literal(message).withStyle(ChatFormatting.GRAY));
        server.getPlayerList().broadcastSystemMessage(msg, false);
    }

    // --- Event handlers ---

    public void onDamage(LivingDamageEvent event) {
        if (npc == null || event.getEntity() != npc) return;
        float amount = event.getAmount();
        String source = event.getSource().getMsgId();
        NuncleMod.LOGGER.info("[NUNCLE] DAMAGED {} {}", amount, source);
    }

    public void onDeath(LivingDeathEvent event) {
        if (npc == null || event.getEntity() != npc) return;
        String cause = event.getSource().getMsgId();
        NuncleMod.LOGGER.info("[NUNCLE] DIED cause={}", cause);
        broadcastAnnouncement(NuncleMod.NPC_NAME + " has died");
        npc = null;
        followTarget = null;
        attackTarget = null;
        wandering = false;
        thinking = false;
    }
}
