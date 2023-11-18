import { ChatInputCommandInteraction, Interaction, SlashCommandBuilder } from "discord.js";
import { Command } from "./base";
import type { Bot } from "payload/generated-types";

export class CreateBotCommand extends Command {
  setup() {
    this.data = new SlashCommandBuilder()
      .setName("create")
      .setDescription("Create a bot")
      .addStringOption((option) =>
        option
          .setName("username")
          .setDescription("The name of the bot")
          .setRequired(true)
      )
      .addStringOption((option) =>
        option.setName("prompt").setDescription("The prompt for the bot")
      )
      .addStringOption((option) =>
        option.setName("model").setDescription("The model for the bot")
      )
      .addStringOption((option) =>
        option
          .setName("type")
          .setDescription("The model type for the bot")
          .setChoices(
            { name: "Chat", value: "chat" },
            { name: "Completion", value: "completion" },
            { name: "Endpoint", value: "endpoint" }
          )
      ).toJSON();

    return this;
  }

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const username = interaction.options.getString("username");
    const prompt = interaction.options.getString("prompt");
    const model = interaction.options.getString("model");
    const modelType = interaction.options.getString("type") as Bot["modelType"];

    if (!username) {
      interaction.reply({
        content: "The username is required",
        ephemeral: true,
      });
      return;
    }

    const data: Partial<Bot> = {
        channelId: interaction.channelId,
        username,
    }

    if (prompt) {
      data.prompt = prompt;
    }

    if (model) {
      data.model = model;
    }

    if (modelType) {
      data.modelType = modelType;
    }

    const bot = await this.payload.create({
      collection: "bots",
      data: data as Bot,
    });

    interaction.reply({
      content: `Created bot ${bot.username}`,
      ephemeral: true,
    });
  }
}
