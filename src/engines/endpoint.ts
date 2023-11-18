import { Message } from "discord.js";
import TextEngine from "./text";
import axios from "axios";
import { Payload } from "payload";
import { Bot } from "payload/generated-types";

class EndpointEngine extends TextEngine {
  constructor(payload: Payload) {
    super(payload);
  }

  public override async getResponse(
    message: Message,
    bot: Bot
  ): Promise<string> {
    const messages = await this.getTextMessages(message, bot);

    const stopSequence = bot.stopToken ? bot.stopToken : "\n[";

    // Here, stopSequences are defined but not used. In TS it's better to include the type for clarity if used
    let stopSequences: string[] = [stopSequence, "\n\n"];

    const data = { text: messages };
    const json = JSON.stringify(data);

    try {
      const response = await axios.post(bot.model, json, {
        headers: {
          "Content-Type": "application/json",
        },
      });

      let filteredMsg = response.data;

      // If stop sequences are going to be used for determining the end of the response it should be implemented as below:
      for (const stopSequence of stopSequences) {
        if (filteredMsg.includes(stopSequence)) {
          filteredMsg = filteredMsg.split(stopSequence)[0];
          break;
        }
      }

      filteredMsg = filteredMsg.includes("> ")
        ? filteredMsg.substring(filteredMsg.indexOf("> ") + 2)
        : filteredMsg;

      return filteredMsg;
    } catch (error) {
      console.error("Error making the API request", error);
      return "";
    }
  }
}

export default EndpointEngine;
