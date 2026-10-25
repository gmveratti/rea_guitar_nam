# VTTRIG 🎸

**Modular Neural Guitar Studio**. Um pedalboard desktop com visual de amplificadores clássicos, pedais próprios padronizados, presets locais e futura engine nativa de áudio com suporte ao Neural Amp Modeler A2 (Lite/Full). **Sem Wine e sem yabridge.**

> **Status: UI v0.1 + experimento de motor NAM JACK separado.** A interface Tauri **ainda não processa áudio**, não carrega redes NAM/IR e não controla ganho real; seus LEDs/knobs são visuais. Um executável C++ independente em `engine/` carrega blocos mono NAM `.nam` e IR `.wav` em ordem arbitrária via JACK/PipeWire. A versão CLI já teve build e smoke tests aprovados na CI; testes com modelos reais, equipamento e latência permanecem pendentes.

## O que funciona nesta primeira etapa

- **Amp Focus:** amplificador estilizado por CSS. Classificação heurística por nome de .nam em famílias *British, American, Stadium, Chime, Modern, Boutique*. Seletor manual corrige falsos positivos.
- **Pedais VTTRIG:** chassis padrão inspirado em stompboxes físicos, design próprio e cores por efeito: VTTCHORUS, VTTDELAY, VTTREVERB, VTTCOMP, VTTSUSTAIN, VTTGATE, VTTDRIVE, VTTAMP e VTTCAB.
- LED animado refletindo o estado do bypass **visual**; footswitch com animação de pressionar; knobs ajustáveis, destaque do pedal selecionado; reorganização por drag-and-drop e adição/remoção.
- Presets locais com validação do grafo de efeitos, persistência entre recargas e parâmetros independentes por instância. A **ordem visual é a ordem do sinal**, inclusive efeitos repetidos e bypass individual; a conexão dinâmica Tauri → DSP ainda não existe.
- Interface desktop com suporte a redução de animações pelo sistema.
- Testes unitários e testes de interação Playwright (CI).

## Rodar no Fedora (interface web para desenvolvimento)

Pré-requisitos: Node.js 22+, npm.

```bash
git clone https://github.com/gmveratti/rea_guitar_nam.git
cd rea_guitar_nam
git switch feat/tauri-pedalboard-foundation
npm install
npm run dev
```

Abra http://127.0.0.1:5173.

## Rodar desktop com Tauri

Instale Rust/Cargo e as dependências Linux para desenvolvimento Tauri 2, incluindo WebKitGTK 4.1, conforme o [guia oficial do Tauri](https://v2.tauri.app/start/prerequisites/#linux).

```bash
npm run tauri dev
```

Verificar frontend e testes:

```bash
npm run build
npm test
npx playwright install chromium
npm run test:e2e
```

## Roadmap

| Fase | Entrega | Estado |
|---|---|---|
| 0.1 | Tauri + React, skins, pedais VTTRIG, presets, LEDs e animações | Em validação |
| 0.2 | Engine nativa de áudio, PipeWire/JACK, I/O, bypass DSP real | Experimental: CLI NAM + IR mono em ordem livre; falta ligação Tauri → DSP |
| 0.3 | NAM A2 Lite/Full, loader, calibração e testes de modelos | Pendente |
| 0.4 | Cabinet IR .wav / convolução e compensação de latência | Pendente |
| 0.5 | DSP de chorus, delay, reverb, compressor e sustain | Pendente |
| 0.6 | Integração oficial TONE3000 OAuth, biblioteca e cache local | Pendente |
| 0.7 | Plugin CLAP/VST3 nativo para REAPER | Pendente |

## Organização

```text
src/                          # UI React + TypeScript
  components/AmpHero.tsx      # Amp adaptativo por família
  components/PedalFace.tsx    # Pedais VTT padronizados
  lib/ampSkins.ts             # Classificação por nome
  lib/pedals.ts               # Metadados, limites, ordem, validação
  lib/presets.ts              # Presets locais
  lib/signalChain.ts          # Contrato ordenado UI → motor (sem conexão ativa)
src-tauri/                    # Casca desktop e futuro host Rust
e2e/                          # Testes Playwright
```

**Futuro motor DSP:** biblioteca nativa separada da WebView, sem locks/alocação/log síncrono no callback de áudio. Primeiro alvo: Fedora + PipeWire/JACK + REAPER. Um plugin CLAP/VST3 requer entry point próprio; Tauri não é um VST.

## Fontes abertas e licenças

- [NeuralAmpModelerCore](https://github.com/sdatkinson/NeuralAmpModelerCore): motor NAM. Verificar compatibilidade A2 específica antes da integração.
- [NAM A2 / TONE3000](https://www.tone3000.com/blog/introducing-neural-amp-modeler-nam-architecture-2-a2): A2 Lite/Full, aberto.
- [CloudSeedCore](https://github.com/GhostNoteAudio/CloudSeedCore): candidato MIT para reverb.
- [Airwindows](https://github.com/airwindows/airwindows): candidato MIT para chorus e delay.
- [TONE3000 API](https://www.tone3000.com/api): futura integração oficial OAuth conforme [termos da plataforma](https://www.tone3000.com/api/terms).

Nenhum DSP de terceiros está incorporado nesta etapa. Ao integrar, preservar todos os avisos de copyright e as licenças aplicáveis. Os chassis e nomes VTTRIG são identidades originais inspiradas na categoria de pedais físicos, sem reproduzir marcas/logotipos de fabricantes.

## Decisões técnicas de áudio e fontes open source

**Antes de integrar código DSP**, consultar [Pesquisa de DSP, comparação comunitária, licenças e arquitetura](docs/DSP_RESEARCH_AND_ARCHITECTURE.md), com candidatos por pedal, critérios de qualidade, plano de A/B e exigências de tempo real.

Referências prioritárias (candidatos, ainda não integrados):
- **VTTREVERB**: CloudSeedCore (MIT); Dragonfly (GPLv3) como referência sonora.
- **VTTDELAY**: Airwindows TapeDelay2 (MIT); CHOW Matrix (BSD-3-Clause) para múltiplas linhas, sujeito a revisão de dependências.
- **VTTCHORUS**: DaisySP Chorus (MIT); Airwindows StereoChorus (MIT) em comparações.
- **VTTCOMP / VTTSUSTAIN**: Airwindows ButterComp2 e Pressure5 (MIT) mais referência LSP Compressor (LGPLv3) e dinâmica própria.
- **NAM A2**: NeuralAmpModelerCore (MIT) com suporte A2 introduzido na série v0.5.x; testar A2-Lite/Full em runtime.

Não confundir interface de demonstração com processamento sonoro real. A escolha final dos algoritmos requer análise de licença, testes de áudio e profiling no Fedora.


## Experimento de áudio Gateway/NAM A2 (novo)

Consulte [engine/README.md](engine/README.md) para compilar o executável `vttrig-nam-jack` no Fedora. Ele usa o NeuralAmpModelerCore MIT que sustenta o Gateway, com commit da série v0.6.0 fixado e CMake separado. É um host **mono, 48 kHz, de blocos NAM e IR em qualquer ordem determinada pelo usuário**, com IDs/estados de bypass por instância e portas JACK sem autoconexão. A ordem é fornecida via CLI nesta etapa; a alteração ao vivo a partir do drag-and-drop Tauri permanece pendente, assim como pedais de chorus, delay, reverb e compressor. Build/CTest passaram na CI; processamento audível e latência requerem teste com interface física.

Referências de implementação adicional: [Gateway / NeuralAmpModelerPlugin](https://github.com/sdatkinson/NeuralAmpModelerPlugin) e [TONE3000 Plugin (MIT)](https://github.com/tone-3000/tone3000-plugin). O plugin TONE3000 inclui código aberto para organizar modelos, IR e cadeias, mas integra JUCE e outras dependências que precisam de análise de licença antes de reaproveitamento. O formato NAM A2 e o core são abertos; acesso aos serviços da API TONE3000 continua condicionado aos termos próprios.

## Diretrizes obrigatórias de código e testes de regressão

As regras foram adaptadas do método do **TaxUtil** para o VTTRIG.
São requisitos do projeto, não recomendações opcionais. Leia
[AGENTS.md](AGENTS.md) para as regras permanentes de desenvolvimento
e [docs/TESTING.md](docs/TESTING.md) para a matriz de regressão.

- **Simplicidade, escopo e modularidade:** preferir a menor alteração correta,
  *Package by Feature*, tipagem forte, nomes claros, contratos explícitos,
  tratamento real de erros e nenhuma refatoração incidental.
- **Correções sempre com regressão:** reproduzir bug → criar teste que falha
  antes → corrigir causa-raiz → verificar o novo teste e os testes anteriores.
  Não apagar testes, reduzir asserts ou mudar comportamento só para passar CI.
- **Contrato cumulativo:** uma melhoria não pode quebrar outra já aprovada.
  Preservar presets existentes, versões do schema, dados de captura, bypass,
  parâmetros, compatibilidade de modelos e **ordem exata de efeitos escolhida
  pelo usuário**, independentemente da categoria.
- **Audio realtime:** pré-carregar modelos/IR e alocar buffers fora do callback;
  o thread de áudio não pode fazer I/O, locks, malloc, logs ou renderização.
  Reorganização ao vivo requer snapshot imutável e troca RT-safe entre blocos.
- **Revisão e evidências:** cada PR informa causa do bug, testes de regressão,
  resultados reais de build/unit/integration, impacto em licenças, eventuais
  mudanças de contrato e limitações pendentes. Não declarar testes não executados.
- **Reaproveitamento open source:** licenças, dependências transitivas e
  atribuições obrigatórias antes de copiar DSP de Airwindows/CloudSeed/DaisySP
  ou integrar NAM. Não incluir capturas privadas ou credenciais.

### Quality gate

Com dependências de Node, Rust/Tauri, CMake, JACK e Ninja instaladas:

```bash
make check
```

Esse comando centraliza o typecheck, Vitest, build frontend, rustfmt,
Clippy, Cargo tests e CMake/CTest do grafo nativo. A CI também executa
Playwright e constrói o Tauri Linux. O teste com guitarra/interface física,
latência e xruns deve ser reportado separadamente.

**Importante:** não faça merge com regressão conhecida ou teste obrigatório
falhando. O código em `main` só deve receber a mudança após validação.
