require("dotenv").config();

import express from "express";
import payload from "payload";

// Require the necessary discord.js classes
import { Client, Events, GatewayIntentBits, REST } from "discord.js";
import { setupCommands } from "./commands";
import { setupMessageHandling } from "./messages";

const token = process.env.DISCORD_TOKEN;

const app = express();

// Redirect root to Admin panel
app.get("/", (_, res) => {
  res.redirect("/admin");
});

const start = async () => {
  // Initialize Payload
  await payload.init({
    secret: process.env.PAYLOAD_SECRET,
    express: app,
    onInit: async () => {
      payload.logger.info(`Payload Admin URL: ${payload.getAdminURL()}`);
    },
  });

  // Create a new client instance
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.MessageContent,
    ],
  });

  const rest = new REST().setToken(token);

  // When the client is ready, run this code (only once)
  // We use 'c' for the event parameter to keep it separate from the already defined 'client'
  client.once(Events.ClientReady, (c) => {
    console.log(`Ready! Logged in as ${c.user.tag}`);
  });

  // Log in to Discord with your client's token
  client.login(token);

  await setupCommands(client, rest, payload);
  await setupMessageHandling(client, payload);

  app.listen(3000);
};

start();
