import { Rect, AnalysisResult } from "../types.ts";

/**
 * 本地计算机视觉核心 - 初始扫描
 */
export async function scanSpriteSheet(
  img: HTMLImageElement
): Promise<AnalysisResult> {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas context failed");

  // 统一以 1000 像素宽度作为内部逻辑基准
  const baseWidth = 1000;
  const scale = baseWidth / img.naturalWidth;
  canvas.width = baseWidth;
  canvas.height = img.naturalHeight * scale;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const { width, height } = canvas;

  let rowDensity = new Array(Math.floor(height)).fill(0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 20) rowDensity[y]++;
    }
  }

  let minY = 0;
  for (let y = 0; y < height * 0.4; y++) {
    if (rowDensity[y] > 10) { minY = y; break; }
  }

  return {
    mainBody: { x: 0, y: (minY / baseWidth) * 1000, w: 1000, h: (height / baseWidth) * 1000 },
    mainFace: { x: 350, y: 150, w: 300, h: 300 }, // 默认给一个较大的 ROI，让用户调整
    patches: []
  };
}

/**
 * 局部特征对齐引擎 v7.0 (Strict Pixel Alignment)
 */
export async function autoAlignTemplate(
  img: HTMLImageElement,
  patchRectPx: {sx: number, sy: number, sw: number, sh: number},
  targetRectPx: {tx: number, ty: number, tw: number, th: number},
  anchorInPatchPx: {ax: number, ay: number, aw: number, ah: number}, 
  targetScale: number
): Promise<{dx: number, dy: number}> {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { dx: 0, dy: 0 };

  // 1. 提取模板（锚点紫色框）
  // 必须按照目标缩放比例调整模板大小，否则无法匹配
  const tplW = Math.max(1, Math.round(anchorInPatchPx.aw * targetScale));
  const tplH = Math.max(1, Math.round(anchorInPatchPx.ah * targetScale));
  
  canvas.width = tplW;
  canvas.height = tplH;
  ctx.drawImage(
    img, 
    patchRectPx.sx + anchorInPatchPx.ax, 
    patchRectPx.sy + anchorInPatchPx.ay, 
    anchorInPatchPx.aw, 
    anchorInPatchPx.ah, 
    0, 0, tplW, tplH
  );
  const tplData = ctx.getImageData(0, 0, tplW, tplH).data;

  // 2. 提取搜索区域（ROI橙色框）
  const searchX = Math.floor(targetRectPx.tx);
  const searchY = Math.floor(targetRectPx.ty);
  const searchW = Math.floor(targetRectPx.tw);
  const searchH = Math.floor(targetRectPx.th);
  
  canvas.width = searchW;
  canvas.height = searchH;
  ctx.drawImage(img, searchX, searchY, searchW, searchH, 0, 0, searchW, searchH);
  const searchData = ctx.getImageData(0, 0, searchW, searchH).data;

  let minDiff = Infinity;
  let bestX = 0; 
  let bestY = 0;

  // 搜索范围：确保模板完全在搜索区域内滑动
  const limitX = searchW - tplW;
  const limitY = searchH - tplH;

  if (limitX < 0 || limitY < 0) {
      console.warn("ROI 区域小于锚点区域，无法对齐。");
      return { dx: 0, dy: 0 };
  }

  // 3. 执行 SAD (Sum of Absolute Differences) 匹配
  for (let dy = 0; dy <= limitY; dy++) {
    for (let dx = 0; dx <= limitX; dx++) {
      let diff = 0;
      let weight = 0;

      // 跳行采样提高性能
      for (let py = 0; py < tplH; py += 2) {
        for (let px = 0; px < tplW; px += 2) {
          const tIdx = (py * tplW + px) * 4;
          const alpha = tplData[tIdx + 3];
          
          if (alpha > 40) {
            const sIdx = ((py + dy) * searchW + (px + dx)) * 4;
            // 简单颜色差异
            const d = Math.abs(tplData[tIdx] - searchData[sIdx]) +
                      Math.abs(tplData[tIdx+1] - searchData[sIdx+1]) +
                      Math.abs(tplData[tIdx+2] - searchData[sIdx+2]);
            diff += d;
            weight++;
          }
        }
      }

      if (weight > 0) {
        const score = diff / weight;
        if (score < minDiff) {
          minDiff = score;
          bestX = dx;
          bestY = dy;
        }
      }
    }
    if (dy % 50 === 0) await new Promise(r => setTimeout(r, 0));
  }

  // 4. 返回偏移量
  // 我们要找的是 Patch 的 TopLeft 应该在哪
  // MatchPos = ROI_TopLeft + BestPos
  // Patch_TopLeft = MatchPos - (Anchor_In_Patch * Scale)
  // dx = Patch_TopLeft - ROI_TopLeft = BestPos - (Anchor_In_Patch * Scale)
  
  return {
    dx: bestX - (anchorInPatchPx.ax * targetScale),
    dy: bestY - (anchorInPatchPx.ay * targetScale)
  };
}
