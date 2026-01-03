import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { scanSpriteSheet, autoAlignTemplate } from './services/cvService.ts';
import { AnalysisResult, Rect, Calibration } from './types.ts';

type WorkflowStep = 'LAYOUT' | 'SIZE' | 'ALIGN';

interface PatchOffset {
  dx: number;
  dy: number;
}

const PatchPreview: React.FC<{ 
  img: HTMLImageElement; 
  patch: Rect; 
  toRawPx: (v: number) => number;
  anchor: Rect; 
  onAnchorChange: (r: Rect) => void;
  isAlignStep: boolean;
  onExportCurrent: () => void;
}> = ({ img, patch, toRawPx, anchor, onAnchorChange, isAlignStep, onExportCurrent }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (!canvasRef.current || !img) return;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;
    
    const sw = toRawPx(patch.w), sh = toRawPx(patch.h);
    const sx = toRawPx(patch.x), sy = toRawPx(patch.y);
    
    canvasRef.current.width = 600;
    canvasRef.current.height = 600;
    ctx.clearRect(0, 0, 600, 600);
    
    const renderScale = 560 / Math.max(sw, sh);
    const rw = sw * renderScale, rh = sh * renderScale;
    const ox = (600 - rw) / 2, oy = (600 - rh) / 2;
    
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, sx, sy, sw, sh, ox, oy, rw, rh);

    if (isAlignStep) {
        ctx.strokeStyle = '#a855f7';
        ctx.lineWidth = 4;
        ctx.setLineDash([12, 6]);
        const ax = ox + (anchor.x / 1000) * rw;
        const ay = oy + (anchor.y / 1000) * rh;
        const aw = (anchor.w / 1000) * rw;
        const ah = (anchor.h / 1000) * rh;
        ctx.strokeRect(ax, ay, aw, ah);
        ctx.fillStyle = 'rgba(168, 85, 247, 0.25)';
        ctx.fillRect(ax, ay, aw, ah);
    }
  }, [img, patch, toRawPx, anchor, isAlignStep]);

  const handlePointer = (e: React.MouseEvent) => {
    if (!canvasRef.current || !isAlignStep) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const pxX = (e.clientX - rect.left) * (600 / rect.width);
    const pxY = (e.clientY - rect.top) * (600 / rect.height);

    const sw = toRawPx(patch.w), sh = toRawPx(patch.h);
    const renderScale = 560 / Math.max(sw, sh);
    const rw = sw * renderScale, rh = sh * renderScale;
    const ox = (600 - rw) / 2, oy = (600 - rh) / 2;

    const normX = ((pxX - ox) / rw) * 1000;
    const normY = ((pxY - oy) / rh) * 1000;
    
    onAnchorChange({
        ...anchor,
        x: Math.max(0, Math.min(1000 - anchor.w, normX - anchor.w/2)),
        y: Math.max(0, Math.min(1000 - anchor.h, normY - anchor.h/2))
    });
  };

  return (
    <div className="relative aspect-square w-full bg-slate-950 rounded-2xl border border-white/10 shadow-2xl overflow-hidden group">
        <canvas 
            ref={canvasRef} 
            onMouseDown={(e) => { setIsDragging(true); handlePointer(e); }}
            onMouseMove={(e) => isDragging && handlePointer(e)}
            onMouseUp={() => setIsDragging(false)}
            onMouseLeave={() => setIsDragging(false)}
            className="w-full h-full cursor-crosshair" 
        />
        <div className="absolute top-4 right-4 z-10">
           <button onClick={onExportCurrent} className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-black text-[10px] shadow-2xl transition-all active:scale-95 group/btn">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              <span>导出当前</span>
           </button>
        </div>
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-purple-600/90 backdrop-blur-md rounded-full text-[9px] font-black text-white shadow-xl pointer-events-none uppercase border border-white/20">
          Match Anchor
        </div>
    </div>
  );
};

const App: React.FC = () => {
  const [baseImage, setBaseImage] = useState<string | null>(null);
  const [imgElement, setImgElement] = useState<HTMLImageElement | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isAligning, setIsAligning] = useState(false);
  const [alignProgress, setAlignProgress] = useState(0);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [workspaceZoom, setWorkspaceZoom] = useState(0.4);
  const [currentStep, setCurrentStep] = useState<WorkflowStep>('LAYOUT');
  const [previewAlpha, setPreviewAlpha] = useState(0.6);
  
  const toRawPx = useCallback((val: number) => {
    if (!imgElement) return 0;
    return (val / 1000) * imgElement.naturalWidth;
  }, [imgElement]);

  const [anchorRect, setAnchorRect] = useState<Rect>({ x: 400, y: 100, w: 200, h: 120 });
  const [gridConfig, setGridConfig] = useState({
    originX: 200, originY: 850,
    spacingX: 180, spacingY: 180,
    patchW: 180, patchH: 180,
    cols: 4, rows: 2
  });

  const [calibration, setCalibration] = useState<Calibration>({ offsetX: 0, offsetY: 0, scale: 1.0 });
  const [patchOffsets, setPatchOffsets] = useState<PatchOffset[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const processFile = async (file: File) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64 = e.target?.result as string;
      setBaseImage(base64);
      setAnalysis(null);
      setImgElement(null);
      setPatchOffsets([]);
      const img = new Image();
      img.onload = async () => {
        setImgElement(img);
        setIsScanning(true);
        const res = await scanSpriteSheet(img);
        // 初始导出范围：全宽，高度到表情网格前
        res.mainBody = { x: 0, y: res.mainBody.y, w: 1000, h: 780 };
        setAnalysis(res);
        setIsScanning(false);
      };
      img.src = base64;
    };
    reader.readAsDataURL(file);
  };

  const currentPatches = useMemo(() => {
    const ps: Rect[] = [];
    for (let r = 0; r < gridConfig.rows; r++) {
      for (let c = 0; c < gridConfig.cols; c++) {
        const cx = gridConfig.originX + c * gridConfig.spacingX;
        const cy = gridConfig.originY + r * gridConfig.spacingY;
        ps.push({ x: cx - gridConfig.patchW / 2, y: cy - gridConfig.patchH / 2, w: gridConfig.patchW, h: gridConfig.patchH });
      }
    }
    return ps;
  }, [gridConfig]);

  useEffect(() => {
    if (patchOffsets.length !== currentPatches.length) {
      setPatchOffsets(new Array(currentPatches.length).fill({ dx: 0, dy: 0 }));
    }
  }, [currentPatches.length]);

  const getCompositeCoords = useCallback((idx: number) => {
    if (!analysis || !currentPatches[idx] || !imgElement) return null;
    const p = currentPatches[idx];
    const f = analysis.mainFace;
    const off = patchOffsets[idx] || { dx: 0, dy: 0 };

    const sw = toRawPx(p.w), sh = toRawPx(p.h);
    const sx = toRawPx(p.x), sy = toRawPx(p.y);
    
    const tx = toRawPx(f.x) + toRawPx(off.dx) + toRawPx(calibration.offsetX);
    const ty = toRawPx(f.y) + toRawPx(off.dy) + toRawPx(calibration.offsetY);
    const tw = sw * calibration.scale;
    const th = sh * calibration.scale;

    return { sx, sy, sw, sh, tx, ty, tw, th };
  }, [analysis, currentPatches, calibration, patchOffsets, toRawPx, imgElement]);

  const handleBatchAutoAlign = async () => {
    if (!imgElement || !analysis || currentPatches.length === 0) return;
    setIsAligning(true);
    setAlignProgress(0);
    
    const face = analysis.mainFace;
    const newOffsets = [...patchOffsets];

    for (let i = 0; i < currentPatches.length; i++) {
      setSelectedIdx(i);
      setAlignProgress(Math.round((i / currentPatches.length) * 100));
      
      const patch = currentPatches[i];
      const result = await autoAlignTemplate(
        imgElement,
        { sx: toRawPx(patch.x), sy: toRawPx(patch.y), sw: toRawPx(patch.w), sh: toRawPx(patch.h) },
        { tx: toRawPx(face.x), ty: toRawPx(face.y), tw: toRawPx(face.w), th: toRawPx(face.h) },
        { 
            ax: (anchorRect.x / 1000) * toRawPx(patch.w), 
            ay: (anchorRect.y / 1000) * toRawPx(patch.h), 
            aw: (anchorRect.w / 1000) * toRawPx(patch.w), 
            ah: (anchorRect.h / 1000) * toRawPx(patch.h) 
        },
        calibration.scale
      );
      
      newOffsets[i] = {
        dx: (result.dx / imgElement.naturalWidth) * 1000,
        dy: (result.dy / imgElement.naturalWidth) * 1000
      };
      
      setPatchOffsets([...newOffsets]);
      await new Promise(r => setTimeout(r, 20));
    }
    setIsAligning(false);
    setAlignProgress(100);
  };

  const draw = useCallback(() => {
    if (!imgElement || !canvasRef.current || !analysis) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(imgElement, 0, 0);

    const coords = getCompositeCoords(selectedIdx);
    if (coords) {
      ctx.save();
      ctx.globalAlpha = currentStep === 'ALIGN' ? previewAlpha : 1.0;
      ctx.drawImage(imgElement, coords.sx, coords.sy, coords.sw, coords.sh, coords.tx, coords.ty, coords.tw, coords.th);
      ctx.restore();

      if (currentStep === 'ALIGN') {
        const f = analysis.mainFace;
        ctx.strokeStyle = '#f97316';
        ctx.setLineDash([15 / workspaceZoom, 10 / workspaceZoom]);
        ctx.lineWidth = 3 / workspaceZoom;
        ctx.strokeRect(toRawPx(f.x), toRawPx(f.y), toRawPx(f.w), toRawPx(f.h));
        
        const ax = coords.tx + (anchorRect.x / 1000) * coords.tw;
        const ay = coords.ty + (anchorRect.y / 1000) * coords.th;
        const aw = (anchorRect.w / 1000) * coords.tw;
        const ah = (anchorRect.h / 1000) * coords.th;
        ctx.setLineDash([]);
        ctx.strokeStyle = '#a855f7';
        ctx.lineWidth = 4 / workspaceZoom;
        ctx.strokeRect(ax, ay, aw, ah);
      }
    }

    if (currentStep === 'LAYOUT') {
       const b = analysis.mainBody;
       ctx.strokeStyle = '#4f46e5';
       ctx.setLineDash([]);
       ctx.lineWidth = 6 / workspaceZoom;
       ctx.strokeRect(toRawPx(b.x), toRawPx(b.y), toRawPx(b.w), toRawPx(b.h));
       ctx.fillStyle = 'rgba(79, 70, 229, 0.08)';
       ctx.fillRect(toRawPx(b.x), toRawPx(b.y), toRawPx(b.w), toRawPx(b.h));
       
       // 绘制裁剪辅助文字
       ctx.fillStyle = '#4f46e5';
       ctx.font = `bold ${24/workspaceZoom}px sans-serif`;
       ctx.fillText("EXPORT AREA (ALL PARTS)", toRawPx(b.x) + 10, toRawPx(b.y) + 30/workspaceZoom);
    }
  }, [imgElement, selectedIdx, analysis, currentStep, workspaceZoom, getCompositeCoords, toRawPx, anchorRect, previewAlpha]);

  useEffect(() => {
    if (imgElement && canvasRef.current) {
      canvasRef.current.width = imgElement.naturalWidth;
      canvasRef.current.height = imgElement.naturalHeight;
      draw();
    }
  }, [imgElement, draw]);

  useEffect(() => { draw(); }, [draw, gridConfig, calibration, patchOffsets, analysis]);

  const performExport = (idx: number) => {
    if (!imgElement || !analysis) return;
    const b = analysis.mainBody;
    const bw = Math.max(1, Math.floor(toRawPx(b.w))); 
    const bh = Math.max(1, Math.floor(toRawPx(b.h)));
    const bx = Math.floor(toRawPx(b.x)); 
    const by = Math.floor(toRawPx(b.y));

    const c = document.createElement('canvas');
    c.width = bw; c.height = bh;
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.drawImage(imgElement, bx, by, bw, bh, 0, 0, bw, bh);
      const coords = getCompositeCoords(idx);
      if (coords) {
        const rtx = Math.round(coords.tx - bx);
        const rty = Math.round(coords.ty - by);
        ctx.clearRect(rtx, rty, Math.round(coords.tw), Math.round(coords.th));
        ctx.drawImage(imgElement, coords.sx, coords.sy, coords.sw, coords.sh, rtx, rty, Math.round(coords.tw), Math.round(coords.th));
      }
      const a = document.createElement('a');
      a.download = `FGO_Sprite_Var${idx+1}.png`;
      a.href = c.toDataURL('image/png');
      a.click();
    }
  };

  const handleExportAll = async () => {
    if (!imgElement || !analysis) return;
    setIsExporting(true);
    for (let i = 0; i < currentPatches.length; i++) {
      setExportProgress(Math.round(((i + 1) / currentPatches.length) * 100));
      performExport(i);
      await new Promise(r => setTimeout(r, 200));
    }
    setIsExporting(false);
  };

  const [dragTarget, setDragTarget] = useState<'ORIGIN' | 'SPACING' | 'PATCH_SIZE' | 'FACE' | 'FACE_RESIZE' | 'BODY_MOVE' | 'BODY_RESIZE' | null>(null);

  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragTarget || !imgElement || !canvasRef.current || !analysis) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 1000;
    const aspect = imgElement.naturalHeight / imgElement.naturalWidth;
    const y = ((e.clientY - rect.top) / rect.height) * (1000 * aspect);

    if (dragTarget === 'ORIGIN') {
      setGridConfig(prev => ({ ...prev, originX: x, originY: y }));
    } else if (dragTarget === 'SPACING') {
      setGridConfig(prev => ({ 
        ...prev, 
        spacingX: Math.max(5, (x - prev.originX) / (prev.cols - 1 || 1)),
        spacingY: Math.max(5, (y - prev.originY) / (prev.rows - 1 || 1))
      }));
    } else if (dragTarget === 'PATCH_SIZE') {
      setGridConfig(prev => ({ ...prev, patchW: Math.max(10, Math.abs(x - prev.originX) * 2), patchH: Math.max(10, Math.abs(y - prev.originY) * 2) }));
    } else if (dragTarget === 'FACE') {
      setAnalysis({ ...analysis, mainFace: { ...analysis.mainFace, x: x - analysis.mainFace.w/2, y: y - analysis.mainFace.h/2 } });
    } else if (dragTarget === 'FACE_RESIZE') {
      setAnalysis({ ...analysis, mainFace: { ...analysis.mainFace, w: Math.max(10, x - analysis.mainFace.x), h: Math.max(10, y - analysis.mainFace.y) } });
    } else if (dragTarget === 'BODY_MOVE') {
      setAnalysis({ ...analysis, mainBody: { ...analysis.mainBody, x: x - analysis.mainBody.w/2, y: y - analysis.mainBody.h/2 } });
    } else if (dragTarget === 'BODY_RESIZE') {
      setAnalysis({ ...analysis, mainBody: { ...analysis.mainBody, w: Math.max(10, x - analysis.mainBody.x), h: Math.max(10, y - analysis.mainBody.y) } });
    }
  };

  const imgAspect = imgElement ? (imgElement.naturalHeight / imgElement.naturalWidth) : 1;

  return (
    <div className="app-window flex flex-col h-screen bg-[#03050a] text-slate-300 overflow-hidden" onMouseMove={onMouseMove} onMouseUp={() => setDragTarget(null)}>
      <header className="h-16 border-b border-white/5 bg-slate-900/95 backdrop-blur-xl flex items-center justify-between px-6 z-50 shrink-0 shadow-2xl">
        <div className="flex items-center gap-3">
           <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center font-black text-white text-xs shadow-lg">F</div>
           <h1 className="fgo-title text-indigo-100 text-lg font-black tracking-tighter">SPRITE.MASTER <span className="text-indigo-500/50 italic font-light ml-1 text-[9px] uppercase tracking-widest">v7.5 Ultimate</span></h1>
        </div>
        
        <div className="flex items-center gap-4">
           <div className="flex bg-black/40 p-1 rounded-xl border border-white/5">
              {['LAYOUT', 'SIZE', 'ALIGN'].map(s => (
                <button key={s} onClick={() => analysis && setCurrentStep(s as WorkflowStep)}
                        className={`px-4 py-1.5 rounded-lg text-[9px] font-black transition-all ${currentStep === s ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}>
                  {s === 'LAYOUT' ? '1.全域布局' : s === 'SIZE' ? '2.采样设定' : '3.精准对齐'}
                </button>
              ))}
           </div>
           <button disabled={!analysis || isExporting} onClick={handleExportAll} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-[10px] font-black shadow-xl disabled:opacity-20 transition-all text-white flex items-center gap-2">
                {isExporting ? <><div className="w-3 h-3 border-2 border-white/20 border-t-white rounded-full animate-spin"/> {exportProgress}%</> : '全自动批量提取'}
           </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <aside className="w-80 bg-[#080b12] border-r border-white/5 flex flex-col z-40 overflow-y-auto custom-scrollbar shadow-2xl">
          <div className="p-6 space-y-6">
            <div className="space-y-3">
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-500 shadow-[0_0_10px_rgba(168,85,247,0.5)]"></span> 锚点预览 & 单体下载
                </p>
                {imgElement && currentPatches[selectedIdx] && (
                    <PatchPreview 
                        img={imgElement} 
                        patch={currentPatches[selectedIdx]} 
                        toRawPx={toRawPx} 
                        anchor={anchorRect}
                        onAnchorChange={setAnchorRect}
                        isAlignStep={currentStep === 'ALIGN'}
                        onExportCurrent={() => performExport(selectedIdx)}
                    />
                )}
            </div>

            <div className="h-px bg-white/5" />

            {analysis && imgElement ? (
              <>
                {currentStep === 'LAYOUT' && (
                  <div className="space-y-4 animate-in fade-in duration-300">
                      <div className="p-4 bg-indigo-600/10 border border-indigo-500/20 rounded-2xl">
                          <p className="text-[9px] text-indigo-400 font-black uppercase mb-1">导出区域微调</p>
                          <p className="text-[10px] text-slate-400 leading-relaxed">蓝色框内即为最终导出图像内容。请调整蓝色框以确保包含披风、武器等完整部分。</p>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-slate-900/50 p-3 rounded-xl border border-white/5 transition-all">
                            <p className="text-[8px] text-slate-500 font-black uppercase mb-1">网格列数</p>
                            <input type="number" value={gridConfig.cols} onChange={e => setGridConfig({...gridConfig, cols: Math.max(1, parseInt(e.target.value)||1)})} className="w-full bg-transparent outline-none text-lg font-bold text-white mono" />
                        </div>
                        <div className="bg-slate-900/50 p-3 rounded-xl border border-white/5 transition-all">
                            <p className="text-[8px] text-slate-500 font-black uppercase mb-1">网格行数</p>
                            <input type="number" value={gridConfig.rows} onChange={e => setGridConfig({...gridConfig, rows: Math.max(1, parseInt(e.target.value)||1)})} className="w-full bg-transparent outline-none text-lg font-bold text-white mono" />
                        </div>
                      </div>
                  </div>
                )}

                {currentStep === 'ALIGN' && (
                  <div className="space-y-5 animate-in fade-in duration-300">
                    <button onClick={handleBatchAutoAlign} disabled={isAligning}
                      className="w-full py-4 bg-gradient-to-br from-orange-600 to-red-600 hover:from-orange-500 hover:to-red-500 disabled:opacity-30 text-white rounded-2xl text-[10px] font-black shadow-xl transition-all flex flex-col items-center justify-center gap-1 group relative overflow-hidden border border-white/10">
                      {isAligning ? (
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                          <span>物理对齐中: {alignProgress}%</span>
                        </div>
                      ) : (
                        <>
                          <span className="text-xs font-black">运行物理像素引擎</span>
                          <span className="text-[8px] opacity-70 uppercase tracking-widest">Pixel Master v7.5</span>
                        </>
                      )}
                      {isAligning && (
                        <div className="absolute bottom-0 left-0 h-1 bg-white/40" style={{width: `${alignProgress}%`}}></div>
                      )}
                    </button>

                    <div className="space-y-3 pt-2">
                        <div className="flex items-center justify-between">
                            <p className="text-[9px] font-black text-slate-500 uppercase">层叠对比强度</p>
                            <span className="text-indigo-400 mono text-[9px] font-bold">{Math.round(previewAlpha * 100)}%</span>
                        </div>
                        <input type="range" min={0} max={1} step={0.01} value={previewAlpha} onChange={e=>setPreviewAlpha(parseFloat(e.target.value))} className="w-full h-1" />

                        <div className="flex items-center justify-between mt-2">
                            <p className="text-[9px] font-black text-slate-500 uppercase">全局缩放偏差</p>
                            <span className="text-orange-400 mono text-[9px] font-bold">{(calibration.scale * 100).toFixed(1)}%</span>
                        </div>
                        <input type="range" min={0.5} max={1.5} step={0.005} value={calibration.scale} onChange={e=>setCalibration({...calibration, scale: parseFloat(e.target.value)})} className="w-full h-1" />
                    </div>
                  </div>
                )}
              </>
            ) : null}

            <div className="pt-4 border-t border-white/5">
              <p className="text-[9px] font-black text-slate-500 uppercase mb-4">序列索引 (点击切换)</p>
              <div className="grid grid-cols-2 gap-3 pb-10">
                {imgElement && currentPatches.map((p, i) => (
                  <div key={i} onClick={() => setSelectedIdx(i)} className={`relative aspect-square rounded-xl border-2 overflow-hidden cursor-pointer transition-all ${selectedIdx === i ? 'border-indigo-500 bg-indigo-500/10 shadow-lg scale-95' : 'border-white/5 opacity-40 hover:opacity-100 hover:border-white/20'}`}>
                     <div className={`absolute top-1.5 left-1.5 text-[8px] px-1.5 py-0.5 rounded-md z-10 mono font-black ${selectedIdx === i ? 'bg-indigo-600 text-white' : 'bg-black/80 text-white'}`}>{i+1}</div>
                     <canvas width={150} height={150} ref={(el) => {
                        if (!el || !imgElement) return;
                        const ctx = el.getContext('2d');
                        if (!ctx) return;
                        const sw = toRawPx(p.w), sh = toRawPx(p.h);
                        const sx = toRawPx(p.x), sy = toRawPx(p.y);
                        const scale = 130 / Math.max(sw, sh);
                        ctx.drawImage(imgElement, sx, sy, sw, sh, (150-sw*scale)/2, (150-sh*scale)/2, sw*scale, sh*scale);
                     }} className="w-full h-full object-contain" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </aside>

        <main className="flex-1 relative bg-[#010204] overflow-hidden">
          <div className="absolute top-6 left-1/2 -translate-x-1/2 flex items-center gap-6 bg-slate-900/90 backdrop-blur-2xl px-6 py-2.5 rounded-2xl border border-white/10 z-40 shadow-2xl">
            <button onClick={() => setWorkspaceZoom(z => Math.max(0.05, z - 0.1))} className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-white rounded-lg transition-all font-bold text-lg">－</button>
            <div className="flex flex-col items-center min-w-[80px]">
              <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Zoom</span>
              <span className="text-sm font-black text-white mono">{Math.round(workspaceZoom * 100)}%</span>
            </div>
            <button onClick={() => setWorkspaceZoom(z => Math.min(4, z + 0.1))} className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-white rounded-lg transition-all font-bold text-lg">＋</button>
          </div>

          <div className="h-full overflow-auto p-40 custom-scrollbar main-canvas-area scroll-smooth">
            {!baseImage ? (
              <div className="h-full flex flex-col items-center justify-center gap-8">
                 <div onClick={() => fileInputRef.current?.click()} className="w-56 h-56 border-2 border-dashed border-slate-800 rounded-[4rem] flex items-center justify-center text-6xl cursor-pointer hover:border-indigo-500 transition-all duration-700 hover:bg-indigo-500/5 group shadow-[0_0_100px_rgba(79,70,229,0.1)]">
                    <span className="group-hover:scale-110 transition-transform duration-500 text-slate-800 group-hover:text-indigo-500">＋</span>
                 </div>
                 <div className="text-center">
                    <p className="text-sm font-black tracking-[0.4em] uppercase text-slate-700 animate-pulse">Select Sprite Sheet</p>
                 </div>
              </div>
            ) : (!imgElement || isScanning) ? (
              <div className="h-full flex flex-col items-center justify-center">
                 <div className="w-12 h-12 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                 <p className="mt-6 text-[9px] font-black tracking-widest text-indigo-400 uppercase">Analyzing Image Modality...</p>
              </div>
            ) : (
              <div className="relative mx-auto shadow-2xl transition-transform duration-300" style={{ transform: `scale(${workspaceZoom})`, transformOrigin: 'top center', width: imgElement.naturalWidth }}>
                <canvas ref={canvasRef} className="block border border-white/5 bg-transparent" />
                <div className="absolute inset-0 pointer-events-none">
                   {analysis && (
                     <>
                        {currentStep === 'LAYOUT' && (
                          <>
                             <div onMouseDown={() => setDragTarget('ORIGIN')} className="absolute w-24 h-24 flex items-center justify-center pointer-events-auto cursor-move" style={{ left: `${gridConfig.originX/10}%`, top: `${(gridConfig.originY/10)/imgAspect}%`, transform: 'translate(-50%, -50%)' }}>
                               <div className="w-8 h-8 rounded-full bg-indigo-600 border-4 border-white shadow-[0_0_20px_rgba(79,70,229,0.5)]"></div>
                             </div>
                             <div onMouseDown={() => setDragTarget('SPACING')} className="absolute w-24 h-24 flex items-center justify-center pointer-events-auto cursor-nwse-resize" style={{ left: `${(gridConfig.originX + (gridConfig.cols-1)*gridConfig.spacingX)/10}%`, top: `${((gridConfig.originY + (gridConfig.rows-1)*gridConfig.spacingY)/10)/imgAspect}%`, transform: 'translate(-50%, -50%)' }}>
                               <div className="w-8 h-8 rounded-xl bg-emerald-600 border-4 border-white shadow-[0_0_20px_rgba(16,185,129,0.5)]"></div>
                             </div>
                             
                             {/* 全自由度 Export Area 编辑 */}
                             <div onMouseDown={() => setDragTarget('BODY_MOVE')} className="absolute border-4 border-indigo-500/50 bg-indigo-500/5 pointer-events-auto cursor-move shadow-2xl" style={{ left: `${analysis.mainBody.x/10}%`, top: `${(analysis.mainBody.y/10)/imgAspect}%`, width: `${analysis.mainBody.w/10}%`, height: `${(analysis.mainBody.h/10)/imgAspect}%` }}>
                                <div onMouseDown={(e) => { e.stopPropagation(); setDragTarget('BODY_RESIZE'); }} className="absolute -bottom-4 -right-4 w-10 h-10 bg-white border-4 border-indigo-600 rounded-full cursor-nwse-resize shadow-xl flex items-center justify-center">
                                   <div className="w-4 h-4 bg-indigo-600 rounded-sm" />
                                </div>
                             </div>
                          </>
                        )}
                        {currentStep === 'SIZE' && (
                          <div onMouseDown={() => setDragTarget('PATCH_SIZE')} className="absolute w-24 h-24 flex items-center justify-center pointer-events-auto cursor-nwse-resize" style={{ left: `${(gridConfig.originX + gridConfig.patchW/2)/10}%`, top: `${((gridConfig.originY + gridConfig.patchH/2)/10)/imgAspect}%`, transform: 'translate(-50%, -50%)' }}>
                            <div className="w-8 h-8 bg-blue-500 border-4 border-white shadow-[0_0_20px_rgba(59,130,246,0.5)]"></div>
                          </div>
                        )}
                        {currentStep === 'ALIGN' && (
                          <div onMouseDown={() => setDragTarget('FACE')} className="absolute border-4 border-orange-500 bg-orange-500/10 pointer-events-auto cursor-move shadow-[0_0_50px_rgba(249,115,22,0.3)]" style={{ left: `${analysis.mainFace.x/10}%`, top: `${(analysis.mainFace.y/10)/imgAspect}%`, width: `${analysis.mainFace.w/10}%`, height: `${(analysis.mainFace.h/10)/imgAspect}%` }}>
                             <div className="absolute -top-10 left-0 whitespace-nowrap px-4 py-1.5 bg-orange-600 text-[10px] font-black text-white rounded-xl uppercase shadow-xl border border-white/20">ROI Match Target</div>
                             <div onMouseDown={(e) => { e.stopPropagation(); setDragTarget('FACE_RESIZE'); }} className="absolute -bottom-4 -right-4 w-8 h-8 bg-white border-4 border-orange-500 rounded-full cursor-nwse-resize shadow-xl hover:scale-110 transition-transform" />
                          </div>
                        )}
                     </>
                   )}
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
      <input type="file" ref={fileInputRef} onChange={e => e.target.files?.[0] && processFile(e.target.files[0])} className="hidden" accept="image/*" />
    </div>
  );
};

export default App;