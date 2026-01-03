
import { GoogleGenAI, Type } from "@google/genai";
import { AnalysisResult } from "../types.ts";

export async function analyzeFgoSpriteSheet(
  base64Image: string,
  mimeType: string,
  useFlash: boolean = false
): Promise<AnalysisResult> {
  // 严格遵循 SDK 初始化规范
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const modelName = useFlash ? 'gemini-3-flash-preview' : 'gemini-3-pro-preview';

  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: {
        parts: [
          {
            inlineData: {
              data: base64Image.split(',')[1],
              mimeType: mimeType,
            },
          },
          {
            text: `Detect coordinates for FGO portrait:
1. "mainBody": full body rect.
2. "mainFace": head/face area on body.
3. "patches": expression components list.
Use [0, 1000] scale. JSON output only.`,
          },
        ],
      },
      config: {
        ...(!useFlash && { thinkingConfig: { thinkingBudget: 2048 } }),
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            mainBody: {
              type: Type.OBJECT,
              properties: {
                x: { type: Type.NUMBER }, y: { type: Type.NUMBER }, w: { type: Type.NUMBER }, h: { type: Type.NUMBER }
              },
              required: ["x", "y", "w", "h"]
            },
            mainFace: {
              type: Type.OBJECT,
              properties: {
                x: { type: Type.NUMBER }, y: { type: Type.NUMBER }, w: { type: Type.NUMBER }, h: { type: Type.NUMBER }
              },
              required: ["x", "y", "w", "h"]
            },
            patches: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  x: { type: Type.NUMBER }, y: { type: Type.NUMBER }, w: { type: Type.NUMBER }, h: { type: Type.NUMBER }
                },
                required: ["x", "y", "w", "h"]
              }
            }
          },
          required: ["mainFace", "mainBody", "patches"]
        }
      }
    });

    return JSON.parse(response.text) as AnalysisResult;
  } catch (error: any) {
    if (!useFlash && (error.message?.includes("404") || error.message?.includes("not found"))) {
      return analyzeFgoSpriteSheet(base64Image, mimeType, true);
    }
    throw error;
  }
}
