import { Message } from "discord.js";
import { Bot } from "payload/generated-types";

export default async function didPing(message: Message, bot: Bot) {
  if (message.cleanContent.includes(`@${bot.username}`)) {
    return true;
  }

  if (message.mentions.users.some((u) => u.username === bot.username)) {
    return true;
  }

  if (message.reference) {
    const referencedMessage = await message.channel.messages.fetch(
      message.reference.messageId
    );

    if (referencedMessage) {
      return referencedMessage.author.username === bot.username;
    }
  }

  if (
    message.mentions.users.some((u) => u.id === message.client.user.id) &&
    bot.default
  ) {
    return true;
  }

  return false;
}
