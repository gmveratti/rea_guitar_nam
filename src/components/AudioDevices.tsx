import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { AudioLines, RefreshCw, Square, Volume2 } from "lucide-react";

type DeviceInfo = { index: number; name: string; channels: number; supportsMonitor: boolean };
type HostInfo = { id: string; inputs: DeviceInfo[]; outputs: DeviceInfo[] };
type MonitorStatus = { running: boolean; mode: string };

const BUFFER_OPTIONS = [64, 128, 256, 512, 1024];
const RATE = 48000;

export default function AudioDevices() {
  const native = isTauri();
  const [hosts, setHosts] = useState<HostInfo[]>([]);
  const [hostId, setHostId] = useState("");
  const [inputIndex, setInputIndex] = useState("");
  const [outputIndex, setOutputIndex] = useState("");
  const [frames, setFrames] = useState(256);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const selected = useMemo(() => hosts.find((h) => h.id === hostId), [hosts, hostId]);
  const inputs = selected?.inputs.filter((d) => d.supportsMonitor) ?? [];
  const outputs = selected?.outputs.filter((d) => d.supportsMonitor) ?? [];

  const refresh = useCallback(async () => {
    if (!native) return;
    setBusy(true);
    try {
      const [available, status] = await Promise.all([
        invoke<HostInfo[]>("audio_list_hosts"),
        invoke<MonitorStatus>("audio_monitor_status"),
      ]);
      setHosts(available);
      setRunning(status.running);
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
      setInputIndex(inputs.some((device) => String(device.index) === inputIndex) ? inputIndex : (inputs[0] ? String(inputs[0].index) : ""));
      setOutputIndex(outputs.some((device) => String(device.index) === outputIndex) ? outputIndex : (outputs[0] ? String(outputs[0].index) : ""));
    }
  }, [hostId, hosts, inputIndex, inputs, outputIndex, outputs, running]);

  async function start() {
    if (!native || !hostId || inputIndex === "" || outputIndex === "" || busy) return;
    setBusy(true);
    try {
      await invoke("audio_start_monitor", {
        selection: {
          hostId,
          inputIndex: Number(inputIndex),
          outputIndex: Number(outputIndex),
          bufferFrames: frames,
        },
      });
      setRunning(true);
      setMessage("Monitor DRY ligado: sem amp NAM ou pedais DSP. Use volume baixo.");
    } catch (error) {
      setRunning(false);
      setMessage(`Não foi possível ligar o monitor: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    setBusy(true);
    try {
      await invoke("audio_stop_monitor");
      setRunning(false);
      setMessage("Monitor DRY desligado.");
    } catch (error) {
      setMessage(`Erro ao desligar: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="settings-card audio-device-card" aria-label="Áudio e dispositivos">
      <AudioLines size={23}/>
      <div>
        <h2>Áudio e dispositivos</h2>
        <p>Selecione o backend de áudio disponível no computador. O teste de entrada/saída reproduz apenas guitarra limpa, com volume reduzido. O NAM/IR ainda não está integrado ao Tauri.</p>
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
                <select id="audio-input" value={inputIndex} onChange={(event) => setInputIndex(event.target.value)} disabled={busy || running}>
                  {inputs.length === 0 && <option value="">Sem entrada F32 / 48 kHz</option>}
                  {inputs.map((device) => <option key={device.index} value={device.index}>{device.name} ({device.channels} canais)</option>)}
                </select>
              </label>
              <label htmlFor="audio-output">Saída
                <select id="audio-output" value={outputIndex} onChange={(event) => setOutputIndex(event.target.value)} disabled={busy || running}>
                  {outputs.length === 0 && <option value="">Sem saída F32 / 48 kHz</option>}
                  {outputs.map((device) => <option key={device.index} value={device.index}>{device.name} ({device.channels} canais)</option>)}
                </select>
              </label>
              <label htmlFor="audio-buffer">Buffer solicitado
                <select id="audio-buffer" value={frames} onChange={(event) => setFrames(Number(event.target.value))} disabled={busy || running}>
                  {BUFFER_OPTIONS.map((value) => <option key={value} value={value}>{value} samples</option>)}
                </select>
              </label>
            </div>
            <p className="audio-device-note">Sample rate: {RATE.toLocaleString("pt-BR")} Hz. O buffer solicitado pode ser rejeitado pelo driver; não é uma medição de latência. ASIO e JACK exigem builds com suporte opcional e drivers instalados.</p>
            <p className="audio-device-warning">Cuidado com microfonia: use fones ou monitores em volume baixo, nunca roteie a saída para a entrada.</p>
            <div className="audio-device-actions">
              <button className="secondary-button" type="button" disabled={busy || running} onClick={() => void refresh()}><RefreshCw size={15}/> Atualizar dispositivos</button>
              {running ? (
                <button type="button" className="primary-button" disabled={busy} onClick={() => void stop()}><Square size={15}/> Parar monitor DRY</button>
              ) : (
                <button type="button" className="primary-button" disabled={busy || !hostId || inputIndex === "" || outputIndex === ""} onClick={() => void start()}><Volume2 size={15}/> Iniciar monitor DRY</button>
              )}
            </div>
          </>
        )}
        {message && <p className="audio-device-message" role="status">{message}</p>}
      </div>
    </article>
  );
}
