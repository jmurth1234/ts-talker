import { Message } from "discord.js";
import BaseEngine from "./base";
import { Payload } from "payload";
import { Bot } from "payload/generated-types";

abstract class TextEngine extends BaseEngine {
  constructor(payload: Payload) {
    super(payload);
  }

  protected async getTextMessages(message: Message, bot: Bot): Promise<string> {
    const messages = await this.getMessages(message, bot);

    let chatMessages = "";

    if (bot.prompt) {
      chatMessages += bot.prompt + "\n";
    }

    for (const msg of messages) {
      const timestamp = msg.createdAt.toISOString().replace('T', ' ').substring(0, 19);
      chatMessages += `[${timestamp}] <${msg.author.username}>: ${msg.cleanContent}`;

      for (const attachment of msg.attachments.toJSON()) {
        chatMessages += `\n[attachment] ${attachment.url} ${attachment.description || ''}`;
      }

      for (const embed of msg.embeds) {
        chatMessages += `\n[embed] ${embed.url || ''} ${embed.title || ''} ${embed.description || ''}`;
      }

      chatMessages += "\n";
    }

    if (bot.promptSuffix) {
      chatMessages += bot.promptSuffix;
    } else {
      const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
      chatMessages += `[${timestamp}] <${bot.username}>`;
    }

    return chatMessages;
  }
}

export default TextEngine;