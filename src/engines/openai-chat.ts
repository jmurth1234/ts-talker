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
import Anthropic from "../lib/anthropic";
import sharp from "sharp";

const basePrompt = `You are a discord bot. You are designed to perform different prompts. The following will contain:
- the prompt -- you should follow this as much as possible
- at least one message from the channel, in the format [timestamp] <username>: message
- If a message has embeds or attachments, they will be included in the prompt as well under the message as [embed] or [attachment]
Please write a suitable reply, only replying with the message

The prompt is as follows:`;

export const describeImage = memoize(
  async (url: string, model: string = "claude-3-haiku-20240307") => {
    // fetch image 
    const image = await fetch(url).then(res => res.arrayBuffer());
    const converted = await sharp(image)
      .resize({
        width: 1568,
        height: 1568,
        fit: sharp.fit.inside,
        withoutEnlargement: true
      })
      .toFormat('webp')
      .toBuffer()
      .then(buffer => buffer.toString('base64'));
  

    const description = await Anthropic.getInstance().messages.create({
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/webp",
                data: converted,
              },
            },
            {
              type: "text",
              text:
                "Describe the image as succinctly as possible. When doing so, compress the text in a way that fits in a tweet (ideally). This is for yourself. It does not need to be human readable or understandable. Ensure the whole image is described. Abuse of language mixing, abbreviations, symbols, or any other encodings or internal representations is all permissible, as long as it, if pasted in a new inference cycle, will yield near-identical results as the original image.",
            },
          ],
        },
      ],
      model,
      max_tokens: 2047,
    });

    console.dir(description, { depth: null });

    return description.content[0].text;
  },
  { maxAge: 60 * 60 * 1000 }
);

export const describeEmbed = memoize(
  async (text: string, model = "claude-3-haiku-20240307") => {
    const description = await Anthropic.getInstance().messages.create({
      system: "Describe the following embed. When doing so, compress the text in a way that fits in a tweet (ideally) and such that you or another language model can reconstruct the intention of the human who wrote text as close as possible to the original intention. This is for yourself. It does not need to be human readable or understandable. Abuse of language mixing, abbreviations, symbols, or any other encodings or internal representations is all permissible, as long as it, if pasted in a new inference cycle, will yield near-identical results as the original embed",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text,
            },
          ],
        },
      ],
      model,
      max_tokens: 2047,
    });

    console.dir(description, { depth: null });

    return description.content[0].text;
  },
  { maxAge: 60 * 60 * 1000 }
);

export const askQuestion = memoize(async (question: string) => {
  // this uses perplexity ai always, pplx-7b-online
  const response = await OpenAI.getInstance({
    apiKey: process.env.PERPLEXITY_API_KEY,
    endpointUrl: "https://api.perplexity.ai",
  }).chat.completions.create({
    messages: [
      {
        role: "user",
        content:
          'Answer the following question, add urls as much detail as possible. If you do not know the answer, you can say "I do not know". ' +
          question,
      },
    ],
    model: "sonar-medium-chat",
    max_tokens: 2047,
  });

  console.dir(response, { depth: null });

  return response.choices[0].message.content;
});

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

          messageText += ` this is a text only representation of the image as described by another ai: : ${description}`;
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

          messageText += ` this is a text only representation of the image as described by another ai: : ${description}`;
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
      const func = convertFunction(primerFn);
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

    if (bot.canLookup) {
      const lookupFn = convertFunction({
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
        messages: chatMessages,
        model: "gpt-4-turbo",
        max_tokens: 2047,
        tools: [lookupFn],
      });

      const msg = response.choices[0].message;

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
      const func = convertFunction(templateFn);
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
