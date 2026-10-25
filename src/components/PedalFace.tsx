import type { CSSProperties, DragEvent, KeyboardEvent } from "react";
import { GripVertical, Trash2 } from "lucide-react";
import { PEDALS, type PedalInstance } from "../lib/pedals";

export const VTT_PEDAL_NAMES = {
  gate: "VTTGATE",
  compressor: "VTTCOMP",
  sustain: "VTTSUSTAIN",
  drive: "VTTDRIVE",
  amp: "VTTAMP",
  cabinet: "VTTCAB",
  chorus: "VTTCHORUS",
  delay: "VTTDELAY",
  reverb: "VTTREVERB",
} as const;

export const VTT_PEDAL_CODES = {
  gate: "NG-01", compressor: "CP-01", sustain: "SU-01",
  drive: "OD-N", amp: "AM-N", cabinet: "IR-01",
  chorus: "CH-01", delay: "DL-01", reverb: "RV-01",
} as const;

type PedalProps = {
  pedal: PedalInstance;
  index: number;
  selected: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onRemove: () => void;
  onParameter: (key: string, value: number) => void;
  onMoveDragStart: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>, index: number) => void;
};

export default function PedalFace({
  pedal, index, selected, onSelect, onToggle, onRemove, onParameter,
  onMoveDragStart, onDrop,
}: PedalProps) {
  const def = PEDALS[pedal.kind];
  const label = VTT_PEDAL_NAMES[pedal.kind];
  const code = VTT_PEDAL_CODES[pedal.kind];
  const variables = { "--pedal-color": def.accent } as CSSProperties;

  function selectOnKeyboard(event: KeyboardEvent<HTMLElement>) {
    if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      onSelect();
    }
  }

  return (
    <article
      className={["pedal-shell", selected ? "is-selected" : "", pedal.enabled ? "" : "is-bypassed"].join(" ")}
      style={variables}
      role="group"
      aria-label={label + ": posição " + (index + 1)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => onDrop(event, index)}
    >
      <div className="stomp-topbar">
        <span>{String(index + 1).padStart(2, "0")}</span>
        <span className="stomp-drag" title="Arraste para reorganizar" draggable onDragStart={onMoveDragStart}>
          <GripVertical size={14} /><span>ARRASTAR</span>
        </span>
        <button type="button" className="stomp-remove" aria-label={"Remover " + label} title="Remover pedal" onClick={onRemove}><Trash2 size={13}/></button>
      </div>
      <div
        className="stomp-chassis"
        tabIndex={0}
        role="button"
        aria-label={"Selecionar controles de " + label}
        onClick={onSelect}
        onKeyDown={selectOnKeyboard}
      >
        <div className="stomp-screw screw-left" />
        <div className="stomp-screw screw-right" />
        <div className="stomp-ridge" aria-hidden="true" />
        <div className="stomp-knobs">
          {def.parameters.slice(0, 3).map((p) => {
            const value = pedal.values[p.key] ?? p.defaultValue;
            const fraction = (value - p.min) / (p.max - p.min);
            return (
              <label className="stomp-knob-control" key={p.key} onClick={(event) => event.stopPropagation()}>
                <span>{p.label.toUpperCase()}</span>
                <span className="stomp-knob" style={{ "--rotation": String(fraction * 270 - 135) + "deg" } as CSSProperties}>
                  <span className="stomp-knob-indicator" />
                  <input
                    aria-label={label + " " + p.label}
                    type="range"
                    min={p.min} max={p.max} step={p.step} value={value}
                    onChange={(event) => onParameter(p.key, Number(event.target.value))}
                  />
                </span>
              </label>
            );
          })}
        </div>
        <div className="stomp-mid">
          <span className="stomp-brand">VTTRIG <small>FX SERIES</small></span>
          <span className={["stomp-led", pedal.enabled ? "lit" : ""].join(" ")} role="img" aria-label={pedal.enabled ? "LED ligado" : "LED desligado"} />
        </div>
        <div className="stomp-type">{def.category}</div>
        <div className="stomp-name">{label}</div>
        <div className="stomp-model">{code}</div>
        <button
          className="stomp-footswitch"
          type="button"
          aria-pressed={pedal.enabled}
          aria-label={(pedal.enabled ? "Desligar " : "Ligar ") + label}
          title={pedal.enabled ? "Bypass (visual)" : "Ligar pedal (visual)"}
          onClick={(event) => { event.stopPropagation(); onToggle(); }}
        ><span className="stomp-plate"><span className="stomp-press-label">{pedal.enabled ? "ON" : "OFF"}</span></span></button>
        <span className="stomp-io stomp-io-left">OUT <span>←</span></span>
        <span className="stomp-io stomp-io-right"><span>←</span> IN</span>
        <div className="stomp-bottom-mark">DESIGNED BY VTTRIG</div>
      </div>
    </article>
  );
}
