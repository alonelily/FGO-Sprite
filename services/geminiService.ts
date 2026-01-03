import { GoogleGenAI, Type } from "@google/genai";
import { AnalysisResult } from "../types.ts";

/**
 * 安全地探测 API Key
 */
const getApiKey = (): string | undefined => {
  try {
    // 探测全局 process 对象是否存在且包含 API_KEY
    if (typeof process !== 'undefined' && process.env && process.env.API_KEY) {
      return process.env.API_KEY;
    }
    // 探测 window 下是否存在 process 注入
    const winProcess = (window as any).process;
    if (winProcess && winProcess.env && winProcess.env.API_KEY) {
      return winProcess.env.API_KEY;
    }
  } catch (e) {}
  return undefined;
};

export async function analyzeFgoSpriteSheet(
  base64Image: string,
  mimeType: string,
  useFlash: boolean = false
): Promise<AnalysisResult> {
  const apiKey = getApiKey();
  
  if (!apiKey || apiKey === "undefined") {
    throw new Error("API_KEY_NOT_FOUND: 无法从环境中读取 API_KEY。请检查 Vercel 的 Environment Variables 设置，并确保已进行 Redeploy。");
  }

  const ai = new GoogleGenAI({ apiKey: apiKey });
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
