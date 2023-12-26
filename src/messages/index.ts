import { Payload } from "payload";
import {
  Channel,
  ChannelType,
  Client,
  Events,
  Message,
  TextChannel,
  Webhook,
} from "discord.js";
import { Bot, Channel as DbChannel } from "payload/generated-types";
import didPing from "../lib/bot-mentioned";
import OpenAIChatEngine from "../engines/openai-chat";
import OpenAITextEngine from "../engines/openai-text";
import EndpointEngine from "../engines/endpoint";
import OpenAI from "../lib/openai";
import convertFunction from "../lib/function-converter";
import axios from "axios";
import MistralEngine from "../engines/mistral";

export async function setupMessageHandling(client: Client, payload: Payload) {
  client.on(Events.MessageCreate, async (interaction) => {
    try {
      const message = interaction as Message;
      if (message.channel.type === ChannelType.GuildText) {
        await messageReceived(message);
      }
    } catch (error) {
      console.error("Error processing message:", error);
    }
  });

  async function messageReceived(message: Message) {
    const botList = await payload.find({
      collection: "bots",
      where: { channelId: { equals: message.channel.id } },
    });

    if (botList.totalDocs === 0) return;

    const activeBots = botList.docs;

    const defaultBot = activeBots.find((bot) => bot.default);

    if (message.mentions.has(client.user!.id)) {
      if (defaultBot) {
        await handleReply(message, defaultBot);
      } else {
        // reply with help message
        await message.channel.send(
          "Hey, you'll want to ping one of the bots not me directly, use `/list` or `/ask`"
        );
      }
      return;
    }

    let bot: Bot | undefined;
    for (const b of activeBots) {
      if (await didPing(message, b)) {
        bot = b;
        break;
      }
    }

    if (!bot) {
      // pick one at random
      const randomBot =
        activeBots[Math.floor(Math.random() * activeBots.length)];

      if (randomBot.chance > Math.random()) {
        bot = randomBot;
      }
    }

    if (bot) {
      await handleReply(message, bot);
      return;
    }
  }

  async function handleReply(message: Message, bot: Bot) {
    // wait a second for links to be unfurled
    await new Promise((resolve) => setTimeout(resolve, 1000));

    await message.channel.sendTyping();

    const engine = getEngine(bot.modelType);
    const reply = await engine.getResponse(message, bot);
    const filteredReply = await filterPings(reply.response);
    const splitMessages = splitMessage(filteredReply);
    const image = await generateImageIfRelevant(bot, message, filteredReply);

    if (message.channel.type === ChannelType.GuildText) {
      const webhook = await getWebhook(message.channel as TextChannel, bot);
      const avatarURL = bot.avatarUrl || client.user!.avatarURL();

      for (let i = 0; i < splitMessages.length; i++) {
        const isLastMessage = i === splitMessages.length - 1;
        const splitMessage = splitMessages[i];
        await webhook.send({
          content: splitMessage,
          username: bot.username,
          avatarURL,
          files: image && isLastMessage
          ? [
              await axios
                .get(image, { responseType: "arraybuffer" })
                .then((response) => response.data),
            ]
          : undefined,
        });
      }

    } else {
      for (let i = 0; i < splitMessages.length; i++) {
        const isLastMessage = i === splitMessages.length - 1;
        const sendMessage = i === 0 ? message.reply : message.channel.send;
        const splitMessage = splitMessages[i];
        await sendMessage({
          content: splitMessage,
          files: image && isLastMessage
          ? [
              await axios
                .get(image, { responseType: "arraybuffer" })
                .then((response) => response.data),
            ]
          : undefined,
        });
      }
    }
  }

  async function generateImageIfRelevant(
    bot: Bot,
    message: Message,
    response: string
  ) {
    if (!bot.canPostImages) return;

    const botResponse = await OpenAI.getInstance().chat.completions.create({
      messages: [
        {
          role: "system",
          content: `You must decide whether the message from the bot could do with an image. If so, generate a DALL-E prompt to create the image. The bot is called ${bot.username} and has the prompt: ${bot.prompt}`,
        },
        {
          role: "user",
          content: `Last user message from ${message.author.username}: ${message.content}. Bot response: ${response}`,
        },
      ],
      model: "gpt-4-1106-preview",
      max_tokens: 2047,
      tools: [
        convertFunction({
          name: "generate_image",
          description:
            "Use this to generate an image that is relevant to the message and the bot's response. Refuse to generate an image if it is against OpenAI's terms of service.",
          parameters: [
            {
              name: "thought",
              type: "string",
              description:
                "Your reasoning for whether an image is relevant or not. ",
              required: true,
            },
            {
              name: "shouldGenerate",
              type: "boolean",
              description:
                "Whether to generate an image. Not all messages need an image. Judge based on the message and the bot's response, and whether an image would be relevant. Prefer to not generate an image if you are unsure.",
              required: true,
            },
            {
              name: "prompt",
              type: "string",
              description:
                "The prompt to use to generate the image. This should describe a scene relevant to the message",
              required: true,
            },
          ],
        }),
      ],
    });

    try {
      // handle image generation
      const result = botResponse.choices[0].message;
      const args = JSON.parse(result.tool_calls[0].function.arguments);
      console.dir(args, { depth: null });

      if (!args.shouldGenerate) return;

      const image = await OpenAI.getInstance().images.generate({
        model: bot.imageModel || "dall-e-2",
        prompt: args.prompt,
        n: 1,
        size: bot.imageSize || "512x512",
      });

      return image.data[0].url;
    } catch (error) {
      console.error(error);
      return;
    }
  }

  function getEngine(modelType: string) {
    switch (modelType) {
      case "chat":
        return new OpenAIChatEngine(payload);
      case "completion":
        return new OpenAITextEngine(payload);
      case "endpoint":
        return new EndpointEngine(payload);
      case "mistral":
        return new MistralEngine(payload);
      default:
        throw new Error("Invalid model type");
    }
  }

  async function getWebhook(channel: TextChannel, bot: Bot) {
    const lookup = await payload.find({
      collection: "channels",
      where: { channelId: { equals: channel.id } },
    });

    let dbChannel: DbChannel = lookup.docs[0];
    let webhook: Webhook;

    if (!dbChannel) {
      webhook = await channel.createWebhook({
        name: bot.username,
        avatar: bot.avatarUrl,
      });

      dbChannel = await payload.create({
        collection: "channels",
        data: {
          channelId: channel.id,
          webhookId: webhook.id,
        },
      });
    } else {
      const webhooks = await channel.fetchWebhooks();
      webhook = webhooks.find((webhook) => webhook.id === dbChannel.webhookId);
    }

    if (!webhook) {
      webhook = await channel.createWebhook({
        name: bot.username,
        avatar: bot.avatarUrl,
      });

      await payload.update({
        collection: "channels",
        id: dbChannel.id,
        data: {
          webhookId: webhook.id,
        },
      });
    }

    return webhook;
  }

  async function filterPings(messageContent: string): Promise<string> {
    const pingRegex = /<@!?(\d+)>/g;
    const matches = messageContent.matchAll(pingRegex);

    for (const match of matches) {
      const userId = match[1];
      const userPreferencLookup = await payload.find({
        collection: "users",
        where: {
          discordId: {
            equals: userId,
          },
        },
      });

      const userPreference = userPreferencLookup.docs[0];

      if (userPreference?.preventPings) {
        const discordUser = await client.users.fetch(userId);
        messageContent = messageContent.replace(
          match[0],
          `@${discordUser.username}`
        );
      }
    }

    return messageContent;
  }

  /**
   * Split a message into multiple messages if it is too long. Discord has a limit of 2000 characters per message.
   * If a message is longer than that, it will be split into multiple messages, using line breaks as a guide.
   * If in the middle of a code block, it will split the code block.
  
   * @param message 
   * @returns an array of messages that are less than 2000 characters long
   */
  function splitMessage(message: string): string[] {
    const messages: string[] = [];
    const lines = message.split("\n");
    let currentMessage = "";
    let inCodeBlock = false;
    let codeBlockLanguage = "";

    for (const line of lines) {
      if (line.startsWith("```")) {
        if (inCodeBlock) {
          currentMessage += "```";
          messages.push(currentMessage);
          currentMessage = "";
          inCodeBlock = false;
          codeBlockLanguage = "";
        } else {
          inCodeBlock = true;
          codeBlockLanguage = line.replace("```", "");
          currentMessage += "```" + codeBlockLanguage + "\n";
        }
      } else if (currentMessage.length + line.length > 2000) {
        if (inCodeBlock) {
          currentMessage += "```";
          messages.push(currentMessage);
          currentMessage = "```" + codeBlockLanguage + "\n";
        } else {
          messages.push(currentMessage);
          currentMessage = "";
        }
      }

      currentMessage += line + "\n";
    }

    if (currentMessage.length > 0) {
      messages.push(currentMessage);
    }

    return messages;
  }
}