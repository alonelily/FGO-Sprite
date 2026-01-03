import React, { useState, useRef, useEffect, useCallback } from 'react';
import { analyzeFgoSpriteSheet } from './services/geminiService.ts';
import { AnalysisResult, Rect, Calibration } from './types.ts';

const App: React.FC = () => {
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1); 
  const [baseImage, setBaseImage] = useState<string | null>(null);
  const [imgElement, setImgElement] = useState<HTMLImageElement | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [selectedPatchIdx, setSelectedPatchIdx] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 校准与工作区状态
  const [calibration, setCalibration] = useState<Calibration>({ offsetX: 0, offsetY: 0, scale: 1.0 });
  const [targetFace, setTargetFace] = useState<Rect | null>(null);
  const [overlayOpacity, setOverlayOpacity] = useState(1.0);
  const [workspaceZoom, setWorkspaceZoom] = useState(1.0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0, rectX: 0, rectY: 0 });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      setBaseImage(dataUrl);
      const img = new Image();
      img.onload = () => {
        setImgElement(img);
        setAnalysis(null);
        setCurrentStep(1);
        setErrorMessage(null);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  const startAnalysis = async () => {
    if (!baseImage) return;
    setErrorMessage(null);
    setIsAnalyzing(true);
    try {
      const result = await analyzeFgoSpriteSheet(baseImage, 'image/png');
      setAnalysis(result);
      setTargetFace(result.mainFace);
      if (result.patches.length > 0) setSelectedPatchIdx(0);
      setCurrentStep(2);
    } catch (err: any) {
      setErrorMessage(err.message || "同步失败。请检查 Vite Config 中的 API 注入配置。");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const renderComposite = useCallback((ctx: CanvasRenderingContext2D, patchIdx: number, isFinal: boolean = false) => {
    if (!imgElement || !targetFace || !analysis) return;
    const nw = imgElement.naturalWidth;
    const nh = imgElement.naturalHeight;
    const patch = analysis.patches[patchIdx];

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

    if (isFinal) {
      // 导出时清除面部基准区域
      ctx.clearRect((targetFace.x/1000)*nw, (targetFace.y/1000)*nh, (targetFace.w/1000)*nw, (targetFace.h/1000)*nh);
    }

    ctx.globalAlpha = isFinal ? 1.0 : overlayOpacity;
    ctx.drawImage(imgElement, pX, pY, pW, pH, tX, tY, tW, tH);
    ctx.globalAlpha = 1.0;
  }, [imgElement, targetFace, analysis, calibration, overlayOpacity]);

  useEffect(() => {
    if (!imgElement || !analysis || selectedPatchIdx === null || currentStep !== 2) return;
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
    const { mainBody: body } = analysis;
    const nw = imgElement.naturalWidth;
    const nh = imgElement.naturalHeight;
    const bW = (body.w / 1000) * nw;
    const bH = (body.h / 1000) * nh;
    const bX = (body.x / 1000) * nw;
    const bY = (body.y / 1000) * nh;

    for (let i = 0; i < analysis.patches.length; i++) {
      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = bW;
      exportCanvas.height = bH;
      const ctx = exportCanvas.getContext('2d');
      if (ctx) {
        ctx.translate(-bX, -bY);
        ctx.drawImage(imgElement, 0, 0);
        renderComposite(ctx, i, true);
        const link = document.createElement('a');
        link.download = `fgo_asset_${i + 1}.png`;
        link.href = exportCanvas.toDataURL('image/png');
        link.click();
      }
      await new Promise(r => setTimeout(r, 150));
    }
  };

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-100 overflow-hidden">
      <header className="h-14 border-b border-white/10 bg-slate-900/50 backdrop-blur flex items-center justify-between px-6 z-50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center font-bold shadow-lg shadow-blue-500/20">F</div>
          <h1 className="fgo-font text-xs tracking-[0.2em] text-blue-400 font-bold uppercase">灵基资产同步中心</h1>
        </div>
        <button onClick={() => fileInputRef.current?.click()} className="text-[10px] font-bold px-3 py-1 border border-slate-700 hover:border-blue-500 rounded transition-colors uppercase">更换目标</button>
      </header>

      <main className="flex-1 flex relative overflow-hidden">
        {currentStep === 1 && (
          <div className="absolute inset-0 z-50 bg-slate-950 flex">
            <div className="w-1/3 p-12 flex flex-col justify-center border-r border-white/5 bg-[#0a0f1e]">
              <h2 className="fgo-font text-4xl font-black mb-8 tracking-tighter uppercase">资产同步</h2>
              {!baseImage ? (
                <button onClick={() => fileInputRef.current?.click()} className="w-full py-20 border-2 border-dashed border-blue-500/20 rounded-2xl hover:border-blue-500/50 hover:bg-blue-500/5 transition-all group">
                  <span className="text-blue-400 font-bold text-xs uppercase tracking-widest group-hover:scale-110 inline-block transition-transform">请上传 FGO 素材图</span>
                </button>
              ) : (
                <div className="space-y-6">
                  <button onClick={startAnalysis} disabled={isAnalyzing} className="w-full py-5 bg-blue-600 hover:bg-blue-500 rounded-lg font-bold text-white tracking-[0.2em] shadow-xl transition-all disabled:opacity-50">
                    {isAnalyzing ? '正在解析坐标系统...' : '启动智能提取同步'}
                  </button>
                  {errorMessage && <div className="p-4 bg-red-900/20 border border-red-500/30 text-[10px] text-red-400 font-mono leading-relaxed">{errorMessage}</div>}
                </div>
              )}
            </div>
            <div className="flex-1 flex items-center justify-center p-20 bg-black/40">
              {baseImage && <img src={baseImage} className="max-w-full max-h-full shadow-2xl border border-white/5" />}
            </div>
          </div>
        )}

        {analysis && (
          <>
            <aside className="w-64 flex flex-col border-r border-white/5 bg-slate-900/40">
              <div className="p-4 border-b border-white/5 bg-black/20"><span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">差分单元库</span></div>
              <div className="flex-1 overflow-y-auto p-3 grid grid-cols-2 gap-2 custom-scrollbar">
                {analysis.patches.map((p, idx) => (
                  <button key={idx} onClick={() => setSelectedPatchIdx(idx)} className={`aspect-square border rounded-lg overflow-hidden transition-all ${selectedPatchIdx === idx ? 'border-blue-500 ring-2 ring-blue-500/20 bg-blue-500/5' : 'border-white/5 bg-black/40 hover:border-white/20'}`}>
                    <canvas className="w-full h-full object-contain" ref={el => {
                      if (!el || !imgElement) return;
                      const ctx = el.getContext('2d');
                      if (!ctx) return;
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
              <div className="p-4 border-t border-white/5 bg-slate-900/80">
                <button onClick={() => setCurrentStep(currentStep === 2 ? 3 : 2)} className="w-full py-4 bg-blue-600 hover:bg-blue-500 rounded-lg text-[11px] font-bold uppercase tracking-[0.2em] transition-all">
                  {currentStep === 2 ? '准备批量导出' : '返回对齐工作区'}
                </button>
              </div>
            </aside>

            <section className="flex-1 flex flex-col bg-slate-950">
              {currentStep === 2 ? (
                <>
                  <div className="h-10 px-6 border-b border-white/5 flex items-center gap-6 bg-slate-900/20 shrink-0">
                    <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">预览缩放:</span>
                    <input type="range" min="0.1" max="2" step="0.1" value={workspaceZoom} onChange={e => setWorkspaceZoom(parseFloat(e.target.value))} className="w-40" />
                    <span className="text-blue-400 font-mono text-[10px]">{Math.round(workspaceZoom * 100)}%</span>
                  </div>
                  <div ref={containerRef} className="flex-1 overflow-auto p-12 flex justify-center" onMouseMove={handleMouseMove} onMouseUp={() => setIsDragging(false)}>
                    <div className="relative inline-block shadow-2xl origin-top" style={{ transform: `scale(${workspaceZoom})` }}>
                      <canvas ref={previewCanvasRef} className="block" />
                      {targetFace && selectedPatchIdx !== null && (
                        <div onMouseDown={handleMouseDown} className={`absolute border-2 cursor-move ${isDragging ? 'border-yellow-400 bg-yellow-400/5' : 'border-blue-500 bg-blue-500/5'}`} style={{ left: `${targetFace.x/10}%`, top: `${targetFace.y/10}%`, width: `${analysis.patches[selectedPatchIdx].w/10}%`, height: `${analysis.patches[selectedPatchIdx].h/10}%` }}>
                          <div className="absolute -top-6 left-0 bg-blue-600 text-white px-2 py-0.5 text-[8px] font-bold uppercase whitespace-nowrap">Target Alignment</div>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="h-24 bg-slate-900/90 border-t border-white/10 px-8 flex items-center gap-12 shrink-0">
                    <div className="space-y-2">
                      <div className="text-[9px] text-blue-500 font-bold uppercase tracking-widest">偏移微调 X / Y</div>
                      <div className="flex gap-4">
                        <input type="range" min="-100" max="100" value={calibration.offsetX} onChange={e => setCalibration(c => ({...c, offsetX: parseInt(e.target.value)}))} className="w-24" />
                        <input type="range" min="-100" max="100" value={calibration.offsetY} onChange={e => setCalibration(c => ({...c, offsetY: parseInt(e.target.value)}))} className="w-24" />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="text-[9px] text-blue-500 font-bold uppercase tracking-widest">缩放修正</div>
                      <input type="range" min="0.8" max="1.2" step="0.01" value={calibration.scale} onChange={e => setCalibration(c => ({...c, scale: parseFloat(e.target.value)}))} className="w-28" />
                    </div>
                    <div className="flex-1 flex justify-end items-center gap-4">
                       <span className="text-[9px] text-slate-500 uppercase font-bold tracking-widest">覆盖层透明度</span>
                       <input type="range" min="0" max="1" step="0.1" value={overlayOpacity} onChange={e => setOverlayOpacity(parseFloat(e.target.value))} className="w-24" />
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center p-10 bg-[#020617]">
                  <div className="max-w-md w-full bg-slate-900/80 p-12 rounded-3xl border border-white/10 text-center space-y-10 backdrop-blur-xl">
                    <h2 className="fgo-font text-3xl font-bold uppercase tracking-widest">导出队列就绪</h2>
                    <div className="py-10 bg-black/40 rounded-2xl border border-white/5 flex flex-col items-center">
                      <span className="text-6xl font-black text-blue-500 mb-2">{analysis.patches.length}</span>
                      <span className="text-[10px] text-slate-500 font-bold uppercase tracking-[0.3em]">待提取单元</span>
                    </div>
                    <button onClick={downloadAll} className="w-full py-5 bg-green-600 hover:bg-green-500 rounded-xl font-bold uppercase tracking-[0.4em] text-xs shadow-2xl shadow-green-500/20 transition-all">执行批量渲染下载</button>
                    <button onClick={() => setCurrentStep(2)} className="text-[10px] text-slate-500 hover:text-white uppercase font-bold tracking-widest transition-colors">返回同步工作区进行微调</button>
                  </div>
                </div>
              )}
            </section>
          </>
        )}
      </main>

      <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept="image/*" />
    </div>
  );
};

export default App;