import { FolderOpen, X } from "lucide-react";
import { type PedalInstance } from "../lib/pedals";
import { type RigResources } from "../lib/liveRig";

type Props = {
  chain: readonly PedalInstance[];
  resources: Readonly<RigResources>;
  onPick: (id: string, kind: "amp" | "drive" | "cabinet") => void;
  onClear: (id: string) => void;
  native: boolean;
};

const fileLabel = (path: string) => path.split(/[\\/]/).pop() || path;

export default function RigResourceList({ chain, resources, onPick, onClear, native }: Props) {
  const models = chain.filter((p): p is PedalInstance & { kind: "amp" | "drive" | "cabinet" } =>
    p.kind === "amp" || p.kind === "drive" || p.kind === "cabinet");

  return (
    <section className="rig-resources" aria-label="Modelos e IRs do rig">
      <h3>Modelos da pedalboard <small>NAM / IR</small></h3>
      <p>Associe arquivos reais a cada módulo. O áudio respeita a ordem acima e cada footswitch. Mudanças durante o monitoramento precisam reiniciar a sessão.</p>
      {models.length === 0 && <p role="status">Adicione um amplificador NAM ou gabinete IR pela Biblioteca.</p>}
      {models.map((pedal, index) => {
        const path = resources[pedal.id];
        const title = pedal.kind === "cabinet" ? "VTTCAB · IR" : pedal.kind === "drive" ? "VTTDRIVE · NAM" : "VTTAMP · NAM";
        return (
          <div className="audio-model-row rig-resource-row" key={pedal.id}>
            <strong>{index + 1}. {title}</strong>
            {native && <button type="button" onClick={() => onPick(pedal.id, pedal.kind)}
              aria-label={`Escolher arquivo para ${title} ${index + 1}`}><FolderOpen size={15}/> Selecionar {pedal.kind === "cabinet" ? ".wav" : ".nam"}</button>}
            <span title={path ?? ""}>{path ? fileLabel(path) : "Arquivo não selecionado"}</span>
            {path && <button type="button" className="secondary-button" onClick={() => onClear(pedal.id)}
              aria-label={`Limpar arquivo de ${title} ${index + 1}`}><X size={14}/> Limpar</button>}
          </div>
        );
      })}
      {!native && <p className="audio-device-note">Seleção de arquivos reais disponível no aplicativo desktop VTTRIG. O navegador mantém apenas a demonstração visual.</p>}
    </section>
  );
}
