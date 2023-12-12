import { Message } from "discord.js";
import TextEngine from "./text";
import { Payload } from "payload";
import { Bot, Function } from "payload/generated-types";
import convertFunction from "../lib/function-converter";
import Mistral from "../lib/mistral";
import * as MistralTypes from "../lib/mistral";
import memoize from "promise-memoize";
import { describeEmbed, describeImage } from "./openai-chat";

const basePrompt = `You are a discord bot designed to perform different prompts. The following will contain:
- the prompt -- you should follow this as much as possible
- at least one message from the channel, in the format [timestamp] <username>: message
- If a message has embeds or attachments, they will be included in the prompt as well under the message as [embed] or [attachment]
Please write a suitable reply, only replying with the message

The prompt is as follows:`;

class MistralEngine extends TextEngine {
  constructor(payload: Payload) {
    super(payload);
  }

  private formatPrompt(bot: Bot, messages: Message[]) {
    let prompt = bot.prompt || "";

    if (!bot.fineTuned) {
      prompt = `${basePrompt} ${prompt}`;
    }

    if (bot.canPingUsers) {
      for (const msg of messages) {
        if (msg.author.bot) {
          continue;
        }

        let username = msg.author.username.replace(/[^a-zA-Z0-9_]/g, "");

        if (!prompt.includes(msg.author.id)) {
          prompt += `\n - <@${msg.author.id}> ${msg.author.username}`;

          if (!bot.fineTuned) {
            prompt += ` (${username})`;
          }
        }

        // do this for users mentioned in the message
        for (const user of msg.mentions.users.toJSON()) {
          if (user.bot) {
            continue;
          }

          username = user.username.replace(/[^a-zA-Z0-9_]/g, "");

          if (!prompt.includes(user.id)) {
            prompt += `\n - <@${user.id}> ${user.username}`;

            if (!bot.fineTuned) {
              prompt += ` (${username})`;
            }
          }
        }
      }

      if (!bot.fineTuned) {
        prompt +=
          "\nUse the <@id> to ping them in the chat. Include the angle brackets, and the ID must be numerical.";
      }
    }

    return prompt;
  }

  private async handleCombinedMessages(
    chatMessages: MistralTypes.ChatMessage[],
    messages: Message[],
    bot: Bot
  ) {
    for (const msg of messages) {
      const isBot = msg.author.bot && msg.author.username === bot.username;
      const lastMessage = chatMessages[chatMessages.length - 1];

      // format date as yyyy-MM-dd HH:mm:ss
      const timestamp = msg.createdAt
        .toISOString()
        .replace("T", " ")
        .substring(0, 19);
      const content = bot.canPingUsers ? msg.content : msg.cleanContent;
      let messageText = isBot
        ? content
        : `[${timestamp}] <${msg.author.username}>: ${content}`;

      const imageUrls = msg.attachments
        .filter((a) => a.url && a.contentType?.startsWith("image"))
        .map((a) => a.url);

      for (const attachment of msg.attachments.toJSON()) {
        messageText += `\n[attachment] ${attachment.name} ${attachment.description} ${attachment.url}`;

        if (
          attachment.contentType?.startsWith("image") &&
          bot.enableVision &&
          bot.visionModel
        ) {
          // use the vision model to describe the image
          const description = await describeImage(
            attachment.url,
            bot.visionModel
          );

          messageText += ` you see: ${description}`;
        }
      }

      for (const embed of msg.embeds) {
        const description = await describeEmbed(JSON.stringify(embed));
        messageText += `\n[embed] ${embed.url} ${description}`;
      }

      if (lastMessage && lastMessage.role === "user" && !isBot) {
        lastMessage.content += `\n${messageText}`;
      } else if (lastMessage && lastMessage.role === "assistant" && isBot) {
        lastMessage.content += `\n${messageText}`;
      } else {
        let message: MistralTypes.ChatMessage;
        if (isBot) {
          message = {
            role: "assistant",
            content: messageText,
          };
        } else {
          message = {
            role: "user",
            content: messageText,
          };
        }

        chatMessages.push(message);
      }
    }
  }

  private async handlePerUserMessages(
    chatMessages: MistralTypes.ChatMessage[],
    messages: Message[],
    bot: Bot
  ) {
    for (const msg of messages) {
      const isBot = msg.author.bot && msg.author.username === bot.username;
      const role = isBot ? "assistant" : "user";
      const lastMessage = chatMessages[chatMessages.length - 1];

      // format date as yyyy-MM-dd HH:mm:ss
      const timestamp = msg.createdAt
        .toISOString()
        .replace("T", " ")
        .substring(0, 19);
      const content = bot.canPingUsers ? msg.content : msg.cleanContent;
      var messageText = content;

      const imageUrls = msg.attachments
        .filter((a) => a.url && a.contentType?.startsWith("image"))
        .map((a) => a.url);

      // use regex to clear characters that are not allowed in usernames
      const username = msg.author.username.replace(/[^a-zA-Z0-9_]/g, "");

      for (const attachment of msg.attachments.toJSON()) {
        messageText += `\n[attachment] ${attachment.name} ${attachment.description} ${attachment.url}`;

        if (
          attachment.contentType?.startsWith("image") &&
          bot.enableVision &&
          bot.visionModel
        ) {
          // use the vision model to describe the image
          const description = await describeImage(
            attachment.url,
            bot.visionModel
          );

          messageText += ` you see: ${description}`;
        }
      }

      for (const embed of msg.embeds) {
        const description = await describeEmbed(JSON.stringify(embed));
        messageText += `\n[embed] ${embed.url} ${description}`;
      }

      // @ts-ignore
      if (
        lastMessage &&
        lastMessage.role === "user" &&
        lastMessage.content.includes(`<${username}>: `)
      ) {
        lastMessage.content += `\n${messageText}`;
      } else if (lastMessage && lastMessage.role === "assistant" && isBot) {
        lastMessage.content += `\n${messageText}`;
      } else {
        let message: MistralTypes.ChatMessage;
        if (isBot) {
          message = {
            role: "assistant",
            content: messageText,
          };
        } else {
          message = {
            role: "user",
            content: `${timestamp} <${username}>: ${messageText}`
          };
        }

        chatMessages.push(message);
      }
    }
  }

  public override async getResponse(
    message: Message,
    bot: Bot
  ) {
    const messages = await this.getMessages(message, bot);
    const chatMessages: MistralTypes.ChatMessage[] = [];

    chatMessages.push({
      role: "system",
      content: this.formatPrompt(bot, messages),
    });

    if (bot.messagePerUser) {
      await this.handlePerUserMessages(chatMessages, messages, bot);
    } else {
      await this.handleCombinedMessages(chatMessages, messages, bot);
    }

    console.dir(chatMessages, { depth: null });

    let msg = ""

    try {
      const response = await Mistral.getInstance().chat({
        messages: chatMessages,
        model: bot.model,
        maxTokens: 2047,
      }) as MistralTypes.ChatCompletionResponse;

      console.dir(response, { depth: null });

      msg = response.choices[0].message.content
      msg = msg.includes(">: ")
        ? msg.substring(msg.indexOf(">: ") + 2)
        : msg;
    } catch (error) {
      console.error("Error making the API request", error);
      return {
        response: ""
      }
    }

    return {
      response: msg
    }
  }
}

export default MistralEngine;
