
import { GoogleGenAI, Type } from "@google/genai";
import { AnalysisResult, Rect } from "../types.ts";

export async function analyzeFgoSpriteSheet(
  base64Image: string,
  mimeType: string
): Promise<{ analysis: AnalysisResult; gridHint: any }> {
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
          text: `You are an expert image analyzer for Fate/Grand Order (FGO) sprite sheets. 
Analyze this image and return a JSON object:
1. "mainBody": The bounding box of the full character sprite.
2. "mainFace": The precise bounding box of the face area on the main body.
3. "gridInfo": The layout of the small expression patches at the bottom. Include:
   - "startX", "startY": The top-left corner of the first patch.
   - "cellW", "cellH": The width and height of a single patch.
   - "cols", "rows": Number of columns and rows of patches.
   - "paddingX", "paddingY": Horizontal and vertical spacing between patches.

Use a 0-1000 relative coordinate system for all X, Y, W, H values.`,
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
            properties: { x: {type: Type.NUMBER}, y: {type: Type.NUMBER}, w: {type: Type.NUMBER}, h: {type: Type.NUMBER} },
            required: ["x", "y", "w", "h"]
          },
          mainFace: {
            type: Type.OBJECT,
            properties: { x: {type: Type.NUMBER}, y: {type: Type.NUMBER}, w: {type: Type.NUMBER}, h: {type: Type.NUMBER} },
            required: ["x", "y", "w", "h"]
          },
          gridInfo: {
            type: Type.OBJECT,
            properties: {
              startX: {type: Type.NUMBER}, startY: {type: Type.NUMBER},
              cellW: {type: Type.NUMBER}, cellH: {type: Type.NUMBER},
              cols: {type: Type.NUMBER}, rows: {type: Type.NUMBER},
              paddingX: {type: Type.NUMBER}, paddingY: {type: Type.NUMBER}
            },
            required: ["startX", "startY", "cellW", "cellH", "cols", "rows"]
          }
        },
        required: ["mainFace", "mainBody", "gridInfo"]
      }
    }
  });

  const data = JSON.parse(response.text);
  
  // 生成 patches 数组供兼容旧逻辑
  const patches: Rect[] = [];
  const g = data.gridInfo;
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      patches.push({
        x: g.startX + c * (g.cellW + (g.paddingX || 0)),
        y: g.startY + r * (g.cellH + (g.paddingY || 0)),
        w: g.cellW,
        h: g.cellH
      });
    }
  }

  return {
    analysis: {
      mainBody: data.mainBody,
      mainFace: data.mainFace,
      patches: patches
    },
    gridHint: g
  };
}
