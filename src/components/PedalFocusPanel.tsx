import type { CSSProperties } from "react";
import { ArrowLeft, ArrowRight, CirclePower, RotateCcw, Save, X } from "lucide-react";
import { PEDALS, type PedalInstance } from "../lib/pedals";
import { VTT_PEDAL_NAMES } from "./PedalFace";

type Props = {
  pedal: PedalInstance;
  position: number;
  count: number;
  onClose: () => void;
  onToggle: () => void;
  onParameter: (key: string, value: number) => void;
  onMove: (position: number) => void;
  onReset: () => void;
  onSavePreset: () => void;
};

/**
 * The editor reflects the selected pedal instance; no copy of its settings is
 * kept here. Preset serialization remains the responsibility of the rig.
 */
export default function PedalFocusPanel({
  pedal, position, count, onClose, onToggle, onParameter, onMove, onReset, onSavePreset,
}: Props) {
  const definition = PEDALS[pedal.kind];
  const label = VTT_PEDAL_NAMES[pedal.kind];

  return (
    <section
      className="pedal-focus"
      aria-label={`Configurar ${label}`}
      style={{ "--focus-accent": definition.accent } as CSSProperties}
    >
      <header className="pedal-focus-head">
        <div>
          <span className="eyebrow">EDITAR PEDAL / {String(position + 1).padStart(2, "0")}</span>
          <h2>{label} <span className="pedal-focus-live">{pedal.enabled ? "ATIVO" : "BYPASS"}</span></h2>
          <p>{definition.description}</p>
        </div>
        <button className="focus-close" type="button" onClick={onClose} aria-label="Fechar editor do pedal">
          <X size={19} />
        </button>
      </header>
      <div className="focus-parameters">
        {definition.parameters.map((parameter) => {
          const value = pedal.values[parameter.key] ?? parameter.defaultValue;
          return (
            <label className="focus-parameter" key={parameter.key}>
              <span className="focus-parameter-heading">
                <strong>{parameter.label}</strong>
                <span>{Number(value.toFixed(2))} {parameter.unit}</span>
              </span>
              <input
                type="range"
                min={parameter.min}
                max={parameter.max}
                step={parameter.step}
                value={value}
                aria-label={`${label}: ${parameter.label}`}
                onChange={(event) => onParameter(parameter.key, Number(event.target.value))}
              />
            </label>
          );
        })}
      </div>
      <footer className="pedal-focus-actions">
        <div className="focus-order">
          <button type="button" disabled={position === 0} onClick={() => onMove(position - 1)} aria-label="Mover pedal para a esquerda"><ArrowLeft size={17} /></button>
          <button type="button" disabled={position === count - 1} onClick={() => onMove(position + 1)} aria-label="Mover pedal para a direita"><ArrowRight size={17} /></button>
          <span>Arraste na cadeia ou use as setas</span>
        </div>
        <div className="focus-buttons">
          <button type="button" className="secondary-button" onClick={onReset}><RotateCcw size={16} /> Padrão</button>
          <button type="button" className="secondary-button" onClick={onToggle}><CirclePower size={16} /> {pedal.enabled ? "Desligar" : "Ligar"}</button>
          <button type="button" className="primary-button" onClick={onSavePreset}><Save size={16} /> Salvar preset</button>
        </div>
      </footer>
      <span className="focus-disclaimer">Preview visual: os parâmetros ainda não controlam o motor DSP.</span>
    </section>
  );
}
