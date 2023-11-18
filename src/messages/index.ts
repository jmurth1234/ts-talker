import { Payload } from "payload";
import { Channel, ChannelType, Client, Events, Message, TextChannel, Webhook } from "discord.js";
import { Bot, Channel as DbChannel } from "payload/generated-types";
import didPing from "../lib/bot-mentioned";
import OpenAIChatEngine from "../engines/openai-chat";
import OpenAITextEngine from "../engines/openai-text";
import EndpointEngine from "../engines/endpoint";

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

    if (message.channel.type === ChannelType.GuildText) {
      const webhook = await getWebhook(message.channel as TextChannel, bot);
      const avatarURL = bot.avatarUrl || client.user!.avatarURL();

      await webhook.send({
        content: filteredReply,
        username: bot.username,
        avatarURL,
      });
    } else {
      await message.reply(filteredReply);
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
      const userPreference = await this.payload.find({
        collection: "users",
        where: {
          discordId: {
            equals: userId,
          },
        },
      });

      if (userPreference?.dontPing) {
        const discordUser = await this.discord.users.fetch(userId);
        messageContent = messageContent.replace(
          match[0],
          `@${discordUser.username}`
        );
      }
    }

    return messageContent;
  }
}
