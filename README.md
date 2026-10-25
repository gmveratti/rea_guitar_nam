# VTTRIG 🎸

**Modular Neural Guitar Studio**. Um pedalboard desktop com visual de amplificadores clássicos, pedais próprios padronizados, presets locais e futura engine nativa de áudio com suporte ao Neural Amp Modeler A2 (Lite/Full). **Sem Wine e sem yabridge.**

> **Status: protótipo visual (v0.1).** O aplicativo já apresenta interface e controles interativos, mas **NÃO processa áudio**, **NÃO carrega redes NAM/IR** e **NÃO controla ganho real**. LEDs, knobs e seleção de .nam são demonstrações da UI.

## O que funciona nesta primeira etapa

- **Amp Focus:** amplificador estilizado por CSS. Classificação heurística por nome de .nam em famílias *British, American, Stadium, Chime, Modern, Boutique*. Seletor manual corrige falsos positivos.
- **Pedais VTTRIG:** chassis padrão inspirado em stompboxes físicos, design próprio e cores por efeito: VTTCHORUS, VTTDELAY, VTTREVERB, VTTCOMP, VTTSUSTAIN, VTTGATE, VTTDRIVE, VTTAMP e VTTCAB.
- LED animado refletindo o estado do bypass **visual**; footswitch com animação de pressionar; knobs ajustáveis, destaque do pedal selecionado; reorganização por drag-and-drop e adição/remoção.
- Presets locais com validação do grafo de efeitos, persistência entre recargas e parâmetros independentes por instância.
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
| 0.2 | Engine nativa de áudio, PipeWire/JACK, I/O, bypass DSP real | Pendente |
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
