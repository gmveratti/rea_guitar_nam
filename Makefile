# VTTRIG quality gate, inspirado na disciplina do TaxUtil.
# Prerequisites: npm dependencies installed; Rust/Tauri development packages;
# CMake/Ninja/C++/JACK headers installed for native Linux engine.

.PHONY: type unit web rust-format rust-lint rust-test native-configure native-build native-test native-check check

type:
	npx tsc --noEmit

unit:
	npm test

web:
	npm run build

rust-format:
	cd src-tauri && cargo fmt --all -- --check

rust-lint:
	cd src-tauri && cargo clippy --all-targets -- -D warnings

rust-test:
	cd src-tauri && cargo test

native-configure:
	cmake -S engine -B engine/build -GNinja -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTING=ON

native-build: native-configure
	cmake --build engine/build --parallel 2

native-test: native-build
	ctest --test-dir engine/build --output-on-failure

native-check: native-test

check: type unit web rust-format rust-lint rust-test native-check
