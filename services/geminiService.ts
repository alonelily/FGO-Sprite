
import { GoogleGenAI, Type } from "@google/genai";
import { AnalysisResult } from "../types.ts";

export async function analyzeFgoSpriteSheet(
  base64Image: string,
  mimeType: string
): Promise<AnalysisResult> {
  // 必须严格从 process.env.API_KEY 获取
  const apiKey = process.env.API_KEY;
  
  if (!apiKey || apiKey === "undefined" || apiKey === "") {
    throw new Error("检测到 API_KEY 未配置。请点击右上角‘配置 API 环境’按钮，或者在 Vercel 设置中添加环境变量并 Redeploy。");
  }

  // 每次调用时重新初始化，确保使用的是最新的 API 密钥
  const ai = new GoogleGenAI({ apiKey: apiKey });
  
  // 对于坐标提取这种复杂推理任务，使用 Pro 模型精度更高
  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
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
1. "mainBody": Bounding box of the full portrait (body + head) usually the largest figure.
2. "mainFace": Precise bounding box of the facial feature region (eyes/nose/mouth) ON the main body.
3. "patches": Array of individual bounding boxes for each separate expression variation (small rectangles) usually at the bottom or side.

Rules:
- Coordinates: [0, 1000] normalized.
- Return ONLY valid JSON.
- Accuracy is paramount for the face alignment.`,
        },
      ],
    },
    config: {
      // 启用思考模式以提高坐标计算的准确性
      thinkingConfig: { thinkingBudget: 4096 },
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
  if (!text) {
    throw new Error("AI 响应为空，请重试");
  }

  try {
    const cleanedText = text.replace(/```json/g, "").replace(/```/g, "").trim();
    const data = JSON.parse(cleanedText);
    return data as AnalysisResult;
  } catch (e) {
    console.error("Parse error:", text);
    throw new Error("AI 返回的数据格式无法解析。可能该图片的布局超出了模型的当前理解范围，请尝试更换图片。");
  }
}
