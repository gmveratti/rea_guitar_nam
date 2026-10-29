# VTTRIG — decisão técnica de DSP e referências open source

**Estado:** pesquisa de DSP iniciada em 25/10/2026; definição da origem dos modelos NAM A2 e IR atualizada em 29/10/2026. **A seleção de algoritmos dos demais pedais ainda depende de validação auditiva e técnica.**

## 1. Contexto completo do produto

VTTRIG é um estúdio de guitarra desktop **nativo no Fedora**, sem Wine/yabridge, com **Tauri 2 + React/TypeScript para a UI** e **motor de áudio independente de baixa latência** (Rust/C++). O uso inicial é como aplicativo standalone via PipeWire/JACK; uma futura versão de **plugin CLAP/VST3 para REAPER** deve compartilhar o mesmo motor DSP, mas não carregar a WebView/Tauri como plugin por acidente.

A experiência desejada combina:
- **Amp Focus:** head visual grande inspirado em amplificadores, marca própria VTTRIG; família gráfica identificada heurísticamente pelo nome de arquivo `.nam` e por metadados confiáveis quando disponíveis; possibilidade de correção manual.
- **Pedalboard:** pedais padronizados, inspirados no **tipo físico de stompbox**, mas chassis, textos e marca VTTRIG originais: VTTCHORUS, VTTDELAY, VTTREVERB, VTTCOMP, VTTSUSTAIN, VTTGATE, VTTDRIVE, VTTAMP e VTTCAB. Cada efeito tem cor própria, knobs, footswitch clicável, LED on/off, microanimações, bypass e reordenação de cadeia.
- **Biblioteca local e presets:** salvar/carregar, arrastar módulos, nomes e parâmetros próprios por instância, futuro import/export JSON versionado, snapshots e modelos associados por hash/path.
- **VTTAMP:** executa capturas de amplificadores em **NAM A2-Lite / A2-Full (`.nam`)**, baixadas pelo usuário do **TONE3000**. O DSP é o NeuralAmpModelerCore; não buscar um segundo algoritmo de simulação de amplificador.
- **VTTCAB:** reproduz **Impulse Responses de gabinetes (`.wav`)** obtidas pelo usuário no **TONE3000**, usando o processamento nativo de convolução IR. Não é um novo simulador de gabinete nem um pedal que precise de seleção de algoritmo de modulação.
- **VTTDRIVE:** pode executar capturas de pedais de drive **NAM A2 (`.nam`)** obtidas no TONE3000, reutilizando o mesmo motor NAM.
- **Capturas NAM são snapshots** do equipamento; knobs decorativos da skin não alteram os controles físicos capturados. EQ/ganho próprios só devem influenciar o som através de blocos DSP externos bem definidos.
- **TONE3000:** origem de **arquivos baixados pelo usuário e importados localmente**, sem empacotar capturas de terceiros. Integração futura via API oficial, condicionada aos termos e autorização da plataforma; nunca colocar credenciais ou segredos na WebView.

### Origem dos arquivos de amplificador e gabinete: decisão de produto (29/10/2026)

| Módulo | Arquivo selecionado pelo usuário | Origem dos arquivos | Papel do motor de áudio |
|---|---|---|---|
| **VTTAMP** | Modelo NAM **A2-Lite ou A2-Full** (`.nam`) | [TONE3000](https://www.tone3000.com/) | Executar a captura pelo **NeuralAmpModelerCore** |
| **VTTCAB** | Resposta ao impulso de gabinete (`.wav`) | [TONE3000 – IRs](https://www.tone3000.com/guides/impulse-responses) | Aplicar a IR com o convolutor nativo |
| **VTTDRIVE** | Captura NAM A2 de pedal de drive (`.nam`) | [TONE3000](https://www.tone3000.com/) | Executar a captura pelo **NeuralAmpModelerCore** |

**Fluxo atual:** acessar o TONE3000, escolher e baixar os arquivos autorizados, armazená-los localmente e selecioná-los na pedalboard. **Não há download automático do TONE3000 implementado no VTTRIG.** A busca e o download integrados, se adotados, são funcionalidade futura e só podem usar fluxos oficiais autorizados. O site também contém capturas legadas A1; priorizar e testar especificamente **A2-Lite/A2-Full** para a proposta atual, sem presumir que todo arquivo `.nam` baixado seja A2.

**Amp Head × Amp + Cab:** o modelo de cabeçote sem gabinete costuma precisar de IR separada; uma captura *Amp + Cab* já incorpora o gabinete, então uma IR extra é opcional e pode causar coloração duplicada. Não adicionar IR automaticamente nem proibir outras ordens: a cadeia continua definida pelo usuário.

**Compatibilidade atual:** o protótipo nativo aceita NAM e IR mono em **48 kHz**, com arquivos locais, sem resampling garantido. Antes de anunciar suporte completo, validar A2-Full/A2-Lite e cada IR real no motor e nos sistemas-alvo. Capturas e IRs pertencem aos seus autores; não redistribuí-las no instalador sem permissão.

Referências oficiais: [guia NAM × IR](https://www.tone3000.com/guides/neural-amp-modeler), [guia NAM A2](https://www.tone3000.com/guides/nam-a2-the-complete-guide), [biblioteca de IRs](https://www.tone3000.com/guides/impulse-responses).

## 2. Critérios para selecionar código

Não existe um único “melhor” universal. As escolhas abaixo conciliam **recomendações reais na comunidade Linux/audio**, características sonoras, maturidade, licença clara e possibilidade de extrair o **motor DSP**, em vez de embutir outro plugin com GUI. Benchmark com ouvido e CPU na máquina-alvo antes de congelar algoritmos.

- **Qualidade musical:** comparação A/B às cegas com volumes igualados, guitarra limpa/crunch/high gain e testes de mix.
- **Baixa latência e RT-safe:** sem heap/locks/IO/log no callback, buffers inicializados fora do thread de áudio, prevenção de denormal, mudanças suavizadas, estabilidade em 48 kHz e buffers 64/128/256.
- **Licenças:** auditadas por arquivo e por dependência; manter notices. Preferir código MIT/BSD-3-Clause. Software gratuito **não** implica código aberto.
- **Integração:** processamento em bloco, sem WebView no thread de áudio; configuração e pré-carregamento assíncronos, swap seguro de estados.
- **Identidade:** usar DSP aberto com UI VTTRIG original. Não reutilizar logos, gráficos, texturas e marcas comerciais de terceiros.

## 3. Matriz de candidatos, referências e decisão

| Pedal / implementação | Motor aberto candidato | Licença do projeto | Papel no VTTRIG | Nota de adoção |
|---|---|---|---|---|
| **VTTREVERB / Room mono** | **DSP original VTTRIG**, reverberação tipo Schroeder com quatro combs e dois allpasses | Código próprio VTTRIG | **Implementado na etapa Room**: Size, Decay RT60 aproximado, Mix; mono 48 kHz | Caudas, densidade e bypass testados em CTest; falta audição e profiling físico |\n| **VTTREVERB / Cloud futuro** | [Ghost Note CloudSeedCore](https://github.com/GhostNoteAudio/CloudSeedCore) | MIT | **Candidato futuro** para caudas densas e efeitos ambient, não integrado nesta etapa | Analisar consumo de CPU, modulação, licença e mudanças de parâmetros com segurança |
| **VTTREVERB / Plate/Room** | [Dragonfly Reverb](https://github.com/michaelwillis/dragonfly-reverb) | GPLv3 | **Referência de timbre e A/B**, não copiar direto para uma base MIT | Muito recomendado nos fóruns Linux; compartilhar código exige análise da GPL do produto derivado |
| **VTTREVERB / alternative** | [Airwindows Verbity / Galactic / kPlate](https://github.com/airwindows/airwindows) | MIT | **Experimentos A/B** para plate/hall/efeitos especiais | Caracteres distintos, possível combinar em modos separados |
| **VTTDELAY / Tape futuro** | [Airwindows TapeDelay2](https://github.com/airwindows/airwindows/blob/master/plugins/LinuxVST/src/TapeDelay2/TapeDelay2Proc.cpp) | MIT | **Modo futuro, não implementado nesta etapa** | Tempo baseado em velocidade do buffer, regeneração filtrada, ressonância e flutter: não equivale diretamente ao Time em ms |
| **VTTDELAY / Multi-tap** | [CHOW Matrix](https://github.com/Chowdhury-DSP/ChowMatrix) | BSD-3-Clause | **Candidato a modo avançado**, múltiplas linhas/feedback | Reuso do DSP precisa checar dependências de JUCE/terceiros; não transportar o plugin inteiro sem auditoria |
| **VTTDELAY / Classic mono** | **DSP original VTTRIG**, linha circular com feedback filtrado e saturação suave | Código próprio VTTRIG | **Implementado em C++20**, tempo exato 40–1200 ms, feedback 0–90%, mix 0–100% | Presets existentes compatíveis; feedback reduz brilho dos ecos; tap tempo, modos Tape e testes físicos pendentes |
| **VTTCHORUS / Stereo** | [Airwindows StereoChorus](https://github.com/airwindows/airwindows) | MIT | **Candidato A/B de chorus estéreo** | Comparar com DaisySP para robustez, mono compatibility e ruído |
| **VTTCHORUS / Classic mono** | [DaisySP Chorus](https://github.com/daisyaudio/DaisySP/blob/master/Source/Effects/chorus.cpp) | MIT | **Duas vozes com delay modulado e LFO triangular adaptadas em C++20** (PR Chorus), 48 kHz mono | Rate, Depth e Mix reais; feedback fixo 20%; versão estéreo e teste auditivo ainda pendentes |
| **VTTCOMP / Smooth** | [Airwindows ButterComp2](https://github.com/airwindows/airwindows/blob/master/plugins/LinuxVST/src/ButterComp2/ButterComp2Proc.cpp) | MIT | **DSP implementado em C++ nativo (PR Compressor)** | Parâmetros reais **Compress, Output, Dry/Wet**. Mono/48 kHz, sem VST/JUCE; A/B físico pendente |
| **VTTCOMP / Character** | [Airwindows Pressure5](https://github.com/airwindows/airwindows) | MIT | **Modo punch/character**, opcional | A/B contra clean para não hipercomprimir o transiente |
| **VTTCOMP / Transparent** | [LSP Compressor](https://github.com/lsp-plugins/) | LGPLv3 | **Referência técnica de dinâmica**, possível integração isolada conforme licença | Compressor com envelope, knee, attack/release, sidechain; auditar obrigações de distribuição antes de importar |
| **VTTSUSTAIN / Pressure** | [Airwindows Pressure5](https://github.com/airwindows/airwindows/blob/master/plugins/LinuxVST/src/Pressure5/Pressure5Proc.cpp) | MIT | **Núcleo `mu` adaptado em C++20** (PR VTTSUSTAIN), sem clip/delay original; teto de pico próprio | Sustain, Speed não linear, Level em dB e Mix reais; medir sustain audível, ruído, CPU e A/B no hardware |
| **VTTAMP / VTTDRIVE (capturas NAM A2)** | [NeuralAmpModelerCore](https://github.com/sdatkinson/NeuralAmpModelerCore) | MIT (motor) | Executar arquivos `.nam` A2 baixados do TONE3000 | **Motor escolhido**; ainda testar A2-Lite/Full reais e calibração no hardware |
| **VTTCAB (IR de gabinete)** | Convolutor de IR já presente no motor experimental | Código do motor e dependências a auditar; licença das IRs depende do autor | Aplicar `.wav` de gabinetes baixados do TONE3000 | **Formato e origem definidos**; auditar o convolutor, medir latência/qualidade e testar arquivos reais, sem procurar novo modelo de gabinete |

**Recomendação inicial de protótipos DSP:** CloudSeedCore para reverb, TapeDelay2 para delay tape, DaisySP Chorus para chorus clássico, ButterComp2 para compressor musical. O CHOW Matrix é destaque para uma segunda opção de delay e LSP/Dragonfly são bons alvos de comparação. Esta seleção ainda depende de teste de audição e profiling; “mais recomendado” não é uma medição objetiva.

### Referências comunitárias (não são benchmarking controlado)
- [r/linuxaudio — Linux plugins thread](https://www.reddit.com/r/linuxaudio/comments/wntpyd/linux_plugins_thread_2022/): recomenda Dragonfly e cita CHOW Matrix, delays do LSP e Airwindows.
- [r/linuxaudio — Native reverb/delay for ambient music](https://www.reddit.com/r/linuxaudio/comments/1l7xnp6/native_reverbdelay_vsts_for_ambient_music/): usos reportados de Dragonfly, TAL, LSP Slapback, Guitarix e outros.
- [r/linuxaudio — Favorite FOSS plugins](https://www.reddit.com/r/linuxaudio/comments/qxba6e/favorite_foss_plugins/): Airwindows entre as sugestões.
- [r/linuxaudio — How good are LSP plugins?](https://www.reddit.com/r/linuxaudio/comments/1ezvlv0/how_good_quality_are_the_linux_studio_project/): experiência positiva em cobertura técnica, mas UI criticada; VTTRIG pode ganhar muito com UX própria.

## 4. Design de som por pedal: requisitos mínimos

**VTTDELAY:** modos Digital, Tape, depois Multi-tap; parâmetros Time (ms), Sync/Division, Feedback, Mix, Tone (HP/LP), Mod (se disponível), Trails e tap tempo; feedback com teto seguro; sem cliques ao trocar time (interpolação/crossfade).

**VTTDELAY:** modo Classic mono com Time em ms, Feedback e Mix reais e atraso exato em amostras. O filtro e saturação da regeneração suavizam as repetições; sem alegar equivalência ao Airwindows TapeDelay2. Modos Tape fiel, tap tempo sincronizado ao host, estéreo e A/B continuam pendentes.

**VTTREVERB:** modo Room mono com Size, Decay e Mix implementados via combs/allpasses em C++20; o RT60 é aproximado e deve ser aferido por resposta ao impulso. CloudSeed, Plate/Hall, Predelay, Tone, estéreo e preservação de caudas no bypass continuam pendentes. Medir CPU e estabilidade com interface física.

**VTTCHORUS:** modo Classic mono já adaptado do DaisySP com controles Rate, Depth, Mix, delay base fixo ~6 ms e feedback fixo 20%; modo Stereo, Width e controles avançados permanecem pendentes até o motor ter áudio multicanal. Medir CPU, transientes, estabilidade e comparar timbre com DaisySP.

**VTTCOMP:** um modo Smooth guitarra e outro Transparent/Punch após escuta; controles devem corresponder à implementação real, com gain reduction meter genuíno quando DSP existir; entrada, limiar, attack/release, makeup, ratio/knee somente se suportados.

**VTTSUSTAIN:** implementação baseada em Airwindows Pressure5 com envelope mu A/B, controles Sustain, Speed (não Attack em ms), Level e Dry/Wet. Em 48 kHz dispensa os filtros ultrassônicos do original; sem ClipOnly2, usa teto de pico suave sem atraso. Testar nível de ruído amplificado, transientes, release percebido e A/B com o original; o som ainda não está homologado em guitarra real.

**Gate** acompanha ruído da cadeia e deve ter histerese/release musical; **Cab IR** aceita WAV, conversão de sample rate fora do callback, processamento particionado quando necessário; **NAM** com input trim e calibração real por modelo.

## 5. Arquitetura e contrato de integração

```text
Tauri 2 / React (apenas UI)
  ├─ Amp Focus: skin VTTRIG por nome de .nam + override
  ├─ stompboxes VTT: LED/footswitch/bypass, drag/drop, inspector
  └─ presets, browser NAM/IR, MIDI, configurações
            ↓ comandos não RT, por fila
Rust app controller / services
  ├─ indexação de modelos A2/IR e configuração assíncrona
  ├─ presets versionados / persistência
  └─ snapshot de telemetria para UI (nunca ler processo de áudio diretamente)
            ↓ estados imutáveis / troca segura
C++/Rust Native Audio Engine (sem WebView)
  ├─ Audio backend: PipeWire/JACK, conforme disponibilidade no Fedora
  ├─ Input calibration → gate/comp/sustain → NAM drive → NAM amp
  ├─ cab IR → chorus → delay → reverb → output/limiter/meter
  ├─ adapters: NAM core / CloudSeed / Airwindows / DaisySP
  └─ porta separada no futuro: CLAP/VST3 para REAPER
```

A ordem acima é **preset padrão**, não um bloqueio: o usuário pode reordenar a cadeia. Preservar canais mono/stereo de forma explícita, compensação de latência por módulo e parâmetros suavizados. Instanciar/modelos/IR e alocar delays no worker; o callback só processa buffers prealocados. Não misturar DSP de plugins com GUI de terceiros nem executar Tauri em callback de áudio.

## 6. Validação antes de chamar qualquer pedal de “pronto”

1. **Licenciamento:** arquivo por arquivo, dependências transitivas, `THIRD_PARTY_NOTICES.md`, license scanning; decidir licença final do produto de forma explícita.
2. **DSP offline:** impulses, step response, sweep, noise floor, clipping, impulse decay, stereo tests, sample-rate changes, disabled/bypass null tests.
3. **A/B ouvido:** fonte dry regravada via loopback; comparar VTTRIG a cada plugin original com RMS/LUFS equiparados, presets equivalentes, escuta cega para clean, crunch, high gain e ambient.
4. **Realtime:** teste em Fedora + interface USB, 48 kHz e buffers 64/128/256, medir xruns, CPU, latência de ida e volta, memória estável em 10+ min, sem travar UI.
5. **Presets:** snapshots reproduzíveis, defaults, migrações, paths quebrados tratados; não salvar segredos da API em JSON.
6. **UI:** LED só significa bypass local até engine conectada; knobs da skin de amp não prometem controle de gain/bass/mid capturados. Simulações devem permanecer marcadas como protótipo.

## 7. Sequência recomendada de implementação

- **Etapa A:** finalizar revisão UI e testes do PR #1 (não confundir preview visual com motor).
- **Etapa B:** criar `engine-core` standalone sem efeitos, IO real PipeWire/JACK, medição de latência e contrato thread-safe.
- **Etapa C:** execução de **NAM A2 `.nam` (VTTAMP/VTTDRIVE)** e **Cabinet IR `.wav` (VTTCAB)** obtidos no **TONE3000** e importados localmente; validar arquivos reais, compatibilidade, testes offline e benchmark.
- **Etapa D:** um por um: DaisySP Chorus, TapeDelay2, CloudSeedCore, compressor ButterComp2; preservar licenses e provar equivalência A/B com a implementação original.
- **Etapa E:** variantes avançadas (CHOW Matrix, Pressure5, modelos de reverb) e sustain com dinâmica musical.
- **Etapa F:** integração OAuth Tone3000 e CLAP/VST3 compartilhando motor de áudio.

**Decisão:** somente declarar algoritmo adotado no produto após implementação, teste auditivo, profiling e auditoria de licença. Estas são fontes de referência/candidatos, não DSP já instalado.
