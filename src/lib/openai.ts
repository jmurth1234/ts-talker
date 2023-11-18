// Import dependencies
import { OpenAI as OpenAIClient } from "openai";

// Define the Singleton class
class OpenAI {
  private static instance: OpenAIClient;

  // Private constructor to prevent direct instantiation
  private static createInstance(
    apiKey: string = process.env.OPENAI_API_KEY
  ): OpenAIClient {
    return new OpenAIClient({
      apiKey: apiKey,
    });
  }

  // Static method to access the singleton instance
  public static getInstance(apiKey?: string): OpenAIClient {
    if (!OpenAI.instance) {
      OpenAI.instance = OpenAI.createInstance(apiKey);
    }
    return OpenAI.instance;
  }
}

// Export the OpenAIWrapper class
export default OpenAI;
