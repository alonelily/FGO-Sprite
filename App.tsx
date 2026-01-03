import React, { useState, useRef, useEffect, useCallback } from 'react';
import { analyzeFgoSpriteSheet } from './services/geminiService.ts';
import { AnalysisResult, Rect, Calibration } from './types.ts';

declare global {
  interface AIStudio {
    hasSelectedApiKey: () => Promise<boolean>;
    openSelectKey: () => Promise<void>;
  }
  interface Window {
    aistudio?: AIStudio;
    process?: { env: { [key: string]: string | undefined } };
  }
}

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
  const [showGuide, setShowGuide] = useState(false);
  const [hasApiKey, setHasApiKey] = useState<boolean>(true);

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

  // 稳健检查 API Key 是否存在
  const checkApiKey = useCallback(async () => {
    let exists = false;
    try {
      // 1. 检查环境变量
      const envKey = (window as any).process?.env?.API_KEY || (typeof process !== 'undefined' ? process.env.API_KEY : null);
      if (envKey && envKey !== "undefined" && envKey !== "") {
        exists = true;
      }
      // 2. 检查 AI Studio 环境
      if (!exists && window.aistudio) {
        exists = await window.aistudio.hasSelectedApiKey();
      }
    } catch (e) {}
    setHasApiKey(exists);
    return exists;
  }, []);

  useEffect(() => {
    checkApiKey();
    const interval = setInterval(checkApiKey, 3000);
    return () => clearInterval(interval);
  }, [checkApiKey]);

  const handleOpenConfig = async () => {
    if (window.aistudio) {
      await window.aistudio.openSelectKey();
      setHasApiKey(true);
      setErrorMessage(null);
    } else {
      setShowGuide(true);
    }
  };

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
      setErrorMessage(error.message || "分析同步失败");
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
        link.download = `fgo_export_${idx + 1}.png`;
        link.href = exportCanvas.toDataURL(mimeType);
        link.click();
      }
      await new Promise(r => setTimeout(r, 250));
    }
  };

  return (
    <div className="h-screen bg-[#020617] text-slate-100 flex flex-col overflow-hidden">
      <header className="h-14 border-b border-blue-500/20 bg-[#0a0f1e]/90 backdrop-blur flex items-center justify-between px-6 z-50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center font-black shadow-lg shadow-blue-500/20">F</div>
          <h1 className="fgo-font text-xs tracking-[0.2em] text-blue-400 font-bold uppercase">灵基资产提取中心</h1>
        </div>
        
        <div className="flex items-center gap-4">
           <button 
             onClick={handleOpenConfig}
             className={`px-3 py-1 rounded text-[10px] font-bold uppercase transition-all border ${hasApiKey ? 'border-blue-500/20 text-blue-500/50' : 'bg-amber-600 border-amber-400 text-white animate-pulse'}`}
           >
             {hasApiKey ? 'API 已链接' : '环境配置诊断'}
           </button>
           <button onClick={() => fileInputRef.current?.click()} className="text-[10px] font-bold px-3 py-1 border border-slate-700 hover:border-blue-500 rounded">上传资产</button>
        </div>
      </header>

      {showGuide && (
        <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-md flex items-center justify-center p-6">
          <div className="bg-[#0f172a] border border-blue-500/40 p-10 max-w-lg w-full rounded-xl shadow-[0_0_100px_rgba(37,99,235,0.1)] space-y-8">
            <h2 className="fgo-font text-2xl text-blue-400 font-bold uppercase tracking-widest text-center">部署诊断指南</h2>
            <div className="space-y-6 text-sm text-slate-300">
              <div className="bg-black/30 p-4 rounded border border-white/5 space-y-2">
                <p className="font-bold text-blue-300">1. 配置环境变量</p>
                <p className="text-xs opacity-70">在 Vercel Settings -> Environment Variables 添加 <b>API_KEY</b>。</p>
              </div>
              <div className="bg-black/30 p-4 rounded border border-white/5 space-y-2">
                <p className="font-bold text-amber-300">2. 执行 Redeploy (核心步骤)</p>
                <p className="text-xs opacity-70">重新部署后环境变量才会生效。Deployments -> Redeploy。</p>
              </div>
            </div>
            <button onClick={() => setShowGuide(false)} className="w-full py-4 bg-blue-600 text-white font-bold rounded-lg uppercase tracking-widest text-xs hover:bg-blue-500 transition-colors">我知道了</button>
          </div>
        </div>
      )}

      <main className="flex-1 flex overflow-hidden relative">
        {currentStep === 1 && (
          <div className="absolute inset-0 z-40 bg-[#020617] flex">
            <div className="w-1/3 flex flex-col justify-center px-12 border-r border-blue-500/10">
              <h2 className="fgo-font text-4xl font-black mb-4 text-white uppercase tracking-tighter">资产同步<br/><span className="text-blue-500">INITIATION</span></h2>
              <div className="space-y-6">
                {!baseImage ? (
                  <button onClick={() => fileInputRef.current?.click()} className="w-full py-12 border-2 border-dashed border-blue-500/20 rounded-xl hover:border-blue-500/60 hover:bg-blue-500/5 transition-all">
                    <span className="text-blue-400/80 font-bold text-xs uppercase tracking-[0.3em]">上传立绘图像</span>
                  </button>
                ) : (
                  <div className="space-y-4">
                    <button 
                      onClick={startAnalysis} 
                      className={`w-full py-5 text-white font-black tracking-[0.3em] rounded-lg shadow-2xl transition-all ${hasApiKey ? 'bg-blue-600 hover:bg-blue-500 shadow-blue-500/20' : 'bg-slate-800 opacity-50 cursor-not-allowed'}`}
                      disabled={isAnalyzing || !hasApiKey}
                    >
                      {isAnalyzing ? '正在解析...' : '启动 AI 同步'}
                    </button>
                    {isAnalyzing && (
                      <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500 shadow-[0_0_10px_#3b82f6] transition-all duration-300" style={{ width: `${analysisProgress}%` }}></div>
                      </div>
                    )}
                  </div>
                )}
                {errorMessage && (
                  <div className="p-4 bg-red-900/20 border border-red-500/40 rounded-lg">
                    <p className="font-bold text-red-500 text-[10px] uppercase mb-1">错误:</p>
                    <p className="text-[9px] text-red-300 font-mono leading-relaxed">{errorMessage}</p>
                    <button onClick={handleOpenConfig} className="mt-3 text-[9px] text-white underline font-bold uppercase">重配置 API</button>
                  </div>
                )}
              </div>
            </div>
            <div className="flex-1 bg-black/40 flex items-center justify-center p-24">
              {baseImage ? (
                <img src={baseImage} className="max-w-full max-h-full shadow-2xl border border-white/5" alt="Preview" />
              ) : (
                <div className="text-slate-800 fgo-font text-lg tracking-[1em] font-bold uppercase">Awaiting Data</div>
              )}
            </div>
          </div>
        )}

        {analysis && (
          <>
            <aside className="w-72 border-r border-blue-500/10 bg-[#070b16] flex flex-col shrink-0">
              <div className="p-4 bg-black/40 flex justify-between items-center shrink-0">
                <span className="text-[10px] font-bold text-blue-500 uppercase tracking-widest">单元库</span>
                <span className="text-[10px] font-mono text-slate-500">#{analysis.patches.length}</span>
              </div>
              <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                <div className="grid grid-cols-2 gap-3">
                  {analysis.patches.map((_, idx) => (
                    <button 
                      key={idx} 
                      onClick={() => setSelectedPatchIdx(idx)}
                      className={`aspect-square border rounded-lg overflow-hidden transition-all ${selectedPatchIdx === idx ? 'border-blue-500 bg-blue-500/10 ring-2 ring-blue-500/30' : 'border-slate-800 hover:border-slate-600 bg-black/60'}`}
                    >
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
                <button onClick={() => setCurrentStep(currentStep === 2 ? 3 : 2)} className="w-full py-4 bg-blue-600 hover:bg-blue-500 text-white font-bold text-[10px] rounded-lg shadow-xl uppercase tracking-[0.3em]">
                  {currentStep === 2 ? '准备输出' : '返回校准'}
                </button>
              </div>
            </aside>

            <section className="flex-1 relative flex flex-col bg-[#020617] overflow-hidden">
               {currentStep === 2 ? (
                 <>
                   <div className="h-10 border-b border-blue-500/10 flex items-center px-6 gap-6 bg-black/40 text-[9px] uppercase tracking-widest font-bold">
                     <span className="text-slate-500">缩放:</span>
                     <input type="range" min="0.3" max="3" step="0.1" value={workspaceZoom} onChange={e => setWorkspaceZoom(parseFloat(e.target.value))} className="w-40" />
                     <span className="text-blue-400 font-mono">{Math.round(workspaceZoom*100)}%</span>
                   </div>
                   <div ref={containerRef} className="flex-1 overflow-auto p-20" onMouseMove={handleMouseMove} onMouseUp={() => setIsDragging(false)}>
                     <div className="relative mx-auto inline-block shadow-2xl" style={{ transform: `scale(${workspaceZoom})` }}>
                        <canvas ref={previewCanvasRef} className="block" />
                        {targetFace && selectedPatchIdx !== null && (
                          <div 
                            onMouseDown={handleMouseDown} 
                            className={`absolute border-2 cursor-move bg-yellow-400/5 ${isDragging ? 'border-yellow-400' : 'border-blue-400'}`}
                            style={{ 
                              left: `${targetFace.x/10}%`, top: `${targetFace.y/10}%`, 
                              width: `${getEffectivePatch(selectedPatchIdx).w/10}%`, height: `${getEffectivePatch(selectedPatchIdx).h/10}%` 
                            }}
                          >
                            <div className="absolute -top-6 left-0 bg-blue-600 text-white px-2 py-0.5 font-bold text-[8px] uppercase">ALIGNMENT</div>
                          </div>
                        )}
                     </div>
                   </div>
                   <div className="h-28 border-t border-blue-500/10 bg-[#0a0f1e] flex items-center px-10 gap-16 shrink-0 z-50">
                      <div className="space-y-2">
                        <label className="text-[9px] text-blue-500 uppercase font-black block">偏移量 X/Y</label>
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
                 <div className="flex-1 flex flex-col items-center justify-center p-12 space-y-8">
                   <div className="max-w-xl w-full bg-slate-900 border border-blue-500/20 p-12 text-center rounded-xl shadow-2xl">
                     <h2 className="fgo-font text-3xl text-white font-bold uppercase tracking-widest mb-6">导出就绪</h2>
                     <div className="py-10 bg-black/40 rounded-xl border border-white/5 font-mono text-4xl text-blue-400 mb-10">
                       {analysis.patches.length} UNITS
                     </div>
                     <button onClick={downloadAll} className="w-full py-5 bg-green-600 hover:bg-green-500 text-white font-black tracking-[0.5em] rounded uppercase text-xs">执行批量导出</button>
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
