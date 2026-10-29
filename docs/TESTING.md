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


## CI de qualidade versus empacotamento de Releases

| Evento | UI/Vitest/Playwright | Rust/C++/CTest | Instaladores e downloads binários |
|---|---|---|---|
| Pull request | Sim | Sim | **Não** |
| Push/merge em `main` | Sim | Sim | **Não** |
| `workflow_dispatch` dos jobs nativos | Validações do workflow | Sim | **Não** |
| `release.published` | Validações no tag de release | Sim | **NSIS, AppImage, NAM standalone** |

- Os processos de compilação usados para `cargo check`, CTest e integração
  do sidecar ainda são necessários para verificar o código, mas **não geram
  instaladores para distribuição nem publicam executáveis como artefatos**.
- Ao **publicar uma GitHub Release**, os workflows verificam o código da tag,
  montam os instaladores, validam os arquivos gerados e os anexam na Release.
  Falha de qualquer etapa impede a publicação automática daquele asset.
- Criar somente uma **tag**, abrir um PR ou fazer merge **não** publica binaries;
  uma Release publicada é o evento intencional de distribuição.
- Uma release publicada pode aparecer inicialmente sem anexos até os jobs
  terminarem; confira os resultados no Actions antes de anunciar a versão
  como validada. Os instaladores não são assinados digitalmente.

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
- **somente em `release.published`:** `npx tauri build --bundles nsis`,
  verificação posterior do instalador `*-setup.exe` e do executável
  `vttrig.exe`, upload do artefato `VTTRIG-Windows-x64` e anexo à Release.

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
- **Somente durante uma Release publicada:** distribuir os binários de linha
  de comando, separados do AppImage Tauri.

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


## PR #14: persistência do setup e validação de presets

Regressões obrigatórias:

- `src/lib/audioSettings.test.ts`: configurações NAM/IR e bypass sobrevivem ao ciclo de armazenamento local; versões inválidas, caminhos corrompidos e armazenamento bloqueado recuperam valores seguros. O áudio nunca é iniciado por restaurar dados.
- `src/lib/presetsVisual.test.ts` e `e2e/visual-draft.spec.ts`: nome visual do amplificador e família sobrevivem à troca de tela e recarga da WebView; presets legados não são alterados.
- `src/lib/pedals.test.ts`: `constructor`/`__proto__` não podem passar como tipos de pedais nem causar exceções durante importação.
- `engine/tests/manifest_tests.cpp`: extensões `.NAM`/`.WAV` maiúsculas devem ser aceitas no manifesto C++ sem modificar o caminho real.
- Regressão manual com hardware: salvar NAM/IR, fechar/reabrir VTTRIG, conferir escolhas, reescolher dispositivos, verificar que nenhum stream liga sozinho; mover/apagar arquivo salvo e confirmar erro claro no próximo Start; validar canal de guitarra correto após trocar a interface USB.

O setup NAM/IR **não é um preset DSP completo**. A unificação com a pedalboard visual e a construção de um único RigState continuam em etapa independente.


## PR #15: pedalboard → motor NAM/IR (inicial, reinício manual)

- Vitest `src/lib/liveRig.test.ts`: ordem exata (IR→NAM ou NAM→IR), vários módulos do mesmo tipo, IDs e bypass por instância, power do amplificador, efeito não implementado ignorado com aviso, arquivos ausentes/errados, slots sem recursos em bypass e cadeia sem processadores válidos.
- Vitest `src/lib/liveRigPresets.test.ts`: persistência de caminhos nativos por ID, compatibilidade de preset legado, descarte de recursos órfãos ao excluir um pedal.
- Playwright `e2e/board-native-rig.spec.ts`: biblioteca associa slots NAM, interface web não simula drivers nativos, footswitch mantém bypass e preset após recarga.
- Critério de áudio: `audio_start_live` recebe apenas `schemaVersion:1` com nós `amp/drive/cabinet` configurados em ordem visual. O usuário deve reiniciar para aplicar mudanças, nunca alterar o grafo C++ ativo no callback de áudio.
- Não declarar aprovação de hardware pela CI. Teyun Q24 e sessões longas com guitarras reais são exigências posteriores; medição de latência e xruns pendente.
