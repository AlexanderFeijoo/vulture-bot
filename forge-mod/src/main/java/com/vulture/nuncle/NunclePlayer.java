package com.vulture.nuncle;

import net.minecraft.ChatFormatting;
import net.minecraft.core.BlockPos;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.damagesource.DamageSource;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.Mob;
import net.minecraft.world.entity.ai.goal.Goal;
import net.minecraft.world.entity.item.ItemEntity;
import net.minecraft.world.entity.npc.Villager;
import net.minecraft.world.entity.npc.VillagerType;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.Vec3;
import net.minecraftforge.event.entity.living.LivingDamageEvent;
import net.minecraftforge.event.entity.living.LivingDeathEvent;

import javax.annotation.Nullable;
import java.util.ArrayList;
import java.util.EnumSet;
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

    public String goTo(double x, double y, double z) {
        if (!isAlive()) return "NuncleNelson is not spawned";
        followTarget = null;
        wandering = false;
        attackTarget = null;

        boolean started = npc.getNavigation().moveTo(x, y, z, 1.0);
        if (started) {
            return "Moving to " + (int) x + " " + (int) y + " " + (int) z;
        }
        return "Cannot pathfind to " + (int) x + " " + (int) y + " " + (int) z;
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

    public String mine(int x, int y, int z) {
        if (!isAlive()) return "NuncleNelson is not spawned";

        ServerLevel level = (ServerLevel) npc.level();
        BlockPos pos = new BlockPos(x, y, z);
        BlockState state = level.getBlockState(pos);

        if (state.isAir()) {
            return "No block at " + x + " " + y + " " + z;
        }

        double dist = npc.position().distanceTo(Vec3.atCenterOf(pos));
        if (dist > 6.0) {
            // Walk closer first
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

    // --- Item pickup/drop ---

    public String pickup(@Nullable String itemFilter) {
        if (!isAlive()) return "NuncleNelson is not spawned";

        AABB area = npc.getBoundingBox().inflate(4.0);
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
                    ParticleTypes.ENCHANT,
                    npc.getX(), npc.getY() + npc.getBbHeight() + 0.5, npc.getZ(),
                    3, 0.2, 0.3, 0.2, 0.05);
            }
        }

        // Follow target
        if (followTarget != null) {
            if (!followTarget.isAlive() || followTarget.hasDisconnected()) {
                followTarget = null;
            } else {
                double dist = npc.distanceTo(followTarget);
                if (dist > 3.0) {
                    npc.getNavigation().moveTo(followTarget, 1.0);
                } else {
                    npc.getLookControl().setLookAt(followTarget);
                }
            }
        }

        // Attack target
        if (attackTarget != null) {
            if (!attackTarget.isAlive()) {
                attackTarget = null;
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
        double angle = npc.getRandom().nextDouble() * Math.PI * 2;
        double dist = 20 + npc.getRandom().nextDouble() * 30;
        double x = npc.getX() + Math.cos(angle) * dist;
        double z = npc.getZ() + Math.sin(angle) * dist;
        int y = npc.level().getHeight(
            net.minecraft.world.level.levelgen.Heightmap.Types.MOTION_BLOCKING_NO_LEAVES,
            (int) x, (int) z);
        npc.getNavigation().moveTo(x, y, z, 1.0);
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
