import { Tool } from "@anthropic-ai/sdk/resources/beta/tools/messages";
import { ChatCompletionTool } from "openai/resources";
import { Function } from "payload/generated-types";

export function convertOpenAIFunction(func: Partial<Function>) {
  const chatFunction: ChatCompletionTool = {
    type: "function",
    function: {
      name: func.name,
      description: func.description,
      parameters: {
        type: "object",
        properties: {
          ...func.parameters.reduce((acc, param) => {
            acc[param.name] = {
              type: param.type,
              description: param.description,
            };
            return acc;
          }, {}),
        },
        required: func.parameters
          .filter((param) => param.required)
          .map((param) => param.name),
      },
    },
  };

  return chatFunction;
}

export function convertAnthropicFunction(func: Partial<Function>) {
  const chatFunction: Tool = {
    name: func.name,
    description: func.description,
    input_schema: {
      type: "object",
      properties: {
        ...func.parameters.reduce((acc, param) => {
          acc[param.name] = {
            type: param.type,
            description: param.description,
          };
          return acc;
        }, {}),
      },
      required: func.parameters
        .filter((param) => param.required)
        .map((param) => param.name),
    },
  };

  return chatFunction;
}
