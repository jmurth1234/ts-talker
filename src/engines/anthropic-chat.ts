import { Message } from "discord.js";
import TextEngine from "./text";
import { Payload } from "payload";
import Anthropic from "../lib/anthropic";
import { Bot, Function } from "payload/generated-types";
import { convertAnthropicFunction } from "../lib/function-converter";
import {
  describeImage,
  describeEmbed,
  askQuestion,
  fetchImage,
} from "../lib/helper-functions";
import {
  MessageParam,
  Messages,
  TextBlockParam,
} from "@anthropic-ai/sdk/resources";
import {
  ToolUseBlock,
  ToolsBetaMessageParam,
} from "@anthropic-ai/sdk/resources/beta/tools/messages";

const basePrompt = (intro: string, prompt: string, users: string) => `${intro}

You are roleplaying as the following persona:

<persona>
${prompt}
</persona>

Here is a list of the users in the channel, along with their numerical IDs:

<users>
${users}
</users>

Please stay in character as the persona described above in all your replies. You must do so to the best of your abilities.

If you want to ping a user in your reply, use the format <@id> with their numerical ID inside the angle brackets. If you do not have a numerical ID, do not ping the user.

Before giving your in-character reply, think through what you want to say in this scratchpad:

<scratchpad>
</scratchpad>

Now provide your in-character reply to the latest message in the conversation. Write your reply inside <reply> tags.
`;

class AnthropicChatEngine extends TextEngine {
  constructor(payload: Payload) {
    super(payload);
  }

  private formatPrompt(bot: Bot, messages: Message[]) {
    let prompt = bot.prompt || "";
    let lastMessage = messages[messages.length - 1];
    let userBehavior = bot.perUserBehavior.find(
      (b) => b.id === lastMessage.author.id
    );

    if (userBehavior) {
      prompt += userBehavior.prompt;
    }

    let users = "";

    if (bot.canPingUsers) {
      for (const msg of messages) {
        if (msg.author.bot) {
          continue;
        }

        if (!prompt.includes(msg.author.id)) {
          users += `- <@${msg.author.id}> ${msg.author.username} \n`;
        }

        // do this for users mentioned in the message
        for (const user of msg.mentions.users.toJSON()) {
          if (user.bot) {
            continue;
          }

          if (!prompt.includes(user.id)) {
            users += `\n - <@${user.id}> ${user.username}`;
          }
        }
      }
    } else {
      users = "User pings are disabled.";
    }

    const intro = `Your name is ${bot.username}. Current time is ${new Date()
      .toISOString()
      .replace("T", " ")
      .substring(0, 19)}.`;

    return basePrompt(intro, prompt, users);
  }

  private async handleCombinedMessages(
    chatMessages: ToolsBetaMessageParam[],
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
        if (
          attachment.contentType?.startsWith("image") &&
          bot.enableVision &&
          bot.visionModel
        ) {
          messageText += `\n[attachment] ${attachment.name} ${attachment.description} ${attachment.url}`;

          // use the vision model to describe the image
          const description = await describeImage(
            attachment.url,
            bot.visionModel
          );

          messageText += ` this is a text only representation of the image as described by another ai: : ${description}. pretend you saw the real image`;
        }
      }

      for (const embed of msg.embeds) {
        const description = await describeEmbed(JSON.stringify(embed));
        messageText += `\n[embed] ${embed.url} ${description}`;
      }

      if (lastMessage && lastMessage.role === "user" && !isBot) {
        if (bot.enableVision && !bot.visionModel) {
          const messageContent = lastMessage.content as any[];
          (messageContent[0] as TextBlockParam).text += `\n${messageText}`;

          for (const url of imageUrls) {
            const image = await fetchImage(url);
            messageContent.push({
              type: "image",
              source: {
                type: "base64",
                media_type: "image/webp",
                data: image,
              },
            });
          }
        } else {
          lastMessage.content += `\n${messageText}`;
        }
      } else if (lastMessage && lastMessage.role === "assistant" && isBot) {
        lastMessage.content += `\n${messageText}`;
      } else {
        let message: MessageParam;
        if (isBot) {
          // if last message and the last message is a user message. properly terminate the last message
          if (lastMessage && lastMessage.role === "user") {
            const textBlock = lastMessage.content[0] as TextBlockParam;

            if (textBlock.text) {
              textBlock.text += `\n</messages>\nRemember to stay in character and provide your reply inside <reply> tags, and think through what you want to say beforehand with <scratchpad>. Any past messages from you will only contain the reply text.`;
            } else {
              lastMessage.content += `\n</messages>\nRemember to stay in character and provide your reply inside <reply> tags, and think through what you want to say beforehand with <scratchpad>. Any past messages from you will only contain the reply text.`;
            }
          }
          message = {
            role: "assistant",
            content: messageText,
          };
        } else {
          if (bot.enableVision && !bot.visionModel) {
            const messageContent: any[] = [
              { type: "text", text: `<messages>\n${messageText}` },
            ];

            for (const url of imageUrls) {
              const image = await fetchImage(url);
              messageContent.push({
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/webp",
                  data: image,
                },
              });
            }

            message = {
              role: "user",
              content: messageContent,
            };
          } else {
            message = {
              role: "user",
              content: `<messages>\n${messageText}`,
            };
          }
        }

        chatMessages.push(message);
      }
    }

    // properly terminate the last message
    const lastMessage = chatMessages[chatMessages.length - 1];

    if (lastMessage && lastMessage.role === "user") {
      const textBlock = lastMessage.content[0] as TextBlockParam;

      if (textBlock.text) {
        textBlock.text += `\n</messages>\nRemember to stay in character and provide your reply inside <reply> tags, and think through what you want to say beforehand with <scratchpad>. Any past messages from you will only contain the reply text.`;
      } else {
        lastMessage.content += `\n</messages>\nRemember to stay in character and provide your reply inside <reply> tags, and think through what you want to say beforehand with <scratchpad>. Any past messages from you will only contain the reply text.`;
      }
    }
  }

  private async processPrimer(
    system: string,
    bot: Bot,
    chatMessages: ToolsBetaMessageParam[]
  ) {
    console.log("processPrimer");
    if (bot.primer) {
      const primerFn = bot.primer as Function;
      const func = convertAnthropicFunction(primerFn);
      const response = await Anthropic.getInstance().beta.tools.messages.create(
        {
          messages: chatMessages,
          model: bot.model,
          system,
          max_tokens: 2047,
          tools: [func],
          // tool_choice: {
          //   type: "function",
          //   function: { name: func.function.name },
          // },
        }
      );

      console.dir(response, { depth: null });

      const tool = response.content.find(
        (c) => c.type === "tool_use"
      ) as ToolUseBlock;
      const call = tool?.input;

      if (!tool || !call) {
        return;
      }

      chatMessages.push({
        role: "assistant",
        content: response.content,
      });

      if (primerFn.template) {
        // replace {{name}} with the value of the parameter
        const text = primerFn.template.replace(
          /{{(.*?)}}/g,
          (match, p1) => call[p1]
        );

        chatMessages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: tool.id,
              content: [{ type: "text", text: text }],
            },
          ],
        });
      } else {
        chatMessages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: tool.id,
              content: [{ type: "text", text: JSON.stringify(call) }],
            },
          ],
        });
      }
    }
  }

  private async processLookup(
    system: string,
    bot: Bot,
    chatMessages: ToolsBetaMessageParam[]
  ) {
    console.log("processLookup");
    let tools = [];

    if (bot.primer) {
      const primerFn = bot.primer as Function;
      const func = convertAnthropicFunction(primerFn);
      tools.push(func);
    }

    if (bot.canLookup) {
      try {
        const lookupFn = convertAnthropicFunction({
          id: "lookup",
          name: "lookup",
          description:
            "Perform a lookup to find information from the web if necessary. Your training data has a cutoff of 2023, so any queries for newer information should use this lookup tool.",
          parameters: [
            {
              name: "text",
              type: "string",
              description:
                "The question to ask -- a secondary AI model will be used to answer this question",
              required: false,
            },
          ],
        });

        tools.push(lookupFn);

        const response =
          await Anthropic.getInstance().beta.tools.messages.create({
            messages: chatMessages,
            system,
            model: bot.model,
            max_tokens: 2047,
            tools,
          });

        console.dir(response, { depth: null });

        const tool = response.content.find(
          (c) => c.type === "tool_use"
        ) as ToolUseBlock;
        const call = tool?.input as { text: string };

        if (!tool || !call?.text) {
          return tools;
        }

        chatMessages.push({
          role: "assistant",
          content: response.content,
        });

        const answer = await askQuestion(call.text);

        chatMessages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: tool.id,
              content: [
                {
                  type: "text",
                  text: `The lookup model says: ${answer}. This is not shown to the user, so you must use the response to craft a reply.`,
                },
              ],
            },
          ],
        });
      } catch (error) {
        // probably no lookup needed
        console.error(error);
      }
    }

    return tools;
  }

  public override async getResponse(message: Message, bot: Bot) {
    const messages = await this.getMessages(message, bot);
    const chatMessages: ToolsBetaMessageParam[] = [];

    const system = this.formatPrompt(bot, messages);

    console.log("system", system);

    await this.handleCombinedMessages(chatMessages, messages, bot);
    await this.processPrimer(system, bot, chatMessages);

    const tools = await this.processLookup(system, bot, chatMessages);

    let msg = "";
    let template = "";

    if (bot.responseTemplate) {
      const templateFn = bot.responseTemplate as Function;
      const func = convertAnthropicFunction(templateFn);
      template = templateFn?.template || "";
      tools.push(func);
    }

    console.log("tools", tools);
    console.dir(chatMessages, { depth: 3 });

    const response = await Anthropic.getInstance().messages.create({
      system,
      messages: [
        ...chatMessages,
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text: `<scratchpad>\nAs I am responding as ${bot.username},`,
            },
          ],
        }
      ],
      model: bot.model,
      max_tokens: 2047,
      //tools,
    });

    const tool = response.content.find(
      (c) => c.type === "tool_use"
    ) as ToolUseBlock;
    const call = tool?.input;

    console.dir(response, { depth: null });

    if (!tool || !call) {
      // return the text content
      msg = (response.content[0] as TextBlockParam).text;
    } else {
      // replace {{name}} with the value of the parameter
      msg = template.replace(/{{(.*?)}}/g, (match, p1) => call[p1]);
    }

    // extract the reply from the reply tag in the text
    const match = msg.match(/<reply>(.*?)<\/reply>/s);
    if (match) {
      msg = match[1];
    }

    return {
      response: msg,
    };
  }
}

export default AnthropicChatEngine;
