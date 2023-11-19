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

export async function setupMessageHandling(client: Client, payload: Payload) {
  client.on(Events.MessageCreate, async (interaction) => {
    try {
      const message = interaction as Message;
      if (
        !message.author.bot &&
        message.channel.type === ChannelType.GuildText
      ) {
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

    const filteredReply = await filterPings(reply);

    const image = await generateImageIfRelevant(bot, message, filteredReply);

    if (message.channel.type === ChannelType.GuildText) {
      const webhook = await getWebhook(message.channel as TextChannel, bot);
      const avatarURL = bot.avatarUrl || client.user!.avatarURL();

      // download image if relevant
      await webhook.send({
        content: filteredReply,
        username: bot.username,
        avatarURL,
        files: image
          ? [
              await axios
                .get(image, { responseType: "arraybuffer" })
                .then((response) => response.data),
            ]
          : undefined,
      });
    } else {
      await message.reply(filteredReply);
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
          content: `${message.author.username}#${message.author.discriminator}: ${message.content}`,
        },
        {
          role: "assistant",
          content: response,
        },
      ],
      model: "gpt-3.5-turbo",
      max_tokens: 2047,
      functions: [
        convertFunction({
          name: "generate_image",
          description:
            "Use this to generate an image that is relevant to the message",
          parameters: [
            {
              name: "shouldGenerate",
              type: "boolean",
              description: "Whether to generate an image",
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
      function_call: {
        name: "generate_image",
      },
    });

    // handle image generation
    const result = botResponse.choices[0].message;
    const args = JSON.parse(result.function_call.arguments);

    if (!args.shouldGenerate) return;

    const image = await OpenAI.getInstance().images.generate({
      model: "dall-e-3",
      prompt: args.prompt,
      n: 1,
      size: "1024x1024",
    });

    return image.data[0].url;
  }

  function getEngine(modelType: string) {
    switch (modelType) {
      case "chat":
        return new OpenAIChatEngine(payload);
      case "completion":
        return new OpenAITextEngine(payload);
      case "endpoint":
        return new EndpointEngine(payload);
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
}
