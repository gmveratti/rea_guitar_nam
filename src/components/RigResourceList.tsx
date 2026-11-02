import { FolderOpen, X } from "lucide-react";

type Props = {
  ampPath: string;
  cabPath: string;
  onPick: () => void;
  onClear: () => void;
  onPickCab: () => void;
  onClearCab: () => void;
  native: boolean;
};
const fileLabel = (path: string) => path.split(/[\\/]/).pop() || path;

/** A NAM belongs to the main amplifier, never to a stompbox in the chain. */
export default function RigResourceList({ ampPath, cabPath, onPick, onClear, onPickCab, onClearCab, native }: Props) {
  return (
    <section className="rig-resources" aria-label="Amplificador principal">
      <h3>Amplificador e gabinete <small>NAM + IR</small></h3>
      <p>Carregue o amplificador .nam e, se precisar, o gabinete IR .wav. Para capturas que já incluem gabinete, deixe o IR vazio.</p>
      <div className="audio-model-row rig-resource-row">
        <strong>NAM principal</strong>
        {native && <button type="button" onClick={onPick} aria-label="Escolher NAM do amplificador principal"><FolderOpen size={15}/> Selecionar .nam</button>}
        <span title={ampPath}>{ampPath ? fileLabel(ampPath) : "Arquivo não selecionado"}</span>
        {ampPath && <button type="button" className="secondary-button" onClick={onClear} aria-label="Limpar NAM principal"><X size={14}/> Limpar</button>}
      </div>
      <div className="audio-model-row rig-resource-row">
        <strong>Gabinete IR (opcional)</strong>
        {native && <button type="button" onClick={onPickCab} aria-label="Escolher IR do gabinete"><FolderOpen size={15}/> Selecionar .wav</button>}
        <span title={cabPath}>{cabPath ? fileLabel(cabPath) : "Sem IR adicional"}</span>
        {cabPath && <button type="button" className="secondary-button" onClick={onClearCab} aria-label="Limpar IR do gabinete"><X size={14}/> Limpar</button>}
      </div>
      {!native && <p className="audio-device-note">Seleção de modelos reais disponível no aplicativo desktop VTTRIG. O navegador mostra apenas a prévia visual.</p>}
    </section>
  );
}
