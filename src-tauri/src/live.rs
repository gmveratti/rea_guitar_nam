//! PR11: opt-in wet audio via native NAM/IR C++ sidecar.
//! CPU model loading and blocking pipes are confined to a worker thread.
//! The CPAL device callbacks only copy samples through bounded SPSC rings.
use crate::audio::{self, AudioState, MonitorSelection};
use crate::sidecar::{
    apply_rig_update, await_rig_update, EngineControl, NativeEngine, RigUpdate, UPDATE_PENDING,
};
use cpal::traits::StreamTrait;
use cpal::Stream;
use rtrb::RingBuffer;
use serde::Serialize;
use std::path::PathBuf;
use std::str::FromStr;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::mpsc::{self, SyncSender};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;
#[cfg(test)]
use std::time::Instant;

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
    engine: Arc<EngineControl>,
    updates: SyncSender<RigUpdate>,
    applied_manifest: Arc<Mutex<String>>,
    worker: Option<JoinHandle<()>>,
    selection: MonitorSelection,
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
    pub selection: Option<MonitorSelection>,
    pub applied_manifest: Option<String>,
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
        selection: session.map(|s| s.selection.clone()),
        applied_manifest: session.and_then(|s| {
            s.applied_manifest
                .lock()
                .ok()
                .map(|manifest| manifest.clone())
        }),
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
    if nodes.len() > 24 {
        return Err("A cadeia suporta no máximo 24 módulos.".into());
    }
    // Mirror the native manifest's structural invariants before any I/O.
    // Shared JSON fixtures pin this contract across TypeScript, Rust and C++.
    let mut ids = std::collections::HashSet::new();
    for node in nodes {
        let id = node["id"]
            .as_str()
            .ok_or("Cada efeito precisa de um identificador textual")?;
        if id.is_empty() || id.len() > 128 || !ids.insert(id) {
            return Err("Identificador de efeito vazio, duplicado ou longo demais".into());
        }
        if !node["enabled"].is_boolean() {
            return Err("O estado de bypass precisa ser booleano".into());
        }
        if !node["parameters"].is_object() {
            return Err("Os parâmetros de cada efeito precisam ser um objeto".into());
        }
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
        if kind == "chorus" {
            if node.get("resource").is_some() {
                return Err("VTTCHORUS não deve ter arquivo NAM/IR.".into());
            }
            let params = node["parameters"]
                .as_object()
                .ok_or("Parâmetros do VTTCHORUS inválidos")?;
            for (name, value) in params {
                let number = value
                    .as_f64()
                    .filter(|n| n.is_finite())
                    .ok_or("Parâmetro do VTTCHORUS deve ser numérico e finito")?;
                let valid = match name.as_str() {
                    "rate" => (0.1..=8.0).contains(&number),
                    "depth" | "mix" => (0.0..=100.0).contains(&number),
                    _ => false,
                };
                if !valid {
                    return Err(format!("Parâmetro inválido do VTTCHORUS: {name}"));
                }
            }
            continue;
        }
        if kind == "delay" {
            if node.get("resource").is_some() {
                return Err("VTTDELAY não deve ter arquivo NAM/IR.".into());
            }
            let params = node["parameters"]
                .as_object()
                .ok_or("Parâmetros do VTTDELAY inválidos")?;
            for (name, value) in params {
                let number = value
                    .as_f64()
                    .filter(|n| n.is_finite())
                    .ok_or("Parâmetro do VTTDELAY deve ser numérico e finito")?;
                let valid = match name.as_str() {
                    "time" => (40.0..=1200.0).contains(&number),
                    "feedback" => (0.0..=90.0).contains(&number),
                    "mix" => (0.0..=100.0).contains(&number),
                    _ => false,
                };
                if !valid {
                    return Err(format!("Parâmetro inválido do VTTDELAY: {name}"));
                }
            }
            continue;
        }
        if kind == "reverb" {
            if node.get("resource").is_some() {
                return Err("VTTREVERB não deve ter arquivo NAM/IR.".into());
            }
            let params = node["parameters"]
                .as_object()
                .ok_or("Parâmetros do VTTREVERB inválidos")?;
            for (name, value) in params {
                let number = value
                    .as_f64()
                    .filter(|n| n.is_finite())
                    .ok_or("Parâmetro do VTTREVERB deve ser numérico e finito")?;
                let valid = match name.as_str() {
                    "size" | "mix" => (0.0..=100.0).contains(&number),
                    "decay" => (0.2..=15.0).contains(&number),
                    _ => false,
                };
                if !valid {
                    return Err(format!("Parâmetro inválido do VTTREVERB: {name}"));
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
    cancel_sequence: &AtomicU64,
    start_epoch: u64,
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
    let (input, output) = audio::choose_duplex_devices(
        &host,
        selection.input_index,
        selection.output_index,
        selection.buffer_frames,
    )?;
    audio::validate_input_channel(selection.input_channel, input.config.channels)?;
    if state
        .session
        .lock()
        .map_err(|_| "Audio state unavailable")?
        .is_some()
    {
        return Err("O áudio NAM já está ligado.".into());
    }
    // Preparation runs without the session mutex: status remains responsive.
    let mut current_engine =
        NativeEngine::start(&sidecar_path()?, &chain_json, cancel_sequence, start_epoch)?;
    if cancel_sequence.load(Ordering::Acquire) != start_epoch {
        return Err("Carregamento do NAM cancelado.".into());
    }
    let (mut input_tx, mut input_rx) = RingBuffer::<f32>::new(RING_SIZE);
    let (mut output_tx, mut output_rx) = RingBuffer::<f32>::new(RING_SIZE);
    let running = Arc::new(AtomicBool::new(true));
    let faults = Arc::new(AtomicU8::new(0));
    let underruns = Arc::new(AtomicU64::new(0));
    let overflows = Arc::new(AtomicU64::new(0));
    let input_channel = selection.input_channel;
    let in_overflows = Arc::clone(&overflows);
    let out_underruns = Arc::clone(&underruns);
    let out_overflows = Arc::clone(&overflows);
    let input_error = Arc::clone(&faults);
    let output_error = Arc::clone(&faults);
    let output_silence = Arc::clone(&faults);
    let input_stream = audio::build_input_stream(
        &input,
        input_channel,
        move |value| {
            if input_tx.push(value).is_err() {
                in_overflows.fetch_add(1, Ordering::Relaxed);
            }
        },
        move |_error| {
            input_error.fetch_or(INPUT_FAULT, Ordering::Relaxed);
        },
    )
    .map_err(|error| format!("Erro ao abrir entrada: {error}"))?;
    let output_stream = audio::build_output_stream(
        &output,
        move || {
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
            if value.is_finite() {
                (value * SAFE_GAIN).clamp(-0.8, 0.8)
            } else {
                0.0
            }
        },
        move |_error| {
            output_error.fetch_or(OUTPUT_FAULT, Ordering::Relaxed);
        },
    )
    .map_err(|error| format!("Erro ao abrir saída: {error}"))?;
    if cancel_sequence.load(Ordering::Acquire) != start_epoch {
        return Err("Carregamento do NAM cancelado.".into());
    }
    output_stream
        .play()
        .and_then(|_| input_stream.play())
        .map_err(|error| format!("Não foi possível iniciar monitoramento: {error}"))?;
    let engine = Arc::new(EngineControl::default());
    engine.activate(&current_engine, &running)?;
    let worker_engine = Arc::clone(&engine);
    let applied_manifest = Arc::new(Mutex::new(chain_json));
    let worker_manifest = Arc::clone(&applied_manifest);
    let (updates, receiver) = mpsc::sync_channel::<RigUpdate>(1);
    let worker_running = Arc::clone(&running);
    let worker_faults = Arc::clone(&faults);
    let worker = thread::spawn(move || {
        let mut input_bytes = [0u8; FRAMES * 4];
        let mut output_bytes = [0u8; FRAMES * 4];
        while worker_running.load(Ordering::Acquire) && worker_faults.load(Ordering::Relaxed) == 0 {
            // Only this worker owns the pipes. Replace a fully prepared engine
            // between blocks; no device callback loads files or locks anything.
            if let Ok(update) = receiver.try_recv() {
                apply_rig_update(
                    &mut current_engine,
                    update,
                    &worker_engine,
                    &worker_manifest,
                    &worker_running,
                );
            }
            if input_rx.slots() < FRAMES {
                thread::sleep(Duration::from_millis(1));
                continue;
            }
            for chunk in input_bytes.as_chunks_mut::<4>().0 {
                let sample = input_rx.pop().unwrap_or(0.0);
                chunk.copy_from_slice(&sample.to_le_bytes());
            }
            if current_engine
                .process(&input_bytes, &mut output_bytes)
                .is_err()
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
    let mut guard = state
        .session
        .lock()
        .map_err(|_| "Audio state unavailable")?;
    *guard = Some(LiveSession {
        input: input_stream,
        output: output_stream,
        running,
        faults,
        underruns,
        overflows,
        engine,
        updates,
        applied_manifest,
        worker: Some(worker),
        selection,
    });
    Ok(())
}

impl Drop for LiveSession {
    fn drop(&mut self) {
        // Stop the child even if the window closes without clicking Stop.
        // Killing the child releases a worker blocked on the native pipe.
        self.running.store(false, Ordering::Release);
        let _ = self.input.pause();
        let _ = self.output.pause();
        self.engine.terminate();
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

/// Prepare the next graph while the current one keeps playing. A failed model
/// load never replaces the current graph or reopens either device stream.
pub fn update(
    state: &LiveState,
    chain_json: String,
    cancel_sequence: &AtomicU64,
    start_epoch: u64,
) -> Result<(), String> {
    validate_manifest(&chain_json)?;
    let (updates, running) = {
        let guard = state
            .session
            .lock()
            .map_err(|_| "Audio state unavailable")?;
        let session = guard.as_ref().ok_or("O áudio NAM não está ligado.")?;
        if session.faults.load(Ordering::Acquire) != 0 {
            return Err("A sessão de áudio falhou. Confira a interface e inicie novamente.".into());
        }
        if session
            .applied_manifest
            .lock()
            .map_err(|_| "Estado do rig indisponível")?
            .as_str()
            == chain_json
        {
            return Ok(());
        }
        (session.updates.clone(), Arc::clone(&session.running))
    };
    let next = NativeEngine::start(&sidecar_path()?, &chain_json, cancel_sequence, start_epoch)?;
    if cancel_sequence.load(Ordering::Acquire) != start_epoch || !running.load(Ordering::Acquire) {
        return Err("Atualização do rig cancelada.".into());
    }
    let (completion, receiver) = mpsc::sync_channel(1);
    let pending = Arc::new(AtomicU8::new(UPDATE_PENDING));
    updates
        .try_send(RigUpdate {
            engine: next,
            manifest: chain_json,
            pending: Arc::clone(&pending),
            completion,
        })
        .map_err(|_| "O motor não está disponível para atualizar o rig.".to_owned())?;
    await_rig_update(
        &receiver,
        &pending,
        cancel_sequence,
        start_epoch,
        Duration::from_secs(3),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sidecar::wait_for_handshake;

    #[test]
    fn shared_manifest_contract_accepts_and_rejects_the_same_fixtures_as_cpp() {
        let valid = include_str!("../../engine/tests/fixtures/contracts/valid-file-free.json");
        assert!(validate_manifest(valid).is_ok());
        assert!(validate_manifest(include_str!(
            "../../engine/tests/fixtures/contracts/valid-empty.json"
        ))
        .is_ok());
        for bad in [
            include_str!("../../engine/tests/fixtures/contracts/invalid-duplicate-id.json"),
            include_str!("../../engine/tests/fixtures/contracts/invalid-missing-enabled.json"),
            include_str!("../../engine/tests/fixtures/contracts/invalid-parameter-range.json"),
            include_str!("../../engine/tests/fixtures/contracts/invalid-version.json"),
        ] {
            assert!(
                validate_manifest(bad).is_err(),
                "Unexpected accepted manifest: {bad}"
            );
        }
    }

    #[test]
    fn handshake_cancellation_works_before_and_during_a_slow_reply() {
        let (_sender, receiver) = mpsc::channel::<u8>();
        let sequence = AtomicU64::new(1);
        assert!(
            wait_for_handshake(&receiver, &sequence, 0, Duration::from_secs(1))
                .unwrap_err()
                .contains("cancelado")
        );

        let epoch = sequence.load(Ordering::Acquire);
        std::thread::scope(|scope| {
            scope.spawn(|| {
                std::thread::sleep(Duration::from_millis(30));
                sequence.fetch_add(1, Ordering::AcqRel);
            });
            let start = Instant::now();
            let result = wait_for_handshake(&receiver, &sequence, epoch, Duration::from_secs(1));
            assert!(result.unwrap_err().contains("cancelado"));
            assert!(start.elapsed() < Duration::from_millis(400));
        });
    }

    #[test]
    fn handshake_timeout_and_retry_are_bounded() {
        let (sender, receiver) = mpsc::channel::<u8>();
        let sequence = AtomicU64::new(0);
        let start = Instant::now();
        let result = wait_for_handshake(&receiver, &sequence, 0, Duration::from_millis(25));
        assert!(result.unwrap_err().contains("não confirmou"));
        assert!(start.elapsed() < Duration::from_millis(400));

        sender.send(b'R').unwrap();
        assert_eq!(
            wait_for_handshake(&receiver, &sequence, 0, Duration::from_secs(1)).unwrap(),
            b'R'
        );
    }

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
    fn accepts_file_free_pressure_sustain_and_checks_bounds() {
        let valid = r#"{"schemaVersion":1,"nodes":[
            {"id":"su-1","kind":"sustain","enabled":true,
             "parameters":{"sustain":65,"speed":25,"level":-3,"mix":90}},
            {"id":"su-2","kind":"sustain","enabled":false,"parameters":{}}
        ]}"#;
        assert!(validate_manifest(valid).is_ok());
        for bad in [
            r#"{"schemaVersion":1,"nodes":[{"kind":"sustain","parameters":{"sustain":101}}]}"#,
            r#"{"schemaVersion":1,"nodes":[{"kind":"sustain","parameters":{"speed":-1}}]}"#,
            r#"{"schemaVersion":1,"nodes":[{"kind":"sustain","parameters":{"level":19}}]}"#,
            r#"{"schemaVersion":1,"nodes":[{"kind":"sustain","parameters":{"mix":101}}]}"#,
            r#"{"schemaVersion":1,"nodes":[{"kind":"sustain","parameters":{"attack":12}}]}"#,
            r#"{"schemaVersion":1,"nodes":[{"kind":"sustain","parameters":{},"resource":{"path":"test.nam"}}]}"#,
        ] {
            assert!(validate_manifest(bad).is_err());
        }
    }

    #[test]
    fn accepts_file_free_chorus_and_rejects_invalid_controls() {
        let valid = r#"{"schemaVersion":1,"nodes":[
            {"id":"ch-1","kind":"chorus","enabled":true,
             "parameters":{"rate":1.2,"depth":48,"mix":30}},
            {"id":"ch-2","kind":"chorus","enabled":false,"parameters":{}}
        ]}"#;
        assert!(validate_manifest(valid).is_ok());
        for bad in [
            r#"{"schemaVersion":1,"nodes":[{"kind":"chorus","parameters":{"rate":0}}]}"#,
            r#"{"schemaVersion":1,"nodes":[{"kind":"chorus","parameters":{"rate":9}}]}"#,
            r#"{"schemaVersion":1,"nodes":[{"kind":"chorus","parameters":{"depth":-1}}]}"#,
            r#"{"schemaVersion":1,"nodes":[{"kind":"chorus","parameters":{"mix":101}}]}"#,
            r#"{"schemaVersion":1,"nodes":[{"kind":"chorus","parameters":{"feedback":20}}]}"#,
            r#"{"schemaVersion":1,"nodes":[{"kind":"chorus","parameters":{},"resource":{"path":"bad.wav"}}]}"#,
        ] {
            assert!(validate_manifest(bad).is_err());
        }
    }

    #[test]
    fn accepts_file_free_delay_and_rejects_invalid_controls() {
        let valid = r#"{"schemaVersion":1,"nodes":[
            {"id":"dly-a","kind":"delay","enabled":true,
             "parameters":{"time":420,"feedback":38,"mix":28}},
            {"id":"dly-b","kind":"delay","enabled":false,"parameters":{}}
        ]}"#;
        assert!(validate_manifest(valid).is_ok());
        for bad in [
            r#"{"schemaVersion":1,"nodes":[{"kind":"delay","parameters":{"time":39}}]}"#,
            r#"{"schemaVersion":1,"nodes":[{"kind":"delay","parameters":{"time":1201}}]}"#,
            r#"{"schemaVersion":1,"nodes":[{"kind":"delay","parameters":{"feedback":91}}]}"#,
            r#"{"schemaVersion":1,"nodes":[{"kind":"delay","parameters":{"mix":-1}}]}"#,
            r#"{"schemaVersion":1,"nodes":[{"kind":"delay","parameters":{"tone":20}}]}"#,
            r#"{"schemaVersion":1,"nodes":[{"kind":"delay","parameters":{},"resource":{"path":"fake.nam"}}]}"#,
        ] {
            assert!(validate_manifest(bad).is_err());
        }
    }

    #[test]
    fn accepts_file_free_reverb_and_rejects_invalid_controls() {
        let valid = r#"{"schemaVersion":1,"nodes":[
            {"id":"rv-a","kind":"reverb","enabled":true,
             "parameters":{"size":67,"decay":4.2,"mix":24}},
            {"id":"rv-b","kind":"reverb","enabled":false,"parameters":{}}
        ]}"#;
        assert!(validate_manifest(valid).is_ok());
        for bad in [
            r#"{"schemaVersion":1,"nodes":[{"kind":"reverb","parameters":{"size":101}}]}"#,
            r#"{"schemaVersion":1,"nodes":[{"kind":"reverb","parameters":{"decay":0.1}}]}"#,
            r#"{"schemaVersion":1,"nodes":[{"kind":"reverb","parameters":{"decay":15.1}}]}"#,
            r#"{"schemaVersion":1,"nodes":[{"kind":"reverb","parameters":{"mix":-1}}]}"#,
            r#"{"schemaVersion":1,"nodes":[{"kind":"reverb","parameters":{"predelay":20}}]}"#,
            r#"{"schemaVersion":1,"nodes":[{"kind":"reverb","parameters":{},"resource":{"path":"fake.wav"}}]}"#,
        ] {
            assert!(validate_manifest(bad).is_err());
        }
    }

    #[test]
    fn accepts_empty_passthrough_and_rejects_unknown_or_missing_models() {
        assert!(validate_manifest("{}").is_err());
        assert!(validate_manifest(r#"{"schemaVersion":1,"nodes":[]}"#).is_ok());
        assert!(validate_manifest(r#"{"schemaVersion":1,"nodes":[{"kind":"chorus"}]}"#).is_err());
        assert!(validate_manifest(
            r#"{"schemaVersion":1,"nodes":[{"kind":"amp","resource":{"path":"missing.nam"}}]}"#
        )
        .is_err());
    }
}
