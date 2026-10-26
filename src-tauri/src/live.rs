//! PR11: opt-in wet audio via native NAM/IR C++ sidecar.
//! CPU model loading and blocking pipes are confined to a worker thread.
//! The CPAL device callbacks only copy samples through bounded SPSC rings.
use crate::audio::{self, AudioState, MonitorSelection};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Stream, StreamConfig};
use rtrb::RingBuffer;
use serde::Serialize;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::str::FromStr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

const FRAMES: usize = 128;
const RING_SIZE: usize = 16_384;
const SAFE_GAIN: f32 = 0.12;

pub struct LiveSession {
    input: Stream,
    output: Stream,
    running: Arc<AtomicBool>,
    failed: Arc<AtomicBool>,
    underruns: Arc<AtomicU64>,
    overflows: Arc<AtomicU64>,
    child: Child,
    worker: Option<JoinHandle<()>>,
}

#[derive(Default)]
pub struct LiveState {
    session: Mutex<Option<LiveSession>>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveStatus {
    pub running: bool,
    pub failed: bool,
    pub underruns: u64,
    pub overflows: u64,
    pub mode: &'static str,
}

pub fn status(state: &LiveState) -> Result<LiveStatus, String> {
    let guard = state.session.lock().map_err(|_| "Audio state unavailable")?;
    let session = guard.as_ref();
    Ok(LiveStatus {
        running: session.is_some(),
        failed: session.is_some_and(|s| s.failed.load(Ordering::Relaxed)),
        underruns: session.map_or(0, |s| s.underruns.load(Ordering::Relaxed)),
        overflows: session.map_or(0, |s| s.overflows.load(Ordering::Relaxed)),
        mode: "live_nam_ir_pipe",
    })
}

fn validate_manifest(json: &str) -> Result<(), String> {
    if json.len() > 30_000 {
        return Err("Cadeia NAM/IR excede o limite de 30 KB.".into());
    }
    let value: serde_json::Value =
        serde_json::from_str(json).map_err(|e| format!("Cadeia JSON inválida: {e}"))?;
    if value["schemaVersion"] != 1 {
        return Err("Versão de cadeia inválida (esperado schemaVersion 1).".into());
    }
    let nodes = value["nodes"].as_array().ok_or("Cadeia sem lista de efeitos")?;
    if nodes.is_empty() || nodes.len() > 24 {
        return Err("Selecione de 1 até 24 modelos NAM/IR.".into());
    }
    for node in nodes {
        let kind = node["kind"].as_str().unwrap_or("");
        let path = node["resource"]["path"].as_str().unwrap_or("");
        let allowed_extension = match kind {
            "amp" | "drive" => "nam",
            "cabinet" => "wav",
            _ => return Err(format!("DSP ainda não implementado para {kind}")),
        };
        if path.is_empty() || path.len() > 4096
            || !std::path::Path::new(path).is_file()
            || !path.to_ascii_lowercase().ends_with(&format!(".{allowed_extension}"))
        {
            return Err(format!("Arquivo de {kind} não encontrado ou incompatível: {path}"));
        }
    }
    Ok(())
}

fn sidecar_path() -> Result<PathBuf, String> {
    let bin_name = if cfg!(windows) {
        "vttrig-nam-live.exe"
    } else {
        "vttrig-nam-live"
    };
    if let Ok(exe) = std::env::current_exe() {
        let adjacent = exe.with_file_name(bin_name);
        if adjacent.is_file() {
            return Ok(adjacent);
        }
    }
    // Development builds have a triple-suffixed externalBin in binaries/.
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries");
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let file = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
            if file.starts_with("vttrig-nam-live-")
                && file.ends_with(if cfg!(windows) { ".exe" } else { "" })
                && path.is_file()
            {
                return Ok(path);
            }
        }
    }
    Err("Motor NAM ao vivo não foi incluído no pacote. Reinstale o VTTRIG.".into())
}

fn start_sidecar(json: &str) -> Result<Child, String> {
    let path = sidecar_path()?;
    let mut child = Command::new(path)
        .arg("--chain-json")
        .arg(json)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Não foi possível iniciar o motor NAM: {e}"))?;
    let mut ready = [0u8; 1];
    let read = child.stdout.as_mut().ok_or("Pipe de saída indisponível")?
        .read_exact(&mut ready);
    if read.is_err() || ready != [b'R'] {
        let _ = child.wait();
        let mut errors = String::new();
        if let Some(stderr) = child.stderr.as_mut() {
            let _ = stderr.read_to_string(&mut errors);
        }
        return Err(format!("Falha ao carregar NAM/IR: {}", errors.trim()));
    }
    Ok(child)
}

pub fn start(
    state: &LiveState,
    dry: &AudioState,
    selection: MonitorSelection,
    chain_json: String,
) -> Result<(), String> {
    if audio::status(dry)?.running {
        return Err("Desligue o monitor DRY antes de iniciar o NAM.".into());
    }
    validate_manifest(&chain_json)?;
    audio::validate_buffer(selection.buffer_frames)?;
    let id = cpal::HostId::from_str(&selection.host_id)
        .map_err(|_| "Backend de áudio inválido")?;
    if !cpal::available_hosts().contains(&id) {
        return Err("Backend de áudio indisponível".into());
    }
    let host = cpal::host_from_id(id).map_err(|e| e.to_string())?;
    let (input, input_cfg) =
        audio::choose_device(&host, true, selection.input_index, selection.buffer_frames)?;
    let (output, output_cfg) =
        audio::choose_device(&host, false, selection.output_index, selection.buffer_frames)?;
    let mut guard = state.session.lock().map_err(|_| "Audio state unavailable")?;
    if guard.is_some() {
        return Err("O áudio NAM já está ligado. Pare antes de trocar arquivos.".into());
    }
    let mut child = start_sidecar(&chain_json)?;
    let mut in_pipe = child.stdin.take().ok_or("Entrada do motor NAM indisponível")?;
    let mut out_pipe = child.stdout.take().ok_or("Saída do motor NAM indisponível")?;
    let (mut input_tx, mut input_rx) = RingBuffer::<f32>::new(RING_SIZE);
    let (mut output_tx, mut output_rx) = RingBuffer::<f32>::new(RING_SIZE);
    let running = Arc::new(AtomicBool::new(true));
    let failed = Arc::new(AtomicBool::new(false));
    let underruns = Arc::new(AtomicU64::new(0));
    let overflows = Arc::new(AtomicU64::new(0));
    let input_channels = usize::from(input_cfg.channels);
    let output_channels = usize::from(output_cfg.channels);
    let in_overflows = Arc::clone(&overflows);
    let out_underruns = Arc::clone(&underruns);
    let input_stream = match input.build_input_stream(
        &input_cfg,
        move |data: &[f32], _| {
            for frame in data.chunks(input_channels) {
                let value = frame.first().copied().unwrap_or(0.0);
                let value = if value.is_finite() { value } else { 0.0 };
                if input_tx.push(value).is_err() {
                    in_overflows.fetch_add(1, Ordering::Relaxed);
                }
            }
        },
        |_error| {},
        None,
    ) {
        Ok(stream) => stream,
        Err(e) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("Erro ao abrir entrada: {e}"));
        }
    };
    let output_stream = match output.build_output_stream(
        &output_cfg,
        move |data: &mut [f32], _| {
            for frame in data.chunks_mut(output_channels) {
                let value = match output_rx.pop() {
                    Ok(sample) => sample,
                    Err(_) => {
                        out_underruns.fetch_add(1, Ordering::Relaxed);
                        0.0
                    }
                };
                let value = if value.is_finite() {
                    (value * SAFE_GAIN).clamp(-0.8, 0.8)
                } else {
                    0.0
                };
                for channel in frame {
                    *channel = value;
                }
            }
        },
        |_error| {},
        None,
    ) {
        Ok(stream) => stream,
        Err(e) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("Erro ao abrir saída: {e}"));
        }
    };
    if let Err(e) = output_stream.play().and_then(|_| input_stream.play()) {
        let _ = child.kill();
        let _ = child.wait();
        return Err(format!("Não foi possível iniciar monitoramento: {e}"));
    }
    let worker_running = Arc::clone(&running);
    let worker_failed = Arc::clone(&failed);
    let worker = thread::spawn(move || {
        let mut input_bytes = [0u8; FRAMES * 4];
        let mut output_bytes = [0u8; FRAMES * 4];
        while worker_running.load(Ordering::Relaxed) {
            if input_rx.slots() < FRAMES {
                thread::sleep(Duration::from_millis(1));
                continue;
            }
            for chunk in input_bytes.chunks_exact_mut(4) {
                let sample = input_rx.pop().unwrap_or(0.0);
                chunk.copy_from_slice(&sample.to_le_bytes());
            }
            if in_pipe.write_all(&input_bytes).is_err()
                || out_pipe.read_exact(&mut output_bytes).is_err()
            {
                worker_failed.store(true, Ordering::Relaxed);
                break;
            }
            for chunk in output_bytes.chunks_exact(4) {
                let sample = f32::from_le_bytes(chunk.try_into().unwrap_or([0; 4]));
                let _ = output_tx.push(sample);
            }
        }
    });
    *guard = Some(LiveSession {
        input: input_stream,
        output: output_stream,
        running,
        failed,
        underruns,
        overflows,
        child,
        worker: Some(worker),
    });
    Ok(())
}

pub fn stop(state: &LiveState) -> Result<(), String> {
    let session = state.session.lock().map_err(|_| "Audio state unavailable")?.take();
    if let Some(mut session) = session {
        session.running.store(false, Ordering::Relaxed);
        let _ = session.input.pause();
        let _ = session.output.pause();
        let _ = session.child.kill();
        let _ = session.child.wait();
        if let Some(worker) = session.worker.take() {
            let _ = worker.join();
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn starts_disabled_and_has_no_fictitious_dsp() {
        let s = status(&LiveState::default()).unwrap();
        assert!(!s.running);
        assert_eq!(s.mode, "live_nam_ir_pipe");
    }
    #[test]
    fn rejects_empty_unknown_or_missing_models() {
        assert!(validate_manifest("{}").is_err());
        assert!(validate_manifest(r#"{"schemaVersion":1,"nodes":[]}"#).is_err());
        assert!(validate_manifest(r#"{"schemaVersion":1,"nodes":[{"kind":"chorus"}]}"#).is_err());
        assert!(validate_manifest(r#"{"schemaVersion":1,"nodes":[{"kind":"amp","resource":{"path":"missing.nam"}}]}"#).is_err());
    }
}
