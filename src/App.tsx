import { useEffect, useMemo, useState, type CSSProperties, type DragEvent } from "react";
import {
  Activity, ArrowDown, ArrowUp, AudioLines, BookmarkPlus, CirclePower,
  Guitar, Layers3, Plus, RotateCcw, Save, Settings2,
  SlidersHorizontal, Trash2, Waves, Zap
} from "lucide-react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  PEDALS, PEDAL_KINDS, createPedal, factoryChain, movePedal,
  type Parameter, type PedalInstance, type PedalKind
} from "./lib/pedals";
import { loadDraft, loadPresets, saveDraft, savePresets, type Preset } from "./lib/presets";
import PedalFace, { VTT_PEDAL_NAMES } from "./components/PedalFace";
import AmpHero from "./components/AmpHero";
import type { AmpFamily } from "./lib/ampSkins";

type DragData = { source: "library"; kind: PedalKind } | { source: "chain"; id: string };

function readDrag(event: DragEvent<HTMLElement>): DragData | null {
  const value = event.dataTransfer.getData("text/plain");
  if (value.startsWith("library:")) {
    const kind = value.slice("library:".length) as PedalKind;
    return kind in PEDALS ? { source: "library", kind } : null;
  }
  if (value.startsWith("chain:")) return { source: "chain", id: value.slice("chain:".length) };
  return null;
}

function Knob({ parameter, value, accent, onChange }: {
  parameter: Parameter;
  value: number;
  accent: string;
  onChange: (value: number) => void;
}) {
  const fraction = (value - parameter.min) / (parameter.max - parameter.min);
  const style = { "--accent": accent, "--turn": `${fraction * 270 - 135}deg` } as CSSProperties;
  return (
    <label className="knob-control">
      <span className="knob-label">{parameter.label}</span>
      <span className="dial" style={style}>
        <span className="dial-inner" />
        <input
          type="range"
          min={parameter.min}
          max={parameter.max}
          step={parameter.step}
          value={value}
          aria-label={parameter.label}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </span>
      <span className="knob-value">{Number(value.toFixed(2))}<small>{parameter.unit}</small></span>
    </label>
  );
}

export default function App() {
  const [chain, setChain] = useState<PedalInstance[]>(loadDraft);
  const [presets, setPresets] = useState<Preset[]>(loadPresets);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activePresetId, setActivePresetId] = useState("");
  const [presetName, setPresetName] = useState("Meu primeiro rig");
  const [search, setSearch] = useState("");
  const [engine, setEngine] = useState("interface demo");
  const [notice, setNotice] = useState("");
  const [modelName, setModelName] = useState("Marshall_JCM800_2203_A2.nam");
  const [ampFamily, setAmpFamily] = useState<AmpFamily | "auto">("auto");

  useEffect(() => { saveDraft(chain); }, [chain]);
  useEffect(() => {
    if (isTauri()) {
      void invoke<string>("audio_engine_status")
        .then((status) => setEngine(status === "not_implemented" ? "áudio não implementado" : status))
        .catch(() => setEngine("motor indisponível"));
    }
  }, []);

  const selected = chain.find((effect) => effect.id === selectedId) ?? null;
  const selectedDefinition = selected ? PEDALS[selected.kind] : null;
  const searchedPedals = useMemo(() => PEDAL_KINDS.filter(
    (kind) => [PEDALS[kind].title, PEDALS[kind].category].join(" ").toLowerCase().includes(search.toLowerCase())
  ), [search]);

  function add(kind: PedalKind, atIndex = chain.length) {
    if (chain.length >= 24) { setNotice("Limite de 24 módulos atingido."); return; }
    const pedal = createPedal(kind);
    setChain((previous) => {
      const next = [...previous];
      next.splice(Math.min(atIndex, next.length), 0, pedal);
      return next;
    });
    setSelectedId(pedal.id);
    setNotice(`${PEDALS[kind].title} adicionado ao rig.`);
  }

  function dropAt(event: DragEvent<HTMLElement>, index: number) {
    event.preventDefault();
    event.stopPropagation();
    const drag = readDrag(event);
    if (!drag) return;
    if (drag.source === "library") add(drag.kind, index);
    else setChain((previous) => movePedal(previous, drag.id, index));
  }

  function toggle(id: string) {
    setChain((previous) => previous.map((effect) => effect.id === id ? { ...effect, enabled: !effect.enabled } : effect));
  }

  function remove(id: string) {
    setChain((previous) => previous.filter((effect) => effect.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  function setParameter(id: string, key: string, value: number) {
    setChain((previous) => previous.map((effect) => effect.id === id
      ? { ...effect, values: { ...effect.values, [key]: value } } : effect));
  }

  function saveCurrentPreset() {
    const name = presetName.trim();
    if (!name) { setNotice("Dê um nome ao preset antes de salvar."); return; }
    const id = activePresetId || crypto.randomUUID();
    const preset: Preset = { id, name, chain: structuredClone(chain), modelName, ampFamily };
    const updated = [...presets.filter((item) => item.id !== id), preset];
    if (!savePresets(updated)) { setNotice("Falha ao gravar preset no armazenamento local."); return; }
    setPresets(updated);
    setActivePresetId(id);
    setNotice(`Preset "${name}" salvo localmente.`);
  }

  function loadPreset(id: string) {
    const preset = presets.find((item) => item.id === id);
    if (!preset) return;
    setChain(structuredClone(preset.chain));
    if (preset.modelName) setModelName(preset.modelName);
    setAmpFamily(preset.ampFamily ?? "auto");
    setPresetName(preset.name);
    setActivePresetId(id);
    setSelectedId(null);
    setNotice(`Preset "${preset.name}" carregado.`);
  }

  function deletePreset() {
    if (!activePresetId) return;
    const updated = presets.filter((item) => item.id !== activePresetId);
    if (!savePresets(updated)) { setNotice("Não foi possível atualizar os presets."); return; }
    setPresets(updated);
    setActivePresetId("");
    setPresetName("Novo preset");
    setNotice("Preset removido.");
  }

  function resetChain() {
    setChain(factoryChain());
    setSelectedId(null);
    setActivePresetId("");
    setPresetName("Novo preset");
    setNotice("Rig de demonstração restaurado.");
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><AudioLines size={22} strokeWidth={2.5} /></div>
          <div><strong>VTT<em>RIG</em></strong><small>NEURAL GUITAR STUDIO</small></div>
        </div>
        <div className="top-center"><span className="top-divider" /><Guitar size={17} /> <span>Pedalboard Studio</span><span className="top-divider" /><span className="version">v0.1 preview</span></div>
        <div className="top-actions"><span className="offline-pill"><span className="offline-dot" /> MOTOR OFFLINE</span></div>
      </header>

      <div className="workspace">
        <aside className="library-panel">
          <div className="panel-kicker"><Layers3 size={15} /> EFFECT LIBRARY</div>
          <h2>Seus efeitos<span>.</span></h2>
          <p className="panel-subtitle">Arraste para o palco ou clique no + para adicionar.</p>
          <input className="library-search" type="search" value={search} placeholder="Buscar pedais..." onChange={(event) => setSearch(event.target.value)} aria-label="Buscar pedais" />
          <div className="library-list">
            {searchedPedals.map((kind) => {
              const pedal = PEDALS[kind];
              return (
                <div
                  key={kind}
                  className="library-item"
                  draggable
                  onDragStart={(event) => event.dataTransfer.setData("text/plain", `library:${kind}`)}
                  style={{ "--pedal-accent": pedal.accent } as CSSProperties}
                >
                  <span className="library-icon">{kind === "amp" || kind === "drive" ? <Zap size={19} /> : <Waves size={19} />}</span>
                  <div className="library-item-text"><strong>{VTT_PEDAL_NAMES[kind]}</strong><small>{pedal.caption}</small></div>
                  <button type="button" title={`Adicionar ${VTT_PEDAL_NAMES[kind]}`} aria-label={`Adicionar ${VTT_PEDAL_NAMES[kind]}`} onClick={() => add(kind)}><Plus size={17} /></button>
                </div>
              );
            })}
            {searchedPedals.length === 0 && <p className="quiet">Nenhum pedal encontrado.</p>}
          </div>
          <div className="library-note"><Activity size={17} /> <span>Pronto para receber o motor DSP nativo.<br /><strong>Sem Wine. Sem yabridge.</strong></span></div>
        </aside>

        <main className="stage">
          <div className="stage-header">
            <div>
              <div className="eyebrow">AMPLIFIERS / EFFECTS / PRESETS</div>
              <h1>Seu som. <span>Seu rig.</span></h1>
              <p>Seu pedalboard modular, com amplificadores visuais e uma cadeia de efeitos personalizável.</p>
            </div>
            <button className="secondary-button" type="button" onClick={resetChain}><RotateCcw size={15} /> Restaurar rig</button>
          </div>

          <section className="preset-toolbar" aria-label="Gerenciador de presets">
            <div className="preset-icon"><BookmarkPlus size={19} /></div>
            <div className="preset-fields">
              <label htmlFor="preset-name">PRESET ATUAL</label>
              <input id="preset-name" type="text" maxLength={100} value={presetName} onChange={(event) => setPresetName(event.target.value)} />
            </div>
            <div className="preset-chooser">
              <label htmlFor="preset-picker">MEUS PRESETS</label>
              <select id="preset-picker" value={activePresetId} onChange={(event) => loadPreset(event.target.value)}>
                <option value="">Selecionar preset salvo</option>
                {presets.map((preset) => <option value={preset.id} key={preset.id}>{preset.name}</option>)}
              </select>
            </div>
            <button className="primary-button" type="button" onClick={saveCurrentPreset}><Save size={17} /> Salvar</button>
            <button className="icon-button" type="button" title="Excluir preset selecionado" aria-label="Excluir preset selecionado" disabled={!activePresetId} onClick={deletePreset}><Trash2 size={18} /></button>
          </section>

          <AmpHero
            modelName={modelName}
            overrideFamily={ampFamily}
            onModelChosen={(file) => { setModelName(file.name); setNotice("Modelo selecionado apenas para visualização. DSP NAM ainda não ativo."); }}
            onOverrideChange={setAmpFamily}
          />

          <section className="signal-route" aria-label="Cadeia de pedais">
            <div className="route-section-title"><div><span className="hero-caption">02 / SIGNAL CHAIN</span><h2>Pedalboard <span>✦</span></h2></div><span className="route-demo-label">LED / CONTROLES VISUAIS</span></div>
            <div className="route-label"><span className="in-out-marker" /> INPUT <span className="cable-line" /></div>
            <div
              className="effects-grid"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => dropAt(event, chain.length)}
            >
              {chain.length === 0 && <div className="empty-chain"><Plus size={30} /><strong>Seu palco está vazio</strong><span>Arraste pedais para cá e comece seu rig.</span></div>}
              {chain.map((effect, index) => (
                <PedalFace
                  key={effect.id}
                  index={index}
                  pedal={effect}
                  selected={selectedId === effect.id}
                  onSelect={() => setSelectedId(effect.id)}
                  onToggle={() => toggle(effect.id)}
                  onRemove={() => remove(effect.id)}
                  onParameter={(key, value) => setParameter(effect.id, key, value)}
                  onMoveDragStart={(event) => event.dataTransfer.setData("text/plain", `chain:${effect.id}`)}
                  onDrop={dropAt}
                />
              ))}
              <button type="button" className="add-slot" title="Adicionar o próximo pedal" onClick={() => add("delay")}><Plus size={24} /><span>Adicionar pedal</span></button>
            </div>
            <div className="route-label last"><span className="cable-line" /> OUTPUT <span className="in-out-marker" /></div>
          </section>

          <div className="stage-bottom">
            <div className="info-block"><span className="info-led" /><strong>FLUXO VISUAL</strong> <span>{chain.length} módulos · {chain.filter((effect) => effect.enabled).length} ativos</span></div>
            <div className="info-block"><SlidersHorizontal size={15} /><strong>ÁUDIO</strong> <span>{engine}</span></div>
          </div>
          {notice && <div className="notification" role="status">{notice}<button type="button" aria-label="Fechar mensagem" onClick={() => setNotice("")}>×</button></div>}
        </main>

        <aside className="inspector-panel">
          <div className="panel-kicker"><Settings2 size={15} /> PEDAL INSPECTOR</div>
          {selected && selectedDefinition ? (
            <div className="inspector-content">
              <div className="inspector-glyph" style={{ "--pedal-accent": selectedDefinition.accent } as CSSProperties}><Waves size={34} /></div>
              <div className="eyebrow">{selectedDefinition.category}</div>
              <h2>{selectedDefinition.title}</h2>
              <p>{selectedDefinition.description}</p>
              <div className="inspector-divider" />
              <div className="inspector-section-label">CONTROLES DO PEDAL</div>
              <div className="knob-grid">
                {selectedDefinition.parameters.map((parameter) => (
                  <Knob
                    key={parameter.key}
                    parameter={parameter}
                    value={selected.values[parameter.key]}
                    accent={selectedDefinition.accent}
                    onChange={(value) => setParameter(selected.id, parameter.key, value)}
                  />
                ))}
              </div>
              {(selected.kind === "amp" || selected.kind === "drive" || selected.kind === "cabinet") &&
                <div className="inspector-hint">A importação de arquivos {selected.kind === "cabinet" ? ".wav (IR)" : ".nam"} será conectada na fase do motor de áudio.</div>}
              <div className="inspector-divider" />
              <div className="inspector-section-label">POSIÇÃO NA CADEIA</div>
              <div className="move-group">
                <button type="button" disabled={chain[0]?.id === selected.id} onClick={() => setChain((previous) => movePedal(previous, selected.id, previous.findIndex((p) => p.id === selected.id) - 1))}><ArrowUp size={17} /> Antes</button>
                <button type="button" disabled={chain[chain.length - 1]?.id === selected.id} onClick={() => setChain((previous) => movePedal(previous, selected.id, previous.findIndex((p) => p.id === selected.id) + 1))}><ArrowDown size={17} /> Depois</button>
              </div>
              <button className="inspector-toggle" type="button" onClick={() => toggle(selected.id)}><CirclePower size={18} /> {selected.enabled ? "Desativar pedal" : "Ativar pedal"}</button>
            </div>
          ) : (
            <div className="inspector-empty"><div className="inspector-empty-icon"><Guitar size={30} /></div><h2>Seu rig, suas regras.</h2><p>Selecione um pedal para ajustar seus controles na interface.</p><span>Os parâmetros ainda não processam áudio.</span></div>
          )}
          <div className="inspector-foot">VTTRIG <span>•</span> DESIGNED FOR LINUX</div>
        </aside>
      </div>
    </div>
  );
}
