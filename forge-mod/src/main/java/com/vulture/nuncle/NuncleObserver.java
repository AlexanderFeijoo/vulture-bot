package com.vulture.nuncle;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.item.ItemEntity;
import net.minecraft.world.entity.npc.Villager;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.levelgen.Heightmap;
import net.minecraft.world.phys.AABB;

import java.util.*;

public class NuncleObserver {

    private static final int ENTITY_SCAN_RADIUS = 32;
    private static final int BLOCK_SCAN_RADIUS = 8;
    private static final int ITEM_SCAN_RADIUS = 8;

    private static final Set<String> HOSTILE_MOBS = Set.of(
        "zombie", "skeleton", "creeper", "spider", "cave_spider",
        "enderman", "witch", "slime", "phantom", "drowned",
        "husk", "stray", "blaze", "ghast", "magma_cube",
        "wither_skeleton", "pillager", "vindicator", "ravager",
        "evoker", "vex", "guardian", "elder_guardian", "warden"
    );

    private static final Set<String> NOTABLE_BLOCKS = Set.of(
        "diamond_ore", "deepslate_diamond_ore",
        "iron_ore", "deepslate_iron_ore",
        "gold_ore", "deepslate_gold_ore",
        "emerald_ore", "deepslate_emerald_ore",
        "coal_ore", "deepslate_coal_ore",
        "copper_ore", "deepslate_copper_ore",
        "crafting_table", "furnace", "blast_furnace", "smoker",
        "anvil", "enchanting_table", "brewing_stand",
        "chest", "barrel", "ender_chest"
    );

    public static String getStatus(NunclePlayer mgr) {
        Villager npc = mgr.getNpc();
        if (npc == null || !npc.isAlive()) {
            return "{\"alive\":false}";
        }

        JsonObject json = new JsonObject();
        json.addProperty("alive", true);

        JsonObject pos = new JsonObject();
        pos.addProperty("x", (int) npc.getX());
        pos.addProperty("y", (int) npc.getY());
        pos.addProperty("z", (int) npc.getZ());
        json.add("position", pos);

        json.addProperty("health", Math.round(npc.getHealth() * 10.0) / 10.0);
        json.addProperty("maxHealth", Math.round(npc.getMaxHealth() * 10.0) / 10.0);
        json.addProperty("dimension", npc.level().dimension().location().getPath());

        return json.toString();
    }

    public static String observe(NunclePlayer mgr) {
        Villager npc = mgr.getNpc();
        if (npc == null || !npc.isAlive()) {
            return "{\"alive\":false}";
        }

        JsonObject json = new JsonObject();

        // Self
        JsonObject self = new JsonObject();
        JsonObject pos = new JsonObject();
        pos.addProperty("x", (int) npc.getX());
        pos.addProperty("y", (int) npc.getY());
        pos.addProperty("z", (int) npc.getZ());
        self.add("position", pos);
        self.addProperty("health", Math.round(npc.getHealth() * 10.0) / 10.0);
        self.addProperty("maxHealth", Math.round(npc.getMaxHealth() * 10.0) / 10.0);
        json.add("self", self);

        // Inventory
        JsonArray invItems = new JsonArray();
        for (int i = 0; i < npc.getInventory().getContainerSize(); i++) {
            ItemStack stack = npc.getInventory().getItem(i);
            if (!stack.isEmpty()) {
                JsonObject item = new JsonObject();
                item.addProperty("name", stack.getItem().getDescriptionId()
                    .replace("item.minecraft.", "").replace("block.minecraft.", ""));
                item.addProperty("count", stack.getCount());
                invItems.add(item);
            }
        }
        json.add("inventory", invItems);

        // Time & weather
        ServerLevel level = (ServerLevel) npc.level();
        long timeOfDay = level.getDayTime() % 24000;
        String timeStr;
        if (timeOfDay < 6000) timeStr = "Morning";
        else if (timeOfDay < 12000) timeStr = "Day";
        else if (timeOfDay < 13000) timeStr = "Sunset";
        else if (timeOfDay < 23000) timeStr = "Night";
        else timeStr = "Dawn";
        json.addProperty("time", timeStr);
        json.addProperty("weather", level.isRaining() ? "Raining" : "Clear");

        // Biome
        BlockPos bpos = npc.blockPosition();
        String biome = level.getBiome(bpos).unwrapKey()
            .map(k -> k.location().getPath()).orElse("unknown");
        json.addProperty("biome", biome);

        // Nearby players
        JsonArray players = new JsonArray();
        for (ServerPlayer sp : level.getServer().getPlayerList().getPlayers()) {
            if (sp.level() != npc.level()) continue;
            double dist = npc.distanceTo(sp);
            if (dist <= ENTITY_SCAN_RADIUS) {
                JsonObject pj = new JsonObject();
                pj.addProperty("name", sp.getGameProfile().getName());
                pj.addProperty("distance", (int) dist);
                players.add(pj);
            }
        }
        json.add("nearbyPlayers", players);

        // Nearby entities
        AABB area = npc.getBoundingBox().inflate(ENTITY_SCAN_RADIUS);
        List<Entity> entities = npc.level().getEntities(npc, area);
        JsonArray entArr = new JsonArray();
        int entityCount = 0;
        for (Entity e : entities) {
            if (e instanceof ServerPlayer) continue; // already in players
            if (!(e instanceof LivingEntity)) continue;
            String name = EntityType.getKey(e.getType()).getPath();
            if (name.equals("villager") && e.getCustomName() != null
                && e.getCustomName().getString().equals(NuncleMod.NPC_NAME)) continue; // skip self

            double dist = npc.distanceTo(e);
            JsonObject ej = new JsonObject();
            ej.addProperty("name", name);
            ej.addProperty("distance", (int) dist);
            ej.addProperty("hostile", HOSTILE_MOBS.contains(name));
            entArr.add(ej);
            if (++entityCount >= 15) break;
        }
        json.add("nearbyEntities", entArr);

        // Nearby ground items
        AABB itemArea = npc.getBoundingBox().inflate(ITEM_SCAN_RADIUS);
        List<Entity> itemEntities = npc.level().getEntities(npc, itemArea);
        JsonArray groundItems = new JsonArray();
        int itemCount = 0;
        for (Entity e : itemEntities) {
            if (!(e instanceof ItemEntity itemEntity)) continue;
            if (!itemEntity.isAlive()) continue;

            ItemStack stack = itemEntity.getItem();
            String itemName = stack.getItem().getDescriptionId()
                .replace("item.minecraft.", "").replace("block.minecraft.", "");
            double dist = npc.distanceTo(e);

            JsonObject ij = new JsonObject();
            ij.addProperty("name", itemName);
            ij.addProperty("count", stack.getCount());
            ij.addProperty("distance", (int) dist);
            groundItems.add(ij);
            if (++itemCount >= 10) break;
        }
        json.add("groundItems", groundItems);

        // Notable blocks
        JsonArray blocks = new JsonArray();
        int blockCount = 0;
        for (int dx = -BLOCK_SCAN_RADIUS; dx <= BLOCK_SCAN_RADIUS && blockCount < 15; dx++) {
            for (int dy = -BLOCK_SCAN_RADIUS; dy <= BLOCK_SCAN_RADIUS && blockCount < 15; dy++) {
                for (int dz = -BLOCK_SCAN_RADIUS; dz <= BLOCK_SCAN_RADIUS && blockCount < 15; dz++) {
                    BlockPos bp = bpos.offset(dx, dy, dz);
                    BlockState state = level.getBlockState(bp);
                    String blockName = state.getBlock().getDescriptionId()
                        .replace("block.minecraft.", "");
                    if (NOTABLE_BLOCKS.contains(blockName)) {
                        JsonObject bj = new JsonObject();
                        bj.addProperty("name", blockName);
                        bj.addProperty("x", bp.getX());
                        bj.addProperty("y", bp.getY());
                        bj.addProperty("z", bp.getZ());
                        bj.addProperty("distance", (int) Math.sqrt(dx*dx + dy*dy + dz*dz));
                        blocks.add(bj);
                        blockCount++;
                    }
                }
            }
        }
        json.add("notableBlocks", blocks);

        // Boundary info
        String boundaryInfo = mgr.getBoundaryInfo();
        if (!boundaryInfo.equals("No boundary set")) {
            json.addProperty("boundary", boundaryInfo);
        }

        return json.toString();
    }

    public static String observeInventory(NunclePlayer mgr) {
        Villager npc = mgr.getNpc();
        if (npc == null || !npc.isAlive()) {
            return "{\"alive\":false}";
        }

        // Villagers have a small inventory (8 slots)
        JsonObject json = new JsonObject();
        JsonArray items = new JsonArray();

        for (int i = 0; i < npc.getInventory().getContainerSize(); i++) {
            ItemStack stack = npc.getInventory().getItem(i);
            if (!stack.isEmpty()) {
                JsonObject item = new JsonObject();
                item.addProperty("name", stack.getItem().getDescriptionId()
                    .replace("item.minecraft.", "").replace("block.minecraft.", ""));
                item.addProperty("count", stack.getCount());
                item.addProperty("slot", i);
                items.add(item);
            }
        }

        json.add("inventory", items);
        json.addProperty("slots", npc.getInventory().getContainerSize());
        return json.toString();
    }
}
