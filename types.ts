
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Calibration {
  offsetX: number;
  offsetY: number;
  scale: number;
}

export interface AnalysisResult {
  mainFace: Rect;   // 身体上的面部位置
  mainBody: Rect;   // 整个立绘主体的范围 (不含下方杂项)
  patches: Rect[];  // 下方待提取的表情部件
}

export interface SpriteVariation {
  id: string;
  patchRect: Rect;
}
