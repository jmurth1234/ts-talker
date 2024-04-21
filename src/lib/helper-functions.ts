import OpenAI from "./openai";
import memoize from "promise-memoize";
import Anthropic from "./anthropic";
import sharp from "sharp";

export const fetchImage = memoize(
  async (url: string) => {
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

    return converted;
  },
  { maxAge: 60 * 60 * 1000 }
);

export const describeImage = memoize(
  async (url: string, model: string = "claude-3-haiku-20240307") => {
    const converted = await fetchImage(url);

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
              text: "Describe the image as succinctly as possible. When doing so, compress the text in a way that fits in a tweet (ideally). This is for yourself. It should be human readable. Ensure the whole image is described. Abuse of language mixing, abbreviations, symbols, or any other encodings or internal representations is all permissible, as long as it, if pasted in a new inference cycle, will yield near-identical results as the original image.",
            },
          ],
        },
      ],
      temperature: 0,
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
      system: "Describe the following embed. When doing so, compress the text in a way that fits in a tweet (ideally) and such that you or another language model can reconstruct the intention of the human who wrote text as close as possible to the original intention. This is for yourself. It should be human readable.  Abuse of language mixing, abbreviations, symbols, or any other encodings or internal representations is all permissible, as long as it, if pasted in a new inference cycle, will yield near-identical results as the original embed",
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
        content: 'Answer the following question, add urls as much detail as possible. If you do not know the answer, you can say "I do not know". ' +
          question,
      },
    ],
    model: "sonar-medium-chat",
    max_tokens: 2047,
  });

  console.dir(response, { depth: null });

  return response.choices[0].message.content;
});
