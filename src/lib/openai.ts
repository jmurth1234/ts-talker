import { OpenAI as OpenAIClient, ClientOptions } from "openai";
import { Bot } from "payload/generated-types";

// Define the Singleton class
class OpenAI {
  private static clients: Map<string, OpenAIClient> = new Map();

  public static getInstance(bot?: Bot): OpenAIClient {
    const apiKey = bot?.apiKey || process.env.OPENAI_API_KEY;
    const endpointUrl = bot?.endpointUrl;
    const key = `${apiKey}_${endpointUrl || "default"}`;

    if (!this.clients.has(key)) {
      const options: ClientOptions = { apiKey: apiKey };
      if (endpointUrl) {
        options.baseURL = endpointUrl;
      }
      const client = new OpenAIClient(options);
      this.clients.set(key, client);
    }
    return this.clients.get(key);
  }
}

export default OpenAI;
