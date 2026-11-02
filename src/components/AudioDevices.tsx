import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { AudioLines, RefreshCw, Square, Volume2 } from "lucide-react";
import { audioFaultReason } from "../lib/audioFaults";
import {
  isAudioSessionSelectionValid, reconcileAudioSessionSelection, selectAudioHost, selectAudioInput,
  type AudioHost, type AudioSessionSelection, type NativeAudioSelection,
} from "../lib/audioSessionSelection";
import { loadAudioSettings, saveAudioSettings } from "../lib/audioSettings";
import { type PedalInstance } from "../lib/pedals";
import { buildLiveBoardSnapshot, type AmpLevels } from "../lib/liveRig";
import { createLiveRigSync } from "../lib/liveRigSync";

type HostInfo = AudioHost;
type MonitorStatus = { running: boolean; failed: boolean; inputFailed: boolean; outputFailed: boolean; mode: string; selection: NativeAudioSelection | null };
type LiveStatus = { running: boolean; failed: boolean; inputFailed: boolean; outputFailed: boolean; engineFailed: boolean; underruns: number; overflows: number; mode: string; selection: NativeAudioSelection | null; appliedManifest: string | null };
type Mode = "dry" | "wet";

const BUFFER_OPTIONS = [64, 128, 256, 512, 1024];
const RATE = 48000;
type Props = {
  chain: readonly PedalInstance[];
  ampPath: string;
  cabPath: string;
  ampPowered: boolean;
  ampLevels: AmpLevels;
  compact?: boolean;
  sessionSelection: AudioSessionSelection;
  setSessionSelection: Dispatch<SetStateAction<AudioSessionSelection>>;
};

export default function AudioDevices({ chain, ampPath, cabPath, ampPowered, ampLevels, compact = false, sessionSelection, setSessionSelection }: Props) {
  const native = isTauri();
  // Preserve model selection when navigating away or restarting the WebView.
  // Device indices remain session-only: enumeration order can change after USB reconnect.
  const [saved] = useState(loadAudioSettings);
  const [hosts, setHosts] = useState<HostInfo[]>([]);
  const { hostId, inputIndex, inputChannel, outputIndex } = sessionSelection;
  const [frames, setFrames] = useState(saved.bufferFrames);
  const [mode, setMode] = useState<Mode>("wet");
  const [activeMode, setActiveMode] = useState<Mode | null>(null);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [startingLive, setStartingLive] = useState(false);
  const [message, setMessage] = useState("");
  const [appliedManifest, setAppliedManifest] = useState<string | null>(null);
  const [liveStats, setLiveStats] = useState<LiveStatus | null>(null);
  const [dryStatus, setDryStatus] = useState<MonitorStatus | null>(null);
  const [updatingRig, setUpdatingRig] = useState(false);
  const rigSync = useMemo(() => createLiveRigSync({
    apply: (manifest) => invoke("audio_update_live", { chainJson: manifest }),
    onApplied: (manifest) => {
      setAppliedManifest(manifest);
      setMessage("Amplificador, IR e pedais atualizados.");
    },
    onError: (error) => setMessage(`Não foi possível aplicar o rig: ${String(error)}. O som anterior foi mantido.`),
    onBusy: setUpdatingRig,
  }), []);

  useEffect(() => {
    // Save only the chosen setup, never live streams, a "running" flag or USB indices.
    // Existing file paths are revalidated by the Rust/C++ backend on Start.
    saveAudioSettings({
      version: 1, mode, bufferFrames: frames, inputChannel,
      // Historical test settings are kept solely for migration; the board is now canonical.
      ampPath: saved.ampPath, cabPath: saved.cabPath,
      irBeforeAmp: saved.irBeforeAmp, bypassAmp: saved.bypassAmp, bypassCab: saved.bypassCab,
    });
  }, [mode, frames, inputChannel, saved]);

  const selected = useMemo(() => hosts.find((h) => h.id === hostId), [hosts, hostId]);
  const inputs = selected?.inputs.filter((d) => d.supportsMonitor) ?? [];
  const outputs = selected?.outputs.filter((d) => d.supportsMonitor) ?? [];
  const channelCount = inputs.find((d) => String(d.index) === inputIndex)?.channels ?? 0;
  const livePlan = useMemo(() => {
    try { return { preview: buildLiveBoardSnapshot(chain, ampPath, ampPowered, cabPath, ampLevels), error: "" }; }
    catch (error) { return { preview: null, error: String(error).replace(/^Error: /, "") }; }
  }, [chain, ampPath, ampPowered, cabPath, ampLevels]);
  const selectionValid = isAudioSessionSelectionValid(sessionSelection, hosts);
  const livePreview = livePlan.preview;
  const liveManifest = livePreview ? JSON.stringify({ schemaVersion: 1, nodes: livePreview.nodes }) : null;

  const refresh = useCallback(async () => {
    if (!native) return;
    setBusy(true);
    try {
      const [available, dry, wet] = await Promise.all([
        invoke<HostInfo[]>("audio_list_hosts"),
        invoke<MonitorStatus>("audio_monitor_status"),
        invoke<LiveStatus>("audio_live_status"),
      ]);
      setHosts(available);
      setLiveStats(wet);
      setDryStatus(dry);
      // A refresh must not overwrite the user's saved WET choice when idle.
      if (wet.running || dry.running) setMode(wet.running ? "wet" : "dry");
      setRunning(dry.running || wet.running);
      setActiveMode(wet.running ? "wet" : dry.running ? "dry" : null);
      setAppliedManifest(wet.running ? wet.appliedManifest : null);
      const actual = wet.running ? wet.selection : dry.running ? dry.selection : null;
      setSessionSelection((previous) => reconcileAudioSessionSelection(previous, available, actual));
      if (actual) setFrames(actual.bufferFrames);
      setMessage("");
    } catch (error) {
      setMessage(`Não foi possível consultar os dispositivos: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  }, [native, setSessionSelection]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!native || !running || activeMode !== "wet") return;
    rigSync.begin(appliedManifest);
    return () => rigSync.stop();
    // The applied manifest is the initial baseline. Subsequent edits are
    // acknowledged by the serialized updater without resetting its generation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [native, running, activeMode, rigSync]);

  useEffect(() => {
    if (!native || !running || activeMode !== "wet" || !liveManifest) return;
    const timer = setTimeout(() => rigSync.request(liveManifest), 200);
    return () => clearTimeout(timer);
  }, [native, running, activeMode, liveManifest, rigSync]);

  useEffect(() => {
    // Avoid clearing a restored channel while device enumeration is still pending.
    if (!running && channelCount > 0 && inputChannel >= channelCount) {
      setSessionSelection((previous) => ({ ...previous, inputChannel: 0 }));
    }
  }, [inputChannel, channelCount, running, setSessionSelection]);
  useEffect(() => {
    if (!native || !running || !activeMode) return;
    const tick = () => {
      if (activeMode === "wet") {
        void invoke<LiveStatus>("audio_live_status").then(setLiveStats).catch(() => {});
      } else {
        void invoke<MonitorStatus>("audio_monitor_status").then(setDryStatus).catch(() => {});
      }
    };
    tick();
    const interval = setInterval(tick, 2000);
    return () => clearInterval(interval);
  }, [native, running, activeMode]);

  async function start() {
    if (!native || !selectionValid || busy) return;
    let nextManifest: string | null = null;
    let ignoredCount = 0;
    if (mode === "wet") {
      try {
        const plan = buildLiveBoardSnapshot(chain, ampPath, ampPowered, cabPath, ampLevels);
        nextManifest = JSON.stringify({ schemaVersion: 1, nodes: plan.nodes });
        ignoredCount = plan.ignored.length;
      } catch (error) {
        setMessage(String(error));
        return;
      }
    }
    setBusy(true);
    if (mode === "wet") setStartingLive(true);
    try {
      const selection = {
        hostId, inputIndex: Number(inputIndex),
        outputIndex: Number(outputIndex), bufferFrames: frames, inputChannel,
      };
      if (mode === "wet") {
        await invoke("audio_start_live", { selection, chainJson: nextManifest });
      } else {
        await invoke("audio_start_monitor", { selection });
      }
      setRunning(true);
      setAppliedManifest(nextManifest);
      setDryStatus(null);
      setLiveStats(null);
      setActiveMode(mode);
      setMessage(mode === "wet"
        ? `Áudio ligado. ${ignoredCount ? `${ignoredCount} efeito(s) sem DSP foram ignorados. ` : ""}Alterações de amplificador, IR e pedais são aplicadas automaticamente.`
        : "Monitor DRY ligado: sem amp NAM ou pedais DSP. Use volume baixo.");
    } catch (error) {
      setRunning(false);
      setMessage(`Não foi possível iniciar o áudio: ${String(error)}`);
    } finally {
      setStartingLive(false);
      setBusy(false);
    }
  }

  async function cancelLiveStart() {
    try {
      // The native flag is set immediately; no need to wait for the gate.
      await invoke("audio_cancel_live_start");
      setMessage("Cancelando carregamento do NAM...");
    } catch (error) {
      setMessage(`Não foi possível cancelar o carregamento: ${String(error)}`);
    }
  }

  async function stop() {
    rigSync.stop();
    setBusy(true);
    try {
      await invoke(activeMode === "wet" ? "audio_stop_live" : "audio_stop_monitor");
      setRunning(false);
      setActiveMode(null);
      setAppliedManifest(null);
      setMessage("Monitor de áudio desligado.");
    } catch (error) {
      if (activeMode === "wet") rigSync.begin(appliedManifest);
      setMessage(`Erro ao desligar áudio: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={`settings-card audio-device-card ${compact ? "board-audio-controls" : ""}`} aria-label="Áudio e dispositivos">
      <AudioLines size={23}/>
      <div>
        <h2>Áudio e dispositivos</h2>
        <p>Escolha sua interface, carregue o amplificador NAM e, se necessário, o IR do gabinete. Ligue o áudio para tocar.</p>
        {!native ? (
          <p role="status">Abra o aplicativo desktop para listar drivers e interfaces de áudio. Esta visualização web não acessa seus dispositivos.</p>
        ) : (
          <>
            <div className="audio-device-fields">
              <label htmlFor="audio-host">Driver / backend
                <select id="audio-host" value={hostId} onChange={(event) => setSessionSelection(selectAudioHost(hosts, event.target.value))} disabled={busy || running}>
                  {hostId && !selected && <option value={hostId}>Backend indisponível: {hostId}</option>}
                  {hosts.length === 0 && <option value="">Nenhum backend disponível</option>}
                  {hosts.map((host) => <option key={host.id} value={host.id}>{host.id.toUpperCase()}</option>)}
                </select>
              </label>
              <label htmlFor="audio-input">Entrada
                <select id="audio-input" value={inputIndex} onChange={(event) => {
                  const nextIndex = event.target.value;
                  if (selected) setSessionSelection(previous => selectAudioInput(previous, selected, nextIndex));
                }} disabled={busy || running}>
                  {inputIndex !== "" && !inputs.some((d) => String(d.index) === inputIndex) && <option value={inputIndex}>Entrada indisponível (#{inputIndex})</option>}
                  {inputs.length === 0 && <option value="">Sem entrada compatível / 48 kHz</option>}
                  {inputs.map((d) => <option key={d.index} value={d.index}>{d.name} ({d.channels} canais)</option>)}
                </select>
              </label>
              <label htmlFor="audio-input-channel">Canal da guitarra
                <select id="audio-input-channel" value={inputChannel} onChange={(event) => setSessionSelection((previous) => ({ ...previous, inputChannel: Number(event.target.value) }))} disabled={busy || running || channelCount === 0}>
                  {channelCount === 0 && <option value={inputChannel}>Entrada {inputChannel + 1}</option>}
                  {Array.from({ length: channelCount }, (_, i) => <option value={i} key={i}>Entrada {i + 1}</option>)}
                </select>
              </label>
              <label htmlFor="audio-output">Saída
                <select id="audio-output" value={outputIndex} onChange={(event) => setSessionSelection((previous) => ({ ...previous, outputIndex: event.target.value }))} disabled={busy || running || selected?.id.toLowerCase() === "asio"}>
                  {outputIndex !== "" && !outputs.some((d) => String(d.index) === outputIndex) && <option value={outputIndex}>Saída indisponível (#{outputIndex})</option>}
                  {outputs.length === 0 && <option value="">Sem saída compatível / 48 kHz</option>}
                  {outputs.map((d) => <option key={d.index} value={d.index}>{d.name} ({d.channels} canais)</option>)}
                </select>
              </label>
              <label htmlFor="audio-buffer">Buffer solicitado
                <select id="audio-buffer" value={frames} onChange={(event) => setFrames(Number(event.target.value))} disabled={busy || running}>
                  {BUFFER_OPTIONS.map((v) => <option key={v} value={v}>{v} samples</option>)}
                </select>
              </label>
              <label htmlFor="audio-mode">Modo de monitor
                <select id="audio-mode" value={mode} disabled={busy || running} onChange={(event) => setMode(event.target.value as Mode)}>
                  <option value="dry">DRY · guitarra limpa</option>
                  <option value="wet">NAM · processamento ao vivo</option>
                </select>
              </label>
            </div>
            {mode === "wet" && (
              <section className="audio-live-models" aria-label="Cadeia nativa: pedais + amplificador principal">
                <h3>Cadeia nativa da pedalboard</h3>
                <p>Pedais na ordem escolhida → amplificador NAM → IR opcional. Arquivos, parâmetros dos pedais e bypass são aplicados automaticamente com o áudio ligado.</p>
                {livePreview ? (
                  <>
                    <p role="status">{livePreview.nodes.length} módulo(s) nativo(s) preparado(s) · {livePreview.ignored.length} efeito(s) visual(is) sem DSP serão ignorados.</p>
                    <ol>{livePreview.nodes.map(node =>
                      <li key={node.id}>{node.kind.toUpperCase()} · {node.enabled ? "ligado" : "bypass"} · {('resource' in node ? node.resource.path : 'DSP interno').split(/[\\\\/]/).pop()}</li>
                    )}</ol>
                  </>
                ) : <p className="audio-device-warning" role="status">{livePlan.error}</p>}
              </section>
            )}
            {running && activeMode === "wet" &&
              (appliedManifest === null || liveManifest !== appliedManifest) &&
              <p className="audio-device-note" role="status">{updatingRig ? "Aplicando alterações; o som atual continua durante o carregamento." : "Há alterações pendentes no rig."}</p>}
            {running && <p className="audio-device-note" role="status">Sessão ativa: {hostId.toUpperCase()} · entrada #{inputIndex}, canal {inputChannel + 1} → saída #{outputIndex} · buffer {frames} samples.</p>}
            {!running && hostId && !selectionValid && <p className="audio-device-warning" role="status">A interface selecionada não está disponível. Escolha outro driver/dispositivo ou atualize a lista antes de iniciar.</p>}
            <p className="audio-device-note">48.000 Hz · guitarra mono para as saídas. Windows: escolha ASIO para usar o driver da interface ou WASAPI. Linux: JACK/PipeWire-JACK usa o buffer configurado no servidor.</p>
            <p className="audio-device-warning">Use fones ou volume de saída baixo antes de ligar. Cuidado com microfonia e ganho excessivo de modelos NAM.</p>
            {running && activeMode === "dry" && dryStatus?.failed && (
              <p className="audio-device-warning" role="alert">Falha na {audioFaultReason(dryStatus)}. Pare o monitor, confira a interface e atualize os dispositivos antes de tentar novamente.</p>
            )}
            {running && activeMode === "wet" && liveStats && (
              <p className={liveStats.failed ? "audio-device-warning" : "audio-device-note"} role={liveStats.failed ? "alert" : "status"}>NAM: {liveStats.failed ? `falha em ${audioFaultReason(liveStats)}; pare e revise a configuração` : "ativo"} · amostras em falta: {liveStats.underruns} · descartadas: {liveStats.overflows}. Estes contadores não equivalem à latência.</p>
            )}
            <div className="audio-device-actions">
              <button className="secondary-button" type="button" disabled={busy || running} onClick={() => void refresh()}><RefreshCw size={15}/> Atualizar dispositivos</button>
              {startingLive && !running ? (
                <button type="button" className="secondary-button" onClick={() => void cancelLiveStart()}>
                  <Square size={15}/> Cancelar carregamento NAM
                </button>
              ) : running ? (
                <button type="button" className="primary-button" disabled={busy} onClick={() => void stop()}><Square size={15}/> Parar {activeMode === "wet" ? "NAM" : "DRY"}</button>
              ) : (
                <button type="button" className="primary-button" disabled={busy || !selectionValid || (mode === "wet" && !liveManifest)}
                  onClick={() => void start()}><Volume2 size={15}/> Iniciar {mode === "wet" ? "NAM" : "monitor DRY"}</button>
              )}
            </div>
          </>
        )}
        {message && <p className="audio-device-message" role="status">{message}</p>}
      </div>
    </article>
  );
}
