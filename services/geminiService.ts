
import { GoogleGenAI, Type } from "@google/genai";
import { AnalysisResult } from "../types.ts";

/**
 * 安全地获取 API Key
 */
const getApiKey = (): string | undefined => {
  try {
    // 优先尝试标准 process.env
    if (typeof process !== 'undefined' && process.env && process.env.API_KEY) {
      return process.env.API_KEY;
    }
  } catch (e) {}
  
  // 尝试全局 window 注入
  return (window as any).process?.env?.API_KEY;
};

export async function analyzeFgoSpriteSheet(
  base64Image: string,
  mimeType: string,
  useFlash: boolean = false
): Promise<AnalysisResult> {
  const apiKey = getApiKey();
  
  if (!apiKey || apiKey === "undefined" || apiKey === "") {
    throw new Error("API_KEY_MISSING: 检测到 API_KEY 未配置。请在 Vercel Settings -> Environment Variables 中添加 API_KEY (大写) 并重新执行 Redeploy；或者点击右上角‘配置 API 环境’按钮。");
  }

  // 每次调用时重新初始化
  const ai = new GoogleGenAI({ apiKey: apiKey });
  
  // 根据参数选择模型，默认优先使用 Pro 提高准确度
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
3. "patches": Array of individual bounding boxes for each separate expression variation (small rectangles).

Rules:
- Coordinates: [0, 1000] normalized.
- Return ONLY valid JSON.`,
          },
        ],
      },
      config: {
        // Flash 模型不支持过高的 thinkingBudget
        ...(useFlash ? {} : { thinkingConfig: { thinkingBudget: 2048 } }),
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

    const text = response.text;
    if (!text) throw new Error("AI 响应为空");

    const cleanedText = text.replace(/```json/g, "").replace(/```/g, "").trim();
    return JSON.parse(cleanedText) as AnalysisResult;
  } catch (error: any) {
    // 如果是模型不可用（例如 Pro 没权限），自动切换到 Flash 重试
    if (!useFlash && (error.message?.includes("not found") || error.message?.includes("404") || error.message?.includes("permission"))) {
      console.warn("Pro model failed, retrying with Flash model...");
      return analyzeFgoSpriteSheet(base64Image, mimeType, true);
    }
    throw error;
  }
}
