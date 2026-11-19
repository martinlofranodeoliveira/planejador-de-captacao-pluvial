# Planejador de captação pluvial

Compare chuva, consumo e volume armazenado em uma cisterna fictícia de escola ou horta comunitária. A série diária e o relatório usam milímetros, metros quadrados e litros inteiros.

## Experimente no navegador

Execute `python3 -m http.server 8000 --bind 127.0.0.1` na pasta do projeto e abra [a aplicação local](http://127.0.0.1:8000/). A página carrega a horta da escola, com seis dias fictícios. O terceiro dia ilustra extravasamento e o sexto, demanda parcialmente atendida.

Escolha **Editar cenário** para ajustar a cisterna ou os dias. **Simular cenário** calcula o balanço e **Exportar relatório** salva o cenário e os resultados em JSON. **Restaurar exemplo** reabre os seis dias originais. Os dados permanecem na sessão do navegador.

## Estado desta edição

A interface inclui um relatório de exemplo conferido. O gerador Vertex implementa `src/engine.js` a partir do contrato. Nas cópias de preparação em que o motor está pendente, a página identifica o exemplo como demonstração, permite editar cenários e informa a pendência ao recalcular. A suíte de aceitação distingue a demonstração de uma implementação que calcula resultados para novas entradas.

## Motor e ferramentas

O [contrato](CONTRACT.json) define o formato JSON e os limites inclusivos. Cada dia recebe a captação arredondada para baixo. O excesso sai da cisterna antes de a demanda consumir a água disponível. A sobra passa para o dia seguinte.

Com o motor implementado, rode `node scripts/calcular.mjs examples/cenario.json` para obter o resultado na saída padrão. A chamada pública do módulo ES é `simulate(document)`. Os dois [arquivos de exemplo](examples/) documentam a entrada e a saída.

Rode `npm run build` com Node.js 22 para copiar a aplicação estática para `dist/`. Os testes executam com `npm test` no Linux com Node.js 22 em `/usr/bin/node`, Python 3, Bubblewrap, util-linux e namespaces de usuário disponíveis. GitHub Actions executa os testes e o build. As verificações de cálculo falham em cópias que ainda contêm o motor de preparação.

O exercício serve à educação ambiental com séries inventadas. Projeto hidráulico, qualidade da água e dados meteorológicos exigem outras ferramentas.

## Licença

[MIT](LICENSE). Veja as [atribuições](THIRD_PARTY_NOTICES.md) dos componentes de desenvolvimento.
