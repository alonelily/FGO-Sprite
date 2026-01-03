
import { GoogleGenAI, Type } from "@google/genai";
import { AnalysisResult } from "../types.ts";

export async function analyzeFgoSpriteSheet(
  base64Image: string,
  mimeType: string
): Promise<AnalysisResult> {
  // 按照规范直接从环境变量获取 API_KEY
  // Vercel 部署时请确保在项目设置的 Environment Variables 中添加了 API_KEY
  const apiKey = process.env.API_KEY;
  
  if (!apiKey) {
    throw new Error("API Key is missing. Please configure it in your deployment environment.");
  }

  const ai = new GoogleGenAI({ apiKey: apiKey });
  
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
          1. "mainBody": The bounding box [x, y, w, h] of the complete character portrait (the largest single image, usually at the top/center).
          2. "mainFace": The exact bounding box of the head/face region WITHIN that mainBody.
          3. "patches": A list of bounding boxes for each separate expression fragment (eyes, mouths) found in the sheet.
          
          CRITICAL:
          - Use [0, 1000] normalized coordinates.
          - Ensure "mainFace" is inside "mainBody".
          - Return ONLY valid JSON.`,
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

  const text = response.text;
  if (!text) {
    throw new Error("Empty response from AI");
  }

  try {
    // 清洗逻辑：去除可能存在的 Markdown 代码块标签
    const cleanedText = text.replace(/```json/g, "").replace(/```/g, "").trim();
    const data = JSON.parse(cleanedText);
    return data as AnalysisResult;
  } catch (e) {
    console.error("Parsing error:", e, "Raw text:", text);
    throw new Error("Failed to parse sprite coordinates from AI response");
  }
}
