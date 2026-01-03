
import { GoogleGenAI, Type } from "@google/genai";
import { AnalysisResult } from "../types";

export async function analyzeFgoSpriteSheet(
  base64Image: string,
  mimeType: string
): Promise<AnalysisResult> {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: {
      parts: [
        {
          inlineData: {
            data: base64Image.split(',')[1],
            mimeType: mimeType,
          },
        },
        {
          text: `You are a professional FGO asset analyst. Analyze this sprite sheet:
          1. "mainBody": The bounding box of the complete character portrait (excluding the expression fragments at the bottom).
          2. "mainFace": The exact bounding box of the face within that mainBody.
          3. "patches": A list of bounding boxes for each expression fragment found at the bottom.
          
          CRITICAL INSTRUCTIONS:
          - For "patches", ensure each box COMPLETELY encompasses the expression feature (eyes, mouth, etc.). 
          - It is better to include a few extra pixels of transparent space than to cut through an eye or mouth detail.
          - Return as JSON with coordinates in [0, 1000] normalized format.`,
        },
      ],
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          mainBody: {
            type: Type.OBJECT,
            properties: {
              x: { type: Type.NUMBER },
              y: { type: Type.NUMBER },
              w: { type: Type.NUMBER },
              h: { type: Type.NUMBER },
            },
            required: ["x", "y", "w", "h"]
          },
          mainFace: {
            type: Type.OBJECT,
            properties: {
              x: { type: Type.NUMBER },
              y: { type: Type.NUMBER },
              w: { type: Type.NUMBER },
              h: { type: Type.NUMBER },
            },
            required: ["x", "y", "w", "h"]
          },
          patches: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                x: { type: Type.NUMBER },
                y: { type: Type.NUMBER },
                w: { type: Type.NUMBER },
                h: { type: Type.NUMBER },
              },
              required: ["x", "y", "w", "h"]
            }
          }
        },
        required: ["mainFace", "mainBody", "patches"]
      }
    }
  });

  try {
    const data = JSON.parse(response.text || '{}');
    return data as AnalysisResult;
  } catch (e) {
    throw new Error("Failed to parse sprite coordinates");
  }
}
