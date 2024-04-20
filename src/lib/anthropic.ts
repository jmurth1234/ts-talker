import AnthropicClient, { ClientOptions } from "@anthropic-ai/sdk";

import { Bot } from "payload/generated-types";

// Define the Singleton class
class Anthropic {
  private static clients: Map<string, AnthropicClient> = new Map();

  public static getInstance(bot?: Partial<Bot>): AnthropicClient {
    const apiKey = bot?.apiKey || process.env.ANTHROPIC_API_KEY;
    const endpointUrl = bot?.endpointUrl;
    const key = `${apiKey}_${endpointUrl || "default"}`;

    if (!this.clients.has(key)) {
      const options: ClientOptions = { apiKey: apiKey };
      if (endpointUrl) {
        options.baseURL = endpointUrl;
      }
      const client = new AnthropicClient(options);
      this.clients.set(key, client);
    }
    return this.clients.get(key);
  }
}

export default Anthropic;
