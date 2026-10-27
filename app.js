const STORAGE_KEY = "sinerge-beach-volleyball-v1";
const state = loadState();
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
let noticeTimeout;

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    const current = saved.current && typeof saved.current === "object" ? saved.current : null;
    const migrated = migrateCurrentMatch(current);
    return {
      current: migrated.match,
      matches: Array.isArray(saved.matches) ? saved.matches : [],
      loadNotice: migrated.changed ? "A partida antiga foi mantida e completada com posições pendentes. Revise os nomes antes de continuar." : ""
    };
  } catch (error) {
    console.error("Não foi possível carregar os placares salvos.", error);
    return {
      current: null,
      matches: [],
      loadError: "Os dados salvos não puderam ser lidos. Foi aberta uma sessão vazia."
    };
  }
}

function migrateCurrentMatch(match) {
  if (!match?.players || !match?.stats) return { match, changed: false };
  let changed = false;
  for (const side of ["A", "B"]) {
    while (match.players[side].length < 4) {
      const next = match.players[side].length + 1;
      match.players[side].push(`Atleta ${next} (não cadastrado)`);
      match.stats[side].push({ points: 0, errors: 0, contributions: 0, substitutionsIn: 0, substitutionsOut: 0 });
      changed = true;
    }
    match.stats[side] = match.players[side].map((_, index) => ({
      points: match.stats[side][index]?.points || 0,
      errors: match.stats[side][index]?.errors || 0,
      contributions: match.stats[side][index]?.contributions || 0,
      substitutionsIn: match.stats[side][index]?.substitutionsIn || 0,
      substitutionsOut: match.stats[side][index]?.substitutionsOut || 0
    }));
  }
  if (!match.active) {
    match.active = {};
    for (const side of ["A", "B"]) {
      const serverIndex = side === "A" ? match.serverIndex?.A : match.serverIndex?.B;
      const firstServer = Number.isInteger(serverIndex) ? serverIndex : 0;
      match.active[side] = [firstServer, ...[0, 1, 2, 3].filter(index => index !== firstServer)];
    }
    changed = true;
  }
  match.substitutions ||= [];
  if (changed) match.history = [];
  return { match, changed };
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (error) {
    console.error("Não foi possível salvar os placares neste dispositivo.", error);
    showNotice("Não foi possível salvar. Verifique o espaço disponível no navegador.", true);
    return false;
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function showNotice(message, isError = false) {
  const notice = $("#notice");
  notice.textContent = message;
  notice.classList.toggle("error", isError);
  notice.hidden = false;
  window.clearTimeout(noticeTimeout);
  noticeTimeout = window.setTimeout(() => { notice.hidden = true; }, 4500);
}

function teamKey(side) {
  return side === "A" ? "teamA" : "teamB";
}

function teamName(match, side) {
  return match[teamKey(side)];
}

function playerName(match, side, index) {
  return match.players[side][index];
}

function playerStats(match, side, index) {
  return match.stats[side][index];
}

function playerSideRoster(formData, side) {
  const players = Array.from({ length: 4 }, (_, index) =>
    String(formData.get(`player${side}${index + 1}`) || "").trim()
  );
  const reserves = $$(`[data-reserve-player="${side}"]`).map(input => input.value.trim()).filter(Boolean);
  return [...players, ...reserves];
}

function addReserveField(side) {
  const container = $(`#reserve-inputs-${side}`);
  const count = container.querySelectorAll("[data-reserve-player]").length + 1;
  const field = document.createElement("div");
  field.className = "reserve-input-row";
  field.innerHTML = `
    <label>Reserva ${count}<input data-reserve-player="${side}" maxlength="32" placeholder="Nome do(a) reserva"></label>
    <button class="remove-reserve" type="button" aria-label="Remover reserva ${count}">×</button>`;
  container.append(field);
}

function activeSet(match) {
  return match.sets[match.sets.length - 1];
}

function winningSets(match, side) {
  return match.sets.filter(set => set.winner === side).length;
}

function requiredSets(match) {
  return Math.floor(match.bestOf / 2) + 1;
}

function targetForSet(match, setIndex = match.sets.length - 1) {
  const isDeciding = setIndex >= match.bestOf - 1;
  return isDeciding ? 15 : 21;
}

function isSetFinished(set) {
  return Math.max(set.A, set.B) >= (set.target || 21) && Math.abs(set.A - set.B) >= 2;
}

function startMatch(form) {
  const data = new FormData(form);
  const teamA = String(data.get("teamA") || "").trim();
  const teamB = String(data.get("teamB") || "").trim();
  if (!teamA || !teamB || teamA.toLocaleLowerCase() === teamB.toLocaleLowerCase()) {
    showNotice("Informe nomes diferentes para as duas equipes.", true);
    return;
  }

  if (state.current && !state.current.finished) {
    if (!window.confirm("Há uma partida em andamento. Começar outra vai substituir o placar atual. Continuar?")) return;
  }

  const bestOf = Number(data.get("bestOf"));
  const firstServe = String(data.get("firstServe"));
  const players = { A: playerSideRoster(data, "A"), B: playerSideRoster(data, "B") };
  if (players.A.slice(0, 4).some(name => !name) || players.B.slice(0, 4).some(name => !name)) {
    showNotice("Informe os nomes dos quatro titulares de cada equipe.", true);
    return;
  }
  for (const side of ["A", "B"]) {
    const normalized = players[side].map(name => name.toLocaleLowerCase("pt-BR"));
    if (new Set(normalized).size !== normalized.length) {
      showNotice(`Os nomes dos titulares e reservas do Time ${side} precisam ser diferentes.`, true);
      return;
    }
  }
  state.current = {
    id: Date.now(),
    teamA,
    teamB,
    players,
    active: { A: [0, 1, 2, 3], B: [0, 1, 2, 3] },
    serve: firstServe,
    bestOf: bestOf === 5 ? 5 : 3,
    sets: [{ A: 0, B: 0, target: 21, winner: null }],
    stats: {
      A: players.A.map(() => ({ points: 0, errors: 0, contributions: 0, substitutionsIn: 0, substitutionsOut: 0 })),
      B: players.B.map(() => ({ points: 0, errors: 0, contributions: 0, substitutionsIn: 0, substitutionsOut: 0 }))
    },
    history: [],
    substitutions: [],
    finished: false,
    savedAt: null,
    createdAt: new Date().toISOString()
  };
  const stored = persist();
  render();
  if (stored) showNotice(`Partida iniciada: ${teamA} × ${teamB}. Bom jogo!`);
}

function addPoint(side) {
  const match = state.current;
  if (!match || match.finished) return;
  const selected = Number($(`#point-player-${side.toLowerCase()}`).value);
  const set = activeSet(match);
  const previousServe = match.serve;
  const rotationSide = previousServe !== side ? side : null;
  const positionsBefore = rotationSide ? [...match.active[rotationSide]] : null;
  set[side] += 1;
  playerStats(match, side, selected).points += 1;
  match.history.push({ kind: "point", side, player: selected, previousServe, rotationSide, positionsBefore });

  if (rotationSide) {
    match.active[side] = rotatePositions(match.active[side]);
    match.serve = side;
  }

  let completionMessage = "";
  if (isSetFinished(set)) {
    set.winner = set.A > set.B ? "A" : "B";
    if (winningSets(match, set.winner) >= requiredSets(match)) {
      match.finished = true;
      match.winner = set.winner;
      match.finishedAt = new Date().toISOString();
      completionMessage = `Partida encerrada! ${teamName(match, set.winner)} venceu.`;
    } else {
      match.sets.push({ A: 0, B: 0, target: targetForSet(match, match.sets.length), winner: null });
    }
  }
  const stored = persist();
  render();
  if (stored && completionMessage) showNotice(completionMessage);
}

function rotatePositions(positions) {
  return [positions[1], positions[2], positions[3], positions[0]];
}

function substitutePlayer(side) {
  const match = state.current;
  if (!match || match.finished) return;
  const position = Number($(`#sub-out-${side}`).value);
  const incoming = Number($(`#sub-in-${side}`).value);
  const outgoing = match.active[side][position];
  if (!Number.isInteger(position) || position < 0 || position > 3 || !Number.isInteger(incoming) || match.active[side].includes(incoming)) {
    showNotice("Selecione um titular que sairá e uma reserva diferente para entrar.", true);
    return;
  }
  const positionsBefore = [...match.active[side]];
  match.history.push({ kind: "substitution", side, position, outgoing, incoming, positionsBefore });
  match.active[side][position] = incoming;
  playerStats(match, side, outgoing).substitutionsOut += 1;
  playerStats(match, side, incoming).substitutionsIn += 1;
  match.substitutions.push({
    side,
    outgoing,
    incoming,
    position: position + 1,
    at: new Date().toISOString()
  });
  const stored = persist();
  render();
  if (stored) showNotice(`${playerName(match, side, incoming)} entrou no lugar de ${playerName(match, side, outgoing)}.`);
}

function undoLastAction() {
  const match = state.current;
  if (!match || !match.history.length || match.finished) return;
  const action = match.history.pop();
  if (action.kind === "point") {
    let set = activeSet(match);
    if (set[action.side] === 0 && match.sets.length > 1) {
      match.sets.pop();
      set = activeSet(match);
    }
    if (set.winner) set.winner = null;
    set[action.side] = Math.max(0, set[action.side] - 1);
    playerStats(match, action.side, action.player).points = Math.max(0, playerStats(match, action.side, action.player).points - 1);
    match.serve = action.previousServe;
    if (action.rotationSide && action.positionsBefore) match.active[action.rotationSide] = action.positionsBefore;
  } else if (action.kind === "substitution") {
    match.active[action.side] = action.positionsBefore;
    playerStats(match, action.side, action.outgoing).substitutionsOut -= 1;
    playerStats(match, action.side, action.incoming).substitutionsIn -= 1;
    match.substitutions.pop();
  } else {
    const field = action.kind;
    playerStats(match, action.side, action.player)[field] = Math.max(0, playerStats(match, action.side, action.player)[field] - 1);
  }
  const stored = persist();
  render();
  if (stored) showNotice("Última ação desfeita.");
}

function matchSnapshot(match) {
  const winner = match.winner;
  const setsWon = match.sets.map(set => `${set.A}–${set.B}`).join(", ");
  let pointsA = 0;
  let pointsB = 0;
  for (const set of match.sets) {
    pointsA += set.A;
    pointsB += set.B;
  }
  return {
    id: match.id,
    teamA: match.teamA,
    teamB: match.teamB,
    players: { A: [...match.players.A], B: [...match.players.B] },
    substitutions: [...match.substitutions],
    stats: {
      A: match.stats.A.map(stats => ({ ...stats })),
      B: match.stats.B.map(stats => ({ ...stats }))
    },
    winner,
    sets: match.sets.map(({ A, B, target, winner: setWinner }) => ({ A, B, target, winner: setWinner })),
    setsWon,
    pointsA,
    pointsB,
    finishedAt: match.finishedAt || new Date().toISOString()
  };
}

function saveCurrentMatch() {
  const match = state.current;
  if (!match) return;
  const snapshot = matchSnapshot(match);
  const existing = state.matches.findIndex(item => item.id === snapshot.id);
  if (existing >= 0) state.matches[existing] = snapshot;
  else state.matches.unshift(snapshot);
  match.savedAt = new Date().toISOString();
  const stored = persist();
  render();
  if (stored) {
    showNotice(match.finished
      ? "Resultado salvo na lista de partidas e na classificação."
      : "Placar salvo. A partida continua em andamento.");
  }
  return stored;
}

function askConfirmation(title, copy, action) {
  const dialog = $("#confirm-dialog");
  $("#confirm-title").textContent = title;
  $("#confirm-copy").textContent = copy;
  const result = dialog.showModal ? dialog.showModal() : window.confirm(copy);
  if (result === false) return;
  if (!dialog.showModal) {
    if (result) action();
    return;
  }
  dialog.addEventListener("close", function onClose() {
    dialog.removeEventListener("close", onClose);
    if (dialog.returnValue === "confirm") action();
  });
}

function deleteCurrentMatch() {
  if (!state.current) return;
  askConfirmation("Apagar esta partida?", "O placar atual será removido deste dispositivo. Partidas já finalizadas e salvas não serão apagadas.", () => {
    state.current = null;
    const stored = persist();
    render();
    if (stored) showNotice("Partida apagada.");
  });
}

function deleteSavedMatch(id) {
  const found = state.matches.find(match => match.id === id);
  if (!found) return;
  askConfirmation("Apagar resultado salvo?", `O resultado de ${found.teamA} × ${found.teamB} será removido da lista e da classificação.`, () => {
    state.matches = state.matches.filter(match => match.id !== id);
    const stored = persist();
    render();
    if (stored) showNotice("Resultado removido.");
  });
}

function renderSetDots(match, side) {
  return Array.from({ length: requiredSets(match) }, (_, index) =>
    `<span class="set-dot${match.sets[index]?.winner === side ? " won" : ""}"></span>`
  ).join("");
}

function renderScoreboard() {
  const match = state.current;
  const setupCard = $("#setup-card");
  const matchCard = $("#match-card");
  $("#empty-state").hidden = Boolean(match);
  setupCard.hidden = Boolean(match);
  matchCard.hidden = !match;
  if (!match) {
    $("#match-status").textContent = "PREPARE A PARTIDA";
    $("#set-summary").innerHTML = "<p>Os resultados de cada set aparecem aqui.</p>";
    $("#player-highlights").innerHTML = "<p>As estatísticas individuais começam junto com a partida.</p>";
    renderHistory();
    return;
  }

  const set = activeSet(match);
  $("#match-status").textContent = match.finished ? "PARTIDA FINALIZADA" : "EM ANDAMENTO";
  $("#set-label").textContent = match.finished ? `FIM · ${match.sets.length} SET${match.sets.length === 1 ? "" : "S"}` : `SET ${match.sets.length} · ATÉ ${set.target}`;
  const currentServer = playerName(match, match.serve, match.active[match.serve][0]);
  $("#serve-label").textContent = match.finished ? "RESULTADO FINAL" : `SAQUE: TIME ${match.serve} · ${currentServer}`;
  $("#match-format").textContent = `MELHOR DE ${match.bestOf}`;
  $("#score-name-a").textContent = match.teamA;
  $("#score-name-b").textContent = match.teamB;
  $("#score-a").textContent = String(set.A);
  $("#score-b").textContent = String(set.B);
  $("#sets-a").innerHTML = renderSetDots(match, "A");
  $("#sets-b").innerHTML = renderSetDots(match, "B");
  $("#serve-indicator-a").classList.toggle("active", !match.finished && match.serve === "A");
  $("#serve-indicator-b").classList.toggle("active", !match.finished && match.serve === "B");
  for (const side of ["A", "B"]) {
    $(`#point-player-${side.toLowerCase()}`).innerHTML = match.active[side].map((index, position) =>
      `<option value="${index}">P${position + 1} · ${escapeHtml(playerName(match, side, index))}</option>`
    ).join("");
    const activeNames = match.active[side].map((index, position) =>
      `<span><strong>P${position + 1}:</strong> ${escapeHtml(playerName(match, side, index))}</span>`
    );
    const reserves = match.players[side].map((name, index) => ({ name, index }))
      .filter(player => !match.active[side].includes(player.index));
    $(`#roster-${side.toLowerCase()}`).innerHTML = `<strong>EM QUADRA:</strong> ${activeNames.join(" · ")}<br><strong>RESERVAS:</strong> ${reserves.length ? reserves.map(player => escapeHtml(player.name)).join(" · ") : "nenhuma"}`;
    renderSubstitutionPanel(match, side);
  }
  $$(".point-button").forEach(button => { button.disabled = match.finished; });
  $("#undo-point").disabled = match.finished || match.history.length === 0;
  $("#new-match").hidden = !match.finished;
  $("#toolbar-match-status").textContent = match.finished ? "Partida finalizada" : "Partida em andamento";
  $("#last-action").textContent = match.finished ? ` · ${teamName(match, match.winner)} venceu` : "";
  $("#set-summary").innerHTML = match.sets.map((result, index) =>
    `<div class="set-row"><span>Set ${index + 1}${result.winner ? ` · ${escapeHtml(teamName(match, result.winner))} venceu` : ""}</span><strong>${result.A} – ${result.B}</strong></div>`
  ).join("");
  $("#player-highlights").innerHTML = ["A", "B"].map(side =>
    match.players[side].map((name, index) => {
      const stats = playerStats(match, side, index);
      const contributionLabel = stats.contributions === 1 ? "contribuição" : "contribuições";
      const status = match.active[side].includes(index) ? "em quadra" : "reserva";
      return `<div class="highlight-row"><strong>${escapeHtml(name)} <small>${status}</small></strong><span>${stats.points} ponto${stats.points === 1 ? "" : "s"} · ${stats.errors} erro${stats.errors === 1 ? "" : "s"} · ${stats.contributions} ${contributionLabel}</span></div>`;
    }).join("")
  ).join("");
  renderHistory();
}

function renderSubstitutionPanel(match, side) {
  const container = $(`#substitution-${side.toLowerCase()}`);
  const reserves = match.players[side].map((name, index) => ({ name, index }))
    .filter(player => !match.active[side].includes(player.index));
  if (!reserves.length) {
    container.innerHTML = '<p class="no-reserves">Sem reservas cadastradas para revezar.</p>';
    return;
  }
  const playerOptions = match.active[side].map((index, position) =>
    `<option value="${position}">${escapeHtml(playerName(match, side, index))} · posição ${position + 1}</option>`
  ).join("");
  const reserveOptions = reserves.map(player =>
    `<option value="${player.index}">${escapeHtml(player.name)}</option>`
  ).join("");
  container.innerHTML = `
    <label>Vai sair<select id="sub-out-${side}"${match.finished ? " disabled" : ""}>${playerOptions}</select></label>
    <label>Entra<select id="sub-in-${side}"${match.finished ? " disabled" : ""}>${reserveOptions}</select></label>
    <button class="substitute-button" type="button" data-substitute="${side}"${match.finished ? " disabled" : ""}>Revezar</button>`;
}

function renderHistory() {
  const container = $("#match-history");
  if (!state.matches.length) {
    container.innerHTML = "<p>Nenhum placar salvo ainda.</p>";
    return;
  }
  container.innerHTML = state.matches.map(match => `
    <div class="history-row">
      <strong>${escapeHtml(match.teamA)} × ${escapeHtml(match.teamB)}</strong>
      <span>${escapeHtml(match.setsWon)}</span>
      <span>${match.winner ? `Vencedor: ${escapeHtml(match.winner === "A" ? match.teamA : match.teamB)}` : "Em andamento"}</span>
      <button class="history-delete" type="button" data-delete-match="${Number(match.id)}">Apagar</button>
    </div>`).join("");
}

function renderStats() {
  const match = state.current;
  const controls = $("#stat-controls");
  $("#stats-match-caption").textContent = match ? `${match.teamA} × ${match.teamB}` : "Inicie uma partida para registrar ações.";
  if (!match) {
    controls.innerHTML = "<p>Os controles individuais ficam disponíveis durante uma partida.</p>";
    $("#stats-table-wrap").innerHTML = '<p class="empty-copy">A tabela de desempenho será preenchida durante o jogo.</p>';
    return;
  }
  const options = ["A", "B"].flatMap(side => match.players[side].map((name, index) => {
    const status = match.active[side].includes(index) ? "em quadra" : "reserva";
    return `<option value="${side}:${index}">${escapeHtml(name)} · ${escapeHtml(teamName(match, side))} · ${status}</option>`;
  })).join("");
  controls.innerHTML = `
    <select class="stat-select" id="stat-player" aria-label="Atleta para registrar desempenho">${options}</select>
    <button class="stat-action error-action" data-stat="errors" type="button"${match.finished ? " disabled" : ""}>＋ Registrar erro</button>
    <button class="stat-action" data-stat="contributions" type="button"${match.finished ? " disabled" : ""}>＋ Boa contribuição</button>
    ${match.finished ? '<span class="small-note">Partida finalizada: estatísticas apenas para consulta.</span>' : ""}`;

  const rows = ["A", "B"].flatMap(side => match.players[side].map((name, index) => {
    const stats = playerStats(match, side, index);
    const status = match.active[side].includes(index) ? "Em quadra" : "Reserva";
    return `<tr><td>${escapeHtml(name)}</td><td>${escapeHtml(teamName(match, side))}</td><td>${status}</td><td>${stats.points}</td><td>${stats.errors}</td><td>${stats.contributions}</td><td>${stats.substitutionsIn}</td><td>${stats.substitutionsOut}</td></tr>`;
  })).join("");
  $("#stats-table-wrap").innerHTML = `<table class="data-table"><thead><tr><th>ATLETA</th><th>EQUIPE</th><th>SITUAÇÃO</th><th>PONTOS</th><th>ERROS</th><th>CONTRIBUIÇÕES</th><th>ENTROU</th><th>SAIU</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderRotation() {
  const match = state.current;
  if (!match) {
    $("#substitution-history").innerHTML = "<p>Inicie uma partida para acompanhar as trocas.</p>";
    $("#court-team-label").textContent = "POSIÇÕES INICIAIS";
    for (const [position, player] of [[1, "Jogador(a) 1"], [2, "Jogador(a) 2"], [3, "Jogador(a) 3"], [4, "Jogador(a) 4"]]) {
      $(`#court-p${position} strong`).textContent = player;
      $(`#court-p${position}`).classList.remove("serving-position");
    }
    return;
  }
  const side = match.serve;
  $("#court-team-label").textContent = `QUADRA · ${teamName(match, side)} · SAQUE`;
  for (let position = 0; position < 4; position += 1) {
    const player = match.active[side][position];
    $(`#court-p${position + 1} strong`).textContent = playerName(match, side, player);
    $(`#court-p${position + 1}`).classList.toggle("serving-position", position === 0);
  }
  $("#substitution-history").innerHTML = match.substitutions.length
    ? [...match.substitutions].reverse().map(change =>
      `<div class="serve-order-row"><span>Time ${change.side} · posição ${change.position}</span><strong>${escapeHtml(playerName(match, change.side, change.outgoing))} → ${escapeHtml(playerName(match, change.side, change.incoming))}</strong></div>`
    ).join("")
    : "<p>Nenhum revezamento realizado ainda.</p>";
}

function getStandings() {
  const table = new Map();
  for (const match of state.matches) {
    if (!match.winner) continue;
    for (const side of ["A", "B"]) {
      const name = match[teamKey(side)];
      const key = name.trim().toLocaleLowerCase("pt-BR");
      if (!table.has(key)) table.set(key, { name, wins: 0, losses: 0, setsFor: 0, setsAgainst: 0, pointsFor: 0, pointsAgainst: 0 });
      const row = table.get(key);
      if (side === match.winner) row.wins += 1;
      else row.losses += 1;
      for (const set of match.sets) {
        row.setsFor += set[side] > set[side === "A" ? "B" : "A"] ? 1 : 0;
        row.setsAgainst += set[side === "A" ? "B" : "A"] > set[side] ? 1 : 0;
        row.pointsFor += set[side] || 0;
        row.pointsAgainst += set[side === "A" ? "B" : "A"] || 0;
      }
    }
  }
  return [...table.values()].sort((a, b) =>
    b.wins - a.wins ||
    (b.setsFor - b.setsAgainst) - (a.setsFor - a.setsAgainst) ||
    (b.pointsFor - b.pointsAgainst) - (a.pointsFor - a.pointsAgainst) ||
    a.name.localeCompare(b.name, "pt-BR")
  );
}

function renderStandings() {
  const standings = getStandings();
  const positions = [
    { position: 2, className: "second", fallback: "2º" },
    { position: 1, className: "first", fallback: "1º" },
    { position: 3, className: "third", fallback: "3º" }
  ];
  $("#podium").innerHTML = positions.map(({ position, className, fallback }) => {
    const row = standings[position - 1];
    return `<div class="podium-place ${className}"><span class="podium-medal">${row ? fallback : "—"}</span>${row ? `<strong class="podium-name">${escapeHtml(row.name)}</strong><span class="podium-stats">${row.wins} vitória${row.wins === 1 ? "" : "s"} · ${row.losses} derrota${row.losses === 1 ? "" : "s"}</span>` : '<strong class="podium-name">Aguardando resultado</strong><span class="podium-stats">Finalize partidas para preencher</span>'}<div class="podium-step">${fallback}</div></div>`;
  }).join("");
  const completed = [...state.matches].sort((a, b) => new Date(b.finishedAt) - new Date(a.finishedAt));
  $("#results-table-wrap").innerHTML = completed.length ? `
    <table class="data-table"><thead><tr><th>PARTIDA</th><th>RESULTADO DOS SETS</th><th>VENCEDOR</th><th>DATA</th></tr></thead><tbody>
    ${completed.map(match => `<tr><td>${escapeHtml(match.teamA)} × ${escapeHtml(match.teamB)}</td><td>${escapeHtml(match.setsWon)}</td><td>${escapeHtml(match.winner === "A" ? match.teamA : match.teamB)}</td><td>${new Date(match.finishedAt).toLocaleDateString("pt-BR")}</td></tr>`).join("")}
    </tbody></table>` : '<p class="empty-copy">Finalize e salve partidas para montar a classificação.</p>';
}

function render() {
  renderScoreboard();
  renderStats();
  renderRotation();
  renderStandings();
  if (state.current) {
    const match = state.current;
    $("#point-player-a").value = String(match.active.A[0]);
    $("#point-player-b").value = String(match.active.B[0]);
    if (match.finished && !match.savedAt) {
      $("#save-match").textContent = "Salvar resultado";
    } else {
      $("#save-match").textContent = "Salvar placar";
    }
    $$(".point-button").forEach(button => { button.disabled = match.finished; });
  }
}

function showView(name) {
  $$(".view").forEach(view => {
    const isActive = view.id === `view-${name}`;
    view.classList.toggle("active", isActive);
    view.hidden = !isActive;
  });
  $$(".nav-link").forEach(button => button.classList.toggle("active", button.dataset.view === name));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

$("#setup-form").addEventListener("submit", event => {
  event.preventDefault();
  startMatch(event.currentTarget);
});

$("#setup-form").addEventListener("click", event => {
  const addButton = event.target.closest("[data-add-reserve]");
  if (addButton) {
    addReserveField(addButton.dataset.addReserve);
    return;
  }
  const removeButton = event.target.closest(".remove-reserve");
  if (removeButton) removeButton.closest(".reserve-input-row").remove();
});

$$("[data-view]").forEach(button => button.addEventListener("click", () => showView(button.dataset.view)));

$$("[data-point]").forEach(button => button.addEventListener("click", () => addPoint(button.dataset.point)));

$("#match-card").addEventListener("click", event => {
  const button = event.target.closest("[data-substitute]");
  if (button) substitutePlayer(button.dataset.substitute);
});

$("#undo-point").addEventListener("click", undoLastAction);
$("#save-match").addEventListener("click", saveCurrentMatch);
$("#delete-match").addEventListener("click", deleteCurrentMatch);
$("#new-match").addEventListener("click", () => {
  if (!state.current?.finished) return;
  if (!saveCurrentMatch()) return;
  state.current = null;
  persist();
  render();
  showNotice("Resultado guardado. Configure as próximas equipes.");
});

$("#stat-controls").addEventListener("click", event => {
  const button = event.target.closest("[data-stat]");
  if (!button) return;
  const [side, player] = $("#stat-player").value.split(":");
  const match = state.current;
  if (!match || match.finished || !["A", "B"].includes(side) || !Number.isInteger(Number(player))) return;
  const kind = button.dataset.stat;
  playerStats(match, side, Number(player))[kind] += 1;
  match.history.push({ kind, side, player: Number(player) });
  const stored = persist();
  render();
  if (stored) showNotice(kind === "errors" ? "Erro registrado." : "Boa contribuição registrada.");
});

$("#match-history").addEventListener("click", event => {
  const button = event.target.closest("[data-delete-match]");
  if (button) deleteSavedMatch(Number(button.dataset.deleteMatch));
});

render();
if (state.loadError) showNotice(state.loadError, true);
if (state.loadNotice) {
  showNotice(state.loadNotice);
  delete state.loadNotice;
}
