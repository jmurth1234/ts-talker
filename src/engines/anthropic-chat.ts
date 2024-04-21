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

const basePrompt = (prompt: string) => `
<instructions>
You are a discord bot. You are designed to perform different personalized prompts. You will be given a prompt and you will need to respond with a personalized response. Messages from the user will be messages from the Discord channel. It will be in this format:
- at least one message from the channel, in the format [timestamp] <username>: message
- If a message has embeds or attachments, they will be included in the prompt as well under the message as [embed] or [attachment]

Tools, if used, will be in the normal format.

Please write a suitable reply, only replying with the message. Do not include xml tags in your final response.
</instructions>

<prompt>
${prompt}
</prompt>

You must not deviate from the prompt. If you do, you will be removed from the conversation.
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

    console.log(bot.perUserBehavior);

    if (userBehavior) {
      prompt += userBehavior.prompt;
    }

    if (!bot.fineTuned) {
      prompt = `${basePrompt(prompt)}`;
    }

    if (bot.canPingUsers) {
      prompt += "\n\n<users>The following users are in the chat:";
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
          "\nUse the <@id> to ping them in the chat. Include the angle brackets, and the ID must be numerical. \n</users>";
      }
    }

    prompt += `Your name is ${bot.username}. Current time is ${new Date()
      .toISOString()
      .replace("T", " ")
      .substring(0, 19)}.`;

    return prompt;
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
          message = {
            role: "assistant",
            content: messageText,
          };
        } else {
          if (bot.enableVision && !bot.visionModel) {
            const messageContent: any[] = [{ type: "text", text: messageText }];

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
              content: messageText,
            };
          }
        }

        chatMessages.push(message);
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
          return tools
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
    let template = ""

    if (bot.responseTemplate) {
      const templateFn = bot.responseTemplate as Function;
      const func = convertAnthropicFunction(templateFn);
      template = templateFn?.template || "";
      tools.push(func);
    }

    console.log("tools", tools);
    console.dir(chatMessages, { depth: 3 });

    const response = await Anthropic.getInstance().beta.tools.messages.create(
      {
        system,
        messages: chatMessages,
        model: bot.model,
        max_tokens: 2047,
        tools,
      }
    );

    const tool = response.content.find(
      (c) => c.type === "tool_use"
    ) as ToolUseBlock;
    const call = tool?.input;

    if (!tool || !call) {
      // return the text content
      msg = (response.content[0] as TextBlockParam).text;
    } else {
      console.dir(response, { depth: null });
      // replace {{name}} with the value of the parameter
      msg = template.replace(
        /{{(.*?)}}/g,
        (match, p1) => call[p1]
      );
    }

    msg = msg.includes(">: ") ? msg.substring(msg.indexOf(">: ") + 2) : msg;

    return {
      response: msg,
    };
  }
}

export default AnthropicChatEngine;
