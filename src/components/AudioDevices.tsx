import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { AudioLines, RefreshCw, Square, Volume2 } from "lucide-react";
import { audioFaultReason } from "../lib/audioFaults";
import { loadAudioSettings, saveAudioSettings } from "../lib/audioSettings";

type DeviceInfo = { index: number; name: string; channels: number; supportsMonitor: boolean };
type HostInfo = { id: string; inputs: DeviceInfo[]; outputs: DeviceInfo[] };
type MonitorStatus = { running: boolean; failed: boolean; inputFailed: boolean; outputFailed: boolean; mode: string };
type LiveStatus = { running: boolean; failed: boolean; inputFailed: boolean; outputFailed: boolean; engineFailed: boolean; underruns: number; overflows: number; mode: string };
type Mode = "dry" | "wet";

const BUFFER_OPTIONS = [64, 128, 256, 512, 1024];
const RATE = 48000;
const displayFile = (path: string) => path.split(/[\\/]/).pop() || path;

export default function AudioDevices() {
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
  const [ampPath, setAmpPath] = useState(saved.ampPath);
  const [cabPath, setCabPath] = useState(saved.cabPath);
  const [irBeforeAmp, setIrBeforeAmp] = useState(saved.irBeforeAmp);
  const [bypassAmp, setBypassAmp] = useState(saved.bypassAmp);
  const [bypassCab, setBypassCab] = useState(saved.bypassCab);
  const [liveStats, setLiveStats] = useState<LiveStatus | null>(null);
  const [dryStatus, setDryStatus] = useState<MonitorStatus | null>(null);

  useEffect(() => {
    // Save only the chosen setup, never live streams, a "running" flag or USB indices.
    // Existing file paths are revalidated by the Rust/C++ backend on Start.
    saveAudioSettings({
      version: 1, mode, bufferFrames: frames, inputChannel,
      ampPath, cabPath, irBeforeAmp, bypassAmp, bypassCab,
    });
  }, [mode, frames, inputChannel, ampPath, cabPath, irBeforeAmp, bypassAmp, bypassCab]);

  const selected = useMemo(() => hosts.find((h) => h.id === hostId), [hosts, hostId]);
  const inputs = selected?.inputs.filter((d) => d.supportsMonitor) ?? [];
  const outputs = selected?.outputs.filter((d) => d.supportsMonitor) ?? [];
  const channelCount = inputs.find((d) => String(d.index) === inputIndex)?.channels ?? 0;

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

  async function pickFile(kind: "amp" | "cab") {
    if (!native || running || busy) return;
    try {
      const candidate = await open({
        multiple: false,
        directory: false,
        filters: [{ name: kind === "amp" ? "Neural Amp Model" : "Cabinet IR",
          extensions: [kind === "amp" ? "nam" : "wav"] }],
      });
      if (typeof candidate === "string") {
        if (kind === "amp") setAmpPath(candidate);
        else setCabPath(candidate);
        setMessage("Arquivo local selecionado. A validação DSP ocorre ao iniciar.");
      }
    } catch (error) {
      setMessage(`Erro ao selecionar arquivo: ${String(error)}`);
    }
  }

  function buildChain(): string {
    const nodes = [
      ...(ampPath ? [{ id: "live-amp-1", kind: "amp", enabled: !bypassAmp,
        parameters: {}, resource: { path: ampPath } }] : []),
      ...(cabPath ? [{ id: "live-cab-1", kind: "cabinet", enabled: !bypassCab,
        parameters: {}, resource: { path: cabPath } }] : []),
    ];
    if (irBeforeAmp) nodes.reverse();
    return JSON.stringify({ schemaVersion: 1, nodes });
  }

  async function start() {
    if (!native || !hostId || inputIndex === "" || outputIndex === "" || busy) return;
    if (mode === "wet" && !ampPath && !cabPath) {
      setMessage("Carregue um NAM ou uma IR para iniciar o áudio processado.");
      return;
    }
    setBusy(true);
    try {
      const selection = {
        hostId, inputIndex: Number(inputIndex),
        outputIndex: Number(outputIndex), bufferFrames: frames, inputChannel,
      };
      if (mode === "wet") {
        await invoke("audio_start_live", { selection, chainJson: buildChain() });
      } else {
        await invoke("audio_start_monitor", { selection });
      }
      setRunning(true);
      setDryStatus(null);
      setLiveStats(null);
      setActiveMode(mode);
      setMessage(mode === "wet"
        ? "NAM/IR ligado. Atenção ao volume. Os pedais da tela ainda não atuam neste teste."
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
      setMessage("Monitor de áudio desligado.");
    } catch (error) {
      setMessage(`Erro ao desligar áudio: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="settings-card audio-device-card" aria-label="Áudio e dispositivos">
      <AudioLines size={23}/>
      <div>
        <h2>Áudio e dispositivos</h2>
        <p>Escolha um driver, entrada e saída. Teste a guitarra limpa (DRY) ou carregue arquivos reais .nam/.wav para ouvir o processamento nativo (NAM/IR). Outros pedais continuam somente visuais.</p>
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
              <section className="audio-live-models" aria-label="Modelos NAM e IR">
                <h3>Modelos locais para o teste ao vivo</h3>
                <div className="audio-model-row">
                  <button type="button" disabled={busy || running} onClick={() => void pickFile("amp")}>Escolher NAM (.nam)</button>
                  <span title={ampPath}>{ampPath ? displayFile(ampPath) : "Nenhum NAM selecionado"}</span>
                  {ampPath && <label><input type="checkbox" checked={bypassAmp} disabled={running} onChange={(e) => setBypassAmp(e.target.checked)}/> Bypass</label>}
                </div>
                <div className="audio-model-row">
                  <button type="button" disabled={busy || running} onClick={() => void pickFile("cab")}>Escolher gabinete (.wav)</button>
                  <span title={cabPath}>{cabPath ? displayFile(cabPath) : "Sem IR (opcional)"}</span>
                  {cabPath && <label><input type="checkbox" checked={bypassCab} disabled={running} onChange={(e) => setBypassCab(e.target.checked)}/> Bypass</label>}
                </div>
                {ampPath && cabPath && <label className="audio-order-switch">
                  <input type="checkbox" disabled={running} checked={irBeforeAmp} onChange={(e) => setIrBeforeAmp(e.target.checked)}/>
                  IR antes do NAM (desmarcado: NAM → IR)
                </label>}
                <p>Esta cadeia de teste é independente dos pedais visuais e preserva a ordem escolhida aqui. A configuração é lembrada localmente; arquivos removidos ou movidos precisam ser selecionados novamente. Os modelos só são carregados ao iniciar, nunca no callback de áudio.</p>
              </section>
            )}
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
                <button type="button" className="primary-button" disabled={busy || !hostId || inputIndex === "" || outputIndex === "" || (mode === "wet" && !ampPath && !cabPath)}
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
