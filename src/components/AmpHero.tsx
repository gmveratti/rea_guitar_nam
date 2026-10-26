import { useRef, useState, type CSSProperties, type DragEvent } from "react";
import { Cpu, FileAudio2, FolderOpen, Info, Plus, RotateCw, Upload } from "lucide-react";
import { AMP_FAMILIES, classifyNamFilename, humanizeModelName, type AmpFamily } from "../lib/ampSkins";

type Props = {
  modelName: string;
  overrideFamily: AmpFamily | "auto";
  onModelChosen: (file: File) => void;
  onOverrideChange: (family: AmpFamily | "auto") => void;
  minimal?: boolean;
};

const DEMOS = [
  "Marshall_JCM800_2203_A2.nam",
  "Fender_Twin_Reverb_A2.nam",
  "Hiwatt_DR103_Classic.nam",
  "Vox_AC30_TopBoost.nam",
  "Mesa_Dual_Rectifier.nam",
];

function FaceKnob({ label, index }: { label: string; index: number }) {
  const [position, setPosition] = useState(index === 0 ? 7 : 5);
  return (
    <label className="face-control" title="Controle visual da interface. Não altera o áudio NAM.">
      <span className="face-control-label">{label}</span>
      <span className="face-knob-shell">
        <span className="face-knob" style={{ "--angle": `${position * 27 - 135}deg` } as CSSProperties}>
          <i className="face-knob-mark" />
        </span>
        <input
          aria-label={`${label}: ajuste visual`}
          type="range" min="0" max="10" step="1" value={position}
          onChange={(event) => setPosition(Number(event.target.value))}
        />
      </span>
      <span className="face-control-value">{position}</span>
    </label>
  );
}

export default function AmpHero({ modelName, overrideFamily, onModelChosen, onOverrideChange, minimal = false }: Props) {
  const skin = classifyNamFilename(modelName, overrideFamily);
  const [error, setError] = useState("");
  const [powered, setPowered] = useState(true);
  const emptyPicker = useRef<HTMLInputElement>(null);
  function importCandidate(file: File | undefined) {
    if (!file) return;
    if (!/\.nam$/i.test(file.name)) {
      setError("Escolha um arquivo .nam. A importação de áudio ainda não está implementada.");
      return;
    }
    if (file.size > 200 * 1024 * 1024) {
      setError("O arquivo excede 200 MB. Nenhum conteúdo foi importado.");
      return;
    }
    setError("");
    onModelChosen(file);
  }
  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    importCandidate(event.dataTransfer.files[0]);
  }
  return (
    <section className="hero-zone" aria-label="Amplificador virtual VTTRIG">
      {!minimal && <div className="hero-zone-head">
        <div><span className="hero-caption">01 / AMPLIFIER VIEW</span><h2>Amp studio <span>✦</span></h2></div>
        <div className="hero-status"><span className="status-pulse" /> NAM A2 • VISUAL DEMO</div>
      </div>}

      {modelName ? (
      <div
        className={`amp-art amp-${skin.id} ${powered ? "amp-is-on" : "amp-is-off"}`}
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
      >
        <div className="amp-case">
          <div className="amp-handle" />
          <div className="amp-case-edges" />
          <div className="amp-grille">
            <span className="amp-grille-rim" aria-hidden="true" />
            <div className="amp-branding"><span className="amp-wordmark">VTTRIG</span><span className="amp-edition">{skin.series} · ANALOG SOUL / NEURAL HEART</span></div>
            <span className="grille-caption">{skin.subtitle}</span>
          </div>
          <div className="amp-panel">
            <div className="amp-power"><button type="button" className={`amp-power-switch ${powered ? "powered" : ""}`} aria-label={powered ? "Desligar amplificador" : "Ligar amplificador"} aria-pressed={powered} title="Power do amplificador (visual)" onClick={() => setPowered((on) => !on)}><span className="power-indicator" /></button><small>POWER</small></div>
            <div className="amp-channel"><strong>{skin.title}</strong><span>{skin.channel}</span></div>
            <div className="amp-controls">
              {skin.controls.map((label, index) => <FaceKnob key={skin.id + label} label={label} index={index} />)}
            </div>
            <div className="amp-jack">
              <span className="jack-hole" />
              <svg className="amp-cable" aria-hidden="true" viewBox="0 0 95 160" fill="none">
                <path className="amp-cable-metal" d="M 2 12 L 18 27" />
                <path className="amp-cable-plug" d="M 15 24 L 29 38" />
                <path className="amp-cable-wire" d="M 27 37 C 43 52, 47 72, 39 91 C 31 109, 46 134, 39 162" />
                <path className="amp-cable-highlight" d="M 32 42 C 45 58, 44 76, 38 91" />
              </svg>
              <small>INPUT</small>
            </div>
          </div>
        </div>
      </div>
      ) : (
        <div className="amp-art amp-art-empty" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
          <div className="amp-empty-slot">
            <span className="amp-empty-eyebrow">VTTRIG / AMPLIFIER</span>
            <button
              type="button"
              className="amp-empty-add"
              aria-label="Adicionar amplificador NAM"
              onClick={() => emptyPicker.current?.click()}
            >
              <Plus size={34} strokeWidth={1.6} />
            </button>
            <strong>Adicionar amplificador</strong>
            <span>Selecione um modelo .nam ou arraste o arquivo para cá</span>
            <small>A seleção do modelo altera somente o visual nesta versão.</small>
            <input
              ref={emptyPicker}
              type="file"
              accept=".nam"
              className="amp-empty-file-input"
              aria-label="Selecionar arquivo NAM"
              onChange={(event) => {
                importCandidate(event.currentTarget.files?.[0]);
                event.currentTarget.value = "";
              }}
            />
          </div>
        </div>
      )}

      {!minimal && <div className="amp-model-bar">
        <div className="amp-model-info">
          <span className="model-icon"><Cpu size={20} /></span>
          <div><small>MODELO SELECIONADO (VISUAL)</small><strong title={modelName}>{humanizeModelName(modelName)}</strong></div>
        </div>
        <label className="file-picker"><Upload size={16} /> Selecionar .nam
          <input type="file" accept=".nam" onChange={(event) => { importCandidate(event.target.files?.[0]); event.target.value = ""; }} />
        </label>
      </div>}

      {!minimal && <div className="amp-choices">
        <div className="amp-dropdown"><label htmlFor="amp-example">TESTAR SKINS</label><select id="amp-example" value="" onChange={(event) => {
          const value = event.target.value;
          if (value) onModelChosen(new File([], value));
        }}><option value="">Exemplos visuais</option>{DEMOS.map((name) => <option key={name} value={name}>{humanizeModelName(name)}</option>)}</select></div>
        <div className="amp-dropdown"><label htmlFor="skin-family">ESTILO DO AMPLIFICADOR</label><select id="skin-family" value={overrideFamily} onChange={(event) => onOverrideChange(event.target.value as AmpFamily | "auto")}><option value="auto">Automático pelo nome</option>{AMP_FAMILIES.filter((item) => item.id !== "generic").map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}<option value="generic">VTTRIG Standard</option></select></div>
        <div className="skin-origin"><RotateCw size={13} /> {skin.match === "manual" ? "Visual escolhido manualmente" : skin.match === "filename" ? "Estilo detectado por nome" : "Estilo VTTRIG padrão"}</div>
      </div>}
      {error ? <div className="model-warning"><Info size={15}/>{error}</div> : null}
      {!minimal && <div className="demo-disclaimer"><FileAudio2 size={14}/><span>O arquivo selecionado altera apenas a aparência. A2-Lite/Full, processamento de áudio e leitura de metadados serão integrados ao motor nativo em uma próxima etapa.</span><FolderOpen size={14}/></div>}
    </section>
  );
}
