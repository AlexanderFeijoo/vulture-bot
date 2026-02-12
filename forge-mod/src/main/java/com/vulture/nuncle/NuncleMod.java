package com.vulture.nuncle;

import net.minecraftforge.common.MinecraftForge;
import net.minecraftforge.event.RegisterCommandsEvent;
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

    public static NunclePlayer getNpcManager() {
        return npcManager;
    }
}
