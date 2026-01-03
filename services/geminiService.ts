import { GoogleGenAI, Type } from "@google/genai";
import { AnalysisResult } from "../types.ts";

export async function analyzeFgoSpriteSheet(
  base64Image: string,
  mimeType: string
): Promise<AnalysisResult> {
  // 按照规范，在发起请求前创建新实例，确保使用最新的 process.env.API_KEY (由 aistudio 注入)
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
1. "mainBody": 完整的身体立绘所在的矩形（主要指上半身或全身立绘部分）。
2. "mainFace": 身体立绘上原本的面部/头部区域（用于作为差分小图的叠加定位点）。
3. "patches": 图片下方或侧边排列的所有表情差分小图（通常是方形小方块）。
请使用 [0, 1000] 的相对坐标系返回 JSON 数据。确保 patches 中的所有表情都被识别。`,
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

  if (!response.text) {
    throw new Error("AI 未返回有效数据。");
  }

  return JSON.parse(response.text) as AnalysisResult;
}