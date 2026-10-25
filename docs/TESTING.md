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
