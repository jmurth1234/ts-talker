import { Payload } from "payload";
import { CreateBotCommand } from "./create-bot";
import { Client, Collection, Events, REST, Routes } from "discord.js";
import { Command } from "./base";
import { LoginCommand } from "./login";
import { ListCommand } from "./list";

const clientId = process.env.DISCORD_CLIENT_ID;

export async function setupCommands(
  client: Client,
  rest: REST,
  payload: Payload
) {
  const registeredCommands = [
    new CreateBotCommand(payload).setup(),
    new LoginCommand(payload).setup(),
    new ListCommand(payload).setup(),
  ];

  console.log(`Registering ${registeredCommands.length} commands.`);

  const commands = new Collection();
  for (const command of registeredCommands) {
    commands.set(command.data.name, command);
  }

  // Register commands
  const response = await rest.put(Routes.applicationCommands(clientId), {
    body: registeredCommands.map((command) => command.data),
  });

  console.log("Successfully registered application commands.", response);

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const command = commands.get(interaction.commandName) as Command;

    if (!command) {
      console.error(
        `No command matching ${interaction.commandName} was found.`
      );
      return;
    }

    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(error);
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({
          content: "There was an error while executing this command!",
          ephemeral: true,
        });
      } else {
        await interaction.reply({
          content: "There was an error while executing this command!",
          ephemeral: true,
        });
      }
    }
  });
}
