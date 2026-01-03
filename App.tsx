
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
  
  // API Key 状态
  const [hasApiKey, setHasApiKey] = useState<boolean>(true);

  // 校准与工作区状态
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

  // 强化版 Key 检测
  const checkKey = useCallback(async () => {
    let keyExists = false;
    try {
      // 1. 检查环境变量 (多路径)
      const envKey = (window as any).process?.env?.API_KEY || (typeof process !== 'undefined' ? process.env.API_KEY : null);
      if (envKey && envKey !== "undefined" && envKey !== "") {
        keyExists = true;
      }
      
      // 2. 如果环境变量不存在，尝试 AI Studio 选择器
      if (!keyExists && window.aistudio) {
        keyExists = await window.aistudio.hasSelectedApiKey();
      }
    } catch (e) {
      console.warn("Key check failed", e);
    }
    
    setHasApiKey(keyExists);
    return keyExists;
  }, []);

  useEffect(() => {
    checkKey();
    const interval = setInterval(checkKey, 3000); 
    return () => clearInterval(interval);
  }, [checkKey]);

  const handleSelectKey = async () => {
    if (window.aistudio) {
      try {
        await window.aistudio.openSelectKey();
        setHasApiKey(true);
        setErrorMessage(null);
      } catch (e) {
        setErrorMessage("无法打开 AI Studio 选择器。");
      }
    } else {
      // 在非 AI Studio 环境，引导用户去 Vercel 配置
      setErrorMessage("当前环境不支持 Key 选择器。请在 Vercel 控制台的项目设置 -> Environment Variables 中添加 API_KEY，并重新部署项目。");
      window.open('https://vercel.com/docs/concepts/projects/environment-variables', '_blank');
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
          setAnalysisProgress(0);
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
    setAnalysisProgress(5);
    
    const progressInterval = setInterval(() => {
      setAnalysisProgress(prev => (prev < 90 ? prev + 2 : prev));
    }, 400);

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
      const msg = error.message || String(error);
      setErrorMessage(msg);
      setAnalysisProgress(0);
    } finally {
      clearInterval(progressInterval);
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
        w: masterSize.w,
        h: masterSize.h
      };
    }
    return p;
  }, [analysis, useMasterSize, masterSize]);

  const renderComposite = useCallback((ctx: CanvasRenderingContext2D, patchIdx: number, isPreview: boolean = false) => {
    if (!imgElement || !targetFace || !analysis) return;
    const { naturalWidth: nw, naturalHeight: nh } = imgElement;
    const patch = getEffectivePatch(patchIdx);
    
    const pX = (patch.x / 1000) * nw;
    const pY = (patch.y / 1000) * nh;
    const pW = (patch.w / 1000) * nw;
    const pH = (patch.h / 1000) * nh;

    const centerX = (targetFace.x + targetFace.w / 2) / 1000 * nw;
    const centerY = (targetFace.y + targetFace.h / 2) / 1000 * nh;

    const tW = pW * calibration.scale;
    const tH = pH * calibration.scale;
    const tX = (centerX - tW / 2) + calibration.offsetX;
    const tY = (centerY - tH / 2) + calibration.offsetY;

    if (enableMask && !isPreview) {
      const maskX = (targetFace.x / 1000) * nw;
      const maskY = (targetFace.y / 1000) * nh;
      const maskW = (targetFace.w / 1000) * nw;
      const maskH = (targetFace.h / 1000) * nh;
      ctx.clearRect(maskX, maskY, maskW, maskH);
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
    if (!targetFace || !containerRef.current) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY, rectX: targetFace.x, rectY: targetFace.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !targetFace || !containerRef.current) return;
    const containerRect = containerRef.current.getBoundingClientRect();
    setTargetFace({ 
      ...targetFace, 
      x: dragStart.rectX + (e.clientX - dragStart.x) / (containerRect.width / 100) / workspaceZoom, 
      y: dragStart.rectY + (e.clientY - dragStart.y) / (containerRect.height / 100) / workspaceZoom 
    });
  };

  const downloadSingle = async (idx: number) => {
    if (!imgElement || !analysis || !targetFace) return;
    const body = analysis.mainBody;
    const nw = imgElement.naturalWidth;
    const nh = imgElement.naturalHeight;
    const bX = (body.x / 1000) * nw;
    const bY = (body.y / 1000) * nh;
    const bW = (body.w / 1000) * nw;
    const bH = (body.h / 1000) * nh;

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
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const downloadAll = async () => {
    if (!imgElement || !analysis || !targetFace) return;
    for (let idx = 0; idx < analysis.patches.length; idx++) {
      await downloadSingle(idx);
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  };

  return (
    <div className="h-screen bg-[#020617] text-slate-100 flex flex-col overflow-hidden select-none">
      <header className="h-16 border-b border-blue-500/20 bg-[#0a0f1e]/90 backdrop-blur flex items-center justify-between px-8 shrink-0 z-50 shadow-2xl">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-blue-600 rounded flex items-center justify-center shadow-[0_0_20px_rgba(37,99,235,0.6)]">
            <span className="fgo-font font-black text-xl text-white">D</span>
          </div>
          <div>
            <h1 className="fgo-font text-sm tracking-[0.4em] text-blue-400 font-bold uppercase">灵基资产提取中心</h1>
            <p className="text-[8px] text-blue-300/40 tracking-widest font-mono uppercase">Master Workshop v5.2</p>
          </div>
        </div>
        
        <div className="flex items-center gap-8">
           {!hasApiKey && (
             <button 
               onClick={handleSelectKey}
               className="flex items-center gap-2 px-3 py-1.5 bg-amber-600/20 border border-amber-500/50 rounded hover:bg-amber-600/40 transition-all group"
             >
               <span className="w-2 h-2 bg-amber-500 rounded-full animate-pulse"></span>
               <span className="text-[10px] font-bold text-amber-200 uppercase tracking-widest">配置 API 环境</span>
             </button>
           )}
           <div className="flex items-center gap-8 border-l border-slate-800 pl-8 h-8">
              {[1, 2, 3].map((step) => (
                <div key={step} className={`flex items-center gap-3 transition-opacity ${currentStep >= step ? 'opacity-100' : 'opacity-30'}`}>
                  <div className={`w-5 h-5 rounded-full border flex items-center justify-center text-[9px] font-bold ${currentStep === step ? 'bg-blue-600 border-blue-400' : 'border-slate-500'}`}>
                    {step}
                  </div>
                  <span className="text-[9px] font-bold tracking-widest uppercase">{step === 1 ? '导入' : step === 2 ? '校准' : '导出'}</span>
                </div>
              ))}
           </div>
        </div>
        <button onClick={() => fileInputRef.current?.click()} className="text-[10px] font-bold px-4 py-2 border border-blue-500/40 hover:bg-blue-600 rounded">载入新资产</button>
      </header>

      <main className="flex-1 flex overflow-hidden relative">
        {currentStep === 1 && (
          <div className="absolute inset-0 z-50 bg-[#020617] flex">
            <div className="w-1/3 flex flex-col justify-center px-12 border-r border-blue-500/10">
              <h2 className="fgo-font text-4xl font-black mb-6 tracking-tighter text-white">灵基同步<br/><span className="text-blue-500">INITIATE</span></h2>
              <p className="text-xs text-slate-400 mb-10 leading-relaxed uppercase tracking-widest">请选择标准的 FGO 立绘资产图像。AI 将自动识别身体、面部区域及表情切片。</p>
              
              <div className="space-y-6">
                {!baseImage ? (
                  <button onClick={() => fileInputRef.current?.click()} className="w-full py-8 border-2 border-dashed border-blue-500/30 rounded-lg hover:border-blue-500 hover:bg-blue-500/5 transition-all group">
                    <span className="text-blue-400 font-bold text-sm tracking-widest group-hover:text-blue-300">载入资产图像文件</span>
                  </button>
                ) : (
                  <div className="space-y-4">
                    <button 
                      onClick={startAnalysis} 
                      className={`w-full py-5 text-white font-black tracking-[0.3em] rounded shadow-2xl transition-all ${hasApiKey ? 'bg-blue-600 hover:bg-blue-500' : 'bg-slate-800 cursor-not-allowed opacity-50'}`}
                      disabled={isAnalyzing || !hasApiKey}
                    >
                      {isAnalyzing ? '分析中...' : hasApiKey ? '开始同步扫描' : 'API KEY 未检测到'}
                    </button>
                    {isAnalyzing && (
                      <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500 transition-all duration-300 shadow-[0_0_10px_#3b82f6]" style={{ width: `${analysisProgress}%` }}></div>
                      </div>
                    )}
                  </div>
                )}
                
                {errorMessage && (
                  <div className="p-4 bg-red-900/20 border border-red-500/40 rounded">
                    <p className="text-[10px] text-red-400 font-bold uppercase mb-2">同步失败 (SYNC ERROR)</p>
                    <p className="text-[9px] text-red-300 leading-normal font-mono break-words">{errorMessage}</p>
                    <button onClick={handleSelectKey} className="mt-2 text-[8px] bg-red-500 text-white px-2 py-1 rounded font-bold uppercase">前往配置</button>
                  </div>
                )}

                {!hasApiKey && !errorMessage && (
                  <div className="p-4 bg-amber-900/20 border border-amber-500/40 rounded">
                    <p className="text-[10px] text-amber-400 font-bold uppercase mb-1">环境提示</p>
                    <p className="text-[9px] text-amber-200/80 leading-relaxed">
                      未检测到内置 API KEY。如果您在 Vercel 运行，请前往 Settings -> Environment Variables 添加 <b>API_KEY</b> 并 Redeploy。
                    </p>
                  </div>
                )}
              </div>
            </div>
            
            <div className="flex-1 bg-black/40 flex items-center justify-center p-20 relative overflow-hidden">
              <div className="absolute inset-0 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:24px_24px] opacity-20"></div>
              {baseImage ? (
                <div className="max-w-full max-h-full shadow-[0_0_100px_rgba(37,99,235,0.15)] border border-white/5 relative">
                  <img src={baseImage} alt="Preview" className="max-w-full max-h-[75vh] block" />
                </div>
              ) : (
                <div className="text-center opacity-20">
                  <p className="fgo-font text-lg tracking-widest uppercase">Waiting for Data Input</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 步骤 2 和 步骤 3 的代码保持不变，仅在 App 返回分析结果后显示 */}
        {analysis && (
          <>
            <aside className="w-80 border-r border-blue-500/10 bg-[#070b16] flex flex-col z-40 shrink-0 h-full overflow-hidden shadow-2xl">
              <div className="flex-[5] flex flex-col overflow-hidden border-b border-blue-500/10">
                <div className="p-4 bg-black/40 flex justify-between items-center shrink-0">
                  <h3 className="text-[10px] font-bold text-blue-500 tracking-widest uppercase">差分单元快照</h3>
                  <span className="text-[10px] font-mono text-blue-400 bg-blue-900/30 px-2 rounded">#{analysis.patches.length}</span>
                </div>
                <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
                  <div className="grid grid-cols-2 gap-2 pb-4">
                    {analysis.patches.map((p, idx) => (
                      <div key={idx} className="relative group">
                        <button onClick={() => setSelectedPatchIdx(idx)} className={`w-full relative rounded border transition-all aspect-square overflow-hidden ${selectedPatchIdx === idx ? 'border-blue-500 bg-blue-900/30 ring-1 ring-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.3)]' : 'border-slate-800 bg-black/40 hover:border-slate-600'}`}>
                          <div className="absolute inset-0 p-1 flex items-center justify-center">
                             <canvas className="max-w-full max-h-full object-contain" ref={el => {
                                 if (!el || !imgElement || !targetFace) return;
                                 const ctx = el.getContext('2d');
                                 if (!ctx) return;
                                 el.width = 128; el.height = 128;
                                 const nw = imgElement.naturalWidth;
                                 const nh = imgElement.naturalHeight;
                                 const effP = getEffectivePatch(idx);
                                 const scale = 128 / Math.max((effP.w/1000)*nw, (effP.h/1000)*nh);
                                 ctx.scale(scale, scale);
                                 ctx.translate(-(effP.x/1000)*nw, -(effP.y/1000)*nh);
                                 ctx.drawImage(imgElement, 0, 0);
                               }} />
                          </div>
                          <div className="absolute bottom-1 right-1 bg-black/80 text-[8px] font-mono px-1 rounded text-blue-300">#{idx+1}</div>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="p-4 bg-blue-900/10 shrink-0">
                <button 
                  onClick={() => setCurrentStep(currentStep === 2 ? 3 : 2)}
                  className="w-full py-4 bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold rounded shadow-xl tracking-[0.4em] uppercase"
                >
                  {currentStep === 2 ? '确认导出队列 →' : '返回同步校准'}
                </button>
              </div>
            </aside>
            <section className="flex-1 relative flex flex-col bg-[#020617] overflow-hidden">
               {currentStep === 2 && (
                  <div ref={containerRef} className="flex-1 relative overflow-auto p-24" onMouseMove={handleMouseMove} onMouseUp={() => setIsDragging(false)}>
                    <div className="relative mx-auto inline-block" style={{ transform: `scale(${workspaceZoom})` }}>
                      <canvas ref={previewCanvasRef} className="block shadow-[0_0_50px_rgba(0,0,0,0.8)]" />
                      {targetFace && selectedPatchIdx !== null && (
                        <div onMouseDown={handleMouseDown} className="absolute border-2 border-yellow-400 cursor-move"
                          style={{ 
                            left: `${targetFace.x / 10}%`, top: `${targetFace.y / 10}%`, 
                            width: `${getEffectivePatch(selectedPatchIdx).w / 10}%`, height: `${getEffectivePatch(selectedPatchIdx).h / 10}%` 
                          }}
                        />
                      )}
                    </div>
                  </div>
               )}
               {currentStep === 3 && (
                 <div className="flex-1 flex flex-col items-center justify-center space-y-8">
                   <h2 className="fgo-font text-3xl font-bold text-white">同步导出就绪</h2>
                   <button onClick={downloadAll} className="px-12 py-5 bg-green-600 hover:bg-green-500 text-white font-bold tracking-[0.5em] rounded">立即批量导出</button>
                 </div>
               )}
            </section>
          </>
        )}
      </main>

      <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept="image/*" />
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 3px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #1e3a8a; border-radius: 4px; }
        .fgo-font { font-family: 'Cinzel', serif; }
      `}</style>
    </div>
  );
};

export default App;
