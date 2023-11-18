import { Interaction, SlashCommandBuilder } from "discord.js";
import { Payload } from "payload";

export class Command {
  data: any;

  payload: Payload;

  constructor(payload: Payload) {
    this.payload = payload;
  }

  setup(): Command {
    throw new Error("Method not implemented.");
  }

  async execute(interaction: Interaction) {
    throw new Error("Method not implemented.");
  }
}
