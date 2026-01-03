
import { GoogleGenAI, Type } from "@google/genai";
import { AnalysisResult } from "../types.ts";

/**
 * 极其稳健的 API Key 获取方式
 */
const getApiKey = (): string | undefined => {
  // 1. 尝试直接从全局 process 对象获取 (Node/Vercel 环境)
  try {
    if (typeof process !== 'undefined' && process.env?.API_KEY) {
      return process.env.API_KEY;
    }
  } catch (e) {}

  // 2. 尝试从 window.process 获取 (部分构建工具注入)
  try {
    const winProcess = (window as any).process;
    if (winProcess?.env?.API_KEY) {
      return winProcess.env.API_KEY;
    }
  } catch (e) {}

  // 3. 尝试从 Vite/ESM 常见的 import.meta.env 获取
  try {
    const metaEnv = (import.meta as any).env;
    if (metaEnv?.API_KEY || metaEnv?.VITE_API_KEY) {
      return metaEnv.API_KEY || metaEnv.VITE_API_KEY;
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
  
  if (!apiKey || apiKey === "undefined" || apiKey === "") {
    throw new Error("API_KEY_NOT_FOUND: 无法读取到 API_KEY。请确保在 Vercel 项目设置中添加了名为 API_KEY 的环境变量，并执行了 Redeploy。");
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
            text: `You are a specialized FGO Sprite Analyst.
Task: Detect coordinates for an FGO sprite sheet.
1. "mainBody": Bounding box of the full portrait (body + head).
2. "mainFace": Precise bounding box of the facial feature region (eyes/nose/mouth) ON the main body.
3. "patches": Array of individual bounding boxes for each separate expression variation.
Coordinates: [0, 1000] normalized. Return ONLY valid JSON.`,
          },
        ],
      },
      config: {
        ...(useFlash ? {} : { thinkingConfig: { thinkingBudget: 2048 } }),
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            mainBody: {
              type: Type.OBJECT,
              properties: {
                x: { type: Type.NUMBER }, y: { type: Type.NUMBER }, w: { type: Type.NUMBER }, h: { type: Type.NUMBER },
              },
              required: ["x", "y", "w", "h"]
            },
            mainFace: {
              type: Type.OBJECT,
              properties: {
                x: { type: Type.NUMBER }, y: { type: Type.NUMBER }, w: { type: Type.NUMBER }, h: { type: Type.NUMBER },
              },
              required: ["x", "y", "w", "h"]
            },
            patches: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  x: { type: Type.NUMBER }, y: { type: Type.NUMBER }, w: { type: Type.NUMBER }, h: { type: Type.NUMBER },
                },
                required: ["x", "y", "w", "h"]
              }
            }
          },
          required: ["mainFace", "mainBody", "patches"]
        }
      }
    });

    const text = response.text;
    if (!text) throw new Error("AI 响应为空");
    return JSON.parse(text) as AnalysisResult;
  } catch (error: any) {
    if (!useFlash && (error.message?.includes("404") || error.message?.includes("not found"))) {
      return analyzeFgoSpriteSheet(base64Image, mimeType, true);
    }
    throw error;
  }
}
