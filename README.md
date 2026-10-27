# Interclasse Sinerge · Vôlei de praia

Aplicação web simples para organizar partidas de vôlei 4×4 do interclasse: cadastro de titulares e reservas, placar ao vivo, sets, rotação, revezamentos, estatísticas individuais, resultados e classificação.

## Como abrir

Não é necessário instalar dependências. Na pasta do projeto, inicie um servidor local com `python3 -m http.server 8000` e abra `http://localhost:8000` em um navegador moderno. Partidas e resultados ficam salvos no armazenamento local desse navegador e dispositivo. Ou, clique com o botão direito em cima do index.html e clique em abrir com live server.

## Regras e recursos

- Partidas em melhor de 3 ou melhor de 5 sets.
- Sets anteriores ao decisivo até 21 pontos; set decisivo até 15; sempre com dois pontos de vantagem.
- Quatro titulares por equipe nas posições 1 a 4, reservas opcionais e revezamento por posição durante a partida.
- Rotação simplificada dos quatro jogadores quando a equipe recupera o saque; a posição 1 é a sacadora.
- Pontos atribuídos aos atletas em quadra, registro individual de erros, boas contribuições e substituições, além da opção de desfazer a última ação.
- Salvamento e exclusão de placares, histórico de resultados e pódio calculado por vitórias, saldo de sets e saldo de pontos.

## Relação com a API do projeto-base

Esta interface é independente e persiste os dados no navegador. Ela segue a ideia do projeto-base de manter nome das equipes, etapa/set e pontos; não envia dados ao Supabase nem à API Flask. No projeto-base, as rotas ainda respondem HTTP 501 e precisam ser implementadas antes de receber partidas.

O placar 4×4 e a rotação mostrada são configuráveis para a atividade escolar; confirme com a organização do interclasse eventuais regras locais sobre limite ou retorno de reservas.
