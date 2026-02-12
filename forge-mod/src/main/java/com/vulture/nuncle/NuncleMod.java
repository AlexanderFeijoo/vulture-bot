package com.vulture.nuncle;

import net.minecraft.ChatFormatting;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.npc.Villager;
import net.minecraftforge.common.MinecraftForge;
import net.minecraftforge.event.RegisterCommandsEvent;
import net.minecraftforge.event.ServerChatEvent;
import net.minecraftforge.event.TickEvent;
import net.minecraftforge.event.entity.living.LivingDamageEvent;
import net.minecraftforge.event.entity.living.LivingDeathEvent;
import net.minecraftforge.event.server.ServerStartingEvent;
import net.minecraftforge.event.server.ServerStoppingEvent;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import net.minecraftforge.fml.common.Mod;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

@Mod(NuncleMod.MODID)
public class NuncleMod {
    public static final String MODID = "nuncle_nelson";
    public static final String NPC_NAME = "NuncleNelson";
    public static final Logger LOGGER = LogManager.getLogger();

    /** How close a player must be for Nuncle to "hear" them */
    public static final double HEARING_RADIUS = 32.0;

    private static NunclePlayer npcManager;

    public NuncleMod() {
        MinecraftForge.EVENT_BUS.register(this);
    }

    @SubscribeEvent
    public void onRegisterCommands(RegisterCommandsEvent event) {
        NuncleCommands.register(event.getDispatcher());
        LOGGER.info("NuncleNelson commands registered");
    }

    @SubscribeEvent
    public void onServerStarting(ServerStartingEvent event) {
        npcManager = new NunclePlayer(event.getServer());
        LOGGER.info("NuncleNelson mod initialized");
    }

    @SubscribeEvent
    public void onServerStopping(ServerStoppingEvent event) {
        if (npcManager != null) {
            npcManager.despawn();
            npcManager = null;
        }
    }

    @SubscribeEvent
    public void onServerTick(TickEvent.ServerTickEvent event) {
        if (event.phase == TickEvent.Phase.END && npcManager != null) {
            npcManager.tick();
        }
    }

    @SubscribeEvent
    public void onEntityDamage(LivingDamageEvent event) {
        if (npcManager != null) {
            npcManager.onDamage(event);
        }
    }

    @SubscribeEvent
    public void onEntityDeath(LivingDeathEvent event) {
        if (npcManager != null) {
            npcManager.onDeath(event);
        }
    }

    @SubscribeEvent
    public void onServerChat(ServerChatEvent event) {
        if (npcManager == null || !npcManager.isAlive()) return;

        ServerPlayer player = event.getPlayer();
        String message = event.getMessage().getString();
        String playerName = player.getGameProfile().getName();
        Villager npc = npcManager.getNpc();
        if (npc == null) return;

        // !nuncle — report location from anywhere (does NOT move Nuncle)
        if (message.toLowerCase().startsWith("!nuncle")) {
            int x = (int) npc.getX();
            int y = (int) npc.getY();
            int z = (int) npc.getZ();
            String biome = ((ServerLevel) npc.level()).getBiome(npc.blockPosition())
                .unwrapKey().map(k -> k.location().getPath().replace("_", " ")).orElse("unknown");
            String boundaryInfo = npcManager.getBoundaryInfo();
            LOGGER.info("[NUNCLE] SUMMONED {} at {} {} {} ({}) boundary={}", playerName, x, y, z, biome, boundaryInfo);

            // Auto-reply in chat with location
            npcManager.chat("I'm at " + x + " " + y + " " + z + " (" + biome + ")");
            return;
        }

        // Proximity check — only log HEARD if player is within hearing range
        if (player.level() == npc.level()) {
            double dist = npc.distanceTo(player);
            if (dist <= HEARING_RADIUS) {
                LOGGER.info("[NUNCLE] HEARD {} {}", playerName, message);
            }
        }
    }

    public static NunclePlayer getNpcManager() {
        return npcManager;
    }
}
