# Windows: ASIO build and distribution

Official Windows builds compile CPAL with both WASAPI and ASIO. The Windows
`cpal` target dependency enables ASIO even for a plain local Tauri build;
the workflow also passes `--features asio` explicitly to Cargo and Tauri.
`src-tauri/tests/windows_asio.rs` references `cpal::HostId::Asio` without a
feature gate, so Windows tests cannot silently pass after removing ASIO.

The SDK is needed on the build machine. Users need only their interface's
installed ASIO driver; the app does not install or replace hardware drivers.
A compiled backend does not prove that a particular interface works.

The repository-root `.cargo/config.toml` selects the static CRT only for
`x86_64-pc-windows-msvc`. Cargo discovers ancestor configuration both from
the root (`--manifest-path src-tauri/Cargo.toml`) and from `src-tauri/`
(Tauri's build invocation). The `crt-static` target feature also reaches
`asio-sys`'s C++ build through `cc`, so its objects use the same CRT as Rust.
The Windows integration test checks the effective feature, and release
validation inspects the main executable's PE imports as well as the sidecar.
See [Rust's static and dynamic C runtimes documentation](https://doc.rust-lang.org/reference/linkage.html#static-and-dynamic-c-runtimes).

## Reproducible SDK preparation

CPAL 0.17.3 / asio-sys 0.2.6 consumes `CPAL_ASIO_DIR` and requires libclang
for bindings. Provision the same official Steinberg SDK as CI:

```powershell
python scripts/setup_asio.py --output "$env:TEMP\vttrig-asio"
$env:CPAL_ASIO_DIR = "$env:TEMP\vttrig-asio\ASIOSDK"
$env:LIBCLANG_PATH = "$env:ProgramFiles\LLVM\bin"
cargo test --locked --features asio --manifest-path src-tauri/Cargo.toml
# Build/stage the native sidecar as in .github/workflows/tauri-windows.yml.
npx tauri build --bundles nsis --features asio
```

Install LLVM/Clang and Visual Studio C++ build tools before building locally.
GitHub's Windows runner supplies those tools. The provisioning script checks
SHA256 before extraction and validates headers and source layout; it never
falls back to an unverified SDK or silently omits ASIO.

- Official URL: <https://www.steinberg.net/asiosdk>
- SDK version verified: **2.3.4**
- Archive SHA256: `d5ebf0c20dd2c5f43771fd0c1418f4b361bf52434ee670097cfa6b3a335e2eca`
- A saved archive can be passed with `--archive <path>`; the same checksum
  check applies. The URL is a redirect, so an upstream update intentionally
  fails CI until the new SDK has been reviewed and the pin updated.

Primary build references:
[CPAL ASIO setup](https://github.com/RustAudio/cpal/blob/v0.17.3/README.md#asio-on-windows),
[asio-sys build script](https://github.com/RustAudio/cpal/blob/v0.17.3/asio-sys/build.rs).

## SDK license and release sources

The downloaded SDK's `LICENSE.txt` explicitly offers the proprietary
Steinberg ASIO license or GPL version 3. The repository preserves that exact
license in `engine/third_party_licenses/ASIO_SDK_LICENSE.txt`, plus the
[GNU GPLv3 text](https://www.gnu.org/licenses/gpl-3.0.txt). Windows installers
include both texts and `ASIO_NOTICE.txt` through `tauri.windows.conf.json`.

This open-source ASIO build selects the SDK's **GPLv3 option**, not the
proprietary route requiring a separately signed Steinberg agreement. This
adds distribution obligations for the resulting Windows build. Existing
MIT notices on original source are retained; the project-wide source
license is not replaced as an incidental build edit.

Before distributing an ASIO-enabled release, provide complete corresponding
source in the same download location under GPLv3 section 6: identify the
exact VTTRIG tag/commit, include build scripts and lockfiles, and make the
pinned SDK and required dependency source available. Include all applicable
copyright/license notices. A tag or this notice by itself is not a complete
source offer. This change does not publish a release or claim that those
release-source artifacts have already been produced.

## Validation boundary

CI compiles the real ASIO backend and the host-presence integration test.
The provisioning unit tests reject modified archives, missing headers and
path traversal. Runtime testing still requires a Windows machine with the
actual driver: enumerate, select one driver for duplex input/output, choose
the guitar channel, start DRY, then process NAM plus optional IR. Check
buffer sizes, driver control-panel behavior, dropouts and roundtrip latency
on that machine before claiming hardware support.
