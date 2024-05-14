import { Message } from "discord.js";
import TextEngine from "./text";
import { Payload } from "payload";
import OpenAI from "../lib/openai";
import { Bot, Function } from "payload/generated-types";
import {
  ChatCompletionContentPart,
  ChatCompletionMessageParam,
} from "openai/resources";
import { convertOpenAIFunction } from "../lib/function-converter";
import {
  describeImage,
  describeEmbed,
  askQuestion,
} from "../lib/helper-functions";

const basePrompt = `You are a discord bot. You are designed to perform different prompts. The following will contain:
- the prompt -- you should follow this as much as possible
- at least one message from the channel, in the format [timestamp] <username>: message
- If a message has embeds or attachments, they will be included in the prompt as well under the message as [embed] or [attachment]
Please write a suitable reply, only replying with the message

The prompt is as follows:`;

class OpenAIChatEngine extends TextEngine {
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

    if (!bot.fineTuned) {
      prompt = `${basePrompt} ${prompt}`;
    }

    if (userBehavior) {
      prompt += userBehavior.prompt;
    }

    if (bot.canPingUsers) {
      prompt += "\n\nThe following users are in the chat:";
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

    prompt += `Your name is ${bot.username}. Current time is ${new Date()
      .toISOString()
      .replace("T", " ")
      .substring(0, 19)}.`;

    console.log(prompt, userBehavior);

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

          messageText += ` this is a text only representation of the image as described by another ai: : ${description}. pretend you saw the real image`;
        }
      }

      for (const embed of msg.embeds) {
        const description = await describeEmbed(JSON.stringify(embed));
        messageText += `\n[embed] ${embed.url} ${description}`;
      }

      if (lastMessage && lastMessage.role === "user" && !isBot) {
        if (bot.enableVision && !bot.visionModel) {
          const content = lastMessage.content as ChatCompletionContentPart[];
          content[0].text += `\n${messageText}`;

          for (const url of imageUrls) {
            content.push({
              type: "image_url",
              image_url: {
                url,
              },
            });
          }
        } else {
          lastMessage.content += `\n${messageText}`;
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
          if (bot.enableVision && !bot.visionModel) {
            message = {
              role: "user",
              content: [{ type: "text", text: messageText }],
            };

            for (const url of imageUrls) {
              (message.content as ChatCompletionContentPart[]).push({
                type: "image_url",
                image_url: {
                  url,
                },
              });
            }
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

          messageText += ` this is a text only representation of the image as described by another ai: : ${description}. pretend you saw the real image`;
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
        lastMessage.name === username
      ) {
        if (bot.enableVision && !bot.visionModel) {
          const content = lastMessage.content as ChatCompletionContentPart[];
          content[0].text += `\n${messageText}`;

          for (const url of imageUrls) {
            content.push({
              type: "image_url",
              image_url: {
                url,
              },
            });
          }
        } else {
          lastMessage.content += `\n${messageText}`;
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
          if (bot.enableVision && !bot.visionModel) {
            message = {
              role,
              name: username,
              content: [{ type: "text", text: messageText }],
            };

            for (const url of imageUrls) {
              (message.content as ChatCompletionContentPart[]).push({
                type: "image_url",
                image_url: {
                  url,
                },
              });
            }
          } else {
            message = {
              role,
              name: username,
              content: messageText,
            };
          }
        }

        chatMessages.push(message);
      }
    }
  }

  public override async getResponse(message: Message, bot: Bot) {
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
      const func = convertOpenAIFunction(primerFn);
      const response = await OpenAI.getInstance(bot).chat.completions.create({
        messages: chatMessages,
        model: bot.model,
        max_tokens: 2047,
        tools: [func],
        tool_choice: {
          type: "function",
          function: { name: func.function.name },
        },
      });

      console.dir(response, { depth: null });

      const msg = response.choices[0].message;

      if (primerFn.template) {
        const call = JSON.parse(
          msg?.tool_calls?.[0]?.function.arguments || msg.content
        );

        // replace {{name}} with the value of the parameter
        const text = primerFn.template.replace(
          /{{(.*?)}}/g,
          (match, p1) => call[p1]
        );

        chatMessages.push({
          role: "function",
          name: func.function.name,
          content: text,
        });
      } else {
        chatMessages.push({
          role: "function",
          name: func.function.name,
          content: msg?.tool_calls?.[0]?.function.arguments || msg.content,
        });
      }
    }

    let lookupFn: any;

    if (bot.canLookup) {
      lookupFn = convertOpenAIFunction({
        id: "lookup",
        name: "lookup",
        description:
          "Perform a lookup to find information from the web if necessary. Don't mention the bot in the message, just ask the question.",
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

      const response = await OpenAI.getInstance(bot).chat.completions.create({
        messages: [
          ...chatMessages,
          {
            role: "system",
            content: `You are a middleman designed to determine whether the above messages need a web search. The lookup model is a bit stupid and lacks things like the current date so be vey precise in any searches. Not all messages need a web search. If you are unsure, you can say "I do not know".`,
          }
        ],
        model: "gpt-4o",
        max_tokens: 2047,
        tools: [lookupFn],
      });

      const msg = response.choices[0].message;
      console.dir(msg, { depth: null });

      try {
        const call = JSON.parse(
          msg?.tool_calls?.[0]?.function.arguments || msg.content
        );

        if (call.text) {
          chatMessages.push(response.choices[0].message);

          const answer = await askQuestion(call.text);

          chatMessages.push({
            role: "tool",
            tool_call_id: msg?.tool_calls?.[0]?.id,
            // name: lookupFn.function.name,
            content: `The lookup model says: ${answer}. This is not shown to the user, so you must use the response to craft a reply.`,
          });
        }
      } catch (error) {
        // probably no lookup needed
        console.error(error);
      }
    }

    console.dir(chatMessages, { depth: null });

    let msg = "";

    if (bot.responseTemplate) {
      const templateFn = bot.responseTemplate as Function;
      const func = convertOpenAIFunction(templateFn);
      const response = await OpenAI.getInstance(bot).chat.completions.create({
        messages: chatMessages,
        model: bot.model,
        max_tokens: 2047,
        tools: [func],
        tool_choice: {
          type: "function",
          function: { name: func.function.name },
        },
      });

      const reply = response.choices[0].message;

      console.dir(reply, { depth: null });

      const call = JSON.parse(
        reply?.tool_calls?.[0]?.function.arguments || reply.content
      );

      // replace {{name}} with the value of the parameter
      msg = templateFn.template.replace(/{{(.*?)}}/g, (match, p1) => call[p1]);
    } else {
      try {
        const response = await OpenAI.getInstance(bot).chat.completions.create({
          messages: chatMessages,
          model: bot.model,
          max_tokens: 2047,
          tools: [lookupFn],
        });

        console.dir(response, { depth: null });

        msg = response.choices[0].message.content;
        msg = msg.includes(">: ") ? msg.substring(msg.indexOf(">: ") + 2) : msg;
      } catch (error) {
        console.error("Error making the API request", error);
        return {
          response: "",
        };
      }
    }

    return {
      response: msg,
    };
  }
}

export default OpenAIChatEngine;
