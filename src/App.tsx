import { useEffect, useMemo, useState, type CSSProperties, type DragEvent } from "react";
import {
  AudioLines, BookOpen, Guitar, LibraryBig, Plus, RotateCcw,
  Save, Settings2, SlidersHorizontal, Trash2, Waves, Zap,
} from "lucide-react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  PEDALS, PEDAL_KINDS, createPedal, factoryChain, movePedal,
  type PedalInstance, type PedalKind,
} from "./lib/pedals";
import { loadDraft, loadPresets, saveDraft, savePresets, type Preset } from "./lib/presets";
import PedalFace, { VTT_PEDAL_NAMES } from "./components/PedalFace";
import PedalFocusPanel from "./components/PedalFocusPanel";
import AmpHero from "./components/AmpHero";
import { AMP_FAMILIES, humanizeModelName, type AmpFamily } from "./lib/ampSkins";

type View = "board" | "library" | "settings";
const DEMO_MODELS = [
  "Marshall_JCM800_2203_A2.nam", "Fender_Twin_Reverb_A2.nam",
  "Hiwatt_DR103_Classic.nam", "Vox_AC30_TopBoost.nam",
  "Mesa_Dual_Rectifier.nam",
];

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

export default function App() {
  const [chain, setChain] = useState<PedalInstance[]>(loadDraft);
  const [presets, setPresets] = useState<Preset[]>(loadPresets);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activePresetId, setActivePresetId] = useState("");
  const [presetName, setPresetName] = useState("Meu primeiro rig");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<View>("board");
  const [engine, setEngine] = useState("interface demo");
  const [notice, setNotice] = useState("");
  const [modelName, setModelName] = useState("");
  const [ampFamily, setAmpFamily] = useState<AmpFamily | "auto">("british");

  useEffect(() => { saveDraft(chain); }, [chain]);
  useEffect(() => {
    if (isTauri()) {
      void invoke<string>("audio_engine_status")
        .then((status) => setEngine(status === "not_implemented" ? "áudio não implementado" : status))
        .catch(() => setEngine("motor indisponível"));
    }
  }, []);

  const selected = chain.find((effect) => effect.id === selectedId) ?? null;
  const selectedIndex = selected ? chain.findIndex((effect) => effect.id === selected.id) : -1;
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
    setSelectedId(null);
    setView("board");
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
    setView("board");
    setSelectedId(null);
    setActivePresetId("");
    setPresetName("Novo preset");
    setNotice("Rig de demonstração restaurado.");
  }


  function clearChain() {
    setChain([]);
    setSelectedId(null);
    setActivePresetId("");
    setPresetName("Novo rig");
    setNotice("Pedalboard vazio. Adicione efeitos pela Biblioteca.");
  }

  function openView(next: View) {
    setView(next);
    if (next !== "board") setSelectedId(null);
  }

  useEffect(() => {
    function escapeToClose(event: KeyboardEvent) {
      if (event.key === "Escape") setSelectedId(null);
    }
    window.addEventListener("keydown", escapeToClose);
    return () => window.removeEventListener("keydown", escapeToClose);
  }, []);

  function chooseModel(filename: string) {
    setModelName(filename);
    setAmpFamily("auto");
    setNotice("Modelo selecionado para a visualização. O NAM ainda não processa áudio no Tauri.");
  }

  function resetSelectedParameters() {
    if (!selected) return;
    const defaults = createPedal(selected.kind).values;
    setChain((previous) => previous.map((effect) =>
      effect.id === selected.id ? { ...effect, values: defaults } : effect
    ));
  }
  return (
    <div className="app clean-ui">
      <header className="topbar clean-topbar">
        <div className="brand">
          <div className="brand-mark"><AudioLines size={21} strokeWidth={2.5} /></div>
          <div><strong>VTT<em>RIG</em></strong></div>
        </div>
        <div className="preset-compact" aria-label="Gerenciador de presets">
          <label htmlFor="preset-picker">PRESET</label>
          <select id="preset-picker" value={activePresetId} onChange={(event) => {
            if (event.target.value) loadPreset(event.target.value);
          }}>
            <option value="">Personalizado</option>
            {presets.map((preset) => <option value={preset.id} key={preset.id}>{preset.name}</option>)}
          </select>
          <input id="preset-name" aria-label="Nome do preset" maxLength={100} value={presetName} onChange={(event) => setPresetName(event.target.value)} />
          <button type="button" className="compact-icon-button" onClick={saveCurrentPreset} title="Salvar preset" aria-label="Salvar preset"><Save size={18} /></button>
        </div>
        <div className="model-compact">
          <label htmlFor="amp-example">MODELO</label>
          <select id="amp-example" value={DEMO_MODELS.includes(modelName) ? modelName : ""} onChange={(event) => {
            if (event.target.value) chooseModel(event.target.value);
          }}>
            <option value="">{humanizeModelName(modelName)}</option>
            {DEMO_MODELS.map((name) => <option key={name} value={name}>{humanizeModelName(name)}</option>)}
          </select>
          <span className="preview-dot" title="Motor de áudio ainda não conectado" />
        </div>
      </header>

      <div className="workspace clean-workspace">
        <nav className="view-rail" aria-label="Navegação principal">
          <button type="button" className={`rail-tab ${view === "board" ? "active" : ""}`} aria-current={view === "board" ? "page" : undefined} onClick={() => openView("board")}>
            <span className="rail-icon"><Plus size={27} /></span><span>Pedalboard</span>
          </button>
          <button type="button" className={`rail-tab ${view === "library" ? "active" : ""}`} aria-current={view === "library" ? "page" : undefined} onClick={() => openView("library")}>
            <span className="rail-icon"><LibraryBig size={25} /></span><span>Biblioteca</span><small>NAMs / IRs / Pedais</small>
          </button>
          <button type="button" className={`rail-tab ${view === "settings" ? "active" : ""}`} aria-current={view === "settings" ? "page" : undefined} onClick={() => openView("settings")}>
            <span className="rail-icon"><Settings2 size={26} /></span><span>Configurações</span>
          </button>
        </nav>

        <main className="stage clean-stage">
          {view === "board" && (
            <div className="board-view">
              <AmpHero
                minimal
                modelName={modelName}
                overrideFamily={ampFamily}
                onModelChosen={(file) => chooseModel(file.name)}
                onOverrideChange={setAmpFamily}
              />

              {selected && (
                <PedalFocusPanel
                  pedal={selected}
                  position={selectedIndex}
                  count={chain.length}
                  onClose={() => setSelectedId(null)}
                  onToggle={() => toggle(selected.id)}
                  onParameter={(key, value) => setParameter(selected.id, key, value)}
                  onMove={(position) => setChain((previous) => movePedal(previous, selected.id, position))}
                  onReset={resetSelectedParameters}
                  onSavePreset={saveCurrentPreset}
                />
              )}

              <section className="signal-route clean-route" aria-label="Cadeia de pedais">
                <div className="route-label">
                  <span className="in-out-marker" /> INPUT
                  <span className="cable-line" />
                  <span className="chain-count">{chain.length} {chain.length === 1 ? "PEDAL" : "PEDAIS"}</span>
                </div>
                <div className="effects-grid"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => dropAt(event, chain.length)}
                >
                  {chain.length === 0 ? (
                    <button type="button" className="empty-add" onClick={() => openView("library")} aria-label="Adicionar primeiro efeito">
                      <Plus size={34} /><strong>Adicionar primeiro efeito</strong>
                      <span>Escolha um NAM, IR ou pedal na Biblioteca</span>
                    </button>
                  ) : (
                    <>
                      <button type="button" className="add-slot clean-add-slot" aria-label="Adicionar efeito" title="Adicionar efeito" onClick={() => openView("library")}>
                        <Plus size={27} /><span>Adicionar</span>
                      </button>
                      {chain.map((effect, index) => (
                        <PedalFace key={effect.id} index={index} pedal={effect}
                          selected={selectedId === effect.id}
                          onSelect={() => setSelectedId((current) => current === effect.id ? null : effect.id)}
                          onToggle={() => toggle(effect.id)}
                          onRemove={() => remove(effect.id)}
                          onParameter={(key, value) => setParameter(effect.id, key, value)}
                          onMoveDragStart={(event) => event.dataTransfer.setData("text/plain", `chain:${effect.id}`)}
                          onDrop={dropAt}
                        />
                      ))}
                    </>
                  )}
                </div>
                <div className="route-label last"><span className="cable-line" /> OUTPUT <span className="in-out-marker" /></div>
              </section>
              <footer className="board-footer">
                <span><span className="preview-dot" /> INTERFACE DE DEMONSTRAÇÃO · {engine}</span>
                {chain.length > 0 && <button type="button" onClick={clearChain}>Limpar cadeia</button>}
              </footer>
            </div>
          )}

          {view === "library" && (
            <section className="library-view" aria-label="Biblioteca de efeitos">
              <div className="library-heading">
                <span className="eyebrow">SEU UNIVERSO DE TIMBRES</span>
                <h1>Biblioteca<span>.</span></h1>
                <p>Escolha seus efeitos. A ordem dos pedais é sempre sua.</p>
              </div>
              <div className="library-categories">
                <article className="collection-card">
                  <div className="collection-icon"><Guitar size={23}/></div><h2>NAMs</h2>
                  <p>Capturas de amplificadores e drives. Atualmente disponíveis para pré-visualização da skin.</p>
                  <label className="collection-upload">Selecionar .nam
                    <input type="file" accept=".nam" onChange={(event) => {
                      const file = event.target.files?.[0]; if (file) chooseModel(file.name);
                      event.target.value = "";
                    }} />
                  </label>
                  <button type="button" className="secondary-button" onClick={() => add("amp")}> <Plus size={15}/> Adicionar VTTAMP</button>
                  <button type="button" className="secondary-button" onClick={() => add("drive")}> <Plus size={15}/> Adicionar VTTDRIVE</button>
                </article>
                <article className="collection-card">
                  <div className="collection-icon"><Waves size={23}/></div><h2>IRs</h2>
                  <p>Respostas de impulso para gabinetes. O carregamento de áudio real será integrado depois.</p>
                  <button type="button" className="secondary-button" onClick={() => add("cabinet")}><Plus size={15}/> Adicionar VTTCAB</button>
                </article>
              </div>

              <div className="library-heading library-pedals-heading">
                <span className="eyebrow">EFEITOS VTTRIG</span><h2>Pedais<span>.</span></h2>
                <input className="library-search" type="search" value={search} placeholder="Buscar pedal..." onChange={(event) => setSearch(event.target.value)} aria-label="Buscar pedais" />
              </div>
              <div className="library-list clean-library-list">
                {searchedPedals.map((kind) => (
                  <div key={kind} className="library-item"
                    draggable
                    onDragStart={(event) => event.dataTransfer.setData("text/plain", `library:${kind}`)}
                    style={{ "--pedal-accent": PEDALS[kind].accent } as CSSProperties}>
                    <span className="library-icon">{kind === "amp" || kind === "drive" ? <Zap size={19} /> : <Waves size={19} />}</span>
                    <div className="library-item-text"><strong>{VTT_PEDAL_NAMES[kind]}</strong><small>{PEDALS[kind].caption}</small></div>
                    <button type="button" aria-label={`Adicionar ${VTT_PEDAL_NAMES[kind]}`} onClick={() => add(kind)}><Plus size={18}/></button>
                  </div>
                ))}
                {searchedPedals.length === 0 && <p className="quiet">Nenhum efeito encontrado.</p>}
              </div>
              <button type="button" className="secondary-button library-back" onClick={() => openView("board")}>Voltar à pedaleira</button>
            </section>
          )}

          {view === "settings" && (
            <section className="settings-view" aria-label="Configurações VTTRIG">
              <div className="library-heading"><span className="eyebrow">VTTRIG STUDIO</span><h1>Configurações<span>.</span></h1><p>Preferências do rig e estado atual do processamento.</p></div>
              <div className="settings-stack">
                <div className="settings-card"><SlidersHorizontal size={23}/><div><h2>Motor de áudio</h2><p>{engine}. A interface Tauri ainda não envia parâmetros ao NAM/JACK.</p></div><span className="offline-pill">OFFLINE</span></div>
                <div className="settings-card"><Guitar size={23}/><div><h2>Visual do amplificador</h2><p>A skin acompanha o nome do NAM. Você pode corrigir a família manualmente.</p>
                  <label htmlFor="skin-family">Família visual</label>
                  <select id="skin-family" value={ampFamily} onChange={(event) => setAmpFamily(event.target.value as AmpFamily | "auto")}>
                    <option value="auto">Automático pelo nome</option>
                    {AMP_FAMILIES.map((family) => <option value={family.id} key={family.id}>{family.title}</option>)}
                  </select>
                </div></div>
                <div className="settings-card"><BookOpen size={23}/><div><h2>Seu rig</h2><p>Abra uma cadeia vazia ou carregue a pedaleira de demonstração.</p></div>
                  <div className="settings-actions"><button type="button" className="secondary-button" onClick={clearChain}><Trash2 size={15}/> Limpar</button><button type="button" className="primary-button" onClick={resetChain}><RotateCcw size={15}/> Carregar rig exemplo</button></div>
                </div>
                {activePresetId && <button type="button" className="secondary-button" onClick={deletePreset}><Trash2 size={15}/> Excluir preset atual</button>}
              </div>
            </section>
          )}

          {notice && <div className="notification" role="status">{notice}<button type="button" aria-label="Fechar mensagem" onClick={() => setNotice("")}>×</button></div>}
        </main>
      </div>
    </div>
  );
}
