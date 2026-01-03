
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
  
  // Calibration State
  const [calibration, setCalibration] = useState<Calibration>({ offsetX: 0, offsetY: 0, scale: 1.0 });
  const [targetFace, setTargetFace] = useState<Rect | null>(null);
  const [overlayOpacity, setOverlayOpacity] = useState(1.0);
  const [enableMask, setEnableMask] = useState(true);
  
  // Workspace Zoom
  const [workspaceZoom, setWorkspaceZoom] = useState(1.0);

  // Master Dimensions
  const [useMasterSize, setUseMasterSize] = useState(true);
  const [masterSize, setMasterSize] = useState({ w: 100, h: 100 });

  // Drag Logic
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
          setAnalysisProgress(0);
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    }
  };

  const startAnalysis = async () => {
    if (!baseImage || !imgElement) return;
    setIsAnalyzing(true);
    setAnalysisProgress(10);
    
    const progressInterval = setInterval(() => {
      setAnalysisProgress(prev => (prev < 90 ? prev + 5 : prev));
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
    } catch (error) {
      alert("智能扫描失败，请检查图片格式。");
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
      <header className="h-16 border-b border-blue-500/20 bg-[#0a0f1e]/90 backdrop-blur flex items-center justify-between px-8 shrink-0 z-50">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-blue-600 rounded flex items-center justify-center shadow-[0_0_15px_rgba(37,99,235,0.5)]">
            <span className="fgo-font font-black text-xl text-white">D</span>
          </div>
          <div>
            <h1 className="fgo-font text-sm tracking-[0.4em] text-blue-400 font-bold uppercase">灵基资产提取中心</h1>
            <p className="text-[8px] text-blue-300/40 tracking-widest font-mono uppercase">Master Workshop v5.0</p>
          </div>
        </div>
        <div className="flex items-center gap-12">
          {[1, 2, 3].map((step) => (
            <div key={step} className={`flex items-center gap-3 transition-opacity ${currentStep >= step ? 'opacity-100' : 'opacity-30'}`}>
              <div className={`w-6 h-6 rounded-full border flex items-center justify-center text-[10px] font-bold ${currentStep === step ? 'bg-blue-600 border-blue-400' : 'border-slate-500'}`}>
                {step}
              </div>
              <span className="text-[10px] font-bold tracking-widest uppercase">{step === 1 ? '导入' : step === 2 ? '校准' : '导出'}</span>
            </div>
          ))}
        </div>
        <button onClick={() => fileInputRef.current?.click()} className="text-[10px] font-bold px-4 py-2 border border-blue-500/40 hover:bg-blue-600 rounded">重新载入</button>
      </header>

      <main className="flex-1 flex overflow-hidden relative">
        {currentStep === 1 && (
          <div className="absolute inset-0 z-50 bg-[#020617] flex">
            <div className="w-1/3 flex flex-col justify-center px-12 border-r border-blue-500/10">
              <h2 className="fgo-font text-4xl font-black mb-6 tracking-tighter text-white">灵基同步<br/><span className="text-blue-500">INITIATE</span></h2>
              <p className="text-xs text-slate-400 mb-10 leading-relaxed uppercase tracking-widest">请选择标准的 FGO 立绘资产图像进行面部差分提取。AI 将自动识别主要身体、面部区域以及表情切片。</p>
              
              <div className="space-y-6">
                {!baseImage ? (
                  <button onClick={() => fileInputRef.current?.click()} className="w-full py-6 border-2 border-dashed border-blue-500/30 rounded-lg hover:border-blue-500 hover:bg-blue-500/5 transition-all group">
                    <span className="text-blue-400 font-bold text-sm tracking-widest group-hover:text-blue-300">载入资产图像文件</span>
                  </button>
                ) : (
                  <div className="space-y-4">
                    {!isAnalyzing ? (
                      <button onClick={startAnalysis} className="w-full py-5 bg-blue-600 hover:bg-blue-500 text-white font-black tracking-[0.3em] rounded shadow-2xl transition-all">开始同步扫描</button>
                    ) : (
                      <div className="space-y-4">
                         <div className="flex justify-between items-end">
                            <span className="text-[10px] text-blue-400 font-mono tracking-widest animate-pulse">解析中...</span>
                            <span className="text-[10px] text-white font-mono">{analysisProgress}%</span>
                         </div>
                         <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                            <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${analysisProgress}%` }}></div>
                         </div>
                      </div>
                    )}
                    <button onClick={() => fileInputRef.current?.click()} className="w-full py-3 border border-slate-700 text-slate-500 text-[10px] font-bold tracking-widest uppercase hover:text-white hover:border-slate-500 rounded transition-all">更换图像</button>
                  </div>
                )}
              </div>
            </div>
            
            <div className="flex-1 bg-black/40 flex items-center justify-center p-20 relative overflow-hidden">
              <div className="absolute inset-0 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:24px_24px] opacity-20"></div>
              {baseImage ? (
                <div className="max-w-full max-h-full shadow-[0_0_100px_rgba(37,99,235,0.15)] border border-white/5 relative group">
                  <img src={baseImage} alt="Preview" className="max-w-full max-h-[75vh] block" />
                  <div className="absolute top-4 left-4 bg-black/80 px-3 py-1 text-[8px] font-mono border border-blue-500/30 text-blue-400 uppercase tracking-widest">
                    Source Matrix Preview
                  </div>
                </div>
              ) : (
                <div className="text-center opacity-20">
                  <div className="w-40 h-40 border border-dashed border-slate-500 rounded-full flex items-center justify-center mx-auto mb-6">
                    <span className="text-6xl font-thin">+</span>
                  </div>
                  <p className="fgo-font text-lg tracking-widest uppercase">Waiting for Data Input</p>
                </div>
              )}
            </div>
          </div>
        )}

        <aside className="w-80 border-r border-blue-500/10 bg-[#070b16] flex flex-col z-40 shrink-0 h-full overflow-hidden shadow-2xl">
          <div className="flex-[5] flex flex-col overflow-hidden border-b border-blue-500/10">
            <div className="p-4 bg-black/40 flex justify-between items-center shrink-0">
              <h3 className="text-[10px] font-bold text-blue-500 tracking-widest uppercase">差分单元快照</h3>
              {analysis && <span className="text-[10px] font-mono text-blue-400 bg-blue-900/30 px-2 rounded">#{analysis.patches.length}</span>}
            </div>
            <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
              {analysis && (
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
                      <button 
                        onClick={(e) => { e.stopPropagation(); downloadSingle(idx); }}
                        className="absolute top-1 right-1 p-1.5 bg-green-600 hover:bg-green-500 rounded-sm opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
                        title="导出当前表情"
                      >
                        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex-[4] p-4 bg-black/60 flex flex-col overflow-y-auto border-b border-blue-500/10 custom-scrollbar shrink-0">
             <div className="flex items-center justify-between mb-4">
                <h4 className="text-[10px] font-bold text-blue-400 uppercase tracking-widest">全局抓取控制</h4>
                <div className="flex items-center gap-2">
                  <span className="text-[8px] text-slate-500 uppercase">统一尺寸</span>
                  <input type="checkbox" checked={useMasterSize} onChange={e => setUseMasterSize(e.target.checked)} className="accent-blue-500" />
                </div>
             </div>
             
             {useMasterSize && (
               <div className="space-y-4 mb-6">
                 <div className="space-y-1">
                   <div className="flex justify-between text-[8px] text-slate-500 font-mono uppercase"><span>全局宽度 (W)</span><span>{Math.round(masterSize.w)}</span></div>
                   <input type="range" min="1" max="500" step="0.5" value={masterSize.w} onChange={e => setMasterSize({...masterSize, w: parseFloat(e.target.value)})} className="w-full h-1 accent-blue-600" />
                 </div>
                 <div className="space-y-1">
                   <div className="flex justify-between text-[8px] text-slate-500 font-mono uppercase"><span>全局高度 (H)</span><span>{Math.round(masterSize.h)}</span></div>
                   <input type="range" min="1" max="500" step="0.5" value={masterSize.h} onChange={e => setMasterSize({...masterSize, h: parseFloat(e.target.value)})} className="w-full h-1 accent-blue-600" />
                 </div>
               </div>
             )}

             {analysis && selectedPatchIdx !== null && (
               <div className="space-y-4">
                 <div className="flex justify-between items-center">
                    <h5 className="text-[8px] font-bold text-slate-500 uppercase">单元微调 (#{selectedPatchIdx + 1})</h5>
                    <button onClick={() => downloadSingle(selectedPatchIdx)} className="text-[7px] text-green-400 border border-green-400/30 px-2 py-0.5 rounded hover:bg-green-400 hover:text-black transition-colors">导出单个</button>
                 </div>
                 {!useMasterSize && (
                   <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                     {['x', 'y', 'w', 'h'].map(k => (
                       <div key={k} className="space-y-1">
                         <span className="text-[7px] text-slate-600 font-mono uppercase block">{k}</span>
                         <input type="range" min="0" max="1000" step="1" 
                           value={analysis.patches[selectedPatchIdx][k as keyof Rect]} 
                           onChange={e => {
                             const newPatches = [...analysis.patches];
                             newPatches[selectedPatchIdx] = { ...newPatches[selectedPatchIdx], [k]: parseInt(e.target.value) };
                             setAnalysis({ ...analysis, patches: newPatches });
                           }} 
                           className="w-full h-1 accent-slate-600" />
                       </div>
                     ))}
                   </div>
                 )}
               </div>
             )}
          </div>

          <div className="p-4 bg-blue-900/10 shrink-0">
            <button 
              onClick={() => setCurrentStep(currentStep === 2 ? 3 : 2)}
              className="w-full py-4 bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold rounded shadow-xl tracking-[0.4em] uppercase transition-all"
              disabled={!analysis}
            >
              {currentStep === 2 ? '确认导出队列 →' : '返回同步校准'}
            </button>
          </div>
        </aside>

        <section className="flex-1 relative flex flex-col bg-[#020617] overflow-hidden">
          {currentStep !== 3 ? (
            <>
              <div className="h-10 bg-black/40 border-b border-blue-500/10 flex items-center justify-between px-6 shrink-0 z-10">
                 <div className="flex items-center gap-4">
                    <span className="text-[9px] text-slate-500 uppercase tracking-widest font-bold">工作区缩放</span>
                    <input type="range" min="0.2" max="5" step="0.1" value={workspaceZoom} onChange={e => setWorkspaceZoom(parseFloat(e.target.value))} className="w-32 h-1 accent-blue-500" />
                    <span className="text-[9px] font-mono text-blue-400">{Math.round(workspaceZoom * 100)}%</span>
                    <button onClick={() => setWorkspaceZoom(1.0)} className="text-[8px] bg-slate-800 px-2 py-0.5 rounded text-slate-400 hover:text-white transition-colors">100%</button>
                 </div>
                 {imgElement && (
                   <div className="text-[9px] font-mono text-slate-600">
                     DIM: {imgElement.naturalWidth} x {imgElement.naturalHeight} | UNIT: {selectedPatchIdx !== null ? `${Math.round(getEffectivePatch(selectedPatchIdx).w)}x${Math.round(getEffectivePatch(selectedPatchIdx).h)}` : 'N/A'}
                   </div>
                 )}
              </div>

              <div 
                ref={containerRef} 
                className="flex-1 relative overflow-auto bg-[radial-gradient(#1e293b_1.5px,transparent_1.5px)] [background-size:32px_32px] p-24"
                onMouseMove={handleMouseMove} 
                onMouseUp={() => setIsDragging(false)} 
                onMouseLeave={() => setIsDragging(false)}
              >
                <div 
                  className="relative mx-auto inline-block transition-transform origin-center"
                  style={{ transform: `scale(${workspaceZoom})` }}
                >
                  {baseImage && (
                    <div className="relative shadow-[0_0_120px_rgba(0,0,0,0.9)] border border-blue-900/20 bg-black">
                      <canvas ref={previewCanvasRef} className="block h-auto" />
                      {targetFace && selectedPatchIdx !== null && (
                        <div 
                          onMouseDown={handleMouseDown} 
                          className={`absolute border-2 cursor-move group transition-all ${isDragging ? 'border-yellow-400 bg-yellow-400/20 shadow-[0_0_20px_rgba(250,204,21,0.4)]' : 'border-blue-400/60 hover:border-yellow-400/80 hover:bg-yellow-400/5'}`}
                          style={{ 
                            left: `${targetFace.x / 10}%`, 
                            top: `${targetFace.y / 10}%`, 
                            width: `${getEffectivePatch(selectedPatchIdx).w / 10}%`, 
                            height: `${getEffectivePatch(selectedPatchIdx).h / 10}%` 
                          }}
                        >
                          <div className="absolute -top-6 left-0 bg-blue-600 text-[9px] font-bold px-2 py-0.5 rounded-t whitespace-nowrap shadow-lg uppercase">面部对齐参考 (SYNCED)</div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {analysis && (
                <div className="h-32 border-t border-blue-500/20 bg-[#0a0f1e]/95 backdrop-blur flex items-center px-10 gap-16 shrink-0 z-50">
                  <div className="space-y-2">
                    <label className="text-[9px] font-bold text-blue-400 tracking-widest uppercase block">精细位移 (OFFSET)</label>
                    <div className="flex gap-8">
                      <div className="space-y-1">
                        <div className="flex justify-between text-[7px] font-mono text-slate-500"><span>X-PX</span><span>{calibration.offsetX}</span></div>
                        <input type="range" min="-300" max="300" value={calibration.offsetX} onChange={e => setCalibration(c => ({...c, offsetX: parseInt(e.target.value)}))} className="w-32 h-1 accent-blue-500" />
                      </div>
                      <div className="space-y-1">
                        <div className="flex justify-between text-[7px] font-mono text-slate-500"><span>Y-PX</span><span>{calibration.offsetY}</span></div>
                        <input type="range" min="-300" max="300" value={calibration.offsetY} onChange={e => setCalibration(c => ({...c, offsetY: parseInt(e.target.value)}))} className="w-32 h-1 accent-blue-500" />
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[9px] font-bold text-blue-400 tracking-widest uppercase block">全局缩放 (SCALE)</label>
                    <div className="flex items-center gap-4">
                      <input type="range" min="0.5" max="2" step="0.01" value={calibration.scale} onChange={e => setCalibration(c => ({...c, scale: parseFloat(e.target.value)}))} className="w-32 h-1 accent-blue-500" />
                      <button onClick={() => setCalibration(c => ({...c, scale: 1.0}))} className="text-[7px] px-2 py-1 bg-blue-900/40 border border-blue-500/30 text-blue-300 rounded">1.0X</button>
                    </div>
                  </div>
                  <div className="flex-1 flex flex-col justify-center gap-2 pl-8 border-l border-slate-800">
                     <div className="flex items-center gap-3">
                        <input type="checkbox" id="mask" checked={enableMask} onChange={e => setEnableMask(e.target.checked)} className="accent-blue-500 w-2.5 h-2.5" />
                        <label htmlFor="mask" className="text-[9px] text-slate-400 font-bold cursor-pointer uppercase">清除底层面部纹理</label>
                     </div>
                     <div className="flex items-center gap-3">
                        <input type="range" min="0" max="1" step="0.1" value={overlayOpacity} onChange={e => setOverlayOpacity(parseFloat(e.target.value))} className="w-20 h-1 accent-blue-500" />
                        <span className="text-[7px] text-slate-600 uppercase">混合深度: {Math.round(overlayOpacity * 100)}%</span>
                     </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-12 space-y-8 bg-[radial-gradient(#0f172a_2px,transparent_2px)] [background-size:40px_40px]">
              <div className="w-full max-w-2xl bg-slate-900/60 border border-blue-500/20 backdrop-blur-xl rounded-sm p-12 text-center shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-0.5 bg-blue-500 opacity-50 shadow-[0_0_10px_#3b82f6]"></div>
                <div className="mb-6 inline-flex items-center justify-center p-4 rounded-full bg-blue-500/10 border border-blue-500/20">
                  <svg className="w-10 h-10 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                </div>
                <h2 className="fgo-font text-3xl font-bold text-white mb-2 tracking-tighter uppercase">同步导出就绪</h2>
                <p className="text-slate-400 text-[10px] mb-8 tracking-[0.4em] uppercase italic">ALL VARIANTS PROCESSED SUCCESSFULLY</p>
                <div className="grid grid-cols-2 gap-4 mb-10">
                  <div className="bg-black/60 p-8 rounded border border-white/5 shadow-inner">
                    <span className="text-[10px] text-blue-500 block mb-1 uppercase tracking-widest font-bold">总计待导出项</span>
                    <span className="text-5xl font-mono text-white tracking-tighter">{analysis?.patches.length}</span>
                  </div>
                  <div className="bg-black/60 p-8 rounded border border-white/5 shadow-inner flex flex-col justify-center">
                    <span className="text-[10px] text-blue-500 block mb-1 uppercase tracking-widest font-bold">导出模式</span>
                    <span className="text-sm font-mono text-white italic tracking-widest uppercase">{useMasterSize ? 'Fixed Matrix' : 'Free Variant'}</span>
                  </div>
                </div>
                <div className="flex flex-col gap-4 items-center">
                  <button onClick={downloadAll} className="w-full max-w-sm py-5 bg-green-600 hover:bg-green-500 text-white font-bold tracking-[1.2em] rounded shadow-xl transition-all text-xs uppercase flex items-center justify-center pl-[1.2em]">立即开始批量导出</button>
                  <button onClick={() => setCurrentStep(2)} className="text-[10px] text-slate-500 hover:text-white uppercase tracking-widest transition-colors font-bold">返回校准修改</button>
                </div>
              </div>
            </div>
          )}
        </section>
      </main>

      <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept="image/*" />
      
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 3px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #1e3a8a; border-radius: 4px; }
        .fgo-font { font-family: 'Cinzel', serif; }
      `}</style>
    </div>
  );
};

export default App;
