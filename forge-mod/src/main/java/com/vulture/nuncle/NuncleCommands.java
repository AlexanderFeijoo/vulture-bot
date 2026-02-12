package com.vulture.nuncle;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.DoubleArgumentType;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.context.CommandContext;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;

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

            // /nuncle pickup [itemFilter]
            .then(Commands.literal("pickup")
                .executes(NuncleCommands::pickupAll)
                .then(Commands.argument("itemFilter", StringArgumentType.greedyString())
                    .executes(NuncleCommands::pickupFiltered)))

            // /nuncle drop <itemName>
            .then(Commands.literal("drop")
                .then(Commands.argument("itemName", StringArgumentType.greedyString())
                    .executes(NuncleCommands::dropItem)))

            // /nuncle thinking start|stop
            .then(Commands.literal("thinking")
                .then(Commands.literal("start")
                    .executes(NuncleCommands::thinkingStart))
                .then(Commands.literal("stop")
                    .executes(NuncleCommands::thinkingStop)))
        );
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

    private static int thinkingStart(CommandContext<CommandSourceStack> ctx) {
        return reply(ctx, mgr().setThinking(true));
    }

    private static int thinkingStop(CommandContext<CommandSourceStack> ctx) {
        return reply(ctx, mgr().setThinking(false));
    }
}
