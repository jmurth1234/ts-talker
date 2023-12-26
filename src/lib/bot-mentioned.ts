import { Message } from "discord.js";
import { Bot } from "payload/generated-types";

export default async function didPing(
  message: Message,
  bot: Bot
): Promise<boolean> {
  const lowerCaseBotUsername = bot.username.toLowerCase();

  if (message.cleanContent.toLowerCase().includes(`@${lowerCaseBotUsername}`)) {
    return true;
  }

  if (
    message.mentions.users.some(
      (u) => u.username.toLowerCase() === lowerCaseBotUsername
    )
  ) {
    return true;
  }

  if (message.reference) {
    const referencedMessage = await message.channel.messages.fetch(
      message.reference.messageId
    );

    if (referencedMessage) {
      return (
        referencedMessage.author.username.toLowerCase() === lowerCaseBotUsername
      );
    }
  }

  // Check if the bot is mentioned by ID and is the default bot
  if (
    message.mentions.users.some((u) => u.id === message.client.user?.id) &&
    bot.default
  ) {
    return true;
  }

  return false;
}
