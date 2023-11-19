import { ChatInputCommandInteraction, Interaction, SlashCommandBuilder } from "discord.js";
import { Command } from "./base";

export class ListCommand extends Command {
  setup() {
    this.data = new SlashCommandBuilder()
      .setName("list")
      .setDescription("List all bots in this channel")
      .toJSON();

    return this;
  }

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const bots = await this.payload.find({
      collection: "bots",
      where: { channelId: { equals: interaction.channelId } },
    });

    if (bots.totalDocs === 0) {
      interaction.reply({
        content: "There are no bots in this channel.",
        ephemeral: true,
      });
      return;
    }

    const botList = bots.docs.map((bot) => {
      return {
        name: `${bot.username} (${bot.modelType})`,
        value: bot.prompt.length > 50 ? `${bot.prompt.slice(0, 50)}...` : bot.prompt,
      };
    });

    interaction.reply({
      embeds: [
        {
          title: "Bots",
          description: "Here are all the bots in this channel.",
          fields: botList,
        },
      ],
      ephemeral: true,
    });
  }
}
