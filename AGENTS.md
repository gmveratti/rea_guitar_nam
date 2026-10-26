# VTTRIG — Diretrizes de Desenvolvimento e Arquitetura

Política obrigatória de desenvolvimento, revisões e testes. Esta versão
incorpora **as 40 diretrizes gerais do TaxUtil**, incluindo o texto fornecido,
com exemplos e aplicabilidade adaptados à nossa aplicação de guitarra.
Seções condicionais não introduzem novas tecnologias no projeto.

## Contexto e contratos não negociáveis

- **Stack:** Tauri 2, React/TypeScript/Vite em `src/`; Rust em `src-tauri/`;
  C++ e JACK/PipeWire no motor experimental `engine/`.
- **Cadeia definida pelo usuário:** respeitar exatamente a ordem visual;
  sem impor amp antes de gabinete nem priorizar categoria. Efeitos do mesmo
  tipo podem aparecer várias vezes com IDs e bypass independentes.
- **Presets:** preservar IDs, parâmetros, ordem e compatibilidade histórica.
  Qualquer mudança de formato requer migração e testes de regressão.
- **Audio realtime:** preparar grafos, modelos, IRs e buffers fora do callback;
  no callback não usar I/O, alocações, locks, logs ou WebView.
- **Código aberto:** licenciamento e atribuição ao reutilizar NAM,
  CloudSeedCore, Airwindows, DaisySP e outros motores; validar DSP com
  testes offline, A/B e profiling, não apenas visualmente.
- **Limite atual:** o Tauri possui integração experimental de NAM/IR ao vivo;
  o host JACK separado e os demais pedais seguem não integrados. A pedalboard
  envia o manifesto ordenado somente ao iniciar/reiniciar uma sessão (PR #15).
  Nunca relatar latência, estabilidade ou compatibilidade física como testados
  quando houver apenas testes e builds de CI, sem interface de áudio real.
- **Quality gate:** `make check`, além das verificações de interface e de
  hardware aplicáveis. Ver [docs/TESTING.md](docs/TESTING.md) e
  [docs/DSP_RESEARCH_AND_ARCHITECTURE.md](docs/DSP_RESEARCH_AND_ARCHITECTURE.md).
- **Bugs:** reproduzir → teste vermelho → correção mínima → teste verde →
  regressões relacionadas → registrar evidência no PR.

---

# 1. Princípios Gerais

Ao analisar, implementar, refatorar ou revisar código:

* Priorize simplicidade e clareza.
* Preserve o comportamento existente que não fizer parte da tarefa.
* Faça a menor alteração coerente capaz de atender ao requisito.
* Evite abstrações prematuras.
* Evite complexidade sem benefício concreto.
* Não refatore código não relacionado à tarefa atual.
* Não altere APIs públicas sem necessidade.
* Não atualize dependências incidentalmente.
* Não modifique testes apenas para fazer uma implementação incorreta passar.
* Antes de criar algo novo, procure padrões e abstrações já existentes no projeto.

Quando existir conflito entre uma solução tecnicamente elegante e uma solução mais simples que atende completamente ao requisito, prefira a solução mais simples.

---

# 2. Contexto do Projeto

Antes de implementar mudanças relevantes, identifique e consulte a documentação disponível.

Quando existirem, considere como fontes de contexto:

```text
README.md
docs/architecture.md
docs/domain.md
docs/testing.md
docs/adr/
```

Use a seguinte hierarquia de contexto:

```text
AGENTS.md
    ↓
documentação do projeto
    ↓
Issue atual
    ↓
arquivos relacionados
    ↓
testes existentes
```

Não carregue ou analise todo o repositório sem necessidade.

Procure primeiro os módulos, símbolos, testes e arquivos diretamente relacionados à tarefa.

---

# 3. Estrutura de Diretórios

Utilize preferencialmente **Package by Feature**.

O código deve ser organizado por funcionalidade ou domínio de negócio, e não exclusivamente por camada técnica.

## Evitar

```text
components/
  Pedalboard.tsx
  AmpHero.tsx
services/
  PedalboardService.ts
  AmpService.ts
```

## Preferir

```text
src/features/pedalboard/
  components/Pedalboard.tsx
  state/chain.ts
  tests/chain.test.ts
src/features/presets/
  components/PresetBrowser.tsx
  storage.ts
  tests/storage.test.ts
```

*Árvore ilustrativa, não é pedido para reorganizar a estrutura atual.*

Cada feature deve ser, sempre que possível, autocontida e expor somente aquilo que outros módulos realmente precisam utilizar.

Ao criar uma nova funcionalidade, informe onde os novos arquivos se encaixam na estrutura do projeto.

---

# 4. Modularidade

Priorize:

* alta coesão;
* baixo acoplamento;
* fronteiras claras entre módulos;
* dependências explícitas;
* interfaces públicas pequenas.

Um módulo não deve acessar diretamente detalhes internos de outro módulo.

Por exemplo, se `invoice` precisar de informações de `user`, utilize uma interface pública apropriada de `user` em vez de acessar diretamente seu armazenamento interno.

Evite dependências circulares.

Quando identificar uma violação arquitetural relevante, informe o problema e proponha uma correção.

Não faça essa refatoração automaticamente se estiver fora do escopo da tarefa atual.

---

# 5. Injeção de Dependências

Prefira receber dependências externamente em vez de instanciá-las profundamente dentro da lógica de negócio quando isso melhorar:

* testabilidade;
* desacoplamento;
* substituição de implementações;
* isolamento de integrações externas.

Entretanto, não introduza containers de dependência, factories complexas ou abstrações adicionais sem benefício concreto.

A injeção de dependências deve simplificar o sistema, não complicá-lo.

---

# 6. Orientação a Objetos e Clean Code

Utilize orientação a objetos quando ela representar adequadamente o problema.

Não transforme toda função em classe apenas por preferência arquitetural.

## SRP

Classes, métodos e funções devem possuir responsabilidades claras.

Se um componente possuir muitos motivos independentes para mudar, considere dividi-lo.

## OCP

Favoreça extensibilidade quando existirem razões reais para novas implementações ou comportamentos.

Não crie interfaces, hierarquias ou padrões de projeto antecipadamente apenas para cumprir teoricamente o princípio aberto/fechado.

## DIP

Nas fronteiras importantes do sistema, prefira depender de contratos ou abstrações estáveis em vez de detalhes concretos.

Em Python, utilize `Protocol`, abstrações ou injeção de dependências apenas quando trouxerem benefício real.

## Encapsulamento

Exponha apenas aquilo que outros componentes precisam utilizar.

Evite compartilhar estado interno mutável desnecessariamente.

---

# 7. Evitar Overengineering

Não introduza automaticamente:

* interfaces para classes com apenas uma implementação;
* factories desnecessárias;
* repositories sem necessidade arquitetural;
* services que apenas redirecionam chamadas;
* abstrações sem consumidores reais;
* padrões de projeto sem problema concreto para resolver;
* generalizações para cenários hipotéticos;
* frameworks adicionais para resolver problemas simples.

Antes de introduzir uma abstração, considere se ela realmente reduz:

* duplicação;
* acoplamento;
* complexidade;
* dificuldade de teste.

Caso contrário, prefira código direto.

---

# 8. Tamanho e Responsabilidade de Arquivos

Evite God Classes e arquivos excessivamente responsáveis por múltiplos domínios.

Arquivos entre aproximadamente 200 e 300 linhas não precisam necessariamente ser divididos.

O número de linhas sozinho não define má arquitetura.

Sugira divisão quando houver sinais como:

* múltiplas responsabilidades;
* alta complexidade;
* difícil testabilidade;
* muitos motivos diferentes para mudança;
* dependências excessivas;
* baixa coesão.

Não faça divisões artificiais apenas para reduzir número de linhas.

---

# 9. Nomenclatura

Use nomes em inglês no código.

Prefira nomes:

* claros;
* descritivos;
* consistentes;
* sem abreviações obscuras.

Exemplos:

```text
AudioGraphProcessor
NamModelLoader
process_audio_block()
move_effect()
load_preset()
```

Evite:

```text
Proc
Mgr
DataX
Tmp
Util2
doStuff()
```

Termos de domínio amplamente utilizados podem permanecer conforme a convenção existente do projeto.

---

# 10. Tipagem

Utilize tipagem forte sempre que a linguagem permitir.

No VTTRIG, use tipos explícitos em TypeScript, Rust e C++. Evite `any`, conversões implícitas entre buffers, ponteiros com propriedade ambígua ou contratos de plugin opacos.

Para scripts Python eventuais:

* utilize type hints;
* tipar parâmetros e retornos de funções públicas;
* evite `Any` sem necessidade;
* utilize tipos de domínio quando agregarem clareza;
* preserve compatibilidade com o type checker adotado pelo projeto.

Não adicione tipos extremamente complexos quando eles piorarem a legibilidade sem benefício concreto.

---

# 11. Tratamento de Erros

Erros não devem ser silenciosamente ignorados.

Evite:

```python
try:
    ...
except Exception:
    pass
```

Quando uma exceção for capturada:

* trate-a;
* transforme-a em erro de domínio;
* registre-a;
* ou propague-a conscientemente.

Mensagens de erro devem fornecer contexto útil sem expor informações sensíveis.

Não utilize exceções como fluxo normal de controle quando uma alternativa clara existir.

---

# 12. Valores Monetários

Esta seção permanece **condicional**: o VTTRIG não tem cálculos monetários atualmente. Se incorporar cobrança ou relatórios financeiros, siga as regras:

Em aplicações financeiras, contábeis, fiscais ou tributárias:

* nunca utilize `float` para cálculos monetários;
* utilize representação decimal exata;
* preserve regras de arredondamento existentes;
* não altere precisão ou arredondamento sem requisito explícito;
* alterações em fórmulas exigem testes.

Para Python, utilize preferencialmente:

```python
from decimal import Decimal
```

---

# 13. Python

Não introduza Python como requisito do motor de áudio. Esta seção só vale se o projeto tiver scripts auxiliares Python.

Para projetos Python, utilize **UV** como padrão de gerenciamento de ambiente e dependências.

Prefira:

```bash
uv sync
uv run pytest
uv run ruff check .
```

Dependências devem ser registradas em:

```text
pyproject.toml
uv.lock
```

Não utilize `pip install` diretamente quando o projeto estiver configurado com UV.

---

# 14. Dependências

Não atualize dependências existentes salvo quando:

* a Issue solicitar;
* existir incompatibilidade comprovada;
* houver correção necessária de segurança;
* a atualização for necessária para a implementação.

Ao adicionar uma nova dependência:

1. confirme que ela realmente é necessária;
2. considere implementar sem dependência adicional;
3. prefira uma versão estável compatível com o projeto;
4. atualize os arquivos de dependências e lock;
5. evite bibliotecas abandonadas ou desnecessariamente grandes.

Não atualize o restante das dependências apenas porque existe uma versão mais recente disponível.

---

# 15. Git

Nunca faça alterações diretamente em `main` ou `master` quando a tarefa envolver implementação.

Antes de modificar código:

1. verifique a branch atual;
2. identifique se já existe uma branch dedicada à tarefa;
3. se estiver em `main` ou `master`, informe que deve ser utilizada uma branch específica;
4. se houver número de Issue disponível, utilize-o no nome da branch.

Convenção:

```text
feature/<issue>-descricao-curta
fix/<issue>-descricao-curta
refactor/<issue>-descricao-curta
chore/<issue>-descricao-curta
```

Exemplo:

```text
fix/143-duplicate-efd-records
```

Não crie branches adicionais quando a tarefa já estiver sendo executada em uma branch apropriada.

Não faça commit ou push sem solicitação explícita ou sem isso fazer parte claramente do workflow solicitado.

---

# 16. Issues

Sempre que houver uma Issue associada à tarefa, trate-a como a principal especificação da mudança.

Antes da implementação, identifique:

* problema;
* comportamento atual;
* comportamento esperado;
* critérios de aceitação;
* itens fora de escopo;
* referências fornecidas.

Caso algum detalhe possa ser determinado diretamente pelo código, testes ou documentação, investigue antes de solicitar esclarecimentos.

Não expanda o escopo da Issue por iniciativa própria.

---

# 17. Fluxo Antes de Implementar

Para mudanças não triviais:

1. leia a Issue ou solicitação;
2. consulte `AGENTS.md`;
3. consulte apenas a documentação relevante;
4. localize a implementação atual;
5. localize os testes existentes;
6. entenda o fluxo afetado;
7. execute testes relacionados quando possível;
8. produza um plano curto;
9. implemente somente depois de compreender a mudança.

O plano deve indicar, quando relevante:

```text
Arquivos afetados
Estratégia
Testes necessários
Riscos
Itens fora de escopo
```

Evite planos longos para alterações triviais.

---

# 18. Bugs

Para correções de bugs, utilize preferencialmente:

```text
reproduzir
    ↓
criar regression test
    ↓
confirmar falha
    ↓
implementar correção
    ↓
confirmar sucesso
```

Workflow:

1. reproduza o comportamento sempre que possível;
2. identifique a causa raiz;
3. crie um teste que demonstre o bug;
4. confirme que o teste falha antes da correção;
5. implemente a menor correção adequada;
6. confirme que o novo teste passa;
7. execute testes relacionados.

Não corrija apenas o sintoma se a causa raiz puder ser identificada com segurança.

---

# 19. Novas Features

Para novas funcionalidades:

1. identifique onde a feature pertence;
2. procure padrões existentes semelhantes;
3. preserve Package by Feature;
4. defina responsabilidades claras;
5. implemente primeiro o comportamento necessário;
6. adicione testes;
7. evite preparar arquitetura para funcionalidades hipotéticas futuras.

Ao criar novos arquivos, informe sua posição na estrutura.

Exemplo de organização por feature, sem exigir refatoração da estrutura atual:

```text
src/features/pedalboard/
  Pedalboard.tsx
  chain.ts
  chain.test.ts
```

---

# 20. Testes

Testes são parte obrigatória da implementação quando houver comportamento verificável.

Priorize:

* testes de regressão para bugs;
* testes unitários para regras isoladas;
* testes de integração para fronteiras relevantes;
* testes existentes antes de criar padrões novos.

Antes de escrever novos testes, observe como o projeto atualmente estrutura testes semelhantes.

Não:

* remova testes para fazer uma mudança passar;
* enfraqueça asserts sem justificativa;
* altere comportamento esperado apenas porque a implementação nova diverge;
* faça mocks de tudo indiscriminadamente.

Teste comportamento e contratos importantes, não detalhes irrelevantes da implementação.

---

# 21. Testes como Contrato

Nunca conclua que uma mudança está correta somente porque o código parece correto.

Sempre que possível, forneça evidência executável.

A ordem recomendada é:

```text
testes direcionados
    ↓
testes da feature
    ↓
testes de integração afetados
    ↓
suite completa quando apropriado
```

---

# 22. Quality Gate

Antes de declarar uma implementação concluída, execute os comandos de validação definidos pelo projeto.

Quando existir um comando canônico como:

```bash
make check
```

utilize-o.

Caso não exista, execute separadamente:

```text
testes
lint
typecheck
```

Uma implementação não deve ser considerada concluída se houver falhas conhecidas relacionadas à alteração.

---

# 23. Evidência de Conclusão

Não responda apenas:

```text
Implementação concluída.
```

Ao finalizar uma tarefa, informe objetivamente:

```text
Arquivos alterados
Testes adicionados/alterados
Comandos executados
Resultado dos testes
Resultado do lint
Resultado do typecheck
Validação manual, se houver
Limitações conhecidas
```

Exemplo:

```text
Validation:

✓ npm test — relatar quantidade real de testes
✓ ctest --test-dir engine/build --output-on-failure — somente se executado
✓ npx tsc --noEmit — somente se executado

Manual verification:
✓ <descrever apenas ensaio Fedora realmente feito>
Pendente: <limitações e testes de áudio ainda não executados>
```

Nunca afirme que executou uma validação que não foi realmente executada.

---

# 24. Disciplina de Escopo

Faça a menor alteração coerente necessária para atender à tarefa.

Não faça incidentalmente:

* refatorações não relacionadas;
* mudanças de nomenclatura gerais;
* reorganização de diretórios;
* alterações de estilo em arquivos não relacionados;
* atualizações de dependências;
* mudanças de schema;
* alterações de API;
* otimizações prematuras.

Se identificar outro problema relevante fora do escopo:

1. não o corrija automaticamente;
2. informe separadamente;
3. sugira uma nova Issue quando apropriado.

---

# 25. Banco de Dados e Persistência

Aplica-se também a formatos de presets locais, arquivos JSON e futuras migrações SQLite.

Não altere schema, migrations ou estrutura persistente sem necessidade explícita.

Mudanças de banco devem considerar:

* compatibilidade;
* dados existentes;
* rollback;
* migrations;
* integridade;
* índices;
* impacto de performance.

Nunca apague ou transforme dados persistentemente sem deixar claro o impacto.

---

# 26. Segurança

Tenha atenção especial ao código que manipula:

* autenticação;
* autorização;
* arquivos externos;
* XML;
* JSON externo;
* uploads;
* SQL;
* comandos de shell;
* credenciais;
* tokens;
* certificados;
* dados pessoais;
* APIs externas.

Nunca:

* grave secrets no código;
* faça commit de credenciais;
* confie diretamente em input externo;
* monte SQL inseguro;
* execute comandos externos a partir de input não sanitizado.

---

# 27. Performance

Não faça otimizações prematuras.

Quando houver problema de performance:

1. identifique o gargalo;
2. obtenha evidência;
3. otimize o ponto relevante;
4. preserve correção;
5. adicione benchmark ou teste quando apropriado.

Não sacrifique legibilidade por micro-otimizações sem impacto mensurável.

---

# 28. Documentação

## Manutenção do Contexto do Projeto

A documentação em `docs/` representa o contexto persistente do projeto e deve acompanhar a evolução do código.

Antes de concluir uma alteração, verifique se ela tornou alguma documentação existente incorreta, incompleta ou desatualizada.

Atualize a documentação quando necessário.

## Arquitetura

Atualize `docs/DSP_RESEARCH_AND_ARCHITECTURE.md` (existente), ou uma arquitetura específica de feature, quando houver alteração relevante em:

- estrutura de módulos ou features;
- responsabilidades entre componentes;
- fluxo de dados;
- integrações externas;
- persistência ou banco de dados;
- entrypoints;
- dependências arquiteturais;
- comunicação entre módulos.

Não atualize o arquivo para mudanças internas triviais que não alterem a compreensão da arquitetura.

## Domínio

Atualize a documentação de domínio da feature (`docs/domain.md` se esse arquivo vier a existir) quando houver:

- nova regra de negócio;
- alteração em regra existente;
- novo conceito de domínio;
- novo cálculo;
- novo comportamento de áudio, presets, DSP ou operação;
- novo edge case relevante;
- alteração em invariantes do sistema.

Nunca invente regras de domínio.

Se uma regra não estiver clara no código, Issue ou documentação existente, sinalize a dúvida em vez de documentar uma suposição como fato.

## Testes

Atualize `docs/TESTING.md` quando houver alteração em:

- estratégia de testes;
- organização dos testes;
- fixtures;
- ferramentas;
- comandos;
- tipos de testes utilizados;
- convenções de regression tests.

## AGENTS.md

Atualize `AGENTS.md` somente quando houver mudança nas instruções permanentes de desenvolvimento ou na forma como agentes devem trabalhar no projeto.

Não coloque detalhes de implementação ou regras extensas de domínio no `AGENTS.md`.

Prefira apontar para documentos específicos em `docs/`.

## Contexto como parte da Definition of Done

Antes de considerar uma tarefa concluída, verifique:

1. O código mudou alguma regra de domínio?
2. O fluxo ou arquitetura mudou?
3. Algum comando de desenvolvimento mudou?
4. Alguma documentação agora descreve comportamento antigo?
5. Um próximo agente conseguiria entender corretamente o sistema usando a documentação atual?

Se a resposta indicar documentação desatualizada, atualize-a como parte da mesma alteração.

---

# 29. ADRs

Decisões arquiteturais relevantes podem ser registradas em:

```text
docs/adr/
```

Crie um ADR quando houver decisão com impacto duradouro, como:

* troca de banco;
* nova estratégia de persistência;
* mudança arquitetural;
* adoção de framework central;
* mudança importante de integração;
* decisão difícil de reverter.

Não crie ADR para decisões triviais.

---

# 30. Revisão de Código

Ao revisar código, não modifique automaticamente os arquivos salvo quando solicitado.

Analise:

* correção;
* critérios de aceitação;
* possíveis regressões;
* arquitetura;
* complexidade;
* duplicação;
* tratamento de erros;
* testes;
* segurança;
* performance quando relevante;
* alterações fora de escopo.

Classifique findings quando apropriado como:

```text
BLOCKER
HIGH
MEDIUM
LOW
```

Priorize problemas acionáveis.

Evite elogios genéricos ou comentários sem consequência prática.

---

# 31. Revisão Independente

Quando possível, o agente que revisa uma alteração deve analisar:

```text
Issue
+
git diff
+
testes
+
regras do projeto
```

Não assuma que uma implementação está correta apenas porque outro agente a produziu.

A revisão deve tentar encontrar falhas, não justificar a solução existente.

---

# 32. Uso Eficiente de Contexto

Evite consumir contexto desnecessariamente.

Prefira:

```text
buscar símbolo
→ abrir arquivo relevante
→ localizar testes
→ consultar documentação específica
```

em vez de:

```text
ler todo o repositório
```

Use documentação por referência.

Não copie grandes trechos de documentação para o contexto se puder consultar diretamente o arquivo quando necessário.

---

# 33. Uso de Agentes

Delegue para subagentes quando a tarefa for:

* autocontida;
* facilmente paralelizável;
* predominantemente exploratória;
* revisão independente;
* execução ou análise de testes;
* investigação que geraria muito contexto temporário.

Evite delegação quando implementação, planejamento e testes dependerem fortemente do mesmo contexto e a transferência de estado aumentar a complexidade.

Não crie múltiplos agentes para tarefas triviais.

---

# 34. Exploração

Um agente de exploração deve preferencialmente:

* operar em modo somente leitura;
* localizar arquivos;
* localizar símbolos;
* localizar testes;
* mapear dependências;
* explicar fluxos;
* identificar possíveis pontos de alteração.

O Explorer não deve modificar código.

Sua resposta deve ser curta e fornecer referências úteis para o agente implementador.

---

# 35. Implementação

O implementador deve:

1. compreender a Issue;
2. considerar o resultado da exploração;
3. respeitar o escopo;
4. seguir padrões existentes;
5. implementar;
6. testar;
7. revisar o próprio diff;
8. fornecer evidência.

Não considere a tarefa concluída antes da validação.

---

# 36. Comunicação

Seja objetivo.

Evite respostas longas quando uma resposta curta for suficiente.

Ao relatar trabalho realizado, priorize:

```text
O que mudou
Por que mudou
Como foi validado
Riscos ou limitações
```

Não explique conceitos básicos desnecessariamente quando o contexto indicar familiaridade técnica.

---

# 37. Perguntas e Autonomia

Não interrompa a implementação com perguntas quando a resposta puder ser obtida com segurança através de:

* código existente;
* testes;
* documentação;
* Issue;
* histórico do repositório.

Pergunte apenas quando houver ambiguidade real que possa resultar em comportamentos significativamente diferentes.

Quando uma suposição segura puder ser feita, declare-a brevemente e prossiga.

---

# 38. Definição de Pronto

Uma tarefa só pode ser considerada concluída quando, quando aplicável:

* [ ] atende aos critérios de aceitação;
* [ ] respeita a arquitetura;
* [ ] não possui mudanças conhecidas fora do escopo;
* [ ] possui testes adequados;
* [ ] regression tests foram adicionados para bugs;
* [ ] testes relacionados passaram;
* [ ] lint passou;
* [ ] typecheck passou;
* [ ] diff foi revisado;
* [ ] documentação foi atualizada quando necessário;
* [ ] validação executada foi reportada;
* [ ] limitações conhecidas foram reportadas.

---

# 39. Regra Principal

Sempre prefira:

```text
entender
→ alterar pouco
→ testar
→ revisar
→ provar
```

em vez de:

```text
assumir
→ alterar muito
→ declarar concluído
```

Código produzido por IA deve obedecer aos mesmos critérios de qualidade exigidos de código produzido manualmente.

---

# 40. Classificação para Desenvolvimento Assistido

Antes de implementar uma Issue, classifique complexidade e risco de modo independente.
Os arquivos `docs/ai-development.md` e `.codex/issue-routing.toml` são opcionais enquanto não existirem e forem adotados formalmente. Quando presentes, siga suas configurações.

Caso perfis `fast`, `dev`, `hard` e `review` estejam configurados, selecione por complexidade e exija revisão independente para alto risco, segurança, dados e áudio realtime. Bugs exigem regressão quando reproduzíveis automaticamente.

Use `gh issue view <numero> --json number,title,body,labels,url` para obter contexto estruturado. Nunca altere labels, autenticação, Issues ou Pull Requests remotamente sem autorização.
