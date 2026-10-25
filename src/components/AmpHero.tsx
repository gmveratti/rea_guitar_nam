import { useState, type CSSProperties, type DragEvent } from "react";
import { Cpu, FileAudio2, FolderOpen, Info, RotateCw, Upload } from "lucide-react";
import { AMP_FAMILIES, classifyNamFilename, humanizeModelName, type AmpFamily } from "../lib/ampSkins";

type Props = {
  modelName: string;
  overrideFamily: AmpFamily | "auto";
  onModelChosen: (file: File) => void;
  onOverrideChange: (family: AmpFamily | "auto") => void;
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

export default function AmpHero({ modelName, overrideFamily, onModelChosen, onOverrideChange }: Props) {
  const skin = classifyNamFilename(modelName, overrideFamily);
  const [error, setError] = useState("");
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
      <div className="hero-zone-head">
        <div><span className="hero-caption">01 / AMPLIFIER VIEW</span><h2>Amp studio <span>✦</span></h2></div>
        <div className="hero-status"><span className="status-pulse" /> NAM A2 • VISUAL DEMO</div>
      </div>

      <div
        className={`amp-art amp-${skin.id}`}
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
      >
        <div className="amp-case">
          <div className="amp-handle" />
          <div className="amp-case-edges" />
          <div className="amp-grille">
            <div className="amp-branding"><span className="amp-wordmark">VTTRIG</span><span className="amp-edition">{skin.series}</span></div>
            <span className="grille-caption">{skin.subtitle}</span>
          </div>
          <div className="amp-panel">
            <div className="amp-power"><span className="power-indicator" /><small>POWER</small></div>
            <div className="amp-channel"><strong>{skin.title}</strong><span>{skin.channel}</span></div>
            <div className="amp-controls">
              {skin.controls.map((label, index) => <FaceKnob key={skin.id + label} label={label} index={index} />)}
            </div>
            <div className="amp-jack"><span className="jack-hole" /><small>INPUT</small></div>
          </div>
        </div>
      </div>

      <div className="amp-model-bar">
        <div className="amp-model-info">
          <span className="model-icon"><Cpu size={20} /></span>
          <div><small>MODELO SELECIONADO (VISUAL)</small><strong title={modelName}>{humanizeModelName(modelName)}</strong></div>
        </div>
        <label className="file-picker"><Upload size={16} /> Selecionar .nam
          <input type="file" accept=".nam" onChange={(event) => { importCandidate(event.target.files?.[0]); event.target.value = ""; }} />
        </label>
      </div>

      <div className="amp-choices">
        <div className="amp-dropdown"><label htmlFor="amp-example">TESTAR SKINS</label><select id="amp-example" value="" onChange={(event) => {
          const value = event.target.value;
          if (value) onModelChosen(new File([], value));
        }}><option value="">Exemplos visuais</option>{DEMOS.map((name) => <option key={name} value={name}>{humanizeModelName(name)}</option>)}</select></div>
        <div className="amp-dropdown"><label htmlFor="skin-family">ESTILO DO AMPLIFICADOR</label><select id="skin-family" value={overrideFamily} onChange={(event) => onOverrideChange(event.target.value as AmpFamily | "auto")}><option value="auto">Automático pelo nome</option>{AMP_FAMILIES.filter((item) => item.id !== "generic").map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}<option value="generic">VTTRIG Standard</option></select></div>
        <div className="skin-origin"><RotateCw size={13} /> {skin.match === "manual" ? "Visual escolhido manualmente" : skin.match === "filename" ? "Estilo detectado por nome" : "Estilo VTTRIG padrão"}</div>
      </div>
      {error ? <div className="model-warning"><Info size={15}/>{error}</div> : null}
      <div className="demo-disclaimer"><FileAudio2 size={14}/><span>O arquivo selecionado altera apenas a aparência. A2-Lite/Full, processamento de áudio e leitura de metadados serão integrados ao motor nativo em uma próxima etapa.</span><FolderOpen size={14}/></div>
    </section>
  );
}
