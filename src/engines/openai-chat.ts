import { Message } from "discord.js";
import TextEngine from "./text";
import { Payload } from "payload";
import OpenAI from "../lib/openai";
import { Bot, Function } from "payload/generated-types";
import {
  ChatCompletionContentPart,
  ChatCompletionMessageParam,
} from "openai/resources";
import convertFunction from "../lib/function-converter";
import memoize from "promise-memoize";

const basePrompt = `You are a discord bot designed to perform different prompts. The following will contain:
- the prompt -- you should follow this as much as possible
- at least one message from the channel, in the format [timestamp] <username>: message
- If a message has embeds or attachments, they will be included in the prompt as well under the message as [embed] or [attachment]
Please write a suitable reply, only replying with the message

The prompt is as follows:`;

const describeImage = memoize(
  async (url: string, model: string) => {
    const description = await OpenAI.getInstance().chat.completions.create({
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Describe the image",
            },
            {
              type: "image_url",
              image_url: {
                url,
              },
            },
          ],
        },
      ],
      model,
      max_tokens: 2047,
    });

    console.dir(description, { depth: null });

    return description.choices[0].message.content;
  },
  { maxAge: 60 * 60 * 1000 }
);

class OpenAIChatEngine extends TextEngine {
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
    chatMessages: ChatCompletionMessageParam[],
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
        : `[${timestamp}] <${msg.author.username}> ${content}`;

      const imageUrls = msg.attachments
        .filter((a) => a.url && a.contentType?.startsWith("image"))
        .map((a) => a.url);

      for (const attachment of msg.attachments.toJSON()) {
        messageText += `\n[attachment] json: ${JSON.stringify(attachment)}`;

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
        messageText += `\n[embed] json: ${JSON.stringify(embed)}`;
      }

      if (lastMessage && lastMessage.role === "user" && !isBot) {
        const content = lastMessage.content as ChatCompletionContentPart[];
        content[0].text += `\n${messageText}`;
        if (bot.enableVision && !bot.visionModel) {
          for (const url of imageUrls) {
            content.push({
              type: "image_url",
              image_url: {
                url,
              },
            });
          }
        }
      } else if (lastMessage && lastMessage.role === "assistant" && isBot) {
        lastMessage.content += `\n${messageText}`;
      } else {
        let message: ChatCompletionMessageParam;
        if (isBot) {
          message = {
            role: "assistant",
            content: messageText,
          };
        } else {
          message = {
            role: "user",
            content: [{ type: "text", text: messageText }],
          };

          if (bot.enableVision && !bot.visionModel) {
            for (const url of imageUrls) {
              (message.content as ChatCompletionContentPart[]).push({
                type: "image_url",
                image_url: {
                  url,
                },
              });
            }
          }
        }

        chatMessages.push(message);
      }
    }
  }

  private async handlePerUserMessages(
    chatMessages: ChatCompletionMessageParam[],
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
        messageText += `\n[attachment] json: ${JSON.stringify(attachment)}`;

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
        messageText += `\n[embed] json: ${JSON.stringify(embed)}`;
      }

      // @ts-ignore
      if (lastMessage && lastMessage.role === 'user' && lastMessage.name === username) {
        const content = lastMessage.content as ChatCompletionContentPart[];
        content[0].text += `\n${messageText}`;
        if (bot.enableVision && !bot.visionModel) {
          for (const url of imageUrls) {
            content.push({
              type: "image_url",
              image_url: {
                url,
              },
            });
          }
        }
      } else if (lastMessage && lastMessage.role === "assistant" && isBot) {
        lastMessage.content += `\n${messageText}`;
      } else {
        let message: ChatCompletionMessageParam;
        if (isBot) {
          message = {
            role: "assistant",
            name: username,
            content: messageText,
          };
        } else {
          message = {
            role: "user",
            name: username,
            content: [{ type: "text", text: messageText }],
          };

          if (bot.enableVision && !bot.visionModel) {
            for (const url of imageUrls) {
              (message.content as ChatCompletionContentPart[]).push({
                type: "image_url",
                image_url: {
                  url,
                },
              });
            }
          }
        }

        chatMessages.push(message);
      }
    }
  }

  public override async getResponse(
    message: Message,
    bot: Bot
  ): Promise<string> {
    const messages = await this.getMessages(message, bot);
    const chatMessages: ChatCompletionMessageParam[] = [];

    chatMessages.push({
      role: "system",
      content: this.formatPrompt(bot, messages),
    });

    if (bot.messagePerUser) {
      await this.handlePerUserMessages(chatMessages, messages, bot);
    } else {
      await this.handleCombinedMessages(chatMessages, messages, bot);
    }

    if (bot.primer) {
      const primerFn = bot.primer as Function;
      const func = convertFunction(primerFn);
      const response = await OpenAI.getInstance().chat.completions.create({
        messages: chatMessages,
        model: bot.model,
        max_tokens: 2047,
        functions: [func],
        function_call: { name: func.name },
      });

      const msg = response.choices[0].message;
      const call = JSON.parse(msg.function_call.arguments);

      if (primerFn.template) {
        // replace {{name}} with the value of the parameter
        const text = primerFn.template.replace(
          /{{(.*?)}}/g,
          (match, p1) => call[p1]
        );

        chatMessages.push({
          role: "function",
          name: func.name,
          content: text,
        });
      } else {
        chatMessages.push({
          role: "function",
          name: func.name,
          content: msg.function_call.arguments,
        });
      }
    }

    console.dir(chatMessages, { depth: null });

    if (bot.responseTemplate) {
      const templateFn = bot.responseTemplate as Function;
      const func = convertFunction(templateFn);
      const response = await OpenAI.getInstance().chat.completions.create({
        messages: chatMessages,
        model: bot.model,
        max_tokens: 2047,
        functions: [func],
        function_call: { name: func.name },
      });

      const msg = response.choices[0].message;
      const call = JSON.parse(msg.function_call.arguments);

      // replace {{name}} with the value of the parameter
      const text = templateFn.template.replace(
        /{{(.*?)}}/g,
        (match, p1) => call[p1]
      );

      return text;
    } else {
      try {
        const response = await OpenAI.getInstance().chat.completions.create({
          messages: chatMessages,
          model: bot.model,
          max_tokens: 2047,
        });

        console.dir(response, { depth: null });

        var msg = response.choices[0].message.content;
        var filteredMsg = msg.includes("> ")
          ? msg.substring(msg.indexOf("> ") + 2)
          : msg;

        return filteredMsg;
      } catch (error) {
        console.error("Error making the API request", error);
        return "";
      }
    }
  }
}

export default OpenAIChatEngine;
