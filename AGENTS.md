# VTTRIG — diretrizes obrigatórias de desenvolvimento

Inspirado no processo de qualidade do **TaxUtil**, adaptado à natureza do VTTRIG:
Tauri 2 + React/TypeScript, controlador Rust e processamento nativo de
áudio C++/Rust. Consulte também [docs/TESTING.md](docs/TESTING.md) e
[docs/DSP_RESEARCH_AND_ARCHITECTURE.md](docs/DSP_RESEARCH_AND_ARCHITECTURE.md).

## 1. Código claro, mínimo e modular

- Preserve comportamento não relacionado, evite refatorações oportunistas.
- Prefira a menor solução correta, legível e testável, sem padrões de projeto
  ou camadas extras que não solucionem um problema demonstrado.
- **Package by Feature:** UI de pedais, amplificadores, biblioteca, presets e
  motor de áudio devem ter fronteiras próprias. Componentes compartilhados
  somente quando houver reuso real.
- Tipos explícitos em TypeScript/Rust; C++ com propriedade e ciclo de vida claros.
- Nomes de código em inglês; interface e documentação podem ser em português.
- Não esconda erros, não faça catching silencioso, não altere APIs/contratos
  públicos sem versionar/validar compatibilidade.
- Analise só os arquivos e testes relacionados; não reescreva o projeto inteiro.
- Evite trocar dependências por versões mais novas sem requisito ou motivo.
- Credite o DSP de terceiros, preserve licenças e teste compatibilidade legal.

## 2. Regra inegociável: nenhuma correção sem regressão

Para **cada bug corrigido** (UI, importação de NAM/IR, DSP, presets, conexões,
desempenho), aplique:

1. Reproduzir o defeito com passos ou fixture mínima.
2. Criar teste automatizado que **falhe no código anterior** e demonstre o problema.
3. Implementar correção restrita à causa-raiz, sem ajustar o teste para mascarar o bug.
4. Executar o novo teste (agora passando) + testes existentes da feature.
5. Executar integrações afetadas e o **quality gate**.
6. No PR: explicar causa, cenário original, proteção contra regressão,
   comandos rodados e resultados reais; caso manual, especificar limites.

Não remova testes, não enfraqueça asserts nem altere expectativas para obter CI verde.
Se um teste automatizado não for viável, documente por quê e apresente um plano
de verificação reproduzível antes de considerar concluído.

## 3. Preservação cumulativa dos contratos

O princípio do TaxUtil de *não corrigir um caso quebrando outros* é central:

- **Ordem livre:** a cadeia de áudio processa na exata ordem dos módulos
  mostrados na UI. Nunca reorganize por categoria (drive antes de amp,
  cab antes de delay, etc.) automaticamente.
- A mesma categoria pode aparecer inúmeras vezes, com **IDs únicos**;
  preserve parâmetros, bypass e paths associados a cada instância.
- Reordenar um efeito altera o fluxo DSP real, não só a imagem.
- Alterar um preset deve preservar presets anteriores, seus parâmetros e
  seus módulos mesmo que o formato evolua (migrar por versão).
- Ao suportar um novo tipo de NAM, IR ou sample rate, mantenha os casos
  antigos e adicione fixtures para ambos.
- Ao adaptar efeito open-source, mantenha contrato de unidades, latência,
  estéreo/mono, estabilidade e presets; mudanças intencionais devem ser
  claramente descritas e testadas.
- Não presuma que a ordem de um pedalboard é universal. A ordem de fábrica
  é apenas preset inicial opcional, **nunca regra rígida do motor**.

## 4. Audio thread é sagrada

- Thread/callback realtime **não faz** I/O, carregamento de arquivos,
  log, alocação em heap, locks, espera, operações de rede nem atualização da UI.
- Pré-alocar buffers; instanciar e preparar NAM/IR/algoritmos fora da callback.
- Atualizações na UI devem gerar snapshots de grafo imutáveis; transição
  entre snapshots somente com mecanismo real-time-safe e limites claros.
- Pedais, bypass e ordem devem ter IDs estáveis e contratos serializados
  verificáveis; não modificar `std::vector` usada pelo callback durante execução.
- Evitar cliques audíveis com suavização/crossfade onde houver troca de
  parâmetros ou de topologia.
- Distinguir medição comprovada de latência e CPU de estimativas.
- Não alegar suporte a NAM A2, IR, JACK, CLAP ou VST antes de testar a
  implementação concreta. A UI atualmente é preview; runtime separado é
  experimental.

## 5. Qualidade antes de merge (Definition of Done)

- [ ] Mudança focada; contratos existentes preservados.
- [ ] Teste de regressão presente para bug ou teste de comportamento para feature.
- [ ] Testes direcionados + matriz de regressão relevante passando.
- [ ] `make check` passando no ambiente com as dependências instaladas.
- [ ] CI exigida em verde; revisar artefatos/screenshot em mudanças visuais.
- [ ] Mudanças em áudio validadas com testes offline; hardware Fedora/USB,
      xruns e latência reportados separadamente quando aplicável.
- [ ] Regressões de arquivo/preset sempre com fixtures sintéticas e pequenas;
      não incorporar capturas comerciais/restritas ao repositório.
- [ ] Licenças de terceiros auditadas, com notices preservados.
- [ ] README e docs atualizados quando comportamento, contrato ou arquitetura muda.
- [ ] PR documenta arquivos alterados, testes, resultado real e limitações.

## 6. Git, revisão e transparência

- Não implementar diretamente em `main`. Use branch apropriada; não crie
  outra branch quando a atual já trata do trabalho.
- Issues definem o escopo; não ampliar por conveniência.
- Inspecionar diffs antes de finalizar. Revisar erros, complexidade, segurança,
  desempenho e possíveis regressões sem presunção de correção.
- Não declarar sucesso com base apenas em código escrito. Cite o workflow,
  comando, teste ou limitação correspondente.
- Nunca inserir segredos TONE3000/API, arquivos de usuários ou material
  protegido de terceiros no código.
- Preferir um teste reproduzível a uma justificativa verbal de funcionamento.

## 7. Antes de desenvolver

1. Ler a Issue/solicitação e documentação pertinente.
2. Localizar feature e testes afetados.
3. Identificar comportamento atual e invariantes.
4. Fazer plano curto para mudanças não triviais.
5. Implementar e validar; revisar o diff.
6. Reportar de forma compacta mudanças, resultados de CI, limites e próximos passos.

**Comando canônico de validação:** `make check`.
A descrição de cada suíte e do requisito de regressão está em
[docs/TESTING.md](docs/TESTING.md).
