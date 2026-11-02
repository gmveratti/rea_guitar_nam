//! Native process lifecycle. All pipe I/O and waits stay outside device callbacks.
use std::collections::VecDeque;
use std::io::{Read, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, ChildStdout, Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, SyncSender};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

const STDERR_LIMIT: usize = 16 * 1024;
pub(crate) const UPDATE_PENDING: u8 = 0;
const UPDATE_COMMITTING: u8 = 1;
const UPDATE_COMPLETED: u8 = 2;
const UPDATE_CANCELLED: u8 = 3;
type ProcessHandle = Arc<Mutex<Child>>;

/// A separate control handle can interrupt a worker blocked on the active pipe.
/// Device callbacks never access this mutex.
#[derive(Default)]
pub(crate) struct EngineControl {
    active: Mutex<Option<ProcessHandle>>,
}

impl EngineControl {
    pub(crate) fn activate(
        &self,
        engine: &NativeEngine,
        running: &AtomicBool,
    ) -> Result<(), String> {
        let mut active = self.active.lock().map_err(|_| "Motor NAM indisponível")?;
        if !running.load(Ordering::Acquire) {
            return Err("Sessão NAM encerrada durante o carregamento.".into());
        }
        *active = Some(Arc::clone(&engine.child));
        Ok(())
    }

    pub(crate) fn terminate(&self) {
        let child = self.active.lock().ok().and_then(|mut active| active.take());
        if let Some(child) = child {
            terminate(&child);
        }
    }
}

pub(crate) struct RigUpdate {
    pub(crate) engine: NativeEngine,
    pub(crate) manifest: String,
    pub(crate) pending: Arc<AtomicU8>,
    pub(crate) completion: SyncSender<Result<(), String>>,
}

pub(crate) fn apply_rig_update(
    current: &mut NativeEngine,
    update: RigUpdate,
    control: &EngineControl,
    applied_manifest: &Mutex<String>,
    running: &AtomicBool,
) {
    let result = (|| {
        let mut applied = applied_manifest
            .lock()
            .map_err(|_| "Estado do rig indisponível")?;
        // The queued -> committing transition is the cancellation boundary.
        // Once claimed, acknowledge the actual commit before the caller returns.
        if update
            .pending
            .compare_exchange(
                UPDATE_PENDING,
                UPDATE_COMMITTING,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .is_err()
        {
            return Err("Atualização do rig cancelada.".to_owned());
        }
        control.activate(&update.engine, running)?;
        let previous = std::mem::replace(current, update.engine);
        *applied = update.manifest;
        drop(applied);
        Ok(previous)
    })();
    update.pending.store(UPDATE_COMPLETED, Ordering::Release);
    match result {
        Ok(previous) => {
            // Acknowledge before process reaping: the commit has no pipe I/O,
            // model loads or child waits, and Stop can now acquire the gate.
            let _ = update.completion.send(Ok(()));
            drop(previous);
        }
        Err(error) => {
            let _ = update.completion.send(Err(error));
        }
    }
}

pub(crate) fn await_rig_update(
    receiver: &Receiver<Result<(), String>>,
    pending: &AtomicU8,
    cancel_sequence: &AtomicU64,
    start_epoch: u64,
    timeout: Duration,
) -> Result<(), String> {
    match wait_for_handshake(receiver, cancel_sequence, start_epoch, timeout) {
        Ok(reply) => reply,
        Err(error) => {
            match pending.compare_exchange(
                UPDATE_PENDING,
                UPDATE_CANCELLED,
                Ordering::AcqRel,
                Ordering::Acquire,
            ) {
                Ok(_) | Err(UPDATE_CANCELLED) => Err(error),
                // The worker has already claimed the update. It commits using
                // only short control locks, then acknowledges BEFORE reaping.
                // Returning a timeout here could falsely say the old rig stayed.
                Err(_) => receiver
                    .recv()
                    .map_err(|_| "Motor encerrou durante a atualização do rig".to_owned())?,
            }
        }
    }
}

struct StderrCapture {
    tail: Arc<Mutex<VecDeque<u8>>>,
    reader: Option<JoinHandle<()>>,
}

impl StderrCapture {
    fn start(mut source: impl Read + Send + 'static) -> Self {
        let tail = Arc::new(Mutex::new(VecDeque::with_capacity(STDERR_LIMIT)));
        let buffer = Arc::clone(&tail);
        let reader = thread::spawn(move || {
            let mut chunk = [0u8; 4096];
            while let Ok(count) = source.read(&mut chunk) {
                if count == 0 {
                    break;
                }
                if let Ok(mut tail) = buffer.lock() {
                    for byte in &chunk[..count] {
                        if tail.len() == STDERR_LIMIT {
                            tail.pop_front();
                        }
                        tail.push_back(*byte);
                    }
                }
            }
        });
        Self {
            tail,
            reader: Some(reader),
        }
    }

    fn finish(&mut self) -> String {
        if let Some(reader) = self.reader.take() {
            let _ = reader.join();
        }
        self.tail
            .lock()
            .map(|tail| {
                String::from_utf8_lossy(&tail.iter().copied().collect::<Vec<_>>())
                    .trim()
                    .to_owned()
            })
            .unwrap_or_default()
    }
}

pub(crate) struct NativeEngine {
    child: ProcessHandle,
    input: ChildStdin,
    output: ChildStdout,
    diagnostics: StderrCapture,
}

impl NativeEngine {
    pub(crate) fn start(
        binary: &Path,
        manifest: &str,
        cancel_sequence: &AtomicU64,
        start_epoch: u64,
    ) -> Result<Self, String> {
        let mut command = Command::new(binary);
        command.arg("--chain-json").arg(manifest);
        Self::start_command(
            command,
            cancel_sequence,
            start_epoch,
            Duration::from_secs(30),
        )
    }

    fn start_command(
        mut command: Command,
        cancel_sequence: &AtomicU64,
        start_epoch: u64,
        timeout: Duration,
    ) -> Result<Self, String> {
        let mut child = command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| format!("Não foi possível iniciar o motor NAM: {error}"))?;
        let mut diagnostics = StderrCapture::start(child.stderr.take().expect("piped stderr"));
        let input = child.stdin.take().expect("piped stdin");
        let mut output = child.stdout.take().expect("piped stdout");
        let (sender, receiver) = mpsc::sync_channel(1);
        let reader = thread::spawn(move || {
            let mut ready = [0u8; 1];
            let reply = output.read_exact(&mut ready).map(|_| ready[0]);
            let _ = sender.send((reply, output));
        });
        match wait_for_handshake(&receiver, cancel_sequence, start_epoch, timeout) {
            Ok((Ok(b'R'), output)) => {
                let _ = reader.join();
                Ok(Self {
                    child: Arc::new(Mutex::new(child)),
                    input,
                    output,
                    diagnostics,
                })
            }
            reply => {
                // EOF can arrive a moment before the OS publishes the real exit
                // status. Preserve that status instead of killing it first.
                let deadline = Instant::now() + Duration::from_millis(100);
                let status = loop {
                    match child.try_wait() {
                        Ok(Some(status)) => break Some(status),
                        _ if Instant::now() >= deadline => {
                            let _ = child.kill();
                            break child.wait().ok();
                        }
                        _ => thread::sleep(Duration::from_millis(5)),
                    }
                };
                // Killing first also unblocks a reader on timeout/cancellation.
                let _ = reader.join();
                let errors = diagnostics.finish();
                let reason = match reply {
                    Err(error) => error,
                    Ok((reply, _)) => format!("Motor NAM não confirmou o carregamento: {reply:?}"),
                };
                let status = status
                    .map(exit_description)
                    .unwrap_or_else(|| "código de saída indisponível".into());
                Err(format!(
                    "{reason} ({status}){}",
                    if errors.is_empty() {
                        String::new()
                    } else {
                        format!(": {errors}")
                    }
                ))
            }
        }
    }

    pub(crate) fn process(&mut self, input: &[u8], output: &mut [u8]) -> std::io::Result<()> {
        self.input.write_all(input)?;
        self.output.read_exact(output)
    }
}

impl Drop for NativeEngine {
    fn drop(&mut self) {
        terminate(&self.child);
        self.diagnostics.finish();
    }
}

fn terminate(child: &ProcessHandle) {
    if let Ok(mut child) = child.lock() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

pub(crate) fn wait_for_handshake<T>(
    receiver: &Receiver<T>,
    cancel_sequence: &AtomicU64,
    start_epoch: u64,
    timeout: Duration,
) -> Result<T, String> {
    let deadline = Instant::now() + timeout;
    loop {
        if cancel_sequence.load(Ordering::Acquire) != start_epoch {
            return Err("Carregamento do NAM cancelado.".into());
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err("Motor NAM não confirmou inicialização dentro do prazo.".into());
        }
        match receiver.recv_timeout(remaining.min(Duration::from_millis(50))) {
            Ok(reply) => {
                if cancel_sequence.load(Ordering::Acquire) != start_epoch {
                    return Err("Carregamento do NAM cancelado.".into());
                }
                return Ok(reply);
            }
            Err(RecvTimeoutError::Timeout) => continue,
            Err(RecvTimeoutError::Disconnected) => {
                return Err("Motor NAM encerrou antes do carregamento.".into())
            }
        }
    }
}

fn exit_description(status: ExitStatus) -> String {
    match status.code() {
        Some(code) => {
            let hint = match code as u32 {
                0xC0000135 => ": DLL necessária ao motor não encontrada",
                0xC000007B => ": executável ou DLL com arquitetura incompatível",
                0xC000001D => ": instrução não suportada pelo processador",
                0xC0000005 => ": falha de acesso à memória no motor",
                _ => "",
            };
            format!("saída {code}, 0x{:08X}{hint}", code as u32)
        }
        None => status.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn native_binary() -> std::path::PathBuf {
        if let Some(path) = std::env::var_os("VTTRIG_TEST_SIDECAR") {
            return path.into();
        }
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
        let suffix = if cfg!(windows) { ".exe" } else { "" };
        [
            "engine/build-live/Release",
            "engine/build-live",
            "engine/build/Release",
            "engine/build",
        ]
        .into_iter()
        .map(|dir| root.join(dir).join(format!("vttrig-nam-live{suffix}")))
        .find(|path| path.is_file())
        .expect("Build vttrig-nam-live before Rust integration tests")
    }

    fn gain_manifest(output: u32) -> String {
        format!(
            r#"{{"schemaVersion":1,"nodes":[{{"id":"gain","kind":"compressor","enabled":true,"parameters":{{"compress":0,"output":{output},"mix":100}}}}]}}"#
        )
    }

    #[test]
    fn timeout_cancels_only_queued_updates_and_committing_updates_report_their_result() {
        let cancel = AtomicU64::new(0);
        let queued = AtomicU8::new(UPDATE_PENDING);
        let (_sender, receiver) = mpsc::sync_channel::<Result<(), String>>(1);
        assert!(
            await_rig_update(&receiver, &queued, &cancel, 0, Duration::from_millis(10)).is_err()
        );
        assert_eq!(queued.load(Ordering::Acquire), UPDATE_CANCELLED);

        let committing = Arc::new(AtomicU8::new(UPDATE_COMMITTING));
        let flag = Arc::clone(&committing);
        let (sender, receiver) = mpsc::sync_channel(1);
        let worker = thread::spawn(move || {
            thread::sleep(Duration::from_millis(30));
            flag.store(UPDATE_COMPLETED, Ordering::Release);
            sender.send(Ok(())).unwrap();
        });
        // The deadline races a commit already claimed by the worker. The
        // authoritative result must win, never a false "old rig retained".
        assert!(await_rig_update(
            &receiver,
            &committing,
            &cancel,
            0,
            Duration::from_millis(10)
        )
        .is_ok());
        worker.join().unwrap();
    }

    fn first_sample(engine: &mut NativeEngine) -> f32 {
        let mut input = [0u8; 512];
        input[..4].copy_from_slice(&0.25_f32.to_le_bytes());
        let mut output = [0u8; 512];
        engine.process(&input, &mut output).unwrap();
        f32::from_le_bytes(output[..4].try_into().unwrap())
    }

    #[test]
    fn native_rig_swap_changes_audio_and_failed_preparation_keeps_previous_engine() {
        let binary = native_binary();
        let cancel = AtomicU64::new(0);
        let first = gain_manifest(100);
        let mut current = NativeEngine::start(&binary, &first, &cancel, 0).unwrap();
        let running = AtomicBool::new(true);
        let control = EngineControl::default();
        control.activate(&current, &running).unwrap();
        let applied = Mutex::new(first.clone());
        assert!((first_sample(&mut current) - 0.25).abs() < 1e-6);

        // A bad replacement is rejected before it can enter the worker queue.
        assert!(NativeEngine::start(&binary, "{invalid}", &cancel, 0).is_err());
        assert_eq!(*applied.lock().unwrap(), first);
        assert!((first_sample(&mut current) - 0.25).abs() < 1e-6);

        let second = gain_manifest(50);
        let next = NativeEngine::start(&binary, &second, &cancel, 0).unwrap();
        let (completion, reply) = mpsc::sync_channel(1);
        apply_rig_update(
            &mut current,
            RigUpdate {
                engine: next,
                manifest: second.clone(),
                pending: Arc::new(AtomicU8::new(UPDATE_PENDING)),
                completion,
            },
            &control,
            &applied,
            &running,
        );
        assert!(reply.recv().unwrap().is_ok());
        assert_eq!(*applied.lock().unwrap(), second);
        assert!((first_sample(&mut current) - 0.125).abs() < 1e-6);
        control.terminate();
    }

    #[test]
    fn native_expired_or_stopped_replacement_does_not_change_audio() {
        let binary = native_binary();
        let cancel = AtomicU64::new(0);
        let first = gain_manifest(100);
        let mut current = NativeEngine::start(&binary, &first, &cancel, 0).unwrap();
        let running = AtomicBool::new(true);
        let control = EngineControl::default();
        control.activate(&current, &running).unwrap();
        let applied = Mutex::new(first.clone());
        for stopped in [false, true] {
            let next = NativeEngine::start(&binary, &gain_manifest(50), &cancel, 0).unwrap();
            if stopped {
                running.store(false, Ordering::Release);
            }
            let (completion, reply) = mpsc::sync_channel(1);
            apply_rig_update(
                &mut current,
                RigUpdate {
                    engine: next,
                    manifest: gain_manifest(50),
                    pending: Arc::new(AtomicU8::new(if stopped {
                        UPDATE_PENDING
                    } else {
                        UPDATE_CANCELLED
                    })),
                    completion,
                },
                &control,
                &applied,
                &running,
            );
            assert!(reply.recv().unwrap().is_err());
            assert_eq!(*applied.lock().unwrap(), first);
            assert!((first_sample(&mut current) - 0.25).abs() < 1e-6);
        }
        control.terminate();
    }

    fn python(source: &str) -> Command {
        let mut command = Command::new(if cfg!(windows) { "python" } else { "python3" });
        command.arg("-c").arg(source);
        command
    }

    #[test]
    fn startup_retains_native_error_and_actual_exit_code() {
        let result = NativeEngine::start_command(
            python("import sys; sys.stderr.write('invalid NAM weights\\n'); sys.exit(23)"),
            &AtomicU64::new(0),
            0,
            Duration::from_secs(2),
        );
        let error = result.err().expect("must fail before READY");
        assert!(error.contains("invalid NAM weights"), "{error}");
        assert!(error.contains("0x00000017"), "{error}");
    }

    #[test]
    fn startup_drains_large_stderr_without_deadlock_and_keeps_bounded_tail() {
        let mut engine = NativeEngine::start_command(
            python("import sys; sys.stderr.write('x'*100000+'TAIL'); sys.stderr.flush(); sys.stdout.buffer.write(b'R'); sys.stdout.buffer.flush(); sys.stdin.buffer.read()"),
            &AtomicU64::new(0), 0, Duration::from_secs(3),
        ).unwrap_or_else(|error| panic!("{error}"));
        terminate(&engine.child);
        let tail = engine.diagnostics.finish();
        assert_eq!(tail.len(), STDERR_LIMIT);
        assert!(tail.ends_with("TAIL"));
    }

    #[test]
    fn cancellation_stops_a_preparing_process_and_a_later_start_succeeds() {
        let cancel = Arc::new(AtomicU64::new(0));
        let flag = Arc::clone(&cancel);
        let thread = thread::spawn(move || {
            NativeEngine::start_command(
                python("import time; time.sleep(10)"),
                &flag,
                0,
                Duration::from_secs(15),
            )
            .err()
            .unwrap()
        });
        thread::sleep(Duration::from_millis(100));
        cancel.fetch_add(1, Ordering::AcqRel);
        assert!(thread.join().unwrap().contains("cancelado"));
        let result = NativeEngine::start_command(python("import sys; sys.stdout.buffer.write(b'R'); sys.stdout.buffer.flush(); sys.stdin.buffer.read()"), &cancel, 1, Duration::from_secs(3));
        assert!(result.is_ok());
    }

    #[test]
    fn control_kills_active_process_and_rejects_swap_after_stop() {
        let engine = NativeEngine::start_command(python("import sys; sys.stdout.buffer.write(b'R'); sys.stdout.buffer.flush(); sys.stdin.buffer.read()"), &AtomicU64::new(0), 0, Duration::from_secs(3)).unwrap_or_else(|error| panic!("{error}"));
        let running = AtomicBool::new(true);
        let control = EngineControl::default();
        control.activate(&engine, &running).unwrap();
        running.store(false, Ordering::Release);
        control.terminate();
        assert!(engine.child.lock().unwrap().try_wait().unwrap().is_some());
        assert!(control.activate(&engine, &running).is_err());
    }

    #[test]
    fn stderr_capture_retains_only_tail() {
        let mut capture = StderrCapture::start(std::io::Cursor::new(vec![b'z'; STDERR_LIMIT * 3]));
        assert_eq!(capture.finish().len(), STDERR_LIMIT);
    }
}
