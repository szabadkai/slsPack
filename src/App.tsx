import { useCallback, useMemo, useRef, useState } from 'react';
import {
  BadgeDollarSign,
  Box,
  Boxes,
  CheckCircle2,
  Eye,
  Gauge,
  Grid3X3,
  Hammer,
  Layers,
  ListTodo,
  Lock,
  Minus,
  PackageCheck,
  Plus,
  ScanLine,
  SlidersHorizontal,
  Sparkles,
  Thermometer,
  Trash2,
  Unlock,
  Upload,
  X,
} from 'lucide-react';
import { createImportedParts } from './importers';
import {
  calculateMetrics,
  createGeneratedParts,
  createJob,
  getBuildVolume,
  getPrinterMaxPartCount,
  PRINTER_SPECS,
  simulateDropInTimeline,
  simulatePacking,
  simulatePackingTimeline,
  simulateShakeTimeline,
} from './packing';
import { ThreeViewport } from './ThreeViewport';
import type { BuildVolume, JobSettings, LodLevel, ModelPart, PackingFrame, PackMetrics, PrinterModel, RenderSettings } from './types';

const DEFAULT_SETTINGS: JobSettings = {
  material: 'Nylon 11 V1',
  layerThicknessMm: 0.11,
  printProfile: 'Balanced',
  printer: 'Fuse 1',
  partCount: 180,
  seed: 1842,
  sliceLayer: 1760,
  showSlice: true,
  cageEnabled: true,
};

const PART_BATCH_SIZE = 30;
const PRINTER_OPTIONS = Object.keys(PRINTER_SPECS) as PrinterModel[];

const DEFAULT_RENDER_SETTINGS: RenderSettings = {
  showFps: true,
  occlusionCulling: true,
  realisticShaders: false,
  rasterResolution: 100,
  lodLevel: 'balanced',
};

function formatNumber(value: number, digits = 1) {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function TopBar() {
  return (
    <header className="topbar">
      <div className="brand-mark">
        <Sparkles size={24} />
      </div>
      <div className="top-tab active">
        <Box size={24} />
        <span>SLS Pack</span>
      </div>
      <div className="job-title">
        <span>cat_ams2</span>
      </div>
    </header>
  );
}

interface SummaryProps {
  metrics: PackMetrics;
  onDismiss: () => void;
}

function Summary({ metrics, onDismiss }: SummaryProps) {
  const estimatedCost = metrics.printTimeHours * 8 + metrics.sinteredPowderKg * 74;

  return (
    <section className="summary-panel">
      <div className="panel-title">
        <span>
          <strong>Summary</strong>
          <Gauge size={18} />
        </span>
        <button className="summary-close-button" onClick={onDismiss} title="Hide summary" aria-label="Hide summary">
          <X size={18} />
        </button>
      </div>
      <dl className="summary-list">
        <div>
          <dt>
            <Thermometer size={18} />
            Total Print Time
          </dt>
          <dd>{formatNumber(metrics.printTimeHours, 1)} h</dd>
        </div>
        <div className="subrow">
          <dt>Preprint</dt>
          <dd>{formatNumber(metrics.printTimeHours * 0.14, 1)} h</dd>
        </div>
        <div className="subrow">
          <dt>Printing</dt>
          <dd>{formatNumber(metrics.printTimeHours * 0.74, 1)} h</dd>
        </div>
        <div className="subrow">
          <dt>Cool to 100 C</dt>
          <dd>{formatNumber(metrics.printTimeHours * 0.12, 1)} h</dd>
        </div>
        <div>
          <dt>
            <Grid3X3 size={18} />
            Total Powder
          </dt>
          <dd>
            {formatNumber(metrics.totalPowderL, 2)} L / {formatNumber(metrics.totalPowderKg, 2)} kg
          </dd>
        </div>
        <div className="subrow">
          <dt>Sintered Powder</dt>
          <dd>
            {formatNumber(metrics.sinteredPowderL, 2)} L / {formatNumber(metrics.sinteredPowderKg, 2)} kg
          </dd>
        </div>
        <div>
          <dt>
            <Boxes size={18} />
            Mass Packing Density
          </dt>
          <dd>{formatNumber(metrics.packingDensity, 0)}%</dd>
        </div>
        <div>
          <dt>
            <Layers size={18} />
            Layers
          </dt>
          <dd>{metrics.layerCount}</dd>
        </div>
        <div>
          <dt>
            <BadgeDollarSign size={18} />
            Estimated Print Cost
          </dt>
          <dd>${formatNumber(estimatedCost, 0)}</dd>
        </div>
      </dl>
    </section>
  );
}

interface InspectorProps {
  settings: JobSettings;
  metrics: PackMetrics;
  models: ModelPart[];
  buildVolume: BuildVolume;
  renderSettings: RenderSettings;
  selectedId: string | null;
  isPacking: boolean;
  onPrinterChange: (printer: PrinterModel) => void;
  onRenderSettingsChange: (nextSettings: Partial<RenderSettings>) => void;
  onToggleVisible: (id: string) => void;
  onToggleLocked: (id: string) => void;
  onSelectModel: (id: string) => void;
  onLayerChange: (layer: number) => void;
  onToggleSlice: () => void;
}

function Inspector({
  settings,
  metrics,
  models,
  buildVolume,
  renderSettings,
  selectedId,
  isPacking,
  onPrinterChange,
  onRenderSettingsChange,
  onToggleVisible,
  onToggleLocked,
  onSelectModel,
  onLayerChange,
  onToggleSlice,
}: InspectorProps) {
  const selected = models.find((model) => model.id === selectedId);
  const warningCount = models.reduce((sum, model) => sum + model.warnings.length, 0);
  const stepLayer = (delta: number) => {
    onLayerChange(Math.min(Math.max(settings.sliceLayer + delta, 0), metrics.layerCount));
  };

  return (
    <aside className="inspector">
      <section className="job-card">
        <h2>Build Job</h2>
        <div className="build-status">
          <PackageCheck size={38} />
          <div>
            <strong>{settings.printer} SLS pack</strong>
            <span>
              {models.length} parts | {buildVolume.width * 10} x {buildVolume.depth * 10} x {buildVolume.height * 10} mm
            </span>
          </div>
        </div>
        <div className="job-settings">
          <h3>Job Settings</h3>
          <dl>
            <div>
              <dt>Printer</dt>
              <dd>
                <select
                  className="settings-select"
                  value={settings.printer}
                  disabled={isPacking}
                  onChange={(event) => onPrinterChange(event.currentTarget.value as PrinterModel)}
                >
                  {PRINTER_OPTIONS.map((printer) => (
                    <option key={printer} value={printer}>
                      {printer}
                    </option>
                  ))}
                </select>
              </dd>
            </div>
            <div>
              <dt>Material</dt>
              <dd>{settings.material}</dd>
            </div>
            <div>
              <dt>Layer Thickness</dt>
              <dd>{settings.layerThicknessMm.toFixed(3)} mm</dd>
            </div>
            <div>
              <dt>Print Settings</dt>
              <dd>{settings.printProfile}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="validation-strip">
        <div>
          <strong>Print Validation</strong>
          <small>{warningCount ? `${warningCount} warning${warningCount === 1 ? '' : 's'}` : metrics.validation}</small>
        </div>
        <CheckCircle2 className={warningCount ? 'warn' : 'ok'} size={24} />
      </section>

      <section className="slice-panel">
        <div className="slice-header">
          <strong>Fill / Slice Line</strong>
          <button className={settings.showSlice ? 'toggle active' : 'toggle'} onClick={onToggleSlice}>
            <ScanLine size={16} />
            {settings.showSlice ? 'On' : 'Off'}
          </button>
        </div>
        <div className="slice-readout">
          <span>Layer</span>
          <strong>{settings.sliceLayer}</strong>
          <span>{Math.round((settings.sliceLayer / metrics.layerCount) * buildVolume.height * 10)} mm</span>
        </div>
        <div className="layer-control-row">
          <button type="button" onClick={() => stepLayer(-100)} aria-label="Lower layer">
            <Minus size={16} />
          </button>
          <input
            className="layer-slider-horizontal"
            type="range"
            min={0}
            max={metrics.layerCount}
            value={settings.sliceLayer}
            onInput={(event) => onLayerChange(Number(event.currentTarget.value))}
            onChange={(event) => onLayerChange(Number(event.target.value))}
          />
          <button type="button" onClick={() => stepLayer(100)} aria-label="Raise layer">
            <Plus size={16} />
          </button>
        </div>
      </section>

      <section className="render-panel">
        <div className="render-header">
          <strong>Render</strong>
          <SlidersHorizontal size={18} />
        </div>
        <label className="setting-toggle">
          <span>FPS Counter</span>
          <input
            type="checkbox"
            checked={renderSettings.showFps}
            onChange={(event) => onRenderSettingsChange({ showFps: event.currentTarget.checked })}
          />
        </label>
        <label className="setting-toggle">
          <span>Occlusion Culling</span>
          <input
            type="checkbox"
            checked={renderSettings.occlusionCulling}
            onChange={(event) => onRenderSettingsChange({ occlusionCulling: event.currentTarget.checked })}
          />
        </label>
        <label className="setting-toggle">
          <span>Realistic Shaders</span>
          <input
            type="checkbox"
            checked={renderSettings.realisticShaders}
            onChange={(event) => onRenderSettingsChange({ realisticShaders: event.currentTarget.checked })}
          />
        </label>
        <div className="range-setting">
          <div>
            <span>Raster Resolution</span>
            <strong>{renderSettings.rasterResolution}%</strong>
          </div>
          <input
            type="range"
            min={50}
            max={150}
            step={10}
            value={renderSettings.rasterResolution}
            onInput={(event) => onRenderSettingsChange({ rasterResolution: Number(event.currentTarget.value) })}
            onChange={(event) => onRenderSettingsChange({ rasterResolution: Number(event.currentTarget.value) })}
          />
        </div>
        <label className="setting-row">
          <span>LOD</span>
          <select
            className="settings-select"
            value={renderSettings.lodLevel}
            onChange={(event) => onRenderSettingsChange({ lodLevel: event.currentTarget.value as LodLevel })}
          >
            <option value="performance">Performance</option>
            <option value="balanced">Balanced</option>
            <option value="quality">Quality</option>
          </select>
        </label>
      </section>

      <section className="model-list-panel">
        <div className="model-list-header">
          <strong>Model List ({models.length})</strong>
        </div>
        <div className="selected-model">
          <span>{selected?.name ?? 'No model selected'}</span>
          <small>
            {selected
              ? `${selected.dims.map((value) => `${Math.round(value * 10)} mm`).join(' x ')}`
              : 'Click a part in the viewport'}
          </small>
        </div>
        <div className="model-scroll">
          {models.map((model) => (
            <div
              key={model.id}
              className={`model-row ${model.id === selectedId ? 'active' : ''}`}
              onClick={() => onSelectModel(model.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') onSelectModel(model.id);
              }}
            >
              <span>{model.name}</span>
              <small>{model.warnings[0] ?? `${formatNumber(model.volumeCc, 0)} cc`}</small>
              <button
                className="row-icon"
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleLocked(model.id);
                }}
                title={model.locked ? 'Unlock' : 'Lock'}
              >
                {model.locked ? <Lock size={17} /> : <Unlock size={17} />}
              </button>
              <button
                className="row-icon"
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleVisible(model.id);
                }}
                title={model.visible ? 'Hide' : 'Show'}
              >
                <Eye size={18} opacity={model.visible ? 1 : 0.35} />
              </button>
            </div>
          ))}
        </div>
      </section>
    </aside>
  );
}

export function App() {
  const [settings, setSettings] = useState<JobSettings>(DEFAULT_SETTINGS);
  const [models, setModels] = useState(() => simulatePacking(createJob(DEFAULT_SETTINGS), DEFAULT_SETTINGS));
  const [selectedId, setSelectedId] = useState<string | null>('part-19');
  const [status, setStatus] = useState('Ready');
  const [packingFrames, setPackingFrames] = useState<PackingFrame[] | null>(null);
  const [packingRunId, setPackingRunId] = useState(0);
  const [isSummaryVisible, setIsSummaryVisible] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [renderSettings, setRenderSettings] = useState<RenderSettings>(DEFAULT_RENDER_SETTINGS);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const finalPackedModelsRef = useRef<ModelPart[] | null>(null);

  const buildVolume = useMemo(() => getBuildVolume(settings), [settings]);
  const maxTotalPartCount = useMemo(() => getPrinterMaxPartCount(settings), [settings]);
  const metrics = useMemo(() => calculateMetrics(models, settings), [models, settings]);
  const isPacking =
    Boolean(packingFrames) ||
    isImporting ||
    status.startsWith('Solving') ||
    status.startsWith('Adding') ||
    status.startsWith('Filling') ||
    status.startsWith('Packing');

  const selectModel = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  const startPackingPlayback = useCallback((sourceModels: ModelPart[], nextSettings: JobSettings, solvingStatus: string) => {
    setPackingFrames(null);
    setStatus(solvingStatus);
    window.setTimeout(() => {
      const simulation = simulatePackingTimeline(sourceModels, nextSettings);
      finalPackedModelsRef.current = simulation.finalModels;
      setModels(sourceModels);
      setPackingFrames(simulation.frames);
      setPackingRunId((current) => current + 1);
      setStatus('Dropping, colliding, shaking');
    }, 40);
  }, []);

  const startDropInPlayback = useCallback((existingModels: ModelPart[], addedModels: ModelPart[], nextSettings: JobSettings, solvingStatus: string) => {
    const sourceModels = [...existingModels, ...addedModels];
    setPackingFrames(null);
    setStatus(solvingStatus);
    window.setTimeout(() => {
      const simulation = simulateDropInTimeline(existingModels, addedModels, nextSettings);
      finalPackedModelsRef.current = simulation.finalModels;
      setModels(sourceModels);
      setPackingFrames(simulation.frames);
      setPackingRunId((current) => current + 1);
      setSelectedId(addedModels[0]?.id ?? existingModels[0]?.id ?? null);
      setStatus(addedModels.length === 1 ? 'Dropping single part' : `Dropping ${addedModels.length} parts`);
    }, 40);
  }, []);

  const runPack = useCallback(() => {
    startPackingPlayback(models, settings, 'Solving fall and shake');
  }, [models, settings, startPackingPlayback]);

  const appendGeneratedParts = useCallback((requestedCount: number, solvingStatus: string) => {
    const addCount = Math.min(requestedCount, maxTotalPartCount - models.length);
    if (addCount <= 0) return;
    const nextSettings = { ...settings, partCount: settings.partCount + addCount };
    const addedParts = createGeneratedParts(addCount, nextSettings.seed + models.length * 97, models.length, buildVolume);
    setSettings(nextSettings);
    startDropInPlayback(models, addedParts, nextSettings, solvingStatus);
  }, [buildVolume, maxTotalPartCount, models, settings, startDropInPlayback]);

  const addSinglePart = useCallback(() => {
    appendGeneratedParts(1, 'Adding one part');
  }, [appendGeneratedParts]);

  const addParts = useCallback(() => {
    appendGeneratedParts(PART_BATCH_SIZE, `Adding ${Math.min(PART_BATCH_SIZE, maxTotalPartCount - models.length)} parts`);
  }, [appendGeneratedParts, maxTotalPartCount, models.length]);

  const fillBuildVolume = useCallback(() => {
    appendGeneratedParts(maxTotalPartCount - models.length, 'Filling build volume');
  }, [appendGeneratedParts, maxTotalPartCount, models.length]);

  const clearBuildVolume = useCallback(() => {
    finalPackedModelsRef.current = null;
    setPackingFrames(null);
    setModels([]);
    setSelectedId(null);
    setSettings((current) => ({ ...current, partCount: 0 }));
    setStatus('Build volume cleared');
  }, []);

  const uploadModels = useCallback(async (files: File[]) => {
    if (!files.length) return;
    const openSlots = maxTotalPartCount - models.length;
    if (openSlots <= 0) {
      setStatus('Build volume part cap reached');
      return;
    }
    const acceptedFiles = files.slice(0, openSlots);
    setIsImporting(true);
    setPackingFrames(null);
    setStatus('Importing models');
    try {
      const imported = await createImportedParts(acceptedFiles, models.length, buildVolume);
      setSelectedId(imported[0]?.id ?? selectedId);
      startDropInPlayback(models, imported, settings, `Packing ${imported.length} imported model${imported.length === 1 ? '' : 's'}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not import model';
      setStatus(message);
    } finally {
      setIsImporting(false);
    }
  }, [buildVolume, maxTotalPartCount, models, selectedId, settings, startDropInPlayback]);

  const shakeBuild = useCallback(() => {
    setPackingFrames(null);
    setStatus('Solving shake');
    window.setTimeout(() => {
      const simulation = simulateShakeTimeline(models, settings);
      finalPackedModelsRef.current = simulation.finalModels;
      setPackingFrames(simulation.frames);
      setPackingRunId((current) => current + 1);
      setStatus('Shaking build volume');
    }, 40);
  }, [models, settings]);

  const completePackingPlayback = useCallback(() => {
    const packed = finalPackedModelsRef.current;
    if (!packed) return;
    setModels(packed);
    setPackingFrames(null);
    setStatus('Packed and sliced');
    setSelectedId((current) => current ?? packed[0]?.id ?? null);
  }, []);

  const regenerate = () => {
    const nextSeed = settings.seed + 137;
    const nextSettings = { ...settings, seed: nextSeed, partCount: DEFAULT_SETTINGS.partCount };
    setSettings(nextSettings);
    const nextModels = simulatePacking(createJob(nextSettings), nextSettings);
    setModels(nextModels);
    setSelectedId(nextModels[0]?.id ?? null);
    setStatus('New job generated');
  };

  const changePrinter = (printer: PrinterModel) => {
    if (printer === settings.printer) return;
    const nextBuildVolume = getBuildVolume(printer);
    const nextLayerCount = Math.ceil((nextBuildVolume.height * 10) / settings.layerThicknessMm);
    const layerFraction = settings.sliceLayer / Math.max(metrics.layerCount, 1);
    const nextSettings = {
      ...settings,
      printer,
      sliceLayer: Math.min(nextLayerCount, Math.max(0, Math.round(layerFraction * nextLayerCount))),
    };
    setSettings(nextSettings);
    startPackingPlayback(models, nextSettings, `Switching to ${printer}`);
  };

  const toggleVisible = (id: string) => {
    setModels((current) => current.map((model) => (model.id === id ? { ...model, visible: !model.visible } : model)));
  };

  const toggleLocked = (id: string) => {
    setModels((current) => current.map((model) => (model.id === id ? { ...model, locked: !model.locked } : model)));
  };

  const handleLayerChange = (sliceLayer: number) => {
    setSettings((current) => ({ ...current, sliceLayer }));
  };

  const toggleSlice = () => {
    setSettings((current) => ({ ...current, showSlice: !current.showSlice }));
  };

  const updateRenderSettings = (nextSettings: Partial<RenderSettings>) => {
    setRenderSettings((current) => ({ ...current, ...nextSettings }));
  };

  return (
    <div className="app-shell">
      <TopBar />
      <main className="workbench">
        <section className="scene-area">
          <ThreeViewport
            models={models}
            selectedId={selectedId}
            sliceLayer={settings.sliceLayer}
            layerCount={metrics.layerCount}
            showSlice={settings.showSlice && !packingFrames}
            buildVolume={buildVolume}
            renderSettings={renderSettings}
            packingFrames={packingFrames}
            packingRunId={packingRunId}
            onSelectModel={selectModel}
            onPackingPlaybackComplete={completePackingPlayback}
          />
          <div className="job-actions">
            <button type="button" data-testid="run-pack" onClick={runPack} disabled={isPacking}>
              <Hammer size={18} />
              Pack
            </button>
            <button type="button" data-testid="upload-models" onClick={() => fileInputRef.current?.click()} disabled={isPacking}>
              <Upload size={18} />
              Upload
            </button>
            <input
              ref={fileInputRef}
              className="file-input"
              type="file"
              accept=".stl,.obj"
              multiple
              onChange={(event) => {
                const files = Array.from(event.currentTarget.files ?? []);
                event.currentTarget.value = '';
                void uploadModels(files);
              }}
            />
            <button type="button" data-testid="fill-volume" onClick={fillBuildVolume} disabled={isPacking || models.length >= maxTotalPartCount}>
              <Boxes size={18} />
              Fill Volume
            </button>
            <button type="button" data-testid="add-single-part" onClick={addSinglePart} disabled={isPacking || models.length >= maxTotalPartCount}>
              <Plus size={18} />
              Add 1
            </button>
            <button type="button" data-testid="add-parts" onClick={addParts} disabled={isPacking || models.length >= maxTotalPartCount}>
              <Plus size={18} />
              Add {PART_BATCH_SIZE}
            </button>
            <button type="button" className="clear-action" data-testid="clear-volume" onClick={clearBuildVolume} disabled={isPacking || models.length === 0}>
              <Trash2 size={18} />
              Clear
            </button>
            <button type="button" data-testid="shake-build" onClick={shakeBuild} disabled={isPacking}>
              <Grid3X3 size={18} />
              Shake
            </button>
            <button type="button" data-testid="new-job" onClick={regenerate} disabled={isPacking}>
              <ListTodo size={18} />
              New Job
            </button>
          </div>
          <div className="status-pill">
            <span className={status === 'Packed and sliced' ? 'status-dot done' : 'status-dot'} />
            {status}
          </div>
          <div className="vertical-layer">
            <input
              type="range"
              min={0}
              max={metrics.layerCount}
              value={settings.sliceLayer}
              onInput={(event) => handleLayerChange(Number(event.currentTarget.value))}
              onChange={(event) => handleLayerChange(Number(event.target.value))}
              aria-label="Layer"
            />
          </div>
          {isSummaryVisible ? (
            <Summary metrics={metrics} onDismiss={() => setIsSummaryVisible(false)} />
          ) : (
            <button className="summary-open-button" onClick={() => setIsSummaryVisible(true)}>
              <Gauge size={18} />
              Summary
            </button>
          )}
        </section>
        <Inspector
          settings={settings}
          metrics={metrics}
          models={models}
          buildVolume={buildVolume}
          renderSettings={renderSettings}
          selectedId={selectedId}
          isPacking={isPacking}
          onPrinterChange={changePrinter}
          onRenderSettingsChange={updateRenderSettings}
          onToggleVisible={toggleVisible}
          onToggleLocked={toggleLocked}
          onSelectModel={selectModel}
          onLayerChange={handleLayerChange}
          onToggleSlice={toggleSlice}
        />
      </main>
    </div>
  );
}
