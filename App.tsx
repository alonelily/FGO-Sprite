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

  // 工作区调节状态
  const [calibration, setCalibration] = useState<Calibration>({ offsetX: 0, offsetY: 0, scale: 1.0 });
  const [targetFace, setTargetFace] = useState<Rect | null>(null);
  const [overlayOpacity, setOverlayOpacity] = useState(0.8);
  const [workspaceZoom, setWorkspaceZoom] = useState(1.0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0, rectX: 0, rectY: 0 });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);

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
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  const runAiAnalysis = async () => {
    if (!baseImage) return;
    setIsAnalyzing(true);
    setErrorMessage(null);
    try {
      const result = await analyzeFgoSpriteSheet(baseImage, 'image/png');
      setAnalysis(result);
      setTargetFace(result.mainFace);
      if (result.patches.length > 0) setSelectedPatchIdx(0);
      setCurrentStep(2);
    } catch (err: any) {
      setErrorMessage(err.message || "AI 分析失败，请检查 API KEY 环境变量。");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const renderFrame = useCallback((ctx: CanvasRenderingContext2D, patchIdx: number, isFinal: boolean = false) => {
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
      // 导出时清除面部区域
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
    renderFrame(ctx, selectedPatchIdx);
  }, [imgElement, analysis, selectedPatchIdx, currentStep, renderFrame]);

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
        renderFrame(ctx, i, true);
        const link = document.createElement('a');
        link.download = `fgo_sprite_${i + 1}.png`;
        link.href = exportCanvas.toDataURL('image/png');
        link.click();
      }
      await new Promise(r => setTimeout(r, 100));
    }
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-slate-950 text-slate-200">
      <header className="flex items-center justify-between h-14 px-6 border-b border-white/10 bg-slate-900/50 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600 w-8 h-8 rounded flex items-center justify-center font-bold">F</div>
          <span className="fgo-font text-xs tracking-widest text-blue-400 font-bold">SERVANT ASSET EXTRACTOR</span>
        </div>
        <button onClick={() => fileInputRef.current?.click()} className="text-[10px] px-3 py-1 border border-slate-700 hover:border-blue-500 rounded uppercase font-bold">重新上传</button>
      </header>

      <main className="flex-1 flex relative overflow-hidden">
        {currentStep === 1 && (
          <div className="absolute inset-0 z-50 bg-slate-950 flex">
            <div className="w-1/3 p-12 flex flex-col justify-center border-r border-white/5">
              <h1 className="fgo-font text-4xl font-black mb-8">立绘分析</h1>
              {!baseImage ? (
                <button onClick={() => fileInputRef.current?.click()} className="w-full py-20 border-2 border-dashed border-blue-500/20 rounded-xl hover:border-blue-500/50 transition-all text-blue-400 font-bold">点击上传 FGO 素材图</button>
              ) : (
                <div className="space-y-4">
                  <button onClick={runAiAnalysis} disabled={isAnalyzing} className="w-full py-5 bg-blue-600 hover:bg-blue-500 rounded font-bold text-white tracking-widest transition-all">
                    {isAnalyzing ? 'AI 分析中...' : '开始识别'}
                  </button>
                  {errorMessage && <div className="p-3 bg-red-900/20 border border-red-500/50 text-[10px] text-red-400 font-mono">{errorMessage}</div>}
                </div>
              )}
            </div>
            <div className="flex-1 flex items-center justify-center p-12 bg-black/40">
              {baseImage && <img src={baseImage} className="max-w-full max-h-full shadow-2xl" />}
            </div>
          </div>
        )}

        {analysis && (
          <>
            <aside className="w-64 flex flex-col border-r border-white/5 bg-slate-900/30">
              <div className="p-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest border-b border-white/5">差分单元库</div>
              <div className="flex-1 overflow-y-auto p-3 grid grid-cols-2 gap-2 custom-scrollbar">
                {analysis.patches.map((p, idx) => (
                  <button key={idx} onClick={() => setSelectedPatchIdx(idx)} className={`aspect-square border rounded overflow-hidden transition-all ${selectedPatchIdx === idx ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-white/10 bg-black/40'}`}>
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
              <div className="p-4 bg-slate-900/50">
                <button onClick={() => setCurrentStep(currentStep === 2 ? 3 : 2)} className="w-full py-3 bg-blue-600 rounded text-[10px] font-bold uppercase tracking-widest">
                  {currentStep === 2 ? '去导出' : '回对齐'}
                </button>
              </div>
            </aside>

            <section className="flex-1 flex flex-col bg-black">
              {currentStep === 2 ? (
                <>
                  <div className="h-10 px-4 border-b border-white/5 flex items-center gap-4 bg-slate-900/20">
                    <span className="text-[10px] text-slate-500 font-bold">缩放:</span>
                    <input type="range" min="0.1" max="2" step="0.1" value={workspaceZoom} onChange={e => setWorkspaceZoom(parseFloat(e.target.value))} className="w-32" />
                  </div>
                  <div className="flex-1 overflow-auto p-10 flex justify-center">
                    <div className="relative inline-block shadow-2xl origin-top" style={{ transform: `scale(${workspaceZoom})` }}>
                      <canvas ref={previewCanvasRef} />
                    </div>
                  </div>
                  <div className="h-24 bg-slate-900/80 backdrop-blur p-6 flex items-center gap-10">
                    <div className="space-y-1">
                      <div className="text-[9px] text-blue-500 font-bold uppercase">微调偏移 X / Y</div>
                      <div className="flex gap-2">
                        <input type="range" min="-100" max="100" value={calibration.offsetX} onChange={e => setCalibration(c => ({...c, offsetX: parseInt(e.target.value)}))} className="w-20" />
                        <input type="range" min="-100" max="100" value={calibration.offsetY} onChange={e => setCalibration(c => ({...c, offsetY: parseInt(e.target.value)}))} className="w-20" />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-[9px] text-blue-500 font-bold uppercase">比例修正</div>
                      <input type="range" min="0.8" max="1.2" step="0.01" value={calibration.scale} onChange={e => setCalibration(c => ({...c, scale: parseFloat(e.target.value)}))} className="w-20" />
                    </div>
                    <div className="flex-1 flex justify-end gap-4 items-center">
                       <span className="text-[9px] text-slate-500 uppercase font-bold">预览透明度</span>
                       <input type="range" min="0" max="1" step="0.1" value={overlayOpacity} onChange={e => setOverlayOpacity(parseFloat(e.target.value))} className="w-20" />
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center">
                  <div className="max-w-md w-full bg-slate-900 p-10 rounded-2xl border border-white/10 text-center space-y-8">
                    <h2 className="fgo-font text-2xl font-bold">导出队列已就绪</h2>
                    <div className="text-5xl font-mono text-blue-500">{analysis.patches.length}</div>
                    <button onClick={downloadAll} className="w-full py-4 bg-green-600 hover:bg-green-500 rounded font-bold uppercase tracking-widest transition-all">批量生成图像</button>
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