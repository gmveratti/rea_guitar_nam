# VTTRIG — política de testes e regressão

**Obrigatório:** correções seguem **bug reproduzido → teste vermelho →
correção mínima → teste verde → suites relacionadas → quality gate**.
A mesma disciplina é usada no TaxUtil. Nunca enfraquecer um teste para
mascarar uma regressão.

## Matriz de invariantes

| Área | Cobertura obrigatória |
|---|---|
| Cadeia UI | ordem **exata** do drag-and-drop, primeiro/último efeito, inserir no meio, remover e reordenar |
| Grafo DSP | `A → B` != `B → A` quando algoritmos não comutam; ordem arbitrária independente de categoria |
| Identidade | 2+ instâncias do mesmo tipo com IDs únicos, parâmetros e bypass separados |
| Bypass | saída igual a dry para todos desativados, estado preservado após reordenação |
| Preset | carregar/salvar conserva ordem, IDs, parâmetros, estado de bypass e família do amp |
| Migração | presets antigos carregam corretamente; novos schemas com versão explícita |
| NAM | A2 Lite e Full, arquivo inválido, entrada mono/estéreo, sample rate, troca segura, calibração |
| IR | mono e estéreo, WAV inválido, formato/ressampling fora da callback, convenção de ganho |
| Pedais DSP | comparação à referência aberta, estabilidade, denormal, clipping, tail, sync, parâmetro suavizado |
| Real time | sem malloc, mutex, I/O ou logging no callback, limites de buffers, xruns e picos de CPU |
| Interface | cores/padronização, LED reflete bypass, teclado, redução de movimento, screenshot visual |

### Estado real hoje

- Tests Vitest: metadados, validação, reordenação, serialização ordenada;
- Tests CTest: grafo nativo com transformações não comutativas,
  bypass, repetição de efeitos e caso sem módulos;
- Playwright: marca VTTRIG, LED, skins e presets;
- Build NAM/JACK: compile e smoke test via CI sem interface de áudio física.

**Ainda não cobertos:** processamento A2 com capturas reais no Fedora,
roteamento Tauri→engine em runtime, parâmetros DSP dos pedais,
MIDI, testes A/B de timbre, IR estéreo e instrumentos reais. Nenhuma dessas
validações pode ser considerada aprovada por CI de ajuda CLI.

## Quality gate local

Após instalar as dependências Linux de Tauri/JACK, Node e Rust:

```bash
make check
```

O alvo confere frontend/typecheck/Vitest, build, rustfmt/Clippy/Cargo Test
e C++ CMake/CTest. Os testes Playwright são executados pela CI, separadamente,
pois exigem browser. O teste com interface física (Fedora, Teyun Q24)
é outra etapa: reproduzir áudio gravando loopback, comparar o processamento
com Gateway/TONE3000 e medir CPU/xruns a 48 kHz com buffers 64/128/256.

Para diagnóstico rápido:

```bash
npm test
npm run build
cmake -S engine -B engine/build -GNinja -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTING=ON
cmake --build engine/build -j2
ctest --test-dir engine/build --output-on-failure
```


## Windows x64: distribuição e validação

O PR #8 adiciona a suíte independente `VTTRIG Tauri Windows` no GitHub
Actions, usando MSVC/Rust e gerando um instalador NSIS.

Critérios automatizados antes de aprovar o PR:

- `npm run build`, `npm test`, `cargo check`, `cargo fmt --check`,
  `cargo clippy -- -D warnings` e `cargo test` em runner Windows;
- PNG da marca VTTRIG válido e geração da versão Windows `icon.ico`;
- `python -m unittest discover -s scripts -p "test_windows_bundle.py"`;
- `python scripts/check_windows_bundle.py --preflight`, incluindo layers
  ICO 32px e 256px e override `tauri.windows.conf.json`;
- `npx tauri build --bundles nsis` e verificação posterior do instalador
  `*-setup.exe` e do executável `vttrig.exe`;
- artefato `VTTRIG-Windows-x64` efetivamente publicado no Actions.

**Validação manual obrigatória após o CI:** instalar o `.exe` num Windows
10/11 x64 de teste; abrir, navegar pelas três abas, carregar o visual de um
NAM, conferir o estado vazio (+), manipular pedais, LEDs, drag-and-drop,
salvar e reabrir presets, e desinstalar. Verificar aparência no WebView2.

Esses testes garantem somente distribuição e UI. **Não** validam áudio
NAM A2, IR, interfaces ASIO/WASAPI, latência nem processamento DSP
(no Windows ou Linux), ainda não conectados ao aplicativo Tauri.

## PR #9: regressão do núcleo NAM/IR multiplataforma

O workflow `VTTRIG NAM cross-platform DSP` agora usa matriz C++
**Ubuntu 24.04/GCC** e **Windows 2022/MSVC**. Em cada plataforma exige:

- CMake configurar/compilar `vttrig_nam_core` e
  `vttrig-nam-offline` com o mesmo commit pinned do NAM Core;
- No Linux, compilar também `vttrig-nam-jack`, sem alterar sua callback;
- Executar `ctest --test-dir engine/build -C Release --output-on-failure`;
- Confirmar schema v1, ordem arbitrária, IDs únicos e bypass por instância;
- Regressões offline PCM16 e IEEE float32, 48 kHz mono,
  input inválido, amostras não finitas, tail de bloco de 1 frame,
  passthrough com cadeia vazia e pedal em bypass;
- Publicar binários de linha de comando separados do AppImage Tauri.

Esta etapa permite processamento offline sem placa de áudio; **não prova
realtime**, USB audio interface, WASAPI/ASIO, A2 Full/Lite de modelos reais,
latência nem comando Tauri→DSP. A próxima integração deverá manter as
mesmas invariantes, com testes de amostras reais licenciadas e A/B com
Gateway/TONE3000.

## Exigência para pull requests

Descrever cada bug como:

```text
Defeito:
Como reproduzir:
Causa-raiz:
Teste de regressão (falhava antes):
Mudança:
Testes executados e resultados:
Contratos anteriores preservados:
Riscos / validação manual pendente:
```

Na fase de áudio, guardar fixtures sintéticas, dados de medição e scripts
de comparação, mas **não** cometer capturas comerciais nem gravações privadas.


## Consolidação do áudio nativo (PR #13)

- Confirmar que o código da seleção física da guitarra e os testes do PR #12 chegaram à `main`, não apenas à antiga branch do PR #11.
- Executar `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`, Clippy sem warnings, testes Rust, `npm test` e Playwright, Windows NSIS e Linux AppImage.
- Testes de regressão sintéticos: desserializar `MonitorSelection` antigo (entrada 1 por padrão) e explícito (entrada 2), validar índice fora do limite, isolar falhas independentes de entrada, saída e motor NAM.
- Teste físico pendente: Teyun Q24 com guitarra no canal 1 e 2 (quando disponibilizados pelo backend), fones em volume baixo, DRY e NAM/IR com arquivos locais, mudanças de dispositivos entre sessões, desligar/remover USB enquanto toca, clicar Parar e reabrir.
- Em desconexão, a saída deve silenciar quando possível, a UI deve indicar **qual etapa** falhou e continuar oferecendo Parar. *Rodando* significa que a sessão mantém recursos até ser finalizada, não que há sinal de áudio válido.
- Registrar xruns, uso de CPU e latência real separadamente; contadores de amostras perdidas não são uma estimativa de latência. Sem medição e testes de hardware não há homologação WASAPI/ALSA/ASIO/JACK.
