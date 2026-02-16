package com.vulture.nuncle;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.DoubleArgumentType;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.context.CommandContext;
import net.minecraft.ChatFormatting;
import net.minecraft.network.chat.ClickEvent;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.HoverEvent;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.npc.Villager;

public class NuncleCommands {

    public static void register(CommandDispatcher<CommandSourceStack> dispatcher) {
        dispatcher.register(Commands.literal("nuncle")
            .requires(source -> source.hasPermission(2))

            // /nuncle spawn [x y z]
            .then(Commands.literal("spawn")
                .executes(NuncleCommands::spawnDefault)
                .then(Commands.argument("x", DoubleArgumentType.doubleArg())
                    .then(Commands.argument("y", DoubleArgumentType.doubleArg())
                        .then(Commands.argument("z", DoubleArgumentType.doubleArg())
                            .executes(NuncleCommands::spawnAt)))))

            // /nuncle despawn
            .then(Commands.literal("despawn")
                .executes(NuncleCommands::despawn))

            // /nuncle status
            .then(Commands.literal("status")
                .executes(NuncleCommands::status))

            // /nuncle observe [inventory]
            .then(Commands.literal("observe")
                .executes(NuncleCommands::observe)
                .then(Commands.literal("inventory")
                    .executes(NuncleCommands::observeInventory)))

            // /nuncle chat <message>
            .then(Commands.literal("chat")
                .then(Commands.argument("message", StringArgumentType.greedyString())
                    .executes(NuncleCommands::chat)))

            // /nuncle goto <x> <y> <z>
            .then(Commands.literal("goto")
                .then(Commands.argument("x", DoubleArgumentType.doubleArg())
                    .then(Commands.argument("y", DoubleArgumentType.doubleArg())
                        .then(Commands.argument("z", DoubleArgumentType.doubleArg())
                            .executes(NuncleCommands::goTo)))))

            // /nuncle follow <player>
            .then(Commands.literal("follow")
                .then(Commands.argument("player", StringArgumentType.word())
                    .executes(NuncleCommands::follow)))

            // /nuncle wander
            .then(Commands.literal("wander")
                .executes(NuncleCommands::wander))

            // /nuncle stay
            .then(Commands.literal("stay")
                .executes(NuncleCommands::stay))

            // /nuncle look <x> <y> <z>
            .then(Commands.literal("look")
                .then(Commands.argument("x", DoubleArgumentType.doubleArg())
                    .then(Commands.argument("y", DoubleArgumentType.doubleArg())
                        .then(Commands.argument("z", DoubleArgumentType.doubleArg())
                            .executes(NuncleCommands::lookAt)))))

            // /nuncle attack <entityType>
            .then(Commands.literal("attack")
                .then(Commands.argument("entityType", StringArgumentType.word())
                    .executes(NuncleCommands::attack)))

            // /nuncle mine <x> <y> <z>
            .then(Commands.literal("mine")
                .then(Commands.argument("x", IntegerArgumentType.integer())
                    .then(Commands.argument("y", IntegerArgumentType.integer())
                        .then(Commands.argument("z", IntegerArgumentType.integer())
                            .executes(NuncleCommands::mine)))))

            // /nuncle place <x> <y> <z> <blockName>
            .then(Commands.literal("place")
                .then(Commands.argument("x", IntegerArgumentType.integer())
                    .then(Commands.argument("y", IntegerArgumentType.integer())
                        .then(Commands.argument("z", IntegerArgumentType.integer())
                            .then(Commands.argument("blockName", StringArgumentType.word())
                                .executes(NuncleCommands::placeBlock))))))

            // /nuncle pickup [itemFilter]
            .then(Commands.literal("pickup")
                .executes(NuncleCommands::pickupAll)
                .then(Commands.argument("itemFilter", StringArgumentType.greedyString())
                    .executes(NuncleCommands::pickupFiltered)))

            // /nuncle drop <itemName>
            .then(Commands.literal("drop")
                .then(Commands.argument("itemName", StringArgumentType.greedyString())
                    .executes(NuncleCommands::dropItem)))

            // /nuncle take <x> <y> <z> [itemFilter] [count]
            .then(Commands.literal("take")
                .then(Commands.argument("x", IntegerArgumentType.integer())
                    .then(Commands.argument("y", IntegerArgumentType.integer())
                        .then(Commands.argument("z", IntegerArgumentType.integer())
                            .executes(NuncleCommands::takeAll)
                            .then(Commands.argument("itemFilter", StringArgumentType.word())
                                .executes(NuncleCommands::takeFiltered)
                                .then(Commands.argument("count", IntegerArgumentType.integer(1))
                                    .executes(NuncleCommands::takeFilteredCount)))))))

            // /nuncle put <x> <y> <z> <itemName> [count]
            .then(Commands.literal("put")
                .then(Commands.argument("x", IntegerArgumentType.integer())
                    .then(Commands.argument("y", IntegerArgumentType.integer())
                        .then(Commands.argument("z", IntegerArgumentType.integer())
                            .then(Commands.argument("itemName", StringArgumentType.word())
                                .executes(NuncleCommands::putDefault)
                                .then(Commands.argument("count", IntegerArgumentType.integer(1))
                                    .executes(NuncleCommands::putWithCount)))))))

            // /nuncle boundary set|clear|info
            .then(Commands.literal("boundary")
                .then(Commands.literal("set")
                    .then(Commands.argument("x", DoubleArgumentType.doubleArg())
                        .then(Commands.argument("z", DoubleArgumentType.doubleArg())
                            .then(Commands.argument("radius", DoubleArgumentType.doubleArg(1))
                                .executes(NuncleCommands::boundarySet)))))
                .then(Commands.literal("clear")
                    .executes(NuncleCommands::boundaryClear))
                .then(Commands.literal("info")
                    .executes(NuncleCommands::boundaryInfo)))

            // /nuncle thinking start|stop
            .then(Commands.literal("thinking")
                .then(Commands.literal("start")
                    .executes(NuncleCommands::thinkingStart))
                .then(Commands.literal("stop")
                    .executes(NuncleCommands::thinkingStop)))

            // /nuncle craft <itemName>
            .then(Commands.literal("craft")
                .then(Commands.argument("itemName", StringArgumentType.greedyString())
                    .executes(NuncleCommands::craft)))

            // /nuncle brain on|off
            .then(Commands.literal("brain")
                .then(Commands.literal("on")
                    .executes(NuncleCommands::brainOn))
                .then(Commands.literal("off")
                    .executes(NuncleCommands::brainOff)))
        );

        // /nunclewhere — separate command, no permission required
        dispatcher.register(Commands.literal("nunclewhere")
            .executes(NuncleCommands::nuncleWhere));
    }

    private static int reply(CommandContext<CommandSourceStack> ctx, String msg) {
        ctx.getSource().sendSuccess(() -> Component.literal(msg), false);
        return 1;
    }

    private static NunclePlayer mgr() {
        return NuncleMod.getNpcManager();
    }

    private static int spawnDefault(CommandContext<CommandSourceStack> ctx) {
        return reply(ctx, mgr().spawnAtWorldSpawn());
    }

    private static int spawnAt(CommandContext<CommandSourceStack> ctx) {
        double x = DoubleArgumentType.getDouble(ctx, "x");
        double y = DoubleArgumentType.getDouble(ctx, "y");
        double z = DoubleArgumentType.getDouble(ctx, "z");
        return reply(ctx, mgr().spawn(x, y, z));
    }

    private static int despawn(CommandContext<CommandSourceStack> ctx) {
        return reply(ctx, mgr().despawn());
    }

    private static int status(CommandContext<CommandSourceStack> ctx) {
        return reply(ctx, NuncleObserver.getStatus(mgr()));
    }

    private static int observe(CommandContext<CommandSourceStack> ctx) {
        return reply(ctx, NuncleObserver.observe(mgr()));
    }

    private static int observeInventory(CommandContext<CommandSourceStack> ctx) {
        return reply(ctx, NuncleObserver.observeInventory(mgr()));
    }

    private static int chat(CommandContext<CommandSourceStack> ctx) {
        String message = StringArgumentType.getString(ctx, "message");
        return reply(ctx, mgr().chat(message));
    }

    private static int goTo(CommandContext<CommandSourceStack> ctx) {
        double x = DoubleArgumentType.getDouble(ctx, "x");
        double y = DoubleArgumentType.getDouble(ctx, "y");
        double z = DoubleArgumentType.getDouble(ctx, "z");
        return reply(ctx, mgr().goTo(x, y, z));
    }

    private static int follow(CommandContext<CommandSourceStack> ctx) {
        String player = StringArgumentType.getString(ctx, "player");
        return reply(ctx, mgr().follow(player));
    }

    private static int wander(CommandContext<CommandSourceStack> ctx) {
        return reply(ctx, mgr().wander());
    }

    private static int stay(CommandContext<CommandSourceStack> ctx) {
        return reply(ctx, mgr().stay());
    }

    private static int lookAt(CommandContext<CommandSourceStack> ctx) {
        double x = DoubleArgumentType.getDouble(ctx, "x");
        double y = DoubleArgumentType.getDouble(ctx, "y");
        double z = DoubleArgumentType.getDouble(ctx, "z");
        return reply(ctx, mgr().lookAt(x, y, z));
    }

    private static int attack(CommandContext<CommandSourceStack> ctx) {
        String entityType = StringArgumentType.getString(ctx, "entityType");
        return reply(ctx, mgr().attack(entityType));
    }

    private static int mine(CommandContext<CommandSourceStack> ctx) {
        int x = IntegerArgumentType.getInteger(ctx, "x");
        int y = IntegerArgumentType.getInteger(ctx, "y");
        int z = IntegerArgumentType.getInteger(ctx, "z");
        return reply(ctx, mgr().mine(x, y, z));
    }

    private static int placeBlock(CommandContext<CommandSourceStack> ctx) {
        int x = IntegerArgumentType.getInteger(ctx, "x");
        int y = IntegerArgumentType.getInteger(ctx, "y");
        int z = IntegerArgumentType.getInteger(ctx, "z");
        String blockName = StringArgumentType.getString(ctx, "blockName");
        return reply(ctx, mgr().placeBlock(x, y, z, blockName));
    }

    private static int pickupAll(CommandContext<CommandSourceStack> ctx) {
        return reply(ctx, mgr().pickup(null));
    }

    private static int pickupFiltered(CommandContext<CommandSourceStack> ctx) {
        String filter = StringArgumentType.getString(ctx, "itemFilter");
        return reply(ctx, mgr().pickup(filter));
    }

    private static int dropItem(CommandContext<CommandSourceStack> ctx) {
        String itemName = StringArgumentType.getString(ctx, "itemName");
        return reply(ctx, mgr().dropItem(itemName));
    }

    private static int takeAll(CommandContext<CommandSourceStack> ctx) {
        int x = IntegerArgumentType.getInteger(ctx, "x");
        int y = IntegerArgumentType.getInteger(ctx, "y");
        int z = IntegerArgumentType.getInteger(ctx, "z");
        return reply(ctx, mgr().takeFromContainer(x, y, z, null, 64));
    }

    private static int takeFiltered(CommandContext<CommandSourceStack> ctx) {
        int x = IntegerArgumentType.getInteger(ctx, "x");
        int y = IntegerArgumentType.getInteger(ctx, "y");
        int z = IntegerArgumentType.getInteger(ctx, "z");
        String filter = StringArgumentType.getString(ctx, "itemFilter");
        return reply(ctx, mgr().takeFromContainer(x, y, z, filter, 64));
    }

    private static int takeFilteredCount(CommandContext<CommandSourceStack> ctx) {
        int x = IntegerArgumentType.getInteger(ctx, "x");
        int y = IntegerArgumentType.getInteger(ctx, "y");
        int z = IntegerArgumentType.getInteger(ctx, "z");
        String filter = StringArgumentType.getString(ctx, "itemFilter");
        int count = IntegerArgumentType.getInteger(ctx, "count");
        return reply(ctx, mgr().takeFromContainer(x, y, z, filter, count));
    }

    private static int putDefault(CommandContext<CommandSourceStack> ctx) {
        int x = IntegerArgumentType.getInteger(ctx, "x");
        int y = IntegerArgumentType.getInteger(ctx, "y");
        int z = IntegerArgumentType.getInteger(ctx, "z");
        String itemName = StringArgumentType.getString(ctx, "itemName");
        return reply(ctx, mgr().putInContainer(x, y, z, itemName, 64));
    }

    private static int putWithCount(CommandContext<CommandSourceStack> ctx) {
        int x = IntegerArgumentType.getInteger(ctx, "x");
        int y = IntegerArgumentType.getInteger(ctx, "y");
        int z = IntegerArgumentType.getInteger(ctx, "z");
        String itemName = StringArgumentType.getString(ctx, "itemName");
        int count = IntegerArgumentType.getInteger(ctx, "count");
        return reply(ctx, mgr().putInContainer(x, y, z, itemName, count));
    }

    private static int boundarySet(CommandContext<CommandSourceStack> ctx) {
        double x = DoubleArgumentType.getDouble(ctx, "x");
        double z = DoubleArgumentType.getDouble(ctx, "z");
        double radius = DoubleArgumentType.getDouble(ctx, "radius");
        return reply(ctx, mgr().setBoundary(x, z, radius));
    }

    private static int boundaryClear(CommandContext<CommandSourceStack> ctx) {
        return reply(ctx, mgr().clearBoundary());
    }

    private static int boundaryInfo(CommandContext<CommandSourceStack> ctx) {
        return reply(ctx, mgr().getBoundaryInfo());
    }

    private static int thinkingStart(CommandContext<CommandSourceStack> ctx) {
        return reply(ctx, mgr().setThinking(true));
    }

    private static int thinkingStop(CommandContext<CommandSourceStack> ctx) {
        return reply(ctx, mgr().setThinking(false));
    }

    private static int craft(CommandContext<CommandSourceStack> ctx) {
        String itemName = StringArgumentType.getString(ctx, "itemName");
        return reply(ctx, mgr().craft(itemName));
    }

    private static int brainOn(CommandContext<CommandSourceStack> ctx) {
        NuncleMod.LOGGER.info("[NUNCLE] BRAIN_ON");
        return reply(ctx, "Brain toggle: ON — NuncleNelson will spawn and start thinking");
    }

    private static int brainOff(CommandContext<CommandSourceStack> ctx) {
        NuncleMod.LOGGER.info("[NUNCLE] BRAIN_OFF");
        return reply(ctx, "Brain toggle: OFF — NuncleNelson will despawn and stop thinking");
    }

    // /nunclewhere — any player, no permission required
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
}
