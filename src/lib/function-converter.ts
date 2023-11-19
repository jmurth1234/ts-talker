import { ChatCompletionCreateParams } from "openai/resources";
import { Function } from "payload/generated-types";

export default function convertFunction(func: Partial<Function>): ChatCompletionCreateParams.Function {
  const chatFunction: ChatCompletionCreateParams.Function = {
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
      required: func.parameters.filter((param) => param.required).map((param) => param.name),
    },
  };

  return chatFunction;
}
