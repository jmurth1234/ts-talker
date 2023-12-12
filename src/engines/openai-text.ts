import { Message } from "discord.js";
import { Payload } from "payload";
import OpenAI from "../lib/openai";
import { Bot } from "payload/generated-types";
import TextEngine from "./text";

class OpenAITextEngine extends TextEngine {
  constructor(payload: Payload) {
    super(payload);
  }

  public override async getResponse(
    message: Message,
    bot: Bot
  ) {
    const messages = await this.getTextMessages(message, bot);

    const stopSequence = bot.stopToken ? bot.stopToken : "\n[";

    // Here, stopSequences are defined but not used. In TS it's better to include the type for clarity if used
    let stopSequences: string[] = [stopSequence, "\n\n"];

    try {
      const response = await OpenAI.getInstance(bot).completions.create({
        model: bot.model,
        prompt: messages,
        temperature: 0.6,
        stop: stopSequences,
      });

      let filteredMsg = response.choices[0].text;

      filteredMsg = filteredMsg.includes(">: ")
        ? filteredMsg.substring(filteredMsg.indexOf(">: ") + 2)
        : filteredMsg;

      return {
        response: filteredMsg
      }
    } catch (error) {
      console.error("Error making the API request", error);
      return {
        response: ""
      }
    }
  }
}

export default OpenAITextEngine;
