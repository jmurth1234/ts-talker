import { ChatInputCommandInteraction, Interaction, SlashCommandBuilder } from "discord.js";
import { Command } from "./base";
import type { User } from "payload/generated-types";
import { faker } from '@faker-js/faker';

export class LoginCommand extends Command {
  setup() {
    this.data = new SlashCommandBuilder()
      .setName("login")
      .setDescription("Generate a username and password to login to the bot")
      .toJSON();

    return this;
  }

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    // find a user with the same discord id
    // if there is one, generate a new password
    // if there isn't one, create a new user with a new password
    const password = faker.internet.password({ memorable: true, length: 12 });

    const user = interaction.user;

    const userSearch = await this.payload.find({
      collection: "users",
      where: { discordId: { equals: user.id } },
    });

    let doc: User;

    if (userSearch.docs.length > 0) {
      doc = await this.payload.update({
        collection: "users",
        id: userSearch.docs[0].id,
        data: {
          password,
          discordUsername: user.username,
          currentChannelId: interaction.channelId,
        },
      });
    } else {
      doc = await this.payload.create({
        collection: "users",
        data: {
          discordId: user.id,
          discordUsername: user.username,
          password,
          email: `${user.username}@${user.id}.discord`,
          currentChannelId: interaction.channelId,
        },
      });
    }

    interaction.reply({
      content: `Your username is \`${doc.email}\` and your password is \`${password}\`. You can login at ${this.payload.getAdminURL()}}`,
      ephemeral: true,
    });
  }
}
