//! This test must compile in every Windows build, even without --features asio.
//! It requires no audio device or installed vendor driver on the CI runner.
#![cfg(target_os = "windows")]

#[test]
fn windows_build_includes_the_asio_host() {
    // Referencing the actual enum variant fails compilation if CPAL's ASIO
    // backend was left out of the executable again.
    assert!(cpal::ALL_HOSTS.contains(&cpal::HostId::Asio));
    assert!(cpal::ALL_HOSTS.contains(&cpal::HostId::Wasapi));
    assert!(
        cfg!(target_feature = "crt-static"),
        "Windows ASIO builds must not require an unbundled MSVC runtime"
    );
}
