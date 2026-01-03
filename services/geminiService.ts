
import { GoogleGenAI, Type } from "@google/genai";
import { AnalysisResult } from "../types.ts";

/**
 * 安全地从多个可能位置探测 API Key
 */
const getApiKey = (): string | undefined => {
  try {
    // 探测 process 变量是否定义
    if (typeof process !== 'undefined' && process.env && process.env.API_KEY) {
      return process.env.API_KEY;
    }
  } catch (e) {}

  try {
    // 检查 window.process (某些构建工具 shims)
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
    throw new Error("API_KEY_NOT_FOUND: 浏览器无法读取环境变量。请确保 Vercel 设置中 API_KEY 变量已添加，并执行了 Redeploy（重新部署）。如果是本地环境，请确保正确注入了环境变量。");
  }

  // 初始化客户端
  const ai = new GoogleGenAI({ apiKey: apiKey });
  
  // 选择模型
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

    const result = JSON.parse(response.text);
    return result as AnalysisResult;
  } catch (error: any) {
    if (!useFlash && (error.message?.includes("404") || error.message?.includes("not found"))) {
      return analyzeFgoSpriteSheet(base64Image, mimeType, true);
    }
    throw error;
  }
}
