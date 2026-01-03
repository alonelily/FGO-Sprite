import React, { useState, useRef, useEffect, useCallback } from 'react';
import { analyzeFgoSpriteSheet } from './services/geminiService.ts';
import { AnalysisResult, Rect, Calibration } from './types.ts';

const App: React.FC = () => {
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1); 
  const [baseImage, setBaseImage] = useState<string | null>(null);
  const [imgElement, setImgElement] = useState<HTMLImageElement | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [selectedPatchIdx, setSelectedPatchIdx] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 工作区状态
  const [calibration, setCalibration] = useState<Calibration>({ offsetX: 0, offsetY: 0, scale: 1.0 });
  const [targetFace, setTargetFace] = useState<Rect | null>(null);
  const [overlayOpacity, setOverlayOpacity] = useState(0.8);
  const [workspaceZoom, setWorkspaceZoom] = useState(1.0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0, rectX: 0, rectY: 0 });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const hasKey = await (window as any).aistudio.hasSelectedApiKey();
        setIsAuthorized(hasKey);
      } catch (e) {
        setIsAuthorized(false);
      }
    };
    checkAuth();
  }, []);

  const handleConnectKey = async () => {
    await (window as any).aistudio.openSelectKey();
    setIsAuthorized(true);
  };

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
      if (err.message?.includes("Requested entity was not found")) {
        setErrorMessage("API Key 权限异常。请确保您选择的是【已启用结算账户】的项目密钥。");
        setIsAuthorized(false);
      } else {
        setErrorMessage(err.message || "同步失败。请检查网络连接或尝试重新召唤 AI。");
      }
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
        link.download = `fgo_synced_sprite_${i + 1}.png`;
        link.href = exportCanvas.toDataURL('image/png');
        link.click();
      }
      await new Promise(r => setTimeout(r, 200));
    }
  };

  // 授权界面
  if (isAuthorized === false) {
    return (
      <div className="h-screen flex items-center justify-center p-6">
        <div className="max-w-md w-full glass-panel p-10 rounded-3xl text-center space-y-8 summoning-glow border-blue-500/30">
          <div className="relative mx-auto w-32 h-32 flex items-center justify-center">
             <div className="absolute inset-0 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin"></div>
             <span className="fgo-font text-4xl font-black text-blue-500">M</span>
          </div>
          <div className="space-y-3">
            <h1 className="fgo-font text-2xl font-bold tracking-widest text-white uppercase">建立灵基契约</h1>
            <p className="text-slate-400 text-xs leading-relaxed font-medium">
              欢迎来到达芬奇工房。为了启动资产同步算法，请连接您的个人 Gemini API 密钥。此密钥仅存储在您的浏览器中。
            </p>
          </div>
          <button onClick={handleConnectKey} className="w-full py-4 bg-blue-600 hover:bg-blue-500 text-white font-black rounded-xl tracking-[0.3em] text-xs transition-all shadow-lg shadow-blue-600/20">
            CONNECT API KEY
          </button>
          <div className="pt-4">
            <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" className="text-[10px] text-slate-500 hover:text-blue-400 uppercase font-bold tracking-widest transition-colors">
              需要付费项目 API Key？查看文档 ↗
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (isAuthorized === null) return <div className="h-screen flex items-center justify-center font-mono text-blue-500 animate-pulse uppercase tracking-[1em]">Establishing Connection...</div>;

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <header className="h-16 border-b border-white/10 bg-black/40 backdrop-blur-md flex items-center justify-between px-8 z-50">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-blue-600/20 border border-blue-500/50 rounded-lg flex items-center justify-center">
            <span className="fgo-font font-black text-blue-400">DA</span>
          </div>
          <div>
            <h1 className="fgo-font text-sm tracking-[0.2em] text-white font-bold leading-none mb-1 uppercase">Sprite Master</h1>
            <p className="text-[9px] text-slate-500 uppercase tracking-widest font-bold">Chaldea Asset Synchronizer</p>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <button onClick={handleConnectKey} className="text-[9px] font-bold text-slate-400 hover:text-blue-400 uppercase tracking-widest transition-colors border-r border-white/10 pr-6">切换同步引擎</button>
          <button onClick={() => fileInputRef.current?.click()} className="px-5 py-2 glass-panel hover:bg-white/5 rounded-full text-[10px] font-bold tracking-widest uppercase border border-white/10">重新加载资产</button>
        </div>
      </header>

      <main className="flex-1 flex relative overflow-hidden">
        {currentStep === 1 && (
          <div className="absolute inset-0 z-50 flex">
            <div className="w-[450px] p-16 flex flex-col justify-center glass-panel border-r border-white/5">
              <div className="mb-12">
                <span className="text-blue-500 font-black text-[10px] uppercase tracking-[0.5em] block mb-4">Phase 01</span>
                <h2 className="fgo-font text-5xl font-black text-white leading-tight uppercase tracking-tighter">资产分析<br/><span className="text-blue-500">INITIATE</span></h2>
              </div>
              
              {!baseImage ? (
                <div 
                  onClick={() => fileInputRef.current?.click()} 
                  className="w-full py-24 border-2 border-dashed border-blue-500/30 rounded-3xl hover:border-blue-500 hover:bg-blue-500/5 transition-all group cursor-pointer text-center"
                >
                  <span className="text-blue-400/50 group-hover:text-blue-400 font-bold text-xs uppercase tracking-[0.3em] block transition-colors">点击上传灵基素材图</span>
                  <span className="text-[9px] text-slate-600 mt-4 block uppercase font-bold tracking-widest">Supports JPG, PNG (Max 10MB)</span>
                </div>
              ) : (
                <div className="space-y-8">
                  <div className="p-4 bg-blue-500/5 border border-blue-500/20 rounded-xl flex items-center gap-4">
                    <div className="w-12 h-12 bg-blue-600/20 rounded border border-blue-500/30 overflow-hidden">
                      <img src={baseImage} className="w-full h-full object-cover" />
                    </div>
                    <div className="flex-1 overflow-hidden">
                      <div className="text-[10px] text-white font-bold truncate uppercase tracking-widest">Asset_Loaded.png</div>
                      <div className="text-[9px] text-slate-500 uppercase tracking-widest">Ready for analysis</div>
                    </div>
                  </div>
                  <button onClick={startAnalysis} disabled={isAnalyzing} className="w-full py-5 bg-blue-600 hover:bg-blue-500 rounded-2xl font-black text-white tracking-[0.3em] text-xs shadow-2xl shadow-blue-600/30 transition-all disabled:opacity-50 flex items-center justify-center gap-3">
                    {isAnalyzing ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
                        <span>正在同步坐标系...</span>
                      </>
                    ) : '启动智能资产分析'}
                  </button>
                  {errorMessage && <div className="p-4 bg-red-900/10 border border-red-500/20 text-[10px] text-red-400 font-mono leading-relaxed rounded-xl">{errorMessage}</div>}
                </div>
              )}
            </div>
            <div className="flex-1 flex items-center justify-center p-24 bg-black/20">
              {baseImage ? (
                <img src={baseImage} className="max-w-full max-h-full shadow-[0_0_100px_rgba(0,0,0,0.5)] border border-white/5 rounded-lg" />
              ) : (
                <div className="fgo-font text-8xl font-black text-white/5 pointer-events-none select-none tracking-widest">CHALDEA</div>
              )}
            </div>
          </div>
        )}

        {analysis && (
          <>
            <aside className="w-72 flex flex-col border-r border-white/5 bg-black/40 backdrop-blur-xl">
              <div className="p-6 border-b border-white/5 flex justify-between items-center bg-white/5">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">提取序列 ({analysis.patches.length})</span>
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
              </div>
              <div className="flex-1 overflow-y-auto p-4 grid grid-cols-2 gap-3 custom-scrollbar">
                {analysis.patches.map((p, idx) => (
                  <button key={idx} onClick={() => setSelectedPatchIdx(idx)} className={`aspect-square border rounded-xl overflow-hidden transition-all group relative ${selectedPatchIdx === idx ? 'border-blue-500 ring-4 ring-blue-500/10 bg-blue-500/10' : 'border-white/5 bg-slate-900/50 hover:border-white/20'}`}>
                    <canvas className="w-full h-full object-contain" ref={el => {
                      if (!el || !imgElement) return;
                      const ctx = el.getContext('2d'); if (!ctx) return;
                      const nw = imgElement.naturalWidth; const nh = imgElement.naturalHeight;
                      el.width = 120; el.height = 120;
                      const scale = 120 / Math.max((p.w/1000)*nw, (p.h/1000)*nh);
                      ctx.scale(scale, scale); ctx.translate(-(p.x/1000)*nw, -(p.y/1000)*nh);
                      ctx.drawImage(imgElement, 0, 0);
                    }} />
                    <div className="absolute bottom-1 right-1 text-[8px] font-mono text-white/20 group-hover:text-white/60 transition-colors">#{idx+1}</div>
                  </button>
                ))}
              </div>
              <div className="p-6 border-t border-white/5 bg-black/60">
                <button onClick={() => setCurrentStep(currentStep === 2 ? 3 : 2)} className="w-full py-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl text-[10px] font-black uppercase tracking-[0.3em] transition-all">
                  {currentStep === 2 ? '准备批量导出' : '返回对齐工作区'}
                </button>
              </div>
            </aside>

            <section className="flex-1 flex flex-col">
              {currentStep === 2 ? (
                <>
                  <div className="h-12 px-8 border-b border-white/5 flex items-center justify-between bg-black/20 shrink-0">
                    <div className="flex items-center gap-8">
                      <div className="flex items-center gap-4">
                        <span className="text-[9px] text-slate-500 font-bold uppercase tracking-widest">预览缩放</span>
                        <input type="range" min="0.1" max="2" step="0.1" value={workspaceZoom} onChange={e => setWorkspaceZoom(parseFloat(e.target.value))} className="w-32 accent-blue-500" />
                        <span className="text-blue-500 font-mono text-[10px] font-bold">{Math.round(workspaceZoom * 100)}%</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                       <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                       <span className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">实时差分对齐中</span>
                    </div>
                  </div>
                  <div ref={containerRef} className="flex-1 overflow-auto p-16 flex justify-center bg-[#020617]" onMouseMove={handleMouseMove} onMouseUp={() => setIsDragging(false)}>
                    <div className="relative inline-block shadow-[0_0_100px_rgba(0,0,0,0.8)] origin-top transition-transform duration-200" style={{ transform: `scale(${workspaceZoom})` }}>
                      <canvas ref={previewCanvasRef} className="block rounded border border-white/5" />
                      {targetFace && selectedPatchIdx !== null && (
                        <div onMouseDown={handleMouseDown} className={`absolute border-2 cursor-move transition-colors ${isDragging ? 'border-yellow-400 bg-yellow-400/10' : 'border-blue-500 bg-blue-500/5 shadow-[0_0_20px_rgba(59,130,246,0.3)]'}`} style={{ left: `${targetFace.x/10}%`, top: `${targetFace.y/10}%`, width: `${analysis.patches[selectedPatchIdx].w/10}%`, height: `${analysis.patches[selectedPatchIdx].h/10}%` }}>
                          <div className="absolute -top-7 left-0 bg-blue-600 text-white px-3 py-1 text-[8px] font-black uppercase tracking-widest shadow-xl">Target Alignment</div>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="h-32 bg-black/60 border-t border-white/10 px-10 flex items-center gap-16 shrink-0 backdrop-blur-2xl">
                    <div className="space-y-3">
                      <div className="text-[9px] text-blue-500 font-black uppercase tracking-[0.2em]">微调坐标 X / Y</div>
                      <div className="flex gap-6">
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] text-slate-600 font-mono">X</span>
                          <input type="range" min="-100" max="100" value={calibration.offsetX} onChange={e => setCalibration(c => ({...c, offsetX: parseInt(e.target.value)}))} className="w-24 accent-blue-600" />
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] text-slate-600 font-mono">Y</span>
                          <input type="range" min="-100" max="100" value={calibration.offsetY} onChange={e => setCalibration(c => ({...c, offsetY: parseInt(e.target.value)}))} className="w-24 accent-blue-600" />
                        </div>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <div className="text-[9px] text-blue-500 font-black uppercase tracking-[0.2em]">物理缩放修正</div>
                      <input type="range" min="0.8" max="1.2" step="0.001" value={calibration.scale} onChange={e => setCalibration(c => ({...c, scale: parseFloat(e.target.value)}))} className="w-32 accent-blue-600" />
                    </div>
                    <div className="flex-1 flex justify-end items-center gap-6">
                       <div className="text-right space-y-1">
                          <div className="text-[9px] text-slate-500 uppercase font-black tracking-widest">叠加层可见度</div>
                          <div className="flex items-center gap-3">
                            <input type="range" min="0" max="1" step="0.1" value={overlayOpacity} onChange={e => setOverlayOpacity(parseFloat(e.target.value))} className="w-24 accent-white" />
                            <span className="text-[10px] font-mono text-white/50">{Math.round(overlayOpacity*100)}%</span>
                          </div>
                       </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center p-12">
                  <div className="max-w-md w-full glass-panel p-16 rounded-[2.5rem] text-center space-y-12 border-blue-500/20 shadow-[0_0_80px_rgba(59,130,246,0.1)]">
                    <div className="space-y-4">
                      <h2 className="fgo-font text-4xl font-black uppercase tracking-widest text-white">同步准备就绪</h2>
                      <p className="text-[10px] text-slate-500 font-bold uppercase tracking-[0.3em]">待导出的灵基资产总量</p>
                    </div>
                    <div className="py-12 bg-white/5 rounded-3xl border border-white/5 relative overflow-hidden">
                      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent"></div>
                      <span className="text-8xl font-black text-blue-500 block mb-2">{analysis.patches.length}</span>
                      <span className="text-[9px] text-slate-400 font-black uppercase tracking-[0.5em]">Expressional Assets</span>
                    </div>
                    <div className="space-y-4">
                      <button onClick={downloadAll} className="w-full py-6 bg-blue-600 hover:bg-blue-500 rounded-2xl font-black uppercase tracking-[0.4em] text-xs shadow-2xl shadow-blue-600/30 transition-all active:scale-95">
                        执行批量资产渲染
                      </button>
                      <button onClick={() => setCurrentStep(2)} className="text-[9px] text-slate-500 hover:text-white uppercase font-black tracking-widest transition-colors block mx-auto">
                        返回同步中心进行微调
                      </button>
                    </div>
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