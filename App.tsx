
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { analyzeFgoSpriteSheet } from './services/geminiService.ts';
import { AnalysisResult, Rect, Calibration } from './types.ts';

const App: React.FC = () => {
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1); 
  const [baseImage, setBaseImage] = useState<string | null>(null);
  const [imgElement, setImgElement] = useState<HTMLImageElement | null>(null);
  const [mimeType, setMimeType] = useState<string>('image/png');
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [selectedPatchIdx, setSelectedPatchIdx] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 工作区状态
  const [calibration, setCalibration] = useState<Calibration>({ offsetX: 0, offsetY: 0, scale: 1.0 });
  const [targetFace, setTargetFace] = useState<Rect | null>(null);
  const [overlayOpacity, setOverlayOpacity] = useState(1.0);
  const [enableMask, setEnableMask] = useState(true);
  const [workspaceZoom, setWorkspaceZoom] = useState(1.0);
  const [useMasterSize, setUseMasterSize] = useState(true);
  const [masterSize, setMasterSize] = useState({ w: 100, h: 100 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0, rectX: 0, rectY: 0 });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setMimeType(file.type);
      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUrl = event.target?.result as string;
        setBaseImage(dataUrl);
        const img = new Image();
        img.onload = () => {
          setImgElement(img);
          setAnalysis(null);
          setTargetFace(null);
          setSelectedPatchIdx(null);
          setCurrentStep(1);
          setCalibration({ offsetX: 0, offsetY: 0, scale: 1.0 });
          setWorkspaceZoom(1.0);
          setErrorMessage(null);
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    }
  };

  const startAnalysis = async () => {
    if (!baseImage || !imgElement) return;
    setErrorMessage(null);
    setIsAnalyzing(true);
    setAnalysisProgress(10);
    const progressTimer = setInterval(() => setAnalysisProgress(p => p < 90 ? p + 5 : p), 600);

    try {
      const result = await analyzeFgoSpriteSheet(baseImage, mimeType);
      setAnalysis(result);
      setTargetFace(result.mainFace);
      if (result.patches.length > 0) {
        setSelectedPatchIdx(0);
        setMasterSize({ w: result.patches[0].w, h: result.patches[0].h });
      }
      setAnalysisProgress(100);
      setTimeout(() => setCurrentStep(2), 500);
    } catch (error: any) {
      setErrorMessage(error.message || "分析失败，请检查 API 配置。");
    } finally {
      clearInterval(progressTimer);
      setIsAnalyzing(false);
    }
  };

  const getEffectivePatch = useCallback((idx: number): Rect => {
    if (!analysis) return { x: 0, y: 0, w: 0, h: 0 };
    const p = analysis.patches[idx];
    if (useMasterSize) {
      return {
        x: p.x + (p.w / 2) - (masterSize.w / 2),
        y: p.y + (p.h / 2) - (masterSize.h / 2),
        w: masterSize.w, h: masterSize.h
      };
    }
    return p;
  }, [analysis, useMasterSize, masterSize]);

  const renderComposite = useCallback((ctx: CanvasRenderingContext2D, patchIdx: number, isPreview: boolean = false) => {
    if (!imgElement || !targetFace || !analysis) return;
    const { naturalWidth: nw, naturalHeight: nh } = imgElement;
    const patch = getEffectivePatch(patchIdx);
    
    const pW = (patch.w / 1000) * nw;
    const pH = (patch.h / 1000) * nh;
    const pX = (patch.x / 1000) * nw;
    const pY = (patch.y / 1000) * nh;

    const centerX = (targetFace.x + targetFace.w / 2) / 1000 * nw;
    const centerY = (targetFace.y + targetFace.h / 2) / 1000 * nh;

    const tW = pW * calibration.scale;
    const tH = pH * calibration.scale;
    const tX = (centerX - tW / 2) + calibration.offsetX;
    const tY = (centerY - tH / 2) + calibration.offsetY;

    if (enableMask && !isPreview) {
      ctx.clearRect((targetFace.x/1000)*nw, (targetFace.y/1000)*nh, (targetFace.w/1000)*nw, (targetFace.h/1000)*nh);
    }

    ctx.globalAlpha = isPreview ? 1.0 : overlayOpacity;
    ctx.drawImage(imgElement, pX, pY, pW, pH, tX, tY, tW, tH);
    ctx.globalAlpha = 1.0;
  }, [imgElement, targetFace, analysis, calibration, enableMask, overlayOpacity, getEffectivePatch]);

  useEffect(() => {
    if (!imgElement || !analysis || selectedPatchIdx === null || currentStep === 3) return;
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = imgElement.naturalWidth;
    canvas.height = imgElement.naturalHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(imgElement, 0, 0);
    renderComposite(ctx, selectedPatchIdx);
  }, [imgElement, analysis, selectedPatchIdx, currentStep, renderComposite]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!targetFace) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY, rectX: targetFace.x, rectY: targetFace.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !targetFace || !containerRef.current) return;
    const containerRect = containerRef.current.getBoundingClientRect();
    const zoomScale = (containerRect.width / 100) / workspaceZoom;
    setTargetFace({ 
      ...targetFace, 
      x: dragStart.rectX + (e.clientX - dragStart.x) / zoomScale, 
      y: dragStart.rectY + (e.clientY - dragStart.y) / zoomScale 
    });
  };

  const downloadAll = async () => {
    if (!imgElement || !analysis || !targetFace) return;
    const body = analysis.mainBody;
    const nw = imgElement.naturalWidth;
    const nh = imgElement.naturalHeight;
    const bW = (body.w / 1000) * nw;
    const bH = (body.h / 1000) * nh;
    const bX = (body.x / 1000) * nw;
    const bY = (body.y / 1000) * nh;

    for (let idx = 0; idx < analysis.patches.length; idx++) {
      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = bW;
      exportCanvas.height = bH;
      const ctx = exportCanvas.getContext('2d');
      if (ctx) {
        ctx.translate(-bX, -bY);
        ctx.drawImage(imgElement, 0, 0);
        renderComposite(ctx, idx);
        const link = document.createElement('a');
        link.download = `fgo_sprite_${idx + 1}.png`;
        link.href = exportCanvas.toDataURL(mimeType);
        link.click();
      }
      await new Promise(r => setTimeout(r, 200));
    }
  };

  return (
    <div className="h-screen bg-[#020617] text-slate-100 flex flex-col overflow-hidden">
      <header className="h-14 border-b border-blue-500/20 bg-[#0a0f1e] flex items-center justify-between px-6 z-50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center font-black">F</div>
          <h1 className="fgo-font text-xs tracking-widest text-blue-400 font-bold uppercase">灵基资产提取中心</h1>
        </div>
        <button onClick={() => fileInputRef.current?.click()} className="text-[10px] font-bold px-3 py-1 border border-slate-700 hover:border-blue-500 rounded">更换资产</button>
      </header>

      <main className="flex-1 flex overflow-hidden relative">
        {currentStep === 1 && (
          <div className="absolute inset-0 z-40 bg-[#020617] flex">
            <div className="w-1/3 flex flex-col justify-center px-12 border-r border-blue-500/10">
              <h2 className="fgo-font text-4xl font-black mb-4 text-white uppercase tracking-tighter">资产同步</h2>
              <div className="space-y-6">
                {!baseImage ? (
                  <button onClick={() => fileInputRef.current?.click()} className="w-full py-12 border-2 border-dashed border-blue-500/20 rounded-xl hover:border-blue-500/60 transition-all">
                    <span className="text-blue-400 font-bold text-xs uppercase">上传立绘资产</span>
                  </button>
                ) : (
                  <div className="space-y-4">
                    <button onClick={startAnalysis} className="w-full py-5 bg-blue-600 hover:bg-blue-500 text-white font-black tracking-widest rounded transition-all" disabled={isAnalyzing}>
                      {isAnalyzing ? '分析中...' : '启动 AI 同步'}
                    </button>
                    {isAnalyzing && (
                      <div className="h-1 w-full bg-slate-800 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${analysisProgress}%` }}></div>
                      </div>
                    )}
                  </div>
                )}
                {errorMessage && (
                  <div className="p-4 bg-red-900/20 border border-red-500/40 rounded text-[9px] text-red-300 font-mono break-all leading-normal">
                    {errorMessage}
                  </div>
                )}
              </div>
            </div>
            <div className="flex-1 bg-black/40 flex items-center justify-center p-24">
              {baseImage ? <img src={baseImage} className="max-w-full max-h-full shadow-2xl border border-white/5" alt="Preview" /> : <div className="text-slate-800 fgo-font text-lg font-bold">AWAITING DATA</div>}
            </div>
          </div>
        )}

        {analysis && (
          <>
            <aside className="w-72 border-r border-blue-500/10 bg-[#070b16] flex flex-col shrink-0">
              <div className="p-4 bg-black/40 flex justify-between items-center"><span className="text-[10px] font-bold text-blue-500 uppercase">单元库</span></div>
              <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                <div className="grid grid-cols-2 gap-3">
                  {analysis.patches.map((_, idx) => (
                    <button key={idx} onClick={() => setSelectedPatchIdx(idx)} className={`aspect-square border rounded overflow-hidden transition-all ${selectedPatchIdx === idx ? 'border-blue-500 ring-2 ring-blue-500/30' : 'border-slate-800 bg-black/60'}`}>
                      <canvas className="w-full h-full object-contain" ref={el => {
                        if (!el || !imgElement || !targetFace) return;
                        const ctx = el.getContext('2d');
                        if (!ctx) return;
                        const p = getEffectivePatch(idx);
                        const nw = imgElement.naturalWidth;
                        const nh = imgElement.naturalHeight;
                        el.width = 100; el.height = 100;
                        const scale = 100 / Math.max((p.w/1000)*nw, (p.h/1000)*nh);
                        ctx.scale(scale, scale);
                        ctx.translate(-(p.x/1000)*nw, -(p.y/1000)*nh);
                        ctx.drawImage(imgElement, 0, 0);
                      }} />
                    </button>
                  ))}
                </div>
              </div>
              <div className="p-5 bg-blue-900/10">
                <button onClick={() => setCurrentStep(currentStep === 2 ? 3 : 2)} className="w-full py-4 bg-blue-600 text-white font-bold text-[10px] rounded uppercase tracking-widest">
                  {currentStep === 2 ? '准备输出' : '返回校准'}
                </button>
              </div>
            </aside>

            <section className="flex-1 relative flex flex-col bg-[#020617] overflow-hidden">
               {currentStep === 2 ? (
                 <>
                   <div className="h-10 border-b border-blue-500/10 flex items-center px-6 gap-6 bg-black/40 text-[9px] uppercase font-bold">
                     <span className="text-slate-500">缩放:</span>
                     <input type="range" min="0.3" max="3" step="0.1" value={workspaceZoom} onChange={e => setWorkspaceZoom(parseFloat(e.target.value))} className="w-40" />
                     <span className="text-blue-400 font-mono">{Math.round(workspaceZoom*100)}%</span>
                   </div>
                   <div ref={containerRef} className="flex-1 overflow-auto p-20" onMouseMove={handleMouseMove} onMouseUp={() => setIsDragging(false)}>
                     <div className="relative mx-auto inline-block" style={{ transform: `scale(${workspaceZoom})` }}>
                        <canvas ref={previewCanvasRef} className="block" />
                        {targetFace && selectedPatchIdx !== null && (
                          <div onMouseDown={handleMouseDown} className={`absolute border-2 cursor-move bg-yellow-400/5 ${isDragging ? 'border-yellow-400' : 'border-blue-400'}`} style={{ left: `${targetFace.x/10}%`, top: `${targetFace.y/10}%`, width: `${getEffectivePatch(selectedPatchIdx).w/10}%`, height: `${getEffectivePatch(selectedPatchIdx).h/10}%` }}>
                            <div className="absolute -top-6 left-0 bg-blue-600 text-white px-2 py-0.5 font-bold text-[8px] uppercase">ALIGNMENT</div>
                          </div>
                        )}
                     </div>
                   </div>
                   <div className="h-28 border-t border-blue-500/10 bg-[#0a0f1e] flex items-center px-10 gap-16 shrink-0">
                      <div className="space-y-2">
                        <label className="text-[9px] text-blue-500 uppercase font-black block">偏移 X/Y</label>
                        <div className="flex gap-4">
                          <input type="range" min="-200" max="200" value={calibration.offsetX} onChange={e => setCalibration(c => ({...c, offsetX: parseInt(e.target.value)}))} className="w-24" />
                          <input type="range" min="-200" max="200" value={calibration.offsetY} onChange={e => setCalibration(c => ({...c, offsetY: parseInt(e.target.value)}))} className="w-24" />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-[9px] text-blue-500 uppercase font-black block">比例校正</label>
                        <input type="range" min="0.5" max="1.5" step="0.01" value={calibration.scale} onChange={e => setCalibration(c => ({...c, scale: parseFloat(e.target.value)}))} className="w-32" />
                      </div>
                      <div className="flex-1 flex items-center justify-end gap-6">
                        <div className="flex items-center gap-2">
                          <input type="checkbox" id="mask" checked={enableMask} onChange={e => setEnableMask(e.target.checked)} className="accent-blue-500" />
                          <label htmlFor="mask" className="text-[9px] text-slate-400 uppercase font-bold">底层遮罩</label>
                        </div>
                        <input type="range" min="0" max="1" step="0.1" value={overlayOpacity} onChange={e => setOverlayOpacity(parseFloat(e.target.value))} className="w-24" />
                      </div>
                   </div>
                 </>
               ) : (
                 <div className="flex-1 flex flex-col items-center justify-center p-12">
                   <div className="max-w-xl w-full bg-slate-900 border border-blue-500/20 p-12 text-center rounded-xl shadow-2xl space-y-10">
                     <h2 className="fgo-font text-3xl text-white font-bold uppercase">导出就绪</h2>
                     <div className="py-10 bg-black/40 rounded-xl border border-white/5 font-mono text-4xl text-blue-400">
                       {analysis.patches.length} UNITS
                     </div>
                     <button onClick={downloadAll} className="w-full py-5 bg-green-600 hover:bg-green-500 text-white font-black tracking-widest rounded uppercase text-xs">执行批量提取</button>
                   </div>
                 </div>
               )}
            </section>
          </>
        )}
      </main>

      <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept="image/*" />
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #1e40af; border-radius: 10px; }
        .fgo-font { font-family: 'Cinzel', serif; }
      `}</style>
    </div>
  );
};

export default App;
