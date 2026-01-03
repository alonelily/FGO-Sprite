import { GoogleGenAI, Type } from "@google/genai";
import { AnalysisResult } from "../types.ts";

export async function analyzeFgoSpriteSheet(
  base64Image: string,
  mimeType: string
): Promise<AnalysisResult> {
  // 初始化 AI 客户端
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
          text: `这是 FGO 的立绘素材图。请识别：
1. "mainBody": 完整的身体立绘所在的矩形。
2. "mainFace": 身体立绘上原本的面部/头部区域（用于对齐）。
3. "patches": 图片下方排列的所有表情差分小图。
请使用 [0, 1000] 的相对坐标系返回 JSON。`,
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
}