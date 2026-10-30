import { FolderOpen, X } from "lucide-react";

type Props = {
  ampPath: string;
  onPick: () => void;
  onClear: () => void;
  native: boolean;
};
const fileLabel = (path: string) => path.split(/[\\/]/).pop() || path;

/** A NAM belongs to the main amplifier, never to a stompbox in the chain. */
export default function RigResourceList({ ampPath, onPick, onClear, native }: Props) {
  return (
    <section className="rig-resources" aria-label="Amplificador principal">
      <h3>Amplificador principal <small>NAM</small></h3>
      <p>O modelo .nam é carregado no cabeçote principal, separado da cadeia de pedais. Para aplicar alterações no áudio, pare e reinicie a sessão.</p>
      <div className="audio-model-row rig-resource-row">
        <strong>NAM principal</strong>
        {native && <button type="button" onClick={onPick} aria-label="Escolher NAM do amplificador principal"><FolderOpen size={15}/> Selecionar .nam</button>}
        <span title={ampPath}>{ampPath ? fileLabel(ampPath) : "Arquivo não selecionado"}</span>
        {ampPath && <button type="button" className="secondary-button" onClick={onClear} aria-label="Limpar NAM principal"><X size={14}/> Limpar</button>}
      </div>
      {!native && <p className="audio-device-note">Seleção de modelos reais disponível no aplicativo desktop VTTRIG. O navegador mostra apenas a prévia visual.</p>}
    </section>
  );
}
