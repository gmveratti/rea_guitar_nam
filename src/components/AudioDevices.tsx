import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { AudioLines, RefreshCw, Square, Volume2 } from "lucide-react";
import { audioFaultReason } from "../lib/audioFaults";
import { loadAudioSettings, saveAudioSettings } from "../lib/audioSettings";
import { type PedalInstance } from "../lib/pedals";
import { buildLiveBoardSnapshot, type RigResources } from "../lib/liveRig";

type DeviceInfo = { index: number; name: string; channels: number; supportsMonitor: boolean };
type HostInfo = { id: string; inputs: DeviceInfo[]; outputs: DeviceInfo[] };
type MonitorStatus = { running: boolean; failed: boolean; inputFailed: boolean; outputFailed: boolean; mode: string };
type LiveStatus = { running: boolean; failed: boolean; inputFailed: boolean; outputFailed: boolean; engineFailed: boolean; underruns: number; overflows: number; mode: string };
type Mode = "dry" | "wet";

const BUFFER_OPTIONS = [64, 128, 256, 512, 1024];
const RATE = 48000;
type Props = {
  chain: readonly PedalInstance[];
  resources: Readonly<RigResources>;
  ampPowered: boolean;
  compact?: boolean;
};

export default function AudioDevices({ chain, resources, ampPowered, compact = false }: Props) {
  const native = isTauri();
  // Preserve model/IR selections when navigating away or restarting the WebView.
  // Device indices remain session-only: enumeration order can change after USB reconnect.
  const [saved] = useState(loadAudioSettings);
  const [hosts, setHosts] = useState<HostInfo[]>([]);
  const [hostId, setHostId] = useState("");
  const [inputIndex, setInputIndex] = useState("");
  const [inputChannel, setInputChannel] = useState(saved.inputChannel);
  const [outputIndex, setOutputIndex] = useState("");
  const [frames, setFrames] = useState(saved.bufferFrames);
  const [mode, setMode] = useState<Mode>(saved.mode);
  const [activeMode, setActiveMode] = useState<Mode | null>(null);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [appliedManifest, setAppliedManifest] = useState<string | null>(null);
  const [liveStats, setLiveStats] = useState<LiveStatus | null>(null);
  const [dryStatus, setDryStatus] = useState<MonitorStatus | null>(null);

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
    try { return { preview: buildLiveBoardSnapshot(chain, resources, ampPowered), error: "" }; }
    catch (error) { return { preview: null, error: String(error).replace(/^Error: /, "") }; }
  }, [chain, resources, ampPowered]);
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
      setHostId((previous) => available.some((h) => h.id === previous)
        ? previous : (available[0]?.id ?? ""));
      setMessage("");
    } catch (error) {
      setMessage(`Não foi possível consultar os dispositivos: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  }, [native]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!running) {
      setInputIndex(inputs.some((d) => String(d.index) === inputIndex)
        ? inputIndex : (inputs[0] ? String(inputs[0].index) : ""));
      setOutputIndex(outputs.some((d) => String(d.index) === outputIndex)
        ? outputIndex : (outputs[0] ? String(outputs[0].index) : ""));
    }
  }, [hostId, hosts, inputIndex, inputs, outputIndex, outputs, running]);

  useEffect(() => {
    // Avoid clearing a restored channel while device enumeration is still pending.
    if (channelCount > 0 && inputChannel >= channelCount) setInputChannel(0);
  }, [inputChannel, channelCount]);
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
    if (!native || !hostId || inputIndex === "" || outputIndex === "" || busy) return;
    let nextManifest: string | null = null;
    let ignoredCount = 0;
    if (mode === "wet") {
      try {
        const plan = buildLiveBoardSnapshot(chain, resources, ampPowered);
        nextManifest = JSON.stringify({ schemaVersion: 1, nodes: plan.nodes });
        ignoredCount = plan.ignored.length;
      } catch (error) {
        setMessage(String(error));
        return;
      }
    }
    setBusy(true);
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
        ? `NAM/IR da pedalboard iniciado. ${ignoredCount ? `${ignoredCount} efeito(s) visual(is) sem DSP foram ignorados. ` : ""}Alterações de ordem, bypass, power ou recursos exigem Parar e Iniciar.`
        : "Monitor DRY ligado: sem amp NAM ou pedais DSP. Use volume baixo.");
    } catch (error) {
      setRunning(false);
      setMessage(`Não foi possível iniciar o áudio: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    setBusy(true);
    try {
      await invoke(activeMode === "wet" ? "audio_stop_live" : "audio_stop_monitor");
      setRunning(false);
      setActiveMode(null);
      setAppliedManifest(null);
      setMessage("Monitor de áudio desligado.");
    } catch (error) {
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
        <p>Escolha driver, canais e buffer. Teste a guitarra limpa em DRY ou processe VTTGATE, NAM e IR da pedalboard na ordem visual. Compressor, Sustain, Chorus, Delay e Reverb ainda não possuem DSP e são ignorados explicitamente.</p>
        {!native ? (
          <p role="status">Abra o aplicativo desktop para listar drivers e interfaces de áudio. Esta visualização web não acessa seus dispositivos.</p>
        ) : (
          <>
            <div className="audio-device-fields">
              <label htmlFor="audio-host">Driver / backend
                <select id="audio-host" value={hostId} onChange={(event) => setHostId(event.target.value)} disabled={busy || running}>
                  {hosts.length === 0 && <option value="">Nenhum backend disponível</option>}
                  {hosts.map((host) => <option key={host.id} value={host.id}>{host.id.toUpperCase()}</option>)}
                </select>
              </label>
              <label htmlFor="audio-input">Entrada
                <select id="audio-input" value={inputIndex} onChange={(event) => { setInputIndex(event.target.value); setInputChannel(0); }} disabled={busy || running}>
                  {inputs.length === 0 && <option value="">Sem entrada F32 / 48 kHz</option>}
                  {inputs.map((d) => <option key={d.index} value={d.index}>{d.name} ({d.channels} canais)</option>)}
                </select>
              </label>
              <label htmlFor="audio-input-channel">Canal da guitarra
                <select id="audio-input-channel" value={inputChannel} onChange={(event) => setInputChannel(Number(event.target.value))} disabled={busy || running || channelCount === 0}>
                  {Array.from({ length: channelCount }, (_, i) => <option value={i} key={i}>Entrada {i + 1}</option>)}
                </select>
              </label>
              <label htmlFor="audio-output">Saída
                <select id="audio-output" value={outputIndex} onChange={(event) => setOutputIndex(event.target.value)} disabled={busy || running}>
                  {outputs.length === 0 && <option value="">Sem saída F32 / 48 kHz</option>}
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
                  <option value="wet">NAM/IR · processamento ao vivo</option>
                </select>
              </label>
            </div>
            {mode === "wet" && (
              <section className="audio-live-models" aria-label="Cadeia NAM/IR da pedalboard">
                <h3>Cadeia nativa da pedalboard</h3>
                <p>Arquivos reais são associados a cada VTTAMP, VTTDRIVE e VTTCAB diretamente na pedalboard. Power, bypass e ordem são aplicados ao iniciar. Ajustes feitos durante a sessão precisam de reinício manual.</p>
                {livePreview ? (
                  <>
                    <p role="status">{livePreview.nodes.length} módulo(s) nativo(s) preparado(s) · {livePreview.ignored.length} efeito(s) visual(is) sem DSP serão ignorados.</p>
                    <ol>{livePreview.nodes.map(node =>
                      <li key={node.id}>{node.kind.toUpperCase()} · {node.enabled ? "ligado" : "bypass"} · {node.resource.path.split(/[\\\\/]/).pop()}</li>
                    )}</ol>
                  </>
                ) : <p className="audio-device-warning" role="status">{livePlan.error}</p>}
              </section>
            )}
            {running && activeMode === "wet" &&
              (appliedManifest === null || liveManifest !== appliedManifest) &&
              <p className="audio-device-warning" role="status">O rig visual pode diferir do áudio em execução. Para aplicar as alterações, clique Parar NAM/IR e depois Iniciar NAM/IR.</p>}
            <p className="audio-device-note">48.000 Hz · canal de entrada selecionado enviado em mono para as saídas. Buffer pode ser recusado pelo driver. WASAPI/ALSA são padrão; ASIO/JACK exigem suporte opcional e drivers instalados.</p>
            <p className="audio-device-warning">Use fones ou volume de saída baixo antes de ligar. Cuidado com microfonia e ganho excessivo de modelos NAM.</p>
            {running && activeMode === "dry" && dryStatus?.failed && (
              <p className="audio-device-warning" role="alert">Falha na {audioFaultReason(dryStatus)}. Pare o monitor, confira a interface e atualize os dispositivos antes de tentar novamente.</p>
            )}
            {running && activeMode === "wet" && liveStats && (
              <p className={liveStats.failed ? "audio-device-warning" : "audio-device-note"} role={liveStats.failed ? "alert" : "status"}>NAM/IR: {liveStats.failed ? `falha em ${audioFaultReason(liveStats)}; pare e revise a configuração` : "ativo"} · amostras em falta: {liveStats.underruns} · descartadas: {liveStats.overflows}. Estes contadores não equivalem à latência.</p>
            )}
            <div className="audio-device-actions">
              <button className="secondary-button" type="button" disabled={busy || running} onClick={() => void refresh()}><RefreshCw size={15}/> Atualizar dispositivos</button>
              {running ? (
                <button type="button" className="primary-button" disabled={busy} onClick={() => void stop()}><Square size={15}/> Parar {activeMode === "wet" ? "NAM/IR" : "DRY"}</button>
              ) : (
                <button type="button" className="primary-button" disabled={busy || !hostId || inputIndex === "" || outputIndex === "" || (mode === "wet" && !liveManifest)}
                  onClick={() => void start()}><Volume2 size={15}/> Iniciar {mode === "wet" ? "NAM/IR" : "monitor DRY"}</button>
              )}
            </div>
          </>
        )}
        {message && <p className="audio-device-message" role="status">{message}</p>}
      </div>
    </article>
  );
}
