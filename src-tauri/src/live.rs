//! PR11: opt-in wet audio via native NAM/IR C++ sidecar.
//! CPU model loading and blocking pipes are confined to a worker thread.
//! The CPAL device callbacks only copy samples through bounded SPSC rings.
use crate::audio::{self, AudioState, MonitorSelection};
use cpal::traits::{DeviceTrait, StreamTrait};
use cpal::Stream;
use rtrb::RingBuffer;
use serde::Serialize;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::str::FromStr;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

const FRAMES: usize = 128;
const RING_SIZE: usize = 16_384;
const SAFE_GAIN: f32 = 0.12;

const INPUT_FAULT: u8 = 1;
const OUTPUT_FAULT: u8 = 2;
const ENGINE_FAULT: u8 = 4;

pub struct LiveSession {
    input: Stream,
    output: Stream,
    running: Arc<AtomicBool>,
    faults: Arc<AtomicU8>,
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
    pub input_failed: bool,
    pub output_failed: bool,
    pub engine_failed: bool,
    pub underruns: u64,
    pub overflows: u64,
    pub mode: &'static str,
}

pub fn status(state: &LiveState) -> Result<LiveStatus, String> {
    let guard = state
        .session
        .lock()
        .map_err(|_| "Audio state unavailable")?;
    let session = guard.as_ref();
    let faults = session.map_or(0, |s| s.faults.load(Ordering::Relaxed));
    Ok(LiveStatus {
        // A failed session still needs an explicit Stop to release its devices.
        running: session.is_some(),
        failed: faults != 0,
        input_failed: faults & INPUT_FAULT != 0,
        output_failed: faults & OUTPUT_FAULT != 0,
        engine_failed: faults & ENGINE_FAULT != 0,
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
    let nodes = value["nodes"]
        .as_array()
        .ok_or("Cadeia sem lista de efeitos")?;
    if nodes.is_empty() || nodes.len() > 24 {
        return Err("Selecione de 1 até 24 modelos NAM/IR.".into());
    }
    for node in nodes {
        let kind = node["kind"].as_str().unwrap_or("");
        if kind == "gate" {
            // File-free TONE3000-derived DSP. Parameters must agree with C++ preflight.
            if node.get("resource").is_some() {
                return Err("VTTGATE não deve ter arquivo NAM/IR.".into());
            }
            let params = node["parameters"]
                .as_object()
                .ok_or("Parâmetros do VTTGATE inválidos")?;
            for (name, value) in params {
                let number = value
                    .as_f64()
                    .filter(|n| n.is_finite())
                    .ok_or("Parâmetro do VTTGATE deve ser numérico e finito")?;
                let valid = match name.as_str() {
                    "threshold" => (-100.0..=0.0).contains(&number),
                    "release" => (5.0..=500.0).contains(&number),
                    "hold" => (0.0..=200.0).contains(&number),
                    "range" => (20.0..=80.0).contains(&number),
                    _ => false,
                };
                if !valid {
                    return Err(format!("Parâmetro inválido do VTTGATE: {name}"));
                }
            }
            continue;
        }
        if kind == "compressor" {
            if node.get("resource").is_some() {
                return Err("VTT Compressor não deve ter arquivo NAM/IR.".into());
            }
            let params = node["parameters"]
                .as_object()
                .ok_or("Parâmetros do VTT Compressor inválidos")?;
            for (name, value) in params {
                let number = value
                    .as_f64()
                    .filter(|n| n.is_finite())
                    .ok_or("Parâmetro do compressor deve ser numérico e finito")?;
                let valid = match name.as_str() {
                    "compress" => (0.0..=100.0).contains(&number),
                    "output" => (0.0..=200.0).contains(&number),
                    "mix" => (0.0..=100.0).contains(&number),
                    _ => false,
                };
                if !valid {
                    return Err(format!("Parâmetro inválido do VTT Compressor: {name}"));
                }
            }
            continue;
        }
        if kind == "sustain" {
            if node.get("resource").is_some() {
                return Err("VTTSUSTAIN não deve ter arquivo NAM/IR.".into());
            }
            let params = node["parameters"]
                .as_object()
                .ok_or("Parâmetros do VTTSUSTAIN inválidos")?;
            for (name, value) in params {
                let number = value
                    .as_f64()
                    .filter(|n| n.is_finite())
                    .ok_or("Parâmetro do VTTSUSTAIN deve ser numérico e finito")?;
                let valid = match name.as_str() {
                    "sustain" | "speed" | "mix" => (0.0..=100.0).contains(&number),
                    "level" => (-18.0..=18.0).contains(&number),
                    _ => false,
                };
                if !valid {
                    return Err(format!("Parâmetro inválido do VTTSUSTAIN: {name}"));
                }
            }
            continue;
        }
        let path = node["resource"]["path"].as_str().unwrap_or("");
        let allowed_extension = match kind {
            "amp" | "drive" => "nam",
            "cabinet" => "wav",
            _ => return Err(format!("DSP ainda não implementado para {kind}")),
        };
        if path.is_empty()
            || path.len() > 4096
            || !std::path::Path::new(path).is_file()
            || !path
                .to_ascii_lowercase()
                .ends_with(&format!(".{allowed_extension}"))
        {
            return Err(format!(
                "Arquivo de {kind} não encontrado ou incompatível: {path}"
            ));
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
    // The model is prepared before streaming. Bound the handshake so an
    // unresponsive child cannot stall a Tauri control command indefinitely.
    let mut stdout = child.stdout.take().ok_or("Pipe de saída indisponível")?;
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    let reader = thread::spawn(move || {
        let mut ready = [0u8; 1];
        let reply = stdout.read_exact(&mut ready).map(|_| ready[0]);
        let _ = sender.send((reply, stdout));
    });
    match receiver.recv_timeout(Duration::from_secs(30)) {
        Ok((Ok(b'R'), stdout)) => {
            let _ = reader.join();
            child.stdout = Some(stdout);
            Ok(child)
        }
        Ok((reply, stdout)) => {
            drop(stdout);
            let _ = reader.join();
            let _ = child.kill();
            let _ = child.wait();
            let mut errors = String::new();
            if let Some(stderr) = child.stderr.as_mut() {
                let _ = stderr.read_to_string(&mut errors);
            }
            let reason = if errors.trim().is_empty() {
                format!("handshake inválido: {reply:?}")
            } else {
                errors.trim().to_owned()
            };
            Err(format!("Falha ao carregar NAM/IR: {reason}"))
        }
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            let _ = reader.join();
            Err(format!(
                "Motor NAM não confirmou inicialização em 30 segundos: {error}"
            ))
        }
    }
}

// The worker may outrun the output device. Count dropped WET frames too;
// otherwise the UI would report zero overflows even while output is lost.
// Single-producer ring operation is nonblocking and allocation-free.
fn push_processed_sample(queue: &mut rtrb::Producer<f32>, sample: f32, overflows: &AtomicU64) {
    if queue.push(sample).is_err() {
        overflows.fetch_add(1, Ordering::Relaxed);
    }
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
    let id = cpal::HostId::from_str(&selection.host_id).map_err(|_| "Backend de áudio inválido")?;
    if !cpal::available_hosts().contains(&id) {
        return Err("Backend de áudio indisponível".into());
    }
    let host = cpal::host_from_id(id).map_err(|e| e.to_string())?;
    let (input, input_cfg) =
        audio::choose_device(&host, true, selection.input_index, selection.buffer_frames)?;
    let (output, output_cfg) = audio::choose_device(
        &host,
        false,
        selection.output_index,
        selection.buffer_frames,
    )?;
    audio::validate_input_channel(selection.input_channel, input_cfg.channels)?;
    let mut guard = state
        .session
        .lock()
        .map_err(|_| "Audio state unavailable")?;
    if guard.is_some() {
        return Err("O áudio NAM já está ligado. Pare antes de trocar arquivos.".into());
    }
    let mut child = start_sidecar(&chain_json)?;
    let mut in_pipe = child
        .stdin
        .take()
        .ok_or("Entrada do motor NAM indisponível")?;
    let mut out_pipe = child
        .stdout
        .take()
        .ok_or("Saída do motor NAM indisponível")?;
    let (mut input_tx, mut input_rx) = RingBuffer::<f32>::new(RING_SIZE);
    let (mut output_tx, mut output_rx) = RingBuffer::<f32>::new(RING_SIZE);
    let running = Arc::new(AtomicBool::new(true));
    let faults = Arc::new(AtomicU8::new(0));
    let underruns = Arc::new(AtomicU64::new(0));
    let overflows = Arc::new(AtomicU64::new(0));
    let input_channels = usize::from(input_cfg.channels);
    let input_channel = selection.input_channel;
    let output_channels = usize::from(output_cfg.channels);
    let in_overflows = Arc::clone(&overflows);
    let out_underruns = Arc::clone(&underruns);
    let out_overflows = Arc::clone(&overflows);
    let input_error = Arc::clone(&faults);
    let output_error = Arc::clone(&faults);
    let output_silence = Arc::clone(&faults);
    let input_stream = match input.build_input_stream(
        &input_cfg,
        move |data: &[f32], _| {
            for frame in data.chunks(input_channels) {
                let value = audio::selected_mono_sample(frame, input_channel);
                if input_tx.push(value).is_err() {
                    in_overflows.fetch_add(1, Ordering::Relaxed);
                }
            }
        },
        move |_error| {
            input_error.fetch_or(INPUT_FAULT, Ordering::Relaxed);
        },
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
                let value = if output_silence.load(Ordering::Relaxed) != 0 {
                    0.0
                } else {
                    match output_rx.pop() {
                        Ok(sample) => sample,
                        Err(_) => {
                            out_underruns.fetch_add(1, Ordering::Relaxed);
                            0.0
                        }
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
        move |_error| {
            output_error.fetch_or(OUTPUT_FAULT, Ordering::Relaxed);
        },
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
    let worker_faults = Arc::clone(&faults);
    let worker = thread::spawn(move || {
        let mut input_bytes = [0u8; FRAMES * 4];
        let mut output_bytes = [0u8; FRAMES * 4];
        while worker_running.load(Ordering::Relaxed) && worker_faults.load(Ordering::Relaxed) == 0 {
            if input_rx.slots() < FRAMES {
                thread::sleep(Duration::from_millis(1));
                continue;
            }
            for chunk in input_bytes.as_chunks_mut::<4>().0 {
                let sample = input_rx.pop().unwrap_or(0.0);
                chunk.copy_from_slice(&sample.to_le_bytes());
            }
            if in_pipe.write_all(&input_bytes).is_err()
                || out_pipe.read_exact(&mut output_bytes).is_err()
            {
                worker_faults.fetch_or(ENGINE_FAULT, Ordering::Relaxed);
                break;
            }
            for chunk in output_bytes.as_chunks::<4>().0 {
                let sample = f32::from_le_bytes(*chunk);
                push_processed_sample(&mut output_tx, sample, &out_overflows);
            }
        }
    });
    *guard = Some(LiveSession {
        input: input_stream,
        output: output_stream,
        running,
        faults,
        underruns,
        overflows,
        child,
        worker: Some(worker),
    });
    Ok(())
}

impl Drop for LiveSession {
    fn drop(&mut self) {
        // Stop the child even if the window closes without clicking Stop.
        // Killing the child releases a worker blocked on the native pipe.
        self.running.store(false, Ordering::Relaxed);
        let _ = self.input.pause();
        let _ = self.output.pause();
        let _ = self.child.kill();
        let _ = self.child.wait();
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

pub fn stop(state: &LiveState) -> Result<(), String> {
    let session = state
        .session
        .lock()
        .map_err(|_| "Audio state unavailable")?
        .take();
    drop(session);
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
    fn engine_and_device_faults_are_independent() {
        let faults = AtomicU8::new(0);
        faults.fetch_or(INPUT_FAULT, Ordering::Relaxed);
        assert_eq!(faults.load(Ordering::Relaxed) & ENGINE_FAULT, 0);
        faults.fetch_or(ENGINE_FAULT, Ordering::Relaxed);
        assert_ne!(faults.load(Ordering::Relaxed) & INPUT_FAULT, 0);
        assert_ne!(faults.load(Ordering::Relaxed) & ENGINE_FAULT, 0);
        assert_eq!(faults.load(Ordering::Relaxed) & OUTPUT_FAULT, 0);
    }
    #[test]
    fn output_queue_overflow_is_accounted_without_blocking() {
        let (mut producer, mut consumer) = RingBuffer::<f32>::new(2);
        let overflows = AtomicU64::new(0);
        push_processed_sample(&mut producer, 0.1, &overflows);
        push_processed_sample(&mut producer, 0.2, &overflows);
        push_processed_sample(&mut producer, 0.3, &overflows);
        assert_eq!(overflows.load(Ordering::Relaxed), 1);
        assert!((consumer.pop().unwrap() - 0.1).abs() < f32::EPSILON);
        assert!((consumer.pop().unwrap() - 0.2).abs() < f32::EPSILON);
        assert!(consumer.pop().is_err());
        push_processed_sample(&mut producer, 0.4, &overflows);
        assert_eq!(overflows.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn accepts_file_free_gate_and_rejects_invalid_parameters() {
        let valid = r#"{"schemaVersion":1,"nodes":[
            {"id":"gate-a","kind":"gate","enabled":true,
             "parameters":{"threshold":-50,"release":50,"hold":20,"range":80}},
            {"id":"gate-b","kind":"gate","enabled":false,"parameters":{}}
        ]}"#;
        assert!(validate_manifest(valid).is_ok());
        assert!(validate_manifest(
            r#"{"schemaVersion":1,"nodes":[{"kind":"gate","resource":{"path":"wrong.nam"},"parameters":{}}]}"#
        ).is_err());
        assert!(validate_manifest(
            r#"{"schemaVersion":1,"nodes":[{"kind":"gate","parameters":{"hold":300}}]}"#
        )
        .is_err());
        assert!(validate_manifest(
            r#"{"schemaVersion":1,"nodes":[{"kind":"gate","parameters":{"attack":10}}]}"#
        )
        .is_err());
    }

    #[test]
    fn accepts_file_free_airwindows_compressor_with_real_controls() {
        let valid = r#"{"schemaVersion":1,"nodes":[
          {"id":"c1","kind":"compressor","enabled":true,
           "parameters":{"compress":65,"output":100,"mix":80}},
          {"id":"c2","kind":"compressor","enabled":false,"parameters":{}}
        ]}"#;
        assert!(validate_manifest(valid).is_ok());
        assert!(validate_manifest(
            r#"{"schemaVersion":1,"nodes":[{"kind":"compressor","parameters":{"compress":101}}]}"#
        )
        .is_err());
        assert!(validate_manifest(
            r#"{"schemaVersion":1,"nodes":[{"kind":"compressor","parameters":{"attack":10}}]}"#
        )
        .is_err());
        assert!(validate_manifest(
          r#"{"schemaVersion":1,"nodes":[{"kind":"compressor","parameters":{},"resource":{"path":"bad.nam"}}]}"#
        ).is_err());
    }

    #[test]
    fn rejects_empty_unknown_or_missing_models() {
        assert!(validate_manifest("{}").is_err());
        assert!(validate_manifest(r#"{"schemaVersion":1,"nodes":[]}"#).is_err());
        assert!(validate_manifest(r#"{"schemaVersion":1,"nodes":[{"kind":"chorus"}]}"#).is_err());
        assert!(validate_manifest(
            r#"{"schemaVersion":1,"nodes":[{"kind":"amp","resource":{"path":"missing.nam"}}]}"#
        )
        .is_err());
    }
}
